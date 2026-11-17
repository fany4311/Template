import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { MetricsService } from './metrics.service.js';

/**
 * HTTP 指标采集：放在拦截器链**最外层**，才能把过滤/守卫之后的时间也算进去。
 * 用 finalize 而不是 tap：异常路径（4xx/5xx）也要计数，否则错误率永远是 0。
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const started = Date.now();

    return next.handle().pipe(
      finalize(() => {
        const res = context.switchToHttp().getResponse<Response>();
        this.metrics.observeHttp(
          req.method,
          req.baseUrl + (req.path || ''),
          res.statusCode,
          Date.now() - started,
        );
      }),
    );
  }
}
