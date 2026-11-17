import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Keep } from '../../common/decorators/keep.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';

/**
 * 健康检查：
 * - /api/v1/health/live  ：存活探针（不查依赖，进程在跑即 up）
 * - /api/v1/health/ready ：就绪探针（检查数据库连通）
 * 用 @Keep() 跳过统一响应包装，返回 Terminus 原生结构，便于监控/编排系统消费。
 */
@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Get('live')
  @Public()
  @Keep()
  @ApiOperation({ summary: '存活探针（liveness）' })
  live() {
    return { status: 'up', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @Public()
  @Keep()
  @HealthCheck()
  @ApiOperation({ summary: '就绪探针（readiness，含数据库）' })
  ready() {
    return this.health.check([
      // Terminus v12：超时用 .withTimeout() 链式，替代已废弃的 options.timeout
      () => this.db.pingCheck('database').withTimeout(1500),
    ]);
  }
}
