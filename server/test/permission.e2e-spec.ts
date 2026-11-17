import { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { createE2ERole } from './utils/e2e-role.js';
import { User } from './../src/modules/user/entities/user.entity.js';
import { UserRole } from './../src/modules/user/entities/user-role.entity.js';
import { SysPermission } from './../src/modules/permission/entities/permission.entity.js';
import { PermissionService } from './../src/modules/permission/permission.service.js';
import { collectPermissionCatalog } from './../src/common/authz/permission-catalog.js';

/**
 * 权限清单 e2e：需 MySQL + Redis。
 *
 * 覆盖：
 * - GET /permission 按模块分组返回，且**只含具体码**（无 `*`、无 `!`）；
 * - 无 `system:permission:list` 的角色拿到 403；
 * - 同步幂等：重复 sync 不产生重复行；
 * - 同步会停用（而非删除）代码中已消失的码。
 */
describe('Permission catalog (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token = '';
  let limitedToken = '';

  const stamp = Date.now();
  const adminRoleName = `e2e_perm_admin_${stamp}`;
  const adminName = `e2e_perm_admin_${stamp}`;
  const limitedName = `e2e_perm_limited_${stamp}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);

    // 自举清单：真实扫描本应用的控制器元数据后落库。
    // e2e 不依赖手工执行 `pnpm authz:sync`（测试库可能是空的），
    // 这样顺带验证了采集器在**真实应用**上也能跑通。
    await selfSync();

    const userRepo = ds.getRepository(User);
    const urRepo = ds.getRepository(UserRole);

    const adminRole = await createE2ERole(ds, {
      roleName: adminRoleName,
      permissions: ['system:permission:list'],
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

    // 只持角色管理权限：调 /permission 应 403
    const limitedRole = await createE2ERole(ds, {
      roleName: `e2e_perm_limited_${stamp}`,
      permissions: ['system:role:list'],
      status: 1,
    });
    const limitedUser = await userRepo.save(
      userRepo.create({
        username: limitedName,
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

    token = await login(adminName);
    limitedToken = await login(limitedName);
  });

  /** 用运行时元数据采集 → 落库（等价于 pnpm authz:sync，但不需要起进程） */
  async function selfSync(): Promise<void> {
    const controllers: Function[] = [];
    for (const [, moduleRef] of app.get(ModulesContainer)) {
      for (const [, wrapper] of moduleRef.controllers) {
        if (wrapper.metatype) controllers.push(wrapper.metatype);
      }
    }
    const { entries } = collectPermissionCatalog(controllers);
    await app.get(PermissionService).sync(entries);
  }

  async function login(username: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password: 'pass1234' })
      .expect(200);
    return res.body.data.token as string;
  }

  afterAll(async () => {
    await ds
      .getRepository(UserRole)
      .createQueryBuilder()
      .delete()
      .where('role_id IN (SELECT id FROM sys_role WHERE role_name LIKE :p)', {
        p: 'e2e_perm_%',
      })
      .execute();
    await ds
      .getRepository(User)
      .createQueryBuilder()
      .delete()
      .where('username LIKE :p', { p: 'e2e_perm_%' })
      .execute();
    await ds
      .getRepository('sys_role')
      .createQueryBuilder()
      .delete()
      .where('role_name LIKE :p', { p: 'e2e_perm_%' })
      .execute();
    await app.close();
  });

  it('按模块分组返回清单', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/permission')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const groups = res.body.data as Array<{
      module: string;
      moduleLabel: string;
      permissions: Array<{ code: string; name: string; status: number }>;
    }>;

    expect(Array.isArray(groups)).toBe(true);
    expect(groups.length).toBeGreaterThan(0);

    const all = groups.flatMap((g) => g.permissions);
    // 具体码：2–3 段、不含通配与否定
    for (const perm of all) {
      expect(perm.code).toMatch(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*){1,2}$/);
      expect(perm.code).not.toContain('*');
      expect(perm.code).not.toContain('!');
      expect(perm.name.length).toBeGreaterThan(0);
    }
    // 清单必须覆盖本接口自身（自举）与后台准入码
    const codes = all.map((p) => p.code);
    expect(codes).toContain('system:permission:list');
    expect(codes).toContain('console:access');
    // 分组键 = 码的第一段
    for (const group of groups) {
      for (const perm of group.permissions) {
        expect(perm.code.startsWith(`${group.module}:`)).toBe(true);
      }
    }
  });

  it('无 system:permission:list 的角色 → code 403', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/permission')
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(200);
    expect(res.body.code).toBe(403);
  });

  it('同步幂等：重复执行不产生重复行', async () => {
    const service = app.get(PermissionService);
    const repo = ds.getRepository(SysPermission);
    const before = await repo.count();

    const groups = await service.list();
    const entries = groups
      .flatMap((g) => g.permissions)
      .map((p) => ({
        code: p.code,
        name: p.name,
        module: p.module,
        moduleLabel: p.moduleLabel,
      }));

    const first = await service.sync(entries);
    expect(first.inserted).toBe(0);
    expect(first.deprecated).toBe(0);
    expect(await repo.count()).toBe(before);
  });

  it('代码中消失的码被停用（status=0），不被删除', async () => {
    const service = app.get(PermissionService);
    const repo = ds.getRepository(SysPermission);

    const ghost = await repo.save(
      repo.create({
        code: 'e2e:ghost:gone',
        name: '测试幽灵码',
        module: 'e2e',
        moduleLabel: '测试',
        status: 1,
      }),
    );

    const groups = await service.list();
    const entries = groups
      .flatMap((g) => g.permissions)
      .filter((p) => p.code !== ghost.code) // 只传"代码里真实存在的"
      .map((p) => ({
        code: p.code,
        name: p.name,
        module: p.module,
        moduleLabel: p.moduleLabel,
      }));

    const result = await service.sync(entries);
    expect(result.deprecated).toBeGreaterThanOrEqual(1);

    const after = await repo.findOne({ where: { code: ghost.code } });
    expect(after).not.toBeNull();
    expect(after?.status).toBe(0); // 停用而非删除

    await repo.delete({ code: ghost.code });
  });

  it('采集结果为空时拒绝同步（防止误停用全部）', async () => {
    const service = app.get(PermissionService);
    await expect(service.sync([])).rejects.toThrow();
  });
});
