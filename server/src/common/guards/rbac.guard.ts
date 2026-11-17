import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY, ROLES_KEY } from '../constants/decorator.constant.js';
import { ApiException } from '../exceptions/api.exception.js';
import { matchPermission } from '../authz/permission.util.js';

/**
 * RBAC 守卫：校验 @RequiresRoles / @RequiresPermissions。
 * 全局注册（APP_GUARD），无元数据的接口自动放行（no-op）。
 *
 * 权限来源：JwtStrategy 校验时从 Redis 取用户角色/权限缓存，
 * 挂到 request.user.roles / request.user.permissions。
 *
 * 权限码语法（allow + deny 两层，**deny 优先**）：
 * - `*:*:*`      → 允许一切（超管，由 seed 写入）
 * - `system:*`   → 允许 system 域全部（段末通配）
 * - `system:user:add` → 精确
 * - `!system:*`  → **禁止** system 域全部
 *
 * 例：`['*:*:*', '!system:*']` = 业务全权、但不得进入系统管理域。
 *
 * ⚠️ 通配符与 `!` 前缀**不会**从接口写入（RoleService 的 DTO 直接拒绝），
 * 只能由迁移/seed 产生 —— 否则任何拿到 `system:role:edit` 的角色
 * 都能给自己手输 `*:*:*` 完成提权。
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 角色校验：@RequiresRoles(0, 1) → 满足任一即可。
    // 入参是**角色编号 level**（不是角色名）：名称可改，编号才是稳定标识。
    const requiredRoles = this.reflector.getAllAndOverride<number[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles?.length) {
      const userRoles: number[] = user?.roles ?? [];
      const hasRole = requiredRoles.some((role) => userRoles.includes(role));
      if (!hasRole) throw new ApiException('没有访问权限', 403);
    }

    // 权限校验：@RequiresPermissions('a', 'b') → 满足任一；
    // @RequiresPermissions(['a','b'], 'c') → (a 且 b) 或 c
    const requiredPerms = this.reflector.getAllAndOverride<string[][]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredPerms?.length) {
      const userPerms: string[] = user?.permissions ?? [];
      const passed = requiredPerms.some((group) =>
        group.every((perm) => matchPermission(userPerms, perm)),
      );
      if (!passed) throw new ApiException('没有访问权限', 403);
    }

    return true;
  }
}
