import { request } from './http';
import type { MenuItem, MenuType } from './types';

export interface MenuCreateBody {
  parentId?: number | null;
  name: string;
  type: MenuType;
  path?: string;
  component?: string;
  perms?: string;
  icon?: string;
  sort?: number;
  visible?: number;
  status?: number;
}

export const menuApi = {
  /** 全量菜单树（管理页，含按钮与隐藏项） */
  tree: (params?: { keyword?: string; status?: number }): Promise<MenuItem[]> =>
    request.get<MenuItem[]>('/menu/tree', params),
  /** 当前用户可见菜单树（前端动态菜单/侧边栏） */
  routes: (): Promise<MenuItem[]> => request.get<MenuItem[]>('/menu/routes'),
  /**
   * 全部可导航页面（注册路由用，**不按权限过滤**）。
   * 侧边栏用 `routes()`，路由表用这个 —— 少一个就会出现「没权限 = 404」。
   */
  pages: (): Promise<MenuItem[]> => request.get<MenuItem[]>('/menu/pages'),
  create: (body: MenuCreateBody): Promise<MenuItem> =>
    request.post<MenuItem>('/menu', body),
  update: (id: number, body: Partial<MenuCreateBody>): Promise<MenuItem> =>
    request.put<MenuItem>(`/menu/${id}`, body),
  remove: (id: number): Promise<boolean> =>
    request.delete<boolean>(`/menu/${id}`),
};
