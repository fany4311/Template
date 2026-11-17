import type { FileEntity } from '../entities/file.entity.js';
import type { FileLink } from '../entities/file-link.entity.js';

/**
 * 实体 → 对外视图。
 *
 * **白名单式映射**：只挑允许外泄的字段，其余（sha256 / objectKey / disk）
 * 一律不出现。用 `...file` 再删字段是黑名单，新增内部字段时会悄悄泄漏，
 * 所以这里显式逐字段列出。
 */
export function toFileView(file: FileEntity) {
  return {
    id: file.id,
    createTime: file.createTime.toISOString(),
    originalName: file.originalName,
    ext: file.ext,
    mime: file.mime,
    size: file.size,
    uploaderId: file.uploaderId,
    uploaderName: file.uploaderName,
    uploaderDeptId: file.uploaderDeptId ?? null,
    status: file.status,
    refCount: file.refCount,
    expireAt: file.expireAt ? file.expireAt.toISOString() : null,
    // 下载走后端代理（鉴权 + 审计 + 防盗链），前端带上 Authorization 请求
    downloadUrl: `/file/${file.id}/download`,
  };
}

/** 绑定关系视图 */
export function toLinkView(link: FileLink) {
  return {
    id: link.id,
    createTime: link.createTime.toISOString(),
    fileId: link.fileId,
    bizType: link.bizType,
    bizId: link.bizId,
    bizField: link.bizField,
    sort: link.sort,
  };
}
