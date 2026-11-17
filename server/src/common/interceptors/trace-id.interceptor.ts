import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable } from 'rxjs';

/**
 * 把 CLS 里的 traceId 回写到响应头 X-Trace-Id。
 * 客户端/前端报错时带上该 id，可在日志/链路中直接定位本次请求。
 * traceId 由 ClsModule 的 idGenerator（uuid）在中间件阶段生成。
 */
@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const res = context.switchToHttp().getResponse<Response>();
      const traceId = this.cls.getId();
      if (traceId && !res.headersSent) {
        res.setHeader('X-Trace-Id', traceId);
      }
    }
    return next.handle();
  }
}
