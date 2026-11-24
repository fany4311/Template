import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { ExtractJwt, Strategy, StrategyOptionsWithRequest } from 'passport-jwt';
import { ApiException } from '../../../common/exceptions/api.exception.js';
import { SessionService } from '../../../core/session/session.service.js';
import type { JwtUser, Payload } from '../auth.interface.js';

/**
 * JWT 校验策略：全局 JwtAuthGuard 认证通过后执行 validate。
 * 1. 解析 Bearer token → payload
 * 2. 与 Redis 中缓存的 token 比对（支持登出、踢下线、权限变更强制重登）
 * 3. 读取会话上下文（角色/权限/规则/部门/岗位）挂到 request.user
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly session: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('jwt.secret'),
      passReqToCallback: true,
    } as StrategyOptionsWithRequest);
  }

  async validate(request: Request, payload: Payload): Promise<JwtUser> {
    // 1. token 比对：Redis 里不存在或不一致 → 已登出/被踢/权限变更
    const token = (request.headers.authorization ?? '').slice(7);
    const cached = await this.session.getToken(payload.userId);
    if (!cached || cached !== token) {
      throw new ApiException('登录状态已过期', 401);
    }

    // 2. 读取会话上下文
    const ctx = await this.session.getContext(payload.userId);
    return {
      userId: payload.userId,
      username: payload.username,
      roles: ctx.roles,
      permissions: ctx.permissions,
      rules: ctx.rules,
      deptId: ctx.deptId,
      post: ctx.post,
      dataScopes: ctx.dataScopes,
      dataScopeDepts: ctx.dataScopeDepts,
    };
  }
}
