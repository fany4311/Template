import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEvent } from './entities/outbox-event.entity.js';
import { OutboxCleanupTask } from './outbox.cleanup.task.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { OutboxService } from './outbox.service.js';

/**
 * Outbox 模块（全局）：事务性发件箱，提供可靠事件投递底座。
 * - OutboxService.append：事务内写事件
 * - OutboxPublisher：轮询并投递到已注册处理器
 * - OutboxCleanupTask：回收终态（sent / failed）历史事件，防表无限增长
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxEvent])],
  providers: [OutboxService, OutboxPublisher, OutboxCleanupTask],
  exports: [OutboxService],
})
export class OutboxModule {}
