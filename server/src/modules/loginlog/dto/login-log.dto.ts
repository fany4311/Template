import { z } from 'zod';
import {
  filterStatus,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';

/**
 * 查询登录日志（分页 + 账号模糊 + 结果）。
 *
 * 两个过滤字段都用 filterXxx：前端登录日志页初始就带 `username: ''`，
 * 用 `.min(1)` 会让**页面首次加载直接 400**。
 */
export const queryLoginLogSchema = paginationSchema.extend({
  username: filterString(50),
  status: filterStatus(),
});
export type QueryLoginLogInput = z.infer<typeof queryLoginLogSchema>;
