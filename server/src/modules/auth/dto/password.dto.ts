import { z } from 'zod';

/**
 * 密码最小长度。
 *
 * TODO(部署端)：按本单位等保 / 校园网安全规范调整（如要求大小写+数字+符号）。
 * 底座只给一个下限，不在机制层写死复杂度规则 —— 派生项目往往还有「口令定期更换」
 * 这类硬性要求，写死反而挡路。
 */
export const PASSWORD_MIN_LENGTH = 8;

/** 密码字段（新密码 / 创建用户共用同一份策略） */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .max(100);

/** 自助改密：需校验原密码（防 token 被盗后直接改密） */
export const changePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, '原密码不能为空').max(100),
    newPassword: passwordSchema,
  })
  .refine((v) => v.oldPassword !== v.newPassword, {
    message: '新密码不能与原密码相同',
    path: ['newPassword'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * 管理员重置他人密码：不需要原密码（管理员不知道，也不该知道）。
 * 权限边界靠 `system:user:reset-pwd`，不靠「知道旧密码」。
 */
export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
