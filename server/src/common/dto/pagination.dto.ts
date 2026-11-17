import { z } from 'zod';

/**
 * 通用分页入参 schema（若依风格：pageNum/pageSize）。
 * 业务分页查询 schema 用 `.extend({...})` 扩展本 schema。
 */
export const paginationSchema = z.object({
  pageNum: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

/** 统一分页返回结构 */
export interface PageResult<T> {
  list: T[];
  total: number;
}

/** 构造分页返回 */
export function buildPageResult<T>(list: T[], total: number): PageResult<T> {
  return { list, total };
}

// ---------------------------------------------------------------------------
// 查询过滤字段（前端表单清空后会把空串一起发出来，必须统一归一）
// ---------------------------------------------------------------------------

/**
 * 空串 → undefined。
 *
 * 为什么必须有这一层：
 * - `.optional()` 只放行 `undefined`，**不放行 `''`** → `?username=` 直接 400
 * - `z.coerce.number()('')` === `0` → 清空下拉框会**静默**变成「筛选 0」，
 *   返回的是错误数据集而不是报错，比 400 更危险
 * - 时间字段同理：`?startTime=` 会被 `z.iso.datetime()` 拒掉
 *
 * 语义约定：查询参数里的空串 = 调用方没填这个条件。
 */
const blankToUndefined = (value: unknown): unknown =>
  value === '' ? undefined : value;

/**
 * 把一个 schema 包成「可选过滤字段」：空串按未填处理。
 *
 * 所有过滤字段都应该经这里（或下面的 filterXxx），否则会踩两类坑：
 * - `.optional()` 不放行 `''` → `?username=` 直接 400
 * - `z.coerce.number()('')` === 0 → 清空筛选**静默**变成「筛选 0」
 */
export const filterOf = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/** 可选过滤字符串（`keyword` / `username` / `actorName` 之类） */
export const filterString = (max: number) => filterOf(z.string().max(max));

/** 可选 0/1 状态过滤 */
export const filterStatus = () =>
  filterOf(z.coerce.number().int().min(0).max(1));

/** 可选枚举过滤 */
export const filterEnum = <T extends readonly [string, ...string[]]>(
  values: T,
) => filterOf(z.enum(values));

/** 可选正整数过滤（部门 id 之类） */
export const filterId = () => filterOf(z.coerce.number().int().positive());

/** 可选 ISO 时间过滤（时间区间查询用） */
export const filterDateTime = () => filterOf(z.iso.datetime());
