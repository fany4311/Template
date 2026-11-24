import { request } from './http';
import type { JsonBody, PageResult, QueryOf, RoleItem } from './types';

export type RoleQuery = QueryOf<'RoleController_page_v1'>;
export type RoleCreateBody = JsonBody<'RoleController_create_v1'>;
export type RoleUpdateBody = Partial<RoleCreateBody>;

export const roleApi = {
  page: (query: RoleQuery) =>
    request.get<PageResult<RoleItem>>(
      '/role',
      query as Record<string, unknown>,
    ),
  detail: (id: number) => request.get<RoleItem>(`/role/${id}`),
  create: (body: RoleCreateBody) => request.post<RoleItem>('/role', body),
  update: (id: number, body: RoleUpdateBody) =>
    request.put<RoleItem>(`/role/${id}`, body),
  remove: (id: number) => request.delete<boolean>(`/role/${id}`),
};
