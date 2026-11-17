import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { OutboxEvent } from './entities/outbox-event.entity.js';
import type { OutboxAppend, OutboxHandler } from './outbox.types.js';

/**
 * Outbox 服务：
 * - append()：在**当前事务**内写入事件（用 txHost.tx，保证与业务数据同事务原子提交）
 * - 处理器注册表：事件类型 → 处理器
 */
@Injectable()
export class OutboxService {
  private readonly handlers = new Map<string, OutboxHandler>();

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  /** 注册事件处理器（业务模块在 onModuleInit 中调用） */
  registerHandler(eventType: string, handler: OutboxHandler): void {
    this.handlers.set(eventType, handler);
  }

  getHandler(eventType: string): OutboxHandler | undefined {
    return this.handlers.get(eventType);
  }

  /**
   * 追加事件。必须在业务事务内调用（@Transactional / withTransaction），
   * 此时 txHost.tx 即事务 EntityManager，事件与业务数据一并提交或回滚。
   */
  async append(entry: OutboxAppend): Promise<void> {
    const repo = this.txHost.tx.getRepository(OutboxEvent);
    await repo.save(
      repo.create({
        eventType: entry.eventType,
        payload: entry.payload,
        aggregateType: entry.aggregateType,
        aggregateId: entry.aggregateId,
        status: 'pending',
        retries: 0,
        availableAt: entry.availableAt ?? new Date(),
      }),
    );
  }
}
