import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { ConfigService } from '../config/config.service.js';

/** 审计留存天数：sys_config 的 audit.retentionDays > 环境变量 > 默认 180 */
const CONFIG_KEY = 'audit.retentionDays';
const DEFAULT_RETENTION_DAYS = 180;
const BATCH_SIZE = 2000;

export interface OpsOverview {
  app: { uptimeSeconds: number; rssMb: number; heapMb: number; node: string };
  http: ReturnType<MetricsService['summary']>;
  db: { up: boolean; latencyMs: number };
  outbox: { pending: number; failed: number };
  audit: {
    total: number;
    earliest: string | null;
    latest: string | null;
    retentionDays: number;
  };
}

/**
 * 运维面板的数据源（后台「系统监控」页 + /metrics）。
 *
 * 不做独立监控系统：单进程底座要的就是 QPS/错误率/P95/积压/内存几个数；
 * 真要 Prometheus+Grafana 是项目级决定，底座只保证指标口径稳定。
 *
 * 审计留存也放这里：它是运行时维护动作（定时 + 手动），
 * 和监控面板是同一件事的两面，拆开反而要在两个模块间传配置。
 */
@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async overview(): Promise<OpsOverview> {
    const memory = process.memoryUsage();
    const db = await this.pingDb();
    const [outbox, audit] = await Promise.all([
      this.outboxCounts(),
      this.auditStats(),
    ]);

    return {
      app: {
        uptimeSeconds: this.metrics.uptimeSeconds,
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapMb: Math.round(memory.heapUsed / 1024 / 1024),
        node: process.version,
      },
      http: this.metrics.summary(),
      db,
      outbox,
      audit: { ...audit, retentionDays: await this.retentionDays() },
    };
  }

  private async pingDb(): Promise<{ up: boolean; latencyMs: number }> {
    const started = Date.now();
    try {
      await this.dataSource.query('SELECT 1');
      return { up: true, latencyMs: Date.now() - started };
    } catch {
      return { up: false, latencyMs: Date.now() - started };
    }
  }

  private async outboxCounts(): Promise<{ pending: number; failed: number }> {
    try {
      const rows: Array<{ status: string; c: string | number }> =
        await this.dataSource.query(
          'SELECT status, COUNT(*) AS c FROM sys_outbox GROUP BY status',
        );
      const pick = (status: string): number => {
        const hit = rows.find((r) => r.status === status);
        return hit ? Number(hit.c) : 0;
      };
      return {
        pending: pick('pending') + pick('processing'),
        failed: pick('failed'),
      };
    } catch {
      return { pending: 0, failed: 0 };
    }
  }

  private async auditStats(): Promise<{
    total: number;
    earliest: string | null;
    latest: string | null;
  }> {
    try {
      const rows: Array<{
        c: string | number;
        minT: Date | null;
        maxT: Date | null;
      }> = await this.dataSource.query(
        'SELECT COUNT(*) AS c, MIN(create_time) AS minT, MAX(create_time) AS maxT FROM sys_audit_log',
      );
      const row = rows[0];
      return {
        total: row ? Number(row.c) : 0,
        earliest: row?.minT ? new Date(row.minT).toISOString() : null,
        latest: row?.maxT ? new Date(row.maxT).toISOString() : null,
      };
    } catch {
      return { total: 0, earliest: null, latest: null };
    }
  }

  async retentionDays(): Promise<number> {
    try {
      const result = await this.config.getValue(CONFIG_KEY);
      const parsed = Number(result.configValue);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    } catch {
      // 未配置是常态
    }
    const env = Number(process.env.AUDIT_RETENTION_DAYS);
    return Number.isFinite(env) && env > 0
      ? Math.floor(env)
      : DEFAULT_RETENTION_DAYS;
  }

  /** 保存留存天数（写 sys_config；按键 upsert，不新增接口） */
  async saveRetentionDays(days: number): Promise<number> {
    const existing: Array<{ id: number }> = await this.dataSource.query(
      'SELECT id FROM sys_config WHERE config_key = ? LIMIT 1',
      [CONFIG_KEY],
    );
    if (existing.length) {
      await this.dataSource.query(
        'UPDATE sys_config SET config_value = ?, update_time = NOW() WHERE id = ?',
        [String(days), existing[0]!.id],
      );
      return days;
    }
    await this.dataSource.query(
      [
        'INSERT INTO sys_config (config_name, config_key, config_value, config_type, status, remark)',
        "VALUES ('审计日志留存天数', ?, ?, 'Y', 1, '系统监控页可改')",
      ].join(' '),
      [CONFIG_KEY, String(days)],
    );
    return days;
  }

  /**
   * 分批删除过期审计。
   *
   * 为什么分批：一次删 50 万行会长时间持锁、把 binlog 撑爆，期间写接口全被拖慢。
   * 每批 2000 行、最多 100 批（一轮上限 20 万），没删完下一小时 cron 继续。
   */
  async cleanupAudit(
    retentionDays?: number,
  ): Promise<{ deleted: number; retentionDays: number }> {
    const days = retentionDays ?? (await this.retentionDays());
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let deleted = 0;

    for (let round = 0; round < 100; round += 1) {
      const result: { affectedRows?: number } = await this.dataSource.query(
        'DELETE FROM sys_audit_log WHERE create_time < ? ORDER BY id LIMIT ?',
        [cutoff, BATCH_SIZE],
      );
      const affected = Number(result.affectedRows ?? 0);
      deleted += affected;
      if (affected < BATCH_SIZE) break;
    }

    if (deleted > 0) {
      this.logger.log(
        '审计清理：删除 ' +
          deleted +
          ' 条（早于 ' +
          cutoff.toISOString() +
          '，留存 ' +
          days +
          ' 天）',
      );
    }
    this.metrics.incCounter('audit_cleanup_deleted_total', deleted);
    return { deleted, retentionDays: days };
  }

  /** 每小时清理一次过期审计（outbox / 幂等 / 文件都有，审计以前缺这条） */
  @Cron(CronExpression.EVERY_HOUR, { name: 'audit-cleanup' })
  async auditCleanupTask(): Promise<void> {
    try {
      await this.cleanupAudit();
      await this.refreshGauges();
    } catch (error) {
      this.logger.error('审计清理失败：' + (error as Error).message);
    }
  }

  /** gauge 需要查库，每 5 分钟刷新一次（不在渲染 /metrics 时查库，避免拖慢抓取） */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'ops-gauges' })
  async refreshGauges(): Promise<void> {
    const [outbox, audit] = await Promise.all([
      this.outboxCounts(),
      this.auditStats(),
    ]);
    this.metrics.setGauge('outbox_pending', outbox.pending);
    this.metrics.setGauge('outbox_failed', outbox.failed);
    this.metrics.setGauge('audit_rows_total', audit.total);
  }
}
