import { z } from 'zod';

/** 用户（出参不含 password，实体层 select:false） */
export const userResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  username: z.string(),
  nickname: z.string(),
  email: z.string(),
  phone: z.string(),
  status: z.number().describe('1 正常 / 0 禁用'),
  deptId: z.number().nullable().optional(),
  post: z.string(),
});

/** 用户-角色授权记录（含临时授权到期时间） */
export const userRoleResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  userId: z.number(),
  roleId: z.number(),
  expireAt: z.iso.datetime().nullable().optional(),
  source: z.string().describe('direct 永久 / temp 临时'),
  grantedBy: z.number().nullable().optional(),
});
