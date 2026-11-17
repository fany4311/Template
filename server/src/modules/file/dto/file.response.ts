import { z } from 'zod';

const isoDateTime = z.iso.datetime();
const nullableDateTime = isoDateTime.nullable();

const fileStatusSchema = z.enum(['TEMP', 'ACTIVE']);

/**
 * 文件元数据（对外视图）。
 *
 * 刻意**不返回** objectKey / sha256 / disk：
 * - objectKey 泄漏会让攻击者推测对象路径
 * - sha256 泄漏可用于「确认服务端是否存在某文件」
 * - disk 是内部实现细节（落在哪个存储盘），对调用方没有意义
 * 下载统一走 `downloadUrl`（服务端代理 + 鉴权 + 审计）。
 */
export const fileResponseSchema = z.object({
  id: z.number(),
  createTime: isoDateTime,
  originalName: z.string(),
  ext: z.string(),
  mime: z.string(),
  size: z.number(),
  uploaderId: z.number(),
  uploaderName: z.string(),
  uploaderDeptId: z.number().nullable(),
  status: fileStatusSchema,
  refCount: z.number(),
  expireAt: nullableDateTime,
  /** 前端可直接使用的下载地址（相对 API 前缀，需携带 Authorization） */
  downloadUrl: z.string().describe('下载地址（需携带 Authorization）'),
});

/** 文件与业务对象的绑定关系 */
export const fileLinkResponseSchema = z.object({
  id: z.number(),
  createTime: isoDateTime,
  fileId: z.number(),
  bizType: z.string(),
  bizId: z.string(),
  bizField: z.string(),
  sort: z.number(),
});

/** 详情 = 元数据 + 绑定关系 */
export const fileDetailResponseSchema = z.object({
  file: fileResponseSchema,
  links: z.array(fileLinkResponseSchema),
});

/** 业务对象下的一个附件项（绑定关系 + 元数据） */
export const bizFileItemSchema = z.object({
  link: fileLinkResponseSchema,
  file: fileResponseSchema,
});

/** 业务对象附件列表 */
export const bizFileListSchema = z.array(bizFileItemSchema);

/** 上传结果：新建或秒传（复用已存在文件） */
export const uploadResultSchema = z.object({
  file: fileResponseSchema,
  /** true = 命中已存在文件（同用户同内容），未重新写入对象存储 */
  deduped: z.boolean().describe('是否命中秒传（内容重复，未重复写入存储）'),
});

/** 绑定 / 解绑结果 */
export const bindResultSchema = z.object({
  bound: z.number(),
  skipped: z.number(),
});

export const unbindResultSchema = z.object({
  unbound: z.number(),
});

/** 删除结果（成功返回 null） */
export const fileRemoveResultSchema = z.null();
