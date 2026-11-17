import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 参数配置建表：sys_config。
 *
 * 约定：
 * - 字段与实体严格一致（含 create_time / update_time / delete_time 软删标记）
 * - 唯一约束 uk_config_key 保证参数键全局唯一（业务按 key 读取参数）
 * - config_type：'Y' 系统内置不可删 / 'N' 普通可编辑
 * - 仅建表，不插业务数据
 */
export class CreateSysConfig1767000003000 implements MigrationInterface {
  name = 'CreateSysConfig1767000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE sys_config (
         id INT NOT NULL AUTO_INCREMENT COMMENT '主键',
         config_name VARCHAR(100) NOT NULL COMMENT '参数名称',
         config_key VARCHAR(100) NOT NULL COMMENT '参数键，如 sys.user.initPassword',
         config_value TEXT NOT NULL COMMENT '参数值',
         config_type VARCHAR(1) NOT NULL DEFAULT 'N' COMMENT '是否系统内置：Y内置不可删 / N可编辑',
         status INT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0禁用',
         remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
         create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
         update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
         delete_time DATETIME(6) NULL COMMENT '软删除时间',
         PRIMARY KEY (id),
         UNIQUE KEY uk_config_key (config_key)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='参数配置'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE sys_config');
  }
}
