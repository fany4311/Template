import { INestApplication } from '@nestjs/common';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { DataSource, In, IsNull } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { Dept } from './../src/modules/dept/entities/dept.entity.js';
import { Hazard } from './../src/modules/hazard/entities/hazard.entity.js';
import { HazardLog } from './../src/modules/hazard/entities/hazard-log.entity.js';
import { HazardSync } from './../src/modules/hazard/entities/hazard-sync.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';
import { OutboxEvent } from './../src/modules/outbox/entities/outbox-event.entity.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';
import type { HazardView } from './../src/modules/hazard/hazard.service.js';

/**
 * 隐患闭环 e2e —— 同时也是**底座的集成验证**。
 *
 * 覆盖：
 * 1. 可见性三要素：角色数据范围 / 我是上报人 / 我在协办部门
 * 2. 两条模拟单的对照效果（本部门闭环 vs 多部门协同）
 * 3. 状态机：非法流转被拒、终态不可再动
 * 4. 权限分层：RBAC 权限码与 CASL 动作各拦一类
 * 5. 全流程一单跑通：上报→受理→整改→复查退回→整改→复查通过→归档
 * 6. Outbox → 省平台适配器（Mock）落同步记录
 *
 * 注意：读取 demo 单只做只读断言，不修改；流程测试用自己的单，结束后清理。
 */
describe('Hazard 隐患闭环 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  /** 让出一点时间给 Outbox 轮询器（间隔 1s）收尾，避免清理竞态 */
  const SETTLE_MS = 1500;

  const prefix = '/api/v1';
  const tag = `e2e_hazard_${Date.now()}`;
  const DEMO_DEPT_ONLY = 'DEMO-HZ-0001'; // 保卫处闭环，信息中心不可见
  const DEMO_MULTI = 'DEMO-HZ-0002'; // 保卫处 + 信息中心协同

  let operator = ''; // 业务操作员（消防科）
  let managerBw = ''; // 部门管理员（保卫处）
  let managerXx = ''; // 部门管理员（信息中心）
  let auditor = ''; // 审计员（全校）
  let admin = ''; // 校级管理员（自建，e2e 专用）
  let rbacOnly = ''; // 只有权限码、没有 CASL 规则（用于验证两层拦截）
  let sysOnly = ''; // 只持系统域权限（system:*）：用于验证「无业务权限码 → 碰不到业务接口」

  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const idem = () => ({ 'Idempotency-Key': `${tag}-${Math.random()}` });

  /** 登录并取 token */
  async function login(username: string, password: string): Promise<string> {
    const res = await api()
      .post(`${prefix}/auth/login`)
      .send({ username, password })
      .expect(200);
    expect(res.body.code, `登录失败: ${username} ${res.body.msg}`).toBe(200);
    return res.body.data.token as string;
  }

  /** 上报一条隐患，返回响应体 */
  async function report(
    token: string,
    body: Record<string, unknown>,
  ): Promise<request.Response> {
    return api()
      .post(`${prefix}/hazard`)
      .set(auth(token))
      .set(idem())
      .send({
        title: `${tag} 标题`,
        content: '这是一条用于端到端测试的隐患描述',
        ...body,
      })
      .expect(200);
  }

  /** 流转动作 */
  async function flow(
    token: string,
    id: number,
    action: string,
    body: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return api()
      .post(`${prefix}/hazard/${id}/${action}`)
      .set(auth(token))
      .set(idem())
      .send(body)
      .expect(200);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    // 演示账号（由 1767000008000 迁移建好）
    operator = await login('operator_bw', 'Demo@12345');
    managerBw = await login('manager_bw', 'Demo@12345');
    managerXx = await login('manager_xx', 'Demo@12345');
    auditor = await login('auditor_school', 'Demo@12345');

    // e2e 专用：校级管理员（业务全权，禁系统域）
    const adminRole = await createE2ERole(ds, {
      // role_key 已废弃：用 role_name 承载可搜索标识，清理时按名称前缀删
      roleName: `${tag}_校级管理员`,
      permissions: ['*:*:*,!system:*'],
      dataScope: 'ALL',
      status: 1,
    });
    admin = await createUserWithRole(`${tag}_admin`, adminRole.id);

    // e2e 专用：有权限码但无 CASL 规则
    const rbacRole = await createE2ERole(ds, {
      roleName: `${tag}_仅权限码`,
      permissions: ['hazard:report:*'],
      // 只有 read 规则：列表/详情能过 CASL，accept 过不了
      rules: [{ action: 'read', subject: 'Hazard' }],
      dataScope: 'ALL',
      status: 1,
    });
    rbacOnly = await createUserWithRole(`${tag}_rbac`, rbacRole.id);

    // e2e 专用：只给系统域权限 —— 验证「系统域角色碰不到业务接口」。
    // 注意：这**不是**超管的模型。按决策 B，超管权限是 `*:*:*`（业务也全权），
    // 身份由 `level === 0` 判定；这里只是「没有业务权限码」的极端样本。
    const sysRole = await createE2ERole(ds, {
      roleName: `${tag}_系统管理员`,
      permissions: ['system:*'],
      dataScope: 'ALL',
      status: 1,
    });
    sysOnly = await createUserWithRole(`${tag}_sys`, sysRole.id);

    // 演示数据里的部门由迁移按名称创建，id 因环境而异，这里按名称/层级解析
    const deptRepo = ds.getRepository(Dept);
    rootDeptId =
      (await deptRepo.findOne({ where: { parentId: IsNull() } }))?.id ?? 0;
    infoDeptId =
      (await deptRepo.findOne({ where: { name: '信息中心' } }))?.id ?? 0;
    expect(rootDeptId).toBeGreaterThan(0);
    expect(infoDeptId).toBeGreaterThan(0);
  });

  /** 部门 id 从库里按语义解析，**不硬编码** —— 每个环境的自增 id 不一样 */
  let rootDeptId = 0;
  let infoDeptId = 0;

  /** 造一个用户并授权，返回 token */
  async function createUserWithRole(
    username: string,
    roleId: number,
  ): Promise<string> {
    const userRepo = ds.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        username,
        password: await hash('pass1234'),
        deptId: rootDeptId,
        status: 1,
      }),
    );
    await ds
      .getRepository(UserRole)
      .save(
        ds
          .getRepository(UserRole)
          .create({ userId: user.id, roleId, source: 'direct' }),
      );
    return login(username, 'pass1234');
  }

  afterAll(async () => {
    // withDeleted()：删除接口是软删，不带的话会漏掉已软删的单据，
    // 其日志/同步记录就变成孤儿
    const rows = await ds
      .getRepository(Hazard)
      .createQueryBuilder('h')
      .withDeleted()
      .select('h.id', 'id')
      .addSelect('h.hazard_no', 'hazardNo')
      .where('h.title LIKE :p', { p: `%${tag}%` })
      .getRawMany<{ id: number; hazardNo: string }>();
    const allIds = [...new Set(rows.map((r) => Number(r.id)))];

    if (allIds.length) {
      // 顺序很重要：先撤掉未投递的 Outbox 事件，再等一拍，
      // 否则轮询器（含并行运行的 dev server）会在我们删完之后又写一条同步记录，
      // 留下孤儿数据。
      await ds
        .getRepository(OutboxEvent)
        .createQueryBuilder()
        .delete()
        .where('aggregate_type = :t AND aggregate_id IN (:...ids)', {
          t: 'Hazard',
          ids: allIds.map(String),
        })
        .execute();
      await sleep(SETTLE_MS);
      await ds.getRepository(HazardSync).delete({ hazardId: In(allIds) });
      await ds.getRepository(HazardLog).delete({ hazardId: In(allIds) });
      await ds.getRepository(Hazard).delete({ id: In(allIds) });
    }

    await ds
      .getRepository(IdempotencyRecord)
      .createQueryBuilder()
      .delete()
      .where('key LIKE :p', { p: `%${tag}%` })
      .execute();
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where(
        `user_id IN (SELECT id FROM sys_user WHERE username LIKE :p)
         OR role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)`,
        { p: `${tag}%` },
      )
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: `${tag}%` })
      .execute();
    await ds
      .getRepository(Role)
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: `${tag}%` })
      .execute();

    await purgeE2ELogs(ds);
    await app.close();
  });

  // -------------------------------------------------------------------------
  // 1. 可见性：两条模拟单的对照
  // -------------------------------------------------------------------------

  describe('可见性：数据范围 + 协办部门', () => {
    it('本部门闭环单：协办外的部门看不到（404，不泄漏存在性）', async () => {
      const own = await api()
        .get(`${prefix}/hazard`)
        .query({ keyword: DEMO_DEPT_ONLY })
        .set(auth(managerBw))
        .expect(200);
      expect(own.body.data.list.map((h: HazardView) => h.hazardNo)).toContain(
        DEMO_DEPT_ONLY,
      );

      const other = await api()
        .get(`${prefix}/hazard`)
        .query({ keyword: DEMO_DEPT_ONLY })
        .set(auth(managerXx))
        .expect(200);
      expect(other.body.data.total).toBe(0);

      // 不可见 = 不存在（404，不泄漏单据是否存在；框架异常走原始状态码）
      await api()
        .get(`${prefix}/hazard/${own.body.data.list[0].id as number}`)
        .set(auth(managerXx))
        .expect(404);
    });

    it('多部门协同单：协办部门能看到（即使数据范围不覆盖）', async () => {
      const list = await api()
        .get(`${prefix}/hazard`)
        .query({ keyword: DEMO_MULTI })
        .set(auth(managerXx))
        .expect(200);

      expect(list.body.data.total).toBe(1);
      const item = list.body.data.list[0] as HazardView;
      expect(item.hazardNo).toBe(DEMO_MULTI);
      expect(item.scope).toBe('OPEN');
      expect(item.cooperateDeptNames).toContain('信息中心');
      expect(item.statusLabel).toBe('待受理');
    });

    it('全校通报单：数据范围与协办都不覆盖的部门也能看到（scope=SCHOOL）', async () => {
      // operator（业务操作员，消防科）报一条全校通报单：主责=消防科，无协办。
      // 不用 manager_bw：部门管理员的 CASL 规则只有 read/accept/reject/rectify（无 create），
      // 本来就不能上报 —— 用它会得到 403，那是另一层设计，不是本用例要验的东西。
      const created = await report(operator, {
        title: `${tag} 全校通报单`,
        content: '验证 scope=SCHOOL：全校持有列表权限的人都能看到',
        scope: 'SCHOOL',
      });
      expect(created.body.code, created.body.msg).toBe(200);
      const id = created.body.data.id as number;

      // 信息中心：数据范围只有本部门及以下，不是上报人，不在协办 —— 也能看到
      const visible = await api()
        .get(`${prefix}/hazard`)
        .query({ keyword: `${tag} 全校通报单` })
        .set(auth(managerXx))
        .expect(200);
      expect(visible.body.data.total).toBe(1);
      expect((visible.body.data.list[0] as HazardView).scope).toBe('SCHOOL');

      // 详情与附件鉴权复用同一套可见性 → 详情也是 200（不是 404）
      await api()
        .get(`${prefix}/hazard/${id}`)
        .set(auth(managerXx))
        .expect(200);

      // 对照：同样由 operator 上报、但 scope=DEPT 的单，信息中心仍是 404
      const deptOnly = await report(operator, {
        title: `${tag} 本部门闭环对照`,
        content: '对照组：非 SCHOOL 仍严格按数据范围',
        scope: 'DEPT',
      });
      await api()
        .get(`${prefix}/hazard/${deptOnly.body.data.id as number}`)
        .set(auth(managerXx))
        .expect(404);
    });

    it('列表按可见性过滤，且只在可见集合内做分页', async () => {
      const mine = await api()
        .get(`${prefix}/hazard`)
        .query({ pageNum: 1, pageSize: 100 })
        .set(auth(managerXx))
        .expect(200);
      const nos = mine.body.data.list.map((h: HazardView) => h.hazardNo);
      expect(nos).toContain(DEMO_MULTI);
      expect(nos).not.toContain(DEMO_DEPT_ONLY);
    });

    it('审计员数据范围为 ALL，全校单据可见', async () => {
      const list = await api()
        .get(`${prefix}/hazard`)
        .query({ pageNum: 1, pageSize: 100 })
        .set(auth(auditor))
        .expect(200);
      const nos = list.body.data.list.map((h: HazardView) => h.hazardNo);
      expect(nos).toContain(DEMO_DEPT_ONLY);
      expect(nos).toContain(DEMO_MULTI);
    });

    it('查询过滤参数容错：空串视为「未填」', async () => {
      // 回归：`status=`/`level=`/`scope=`/`onlyMine=` 空串曾直接 400
      const res = await api()
        .get(
          `${prefix}/hazard?pageNum=1&pageSize=1&keyword=&status=&level=&scope=&category=&onlyMine=`,
        )
        .set(auth(managerBw))
        .expect(200);
      expect(res.body.code).toBe(200);

      const noFilter = await api()
        .get(`${prefix}/hazard?pageNum=1&pageSize=1`)
        .set(auth(managerBw))
        .expect(200);
      expect(res.body.data.total).toBe(noFilter.body.data.total);
    });

    it('上报人能看见自己报的单', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const id = created.body.data.id as number;
      const detail = await api()
        .get(`${prefix}/hazard/${id}`)
        .set(auth(operator))
        .expect(200);
      expect(detail.body.data.id).toBe(id);
      expect(detail.body.data.logs).toHaveLength(1);
      expect(detail.body.data.logs[0].actionLabel).toBe('上报');
    });
  });

  // -------------------------------------------------------------------------
  // 2. 状态机
  // -------------------------------------------------------------------------

  describe('状态机', () => {
    it('未受理不能直接整改', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const res = await flow(
        managerBw,
        created.body.data.id as number,
        'rectify',
        {
          rectifyMeasure: '试图跳过受理直接整改',
        },
      );
      expect(res.body.code).not.toBe(200);
      expect(res.body.msg).toContain('不允许执行');
    });

    it('未整改不能复查', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const res = await flow(admin, created.body.data.id as number, 'review', {
        passed: true,
        opinion: '试图跳过整改直接复查',
      });
      expect(res.body.code).not.toBe(200);
      expect(res.body.msg).toContain('不允许执行');
    });

    it('终态（已驳回）不可再流转', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const id = created.body.data.id as number;

      const rejected = await flow(managerBw, id, 'reject', {
        reason: '重复上报',
      });
      expect(rejected.body.data.status).toBe('REJECTED');
      expect(rejected.body.data.availableActions).toEqual([]);

      const again = await flow(managerBw, id, 'accept', {});
      expect(again.body.code).not.toBe(200);
      expect(again.body.msg).toContain('已结束');
    });

    it('availableActions 由后端状态机给出', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      expect(created.body.data.availableActions).toEqual(['ACCEPT', 'REJECT']);

      const accepted = await flow(
        managerBw,
        created.body.data.id as number,
        'accept',
        {
          rectifyDeadline: new Date(Date.now() + 86400000).toISOString(),
        },
      );
      expect(accepted.body.data.availableActions).toEqual([
        'REJECT',
        'RECTIFY',
      ]);
      expect(accepted.body.data.statusLabel).toBe('整改中');
    });
  });

  // -------------------------------------------------------------------------
  // 3. 权限分层
  // -------------------------------------------------------------------------

  describe('权限分层（RBAC 权限码 + CASL 动作）', () => {
    it('业务员无受理权限码 → 403', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const res = await flow(
        operator,
        created.body.data.id as number,
        'accept',
        {},
      );
      expect(res.body.code).toBe(403);
    });

    it('审计员无整改权限码 → 403', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const res = await flow(
        auditor,
        created.body.data.id as number,
        'rectify',
        {
          rectifyMeasure: '审计员试图整改',
        },
      );
      expect(res.body.code).toBe(403);
    });

    it('有权限码但无 CASL 规则 → 也被拦（两层都生效）', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const id = created.body.data.id as number;

      // 该角色 permissions = hazard:report:*，RBAC 放行
      const visible = await api()
        .get(`${prefix}/hazard`)
        .set(auth(rbacOnly))
        .expect(200);
      expect(visible.body.code).toBe(200);

      // 但没有 CASL 规则 → PoliciesGuard 拦下
      const res = await flow(rbacOnly, id, 'accept', {});
      expect(res.body.code).toBe(403);
    });

    it('只持系统域权限（system:*）的角色：业务接口 → code 403', async () => {
      const res = await api()
        .get(`${prefix}/hazard`)
        .set(auth(sysOnly))
        .expect(200);
      expect(res.body.code).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // 4. 全流程
  // -------------------------------------------------------------------------

  describe('全流程：上报 → 受理 → 整改 → 复查退回 → 整改 → 复查 → 归档', () => {
    it('一单跑通，且每步留痕 + 触发省平台同步', async () => {
      const created = await report(operator, {
        title: `${tag} 全流程单`,
        scope: 'OPEN',
        cooperateDeptIds: [infoDeptId],
        level: 'HIGH',
        category: 'FIRE',
        location: '测试楼 1F',
      });
      const id = created.body.data.id as number;
      expect(created.body.data.hazardNo).toMatch(/^HZ\d{14}$/);
      expect(created.body.data.status).toBe('REPORTED');

      // 受理（协办部门信息中心也参与）
      const accepted = await flow(managerBw, id, 'accept', {
        cooperateDeptIds: [infoDeptId],
        handlerId: undefined,
        rectifyDeadline: new Date(Date.now() + 3 * 86400000).toISOString(),
        remark: '已指派消防科与信息中心协同处理',
      });
      expect(accepted.body.data.status).toBe('PROCESSING');
      expect(accepted.body.data.handlerName).toBe('manager_bw');
      expect(accepted.body.data.overdue).toBe(false);

      // 协办部门（信息中心）提交整改 —— 多部门协同的关键能力
      const rectified = await flow(managerXx, id, 'rectify', {
        rectifyMeasure: '已更换异响水泵并复测压力',
      });
      expect(rectified.body.data.status).toBe('RECTIFIED');
      expect(rectified.body.data.rectifyMeasure).toContain('复测压力');

      // 校级复查不通过 → 退回整改
      const back = await flow(admin, id, 'review', {
        passed: false,
        opinion: '现场未见整改痕迹，退回重做',
      });
      expect(back.body.data.status).toBe('PROCESSING');
      expect(back.body.data.rectifyMeasure).toBeNull();

      // 重新整改 → 复查通过
      await flow(managerBw, id, 'rectify', {
        rectifyMeasure: '已重新施工并留存影像',
      });
      const passed = await flow(admin, id, 'review', {
        passed: true,
        opinion: '现场复核通过',
      });
      expect(passed.body.data.status).toBe('REVIEWED');
      expect(passed.body.data.reviewTime).toBeTruthy();

      // 归档（审计员）
      const archived = await flow(auditor, id, 'archive', {
        opinion: '材料齐全，予以归档',
      });
      expect(archived.body.data.status).toBe('ARCHIVED');
      expect(archived.body.data.archiveTime).toBeTruthy();
      expect(archived.body.data.availableActions).toEqual([]);

      // 轨迹完整：上报/受理/整改/复查退回/整改/复查/归档 = 7 条
      const detail = await api()
        .get(`${prefix}/hazard/${id}`)
        .set(auth(auditor))
        .expect(200);
      const logs = detail.body.data.logs as Array<{ action: string }>;
      expect(logs).toHaveLength(7);
      expect(logs.map((l) => l.action)).toEqual([
        'REPORT',
        'ACCEPT',
        'RECTIFY',
        'REVIEW_BACK',
        'RECTIFY',
        'REVIEW_PASS',
        'ARCHIVE',
      ]);

      // 省平台同步（Mock 适配器）：等 Outbox 轮询投递
      const syncs = await waitForSyncs(id);
      expect(syncs.length).toBeGreaterThanOrEqual(7);
      expect(syncs.every((s) => s.status === 'SUCCESS')).toBe(true);
      expect(syncs[0].target).toBe('mock:province-platform');
    }, 30_000);

    it('未办结不可删除，已归档可删除', async () => {
      const created = await report(operator, { scope: 'DEPT' });
      const id = created.body.data.id as number;

      const blocked = await api()
        .delete(`${prefix}/hazard/${id}`)
        .set(auth(admin))
        .expect(200);
      expect(blocked.body.code).not.toBe(200);
      expect(blocked.body.msg).toContain('尚未办结');

      await flow(managerBw, id, 'reject', { reason: '误报' });
      const removed = await api()
        .delete(`${prefix}/hazard/${id}`)
        .set(auth(admin))
        .expect(200);
      expect(removed.body.data).toBe(true);
    });
  });

  /** 轮询等待省平台同步记录落库 */
  async function waitForSyncs(hazardId: number): Promise<HazardSync[]> {
    for (let i = 0; i < 40; i++) {
      const rows = await ds
        .getRepository(HazardSync)
        .find({ where: { hazardId }, order: { id: 'ASC' } });
      if (rows.length >= 7) return rows;
      await sleep(300);
    }
    return ds
      .getRepository(HazardSync)
      .find({ where: { hazardId }, order: { id: 'ASC' } });
  }
});
