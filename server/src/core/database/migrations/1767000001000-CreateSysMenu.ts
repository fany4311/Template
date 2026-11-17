import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 建表：sys_menu（菜单/按钮 + 前端动态路由）。
 * 说明：本迁移只建表，不插数据（菜单种子另行统一处理）。
 * 字段与 Menu 实体一一对应；ancestors 存祖先路径（如 "0,1,3"）。
 */
export class CreateSysMenu1767000001000 implements MigrationInterface {
  name = 'CreateSysMenu1767000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sys_menu (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        delete_time datetime(6) NULL,
        parent_id int NULL,
        name varchar(50) NOT NULL,
        type varchar(1) NOT NULL,
        path varchar(200) NOT NULL DEFAULT '',
        component varchar(255) NOT NULL DEFAULT '',
        perms varchar(100) NOT NULL DEFAULT '',
        icon varchar(64) NOT NULL DEFAULT '',
        sort int NOT NULL DEFAULT 0,
        visible int NOT NULL DEFAULT 1,
        status int NOT NULL DEFAULT 1,
        ancestors varchar(500) NOT NULL DEFAULT '0',
        PRIMARY KEY (id),
        INDEX idx_menu_parent (parent_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE sys_menu');
  }
}
