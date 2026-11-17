import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 字典管理建表：字典类型（sys_dict_type）+ 字典数据（sys_dict_data）。
 *
 * 约定：
 * - 字段与实体严格一致（含 create_time / update_time / delete_time 软删标记）
 * - 两表通过 dict_type 字符串关联（不建外键，避免与软删语义冲突）
 * - 唯一约束 uk_dict_type 保证字典类型标识全局唯一
 * - 仅建表，不插业务数据
 */
export class CreateSysDict1767000002000 implements MigrationInterface {
  name = 'CreateSysDict1767000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE sys_dict_type (
         id INT NOT NULL AUTO_INCREMENT COMMENT '主键',
         dict_name VARCHAR(100) NOT NULL COMMENT '字典名称',
         dict_type VARCHAR(100) NOT NULL COMMENT '字典类型标识，如 sys_user_sex',
         status INT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0禁用',
         remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
         create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
         update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
         delete_time DATETIME(6) NULL COMMENT '软删除时间',
         PRIMARY KEY (id),
         UNIQUE KEY uk_dict_type (dict_type)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典类型'`,
    );

    await queryRunner.query(
      `CREATE TABLE sys_dict_data (
         id INT NOT NULL AUTO_INCREMENT COMMENT '主键',
         dict_type VARCHAR(100) NOT NULL COMMENT '所属字典类型标识',
         dict_label VARCHAR(100) NOT NULL COMMENT '显示名',
         dict_value VARCHAR(100) NOT NULL COMMENT '值',
         dict_sort INT NOT NULL DEFAULT 0 COMMENT '排序',
         tag_type VARCHAR(20) NOT NULL DEFAULT '' COMMENT '前端标签类型：success/warning/info/danger，空=默认',
         status INT NOT NULL DEFAULT 1 COMMENT '状态：1正常 0禁用',
         remark VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
         create_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
         update_time DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
         delete_time DATETIME(6) NULL COMMENT '软删除时间',
         PRIMARY KEY (id),
         INDEX idx_dict_data_type (dict_type)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='字典数据'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 反序删除：先删字典数据，再删字典类型
    await queryRunner.query('DROP TABLE sys_dict_data');
    await queryRunner.query('DROP TABLE sys_dict_type');
  }
}
