import { z } from 'zod';
import { abilityRuleResponseSchema } from '../../../common/authz/ability.schema.js';

/** 角色（权限码 + CASL 规则 + 数据范围） */
export const roleResponseSchema = z.object({
  id: z.number(),
  createTime: z.iso.datetime(),
  updateTime: z.iso.datetime(),
  roleName: z.string(),
  /** 角色编号：0-4 内置，5+ 自建（唯一） */
  level: z.number().int(),
  /** 是否内置角色：1是 0否（内置不可删，超管另不可改权限） */
  isBuiltin: z.number().int(),
  permissions: z.array(z.string()),
  rules: z.array(abilityRuleResponseSchema).nullable().optional(),
  dataScope: z.string(),
  /** 自定义数据范围的部门 id 集合（仅 CUSTOM 时有意义） */
  deptIds: z.array(z.number()).optional(),
  status: z.number(),
});
