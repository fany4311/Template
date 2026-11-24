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
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { User } from './../src/modules/user/entities/user.entity.js';

/**
 * 部门树 e2e：ancestors 级联重写 + 「移到顶级」。
 *
 * 覆盖两个真实缺陷：
 * - **P1-7**：重写子孙 ancestors 时用 `LIKE '${oldPrefix}%'` 而**没有逗号边界**，
 *   id=96 的 oldPrefix `0,96` 会匹配到 `0,96000`（另一个枝条）→ 一次挪部门
 *   静默改坏兄弟子树，进而让数据范围（按 ancestors 求子树）跟着错。
 *   测试用裸 SQL 造出这个精确碰撞（真实树里就有：id=1 与 id=10' 的经典情形）。
 * - **P2-6**：`PUT /dept/:id` 传 `parentId: null` / `0` 应能把部门搬回顶级。
 */
describe('Dept tree (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken = '';
  let stamp = 0;

  const P = 'e2e_depttree_';
  /** 人造碰撞行的 parent_id：指向一个不存在的部门（sys_dept 无外键） */
  const DECOY_DANGLING_PARENT = 1_000_000_000;
  let topId = 0;
  let targetRootId = 0;
  let movedId = 0;
  let childId = 0;
  let decoyVictimId = 0;

  const api = () => request(app.getHttpServer());
  const prefix = '/api/v1';
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function createDept(body: Record<string, unknown>): Promise<Dept> {
    const res = await api()
      .post(`${prefix}/dept`)
      .set(auth())
      .set('Idempotency-Key', `${P}${stamp}-${Math.random()}`)
      .send(body)
      .expect(200);
    expect(res.body.code).toBe(200);
    return res.body.data as Dept;
  }

  async function ancestorsOf(id: number): Promise<string> {
    const row = await ds
      .getRepository(Dept)
      .createQueryBuilder('d')
      .select('d.ancestors', 'ancestors')
      .where('d.id = :id', { id })
      .getRawOne<{ ancestors: string }>();
    return row?.ancestors ?? '';
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
    const adminRole = await createE2ERole(ds, {
      roleName: `${P}admin_${stamp}`,
      permissions: ['*:*:*'],
      status: 1,
    });
    const adminUser = await userRepo.save(
      userRepo.create({
        username: `${P}admin_${stamp}`,
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
    const loginRes = await api()
      .post(`${prefix}/auth/login`)
      .send({ username: `${P}admin_${stamp}`, password: 'pass1234' })
      .expect(200);
    adminToken = loginRes.body.data.token as string;

    // 树：topRoot ─┬─ targetRoot
    //             └─ moved ─ child
    topId = (await createDept({ name: `${P}top`, parentId: null })).id;
    targetRootId = (await createDept({ name: `${P}target`, parentId: topId }))
      .id;
    const moved = await createDept({ name: `${P}moved`, parentId: topId });
    movedId = moved.id;
    childId = (await createDept({ name: `${P}child`, parentId: movedId })).id;
    expect(await ancestorsOf(childId)).toBe(`0,${topId},${movedId}`);

    // 造碰撞：老实现用 `LIKE '0,A,B%'`（没有逗号边界），会把 ancestors 以
    // `0,A,B` 开头、但其实属于「id 以 B 开头的**兄弟**节点」的子孙一起改掉。
    // 真实树里就是经典的 «id=1 与 id=10» 情形（B=96 → 兄弟 960）。
    //
    // 这里插一行**人造**数据把同一个比较分支触发出来：它的 ancestors 写成那个
    // 形状即可（parent_id 故意指向一个不存在的 id —— sys_dept 无外键约束，
    // 且本行只在本次用例内存在，afterAll 按名字清掉）。不手工指定自增 id，
    // 以免把 AUTO_INCREMENT 推大污染测试库。
    const inserted = await ds.query(
      `INSERT INTO sys_dept (parent_id, name, ancestors, sort, status)
       VALUES (?, ?, ?, 0, 1)`,
      [DECOY_DANGLING_PARENT, `${P}decoy_victim`, `0,${topId},${movedId}0`],
    );
    decoyVictimId = Number(inserted.insertId);
    expect(await ancestorsOf(decoyVictimId)).toBe(`0,${topId},${movedId}0`);
  });

  afterAll(async () => {
    await ds
      .getRepository(Dept)
      .createQueryBuilder()
      .delete()
      .where('name LIKE :p', { p: `${P}%` })
      .execute();
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where('role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)', {
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

  it('移动部门：真子孙被级联重写，兄弟子树不受影响（P1-7）', async () => {
    const res = await api()
      .put(`${prefix}/dept/${movedId}`)
      .set(auth())
      .send({ parentId: targetRootId })
      .expect(200);
    expect(res.body.code).toBe(200);

    // 自身与真子孙都换到新前缀
    expect(await ancestorsOf(movedId)).toBe(`0,${topId},${targetRootId}`);
    expect(await ancestorsOf(childId)).toBe(
      `0,${topId},${targetRootId},${movedId}`,
    );
    // 兄弟子树必须原样不动（老实现会把它改成 `0,<top>,<target>,<moved>0`）
    expect(await ancestorsOf(decoyVictimId)).toBe(`0,${topId},${movedId}0`);
  });

  it('移到顶级：parentId=null 生效（P2-6）', async () => {
    const res = await api()
      .put(`${prefix}/dept/${movedId}`)
      .set(auth())
      .send({ parentId: null })
      .expect(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.parentId).toBeNull();
    expect(res.body.data.ancestors).toBe('0');
    // 子孙跟着算
    expect(await ancestorsOf(childId)).toBe(`0,${movedId}`);
  });

  it('移到顶级：parentId=0 也生效（老实现这里 400）', async () => {
    const res = await api()
      .put(`${prefix}/dept/${movedId}`)
      .set(auth())
      .send({ parentId: 0 })
      .expect(200);
    expect(res.body.code).toBe(200);
    expect(res.body.data.parentId).toBeNull();
    expect(res.body.data.ancestors).toBe('0');
  });

  it('移动后数据范围取子树仍然正确（ancestors 没被改坏）', async () => {
    const list = await api().get(`${prefix}/dept`).set(auth()).expect(200);
    const all = list.body.data as Dept[];
    const victims = all.filter((d) => d.id === decoyVictimId);
    expect(victims).toHaveLength(1);
    expect(victims[0]!.ancestors).toBe(`0,${topId},${movedId}0`);
  });
});
