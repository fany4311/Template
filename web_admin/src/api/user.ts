import { request } from './http';
import type {
  JsonBody,
  PageResult,
  QueryOf,
  UserItem,
  UserRoleGrant,
} from './types';

export type UserQuery = QueryOf<'UserController_page_v1'>;
export type UserCreateBody = JsonBody<'UserController_create_v1'>;
/** 更新：后端 updateUserSchema = create 去掉 password 后 partial */
export type UserUpdateBody = Omit<Partial<UserCreateBody>, 'password'>;
export type GrantRolesBody = JsonBody<'UserController_grantRoles_v1'>;
/** 管理员重置他人密码 */
export type ResetPasswordBody = JsonBody<'UserController_resetPassword_v1'>;

export const userApi = {
  page: (query: UserQuery) =>
    request.get<PageResult<UserItem>>('/user', query as Record<string, unknown>),
  create: (body: UserCreateBody) => request.post<UserItem>('/user', body),
  update: (id: number, body: UserUpdateBody) =>
    request.put<UserItem>(`/user/${id}`, body),
  remove: (id: number) => request.delete<boolean>(`/user/${id}`),
  grants: (id: number) => request.get<UserRoleGrant[]>(`/user/${id}/roles`),
  grant: (id: number, body: GrantRolesBody) =>
    request.post<void>(`/user/${id}/roles`, body),
  revoke: (id: number, roleId: number) =>
    request.delete<void>(`/user/${id}/roles/${roleId}`),
  /** 重置指定用户密码（需要 system:user:reset-pwd；目标用户会话立即失效） */
  resetPassword: (id: number, body: ResetPasswordBody) =>
    request.put<void>(`/user/${id}/password`, body),
};
