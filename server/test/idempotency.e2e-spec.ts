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
 * 幂等（集成）：需 MySQL + Redis。
 * 覆盖：缺键 400、同键同内容回放且只落一次、同键不同内容 409。
 */
describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token = '';

  const stamp = Date.now();
  const adminName = `idem_admin_${stamp}`;
  // role_key 已废弃：测试数据用 role_name 承载可搜索标识（idem_ 前缀）
  const roleName = `idem_role_${stamp}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    const userRepo = ds.getRepository(User);
    const role = await createE2ERole(ds, {
      roleName,
      permissions: ['*:*:*'],
      status: 1,
    });
    await userRepo.save(
      userRepo.create({
        username: adminName,
        password: await hash('pass1234'),
        nickname: 't',
        status: 1,
      }),
    );
    const adminUser = await userRepo.findOneByOrFail({ username: adminName });
    const urRepo = ds.getRepository(UserRole);
    await urRepo.save(
      urRepo.create({
        userId: adminUser.id,
        roleId: role.id,
        source: 'direct',
      }),
    );

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: adminName, password: 'pass1234' })
      .expect(200);
    token = login.body.data.token;
    expect(token).toBeTruthy();
  });

  afterAll(async () => {
    await ds
      .getRepository(IdempotencyRecord)
      .createQueryBuilder()
      .delete()
      .where('key LIKE :p', { p: 'system:user:add:%' })
      .execute();
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where('role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)', {
        p: 'idem_%',
      })
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: 'idem_%' })
      .execute();
    await ds
      .getRepository(Role)
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: 'idem_%' })
      .execute();
    await purgeE2ELogs(ds);
    await app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('缺少 Idempotency-Key → code 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/user')
      .set(auth())
      .send({ username: `idem_nokey_${stamp}`, password: 'x1234567' })
      .expect(200);
    expect(res.body.code).toBe(400);
  });

  it('同 key 同内容重复提交 → 回放响应，仅创建一次', async () => {
    const target = `idem_target_${stamp}`;
    const payload = { username: target, password: 'x1234567' };
    const key = `key-same-${stamp}`;

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/user')
      .set(auth())
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/user')
      .set(auth())
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(200);

    expect(r1.body.code).toBe(200);
    expect(r2.body).toEqual(r1.body);
    // 创建返回值不得包含密码哈希
    expect(r1.body.data.password).toBeUndefined();

    const count = await ds.getRepository(User).countBy({ username: target });
    expect(count).toBe(1);
  });

  it('同 key 不同内容 → code 409', async () => {
    const key = `key-conflict-${stamp}`;
    await request(app.getHttpServer())
      .post('/api/v1/user')
      .set(auth())
      .set('Idempotency-Key', key)
      .send({ username: `idem_c1_${stamp}`, password: 'x1234567' })
      .expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/v1/user')
      .set(auth())
      .set('Idempotency-Key', key)
      .send({ username: `idem_c2_${stamp}`, password: 'x1234567' })
      .expect(200);
    expect(res.body.code).toBe(409);
  });
});
