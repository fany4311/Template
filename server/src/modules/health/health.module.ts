import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

/**
 * 健康检查模块：提供 liveness / readiness 探针，供 pm2、Nginx、负载均衡使用。
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
