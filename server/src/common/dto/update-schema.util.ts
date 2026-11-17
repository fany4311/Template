import { z } from 'zod';

/**
 * 由 create schema 派生 update（PATCH）schema，**剥离所有默认值**。
 *
 * ## 为什么不能直接用 `.partial()`
 * Zod 的 `.partial()` 只把字段包成 `ZodOptional`，**内层 `.default(x)` 依然生效**。
 * 实测（Zod 4.6.7）：
 *
 * ```ts
 * const create = z.object({ a: z.string().default(''), b: z.number().default(1) });
 * create.partial().parse({ });   // => { a: '', b: 1 }   ← 期望是 {}
 * ```
 *
 * 后果不是"多填两个字段"这么轻，而是**PATCH 退化成整条覆盖**：
 * 前端只想改菜单名称，请求体里没有 `perms`，DTO 却补上 `perms: ''`，
 * 服务层无法区分"用户想清空"和"用户没提"，于是把权限码、组件路径、图标全清掉。
 * 本项目 role / menu / config / dict 四个模块都踩过这个坑（PUT 后关联数据丢失）。
 *
 * ## 为什么不改成"服务层逐字段判 undefined"
 * 服务层看到的已经是补过默认值的对象，"没传"这个信息在 DTO 层就已丢失，
 * 下游再怎么判都判不出来。必须在**解析入口**把信息保住。
 *
 * ## 语义
 * - 每个字段变成可选（未传 → `undefined`，服务层据此决定是否覆盖）；
 * - 剥掉 `default` 包装，保留 `min/max/refine/transform` 等真实校验；
 * - 不引入 `nullish`：显式传 `null` 依旧按 schema 自身规则处理，
 *   避免"传 null 就等于清空"这种隐式约定扩散。
 */
export function updateSchemaOf<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      stripDefault(field as z.ZodType).optional(),
    ]),
  );
  return z.object(shape as T['shape']);
}

/**
 * 剥掉外层 `ZodDefault` 包装，拿到真正的校验器。
 * 只剥 default：`optional` / `nullable` 是调用方显式表达的语义，不应被抹除。
 */
function stripDefault(field: z.ZodType): z.ZodType {
  let current: unknown = field;
  // 逐层剥（支持 .default().default() 这种叠加写法；实际很少，但代价为零）
  while (
    current instanceof z.ZodDefault &&
    (current as z.ZodDefault<z.ZodType>).def.innerType
  ) {
    current = (current as z.ZodDefault<z.ZodType>).def.innerType;
  }
  return current as z.ZodType;
}
