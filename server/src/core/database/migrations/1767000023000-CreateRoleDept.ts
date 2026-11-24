import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 角色自定义数据范围（`dataScope = CUSTOM`）的部门集合表。
 *
 * 背景：`DataScope` 枚举里一直有 `CUSTOM`，但实现是「暂按无权限处理」——
 * 界面把选项禁用了，后端也没读的地方。这张表把最后一块补上。
 *
 * 幂等：`CREATE TABLE IF NOT EXISTS`。
 */
export class CreateRoleDept1767000023000 implements MigrationInterface {
  name = 'CreateRoleDept1767000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sys_role_dept (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        delete_time datetime(6) DEFAULT NULL,
        role_id int NOT NULL COMMENT '角色 id',
        dept_id int NOT NULL COMMENT '部门 id',
        PRIMARY KEY (id),
        UNIQUE KEY UQ_role_dept (role_id, dept_id),
        KEY IDX_role_dept_role (role_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='角色自定义数据范围的部门集合'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS sys_role_dept');
  }
}
