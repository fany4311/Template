import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import type { Repository } from 'typeorm';
import { OutboxService } from '../../outbox/outbox.service.js';
import type { OutboxHandler } from '../../outbox/outbox.types.js';
import { HazardSync } from '../entities/hazard-sync.entity.js';
import {
  HAZARD_EVENT_TYPES,
  type HazardEventPayload,
} from '../hazard.events.js';
import {
  PROVINCE_SYNC_PORT,
  type ProvinceSyncPort,
} from '../ports/province-sync.port.js';

/**
 * 省平台同步处理器（Outbox 消费者）。
 *
 * 链路：
 *   HazardService（事务内）→ OutboxService.append('hazard.xxx')
 *   → OutboxPublisher 轮询 → 本处理器 → ProvinceSyncPort → biz_hazard_sync
 *
 * 为什么走 Outbox 而不是直接调：
 * - 省平台不可用时业务不受影响（本校侧闭环照常流转）
 * - 至少一次投递 + 失败重试，接口恢复后自动补推
 * - 处理器必须幂等（Outbox 语义），本实现的幂等点为 payload.eventId（事件唯一标识）
 */
@Injectable()
export class HazardSyncHandler implements OutboxHandler, OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(PROVINCE_SYNC_PORT)
    private readonly adapter: ProvinceSyncPort,
    @InjectRepository(HazardSync)
    private readonly repo: Repository<HazardSync>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HazardSyncHandler.name);
  }

  onModuleInit(): void {
    for (const eventType of HAZARD_EVENT_TYPES) {
      this.outbox.registerHandler(eventType, this);
    }
  }

  async handle(raw: Record<string, any>): Promise<void> {
    const payload = raw as HazardEventPayload;

    // 幂等：同一事件（eventId）已处理过则跳过（Outbox 至少一次投递）
    const duplicated = await this.repo.findOneBy({ eventId: payload.eventId });
    if (duplicated) {
      this.logger.debug(
        { eventId: payload.eventId, hazardNo: payload.hazardNo },
        '事件已同步，跳过重复投递',
      );
      return;
    }

    const result = await this.adapter.push(payload);

    await this.repo.save(
      this.repo.create({
        hazardId: payload.hazardId,
        hazardNo: payload.hazardNo,
        eventId: payload.eventId,
        eventType: payload.eventType,
        toStatus: payload.toStatus,
        direction: 'PUSH',
        status: result.success ? 'SUCCESS' : 'FAILED',
        requestBody: payload,
        responseBody: result.response ?? null,
        error: result.error ?? '',
        target: this.adapter.target,
      }),
    );

    if (!result.success) {
      // 抛错让 OutboxPublisher 走重试/退避
      throw new Error(result.error ?? '省平台同步失败');
    }
  }
}
