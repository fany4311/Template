import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 后台准入：给超管补上 `console:access` 权限码。
 *
 * 背景：前端拆成两个站点后，`web_admin`（后台，8080）只允许**超管 + 管理员**进入，
 * 靠的就是 `console:access` 这个权限码；`web`（前端，8081）不做限制，任何账号可登录。
 *
 * 现状与缺口：
 * - `admin`（校级管理员）的授权是 `*:*:*,!system:*`，`*:*:*` 匹配一切 → **已有**后台准入；
 * - `superadmin`（系统管理员）的授权是 `system:*`，只覆盖系统管理域 →
 *   `console:access` 落在这个域之外，**没有**后台准入。
 *   照现在的数据发布，超管反而进不去后台 —— 这个迁移就是补这个洞。
 *
 * 为什么权限码不叫 `system:console:access`：
 * admin 的否定授权 `!system:*` 会把整个 system 域挡掉，那样连管理员都进不来。
 * 所以准入码必须落在 system 域之外，语义上它也确实不属于系统管理功能。
 *
 * 为什么不改 `1767000000000-SeedBuiltinRoles`：
 * 该迁移已在库中执行过，改它对既有环境无效（且它用的是
 * `ON DUPLICATE KEY UPDATE role_key = role_key`，本来就不会覆盖已改的权限）。
 * 已应用的迁移视作不可变，修正一律追加新迁移。
 *
 * 幂等：`NOT LIKE '%console:access%'` + 只在缺的时候追加，重复执行无副作用。
 */
export class AddConsoleAccessPermission1767000012000
  implements MigrationInterface
{
  name = 'AddConsoleAccessPermission1767000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: number; permissions: string | null }> =
      await queryRunner.query(
        `SELECT id, permissions FROM sys_role WHERE role_key = ? LIMIT 1`,
        ['superadmin'],
      );
    if (!rows.length) return;

    const current = rows[0].permissions ?? '';
    if (current.split(',').includes('console:access')) return;

    const next = current ? `${current},console:access` : 'console:access';
    await queryRunner.query(`UPDATE sys_role SET permissions = ? WHERE id = ?`, [
      next,
      rows[0].id,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: number; permissions: string | null }> =
      await queryRunner.query(
        `SELECT id, permissions FROM sys_role WHERE role_key = ? LIMIT 1`,
        ['superadmin'],
      );
    if (!rows.length) return;

    // 精确移除 console:access，保留其它授权（超管可能已被改成 *:*:*，那就原样不动）
    const next = (rows[0].permissions ?? '')
      .split(',')
      .filter((p) => p && p !== 'console:access')
      .join(',');

    await queryRunner.query(`UPDATE sys_role SET permissions = ? WHERE id = ?`, [
      next,
      rows[0].id,
    ]);
  }
}
