import { z } from 'zod';

/** 部门节点（递归树；children 由 service 组装） */
export const deptResponseSchema: z.ZodType = z.lazy(() =>
  z.object({
    id: z.number(),
    createTime: z.iso.datetime(),
    updateTime: z.iso.datetime(),
    parentId: z.number().nullable().optional(),
    name: z.string(),
    ancestors: z.string().describe('祖先路径，如 0,1,3'),
    sort: z.number(),
    status: z.number(),
    children: z.array(deptResponseSchema).optional(),
  }),
);
