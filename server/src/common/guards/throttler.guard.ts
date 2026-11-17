import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  getOptionsToken,
  getStorageToken,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';

/**
 * 全局限流守卫：`ThrottlerGuard` 子类，只改两件事。
 *
 * ## 1. 超限时抛中文异常（保留 HTTP 429）
 * 默认抛 `ThrottlerException: Too Many Requests` —— 英文 + 框架内部类名，
 * 直接透给终端用户既看不懂、又像系统故障。
 *
 * 为什么保留 429 而不是走「业务异常 → HTTP 200 + body.code」：
 * 限流是基础设施语义，429 是标准状态码，让 Nginx、浏览器、客户端 SDK 的退避
 * （backoff）与监控统计能直接识别，不必解析 body。全局异常过滤器同时保证
 * body 里有 `code: 429`，前端两种判法都可用。
 *
 * ## 2. `THROTTLE_ENABLED=false` 时整体跳过
 * 给 e2e 用：测试里每个用例都要先登录拿 token，全部来自同一个 IP，
 * 全局 300/分钟 + 登录 5/分钟必然随机 429，表现为「测试时好时坏」。
 * 用 env 显式关闭，而不是在代码里硬编码 `NODE_ENV === 'test'` 判断 ——
 * 派生项目若想在测试里验证限流行为，把它设回 true 再给用例单独放宽即可。
 *
 * ## 计数键是「IP + 路由」
 * 见 `ThrottlerGuard.generateKey`。IP 是否可信取决于 `trust proxy` 配置
 * （`setup-app.ts`）—— 没配 trust proxy 时全校共用一个计数器，会误伤正常用户。
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super(options, storage, reflector);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (await super.shouldSkip(context)) return true;
    return !this.config.get<boolean>('app.throttleEnabled', true);
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    void context;
    throw new HttpException(
      '请求过于频繁，请稍后再试',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
