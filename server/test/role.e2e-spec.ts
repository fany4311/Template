import { INestApplication } from '@nestjs/common';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';

/**
 * 角色管理（通用管理域）e2e：需 MySQL + Redis。
 * 覆盖：超管 CRUD、无权限 403。
 */
describe('Role CRUD (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token = '';
  let limitedToken = '';
  let invalToken = '';
  /** 有持有人（adminUser）的角色：用于验证「已分配的角色不可删」 */
  let holderRoleId = 0;
  /** 会话失效用例的角色：它的权限会被改，持有人应被踢下线 */
  let invalRoleId = 0;

  const stamp = Date.now();
  // role_key 已废弃：测试数据改用 role_name 承载可搜索的标识（e2e_role_ / e2e_crud_）
  const adminRoleName = `e2e_role_admin_${stamp}`;
  const adminName = `e2e_role_admin_${stamp}`;
  const limitedName = `e2e_role_limited_${stamp}`;
  const invalRoleName = `e2e_role_inval_${stamp}`;
  const invalName = `e2e_role_inval_${stamp}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    const userRepo = ds.getRepository(User);
    const urRepo = ds.getRepository(UserRole);
    const adminRole = await createE2ERole(ds, {
      roleName: adminRoleName,
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
      urRepo.create({ userId: adminUser.id, roleId: adminRole.id, source: 'direct' }),
    );
    await userRepo.save(
      userRepo.create({
        username: limitedName,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    // 有持有人 —— 删除该角色应被拒（防止软删后"静默失权"）
    holderRoleId = adminRole.id;

    // 会话失效用例：角色权限可改，持有人用它登录
    const invalRole = await createE2ERole(ds, {
      roleName: invalRoleName,
      permissions: ['*:*:*'],
      status: 1,
    });
    invalRoleId = invalRole.id;
    const invalUser = await userRepo.save(
      userRepo.create({
        username: invalName,
        password: await hash('pass1234'),
        status: 1,
      }),
    );
    await urRepo.save(
      urRepo.create({
        userId: invalUser.id,
        roleId: invalRole.id,
        source: 'direct',
      }),
    );

    token = await login(adminName);
    limitedToken = await login(limitedName);
    invalToken = await login(invalName);
  });

  async function login(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password: 'pass1234' })
      .expect(200);
    return res.body.data.token as string;
  }

  afterAll(async () => {
    await ds
      .getRepository(IdempotencyRecord)
      .createQueryBuilder()
      .delete()
      .where('key LIKE :p', { p: 'system:role:add:%' })
      .execute();
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where('role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)', {
        p: 'e2e_role_%',
      })
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: 'e2e_role_%' })
      .execute();
    // 注意：CRUD 用例创建的角色名是 `e2e_crud_*`，而这里的后台账号角色是 `e2e_role_*`。
    // 应用层的删除是**软删**（delete_time），QueryBuilder 的 delete() 才是硬删，
    // 所以两类名称都要按硬删清理，否则每跑一次就留一批墓碑行。
    await ds
      .getRepository(Role)
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: 'e2e_role_%' })
      .execute();
    await ds
      .getRepository(Role)
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: 'e2e_crud_%' })
      .execute();
    await purgeE2ELogs(ds);
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const limitedAuth = () => ({ Authorization: `Bearer ${limitedToken}` });

  it('超管：创建 → 查询 → 更新 → 删除', async () => {
    const roleName = `e2e_crud_${stamp}`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/role')
      .set(auth())
      .set('Idempotency-Key', `role-create-${stamp}`)
      .send({
        roleName,
        permissions: ['system:user:list'],
        rules: [{ action: 'read', subject: 'User' }],
      })
      .expect(200);
    expect(created.body.code).toBe(200);
    expect(created.body.data.roleName).toBe(roleName);
    // 编号由**服务端**分配（MySQL 一表只能一个自增列，level 用不了 AUTO_INCREMENT）：
    // 内置占 0-4，自建必 >= 5
    expect(created.body.data.level).toBeGreaterThanOrEqual(5);
    // 自建角色不是内置角色
    expect(created.body.data.isBuiltin).toBe(0);
    expect(created.body.data.rules).toEqual([
      { action: 'read', subject: 'User' },
    ]);
    const id = created.body.data.id as number;

    const list = await request(app.getHttpServer())
      .get(`/api/v1/role?keyword=${roleName}`)
      .set(auth())
      .expect(200);
    expect(list.body.data.total).toBe(1);

    const updated = await request(app.getHttpServer())
      .put(`/api/v1/role/${id}`)
      .set(auth())
      .send({ roleName: '测试角色-改' })
      .expect(200);
    expect(updated.body.data.roleName).toBe('测试角色-改');

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/role/${id}`)
      .set(auth())
      .expect(200);
    expect(removed.body.data).toBe(true);
  });

  it('无权限用户：查询角色 → code 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/role')
      .set(limitedAuth())
      .expect(200);
    expect(res.body.code).toBe(403);
  });

  it('创建角色缺 Idempotency-Key → code 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/role')
      .set(auth())
      .send({ roleName: `e2e_nokey_${stamp}` })
      .expect(200);
    expect(res.body.code).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // 角色模型：内置标记 / 超管只读 / 删除保护 / 权限码格式 / 会话失效
  // ---------------------------------------------------------------------------

  const roleRepo = () => ds.getRepository(Role);
  const forLevel = (level: number) => roleRepo().findOneBy({ level });

  it('内置角色：level 0-4 都带 is_builtin=1，自建角色为 0', async () => {
    const builtins = await roleRepo().find({ where: { isBuiltin: 1 } });
    expect(builtins.map((r) => r.level).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4,
    ]);
  });

  it('超管：权限串是纯通配 *:*:*（不再混挂具体权限码）', async () => {
    const sa = await forLevel(0);
    expect(sa).toBeTruthy();
    expect(sa!.isBuiltin).toBe(1);
    // 决策 B：*:*:* 自动覆盖 console:access，所以不需要也不该再挂具体码
    expect(sa!.permissions).toEqual(['*:*:*']);
  });

  it('超管角色只读：改权限/数据范围/状态 → code 500，仅允许改名', async () => {
    const sa = await forLevel(0);
    for (const patch of [
      { permissions: [] },
      { dataScope: 'SELF' },
      { status: 0 },
    ]) {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/role/${sa!.id}`)
        .set(auth())
        .send(patch)
        .expect(200);
      expect(res.body.code, `应拒绝 ${JSON.stringify(patch)}`).toBe(500);
    }

    // 改名不影响能力，放行
    const ok = await request(app.getHttpServer())
      .put(`/api/v1/role/${sa!.id}`)
      .set(auth())
      .send({ roleName: sa!.roleName })
      .expect(200);
    expect(ok.body.code).toBe(200);
  });

  it('内置角色不可删：超管 → code 500', async () => {
    const sa = await forLevel(0);
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/role/${sa!.id}`)
      .set(auth())
      .expect(200);
    expect(res.body.code).toBe(500);
  });

  it('内置角色不可删：普通内置角色（部门管理员 level 2）也拦 → code 500', async () => {
    const role = await forLevel(2);
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/role/${role!.id}`)
      .set(auth())
      .expect(200);
    expect(res.body.code).toBe(500);
  });

  it('已分配给用户的角色不可删 → code 500（防「软删后静默失权」）', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/v1/role/${holderRoleId}`)
      .set(auth())
      .expect(200);
    expect(res.body.code).toBe(500);
  });

  it('权限码：通配符/否定前缀/大写/段数不对 → HTTP 400', async () => {
    const bad = [
      '*:*:*',
      '!system:*',
      'system:*',
      'System:Role:list',
      'nosep',
      'a:b:c:d',
      ' system:role:list',
    ];
    for (const [i, code] of bad.entries()) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/role')
        .set(auth())
        .set('Idempotency-Key', `role-bad-${stamp}-${i}`)
        .send({ roleName: `e2e_crud_bad_${stamp}_${i}`, permissions: [code] })
        .expect(400);
      expect(res.body.code, `应拒绝权限码「${code}」`).toBe(400);
    }
  });

  it('权限码：接受 2 段与 3 段小写标识符', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/role')
      .set(auth())
      .set('Idempotency-Key', `role-ok-${stamp}`)
      .send({
        roleName: `e2e_crud_ok_${stamp}`,
        permissions: ['console:access', 'system:role:list'],
      })
      .expect(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.permissions).toEqual([
      'console:access',
      'system:role:list',
    ]);
  });

  // 下面两条的先后顺序有意义：先证明「改名不踢人」，再让改权限把会话踢掉
  it('改角色名称不失效会话（展示字段不该踢人）', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/role/${invalRoleId}`)
      .set(auth())
      .send({ roleName: `${invalRoleName}-改名` })
      .expect(200);
    expect(res.body.code).toBe(200);

    const still = await request(app.getHttpServer())
      .get('/api/v1/role?pageSize=1')
      .set({ Authorization: `Bearer ${invalToken}` })
      .expect(200);
    expect(still.body.code).toBe(200);
  });

  it('改角色权限后，持有人的旧 token 立即失效 → code 401', async () => {
    const res = await request(app.getHttpServer())
      .put(`/api/v1/role/${invalRoleId}`)
      .set(auth())
      .send({ permissions: ['system:role:list'] })
      .expect(200);
    expect(res.body.code).toBe(200);

    const after = await request(app.getHttpServer())
      .get('/api/v1/role?pageSize=1')
      .set({ Authorization: `Bearer ${invalToken}` })
      .expect(200);
    expect(after.body.code).toBe(401);
  });
});
