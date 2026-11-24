import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { IdempotencyRecord } from './entities/idempotency-record.entity.js';

/** 占位结果 */
export type AcquireResult =
  | { acquired: true }
  | { acquired: false; record: IdempotencyRecord };

/**
 * 占位重试上限。
 *
 * 为什么会「占位失败但查不到记录」：唯一键冲突后立刻查，记录可能刚被过期清理
 * 或另一实例回滚删掉 —— 正常情况下第二次就能插进去。但若一直失败（DB 异常、
 * 极端并发清理），老实现 `return this.acquire(...)` 是**无上限递归**：
 * 请求线程永远转下去，既不给客户端响应，也不释放连接。
 */
const MAX_ACQUIRE_ATTEMPTS = 3;

/** 单批清理行数（避免一条长事务锁住整表） */
const PURGE_BATCH_SIZE = 500;

/**
 * 幂等服务：基于 DB 唯一键实现"占位 → 执行 → 记录/回放"。
 * 用 DB 而非 Redis，保证多实例强一致（Redis 仅可作前置快筛，后续增强）。
 */
@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyRecord)
    private readonly repo: Repository<IdempotencyRecord>,
  ) {}

  /** 尝试占位；已被占用则返回已有记录 */
  async acquire(
    key: string,
    requestHash: string,
    ttlSeconds: number,
  ): Promise<AcquireResult> {
    const expireAt = new Date(Date.now() + ttlSeconds * 1000);

    for (let attempt = 1; attempt <= MAX_ACQUIRE_ATTEMPTS; attempt++) {
      try {
        await this.repo.insert({
          key,
          requestHash,
          status: 'processing',
          expireAt,
        });
        return { acquired: true };
      } catch (err) {
        // 非唯一键冲突是真故障（连接断、字段超长……），直接抛
        if (!isDuplicateKeyError(err)) throw err;
      }

      const record = await this.repo.findOneBy({ key });
      if (record) return { acquired: false, record };

      // 冲突了但查不到 → 记录刚被清理/回滚，退避后重试占位
      if (attempt < MAX_ACQUIRE_ATTEMPTS) {
        await delay(10 * attempt);
      }
    }

    // 有上限的失败：给出可重试的明确响应，而不是让请求线程无限转
    throw new ApiException('幂等占位冲突，请稍后重试', 409);
  }

  /** 标记完成并记录响应体（供重复请求回放） */
  async complete(
    key: string,
    responseBody: Record<string, any>,
  ): Promise<void> {
    await this.repo.update({ key }, { status: 'done', responseBody });
  }

  /** 释放占位（业务失败时允许重试） */
  async release(key: string): Promise<void> {
    await this.repo.delete({ key });
  }

  /**
   * 回收已过期的幂等记录（由 IdempotencyCleanupTask 定时调用）。
   *
   * 不清理的后果：`sys_idempotency` 只增不减 —— 每个 POST/PUT 一行，
   * 每行最多留 24 小时的响应体 JSON。一个日均几千次写操作的校园系统，
   * 一年就是百万级行，且这表的唯一索引会越写越慢。
   *
   * 分批删除：单条 `DELETE` 扫全表会长时间持锁，进而阻塞正常请求的占位写入。
   */
  async purgeExpired(now = new Date()): Promise<number> {
    let total = 0;
    for (;;) {
      const rows = await this.repo
        .createQueryBuilder('i')
        .select('i.key', 'key')
        .where('i.expireAt < :now', { now })
        .limit(PURGE_BATCH_SIZE)
        .getRawMany<{ key: string }>();
      if (!rows.length) break;

      // 按主键删（不用子查询）：明确知道删了哪些，affected 也可核
      const res = await this.repo.delete(rows.map((r) => r.key));
      total += res.affected ?? rows.length;
      if (rows.length < PURGE_BATCH_SIZE) break;
    }
    return total;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 识别 MySQL 唯一键冲突 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; errno?: number; driverError?: unknown };
  if (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) return true;
  const driver = e.driverError as { code?: string; errno?: number } | undefined;
  return driver?.code === 'ER_DUP_ENTRY' || driver?.errno === 1062;
}
