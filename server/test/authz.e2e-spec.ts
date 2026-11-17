import { INestApplication } from '@nestjs/common';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { Dept } from './../src/modules/dept/entities/dept.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';

/**
 * 部门 + 授权（临时授权/回收）+ 数据范围（dataScope）e2e：需 MySQL + Redis。
 */
describe('Dept & Authorization & DataScope (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken = '';
  let stamp = 0;

  let rootDeptId = 0;
  let childDeptId = 0;
  let grandDeptId = 0;

  // role_key 已废弃：测试数据用 role_name 承载可搜索标识（e2e_authz_ 前缀），
  // 清理时按 role_name LIKE 'e2e_authz_%' 硬删。
  const deptRoleName = `e2e_authz_dept_${Date.now()}`;
  const scopedRoleName = `e2e_authz_scoped_${Date.now()}`;
  const adminName = `e2e_authz_admin_${Date.now()}`;
  const childUserName = `e2e_authz_child_${Date.now()}`;
  const grandUserName = `e2e_authz_grand_${Date.now()}`;
  const rootUserName = `e2e_authz_root_${Date.now()}`;

  let scopedRoleId = 0;
  let childUserId = 0;
  let grandUserId = 0;
  let rootUserId = 0;

  const api = () => request(app.getHttpServer());
  const prefix = '/api/v1';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);
    stamp = Date.now();

    // 管理员（全权）
    const userRepo = ds.getRepository(User);
    const urRepo = ds.getRepository(UserRole);

    const adminRole = await createE2ERole(ds, {
      roleName: `e2e_authz_admin_${stamp}`,
      permissions: ['*:*:*'],
      status: 1,
    });
    const adminUser = await userRepo.save(
      userRepo.create({
        username: adminName,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({
        userId: adminUser.id,
        roleId: adminRole.id,
        source: 'direct',
      }),
    );

    adminToken = await login(adminName);

    // 部门树：root → child → grand
    const grandParentName = `e2e_authz_root_${stamp}`;
    rootDeptId = (await createDept({ name: grandParentName })).id;
    childDeptId = (await createDept({ name: `e2e_authz_child_${stamp}`, parentId: rootDeptId })).id;
    grandDeptId = (await createDept({ name: `e2e_authz_grand_${stamp}`, parentId: childDeptId })).id;
    // 部门角色（只给 dept 列表权限，验证 system:dept:* 通配）
    const deptRole = await createE2ERole(ds, {
      roleName: deptRoleName,
      permissions: ['system:dept:*'],
      status: 1,
    });
    const deptUser = await userRepo.save(
      userRepo.create({
        username: `e2e_authz_deptuser_${stamp}`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({ userId: deptUser.id, roleId: deptRole.id, source: 'direct' }),
    );

    // 业务角色：dataScope = 本部门及以下
    scopedRoleId = (
      await createE2ERole(ds, {
        roleName: scopedRoleName,
        permissions: ['system:user:list'],
        rules: [{ action: 'read', subject: 'User' }],
        dataScope: 'DEPT_AND_CHILD',
        status: 1,
      })
    ).id;

    // 业务全权但禁系统域（deny 优先）
    const denyRole = await createE2ERole(ds, {
      roleName: `e2e_authz_deny_${stamp}`,
      permissions: ['*:*:*', '!system:*'],
      status: 1,
    });
    const denyUser = await userRepo.save(
      userRepo.create({
        username: `e2e_authz_deny_${stamp}`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({ userId: denyUser.id, roleId: denyRole.id, source: 'direct' }),
    );

    // 只持系统域权限（system:*）：验证 system 域可进
    const sysRole = await createE2ERole(ds, {
      roleName: `e2e_authz_sys_${stamp}`,
      permissions: ['system:*'],
      dataScope: 'ALL',
      status: 1,
    });
    const sysUser = await userRepo.save(
      userRepo.create({
        username: `e2e_authz_sys_${stamp}`,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({ userId: sysUser.id, roleId: sysRole.id, source: 'direct' }),
    );

    childUserId = await createUser(childUserName, childDeptId);
    grandUserId = await createUser(grandUserName, grandDeptId);
    rootUserId = await createUser(rootUserName, rootDeptId);
  });

  async function login(username: string): Promise<string> {
    const res = await api()
      .post(`${prefix}/auth/login`)
      .send({ username, password: 'pass1234' })
      .expect(200);
    return res.body.data.token as string;
  }

  const adminAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function createDept(body: Record<string, unknown>) {
    const res = await api()
      .post(`${prefix}/dept`)
      .set(adminAuth())
      .set('Idempotency-Key', `dept-${stamp}-${Math.random()}`)
      .send(body)
      .expect(200);
    expect(res.body.code).toBe(200);
    return res.body.data as Dept;
  }

  async function createUser(username: string, deptId: number) {
    const res = await api()
      .post(`${prefix}/user`)
      .set(adminAuth())
      .set('Idempotency-Key', `user-${username}`)
      .send({ username, password: 'pass1234', deptId })
      .expect(200);
    expect(res.body.code).toBe(200);
    return res.body.data.id as number;
  }

  async function grant(userId: number, roleIds: number[], expireAt?: string) {
    const res = await api()
      .post(`${prefix}/user/${userId}/roles`)
      .set(adminAuth())
      .send(expireAt ? { roleIds, expireAt } : { roleIds })
      .expect(200);
    expect(res.body.code).toBe(200);
  }

  afterAll(async () => {
    await ds
      .getRepository(IdempotencyRecord)
      .createQueryBuilder()
      .delete()
      .where('key LIKE :p', { p: '%e2e_authz%' })
      .execute();
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where(
        'user_id IN (SELECT id FROM sys_user WHERE username LIKE :p) OR role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)',
        { p: 'e2e_authz_%' },
      )
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: 'e2e_authz_%' })
      .execute();
    await ds
      .getRepository(Role)
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: 'e2e_authz_%' })
      .execute();
    await ds
      .getRepository(Dept)
      .createQueryBuilder()
      .delete()
      .where('name LIKE :p', { p: 'e2e_authz_%' })
      .execute();
    await purgeE2ELogs(ds);
    await app.close();
  });

  it('部门树：创建后 tree 返回嵌套结构', async () => {
    const flat = await api()
      .get(`${prefix}/dept`)
      .set(adminAuth())
      .expect(200);
    const all = flat.body.data as Dept[];
    expect(all.find((d) => d.id === rootDeptId)).toBeDefined();
    expect(all.find((d) => d.id === childDeptId)?.parentId).toBe(rootDeptId);
    expect(all.find((d) => d.id === grandDeptId)?.parentId).toBe(childDeptId);

    const res = await api()
      .get(`${prefix}/dept/tree`)
      .set(adminAuth())
      .expect(200);
    const roots = res.body.data as Array<Dept & { children: Dept[] }>;
    const rootNode = roots.find((d) => d.id === rootDeptId);
    expect(rootNode).toBeDefined();
    expect(rootNode?.children.map((c) => c.id)).toContain(childDeptId);
  });

  it('删除有下级的部门 → 业务错误', async () => {
    const res = await api()
      .delete(`${prefix}/dept/${rootDeptId}`)
      .set(adminAuth())
      .expect(200);
    expect(res.body.code).not.toBe(200);
  });

  it('权限通配：system:dept:* 可访问 dept 列表', async () => {
    const token = await login(`e2e_authz_deptuser_${stamp}`);
    const res = await api()
      .get(`${prefix}/dept`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(200);
  });

  it('deny 优先：业务全权但 !system:* → 系统域 403', async () => {
    const token = await login(`e2e_authz_deny_${stamp}`);
    const res = await api()
      .get(`${prefix}/dept`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(403);
  });

  it('只持 system:* 的角色（非超管）可进入系统域', async () => {
    const token = await login(`e2e_authz_sys_${stamp}`);
    const res = await api()
      .get(`${prefix}/dept`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(200);
  });

  it('dataScope=DEPT_AND_CHILD：只见本部门及子部门用户', async () => {
    await grant(childUserId, [scopedRoleId]);
    const token = await login(childUserName);
    const res = await api()
      .get(`${prefix}/user?pageSize=100`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(200);
    const ids = (res.body.data.list as User[]).map((u) => u.id);
    expect(ids).toContain(childUserId);
    expect(ids).toContain(grandUserId);
    expect(ids).not.toContain(rootUserId);
  });

  it('临时授权已过期：登录后无有效角色 → 403', async () => {
    await grant(grandUserId, [scopedRoleId], new Date(Date.now() - 60_000).toISOString());
    const token = await login(grandUserName);
    const res = await api()
      .get(`${prefix}/user`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(403);
  });

  it('临时授权未到期：可访问', async () => {
    await grant(grandUserId, [scopedRoleId], new Date(Date.now() + 3_600_000).toISOString());
    const token = await login(grandUserName);
    const res = await api()
      .get(`${prefix}/user?pageSize=100`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(200);
  });

  it('撤销授权：旧 token 立即失效 → 401', async () => {
    await grant(childUserId, [scopedRoleId]);
    const token = await login(childUserName);
    await api()
      .delete(`${prefix}/user/${childUserId}/roles/${scopedRoleId}`)
      .set(adminAuth())
      .expect(200);
    const res = await api()
      .get(`${prefix}/user`)
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(res.body.code).toBe(401);
  });
});
