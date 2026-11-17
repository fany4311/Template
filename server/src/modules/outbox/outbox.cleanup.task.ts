import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity.js';

/** 单批清理行数（避免一条长事务锁住整表） */
const PURGE_BATCH_SIZE = 500;

/** 保留期兜底值（配置缺失 / 非法时使用） */
const DEFAULT_SENT_RETENTION_DAYS = 7;
const DEFAULT_FAILED_RETENTION_DAYS = 30;

/**
 * Outbox 终态事件回收（每小时一次）。
 *
 * `sys_outbox` 里 `sent` 的事件投递完就没用了，但它**不会自己消失** ——
 * 每个业务事件一行 payload JSON，三年下来是几十万行；而轮询器每秒钟
 * 都要按 `(status, available_at)` 扫一遍这张表，表越大每次都越慢。
 *
 * 两类终态分开保留，因为处置方式不同：
 * - `sent`：已成功，留 7 天够核对「这事到底发没发出去」
 * - `failed`：投递失败的死信，留 30 天给运维排查后手动补偿；
 *   删之前**先打一条 warn 日志**，别让死信无声消失
 *
 * `pending` / `processing` 一律不动：前者还没投递，后者可能正在被别的实例处理。
 */
@Injectable()
export class OutboxCleanupTask {
  private readonly logger = new Logger(OutboxCleanupTask.name);
  private running = false;

  constructor(
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'outbox-cleanup' })
  async handle(): Promise<void> {
    // e2e 会断言「事件被投递后 status=sent」，提前删会污染用例
    if (this.config.get<string>('app.env') === 'test') return;
    if (this.running) {
      this.logger.debug('上一轮清理尚未结束，跳过本次');
      return;
    }

    this.running = true;
    try {
      const sent = await this.purge('sent', this.sentRetentionDays);
      const failed = await this.purge('failed', this.failedRetentionDays);
      if (sent > 0 || failed > 0) {
        this.logger.log(`本轮回收 outbox：sent ${sent} 条，failed ${failed} 条`);
      }
    } catch (err) {
      this.logger.error(`Outbox 回收失败：${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private get sentRetentionDays(): number {
    return this.daysOf('app.outboxSentRetentionDays', DEFAULT_SENT_RETENTION_DAYS);
  }

  private get failedRetentionDays(): number {
    return this.daysOf(
      'app.outboxFailedRetentionDays',
      DEFAULT_FAILED_RETENTION_DAYS,
    );
  }

  private daysOf(key: string, fallback: number): number {
    const v = Number(this.config.get<number>(key) ?? fallback);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  /** 按状态 + 创建时间分批删；返回删除行数 */
  private async purge(
    status: 'sent' | 'failed',
    retentionDays: number,
  ): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const rows = await this.repo
        .createQueryBuilder('o')
        .select('o.id', 'id')
        .where('o.status = :status', { status })
        .andWhere('o.createTime < :cutoff', { cutoff })
        .limit(PURGE_BATCH_SIZE)
        .getRawMany<{ id: string }>();
      if (!rows.length) break;

      if (status === 'failed') {
        // 死信是排障线索，删之前留痕（谁被丢了、什么时候丢的）
        this.logger.warn(
          `清理 ${rows.length} 条超期 outbox 死信（保留 ${retentionDays} 天）：id=${rows
            .map((r) => r.id)
            .join(',')}`,
        );
      }
      const res = await this.repo.delete(rows.map((r) => r.id));
      total += res.affected ?? rows.length;
      if (rows.length < PURGE_BATCH_SIZE) break;
    }
    return total;
  }
}
