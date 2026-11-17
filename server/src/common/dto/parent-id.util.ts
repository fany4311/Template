import { z } from 'zod';

/**
 * 树形资源的「上级 ID」字段（`null` = 顶级）。dept / menu 共用。
 *
 * ## 为什么不能只写 `z.coerce.number().int().positive().optional()`
 *
 * `z.coerce.number()` 会把 `null` / `''` 强转成 `0`，紧接着 `.positive()` 当场失败；
 * `0` 自己也会被拒。表现出来就是**节点一旦挂到别人下面，就永远搬不回顶级** ——
 * 前端「选『顶级』再保存」必然 400（已实测 `null`、`0` 两条都 FAIL）。
 * 所以先把这三种「想置根」的写法归一到 `null`。
 *
 * ## 为什么 `.optional()` 必须在外层
 *
 * `ZodOptional` 遇到 `undefined` 会短路、**不进入内层 preprocess**。于是：
 * - 未传 → `undefined`（= 用户没提这个字段，PATCH 应保持原样）
 * - 显式传 `null` / `0` / `''` → `null`（= 明确要求移到顶级）
 *
 * 服务层靠 `dto.parentId !== undefined` 区分这两者；若把 `.optional()` 写进内层，
 * 两者会被抹平，PATCH 就再也无法表达「不改父级」。
 *
 * 回归：`server/test/unit/parent-id.dto.spec.ts`。
 */
export const parentIdSchema = z.preprocess(
  (v) => (v === null || v === '' || v === 0 || v === '0' ? null : v),
  z.coerce.number().int().positive().nullable().optional(),
);
