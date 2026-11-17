import type { DataSource } from 'typeorm';
import { Role } from '../../src/modules/role/entities/role.entity.js';

/** 内置角色占用的最大编号（0-4），自建角色从它 +1 起排 */
const BUILTIN_MAX_LEVEL = 4;

/**
 * e2e 建角色：显式分配 `level`。
 *
 * 为什么要这个助手：
 * `sys_role.level` 是 NOT NULL + UNIQUE 且**没有数据库默认值**（MySQL 一张表
 * 只允许一个自增列，已经被 `id` 占了，编号只能由应用侧分配）。所以任何**绕过
 * RoleService、直接 `repo.save(Role)`** 的地方（e2e / 迁移 / seed）都必须自己
 * 给出编号。这里复刻 RoleService.allocateLevel 的算法（MAX+1，含软删行），
 * 让测试数据和生产走同一套编号语义。
 *
 * 只用于 e2e：并发安全靠「e2e 强制串行」（vitest fileParallelism: false），
 * 所以这里不加悲观锁。
 */
export async function createE2ERole(
  ds: DataSource,
  input: Partial<Role> & { roleName: string },
): Promise<Role> {
  const repo = ds.getRepository(Role);
  return repo.save(repo.create({ ...input, level: await nextLevel(ds) }));
}

/** 取下一个可用编号（含软删行，理由同 RoleService.allocateLevel） */
export async function nextLevel(ds: DataSource): Promise<number> {
  const raw = await ds
    .getRepository(Role)
    .createQueryBuilder('r')
    .withDeleted()
    .select('MAX(r.level)', 'max')
    .getRawOne<{ max: number | string | null }>();
  return Number(raw?.max ?? BUILTIN_MAX_LEVEL) + 1;
}
