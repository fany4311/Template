import {
  HttpException,
  HttpStatus,
  type ExecutionContext,
} from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppThrottlerGuard } from '../../src/common/guards/throttler.guard.js';

/**
 * 限流守卫的两个非默认行为：
 *   1. 超限抛中文异常，且**保留 HTTP 429**（默认是英文 + 框架内部类名）
 *   2. `THROTTLE_ENABLED=false` 时整体跳过 —— e2e 必需，否则同 IP 高频登录随机 429
 */
function buildGuard(throttleEnabled: boolean) {
  return new AppThrottlerGuard(
    [] as never,
    {} as never,
    {} as never,
    { get: () => throttleEnabled } as never,
  );
}

const ctx = {} as ExecutionContext;

describe('AppThrottlerGuard', () => {
  it('超限抛 HttpException 429 + 中文提示', async () => {
    const guard = buildGuard(true);
    const call = () =>
      (
        guard as unknown as {
          throwThrottlingException(c: ExecutionContext): Promise<void>;
        }
      ).throwThrottlingException(ctx);

    await expect(call()).rejects.toBeInstanceOf(HttpException);
    await call().catch((err: HttpException) => {
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(err.message).toBe('请求过于频繁，请稍后再试');
    });
  });

  it('THROTTLE_ENABLED=true 时不跳过', async () => {
    const guard = buildGuard(true);
    await expect(
      (
        guard as unknown as {
          shouldSkip(c: ExecutionContext): Promise<boolean>;
        }
      ).shouldSkip(ctx),
    ).resolves.toBe(false);
  });

  it('THROTTLE_ENABLED=false 时跳过限流', async () => {
    const guard = buildGuard(false);
    await expect(
      (
        guard as unknown as {
          shouldSkip(c: ExecutionContext): Promise<boolean>;
        }
      ).shouldSkip(ctx),
    ).resolves.toBe(true);
  });
});
