import { z } from 'zod';
import {
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';

/** 状态：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/** 字典类型标识：仅字母、数字、下划线 */
const dictTypeKeySchema = z
  .string()
  .min(1, '字典类型标识不能为空')
  .max(100)
  .regex(/^[a-zA-Z0-9_]+$/, '字典类型标识只能包含字母、数字、下划线');

/** 创建字典类型 */
export const createDictTypeSchema = z.object({
  dictName: z.string().min(1, '字典名称不能为空').max(100),
  dictType: dictTypeKeySchema,
  status: statusSchema.default(1),
  remark: z.string().max(255).default(''),
});
export type CreateDictTypeInput = z.infer<typeof createDictTypeSchema>;

/** 更新字典类型（全部可选） */
export const updateDictTypeSchema = updateSchemaOf(createDictTypeSchema);
export type UpdateDictTypeInput = z.infer<typeof updateDictTypeSchema>;

/** 查询字典类型（分页 + 关键字/状态） */
export const queryDictTypeSchema = paginationSchema.extend({
  keyword: filterString(100),
  status: filterStatus(),
});
export type QueryDictTypeInput = z.infer<typeof queryDictTypeSchema>;

/** 创建字典数据 */
export const createDictDataSchema = z.object({
  dictType: z.string().min(1, '字典类型标识不能为空').max(100),
  dictLabel: z.string().min(1, '显示名不能为空').max(100),
  dictValue: z.string().min(1, '值不能为空').max(100),
  dictSort: z.coerce.number().int().optional(),
  tagType: z.string().max(20).default(''),
  status: statusSchema.default(1),
  remark: z.string().max(255).default(''),
});
export type CreateDictDataInput = z.infer<typeof createDictDataSchema>;

/** 更新字典数据（全部可选） */
export const updateDictDataSchema = updateSchemaOf(createDictDataSchema);
export type UpdateDictDataInput = z.infer<typeof updateDictDataSchema>;

/** 查询字典数据（分页 + 类型/关键字/状态） */
export const queryDictDataSchema = paginationSchema.extend({
  dictType: filterString(100),
  keyword: filterString(100),
  status: filterStatus(),
});
export type QueryDictDataInput = z.infer<typeof queryDictDataSchema>;
