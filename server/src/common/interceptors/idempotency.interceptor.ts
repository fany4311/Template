import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { Observable, catchError, defer, mergeMap, of, throwError } from 'rxjs';
import { IDEMPOTENT_KEY } from '../constants/decorator.constant.js';
import type { IdempotentOptions } from '../decorators/idempotent.decorator.js';
import { ApiException } from '../exceptions/api.exception.js';
import { IdempotencyService } from '../../modules/idempotency/idempotency.service.js';

interface AuthedRequest extends Request {
  user?: { userId?: number; username?: string };
}

const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

/** 需要幂等保护的方法（DELETE 语义上已幂等，不在此列） */
const IDEMPOTENT_METHODS = ['POST', 'PUT', 'PATCH'];

/**
 * 幂等拦截器（全局注册）：只对带 `@Idempotent()` 的 POST/PUT/PATCH 生效。
 *
 * 注意执行顺序：必须位于 TransformInterceptor **之上（更外层）**，
 * 因为回放的是"已包装后的最终响应体"，回放时短路会跳过下游 Transform。
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();

    const meta = this.reflector.getAllAndOverride<
      IdempotentOptions | undefined
    >(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<AuthedRequest>();

    // 幂等键只对「可能重复创建/修改」的方法生效：
    // GET/HEAD/OPTIONS 天然安全，DELETE 天然幂等（重复删除结果一致），
    // 若一并强制要求幂等键，客户端每个 DELETE 都得造键，收益为零。
    if (!IDEMPOTENT_METHODS.includes(req.method.toUpperCase())) {
      return next.handle();
    }
    const clientKey = headerValue(req.headers['idempotency-key']);
    const required = meta.required ?? true;

    if (!clientKey) {
      if (required) {
        throw new ApiException('缺少 Idempotency-Key 请求头', 400);
      }
      return next.handle();
    }

    const scope = meta.scope ?? `${req.method} ${req.route?.path ?? req.path}`;
    const userId = req.user?.userId ?? 'anon';
    const key = `${scope}:${userId}:${clientKey}`.slice(0, 191);
    const requestHash = fingerprint(req);

    const result = await this.idempotency.acquire(
      key,
      requestHash,
      meta.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    );

    if (!result.acquired) {
      const { record } = result;
      if (record.requestHash !== requestHash) {
        throw new ApiException('同一 Idempotency-Key 的请求内容不一致', 409);
      }
      if (record.status === 'done') {
        // 回放首次响应（已是包装后结构，短路下游）
        return of(record.responseBody ?? null);
      }
      throw new ApiException('请求正在处理中，请勿重复提交', 409);
    }

    return next.handle().pipe(
      mergeMap((value) =>
        this.idempotency
          .complete(key, value as Record<string, any>)
          .then(() => value),
      ),
      // 业务失败 → 释放占位（允许重试），并原样抛出业务错误
      catchError((err: unknown) =>
        defer(() => this.idempotency.release(key)).pipe(
          catchError(() => of(undefined)),
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}

/** 把 body 安全转为可哈希字符串并计算指纹 */
function fingerprint(req: AuthedRequest): string {
  let body = '';
  try {
    body = JSON.stringify(req.body ?? {});
  } catch {
    body = '';
  }
  return createHash('sha256')
    .update(`${req.method} ${req.originalUrl ?? req.url} ${body}`)
    .digest('hex');
}

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}
