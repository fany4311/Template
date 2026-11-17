import {
  HttpException,
  HttpStatus,
  type ArgumentsHost,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionFilter } from '../../src/common/filters/all-exception.filter.js';
import { ApiException } from '../../src/common/exceptions/api.exception.js';

/**
 * 全局异常过滤器的响应契约。
 *
 * 回归重点 —— 「HttpException 传字符串时 body.code 丢成 500」：
 * `new HttpException('msg', 403)` 的 `getResponse()` 是**裸字符串**，
 * 内置异常（NotFoundException 等）走 `createBody` 生成对象，所以只有
 * 「字符串构造 + 非 500 状态码」才踩这个坑 —— 正是限流（429）的类型。
 * 症状：HTTP 429 但 body.code=500，前端按 code 判会把限流误报成“服务器错误”。
 */
function runFilter(exception: unknown) {
  const filter = new AllExceptionFilter(
    { get: () => true } as never,
    { setContext: () => {}, error: () => {} } as never,
    { getId: () => 'trace-1' } as never,
  );

  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/api/v1/probe' }),
    }),
  } as unknown as ArgumentsHost;

  filter.catch(exception, host);
  return { httpStatus: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
}

describe('AllExceptionFilter 响应契约', () => {
  it('ApiException → HTTP 200 + 业务 code（若依约定）', () => {
    const { httpStatus, body } = runFilter(new ApiException('用户名或密码错误', 500));
    expect(httpStatus).toBe(200);
    expect(body).toMatchObject({ code: 500, msg: '用户名或密码错误', traceId: 'trace-1' });
  });

  it('字符串构造的 HttpException(429) → body.code 必须是 429，不能是 500', () => {
    const { httpStatus, body } = runFilter(
      new HttpException('请求过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS),
    );
    expect(httpStatus).toBe(429);
    expect(body.code).toBe(429);
    expect(body.msg).toBe('请求过于频繁，请稍后再试');
  });

  it('字符串构造的 HttpException(403) 同样回写 code', () => {
    const { httpStatus, body } = runFilter(
      new HttpException('禁止访问', HttpStatus.FORBIDDEN),
    );
    expect(httpStatus).toBe(403);
    expect(body.code).toBe(403);
  });

  it('非 500 状态码的裸 Error 仍收敛为 500（不泄露内部细节之外的信息）', () => {
    const { httpStatus, body } = runFilter(new Error('boom'));
    expect(httpStatus).toBe(500);
    expect(body.code).toBe(500);
    expect(body.msg).toBe('boom');
  });
});
