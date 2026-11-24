import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { InMemoryDisk, STORAGE_MODULE_OPTIONS } from '@nestjs/storage';
import request from 'supertest';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { purgeE2ELogs } from './utils/e2e-cleanup.js';
import { createE2ERole } from './utils/e2e-role.js';
import { FileEntity } from './../src/modules/file/entities/file.entity.js';
import { FileLink } from './../src/modules/file/entities/file-link.entity.js';
import { IdempotencyRecord } from './../src/modules/idempotency/entities/idempotency-record.entity.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';

/**
 * 文件与附件 e2e —— 覆盖底座的文件能力边界。
 *
 * 1. 收件安全：Magic Number（改名 exe 拦）、大小（413）、文本类不受客户端 MIME 影响
 * 2. 同用户秒传，跨用户不共享字节（每用户独立命名空间）
 * 3. 多态绑定：未注册 bizType fail-closed、重复绑定幂等、用途白名单
 * 4. 访问隔离：上传人 / 文件管理员 / 业务可见者三条通路，其余 404
 * 5. 回收：解绑回 TEMP、删除软删且无引用时删物理对象
 *
 * 存储用 `InMemoryDisk` 覆盖：不碰 MinIO，也不在真实 bucket 里留垃圾。
 */
describe('File 文件与附件 (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let disk: InMemoryDisk;

  const prefix = '/api/v1';
  const tag = `e2e_file_${Date.now()}`;

  /** 完整最小 PNG（8×8） */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
    'base64',
  );
  /** MZ 头：典型 Windows 可执行文件 */
  const MZ = Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    Buffer.alloc(256),
  ]);

  /** 本 spec 创建过的用户 id（清理文件行时用，避免留下孤儿元数据） */
  const createdUserIds: number[] = [];

  let mgr = ''; // 文件管理员（system:file:*）+ ALL
  let owner = ''; // 普通用户（上传人）
  let stranger = ''; // 无关用户（既非上传人、也无业务可见性）

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const idem = () => ({ 'Idempotency-Key': `${tag}-${Math.random()}` });

  async function login(username: string, password: string): Promise<string> {
    const res = await api()
      .post(`${prefix}/auth/login`)
      .send({ username, password });
    expect(res.body.code, `登录失败: ${username} ${res.body.msg}`).toBe(200);
    return res.body.data.token as string;
  }

  async function createUserWithRole(
    username: string,
    roleId: number,
    deptId: number,
  ): Promise<{ token: string; id: number }> {
    const userRepo = ds.getRepository(User);
    const user = await userRepo.save(
      userRepo.create({
        username,
        password: await hash('pass1234'),
        deptId,
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
    createdUserIds.push(user.id);
    return { token: await login(username, 'pass1234'), id: user.id };
  }

  /** 上传（默认 PNG） */
  function upload(
    token: string,
    buffer: Buffer,
    filename: string,
    fields: Record<string, string> = {},
  ) {
    const req = api()
      .post(`${prefix}/file`)
      .set(auth(token))
      .attach('file', buffer, filename);
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req;
  }

  beforeAll(async () => {
    disk = new InMemoryDisk();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // 用内存盘替掉配置里的 MinIO：e2e 不该依赖外部服务和真实 bucket
      .overrideProvider(STORAGE_MODULE_OPTIONS)
      .useValue({ default: 'default', disks: { default: disk } })
      .compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    // 文件管理员：系统域权限 + 全校数据范围（也就能通过 hazard 的可见性判定）
    const mgrRole = await createE2ERole(ds, {
      // role_key 已废弃：用 role_name 承载可搜索标识，清理时按名称前缀删
      roleName: `${tag}_文件管理员`,
      permissions: ['system:file:list', 'system:file:remove'],
      dataScope: 'ALL',
      status: 1,
    });
    mgr = (await createUserWithRole(`${tag}_mgr`, mgrRole.id, 28)).token;

    // 普通用户：无任何文件管理权限，数据范围只看自己（SELF）
    const userRole = await createE2ERole(ds, {
      roleName: `${tag}_普通用户`,
      permissions: ['hazard:report:list'],
      dataScope: 'SELF',
      status: 1,
    });
    owner = (await createUserWithRole(`${tag}_owner`, userRole.id, 31)).token;

    const strangerUser = await createUserWithRole(
      `${tag}_stranger`,
      userRole.id,
      30,
    );
    stranger = strangerUser.token;
  });

  afterAll(async () => {
    // 双条件清理：文件名前缀（兜底）+ 本 spec 创建的用户 id（必中）。
    // 只按 uploader_id 删不够稳妥 —— 重复运行会留下"同内容不同 uploader"的残行，
    // 那些残行会让同 objectKey 一直被引用（同一用户的秒传记录），回收用例就看不到物理删除。
    const mine = await ds
      .getRepository(FileEntity)
      .createQueryBuilder('f')
      .withDeleted()
      .select('f.id', 'id')
      .where('f.original_name LIKE :p', { p: `${tag}%` })
      .orWhere('f.uploader_id IN (:...uids)', { uids: createdUserIds })
      .getRawMany<{ id: number }>();
    if (mine.length) {
      const ids = mine.map((r) => Number(r.id));
      await ds.getRepository(FileLink).delete({ fileId: In(ids) });
      await ds.getRepository(FileEntity).delete({ id: In(ids) });
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
    await ds.getRepository(User).delete({
      username: In([`${tag}_mgr`, `${tag}_owner`, `${tag}_stranger`]),
    });
    await ds
      .getRepository(Role)
      .delete({ roleName: In([`${tag}_文件管理员`, `${tag}_普通用户`]) });
    await purgeE2ELogs(ds);
    await app.close();
  });

  describe('收件安全', () => {
    it('真 PNG 通过，MIME 由服务端判定', async () => {
      const res = await upload(owner, PNG, `${tag}-photo.png`).expect(200);
      expect(res.body.code).toBe(200);
      expect(res.body.data.file.mime).toBe('image/png');
      expect(res.body.data.file.ext).toBe('png');
      expect(res.body.data.file.status).toBe('TEMP');
      expect(res.body.data.deduped).toBe(false);
      // 内部字段不得外泄
      expect(res.body.data.file).not.toHaveProperty('objectKey');
      expect(res.body.data.file).not.toHaveProperty('sha256');
    });

    it('同内容再次上传命中秒传', async () => {
      const first = await upload(owner, PNG, `${tag}-a.png`).expect(200);
      const second = await upload(owner, PNG, `${tag}-b.png`).expect(200);
      expect(second.body.data.deduped).toBe(true);
      expect(second.body.data.file.id).toBe(first.body.data.file.id);
    });

    it('改名成 .jpg 的 exe 被拒（Magic Number）', async () => {
      const res = await upload(owner, MZ, `${tag}-evil.jpg`).expect(400);
      expect(res.body.code).toBe(400);
    });

    it('超过 10MB 返回 413（multer 提前拦，不落盘）', async () => {
      const big = Buffer.concat([PNG, Buffer.alloc(11 * 1024 * 1024)]);
      const res = await upload(owner, big, `${tag}-big.png`).expect(413);
      expect(res.body.code).toBe(413);
    });

    it('CSV 不看客户端 MIME，按内容规范化成 text/csv', async () => {
      const res = await upload(
        owner,
        Buffer.from('sku,name\n1,foo\n'),
        `${tag}-data.csv`,
      ).expect(200);
      expect(res.body.data.file.mime).toBe('text/csv');
    });

    it('脚本改名 .txt 被内容特征拦下', async () => {
      const res = await upload(
        owner,
        Buffer.from('#!/bin/sh\nrm -rf /\n'),
        `${tag}-x.txt`,
      ).expect(400);
      expect(res.body.code).toBe(400);
    });

    it('空请求体报错而不是写一条空记录', async () => {
      const res = await api()
        .post(`${prefix}/file`)
        .set(auth(owner))
        .expect(400);
      expect(res.body.code).toBe(400);
    });
  });

  describe('多态绑定', () => {
    let fileId = 0;

    beforeAll(async () => {
      const res = await upload(owner, PNG, `${tag}-bind.png`).expect(200);
      fileId = res.body.data.file.id;
    });

    it('未注册 bizType fail-closed', async () => {
      const res = await api()
        .post(`${prefix}/file/bind`)
        .set(auth(owner))
        .set(idem())
        .send({ fileIds: [fileId], bizType: 'nope', bizId: '1' })
        .expect(200);
      // 业务异常按项目约定是 HTTP 200 + body.code
      expect(res.body.code).toBe(403);
    });

    it('绑定到隐患单，重复绑定幂等', async () => {
      const first = await api()
        .post(`${prefix}/file/bind`)
        .set(auth(mgr))
        .set(idem())
        .send({
          fileIds: [fileId],
          bizType: 'hazard',
          bizId: '1',
          bizField: 'reportPhoto',
        })
        .expect(200);
      expect(first.body.data.bound).toBe(1);

      const again = await api()
        .post(`${prefix}/file/bind`)
        .set(auth(mgr))
        .set(idem())
        .send({
          fileIds: [fileId],
          bizType: 'hazard',
          bizId: '1',
          bizField: 'reportPhoto',
        })
        .expect(200);
      expect(again.body.data.bound).toBe(0);
      expect(again.body.data.skipped).toBe(1);
    });

    it('业务不允许的附件用途被拒', async () => {
      const res = await api()
        .post(`${prefix}/file/bind`)
        .set(auth(mgr))
        .set(idem())
        .send({
          fileIds: [fileId],
          bizType: 'hazard',
          bizId: '1',
          bizField: 'evilField',
        })
        .expect(200);
      expect(res.body.code).toBe(500);
    });

    it('绑定后状态变 ACTIVE，引用计数 +1', async () => {
      const res = await api()
        .get(`${prefix}/file/${fileId}`)
        .set(auth(mgr))
        .expect(200);
      expect(res.body.data.file.status).toBe('ACTIVE');
      expect(res.body.data.file.refCount).toBe(1);
      expect(res.body.data.links).toHaveLength(1);
    });

    it('业务附件列表：可见者能查，不可见者 403', async () => {
      const ok = await api()
        .get(`${prefix}/file/biz/hazard/1`)
        .set(auth(mgr))
        .expect(200);
      expect(ok.body.data.length).toBeGreaterThan(0);

      const denied = await api()
        .get(`${prefix}/file/biz/hazard/1`)
        .set(auth(stranger))
        .expect(200);
      expect(denied.body.code).toBe(403);
    });

    it('解绑后引用归零、回到 TEMP', async () => {
      const res = await api()
        .post(`${prefix}/file/unbind`)
        .set(auth(mgr))
        .set(idem())
        .send({
          fileIds: [fileId],
          bizType: 'hazard',
          bizId: '1',
          bizField: 'reportPhoto',
        })
        .expect(200);
      expect(res.body.data.unbound).toBe(1);

      const after = await api()
        .get(`${prefix}/file/${fileId}`)
        .set(auth(mgr))
        .expect(200);
      expect(after.body.data.file.status).toBe('TEMP');
      expect(after.body.data.file.refCount).toBe(0);
      expect(after.body.data.links).toHaveLength(0);
    });
  });

  describe('访问隔离', () => {
    let fileId = 0;

    beforeAll(async () => {
      const res = await upload(owner, PNG, `${tag}-secret.png`).expect(200);
      fileId = res.body.data.file.id;
    });

    it('上传人可下载，内容一致', async () => {
      const res = await api()
        .get(`${prefix}/file/${fileId}/download`)
        .set(auth(owner))
        .expect(200);
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(Buffer.compare(res.body, PNG)).toBe(0);
    });

    it('文件管理员可下载（system:file:list 通路）', async () => {
      await api()
        .get(`${prefix}/file/${fileId}/download`)
        .set(auth(mgr))
        .expect(200);
    });

    it('无关用户得到 404 而不是 403（不泄漏文件是否存在）', async () => {
      const res = await api()
        .get(`${prefix}/file/${fileId}/download`)
        .set(auth(stranger))
        .expect(404);
      expect(res.body.code).toBe(404);

      const detail = await api()
        .get(`${prefix}/file/${fileId}`)
        .set(auth(stranger))
        .expect(404);
      expect(detail.body.code).toBe(404);
    });

    it('普通用户不能查文件总览（无 system:file:list）', async () => {
      const res = await api()
        .get(`${prefix}/file`)
        .set(auth(owner))
        .expect(200);
      expect(res.body.code).toBe(403);
    });

    it('文件管理员能查总览，空串过滤不影响 total', async () => {
      const plain = await api()
        .get(`${prefix}/file?pageNum=1&pageSize=10`)
        .set(auth(mgr))
        .expect(200);
      const blank = await api()
        .get(
          `${prefix}/file?pageNum=1&pageSize=10&keyword=&ext=&status=&uploaderId=`,
        )
        .set(auth(mgr))
        .expect(200);
      expect(blank.body.data.total).toBe(plain.body.data.total);
    });

    it('普通用户不能删除别人的文件', async () => {
      const res = await api()
        .delete(`${prefix}/file/${fileId}`)
        .set(auth(stranger))
        .expect(200);
      expect(res.body.code).toBe(403);
    });
  });

  describe('回收', () => {
    it('删除后详情 404，且物理对象被移除', async () => {
      // 必须用唯一内容：objectKey 含 uploaderId，跨用户不再共享字节，
      // 但同一用户重复上传同内容会复用同一条记录 —— 复用记录就不会真删物理对象
      const unique = Buffer.concat([PNG, Buffer.from(`unique-${Date.now()}`)]);
      const up = await upload(owner, unique, `${tag}-to-delete.png`).expect(
        200,
      );
      const fileId = up.body.data.file.id as number;

      // 找一下对象键（只在测试里读内部字段，用于验证物理删除）
      const entity = await ds
        .getRepository(FileEntity)
        .findOneByOrFail({ id: fileId });
      expect(await disk.exists(entity.objectKey)).toBe(true);

      await api()
        .delete(`${prefix}/file/${fileId}`)
        .set(auth(owner))
        .expect(200);
      await api().get(`${prefix}/file/${fileId}`).set(auth(owner)).expect(404);

      expect(await disk.exists(entity.objectKey)).toBe(false);
    });
  });
});
