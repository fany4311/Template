import { SetMetadata } from '@nestjs/common';
import { IDEMPOTENT_KEY } from '../constants/decorator.constant.js';

/**
 * 幂等元数据：标注哪些接口需要幂等保护（由 IdempotencyInterceptor 处理）。
 * 客户端通过请求头 `Idempotency-Key` 传入幂等键。
 *
 * 语义：
 * - 首次请求：占位 → 执行业务 → 记录响应
 * - 重复请求（同 key 同内容）：回放首次响应，不再执行业务
 * - 重复请求（同 key 不同内容）：409
 * - 并发重复（首次仍在处理中）：409
 *
 * 用法：
 *   @Idempotent()                                    // 默认必带 Idempotency-Key
 *   @Idempotent({ scope: 'hazard:report' })          // 自定义作用域
 *   @Idempotent({ required: false, ttlSeconds: 3600 })
 */
export interface IdempotentOptions {
  /** 作用域（默认 `${method} ${routePath}`），用于隔离不同接口的键空间 */
  scope?: string;
  /** 是否必须携带 Idempotency-Key（默认 true） */
  required?: boolean;
  /** 记录保留时长（秒），默认 24h */
  ttlSeconds?: number;
}

export const Idempotent = (options: IdempotentOptions = {}) =>
  SetMetadata(IDEMPOTENT_KEY, options);
