import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 建表：隐患闭环三张表。
 *
 * - biz_hazard       隐患单（聚合根）
 * - biz_hazard_log   流转日志（一单四制的留痕，只追加）
 * - biz_hazard_sync  省平台同步记录（对外同步结果，与 sys_outbox 语义不同）
 *
 * 字段与 Hazard / HazardLog / HazardSync 实体一一对应。
 * 可见性相关索引（status / assignee_dept_id / reporter_id）是为列表页的高频过滤建的；
 * cooperate_dept_ids 用 JSON 列，MySQL 8 可在其上建函数索引，暂不建（数据量可控）。
 */
export class CreateBizHazard1767000006000 implements MigrationInterface {
  name = 'CreateBizHazard1767000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS biz_hazard (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        delete_time datetime(6) NULL,
        hazard_no varchar(32) NOT NULL COMMENT '隐患编号',
        title varchar(200) NOT NULL COMMENT '标题',
        content text NOT NULL COMMENT '描述',
        location varchar(255) NOT NULL DEFAULT '' COMMENT '地点',
        category varchar(32) NOT NULL DEFAULT '' COMMENT '类别',
        level varchar(16) NOT NULL DEFAULT 'LOW' COMMENT '等级',
        scope varchar(16) NOT NULL DEFAULT 'DEPT' COMMENT '可见范围 DEPT/OPEN/SCHOOL',
        status varchar(20) NOT NULL DEFAULT 'REPORTED' COMMENT '状态',
        reporter_id int NOT NULL COMMENT '上报人',
        reporter_name varchar(50) NOT NULL DEFAULT '' COMMENT '上报人快照',
        reporter_dept_id int NULL COMMENT '上报时部门快照',
        assignee_dept_id int NULL COMMENT '主责部门',
        cooperate_dept_ids json NULL COMMENT '协办部门 id 数组',
        handler_id int NULL COMMENT '当前处理人',
        handler_name varchar(50) NOT NULL DEFAULT '' COMMENT '处理人快照',
        deadline_at datetime NULL COMMENT '受理期限',
        rectify_deadline datetime NULL COMMENT '整改期限',
        rectify_measure text NULL COMMENT '整改措施',
        rectify_time datetime NULL COMMENT '整改完成时间',
        review_opinion varchar(500) NOT NULL DEFAULT '' COMMENT '复查意见',
        reviewer_id int NULL COMMENT '复查人',
        review_time datetime NULL COMMENT '复查时间',
        archive_opinion varchar(500) NOT NULL DEFAULT '' COMMENT '归档意见',
        archiver_id int NULL COMMENT '归档人',
        archive_time datetime NULL COMMENT '归档时间',
        reject_reason varchar(500) NOT NULL DEFAULT '' COMMENT '驳回原因',
        PRIMARY KEY (id),
        UNIQUE KEY uk_hazard_no (hazard_no),
        KEY idx_hazard_status (status),
        KEY idx_hazard_assignee (assignee_dept_id),
        KEY idx_hazard_reporter (reporter_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='隐患单'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS biz_hazard_log (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        hazard_id int NOT NULL,
        hazard_no varchar(32) NOT NULL DEFAULT '' COMMENT '冗余快照',
        scope varchar(16) NOT NULL DEFAULT 'DEPT' COMMENT '冗余快照',
        action varchar(32) NOT NULL COMMENT '动作',
        action_label varchar(32) NOT NULL COMMENT '动作中文名',
        from_status varchar(20) NULL,
        to_status varchar(20) NOT NULL,
        operator_id int NOT NULL,
        operator_name varchar(50) NOT NULL DEFAULT '',
        dept_id int NULL,
        remark varchar(500) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        KEY idx_hazard_log_hazard (hazard_id, id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='隐患流转日志'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS biz_hazard_sync (
        id int NOT NULL AUTO_INCREMENT,
        create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        hazard_id int NOT NULL,
        hazard_no varchar(32) NOT NULL,
        event_id varchar(36) NOT NULL COMMENT '事件唯一标识（幂等键）',
        event_type varchar(64) NOT NULL,
        to_status varchar(20) NOT NULL COMMENT '同步后的目标状态（仅展示）',
        direction varchar(8) NOT NULL DEFAULT 'PUSH',
        status varchar(16) NOT NULL DEFAULT 'SUCCESS',
        request_body json NULL,
        response_body json NULL,
        error varchar(500) NOT NULL DEFAULT '',
        retry_count int NOT NULL DEFAULT 0,
        target varchar(100) NOT NULL DEFAULT '',
        PRIMARY KEY (id),
        KEY idx_hazard_sync_hazard (hazard_id),
        UNIQUE KEY uk_hazard_sync_event (event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='省平台同步记录'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS biz_hazard_sync');
    await queryRunner.query('DROP TABLE IF EXISTS biz_hazard_log');
    await queryRunner.query('DROP TABLE IF EXISTS biz_hazard');
  }
}
