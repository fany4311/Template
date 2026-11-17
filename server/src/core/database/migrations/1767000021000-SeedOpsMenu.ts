import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 系统监控菜单（运维面）。
 * 权限码 system:ops:view / system:ops:cleanup 由控制器反射生成（pnpm authz:sync）。
 */
export class SeedOpsMenu1767000021000 implements MigrationInterface {
  name = 'SeedOpsMenu1767000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      [
        'INSERT INTO sys_menu (parent_id, name, type, path, component, perms, icon, sort, visible, status, ancestors)',
        "SELECT p.id, '系统监控', 'C', '/system/ops', 'system/OpsView', 'system:ops:view', 'Monitor', 9, 1, 1, CONCAT('0,', p.id)",
        "FROM sys_menu p WHERE p.path = '/system'",
        "  AND NOT EXISTS (SELECT 1 FROM sys_menu c WHERE c.path = '/system/ops')",
      ].join('\n'),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM sys_menu WHERE path = '/system/ops'");
  }
}
