import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, type Repository } from 'typeorm';
import { OutboxEvent } from './entities/outbox-event.entity.js';
import { OutboxService } from './outbox.service.js';

const BATCH_SIZE = 20;
const MAX_RETRIES = 5;
const STUCK_MS = 60_000;

/**
 * Outbox 投递器：轮询 pending 事件并可靠投递到已注册处理器。
 *
 * - 多实例安全：用 FOR UPDATE SKIP LOCKED 抢占一批并置为 processing
 * - 失败重试：指数退避，超过 MAX_RETRIES 置 failed
 * - 卡死恢复：processing 超过 STUCK_MS 的事件回收为 pending
 * - 至少一次语义：处理器需幂等
 */
@Injectable()
export class OutboxPublisher implements OnApplicationShutdown {
  private running = false;
  private stopped = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(OutboxEvent)
    private readonly repo: Repository<OutboxEvent>,
  ) {
    this.logger.setContext(OutboxPublisher.name);
  }

  @Interval(1000)
  async poll(): Promise<void> {
    if (this.stopped || this.running) return;
    if (!this.config.get<boolean>('app.outboxEnabled', true)) return;
    this.running = true;
    try {
      await this.recoverStuck();
      await this.drain();
    } catch (err) {
      this.logger.error({ err }, 'Outbox 轮询异常');
    } finally {
      this.running = false;
    }
  }

  onApplicationShutdown(): void {
    this.stopped = true;
  }

  /** 抢占一批待投递事件（事务内锁定 + 置 processing） */
  private async claimBatch(): Promise<OutboxEvent[]> {
    const now = new Date();
    return this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(OutboxEvent);
      const rows = await repo
        .createQueryBuilder('o')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('o.status = :s', { s: 'pending' })
        .andWhere('o.availableAt <= :now', { now })
        .orderBy('o.id', 'ASC')
        .limit(BATCH_SIZE)
        .getMany();
      if (rows.length) {
        for (const r of rows) {
          r.status = 'processing';
          r.claimedAt = now;
        }
        await repo.save(rows);
      }
      return rows;
    });
  }

  private async drain(): Promise<void> {
    const rows = await this.claimBatch();
    for (const row of rows) {
      await this.dispatch(row);
    }
  }

  private async dispatch(row: OutboxEvent): Promise<void> {
    const handler = this.outbox.getHandler(row.eventType);
    if (!handler) {
      // 无处理器：视为无需投递，标记 sent（避免无限 pending）
      this.logger.warn(
        { eventType: row.eventType, id: row.id },
        'Outbox 事件无处理器，标记为 sent',
      );
      await this.markSent(row.id);
      return;
    }
    try {
      await handler.handle(row.payload);
      await this.markSent(row.id);
    } catch (err) {
      await this.markFailedOrRetry(row, err);
    }
  }

  private async markSent(id: string): Promise<void> {
    await this.repo.update({ id }, { status: 'sent', sentAt: new Date() });
  }

  private async markFailedOrRetry(row: OutboxEvent, err: unknown): Promise<void> {
    const retries = row.retries + 1;
    const message = err instanceof Error ? err.message : String(err);
    if (retries >= MAX_RETRIES) {
      await this.repo.update(
        { id: row.id },
        { status: 'failed', retries, lastError: message.slice(0, 500) },
      );
      this.logger.error(
        { err, id: row.id, eventType: row.eventType, retries },
        'Outbox 事件投递失败（已放弃）',
      );
      return;
    }
    // 指数退避：1s, 2s, 4s, 8s ...
    const backoffMs = 1000 * 2 ** (retries - 1);
    await this.repo.update(
      { id: row.id },
      {
        status: 'pending',
        retries,
        lastError: message.slice(0, 500),
        availableAt: new Date(Date.now() + backoffMs),
      },
    );
  }

  /** 回收卡死的 processing 事件 */
  private async recoverStuck(): Promise<void> {
    const threshold = new Date(Date.now() - STUCK_MS);
    await this.repo
      .createQueryBuilder()
      .update(OutboxEvent)
      .set({ status: 'pending' })
      .where('status = :s', { s: 'processing' })
      .andWhere('claimedAt < :t', { t: threshold })
      .execute();
  }
}
