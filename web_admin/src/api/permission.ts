import { request } from './http';
import type { PermissionGroup } from './types';

/**
 * 权限清单（只读）。
 *
 * 清单由后端 `pnpm authz:sync` 从代码里的 `@RequiresPermissions` 反射生成，
 * 前端**没有**写接口 —— 想加权限码就去写装饰器，然后同步。
 */
export const permissionApi = {
  groups: () => request.get<PermissionGroup[]>('/permission'),
};
