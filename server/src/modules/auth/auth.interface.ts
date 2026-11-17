/**
 * 认证模块共享类型。
 */
import type { AbilityRule } from '../../common/authz/ability.types.js';
import type { DataScope } from '../../common/enums/data-scope.enum.js';

/** JWT payload：最小化，只放定位用户所需字段 */
export interface Payload {
  userId: number;
  username: string;
}

/** 登录请求元信息（仅用于登录日志，非业务校验） */
export interface LoginMeta {
  ip?: string;
  userAgent?: string;
}

/** 挂到 request.user 的当前登录用户（含 RBAC 缓存 + CASL 规则） */
export interface JwtUser {
  userId: number;
  username: string;
  /** 角色编号（level）列表：0-4 内置，5+ 自建 */
  roles: number[];
  permissions: string[];
  /** CASL 规则（供 PoliciesGuard / AbilityFactory 使用） */
  rules?: AbilityRule[];
  /** 数据范围判定用的部门（ReBAC-lite 条件用） */
  deptId?: number;
  /** 岗位（预设字段） */
  post?: string;
  /** 角色的数据范围并集（查询层过滤依据） */
  dataScopes: DataScope[];
}
