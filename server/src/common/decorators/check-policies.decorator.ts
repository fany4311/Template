import { SetMetadata } from '@nestjs/common';
import { AUTHZ_KEY } from '../constants/decorator.constant.js';
import type { AppAbility } from '../authz/ability.types.js';

/** 策略处理器：给定 ability，返回是否放行 */
export type PolicyHandler = (ability: AppAbility) => boolean;

/**
 * 声明式策略校验（CASL），由 PoliciesGuard 执行。
 *
 * 与 RBAC（@RequiresPermissions 权限码）互补：
 * - RBAC 管"能不能进这个接口"
 * - CheckPolicies 管"能不能对这个资源做这个动作（可带条件）"
 *
 * 用法：
 *   @CheckPolicies((a) => a.can('read', 'User'))
 *   @CheckPolicies((a) => a.can('update', 'Hazard'))   // 结合服务内条件校验
 */
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(AUTHZ_KEY, handlers);
