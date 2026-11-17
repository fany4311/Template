import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyRecord } from './entities/idempotency-record.entity.js';
import { IdempotencyCleanupTask } from './idempotency.cleanup.task.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * 幂等模块（全局）：提供 IdempotencyService，供 IdempotencyInterceptor 使用；
 * 自带过期回收定时任务（sys_idempotency 无上限增长）。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [IdempotencyService, IdempotencyCleanupTask],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
