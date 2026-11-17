import { z } from 'zod';

/** 权限清单条目 */
export const permissionResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  code: z.string().describe('权限码，如 system:role:list'),
  name: z.string().describe('权限名称（取自接口 summary）'),
  module: z.string().describe('模块键（权限码第一段）'),
  moduleLabel: z.string().describe('模块显示名（取自 @ApiTags）'),
  status: z.number().describe('1 有效 / 0 已停用（代码中已不存在）'),
});
export type PermissionResponse = z.infer<typeof permissionResponseSchema>;

/** 按模块分组的清单（前端直接渲染树形勾选） */
export const permissionGroupSchema = z.object({
  module: z.string(),
  moduleLabel: z.string(),
  permissions: z.array(permissionResponseSchema),
});
export type PermissionGroup = z.infer<typeof permissionGroupSchema>;
