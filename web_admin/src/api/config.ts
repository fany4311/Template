import { request } from './http';
import type { ConfigItem } from './types';

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
  detail: (id: number): Promise<ConfigItem> => request.get<ConfigItem>(`/config/${id}`),
  create: (body: ConfigCreateBody): Promise<ConfigItem> =>
    request.post<ConfigItem>('/config', body),
  update: (id: number, body: Partial<ConfigCreateBody>): Promise<ConfigItem> =>
    request.put<ConfigItem>(`/config/${id}`, body),
  remove: (id: number): Promise<boolean> => request.delete<boolean>(`/config/${id}`),
  /** 按键取值（登录即可） */
  value: (configKey: string): Promise<{ configKey: string; configValue: string }> =>
    request.get(`/config/key/${configKey}`),
};
