import { describe, expect, it } from 'vitest';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';
import { TransformInterceptor } from '../../src/common/interceptors/transform.interceptor.js';

/**
 * 回归保护：**不可**用「返回体有没有 `code` 字段」判断是否已经包装过。
 *
 * 老实现是 `if (keep || data?.code !== undefined) return data;`。任何自带 `code`
 * 列的业务对象（单据编号、字典编码、行政区划码）被单个详情接口直接 return 时，
 * 会被静默少包一层 —— 前端拿到 `{code, ...}` 而 `data` 是 `undefined`，
 * 不报错，只是那个接口的数据静默变空。
 */
function ctxFor(): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Ctrl {},
  } as unknown as ExecutionContext;
}

function make(keep: boolean) {
  const reflector = {
    getAllAndOverride: () => (keep ? true : undefined),
  } as unknown as Reflector;
  const interceptor = new TransformInterceptor(reflector);
  return async (data: unknown) =>
    firstValueFrom(
      interceptor.intercept(ctxFor(), {
        handle: () => of(data),
      } as CallHandler),
    );
}

describe('TransformInterceptor 包装规则', () => {
  it('业务对象自带 code 字段 → 仍要包装（这是老实现的坑）', async () => {
    const run = make(false);
    const biz = { code: 'HAZ-2026-0001', title: '实验室漏水' };
    expect(await run(biz)).toEqual({ code: 200, msg: '操作成功', data: biz });
  });

  it('code 是数字的业务对象同样要包装', async () => {
    const run = make(false);
    const biz = { code: 430100, name: '长沙市' };
    expect(await run(biz)).toEqual({ code: 200, msg: '操作成功', data: biz });
  });

  it('普通对象 / 数组 / 标量都包装', async () => {
    const run = make(false);
    expect(await run({ a: 1 })).toEqual({
      code: 200,
      msg: '操作成功',
      data: { a: 1 },
    });
    expect(await run([1, 2])).toEqual({
      code: 200,
      msg: '操作成功',
      data: [1, 2],
    });
    expect(await run(true)).toEqual({
      code: 200,
      msg: '操作成功',
      data: true,
    });
  });

  it('null / undefined 归一到 data: null（前端不必处理 undefined）', async () => {
    const run = make(false);
    expect(await run(null)).toEqual({
      code: 200,
      msg: '操作成功',
      data: null,
    });
    expect(await run(undefined)).toEqual({
      code: 200,
      msg: '操作成功',
      data: null,
    });
  });

  it('@Keep() 的接口原样返回（下载 / 健康检查 / 自定义 msg）', async () => {
    const run = make(true);
    const raw = { status: 'ok' };
    expect(await run(raw)).toBe(raw);
  });
});
