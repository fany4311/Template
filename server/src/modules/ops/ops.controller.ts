import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { Keep } from '../../common/decorators/keep.decorator.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { OpsService } from './ops.service.js';

const retentionSchema = z.coerce.number().int().min(7).max(3650);
const cleanupSchema = z
  .object({ retentionDays: retentionSchema.optional() })
  .default({});
const saveRetentionSchema = z.object({ retentionDays: retentionSchema });

/**
 * 系统监控（运维面）：运行概览 + Prometheus 指标 + 审计留存。
 *
 * 权限：system:ops:view（看）、system:ops:cleanup（改留存/立即清理）。
 * 指标端点例外：Prometheus 抓取没有 JWT，用「本机回环 + 可选 METRICS_TOKEN」把门，
 * 而不是让运维在抓取端配一个会过期的管理员 token。
 */
@ApiTags('系统监控')
@ApiBearerAuth()
@Controller('ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('overview')
  @RequiresPermissions('system:ops:view')
  @ApiOperation({ summary: '运行概览（HTTP / 数据库 / Outbox / 审计）' })
  overview() {
    return this.ops.overview();
  }

  @Get('metrics')
  @Public()
  @Keep()
  @ApiProduces('text/plain')
  @ApiOperation({ summary: 'Prometheus 指标（默认仅本机；配置 METRICS_TOKEN 后需带请求头）' })
  prometheus(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-metrics-token') token?: string,
  ): string {
    const expected = process.env.METRICS_TOKEN ?? '';
    const ip = req.ip ?? '';
    const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

    if (expected) {
      if (token !== expected) throw new ApiException('指标访问令牌无效', 403);
    } else if (!loopback) {
      throw new ApiException('指标端点仅限本机访问（或配置 METRICS_TOKEN）', 403);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return this.metrics.render();
  }

  @Put('audit-retention')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:ops:cleanup')
  @Auditable({ action: 'system:ops:retention', resourceType: 'audit' })
  @Idempotent({ scope: 'system:ops:retention' })
  @ApiOperation({ summary: '保存审计留存天数（写 sys_config.audit.retentionDays）' })
  async saveRetention(
    @Body({ schema: saveRetentionSchema }) body: { retentionDays: number },
  ) {
    const days = await this.ops.saveRetentionDays(body.retentionDays);
    return { retentionDays: days };
  }

  @Post('audit-cleanup')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:ops:cleanup')
  @Auditable({ action: 'system:ops:audit-cleanup', resourceType: 'audit' })
  @Idempotent({ scope: 'system:ops:audit-cleanup' })
  @ApiOperation({ summary: '立即清理过期审计（分批，最多 20 万条/次）' })
  cleanup(@Body({ schema: cleanupSchema }) body: { retentionDays?: number }) {
    return this.ops.cleanupAudit(body.retentionDays);
  }
}
