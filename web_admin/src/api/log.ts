import { request } from './http';
import type { AuditLogItem, LoginLogItem, PageResult } from './types';

export const loginLogApi = {
  page: (params: object): Promise<PageResult<LoginLogItem>> =>
    request.get<PageResult<LoginLogItem>>('/loginlog', params),
  remove: (id: string): Promise<boolean> =>
    request.delete<boolean>(`/loginlog/${id}`),
  clear: (): Promise<boolean> => request.delete<boolean>('/loginlog'),
};

export const auditLogApi = {
  page: (params: object): Promise<PageResult<AuditLogItem>> =>
    request.get<PageResult<AuditLogItem>>('/audit', params),
  detail: (id: string): Promise<AuditLogItem> =>
    request.get<AuditLogItem>(`/audit/${id}`),
};
