import { z } from 'zod';

/** 登录日志（bigint 主键序列化为字符串） */
export const loginLogResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  status: z.number().describe('1 成功 / 0 失败'),
  msg: z.string().nullable().optional(),
  loginTime: z.iso.datetime(),
});
