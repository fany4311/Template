import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';
import { createE2ERole } from './utils/e2e-role.js';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';

/**
 * 改密 / 重置密码 e2e。
 *
 * 覆盖的不只是「能改」：
 * - 原密码校验（防"登录着就能改"→公共电脑直接送号）
 * - 改密后**旧 token 立即失效**（否则「怀疑泄露才改密」这个动机就落空了）
 * - 新旧密码相同 / 过短被拒
 * - 重置他人密码需要 `system:user:reset-pwd`（普通账号 403）
 */
describe('Password (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const P = 'e2e_pwd_';
  const stamp = Date.now();

  const adminName = `${P}admin_${stamp}`;
  const limitedName = `${P}limited_${stamp}`;
  const victimName = `${P}victim_${stamp}`;
  const SELF_PWD = 'Self@12345';
  const NEW_PWD = 'Changed@12345';

  let adminToken = '';
  let limitedToken = '';
  let victimId = 0;
  let selfUserId = 0;

  const api = () => request(app.getHttpServer());
  const prefix = '/api/v1';

  async function login(username: string, password: string) {
    const res = await api()
      .post(`${prefix}/auth/login`)
      .send({ username, password });
    return res;
  }

  async function createUser(username: string, password: string) {
    const repo = ds.getRepository(User);
    return repo.save(
      repo.create({
        username,
        password: await hash(password),
        status: 1,
      }),
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    // 全权角色（超管语义）
    const adminRole = await createE2ERole(ds, {
      roleName: `${P}role_admin`,
      permissions: ['*:*:*'],
      status: 1,
    });
    // 只有列表权，没有 reset-pwd
    const limitedRole = await createE2ERole(ds, {
      roleName: `${P}role_limited`,
      permissions: ['system:user:list'],
      status: 1,
    });

    const admin = await createUser(adminName, 'Admin@12345');
    selfUserId = admin.id;
    await ds.getRepository(UserRole).save({
      userId: admin.id,
      roleId: adminRole.id,
      source: 'direct',
    });

    const limited = await createUser(limitedName, 'Limited@12345');
    await ds.getRepository(UserRole).save({
      userId: limited.id,
      roleId: limitedRole.id,
      source: 'direct',
    });

    const victim = await createUser(victimName, SELF_PWD);
    victimId = victim.id;

    adminToken = (await login(adminName, 'Admin@12345')).body.data.token;
    limitedToken = (await login(limitedName, 'Limited@12345')).body.data.token;
  });

  afterAll(async () => {
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where('user_id IN (SELECT id FROM sys_user WHERE username LIKE :p)', {
        p: `${P}%`,
      })
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: `${P}%` })
      .execute();
    await ds.query('DELETE FROM sys_role WHERE role_name LIKE ?', [`${P}%`]);
    await purgeE2ELogs(ds);
    await app.close();
  });

  describe('自助改密 POST /auth/password', () => {
    it('原密码错误 → 业务码失败，且密码不变', async () => {
      const token = (await login(victimName, SELF_PWD)).body.data.token;
      const res = await api()
        .post(`${prefix}/auth/password`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ oldPassword: 'WrongOld@123', newPassword: NEW_PWD })
        .expect(200);
      expect(res.body.code).not.toBe(200);
      expect(res.body.msg).toContain('原密码');

      // 旧密码仍可登录，说明没被误改
      expect((await login(victimName, SELF_PWD)).body.code).toBe(200);
    });

    it('新密码过短 → 400 参数校验失败', async () => {
      const token = (await login(victimName, SELF_PWD)).body.data.token;
      const res = await api()
        .post(`${prefix}/auth/password`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ oldPassword: SELF_PWD, newPassword: 'short' })
        .expect(400);
      expect(res.body.code).toBe(400);
    });

    it('新密码与原密码相同 → 拒绝', async () => {
      const token = (await login(victimName, SELF_PWD)).body.data.token;
      const res = await api()
        .post(`${prefix}/auth/password`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ oldPassword: SELF_PWD, newPassword: SELF_PWD })
        .expect(400);
      expect(res.body.code).toBe(400);
    });

    it('改密成功 → 旧 token 立即失效，新密码可登录', async () => {
      const token = (await login(victimName, SELF_PWD)).body.data.token;

      const res = await api()
        .post(`${prefix}/auth/password`)
        .set({ Authorization: `Bearer ${token}` })
        .send({ oldPassword: SELF_PWD, newPassword: NEW_PWD })
        .expect(200);
      expect(res.body.code).toBe(200);

      // 旧 token 失效（改密动机是「怀疑泄露」，旧会话必须断）
      const stale = await api()
        .get(`${prefix}/auth/profile`)
        .set({ Authorization: `Bearer ${token}` })
        .expect(200);
      expect(stale.body.code).toBe(401);

      // 旧密码不再可用，新密码可用
      expect((await login(victimName, SELF_PWD)).body.code).not.toBe(200);
      expect((await login(victimName, NEW_PWD)).body.code).toBe(200);
    });

    it('改密后审计留痕（action=auth:password）', async () => {
      const rows: Array<{ c: number }> = await ds.query(
        `SELECT COUNT(*) AS c FROM sys_audit_log WHERE action = 'auth:password' AND actor_name = ?`,
        [victimName],
      );
      expect(Number(rows[0]?.c ?? 0)).toBeGreaterThan(0);
    });
  });

  describe('管理员重置 PUT /user/:id/password', () => {
    const RESET_PWD = 'Reset@12345';

    it('无 system:user:reset-pwd 的账号 → 403', async () => {
      const res = await api()
        .put(`${prefix}/user/${victimId}/password`)
        .set({ Authorization: `Bearer ${limitedToken}` })
        .send({ newPassword: RESET_PWD })
        .expect(200);
      expect(res.body.code).toBe(403);
    });

    it('超管重置他人密码 → 目标旧 token 失效、新密码可登录', async () => {
      // 目标先登录，拿一个「重置前」的 token
      const victimToken = (await login(victimName, NEW_PWD)).body.data.token;

      const res = await api()
        .put(`${prefix}/user/${victimId}/password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ newPassword: RESET_PWD })
        .expect(200);
      expect(res.body.code).toBe(200);

      const stale = await api()
        .get(`${prefix}/auth/profile`)
        .set({ Authorization: `Bearer ${victimToken}` })
        .expect(200);
      expect(stale.body.code).toBe(401);

      expect((await login(victimName, NEW_PWD)).body.code).not.toBe(200);
      expect((await login(victimName, RESET_PWD)).body.code).toBe(200);
    });

    it('重置自己不会把自己踢出登录以外地出问题（自重置后仍可用新密码登录）', async () => {
      const res = await api()
        .put(`${prefix}/user/${selfUserId}/password`)
        .set({ Authorization: `Bearer ${adminToken}` })
        .send({ newPassword: 'Admin@54321' })
        .expect(200);
      expect(res.body.code).toBe(200);
      // 自己的会话同样失效：重新登录
      adminToken = (await login(adminName, 'Admin@54321')).body.data.token;
      expect(adminToken).toBeTruthy();
    });
  });
});
