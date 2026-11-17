import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { Role } from './../src/modules/role/entities/role.entity.js';
import { nextLevel } from './utils/e2e-role.js';

/**
 * 事务基础设施集成测试（需 MySQL + Redis）。
 * 验证 ClsPluginTransactional + TypeORM 适配器：提交可见、抛错回滚。
 */
describe('Transaction (integration)', () => {
  let app: INestApplication;
  let cls: ClsService;
  let txHost: TransactionHost<TransactionalAdapterTypeOrm>;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    cls = app.get(ClsService);
    txHost = app.get(TransactionHost);
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('提交：事务内写入后外部可见', async () => {
    const key = `tmp_tx_ok_${Date.now()}`;
    await cls.run(async () => {
      await txHost.withTransaction(async () => {
        const repo = txHost.tx.getRepository(Role);
        // role_key 已废弃：这里直接把唯一键值放进 role_name 当定位标识。
        // level 没有数据库默认值（编号由 RoleService 分配），直连仓库必须自己给。
        await repo.save(
          repo.create({ roleName: key, level: await nextLevel(ds), status: 1 }),
        );
      });
    });
    const found = await ds.getRepository(Role).findOneBy({ roleName: key });
    expect(found).toBeTruthy();
    await ds.getRepository(Role).delete({ roleName: key });
  });

  it('回滚：事务内抛错后不落库', async () => {
    const before = await ds.getRepository(Role).count();
    const key = `tmp_tx_rollback_${Date.now()}`;
    await expect(
      cls.run(async () => {
        await txHost.withTransaction(async () => {
          const repo = txHost.tx.getRepository(Role);
          await repo.save(
            repo.create({ roleName: key, level: await nextLevel(ds), status: 1 }),
          );
          throw new Error('boom');
        });
      }),
    ).rejects.toThrow('boom');
    expect(await ds.getRepository(Role).count()).toBe(before);
  });
});
