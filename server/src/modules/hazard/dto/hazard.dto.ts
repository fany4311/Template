import { z } from 'zod';
import {
  filterOf,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';

/** 隐患等级 */
const levelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
/** 可见范围 */
const scopeSchema = z.enum(['DEPT', 'OPEN', 'SCHOOL']);
/** 状态 */
const statusSchema = z.enum([
  'REPORTED',
  'PROCESSING',
  'RECTIFIED',
  'REVIEWED',
  'ARCHIVED',
  'REJECTED',
]);

/** ISO 时间（须带 Z 后缀，见项目约定） */
const isoDateTime = z.iso.datetime();

/** 部门 id 数组（去重、正整数） */
const deptIdsSchema = z
  .array(z.coerce.number().int().positive())
  .max(50)
  .transform((arr) => [...new Set(arr)]);

// ---------------------------------------------------------------------------
// 上报
// ---------------------------------------------------------------------------

/**
 * 上报隐患。
 * scope=DEPT 时主责部门默认取上报人部门；scope=OPEN 时可指定协办部门。
 */
export const createHazardSchema = z.object({
  title: z.string().min(2, '标题至少 2 个字').max(200),
  content: z.string().min(5, '描述至少 5 个字').max(5000),
  location: z.string().max(255).default(''),
  category: z.string().max(32).default(''),
  level: levelSchema.default('LOW'),
  scope: scopeSchema.default('DEPT'),
  /** 主责部门（不传则由受理环节确定） */
  assigneeDeptId: z.coerce.number().int().positive().optional(),
  /** 协办部门（多部门协同） */
  cooperateDeptIds: deptIdsSchema.optional(),
  /** 整改期限（ISO datetime） */
  rectifyDeadline: isoDateTime.optional(),
});
export type CreateHazardInput = z.infer<typeof createHazardSchema>;

// ---------------------------------------------------------------------------
// 流转动作
// ---------------------------------------------------------------------------

/** 受理：确定主责部门、协办部门、当前处理人、整改期限 */
export const acceptHazardSchema = z.object({
  assigneeDeptId: z.coerce.number().int().positive().optional(),
  cooperateDeptIds: deptIdsSchema.optional(),
  handlerId: z.coerce.number().int().positive().optional(),
  rectifyDeadline: isoDateTime.optional(),
  remark: z.string().max(500).default(''),
});
export type AcceptHazardInput = z.infer<typeof acceptHazardSchema>;

/** 驳回：必须说明原因 */
export const rejectHazardSchema = z.object({
  reason: z.string().min(2, '驳回原因至少 2 个字').max(500),
});
export type RejectHazardInput = z.infer<typeof rejectHazardSchema>;

/** 提交整改 */
export const rectifyHazardSchema = z.object({
  rectifyMeasure: z.string().min(2, '整改措施至少 2 个字').max(5000),
  remark: z.string().max(500).default(''),
});
export type RectifyHazardInput = z.infer<typeof rectifyHazardSchema>;

/**
 * 复查：一次接口完成"通过 / 退回整改"两种结果。
 * 用 passed 区分，避免两个几乎相同的接口（前端按钮不同、语义同一件事）。
 */
export const reviewHazardSchema = z.object({
  passed: z.boolean(),
  opinion: z.string().min(2, '复查意见至少 2 个字').max(500),
});
export type ReviewHazardInput = z.infer<typeof reviewHazardSchema>;

/** 归档 */
export const archiveHazardSchema = z.object({
  opinion: z.string().max(500).default(''),
});
export type ArchiveHazardInput = z.infer<typeof archiveHazardSchema>;

// ---------------------------------------------------------------------------
// 查询
// ---------------------------------------------------------------------------

export const queryHazardSchema = paginationSchema.extend({
  keyword: filterString(100),
  status: filterOf(statusSchema),
  level: filterOf(levelSchema),
  scope: filterOf(scopeSchema),
  category: filterString(32),
  /** 只看落到我部门的（我部门在主责或协办里）；空串 = 未填 */
  onlyMine: filterOf(z.stringbool()),
});
export type QueryHazardInput = z.infer<typeof queryHazardSchema>;
