import { z } from 'zod';
import { parentIdSchema } from '../../../common/dto/parent-id.util.js';
import {
  filterStatus,
  filterString,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';
import { MENU_TYPES } from '../entities/menu.entity.js';

/** 状态：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/** 是否显示：1 显示 / 0 隐藏 */
const visibleSchema = z.coerce.number().int().min(0).max(1);

/** 创建菜单 */
export const createMenuSchema = z.object({
  parentId: parentIdSchema,
  name: z.string().min(1, '菜单名称不能为空').max(50),
  type: z.enum(MENU_TYPES),
  path: z.string().max(200).default(''),
  component: z.string().max(255).default(''),
  perms: z.string().max(100).default(''),
  icon: z.string().max(64).default(''),
  sort: z.coerce.number().int().optional(),
  visible: visibleSchema.default(1),
  status: statusSchema.default(1),
});
export type CreateMenuInput = z.infer<typeof createMenuSchema>;

/** 更新菜单（全部可选） */
export const updateMenuSchema = updateSchemaOf(createMenuSchema);
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;

/** 查询菜单（不分页，返回全量树） */
export const queryMenuSchema = z.object({
  keyword: filterString(50),
  status: filterStatus(),
});
export type QueryMenuInput = z.infer<typeof queryMenuSchema>;
