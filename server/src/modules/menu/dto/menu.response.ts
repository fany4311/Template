import { z } from 'zod';

/** 菜单节点（递归树；M 目录 / C 菜单 / F 按钮） */
export const menuResponseSchema: z.ZodType = z.lazy(() =>
  z.object({
    id: z.number(),
    createTime: z.iso.datetime(),
    updateTime: z.iso.datetime(),
    parentId: z.number().nullable().optional(),
    name: z.string(),
    type: z.enum(['M', 'C', 'F']),
    path: z.string(),
    component: z.string(),
    perms: z.string(),
    icon: z.string(),
    sort: z.number(),
    visible: z.number().describe('1 显示 / 0 隐藏'),
    status: z.number(),
    ancestors: z.string(),
    children: z.array(menuResponseSchema).optional(),
  }),
);
