import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 获取当前登录用户（由 JwtStrategy.validate 挂到 request.user）。
 * 用法：
 *   @User() user: JwtUser           → 整个用户对象
 *   @User('userId') userId: number  → 取某个字段
 */
export const User = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
