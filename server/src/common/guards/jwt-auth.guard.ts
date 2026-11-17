import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { PUBLIC_KEY } from '../constants/decorator.constant.js';
import { ApiException } from '../exceptions/api.exception.js';

/**
 * 全局 JWT 鉴权守卫（注册为 APP_GUARD，所有接口默认需要登录）。
 * 匿名接口用 @Public() 显式跳过（getHandler 元数据覆盖 getClass）。
 *
 * 校验链：passport-jwt 解析 Bearer token → JwtStrategy.validate
 * （查 Redis token 比对，支持登出/踢下线）→ request.user = { userId, username }
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /** 主动接管认证失败：统一转成业务异常，避免 passport 默认 401 响应格式 */
  handleRequest<TUser = any>(err: any, _user: any, _info: any): TUser {
    if (err || !_user) {
      throw err instanceof ApiException
        ? err
        : new ApiException('登录状态已过期', 401);
    }
    return _user;
  }
}
