import { SetMetadata } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../constants/decorator.constant.js';

/**
 * 接口权限要求（RBAC），由 RbacGuard 校验。
 * 用法：@RequiresPermissions('system:user:list')
 * 语义：字符串参数 = 任一满足即可（OR）；
 * 数组参数 = 全部满足（AND）。
 * 例：@RequiresPermissions(['a', 'b'], 'c') → 需要 (a 且 b) 或 c。
 *
 * 权限码支持段末通配与否定（deny 优先）：`system:*`、`!system:*`。
 */
export const RequiresPermissions = (...permissions: (string | string[])[]) =>
  SetMetadata(
    PERMISSIONS_KEY,
    permissions.map((p) => (Array.isArray(p) ? p : [p])),
  );
