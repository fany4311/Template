import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 建表：文件元数据 + 多态绑定。
 *
 * - sys_file       文件物理元数据（内容寻址、按用户隔离去重）
 * - sys_file_link  文件 ↔ 业务对象的多对多绑定（同一文件可被多个业务引用）
 *
 * 唯一键设计：
 * - `uk_file_sha_uploader(sha256, uploader_id, delete_time)`：
 *   「同一用户的同一内容只留一条有效记录」；把 `delete_time` 放进唯一键，
 *   是为了让软删行不阻塞重新上传（MySQL 唯一索引里 NULL 互不冲突）。
 *   刻意**不**用 sha256 单独唯一 —— 那会让不同用户共享同一行，
 *   造成「知道摘要就能确认别人有某文件」的泄漏，也让删除权互相干扰。
 * - `uk_file_link(file_id, biz_type, biz_id, biz_field)`：同一业务位不重复挂同一文件。
 *
 * `sys_file_link` 不继承审计基类、不软删：解绑是物理删除，
 * 否则唯一键会被历史行占住，导致「解绑后再绑定」冲突。
 */
export class CreateSysFile1767000009000 implements MigrationInterface {
  name = 'CreateSysFile1767000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sys_file (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        delete_time datetime(6) NULL,
        sha256 varchar(64) NOT NULL COMMENT 'SHA-256 内容摘要',
        original_name varchar(255) NOT NULL COMMENT '原始文件名',
        ext varchar(16) NOT NULL DEFAULT '' COMMENT '扩展名（小写不含点）',
        mime varchar(128) NOT NULL COMMENT '服务端判定的真实 MIME',
        size int NOT NULL COMMENT '字节数',
        disk varchar(32) NOT NULL DEFAULT 'default' COMMENT '存储盘名',
        object_key varchar(255) NOT NULL COMMENT '对象键（服务端生成）',
        uploader_id int NOT NULL COMMENT '上传人',
        uploader_name varchar(50) NOT NULL DEFAULT '' COMMENT '上传人快照',
        uploader_dept_id int NULL COMMENT '上传时部门快照',
        status varchar(16) NOT NULL DEFAULT 'TEMP' COMMENT 'TEMP/ACTIVE',
        ref_count int NOT NULL DEFAULT 0 COMMENT '业务引用数',
        expire_at datetime NULL COMMENT '临时文件过期时间',
        PRIMARY KEY (id),
        UNIQUE KEY uk_file_sha_uploader (sha256, uploader_id, delete_time),
        KEY idx_file_uploader (uploader_id),
        KEY idx_file_status_expire (status, expire_at),
        KEY idx_file_object_key (object_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='文件元数据'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sys_file_link (
        id int NOT NULL AUTO_INCREMENT,
        file_id int NOT NULL COMMENT '文件 id',
        biz_type varchar(64) NOT NULL COMMENT '业务类型（由业务模块注册）',
        biz_id varchar(64) NOT NULL COMMENT '业务对象 id',
        biz_field varchar(64) NOT NULL DEFAULT '' COMMENT '附件用途',
        sort int NOT NULL DEFAULT 0 COMMENT '同用途内排序',
        create_by int NOT NULL COMMENT '绑定人',
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uk_file_link (file_id, biz_type, biz_id, biz_field),
        KEY idx_file_link_biz (biz_type, biz_id),
        KEY idx_file_link_file (file_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        COMMENT='文件与业务对象的多态绑定'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS sys_file_link');
    await queryRunner.query('DROP TABLE IF EXISTS sys_file');
  }
}
