import { z } from 'zod';
import { abilityRuleResponseSchema } from '../../../common/authz/ability.schema.js';

/** 图形验证码 */
export const captchaResponseSchema = z.object({
  img: z.string().describe('SVG 文本'),
  uuid: z.string(),
});

/** 登录成功 */
export const loginResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    userId: z.number(),
    username: z.string(),
    nickname: z.string(),
  }),
});

/** 当前登录用户信息（前端据此做菜单/按钮级控制） */
export const profileResponseSchema = z.object({
  userId: z.number(),
  username: z.string(),
  nickname: z.string(),
  email: z.string(),
  phone: z.string(),
  deptId: z.number().nullable().optional(),
  post: z.string(),
  /** 角色编号（level）列表：0-4 内置，5+ 自建。**程序判据一律用它** */
  roles: z.array(z.number().int()),
  /** 角色名称列表，与 roles **同序**（仅供展示） */
  roleNames: z.array(z.string()),
  permissions: z.array(z.string()),
  rules: z.array(abilityRuleResponseSchema),
  dataScopes: z.array(z.string()),
});
