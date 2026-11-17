import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../constants/decorator.constant.js';

/**
 * 接口角色要求（RBAC），由 RbacGuard 校验。
 *
 * 用法：`@RequiresRoles(0)` 或 `@RequiresRoles(0, 1)`
 *
 * 入参是**角色编号 level**，不是角色名：
 * - 名称可改（`roleName` 允许编辑），编号由 `RoleService.allocateLevel()` 分配后不可变；
 * - 内置固定 0–4（superadmin 0 / admin 1 / manager 2 / operator 3 / auditor 4），自建 5+。
 *
 * 语义：满足任一角色即可。
 *
 * 注意：系统管理域**优先用** `@RequiresPermissions`，因为权限可以只授一部分；
 * `@RequiresRoles` 是粗粒度过滤器，只在"整个接口只对某类角色开放"时才用。
 */
export const RequiresRoles = (...roles: number[]) =>
  SetMetadata(ROLES_KEY, roles);
