import { z } from 'zod';
import {
  filterDateTime,
  filterOf,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';

/** 操作结果枚举 */
const resultSchema = z.enum(['success', 'fail']);

/** 查询操作日志（分页 + 操作者/动作模糊 + 结果 + 时间区间） */
export const queryAuditSchema = paginationSchema.extend({
  /** 操作者名称（模糊匹配） */
  actorName: filterString(64),
  /** 动作标识（模糊匹配，权限码风格） */
  action: filterString(64),
  /** 结果（空串 = 不过滤） */
  result: filterOf(resultSchema),
  /** 起始时间（ISO 8601，作用于 create_time） */
  startTime: filterDateTime(),
  /** 结束时间（ISO 8601，作用于 create_time） */
  endTime: filterDateTime(),
});
export type QueryAuditInput = z.infer<typeof queryAuditSchema>;
