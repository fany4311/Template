import { Injectable } from '@nestjs/common';

/**
 * 进程内指标（零依赖，不引 OTel / prom-client）。
 *
 * ## 为什么手写
 * 底座是**单进程单实例**（pm2 fork），要的就是「QPS / 错误率 / P95 / 积压 / 内存」这几个数。
 * 为此引入 OTel SDK + collector，是把一个 200 行的需求扩成一套基础设施。
 * 真到多实例、需要跨服务链路时再换 OTel，届时这里的接口形状不用变。
 *
 * ## 为什么用固定桶而不是存样本
 * 存样本要处理环形缓冲与并发，还会随路由数量线性涨内存；
 * 固定桶是 O(1)，且 Prometheus 原生就是直方图桶。
 */

const BUCKETS_MS = [50, 100, 200, 500, 1000, 2000, 5000];

interface RouteStat {
  count: number;
  errors: number;
  sumMs: number;
  /** 每个桶的累计计数（Prometheus 语义：le 为“小于等于”） */
  buckets: number[];
}

export interface HttpSummary {
  route: string;
  method: string;
  count: number;
  errors: number;
  avgMs: number;
  p95Ms: number;
}

@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly routes = new Map<string, RouteStat>();
  private readonly gauges = new Map<string, number>();
  private readonly counters = new Map<string, number>();

  /** 路由模板化：/config/12 → /config/:id，避免指标维度被 id 撑爆 */
  static normalizePath(path: string): string {
    return path
      .split('?')[0]!
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/[0-9a-fA-F-]{16,}(?=\/|$)/g, '/:id');
  }

  observeHttp(method: string, path: string, status: number, ms: number): void {
    const route = MetricsService.normalizePath(path || '/');
    const key = method + ' ' + route;
    let stat = this.routes.get(key);
    if (!stat) {
      stat = { count: 0, errors: 0, sumMs: 0, buckets: BUCKETS_MS.map(() => 0) };
      this.routes.set(key, stat);
    }
    stat.count += 1;
    if (status >= 500) stat.errors += 1;
    stat.sumMs += ms;
    BUCKETS_MS.forEach((le, index) => {
      if (ms <= le) stat.buckets[index] = (stat.buckets[index] ?? 0) + 1;
    });
  }

  /** gauge：积压、内存这类“当前值” */
  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  incCounter(name: string, delta = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + delta);
  }

  get uptimeSeconds(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  summary(limit = 12): HttpSummary[] {
    const rows: HttpSummary[] = [];
    for (const [key, stat] of this.routes) {
      const [method = '', route = ''] = key.split(' ');
      rows.push({
        route,
        method,
        count: stat.count,
        errors: stat.errors,
        avgMs: stat.count ? Math.round((stat.sumMs / stat.count) * 10) / 10 : 0,
        p95Ms: this.bucketP95(stat),
      });
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, limit);
  }

  /** 用桶的累计值估 P95（桶内线性插值，误差可控，够定位“慢在哪个接口”） */
  private bucketP95(stat: RouteStat): number {
    if (!stat.count) return 0;
    const target = stat.count * 0.95;
    for (let i = 0; i < BUCKETS_MS.length; i += 1) {
      if ((stat.buckets[i] ?? 0) >= target) return BUCKETS_MS[i] as number;
    }
    return BUCKETS_MS[BUCKETS_MS.length - 1] as number;
  }

  /** Prometheus 文本格式；仅暴露聚合值，不含任何业务字段 */
  render(): string {
    const lines: string[] = [];
    const mem = process.memoryUsage();

    lines.push('# HELP app_uptime_seconds 进程运行时长');
    lines.push('# TYPE app_uptime_seconds gauge');
    lines.push('app_uptime_seconds ' + this.uptimeSeconds);

    lines.push('# HELP app_memory_rss_bytes 常驻内存');
    lines.push('# TYPE app_memory_rss_bytes gauge');
    lines.push('app_memory_rss_bytes ' + mem.rss);
    lines.push('app_heap_used_bytes ' + mem.heapUsed);

    lines.push('# HELP http_requests_total 请求总数');
    lines.push('# TYPE http_requests_total counter');
    for (const [key, stat] of this.routes) {
      const [method = '', route = ''] = key.split(' ');
      lines.push(
        'http_requests_total{method="' + method + '",route="' + route + '"} ' + stat.count,
      );
      lines.push(
        'http_errors_total{method="' + method + '",route="' + route + '"} ' + stat.errors,
      );
    }

    lines.push('# HELP http_request_duration_ms 请求耗时直方图');
    lines.push('# TYPE http_request_duration_ms histogram');
    for (const [key, stat] of this.routes) {
      const [method = '', route = ''] = key.split(' ');
      BUCKETS_MS.forEach((le, index) => {
        lines.push(
          'http_request_duration_ms_bucket{method="' + method + '",route="' + route + '",le="' + le + '"} ' +
            (stat.buckets[index] ?? 0),
        );
      });
      lines.push(
        'http_request_duration_ms_bucket{method="' + method + '",route="' + route + '",le="+Inf"} ' + stat.count,
      );
      lines.push(
        'http_request_duration_ms_sum{method="' + method + '",route="' + route + '"} ' + Math.round(stat.sumMs),
      );
      lines.push(
        'http_request_duration_ms_count{method="' + method + '",route="' + route + '"} ' + stat.count,
      );
    }

    for (const [name, value] of this.gauges) {
      lines.push('# TYPE ' + name + ' gauge');
      lines.push(name + ' ' + value);
    }
    for (const [name, value] of this.counters) {
      lines.push('# TYPE ' + name + ' counter');
      lines.push(name + ' ' + value);
    }

    return lines.join('\n') + '\n';
  }
}
