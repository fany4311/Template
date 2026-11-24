import { z } from 'zod';
import { passwordSchema } from '../../auth/dto/password.dto.js';
import {
  filterId,
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';
import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';

/** 状态枚举：1 正常 / 0 禁用 */
const statusSchema = z.coerce.number().int().min(0).max(1);

/** 创建用户 schema */
export const createUserSchema = z.object({
  username: z.string().min(1, '用户名不能为空').max(50),
  // 与自助改密共用同一份密码策略（见 auth/dto/password.dto.ts）
  password: passwordSchema,
  nickname: z.string().max(50).optional(),
  email: z.email('邮箱格式不正确').optional(),
  phone: z.string().max(20).optional(),
  deptId: z.coerce.number().int().optional(),
  post: z.string().max(64).optional(),
  status: statusSchema.optional(),
  /** 角色ID数组（授权为永久） */
  roleIds: z.array(z.coerce.number().int()).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

/** 更新用户：所有字段可选，密码不更新（另设改密接口） */
export const updateUserSchema = updateSchemaOf(
  createUserSchema.omit({ password: true }),
);

export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** 导出条件：与列表相同的筛选，不分页 */
export const exportUserSchema = z.object({
  keyword: filterString(50),
  deptId: z.coerce.number().int().positive().optional(),
  status: filterStatus(),
});
export type ExportUserQuery = z.infer<typeof exportUserSchema>;

/** 查询用户（分页 + 关键字 + 部门） */
export const queryUserSchema = paginationSchema.extend({
  keyword: filterString(50),
  status: filterStatus(),
  deptId: filterId(),
});

export type QueryUserInput = z.infer<typeof queryUserSchema>;

/** 授权（支持临时授权 expireAt） */
export const grantRolesSchema = z.object({
  roleIds: z.array(z.coerce.number().int()).min(1),
  /** 临时授权到期时间（ISO 8601 字符串）；不传=永久 */
  expireAt: z.iso.datetime().optional(),
});

export type GrantRolesInput = z.infer<typeof grantRolesSchema>;
