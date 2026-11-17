import { z } from 'zod';

/** 登录请求体 schema（Standard Schema，供 @Body({ schema }) 使用） */
export const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空').max(50),
  password: z.string().min(1, '密码不能为空').max(100),
  /** 验证码 uuid（验证码开启时必填） */
  captchaUuid: z.string().optional(),
  /** 验证码文本（验证码开启时必填） */
  captchaCode: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
