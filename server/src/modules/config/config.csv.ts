import { z } from 'zod';
import type { CsvColumn } from '../../common/import-export/csv.js';
import type { Config } from './entities/config.entity.js';

/**
 * 参数配置的 CSV 契约：导出列、导入归一、导入校验。
 *
 * 放在模块内而不是 common：列名与字段是**这个模块**的知识，
 * 通用层只提供编解码与表头匹配。
 *
 * 导入的两条硬约束：
 * - 表头按名称匹配（用户可以在 Excel 里调列顺序）
 * - 类型/状态支持中文标签与原始值两种写法（导出再导入能直接闭环）
 */

export const CONFIG_CSV_COLUMNS: CsvColumn<Config>[] = [
  { header: '参数名称', field: 'configName' },
  { header: '参数键', field: 'configKey' },
  { header: '参数值', field: 'configValue' },
  {
    header: '类型',
    field: 'configType',
    format: (row) => (row.configType === 'Y' ? '系统内置' : '自定义'),
    parse: (cell) => {
      const value = cell.trim();
      if (value === '系统内置' || value.toUpperCase() === 'Y') return 'Y';
      return 'N';
    },
  },
  {
    header: '状态',
    field: 'status',
    format: (row) => (row.status === 1 ? '正常' : '停用'),
    parse: (cell) => {
      const value = cell.trim();
      return value === '停用' || value === '0' ? '0' : '1';
    },
  },
  { header: '备注', field: 'remark' },
];

export const configImportRowSchema = z.object({
  configName: z.string().trim().min(1, '参数名称不能为空').max(100, '参数名称不超过 100 字'),
  configKey: z
    .string()
    .trim()
    .min(1, '参数键不能为空')
    .max(100, '参数键不超过 100 字')
    .regex(/^[a-zA-Z0-9_.:-]+$/, '参数键只允许字母、数字、_ . : -'),
  configValue: z.string().max(20000, '参数值过长'),
  configType: z.enum(['Y', 'N']).default('N'),
  status: z.coerce.number().int().min(0).max(1).default(1),
  remark: z.string().max(255, '备注不超过 255 字').default(''),
});

export type ConfigImportRow = z.infer<typeof configImportRowSchema>;
