/**
 * 权限码匹配工具 —— **后端权威实现**。
 *
 * 前端有两份副本：`web_admin/src/utils/permission.ts`、`web/src/utils/permission.ts`
 * （最小壳）。三者必须同源，一致性由 `server/test/unit/permission-util.spec.ts`
 * 的对照单测守着 —— 改匹配规则时先改那张用例表，表红了再补三份实现。
 *
 * 约定：
 * - `*:*:*`            超管，匹配一切（由迁移/seed 写入，接口从不接受）
 * - `system:*`         段末通配（前缀匹配）
 * - `system:user:*`    作为 required 时同样按段末通配比较
 * - `!xxx`             否定授权，**deny 优先**（同样只由迁移/seed 写入）
 *
 * 为什么通配/否定只能由底座写入（迁移、seed），而不给接口：
 * 任何持有 `system:role:edit` 的人都能编辑角色权限串，若接口接受 `*:*:*`，
 * 这人就能给自己那条角色手输通配，一步完成提权 —— 不需要任何漏洞，只是功能太宽。
 * 所以 `role.dto.ts` 的 `PERMISSION_CODE_REGEX` 强制 2–3 段小写标识符，
 * 显式拒绝 `*` 与 `!`。
 */

/**
 * 单条授权模式与 required 的匹配。
 * 支持双向的段末通配：given 侧 `system:*`、required 侧 `system:user:*`。
 */
function matchPattern(granted: string, required: string): boolean {
  // 超管
  if (granted === '*:*:*') return true;
  // 完全相等
  if (granted === required) return true;

  // given 以 ':*' 结尾 → 前缀通配（'system:*' 匹配 'system:user:list'）
  if (granted.endsWith(':*')) {
    return required.startsWith(granted.slice(0, -1));
  }
  // required 以 ':*' 结尾 → 反向前缀通配（given 'system:user:list' 匹配 required 'system:user:*'）
  if (required.endsWith(':*')) {
    return granted.startsWith(required.slice(0, -1));
  }
  return false;
}

/**
 * 是否拥有某个权限码。
 * deny 优先：只要有一条否定授权（`!` 开头）命中 required，立即返回 false，
 * 即使同时存在允许授权也不放行。
 */
export function matchPermission(granted: string[], required: string): boolean {
  const list = granted ?? [];

  // 第一步：否定授权命中即拒绝
  const denied = list
    .filter((p) => p.startsWith('!'))
    .some((p) => matchPattern(p.slice(1), required));
  if (denied) return false;

  // 第二步：任一允许授权命中即放行
  return list
    .filter((p) => !p.startsWith('!'))
    .some((p) => matchPattern(p, required));
}

/** 导出单条匹配，供单测核对与前端的一致性 */
export { matchPattern };
