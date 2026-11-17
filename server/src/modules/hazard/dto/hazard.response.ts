import { z } from 'zod';

const isoDateTime = z.iso.datetime();
const nullableDateTime = isoDateTime.nullable();

const levelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
const scopeSchema = z.enum(['DEPT', 'OPEN', 'SCHOOL']);
const statusSchema = z.enum([
  'REPORTED',
  'PROCESSING',
  'RECTIFIED',
  'REVIEWED',
  'ARCHIVED',
  'REJECTED',
]);
const actionSchema = z.enum([
  'REPORT',
  'ACCEPT',
  'REJECT',
  'RECTIFY',
  'REVIEW_PASS',
  'REVIEW_BACK',
  'ARCHIVE',
]);

/**
 * 隐患单。
 *
 * 注意 `availableActions`：由**后端状态机**算出当前状态下可执行的动作，
 * 前端据此渲染按钮，不再自己写状态判断（否则状态机一改前端就错）。
 * 仍需结合权限码二次过滤（前端 v-perm）。
 */
export const hazardResponseSchema = z.object({
  id: z.number(),
  createTime: isoDateTime,
  updateTime: isoDateTime,
  hazardNo: z.string(),
  title: z.string(),
  content: z.string(),
  location: z.string(),
  category: z.string(),
  level: levelSchema,
  scope: scopeSchema,
  status: statusSchema,
  statusLabel: z.string().describe('状态中文名'),

  reporterId: z.number(),
  reporterName: z.string(),
  reporterDeptId: z.number().nullable(),
  assigneeDeptId: z.number().nullable(),
  assigneeDeptName: z.string().describe('主责部门名（联表补全）'),
  cooperateDeptIds: z.array(z.number()),
  cooperateDeptNames: z.array(z.string()).describe('协办部门名（联表补全）'),
  handlerId: z.number().nullable(),
  handlerName: z.string(),

  deadlineAt: nullableDateTime,
  rectifyDeadline: nullableDateTime,
  overdue: z.boolean().describe('是否逾期未办结'),

  rectifyMeasure: z.string().nullable(),
  rectifyTime: nullableDateTime,

  reviewOpinion: z.string(),
  reviewerId: z.number().nullable(),
  reviewTime: nullableDateTime,

  archiveOpinion: z.string(),
  archiverId: z.number().nullable(),
  archiveTime: nullableDateTime,

  rejectReason: z.string(),

  availableActions: z.array(actionSchema),
});

/** 流转日志（前端时间线） */
export const hazardLogResponseSchema = z.object({
  id: z.number(),
  createTime: isoDateTime,
  hazardId: z.number(),
  hazardNo: z.string(),
  action: actionSchema,
  actionLabel: z.string(),
  fromStatus: statusSchema.nullable(),
  toStatus: statusSchema,
  operatorId: z.number(),
  operatorName: z.string(),
  deptId: z.number().nullable(),
  remark: z.string(),
});

/** 省平台同步记录 */
export const hazardSyncResponseSchema = z.object({
  id: z.number(),
  createTime: isoDateTime,
  hazardId: z.number(),
  hazardNo: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  toStatus: statusSchema,
  direction: z.enum(['PUSH', 'PULL']),
  status: z.enum(['SUCCESS', 'FAILED']),
  error: z.string(),
  retryCount: z.number(),
  target: z.string(),
});

/** 详情 = 隐患单 + 流转轨迹 + 省平台同步记录 */
export const hazardDetailResponseSchema = hazardResponseSchema.extend({
  logs: z.array(hazardLogResponseSchema),
  syncRecords: z.array(hazardSyncResponseSchema),
});
