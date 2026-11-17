import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';

/**
 * e2e 测试：覆盖模板核心机制（统一响应 / 公开接口 / 全局鉴权 / 登录校验）。
 * 前置条件：本地 MySQL + Redis 已启动（连接 .env.test 或 .env.dev 配置）。
 * 运行：pnpm test:e2e
 */
describe('NestTemplate (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('公开接口：/api/v1/hello 返回统一包装 {code:200,msg,data}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/hello')
      .expect(200);
    expect(res.body).toEqual({
      code: 200,
      msg: '操作成功',
      data: 'Hello World!',
    });
    // traceId 通过响应头透出
    expect(res.headers['x-trace-id']).toBeDefined();
  });

  it('公开接口：/api/v1/auth/captcha 返回验证码 {img, uuid}', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/captcha')
      .expect(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.uuid).toBeDefined();
    expect(res.body.data.img).toContain('<svg');
  });

  it('健康检查：/api/v1/health/live → status up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);
    expect(res.body.status).toBe('up');
  });

  it('全局鉴权：未登录访问 /api/v1/user → code 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/user')
      .expect(200);
    expect(res.body).toMatchObject({ code: 401, msg: '登录状态已过期' });
    expect(res.body.traceId).toBeDefined();
  });

  it('登录校验：错误密码 → code 500 + 提示', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'no-such-user', password: 'wrong' })
      .expect(200);
    expect(res.body.code).toBe(500);
    expect(res.body.msg).toBe('用户名或密码错误');
  });
});
