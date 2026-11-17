import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 登录日志表（sys_login_log）。
 *
 * 只追加不修改：用于安全审计（谁在何时从哪台机器登录、成功与否）。
 * 写入为旁路，不参与登录业务事务；查询按 login_time 倒序分页。
 */
export class CreateSysLoginLog1767000004000 implements MigrationInterface {
  name = 'CreateSysLoginLog1767000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS sys_login_log (
        id bigint NOT NULL AUTO_INCREMENT COMMENT '主键',
        username varchar(50) NOT NULL COMMENT '登录账号',
        ip varchar(45) NULL COMMENT '来源 IP',
        user_agent varchar(255) NULL COMMENT '浏览器 UA',
        status int NOT NULL COMMENT '1成功 0失败',
        msg varchar(255) NULL COMMENT '结果说明/失败原因',
        login_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '登录时间',
        PRIMARY KEY (id),
        KEY idx_login_log_time (login_time),
        KEY idx_login_log_username (username)
      ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci COMMENT = '登录日志'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS sys_login_log');
  }
}
