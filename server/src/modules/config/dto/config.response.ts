import { z } from 'zod';

/** 参数配置 */
export const configResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  configName: z.string(),
  configKey: z.string(),
  configValue: z.string(),
  configType: z.enum(['Y', 'N']).describe('Y 系统内置（不可删）/ N 自定义'),
  status: z.number(),
  remark: z.string(),
});

/** 按键取值 */
export const configValueResponseSchema = z.object({
  configKey: z.string(),
  configValue: z.string(),
});
