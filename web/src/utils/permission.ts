/**
 * 权限码匹配 —— 后端 `server/src/common/authz/permission.util.ts` 的**同源副本**。
 *
 * 唯一职责：决定「当前用户能不能看到某个按钮 / 菜单」，用于**界面显隐**。
 * **不是安全边界** —— 真正的拦截在后端 `RbacGuard`，前端藏起来只是不给用户
 * 点了必然 403 的按钮。
 *
 * 语义（与后端逐条对齐，改动必须三份一起改）：
 * - `*:*:*`         超管，匹配一切
 * - `system:*`      given 侧段末通配，匹配 `system:anything`
 * - `system:user:*` required 侧段末通配，匹配 `system:user:list` 等
 * - `!xxx`          否定授权，**deny 优先**
 *
 * 三份副本清单（顺序无关）：
 * 1. `server/src/common/authz/permission.util.ts`（唯一权威）
 * 2. `web_admin/src/utils/permission.ts`
 * 3. 本文件（`web` 最小壳）
 *
 * 本文件曾漏掉「required 侧段末通配」这一支，且注释写着「与后端语义保持一致」
 * —— 正是这种沉默的漂移最难发现。现在三份的一致性由**对照单测**守着：
 * `server/test/unit/permission-util.spec.ts` 同时导入三份实现、用同一张用例表
 * 逐个比对结果（故意让后端单测去读前端文件，是因为前端两个 app 都没有测试运行器，
 * 而为它们各引一套构建期依赖的代价，远大于这一个文件）。
 * 新增分支时先改那张表 —— 表红了再补实现。
 */

/**
 * 单条授权模式与 required 的匹配。
 * 支持双向段末通配：given 侧 `system:*`、required 侧 `system:user:*`。
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
export function matchPermission(
  userPermissions: string[],
  required: string,
): boolean {
  const list = userPermissions ?? [];

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
