import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 修正「文件管理」菜单的位置：顶级菜单 → 「系统管理」子菜单。
 *
 * 背景：`1767000010000-SeedFileSetup` 一开始把它做成了顶级菜单（`parent_id = NULL`），
 * 于是左侧导航出现一个孤立的「文件管理」一级项，和「系统管理」下的八个系统功能不一致。
 * 文件管理用的权限码本来就是 `system:file:*`（系统域），挂在系统管理下语义也更准确。
 *
 * 为什么不直接改 1767000010000：
 * 该迁移已经在库中执行过，改它对既有环境无效，只会让「新装库」和「已装库」出现分叉。
 * 已应用的迁移视作不可变，修正一律追加新迁移。
 *
 * 查找按 path 而不是硬编码 id —— 运维可能手工调整过菜单顺序。
 */
export class FixFileMenuParent1767000011000 implements MigrationInterface {
  name = 'FixFileMenuParent1767000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const system: Array<{ id: number }> = await queryRunner.query(
      `SELECT id FROM sys_menu WHERE path = '/system' AND type = 'M' ORDER BY id LIMIT 1`,
    );
    const fileDir: Array<{ id: number }> = await queryRunner.query(
      `SELECT id FROM sys_menu WHERE path = '/file' AND type = 'M' ORDER BY id LIMIT 1`,
    );
    // 任一不存在就跳过：可能是精简部署没装文件模块
    if (!system.length || !fileDir.length) return;

    const parentId = system[0].id;
    const dirId = fileDir[0].id;

    await queryRunner.query(
      `UPDATE sys_menu SET parent_id = ?, ancestors = ?, sort = ? WHERE id = ?`,
      [parentId, `0,${parentId}`, 9, dirId],
    );
    await queryRunner.query(
      `UPDATE sys_menu SET ancestors = ?, sort = ? WHERE parent_id = ?`,
      [`0,${parentId},${dirId}`, 9, dirId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const fileDir: Array<{ id: number }> = await queryRunner.query(
      `SELECT id FROM sys_menu WHERE path = '/file' AND type = 'M' ORDER BY id LIMIT 1`,
    );
    if (!fileDir.length) return;

    const dirId = fileDir[0].id;
    await queryRunner.query(
      `UPDATE sys_menu SET parent_id = NULL, ancestors = '0' WHERE id = ?`,
      [dirId],
    );
    await queryRunner.query(
      `UPDATE sys_menu SET ancestors = '0,${dirId}' WHERE parent_id = ?`,
      [dirId],
    );
  }
}
