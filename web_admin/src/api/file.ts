import { http, request } from './http';
import type {
  FileBizItem,
  FileDetail,
  FileItem,
  FileUploadResult,
  PageResult,
  QueryOf,
} from './types';

export type FileQuery = QueryOf<'FileController_page_v1'>;

/** 绑定/解绑入参（后端 Zod schema 已校验，这里给调用方一份类型） */
export interface BindFilesBody {
  fileIds: number[];
  bizType: string;
  bizId: string;
  bizField?: string;
}

export interface UnbindFilesBody extends BindFilesBody {}

export const fileApi = {
  page: (params: FileQuery): Promise<PageResult<FileItem>> =>
    request.get<PageResult<FileItem>>('/file', params),

  detail: (id: number): Promise<FileDetail> =>
    request.get<FileDetail>(`/file/${id}`),

  /**
   * 上传（multipart）。
   *
   * 显式不设置 Content-Type：让浏览器自动带上 multipart 边界，
   * 手写会把 boundary 弄丢，服务端解析失败。
   */
  upload: (
    file: File,
    extra?: { bizType?: string; bizId?: string; bizField?: string },
    onProgress?: (percent: number) => void,
  ): Promise<FileUploadResult> => {
    const form = new FormData();
    form.append('file', file);
    if (extra?.bizType) form.append('bizType', extra.bizType);
    if (extra?.bizId) form.append('bizId', extra.bizId);
    if (extra?.bizField) form.append('bizField', extra.bizField);

    return http.post('/file', form, {
      // 大文件上传需要更长时间
      timeout: 60_000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }) as unknown as Promise<FileUploadResult>;
  },

  listByBiz: (bizType: string, bizId: string | number, bizField?: string): Promise<FileBizItem[]> =>
    request.get<FileBizItem[]>(
      `/file/biz/${encodeURIComponent(bizType)}/${encodeURIComponent(String(bizId))}`,
      bizField ? { bizField } : undefined,
    ),

  bind: (body: BindFilesBody): Promise<{ bound: number; skipped: number }> =>
    request.post('/file/bind', body),

  unbind: (body: UnbindFilesBody): Promise<{ unbound: number }> =>
    request.post('/file/unbind', body),

  remove: (id: number): Promise<null> => request.delete<null>(`/file/${id}`),
};
