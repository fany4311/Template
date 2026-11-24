import { downloadCsv } from '../utils/download';
import { request } from './http';
import type { ConfigItem } from './types';

/** 导入结果：与后端 common/import-export/csv.ts 的 ImportResult 对齐 */
export interface ConfigImportFailure {
  row: number;
  message: string;
}

export interface ConfigImportResult {
  total: number;
  ok: number;
  failed: ConfigImportFailure[];
  failedTruncated: boolean;
}

export interface ConfigCreateBody {
  configName: string;
  configKey: string;
  configValue: string;
  configType?: 'Y' | 'N';
  status?: number;
  remark?: string;
}

export const configApi = {
  page: (params: object): Promise<{ list: ConfigItem[]; total: number }> =>
    request.get('/config', params),
  detail: (id: number): Promise<ConfigItem> =>
    request.get<ConfigItem>(`/config/${id}`),
  create: (body: ConfigCreateBody): Promise<ConfigItem> =>
    request.post<ConfigItem>('/config', body),
  update: (id: number, body: Partial<ConfigCreateBody>): Promise<ConfigItem> =>
    request.put<ConfigItem>(`/config/${id}`, body),
  remove: (id: number): Promise<boolean> =>
    request.delete<boolean>(`/config/${id}`),
  /** 按键取值（登录即可） */
  value: (
    configKey: string,
  ): Promise<{ configKey: string; configValue: string }> =>
    request.get(`/config/key/${configKey}`),

  /** 导出当前筛选结果为 CSV（后端上限 5000 行） */
  exportCsv: (params: { keyword?: string; status?: number }): Promise<void> => {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return downloadCsv('/config/export', params, '参数配置-' + stamp + '.csv');
  },

  /** 导入 CSV（multipart）；不手动设置 Content-Type，交给浏览器补 boundary */
  importCsv: (file: File): Promise<ConfigImportResult> => {
    const form = new FormData();
    form.append('file', file);
    return request.post<ConfigImportResult>('/config/import', form);
  },
};
