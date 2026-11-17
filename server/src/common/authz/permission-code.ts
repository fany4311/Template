/**
 * 权限码格式规范 —— **唯一出处**。
 *
 * 被三处共用：
 * - `role.dto.ts`：接口入参校验（挡住界面手输 `*:*:*` 提权）
 * - `permission-catalog.ts`：从装饰器反射时筛掉通配/否定，只留具体码
 * - `scripts/authz-sync.ts`：同步前的一致性检查
 *
 * ## 规范
 * `域:资源[:动作]`，2–3 段，每段小写字母开头、可含数字与连字符。
 * - `console:access`      合法（2 段）
 * - `system:role:list`    合法（3 段）
 * - `System:Role:List`    非法（大写会让界面"看着有"、匹配不上）
 * - `system:*` / `*:*:*`  非法（通配是**底座级授权手段**，只能由迁移/seed 写入）
 * - `!system:x`           非法（否定授权同理）
 *
 * 为什么强制小写：权限匹配是**字符串**匹配，大小写不统一会出现
 * "权限列表里明明有，接口就是 403"这类极难排查的故障。
 */
const PERMISSION_SEGMENT = '[a-z][a-z0-9-]{0,19}';

/** 权限码整体格式：`域:资源[:动作]`，2–3 段 */
export const PERMISSION_CODE_REGEX = new RegExp(
  `^${PERMISSION_SEGMENT}(:${PERMISSION_SEGMENT}){1,2}$`,
);

/** 是否为"具体权限码"（排除通配 `*` 与否定 `!`，即可安全放进清单的） */
export function isConcretePermissionCode(code: string): boolean {
  return PERMISSION_CODE_REGEX.test(code);
}

/** 取模块键（权限码第一段） */
export function moduleKeyOf(code: string): string {
  return code.split(':')[0] || code;
}
