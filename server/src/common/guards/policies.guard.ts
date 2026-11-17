import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AbilityFactory } from '../authz/ability.factory.js';
import { AUTHZ_KEY } from '../constants/decorator.constant.js';
import type { PolicyHandler } from '../decorators/check-policies.decorator.js';
import { ApiException } from '../exceptions/api.exception.js';

/**
 * 策略守卫（全局）：执行 @CheckPolicies 声明的 CASL 策略。
 * 无元数据的接口自动放行（no-op）。位于 RbacGuard 之后。
 */
@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const handlers = this.reflector.getAllAndOverride<PolicyHandler[]>(
      AUTHZ_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!handlers?.length) return true;

    const request = context.switchToHttp().getRequest();
    const ability = this.abilityFactory.createForUser(request.user ?? {});

    const allowed = handlers.every((handler) => handler(ability));
    if (!allowed) throw new ApiException('没有访问权限', 403);
    return true;
  }
}
