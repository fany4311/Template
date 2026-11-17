import type { components, operations } from './schema';

/** 后端统一响应包络（TransformInterceptor / AllExceptionFilter） */
export interface AjaxResult<T> {
  code: number;
  msg: string;
  data: T;
}

/** 统一分页返回结构（后端 PageResult） */
export interface PageResult<T> {
  list: T[];
  total: number;
}

/**
 * 从 codegen 产物中提取「请求体」类型。
 * 后端用 Nest 12 Standard Schema（Zod）声明入参，Swagger 已能产出 JSON Schema，
 * 因此请求体无需手写。
 */
export type JsonBody<K extends keyof operations> = operations[K] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** 从 codegen 产物中提取「查询参数」类型 */
export type QueryOf<K extends keyof operations> = operations[K] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;

// ---------------------------------------------------------------------------
// 响应模型（**全部由 codegen 派生**，不再手写）
//
// 来源链路：
//   后端 @ApiOkZod(name, zodSchema)  →  OpenAPI components.schemas
//   →  pnpm openapi:gen  →  src/api/schema.d.ts  →  下面的 type 别名
//
// 后端改了返回结构，重新 dump + gen 后这里自动更新；
// 若后端声明与实际返回漂移，后端 test/contract.e2e-spec.ts 会先失败。
// ---------------------------------------------------------------------------

/** OpenAPI 组件表 */
type S = components['schemas'];

/** 某个接口的 200 响应体（含包络 { code, msg, data }） */
type OkBody<K extends keyof operations> = operations[K] extends {
  responses: { 200: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** 某个接口 200 响应里的 `data`（拦截器已解包，前端拿到的就是它） */
export type DataOf<K extends keyof operations> = OkBody<K> extends {
  data?: infer D;
}
  ? NonNullable<D>
  : never;

/** 某个组件（响应包络）里的 `data` */
type DataOfComponent<N extends keyof S> = S[N] extends { data?: infer D }
  ? NonNullable<D>
  : never;

/** 数据范围（语义枚举，UI 下拉选项用；后端以字符串传输） */
export type DataScope = 'ALL' | 'DEPT_AND_CHILD' | 'DEPT' | 'SELF' | 'CUSTOM';

/** 用户（sys_user，不含 password：实体层 select:false） */
export type UserItem = DataOfComponent<'SysUser'>;

/** 角色（sys_role） */
export type RoleItem = DataOfComponent<'SysRole'>;

/** 部门节点（递归树） */
export type DeptTreeNode = S['SysDeptData'];
export type DeptItem = DeptTreeNode;

/** 菜单节点（递归树） */
export type MenuItem = S['SysMenuData'];
export type MenuType = NonNullable<MenuItem['type']>;

/** 字典类型 / 字典数据 / 下拉选项 */
export type DictTypeItem = DataOfComponent<'SysDictType'>;
export type DictDataItem = DataOfComponent<'SysDictData'>;
export type DictOption = DataOf<'DictController_options_v1'>[number];

/** 参数配置 */
export type ConfigItem = DataOfComponent<'SysConfig'>;

/** 日志 */
export type AuditLogItem = DataOfComponent<'SysAuditLog'>;
export type LoginLogItem = DataOf<'LoginLogController_page_v1'>['list'][number];

/** 用户-角色授权记录 */
export type UserRoleGrant = DataOf<'UserController_listGrants_v1'>[number];

/**
 * 权限清单（按模块分组，来自 `GET /permission`）。
 * 只在角色编辑界面的树形勾选里用，不参与鉴权判断。
 */
export type PermissionGroup = DataOf<'PermissionController_list_v1'>[number];
export type PermissionEntry = PermissionGroup['permissions'][number];

/** 隐患闭环（业务模块示例） */
export type HazardItem = DataOfComponent<'Hazard'>;
export type HazardDetail = DataOfComponent<'HazardDetail'>;
/** 状态下允许的动作（由后端状态机给出） */
export type HazardAction = HazardItem['availableActions'][number];

/** 认证相关 */
export type LoginResult = DataOf<'AuthController_login_v1'>;
export type Profile = DataOf<'AuthController_profile_v1'>;
export type CaptchaResult = DataOf<'AuthController_captcha_v1'>;

/** 文件与附件（底座能力） */
export type FileItem = DataOf<'FileController_upload_v1'>['file'];
export type FileUploadResult = DataOf<'FileController_upload_v1'>;
export type FileDetail = DataOf<'FileController_detail_v1'>;
export type FileBizItem = DataOf<'FileController_listByBiz_v1'>[number];
export type FileStatus = FileItem['status'];
