import { request } from './http';
import type { DeptItem, DeptTreeNode, JsonBody, QueryOf } from './types';

export type DeptQuery = QueryOf<'DeptController_tree_v1'>;
export type DeptCreateBody = JsonBody<'DeptController_create_v1'>;
export type DeptUpdateBody = Partial<DeptCreateBody>;

export const deptApi = {
  /** 树形结构（含 children） */
  tree: (query?: DeptQuery) =>
    request.get<DeptTreeNode[]>('/dept/tree', query as Record<string, unknown>),
  /** 平铺列表 */
  list: (query?: DeptQuery) =>
    request.get<DeptItem[]>('/dept', query as Record<string, unknown>),
  detail: (id: number) => request.get<DeptItem>(`/dept/${id}`),
  create: (body: DeptCreateBody) => request.post<DeptItem>('/dept', body),
  update: (id: number, body: DeptUpdateBody) =>
    request.put<DeptItem>(`/dept/${id}`, body),
  remove: (id: number) => request.delete<boolean>(`/dept/${id}`),
};
