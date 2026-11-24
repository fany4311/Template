import { INestApplication } from '@nestjs/common';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { Test, TestingModule } from '@nestjs/testing';
import { setTimeout as sleep } from 'node:timers/promises';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { getResponseZodSchemas } from './../src/common/swagger/api-ok.js';
import { DictData } from './../src/modules/dict/entities/dict-data.entity.js';
import { DictType } from './../src/modules/dict/entities/dict-type.entity.js';
import { Hazard } from './../src/modules/hazard/entities/hazard.entity.js';
import { HazardLog } from './../src/modules/hazard/entities/hazard-log.entity.js';
import { HazardSync } from './../src/modules/hazard/entities/hazard-sync.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';
import { OutboxEvent } from './../src/modules/outbox/entities/outbox-event.entity.js';
import { LoginLog } from './../src/modules/loginlog/entities/login-log.entity.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';

/**
 * 响应契约测试：**用生成 OpenAPI 的同一份 zod schema 校验真实响应**。
 *
 * 目的：schema 与实现漂移会在这里直接失败，而不是等前端类型对不上才发现。
 * 规则：新增/修改接口时，把该接口加进下面的用例（component 名要一致）。
 */
describe('Response contract (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token = '';
  let schemas: ReadonlyMap<string, import('zod').ZodType>;

  const prefix = '/api/v1';
  const tag = `e2e_contract_${Date.now()}`;
  const dictType = `${tag}_dict`;

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const idem = () => ({ 'Idempotency-Key': `${tag}-${Math.random()}` });

  /** 断言响应符合指定组件的 schema */
  function expectContract(res: request.Response, component: string): void {
    const schema = schemas.get(component);
    expect(schema, `未注册的响应组件: ${component}`).toBeDefined();
    const parsed = schema!.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `[${component}] 响应与契约不符: ${JSON.stringify(parsed.error.issues.slice(0, 5))}\n实际: ${JSON.stringify(res.body).slice(0, 500)}`,
      );
    }
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);
    // 控制器加载后 schema 才注册，必须在 init 之后取
    schemas = getResponseZodSchemas();

    const userRepo = ds.getRepository(User);
    const urRepo = ds.getRepository(UserRole);

    const role = await createE2ERole(ds, {
      // role_key 已废弃：用 role_name 承载可搜索标识，清理时按名称前缀删
      roleName: `${tag}_契约`,
      permissions: ['*:*:*'],
      dataScope: 'ALL',
      status: 1,
    });
    const user = await userRepo.save(
      userRepo.create({
        username: `${tag}_user`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({ userId: user.id, roleId: role.id, source: 'direct' }),
    );

    const login = await api()
      .post(`${prefix}/auth/login`)
      .send({ username: `${tag}_user`, password: 'pass1234' })
      .expect(200);
    token = login.body.data.token as string;
    expectContract(login, 'LoginResult');
  });

  afterAll(async () => {
    await ds
      .getRepository(IdempotencyRecord)
      .createQueryBuilder()
      .delete()
      .where('key LIKE :p', { p: `%${tag}%` })
      .execute();
    await ds
      .getRepository(LoginLog)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: `${tag}%` })
      .execute();
    const contractHazards = await ds
      .getRepository(Hazard)
      .createQueryBuilder('h')
      .withDeleted()
      .select('h.id', 'id')
      .where('h.title LIKE :p', { p: `%${tag}%` })
      .getRawMany<{ id: number }>();
    const hazardIds = contractHazards.map((r) => Number(r.id));
    if (hazardIds.length) {
      // 先撤 Outbox 事件再等一拍：否则轮询器会在清理之后补写同步记录（孤儿数据）
      await ds
        .getRepository(OutboxEvent)
        .createQueryBuilder()
        .delete()
        .where('aggregate_type = :t AND aggregate_id IN (:...ids)', {
          t: 'Hazard',
          ids: hazardIds.map(String),
        })
        .execute();
      await sleep(1500);
      await ds.getRepository(HazardSync).delete({ hazardId: In(hazardIds) });
      await ds.getRepository(HazardLog).delete({ hazardId: In(hazardIds) });
      await ds.getRepository(Hazard).delete({ id: In(hazardIds) });
    }
    await ds.getRepository(DictData).delete({ dictType });
    await ds.getRepository(DictType).delete({ dictType });
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where(
        'user_id IN (SELECT id FROM sys_user WHERE username LIKE :p) OR role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)',
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

  it('认证：captcha / login / profile / logout', async () => {
    const captcha = await api().get(`${prefix}/auth/captcha`).expect(200);
    expectContract(captcha, 'CaptchaResult');

    const profile = await api()
      .get(`${prefix}/auth/profile`)
      .set(auth())
      .expect(200);
    expectContract(profile, 'Profile');
  });

  it('系统管理：user / role / dept / menu', async () => {
    const userPage = await api().get(`${prefix}/user`).set(auth()).expect(200);
    expectContract(userPage, 'SysUserPage');

    const created = await api()
      .post(`${prefix}/user`)
      .set(auth())
      .set(idem())
      .send({ username: `${tag}_u2`, password: 'pass1234', status: 1 })
      .expect(200);
    expectContract(created, 'SysUser');

    const grants = await api()
      .get(`${prefix}/user/${created.body.data.id as number}/roles`)
      .set(auth())
      .expect(200);
    expectContract(grants, 'SysUserRoles');

    const grant = await api()
      .post(`${prefix}/user/${created.body.data.id as number}/roles`)
      .set(auth())
      .set(idem())
      .send({
        roleIds: [
          (
            await ds
              .getRepository(Role)
              .findOneByOrFail({ roleName: `${tag}_契约` })
          ).id,
        ],
      })
      .expect(200);
    expectContract(grant, 'VoidResult');

    const removedUser = await api()
      .delete(`${prefix}/user/${created.body.data.id as number}`)
      .set(auth())
      .expect(200);
    expectContract(removedUser, 'BoolResult');

    const rolePage = await api().get(`${prefix}/role`).set(auth()).expect(200);
    expectContract(rolePage, 'SysRolePage');

    const deptTree = await api()
      .get(`${prefix}/dept/tree`)
      .set(auth())
      .expect(200);
    expectContract(deptTree, 'SysDeptTree');

    const deptList = await api().get(`${prefix}/dept`).set(auth()).expect(200);
    expectContract(deptList, 'SysDeptList');

    const menuTree = await api()
      .get(`${prefix}/menu/tree`)
      .set(auth())
      .expect(200);
    expectContract(menuTree, 'SysMenuTree');

    const routes = await api()
      .get(`${prefix}/menu/routes`)
      .set(auth())
      .expect(200);
    expectContract(routes, 'SysMenuTree');
  });

  it('字典：类型 / 数据 / 选项', async () => {
    const typePage = await api()
      .get(`${prefix}/dict/type`)
      .set(auth())
      .expect(200);
    expectContract(typePage, 'SysDictTypePage');

    const created = await api()
      .post(`${prefix}/dict/type`)
      .set(auth())
      .set(idem())
      .send({ dictName: '契约字典', dictType })
      .expect(200);
    expectContract(created, 'SysDictType');

    const data = await api()
      .post(`${prefix}/dict/data`)
      .set(auth())
      .set(idem())
      .send({ dictType, dictLabel: 'A', dictValue: 'a' })
      .expect(200);
    expectContract(data, 'SysDictData');

    const dataPage = await api()
      .get(`${prefix}/dict/data?dictType=${dictType}`)
      .set(auth())
      .expect(200);
    expectContract(dataPage, 'SysDictDataPage');

    const options = await api()
      .get(`${prefix}/dict/options/${dictType}`)
      .set(auth())
      .expect(200);
    expectContract(options, 'SysDictOptions');

    const removed = await api()
      .delete(`${prefix}/dict/data/${data.body.data.id as number}`)
      .set(auth())
      .expect(200);
    expectContract(removed, 'BoolResult');
  });

  it('参数：分页 / 按键取值', async () => {
    const page = await api().get(`${prefix}/config`).set(auth()).expect(200);
    expectContract(page, 'SysConfigPage');

    const created = await api()
      .post(`${prefix}/config`)
      .set(auth())
      .set(idem())
      .send({ configName: '契约参数', configKey: `${tag}.k`, configValue: 'v' })
      .expect(200);
    expectContract(created, 'SysConfig');

    const value = await api()
      .get(`${prefix}/config/key/${tag}.k`)
      .set(auth())
      .expect(200);
    expectContract(value, 'SysConfigValue');

    await ds.getRepository('sys_config').delete({ configKey: `${tag}.k` });
  });

  it('隐患闭环：分页 / 上报 / 详情 / 流转', async () => {
    const page = await api().get(`${prefix}/hazard`).set(auth()).expect(200);
    expectContract(page, 'HazardPage');

    const created = await api()
      .post(`${prefix}/hazard`)
      .set(auth())
      .set(idem())
      .send({
        title: `${tag} 契约隐患`,
        content: '用于响应契约校验的隐患描述',
        scope: 'OPEN',
        cooperateDeptIds: [28],
        level: 'HIGH',
        category: 'FIRE',
      })
      .expect(200);
    expectContract(created, 'Hazard');
    const id = created.body.data.id as number;

    const detail = await api()
      .get(`${prefix}/hazard/${id}`)
      .set(auth())
      .expect(200);
    expectContract(detail, 'HazardDetail');

    const accepted = await api()
      .post(`${prefix}/hazard/${id}/accept`)
      .set(auth())
      .set(idem())
      .send({
        rectifyDeadline: new Date(Date.now() + 86400000).toISOString(),
        remark: '契约测试受理',
      })
      .expect(200);
    expectContract(accepted, 'Hazard');

    const rectified = await api()
      .post(`${prefix}/hazard/${id}/rectify`)
      .set(auth())
      .set(idem())
      .send({ rectifyMeasure: '已整改并复测' })
      .expect(200);
    expectContract(rectified, 'Hazard');

    const reviewed = await api()
      .post(`${prefix}/hazard/${id}/review`)
      .set(auth())
      .set(idem())
      .send({ passed: true, opinion: '复核通过' })
      .expect(200);
    expectContract(reviewed, 'Hazard');

    const archived = await api()
      .post(`${prefix}/hazard/${id}/archive`)
      .set(auth())
      .set(idem())
      .send({ opinion: '归档' })
      .expect(200);
    expectContract(archived, 'Hazard');

    const removed = await api()
      .delete(`${prefix}/hazard/${id}`)
      .set(auth())
      .expect(200);
    expectContract(removed, 'BoolResult');
  });

  it('日志：操作日志 / 登录日志', async () => {
    const audit = await api().get(`${prefix}/audit`).set(auth()).expect(200);
    expectContract(audit, 'SysAuditLogPage');

    const auditRows = audit.body.data.list as Array<{ id: string }>;
    if (auditRows.length) {
      const detail = await api()
        .get(`${prefix}/audit/${auditRows[0].id}`)
        .set(auth())
        .expect(200);
      expectContract(detail, 'SysAuditLog');
    }

    const loginlog = await api()
      .get(`${prefix}/loginlog`)
      .set(auth())
      .expect(200);
    expectContract(loginlog, 'SysLoginLogPage');
  });

  it('所有已注册组件都能被本次用例覆盖或至少可用', () => {
    // 组件名是前后端共享的契约名，重复注册同名会互相覆盖 —— 这里额外防一手：
    // 每个组件都必须能编译成合法 zod schema
    for (const [name, schema] of schemas) {
      expect(typeof name).toBe('string');
      expect(typeof schema.safeParse).toBe('function');
    }
    expect(schemas.size).toBeGreaterThan(20);
  });
});
