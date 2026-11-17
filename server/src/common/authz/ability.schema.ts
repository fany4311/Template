import { z } from 'zod';

/**
 * CASL 规则的响应 schema（只用于 OpenAPI/契约测试，不复用入参 schema：
 * 入参允许部分字段、出参是落库后的完整结构）。
 */
export const abilityRuleResponseSchema = z.object({
  action: z.string(),
  subject: z.string(),
  conditions: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  inverted: z.boolean().optional(),
});
