import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { Observable, catchError, from, map, mergeMap, throwError } from 'rxjs';
import { AUDIT_KEY } from '../constants/decorator.constant.js';
import type { AuditMetadata } from '../decorators/auditable.decorator.js';
import { AuditService } from '../../modules/audit/audit.service.js';
import type { AuditEntry } from '../../modules/audit/audit.types.js';

interface AuthedRequest extends Request {
  user?: { userId?: number; username?: string };
}

/**
 * 审计拦截器（全局注册）：只对带 `@Auditable()` 元数据的接口生效，其余 no-op。
 * 在成功/失败两条路径上都投递审计条目。
 *
 * 是否等落库由 `AUDIT_MODE` 决定（见 AuditService）：
 * - `async`（默认）`record()` 返回 void，这里就不会阻塞响应
 * - `sync` `record()` 返回 Promise，这里 await 完再放行 —— 让审计写入的延迟与
 *   失败在请求上可见（审计合规场景用），但仍不回滚业务
 *
 * 之所以用 `mergeMap` 而不是 `tap`：`tap` 的副作用回调不会等待 Promise，
 * 用 tap 写 `await` 只能得到"语法上 await 了、实际没等"的假同步。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly cls: ClsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const meta = this.reflector.getAllAndOverride<AuditMetadata | undefined>(
      AUDIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const start = Date.now();

    return next.handle().pipe(
      mergeMap((value) =>
        from(this.write(meta, req, start, 'success')).pipe(map(() => value)),
      ),
      catchError((err: unknown) =>
        from(this.write(meta, req, start, 'fail', err)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }

  private async write(
    meta: AuditMetadata,
    req: AuthedRequest,
    start: number,
    result: 'success' | 'fail',
    err?: unknown,
  ): Promise<void> {
    const user = req.user;
    const rawId = meta.resourceIdParam
      ? req.params?.[meta.resourceIdParam]
      : undefined;

    const entry: AuditEntry = {
      traceId: this.cls.getId(),
      actorId: user?.userId,
      actorName: user?.username,
      action: meta.action,
      resourceType: meta.resourceType,
      resourceId: rawId != null ? String(rawId) : undefined,
      result,
      errorCode: result === 'fail' ? extractErrorCode(err) : undefined,
      method: req.method,
      path: req.originalUrl ?? req.url,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 255),
      durationMs: Date.now() - start,
    };
    const pending = this.audit.record(entry);
    // sync 模式才有 Promise，等它落库；async 模式直接放行
    if (pending) await pending;
  }
}

/** 从异常中提取机器可读错误码（Nest 12 errorCode / 业务错误码） */
function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const anyErr = err as { errorCode?: unknown; getErrCode?: () => unknown };
  if (typeof anyErr.errorCode === 'string') return anyErr.errorCode;
  if (typeof anyErr.getErrCode === 'function') {
    const code = anyErr.getErrCode();
    if (typeof code === 'string' || typeof code === 'number') {
      return String(code);
    }
    return undefined;
  }
  return undefined;
}
