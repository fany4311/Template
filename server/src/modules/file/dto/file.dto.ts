import { z } from 'zod';
import {
  filterId,
  filterOf,
  filterString,
  paginationSchema,
} from '../../../common/dto/pagination.dto.js';

/** 文件状态枚举（与实体同源，避免漂移） */
export const fileStatusSchema = z.enum(['TEMP', 'ACTIVE']);

/** 上传后可选：立即绑定到业务对象（少见，一般先上传后绑定） */
export const uploadFileSchema = z.object({
  bizType: filterString(64),
  bizId: filterString(64),
  bizField: filterString(64),
});

/**
 * 用户上传时的表单字段（multipart 的文本部分）。
 * 用 filterString 是因为浏览器表单会带空串。
 */
export type UploadFileInput = z.infer<typeof uploadFileSchema>;

/** 绑定：把已上传（TEMP）文件挂到业务对象上 */
export const bindFilesSchema = z.object({
  fileIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  bizType: z.string().min(1).max(64),
  bizId: z.string().min(1).max(64),
  bizField: z.string().max(64).default(''),
});

export type BindFilesInput = z.infer<typeof bindFilesSchema>;

/** 解绑：从业务对象上摘掉文件（不删文件本体） */
export const unbindFilesSchema = z.object({
  fileIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  bizType: z.string().min(1).max(64),
  bizId: z.string().min(1).max(64),
  bizField: z.string().max(64).default(''),
});

export type UnbindFilesInput = z.infer<typeof unbindFilesSchema>;

/** 文件管理端分页查询（系统管理域，仅管理员） */
export const queryFileSchema = paginationSchema.extend({
  keyword: filterString(200),
  ext: filterString(16),
  status: filterOf(fileStatusSchema),
  uploaderId: filterId(),
  bizType: filterString(64),
  bizId: filterString(64),
});

export type QueryFileInput = z.infer<typeof queryFileSchema>;

/** 业务对象附件查询（走 FileBizRegistry 鉴权，不走权限码） */
export const queryBizFileSchema = z.object({
  bizField: filterString(64),
});

export type QueryBizFileInput = z.infer<typeof queryBizFileSchema>;
