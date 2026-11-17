import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Outbox 终态回收索引：`(status, create_time)`。
 *
 * 背景：`OutboxCleanupTask` 每小时按
 * `status = 'sent'|'failed' AND create_time < cutoff` 分批删历史事件。
 * 现有索引是 `(status, available_at)` —— 只能吃掉 `status` 这一列，剩下的范围条件
 * 还得回表逐行比。事件表在这个系统里增长最快（每个业务事件一行 payload JSON），
 * 迟早会变成 «每小时一次全表扫».
 *
 * 为什么建 `create_time` 而不是 `sent_at`：保留期按「事件产生时间」算语义更简单，
 * 且 failed 事件永远没有 `sent_at`（不能拿它做保留判断），一个索引就能覆盖两种终态。
 *
 * 幂等：先查 `information_schema.statistics`，已存在就跳过。
 */
export class AddOutboxCleanupIndex1767000020000 implements MigrationInterface {
  name = 'AddOutboxCleanupIndex1767000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const exists: Array<{ c: number }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'sys_outbox'
         AND index_name = 'idx_outbox_status_create'`,
    );
    if (Number(exists[0]?.c ?? 0) > 0) return;

    await queryRunner.query(
      `ALTER TABLE sys_outbox ADD INDEX idx_outbox_status_create (status, create_time)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const exists: Array<{ c: number }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.statistics
       WHERE table_schema = DATABASE() AND table_name = 'sys_outbox'
         AND index_name = 'idx_outbox_status_create'`,
    );
    if (Number(exists[0]?.c ?? 0) === 0) return;
    await queryRunner.query(
      `ALTER TABLE sys_outbox DROP INDEX idx_outbox_status_create`,
    );
  }
}
