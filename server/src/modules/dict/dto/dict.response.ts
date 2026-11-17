import { z } from 'zod';

/** 字典类型 */
export const dictTypeResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  dictName: z.string(),
  dictType: z.string(),
  status: z.number(),
  remark: z.string(),
});

/** 字典数据 */
export const dictDataResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  dictType: z.string(),
  dictLabel: z.string(),
  dictValue: z.string(),
  dictSort: z.number(),
  tagType: z.string(),
  status: z.number(),
  remark: z.string(),
});

/** 前端下拉选项 */
export const dictOptionResponseSchema = z.object({
  label: z.string(),
  value: z.string(),
  tagType: z.string(),
});
