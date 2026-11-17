import { z } from 'zod';
import { PERMISSION_CODE_REGEX } from '../../../common/authz/permission-code.js';
import {
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';
import { DATA_SCOPE_VALUES } from '../../../common/enums/data-scope.enum.js';

/** CASL 规则 schema（RBAC/ABAC/ReBAC-lite） */
export const abilityRuleSchema = z.object({
  action: z.string().min(1).max(50),
  subject: z.string().min(1).max(50),
  conditions: z.record(z.string(), z.any()).optional(),
  fields: z.array(z.string()).optional(),
  inverted: z.boolean().optional(),
});

/** 状态：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/** 数据范围 */
const dataScopeSchema = z.enum(DATA_SCOPE_VALUES);

/**
 * 权限码段：小写字母开头，后跟小写字母/数字/连字符，最长 20。
 * 统一小写是为了避免 `System:Role:List` 与 `system:role:list` 并存 ——
 * 那种情况下界面"看起来有权限"、程序却匹配不上，排查成本极高。
 *
 * 正则本体已上提到 `common/authz/permission-code.ts`（权限清单采集器也要用），
 * 这里重新导出以保持既有 import 路径不变。
 */
export { PERMISSION_CODE_REGEX };

/**
 * 单个权限码。
 *
 * 接口**一律不受理**通配符 `*` 与否定前缀 `!`：
 * 它们不是"更灵活的权限码"，而是**底座级的授权手段** ——
 * 超管的 `*:*:*`、校级管理员的 `*:*:*,!system:*` 都由迁移/seed 写入，属于平台设计，
 * 不该由界面产生。放开的后果只有一个：任何拿到 `system:role:edit` 的角色，
 * 都能给自己的角色手输 `*:*:*` 完成提权（接口即造神）。
 *
 * 段数允许 2–3：`console:access` 是 2 段的正牌权限码，强行凑成 3 段只会更难读。
 */
export const permissionCodeSchema = z
  .string()
  .max(64, '权限码最长 64 个字符')
  .refine((v) => PERMISSION_CODE_REGEX.test(v), {
    message:
      '权限码格式非法：须为 2-3 段小写标识符（如 console:access、system:role:list），且不得包含 * 或 !',
  });

/** 权限码列表（整表限长，避免超大 body） */
export const permissionListSchema = z
  .array(permissionCodeSchema)
  .max(200, '单个角色的权限码最多 200 条')
  .default([]);

/**
 * 创建角色。
 *
 * 刻意**不含**两个字段：
 * - `level`（编号）：由 RoleService.allocateLevel() 在事务内分配，接口不可指定；
 * - `isBuiltin`（内置标记）：只由迁移/seed 维护（实体上 insert/update 均 false），
 *   否则接口就能造出「不可删角色」。
 */
export const createRoleSchema = z.object({
  roleName: z.string().min(1, '角色名称不能为空').max(50),
  permissions: permissionListSchema,
  rules: z.array(abilityRuleSchema).optional(),
  dataScope: dataScopeSchema.default('SELF'),
  status: statusSchema.default(1),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * 更新角色（全部可选）。
 *
 * 必须用 `updateSchemaOf` 而不是 `.partial()`：`permissions` / `dataScope` / `status`
 * 在 create schema 里带 `.default()`，而 `.partial()` 不会剥掉默认值 ——
 * 只改 `roleName` 的 PUT 会被默默填上 `permissions: []`、`status: 1`，
 * 变成整条覆盖。那不只是脏写，还会触发两件更糟的事：
 * 1) 超管（level 0）的权限被清空 → 系统锁死；
 * 2) 服务层判定授权变更 → 误踢持有人会话。
 */
export const updateRoleSchema = updateSchemaOf(createRoleSchema);
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** 查询角色（分页 + 关键字） */
export const queryRoleSchema = paginationSchema.extend({
  keyword: filterString(50),
  status: filterStatus(),
});
export type QueryRoleInput = z.infer<typeof queryRoleSchema>;
