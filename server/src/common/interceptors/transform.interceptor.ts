import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { KEEP_KEY } from '../constants/decorator.constant.js';

/** 统一成功响应结构 */
export interface AjaxResult<T = any> {
  code: number;
  msg: string;
  data: T;
}

/** 构造成功响应 */
export function success<T>(data: T, msg = '操作成功'): AjaxResult<T> {
  return { code: 200, msg, data };
}

/**
 * 统一响应包装拦截器（全局注册）：
 *   controller/service 直接 return 业务数据 → 自动包装为 { code: 200, msg, data }
 *
 * ## 跳过包装：只认 `@Keep()`，**不做形状猜测**
 * 曾经这里还有一条启发式：`data?.code !== undefined` 就视为「已经包装过」而跳过。
 * 那条规则把「业务对象恰好有个 code 字段」当成了「已包装」—— 任何带 `code` 列
 * 的实体（单据编号、字典编码、行政区划码……）一旦被单个详情接口直接 return，
 * 就会被静默地少包一层：前端拿到 `{code, ...}` 而 `data` 是 `undefined`。
 * 类 bug 不会报错，只会让某个接口的 `data` 静默变空。
 *
 * 现在想自己控制 `msg` / 结构，就写 `@Keep()` + `return success(..., '自定义消息')`
 * —— 意图显式写在代码上，不靠猜。
 *
 * 状态码约定：成功统一 HTTP 200（含 POST），前端只看 body.code。
 * 由各 POST 处理器上的 `@HttpCode(HttpStatus.OK)` 保证（Nest 默认 POST=201）。
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        // getHandler 元数据覆盖 getClass
        const keep = this.reflector.getAllAndOverride<boolean>(KEEP_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (keep) return data;
        return success(data ?? null);
      }),
    );
  }
}
