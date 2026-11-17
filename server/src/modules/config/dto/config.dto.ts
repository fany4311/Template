import { z } from 'zod';
import {
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';

/** 状态：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/** 参数类型：Y 系统内置不可删 / N 可编辑 */
const configTypeSchema = z.enum(['Y', 'N']);

/** 参数键：仅允许字母、数字、下划线、点、冒号、短横线 */
const configKeySchema = z
  .string()
  .min(1, '参数键不能为空')
  .max(100)
  .regex(/^[a-zA-Z0-9_.:-]+$/, '参数键只能包含字母、数字、下划线、点、冒号、短横线');

/** 创建参数配置 */
export const createConfigSchema = z.object({
  configName: z.string().min(1, '参数名称不能为空').max(100),
  configKey: configKeySchema,
  configValue: z.string(),
  configType: configTypeSchema.default('N'),
  status: statusSchema.default(1),
  remark: z.string().max(255).default(''),
});
export type CreateConfigInput = z.infer<typeof createConfigSchema>;

/** 更新参数配置（全部可选） */
export const updateConfigSchema = updateSchemaOf(createConfigSchema);
export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;

/** 查询参数配置（分页 + 关键字/状态） */
export const queryConfigSchema = paginationSchema.extend({
  keyword: filterString(100),
  status: filterStatus(),
});
export type QueryConfigInput = z.infer<typeof queryConfigSchema>;

/** 导出条件：与列表相同的筛选，但不分页（上限由 CSV_MAX_ROWS 控制） */
export const exportConfigSchema = z.object({
  keyword: filterString(100),
  status: filterStatus(),
});
export type ConfigExportQuery = z.infer<typeof exportConfigSchema>;

/** 按参数键查询的返回值 */
export interface ConfigValueResult {
  configKey: string;
  configValue: string;
}
