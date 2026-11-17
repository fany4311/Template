import { z } from 'zod';
import { parentIdSchema } from '../../../common/dto/parent-id.util.js';
import {
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';

/** 状态：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/**
 * 上级部门 ID（`null` = 顶级）。坑与写法见 `common/dto/parent-id.util.ts`。
 */

/** 创建部门 */
export const createDeptSchema = z.object({
  parentId: parentIdSchema,
  name: z.string().min(1, '部门名称不能为空').max(64),
  sort: z.coerce.number().int().optional(),
  status: statusSchema.optional(),
});
export type CreateDeptInput = z.infer<typeof createDeptSchema>;

/** 更新部门 */
export const updateDeptSchema = updateSchemaOf(createDeptSchema);
export type UpdateDeptInput = z.infer<typeof updateDeptSchema>;

/** 查询部门（平铺列表，前端可自行组树；也提供 /dept/tree） */
export const queryDeptSchema = paginationSchema.extend({
  keyword: filterString(64),
  status: filterStatus(),
});
export type QueryDeptInput = z.infer<typeof queryDeptSchema>;
