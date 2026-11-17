import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { IdempotencyService } from './idempotency.service.js';

/**
 * 幂等记录过期回收（每小时一次）。
 *
 * `sys_idempotency` 是「每个写请求一行」的表，不回收就会无限增长：
 * 每行最多存 24 小时的响应体 JSON，唯一索引也会随行数变慢。
 * `expire_at` 本身有索引（`idx_idem_expire`），所以清理是范围扫描而非全表。
 *
 * 只删**已过期**的：还在 TTL 内的记录是重复请求回放的依据，提前删掉会让
 * 「客户端重试」变成「又执行一遍」—— 幂等就失效了。
 */
@Injectable()
export class IdempotencyCleanupTask {
  private readonly logger = new Logger(IdempotencyCleanupTask.name);
  private running = false;

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'idempotency-cleanup' })
  async handle(): Promise<void> {
    // e2e 里插入额外写入会污染用例断言（如「重复请求仍返回首次响应」）
    if (this.config.get<string>('app.env') === 'test') return;

    // 上一轮没跑完就跳过，避免同一批行被两个并发事务反复删（锁等待 + 日志噪声）
    if (this.running) {
      this.logger.debug('上一轮清理尚未结束，跳过本次');
      return;
    }

    this.running = true;
    try {
      const removed = await this.idempotency.purgeExpired();
      if (removed > 0) {
        this.logger.log(`本轮回收 ${removed} 条过期幂等记录`);
      }
    } catch (err) {
      // 定时任务不能把进程带崩：记录后等下个周期重试
      this.logger.error(`幂等记录回收失败：${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
