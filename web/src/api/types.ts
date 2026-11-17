/**
 * 前端（web）用到的接口类型。
 *
 * 后端 `/auth/*` 的响应结构已经在后台端 web_admin 由 OpenAPI codegen 覆盖；
 * 这里只做**最小壳**需要的部分，手写以免为了一个登录页引入 codegen 全量类型。
 * 将来 web 长出业务页面时，建议照抄 web_admin 的做法：dump-openapi + openapi-typescript。
 */

/** 登录响应 */
export interface LoginResult {
  token: string;
  /** 部分实现会直接回带档案；当前后端只回 token，档案另取 /auth/profile */
  user?: Profile;
}

/** 当前用户档案（GET /auth/profile 与 GET /auth/info 同构） */
export interface Profile {
  userId: number;
  username: string;
  nickname: string;
  email: string;
  phone: string;
  deptId: number | null;
  post: string;
  /** 角色编号（level）数组。**程序判据用它**：编号由服务端分配、不可改 */
  roles: number[];
  /** 角色名称数组，与 roles 同序。**仅用于展示**（名称可改） */
  roleNames: string[];
  /** 权限码列表（含 deny 的 `!` 前缀项） */
  permissions: string[];
  /** CASL 规则 */
  rules: unknown[];
  /** 数据范围 */
  dataScopes: string[];
}
