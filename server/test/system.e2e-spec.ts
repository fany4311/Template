import { INestApplication } from '@nestjs/common';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { Config } from './../src/modules/config/entities/config.entity.js';
import { DictData } from './../src/modules/dict/entities/dict-data.entity.js';
import { DictType } from './../src/modules/dict/entities/dict-type.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';
import { LoginLog } from './../src/modules/loginlog/entities/login-log.entity.js';
import { Menu } from './../src/modules/menu/entities/menu.entity.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';

/**
 * 通用管理域二批（菜单 / 字典 / 参数 / 操作日志 / 登录日志）e2e：需 MySQL + Redis。
 */
describe('System management (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let stamp = 0;

  let adminToken = '';
  let limitedToken = '';

  const prefix = '/api/v1';
  const tag = `e2e_sys_${Date.now()}`;
  const dictTypeKey = `${tag}_dict`;
  const menuName = `${tag}_menu`;
  const configKey = `${tag}.config`;

  let menuId = 0;
  let dictTypeId = 0;
  let configId = 0;

  const api = () => request(app.getHttpServer());
  const auth = (token = adminToken) => ({ Authorization: `Bearer ${token}` });
  const idem = () => ({ 'Idempotency-Key': `${tag}-${Math.random()}` });

  async function login(username: string): Promise<string> {
    const res = await api()
      .post(`${prefix}/auth/login`)
      .send({ username, password: 'pass1234' })
      .expect(200);
    return res.body.data.token as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);
    stamp = Date.now();

    const userRepo = ds.getRepository(User);
    const urRepo = ds.getRepository(UserRole);

    // 全权管理员
    const adminRole = await createE2ERole(ds, {
      // role_key 已废弃：用 role_name 承载可搜索标识，清理时按名称前缀删
      roleName: `${tag}_系统全权`,
      permissions: ['*:*:*'],
      dataScope: 'ALL',
      status: 1,
    });
    const adminUser = await userRepo.save(
      userRepo.create({
        username: `${tag}_admin`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({ userId: adminUser.id, roleId: adminRole.id, source: 'direct' }),
    );
    adminToken = await login(`${tag}_admin`);

    // 受限用户：只有菜单列表权限
    const limitedRole = await createE2ERole(ds, {
      roleName: `${tag}_受限`,
      permissions: ['system:menu:list'],
      status: 1,
    });
    const limitedUser = await userRepo.save(
      userRepo.create({
        username: `${tag}_limited`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({
        userId: limitedUser.id,
        roleId: limitedRole.id,
        source: 'direct',
      }),
    );
    limitedToken = await login(`${tag}_limited`);
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
    await ds.getRepository(DictData).delete({ dictType: dictTypeKey });
    await ds.getRepository(DictType).delete({ dictType: dictTypeKey });
    await ds.getRepository(Config).delete({ configKey });
    // 菜单是 M/C 两级（父 `${menuName}` + 子 `${menuName}_c`），
    // 只按 name 精确删会漏掉子菜单，留下孤儿节点 → 用 LIKE 清干净
    await ds
      .getRepository(Menu)
      .createQueryBuilder()
      .delete()
      .where('name LIKE :p', { p: `%${menuName}%` })
      .execute();
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

  describe('菜单', () => {
    it('创建菜单（目录→菜单）并出现在管理树中', async () => {
      const dir = await api()
        .post(`${prefix}/menu`)
        .set(auth())
        .set(idem())
        .send({ name: menuName, type: 'M', path: `/e2e-${stamp}`, sort: 999 })
        .expect(200);
      expect(dir.body.code).toBe(200);

      const child = await api()
        .post(`${prefix}/menu`)
        .set(auth())
        .set(idem())
        .send({
          parentId: dir.body.data.id as number,
          name: `${menuName}_c`,
          type: 'C',
          path: `/e2e-${stamp}/list`,
          component: 'system/UserView',
          perms: 'system:user:list',
        })
        .expect(200);
      expect(child.body.code).toBe(200);
      expect(child.body.data.ancestors).toBe(`0,${dir.body.data.id as number}`);
      menuId = child.body.data.id as number;

      const tree = await api().get(`${prefix}/menu/tree`).set(auth()).expect(200);
      const names = JSON.stringify(tree.body.data);
      expect(names).toContain(menuName);
    });

    it('routes 按权限过滤：无对应权限码的菜单不出现', async () => {
      // 受限用户没有 system:user:list → 该子菜单被过滤
      const res = await api()
        .get(`${prefix}/menu/routes`)
        .set(auth(limitedToken))
        .expect(200);
      const body = JSON.stringify(res.body.data);
      expect(body).not.toContain(`/e2e-${stamp}/list`);
    });

    it('routes 不返回空壳目录：子页面全被过滤时目录也一起消失', async () => {
      // 目录 M 自身 perms 为空串。若把「空 perms 视为命中」，目录会单独留下，
      // 而它的子页面被过滤 → 侧边栏出现一个点进去 404 的空气节点。
      const res = await api()
        .get(`${prefix}/menu/routes`)
        .set(auth(limitedToken))
        .expect(200);
      const names = JSON.stringify(res.body.data);
      expect(names).not.toContain(menuName);
    });

    it('pages 不过滤权限：无权限的页面也在，并且带上 perms（用于渲染 403 而不是 404）', async () => {
      const res = await api()
        .get(`${prefix}/menu/pages`)
        .set(auth(limitedToken))
        .expect(200);
      expect(res.body.code).toBe(200);

      const page = (res.body.data as Menu[]).find(
        (m) => m.path === `/e2e-${stamp}/list`,
      );
      // 存在 = 路由能注册上 → 守卫读 meta.perm 拦下 → 403；
      // 若这里被过滤，前端只能命中 catch-all，显示错误的「404 页面不存在」
      expect(page).toBeDefined();
      expect(page?.perms).toBe('system:user:list');
    });

    it('pages 只返回 C 型页面（目录与按钮不入路由表）', async () => {
      const res = await api()
        .get(`${prefix}/menu/pages`)
        .set(auth())
        .expect(200);
      const list = res.body.data as Menu[];
      expect(list.every((m) => m.type === 'C')).toBe(true);
      expect(list.every((m) => !!m.path)).toBe(true);
      // 目录 /e2e-<stamp> 本身不是页面
      expect(list.some((m) => m.path === `/e2e-${stamp}`)).toBe(false);
    });

    it('同级重名 → 业务错误', async () => {
      const res = await api()
        .post(`${prefix}/menu`)
        .set(auth())
        .set(idem())
        .send({ name: menuName, type: 'M', path: '/dup' })
        .expect(200);
      expect(res.body.code).toBe(500);
    });

    it('存在下级时禁止删除；删完下级后可删', async () => {
      const tree = await api().get(`${prefix}/menu/tree`).set(auth()).expect(200);
      const parent = (tree.body.data as Menu[]).find((m) => m.name === menuName);
      expect(parent).toBeDefined();
      const parentId = parent?.id ?? 0;

      // 还有子菜单 → 拒绝
      const blocked = await api()
        .delete(`${prefix}/menu/${parentId}`)
        .set(auth())
        .expect(200);
      expect(blocked.body.code).toBe(500);

      // 先删子菜单，再删目录
      await api().delete(`${prefix}/menu/${menuId}`).set(auth()).expect(200);
      const ok = await api()
        .delete(`${prefix}/menu/${parentId}`)
        .set(auth())
        .expect(200);
      expect(ok.body.code).toBe(200);
    });
  });

  describe('字典', () => {
    it('建类型 → 建数据 → options 返回启用项', async () => {
      const type = await api()
        .post(`${prefix}/dict/type`)
        .set(auth())
        .set(idem())
        .send({ dictName: 'e2e字典', dictType: dictTypeKey })
        .expect(200);
      expect(type.body.code).toBe(200);
      dictTypeId = type.body.data.id as number;

      await api()
        .post(`${prefix}/dict/data`)
        .set(auth())
        .set(idem())
        .send({
          dictType: dictTypeKey,
          dictLabel: '启用项',
          dictValue: '1',
          dictSort: 1,
          tagType: 'success',
        })
        .expect(200);
      await api()
        .post(`${prefix}/dict/data`)
        .set(auth())
        .set(idem())
        .send({
          dictType: dictTypeKey,
          dictLabel: '停用项',
          dictValue: '0',
          status: 0,
        })
        .expect(200);

      const options = await api()
        .get(`${prefix}/dict/options/${dictTypeKey}`)
        .set(auth())
        .expect(200);
      expect(options.body.data).toHaveLength(1);
      expect(options.body.data[0]).toMatchObject({
        label: '启用项',
        value: '1',
        tagType: 'success',
      });
    });

    it('重复类型标识 → 业务错误', async () => {
      const res = await api()
        .post(`${prefix}/dict/type`)
        .set(auth())
        .set(idem())
        .send({ dictName: '重复', dictType: dictTypeKey })
        .expect(200);
      expect(res.body.code).toBe(500);
    });

    it('删除类型级联删除字典数据', async () => {
      const res = await api()
        .delete(`${prefix}/dict/type/${dictTypeId}`)
        .set(auth())
        .expect(200);
      expect(res.body.code).toBe(200);

      const rest = await ds
        .getRepository(DictData)
        .count({ where: { dictType: dictTypeKey } });
      expect(rest).toBe(0);
    });
  });

  describe('参数', () => {
    it('建参数 → 按键取值', async () => {
      const created = await api()
        .post(`${prefix}/config`)
        .set(auth())
        .set(idem())
        .send({
          configName: 'e2e参数',
          configKey,
          configValue: 'v1',
          configType: 'N',
        })
        .expect(200);
      expect(created.body.code).toBe(200);
      configId = created.body.data.id as number;

      const value = await api()
        .get(`${prefix}/config/key/${configKey}`)
        .set(auth())
        .expect(200);
      expect(value.body.data).toMatchObject({ configKey, configValue: 'v1' });
    });

    it('系统内置参数不可删除', async () => {
      const created = await api()
        .post(`${prefix}/config`)
        .set(auth())
        .set(idem())
        .send({ configName: '内置', configKey: `${configKey}.sys`, configValue: 'x', configType: 'Y' })
        .expect(200);
      const res = await api()
        .delete(`${prefix}/config/${created.body.data.id as number}`)
        .set(auth())
        .expect(200);
      expect(res.body.code).toBe(500);
      await ds.getRepository(Config).delete({ configKey: `${configKey}.sys` });
    });

    it('DELETE 不再要求 Idempotency-Key（幂等键只约束 POST/PUT）', async () => {
      const res = await api()
        .delete(`${prefix}/config/${configId}`)
        .set(auth())
        .expect(200);
      expect(res.body.code).toBe(200);
    });
  });

  describe('日志', () => {
    it('登录成功与失败都写登录日志', async () => {
      await api()
        .post(`${prefix}/auth/login`)
        .send({ username: `${tag}_admin`, password: 'wrong-pass' })
        .expect(200);

      // 登录日志是**旁路写入**（不 await、不阻塞登录），因此这里要轮询等落库，
      // 不能写完就查 —— 否则是竞态（之前偶发失败）。
      let mine: LoginLog[] = [];
      for (let i = 0; i < 20; i++) {
        const res = await api()
          .get(`${prefix}/loginlog?pageNum=1&pageSize=100`)
          .set(auth())
          .expect(200);
        expect(res.body.code).toBe(200);
        mine = (res.body.data.list as LoginLog[]).filter(
          (r) => r.username === `${tag}_admin`,
        );
        if (
          mine.some((r) => r.status === 1) &&
          mine.some((r) => r.status === 0)
        ) {
          break;
        }
        await sleep(100);
      }
      expect(mine.some((r) => r.status === 1)).toBe(true);
      expect(mine.some((r) => r.status === 0)).toBe(true);
    });

    it('查询过滤参数容错：空串视为「未填」，不能 400 也不能静默误筛', async () => {
      // 回归：前端表单/下拉清空后会带出空串（`?username=`），
      // 曾经因为 `.optional()` 不放行 '' / `z.coerce.number()('') === 0` 出过两个 bug。
      const urls = [
        `${prefix}/loginlog?pageNum=1&pageSize=1&username=&status=`,
        `${prefix}/audit?pageNum=1&pageSize=1&actorName=&action=&result=&startTime=&endTime=`,
        `${prefix}/user?pageNum=1&pageSize=1&keyword=&status=&deptId=`,
        `${prefix}/role?pageNum=1&pageSize=1&keyword=&status=`,
        `${prefix}/dept?keyword=&status=`,
        `${prefix}/dept/tree?keyword=&status=`,
        `${prefix}/menu/tree?keyword=&status=`,
        `${prefix}/dict/type?pageNum=1&pageSize=1&keyword=&status=`,
        `${prefix}/dict/data?pageNum=1&pageSize=1&dictType=&keyword=&status=`,
        `${prefix}/config?pageNum=1&pageSize=1&keyword=&status=`,
      ];
      for (const url of urls) {
        const res = await api().get(url).set(auth()).expect(200);
        expect(res.body.code, `${url} 应接受空串过滤`).toBe(200);
      }

      // status= 不能被当成 status=0（静默误筛出「失败」记录）
      const noFilter = await api()
        .get(`${prefix}/loginlog?pageNum=1&pageSize=1`)
        .set(auth())
        .expect(200);
      const blankFilter = await api()
        .get(`${prefix}/loginlog?pageNum=1&pageSize=1&status=`)
        .set(auth())
        .expect(200);
      const zeroFilter = await api()
        .get(`${prefix}/loginlog?pageNum=1&pageSize=1&status=0`)
        .set(auth())
        .expect(200);
      expect(blankFilter.body.data.total).toBe(noFilter.body.data.total);
      expect(zeroFilter.body.data.total).toBeLessThanOrEqual(
        noFilter.body.data.total,
      );
    });

    it('操作日志可按动作与结果过滤', async () => {
      const res = await api()
        .get(`${prefix}/audit?pageNum=1&pageSize=5&result=success`)
        .set(auth())
        .expect(200);
      expect(res.body.code).toBe(200);
      expect(Array.isArray(res.body.data.list)).toBe(true);
      for (const row of res.body.data.list as Array<{ result: string }>) {
        expect(row.result).toBe('success');
      }
    });

    it('操作日志详情：不存在 → 404', async () => {
      await api().get(`${prefix}/audit/999999999`).set(auth()).expect(404);
    });
  });
});
