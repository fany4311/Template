import { z } from 'zod';

/** 审计记录（bigint 主键序列化为字符串） */
export const auditResponseSchema = z.object({
  id: z.string(),
  traceId: z.string().nullable().optional(),
  actorId: z.number().nullable().optional(),
  actorName: z.string().nullable().optional(),
  action: z.string(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  result: z.enum(['success', 'fail']),
  errorCode: z.string().nullable().optional(),
  method: z.string(),
  path: z.string(),
  ip: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).nullable().optional(),
  durationMs: z.number().nullable().optional(),
  createTime: z.iso.datetime(),
});
