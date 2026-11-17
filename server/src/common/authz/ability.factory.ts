import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import type { AbilityRule, AppAbility } from './ability.types.js';

/** 构建 ability 所需的用户主体信息 */
export interface AuthzUser {
  permissions?: string[];
  rules?: AbilityRule[];
  /** 预留：用于 ${deptId} / ${userId} 之类条件的运行时替换 */
  deptId?: number;
  userId?: number;
}

const SUPER_PERMISSION = '*:*:*';

/**
 * 权限工厂：由用户的权限码 + 显式规则构建 CASL ability。
 * - 权限码含 '*:*:*' → manage all（超管）
 * - 角色携带的 AbilityRule（含 conditions）→ RBAC + ABAC + ReBAC-lite
 */
@Injectable()
export class AbilityFactory {
  createForUser(user: AuthzUser): AppAbility {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createMongoAbility,
    );

    if (user.permissions?.includes(SUPER_PERMISSION)) {
      can('manage', 'all');
    }

    for (const rule of user.rules ?? []) {
      const conditions = resolveConditions(rule.conditions, user);
      if (rule.inverted) {
        cannot(rule.action, rule.subject, rule.fields, conditions);
      } else {
        can(rule.action, rule.subject, rule.fields, conditions);
      }
    }

    return build();
  }
}

/**
 * 解析条件里的占位符：`${userId}` / `${deptId}` → 当前用户属性。
 * 这是 ReBAC-lite 的实现方式（关系维度：本人、本部门）。
 */
export function resolveConditions(
  conditions: Record<string, any> | undefined,
  user: AuthzUser,
): Record<string, any> | undefined {
  if (!conditions) return undefined;
  const vars: Record<string, unknown> = {
    userId: user.userId,
    deptId: user.deptId,
  };
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(conditions)) {
    out[key] =
      typeof value === 'string' && value.startsWith('${') && value.endsWith('}')
        ? vars[value.slice(2, -1)]
        : value;
  }
  return out;
}
