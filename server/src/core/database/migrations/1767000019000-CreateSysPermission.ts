import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 建表：权限清单（`sys_permission`）。
 *
 * ## 这张表解决什么
 * 权限码的**唯一真相**一直在代码里（`@RequiresPermissions`），
 * 而角色权限串是手抄副本。两份副本没有一致性机制，于是会产生：
 * 幽灵码（代码改名后残留在角色里）、拼错码、以及"系统到底有哪些权限码"无法回答。
 * 本表由 `pnpm authz:sync` 从代码反射生成，成为可查询的权威目录。
 *
 * ## 设计要点
 * - `uk_permission_code(code)` 唯一：一个码一行，同步按码 upsert；
 * - `module` 存码的第一段（`system` / `hazard` / `console`），
 *   `module_label` 存显示名（取自 `@ApiTags`）—— 两者分开，因为同一段下
 *   可能有多个控制器、标签各不相同，界面按标签聚合更贴近人的认知；
 * - 保留 `delete_time`（继承审计基类）但同步**永不删行**，只把 `status` 置 0：
 *   角色里可能还引用旧码，删了就无法追溯"这码曾经对应哪个接口"；
 * - **不建外键/关联表**：角色权限是 `simple-array` 字符串，与清单是软关联。
 *   做成强关联会让"角色持有代码里不存在的码"变成非法状态，
 *   而那种情况恰恰是必须能显示出来给人看的（界面标灰提示）。
 *
 * ## 不参与鉴权（重要）
 * `RbacGuard` 只读 `sys_role.permissions`。本表为空也不影响任何鉴权结果，
 * 避免"清单没同步→全员失权"这类连锁故障。
 */
export class CreateSysPermission1767000019000 implements MigrationInterface {
  name = 'CreateSysPermission1767000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sys_permission (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        delete_time datetime(6) NULL,
        code varchar(64) NOT NULL COMMENT '权限码，如 system:role:list',
        name varchar(100) NOT NULL DEFAULT '' COMMENT '权限名称（取自接口 summary）',
        module varchar(32) NOT NULL COMMENT '模块键（权限码第一段）',
        module_label varchar(50) NOT NULL DEFAULT '' COMMENT '模块显示名（取自 @ApiTags）',
        status tinyint(1) NOT NULL DEFAULT 1 COMMENT '状态：1有效 0已停用（代码中已不存在）',
        PRIMARY KEY (id),
        UNIQUE KEY uk_permission_code (code),
        KEY idx_permission_module (module, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='权限清单（由 pnpm authz:sync 从代码反射生成）'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS sys_permission`);
  }
}
