# web_admin —— 后台管理界面（Vue3 + Vite + Element Plus）

> 前端拆成了两份：`web_admin`（本目录，后台，8080，需 `console:access`）与
> `web`（前端最小壳，8084，任何账号可登录）。共用同一个后端，token 互通。
> 拆分动机与实际差异见 `../docs/部署端环境.md`。

## 技术栈与版本基线

| 包 | 版本 | 说明 |
|---|---|---|
| vue | 3.5 | |
| vue-router | **4.x** | 上一代成熟主版本（5.x 首发不足一年） |
| pinia | **3.x** | 同上 |
| element-plus | 2.x | |
| vite | **7.x** | 上一代成熟主版本 |
| @vitejs/plugin-vue | 6.x | 与 vite 7 配对（5.x 只支持 vite 5/6） |
| typescript | **5.9** | `openapi-typescript` 的 peer 要求 `^5.x`，故与后端（TS 6）不同 |
| vue-tsc | 3.x | |
| openapi-typescript | 7.x | 接口类型生成 |

> 版本策略：新主版本首发不足一年一律退回上一代成熟主版本；被生态强约束的除外。

## 脚本

```bash
pnpm install
pnpm dev          # 开发服务器（5183，/api 代理到 127.0.0.1:3010）
pnpm build        # vue-tsc 类型检查 + 构建到 dist/
pnpm typecheck    # 仅类型检查
pnpm openapi:gen  # 由 ./openapi.json 生成 src/api/schema.d.ts
```

> 后端端口是 **3010** 不是 3000：dev 与 prod 要能同时跑（prod 后端占 3000）。

## 接口类型：codegen 覆盖范围（重要）

契约源头是后端 OpenAPI：

```bash
# 后端仓库
cd ../server && pnpm openapi:dump    # 产出 ../web_admin/openapi.json
# 前端仓库
pnpm openapi:gen                     # 产出 src/api/schema.d.ts
```

**全部自动生成**：请求体、查询参数、路径、**响应体**。

链路：

```
后端 @ApiOkZod('SysUser', userResponseSchema)   // 每接口声明 data 的 zod schema
  → components.schemas.SysUser = { code, msg, data }（包络自动补）
  → openapi.json → openapi-typescript → src/api/schema.d.ts
  → src/api/types.ts 里 `export type UserItem = DataOfComponent<'SysUser'>`
```

要点：

- `src/api/types.ts` **不再手写结构**，只做「组件 → 前端类型」的别名映射（`DataOfComponent` / `DataOf<操作名>`）。
- 后端声明与实际返回不一致时，后端 `test/contract.e2e-spec.ts` 会失败（同一份 schema 校验真实响应）。
- 后端改了返回结构：`pnpm openapi:dump`（后端）→ `pnpm openapi:gen`（前端）→ 类型自动更新。

**新增接口时**：后端控制器必须加 `@ApiOkZod(...)`，否则该接口在前端没有响应类型。

## 目录

```
src/
  api/
    schema.d.ts      # codegen 产物（勿手改）
    types.ts         # 组件 → 类型别名映射（DataOf / DataOfComponent）
    http.ts          # axios 封装：解包 {code,msg,data}、401 处理、幂等键
    auth.ts user.ts role.ts dept.ts menu.ts dict.ts config.ts log.ts hazard.ts
  stores/auth.ts     # token + 档案 + 权限判定
  router/index.ts    # 路由 + 守卫（登录态 / 后台准入 console:access / 权限码）
  directives/perm.ts # v-perm 按钮级权限
  utils/permission.ts# 与后端同源的权限码匹配（通配 + deny 优先）
  layouts/AppLayout.vue
  views/
    LoginView.vue
    system/UserView.vue RoleView.vue DeptView.vue
    system/MenuView.vue DictView.vue ConfigView.vue AuditLogView.vue LoginLogView.vue
    hazard/HazardView.vue        # 第一个业务闭环（状态机驱动的按钮）
    NotFoundView.vue
```

## 与后端的约定

- **响应包络**：所有接口返回 `{ code, msg, data }`；`code === 200` 才算成功。
  业务异常也是 **HTTP 200 + `code: 403/500`**（`ApiException` 约定），框架异常才用真实 HTTP 状态。
  因此拦截器只看 `body.code`，不看 HTTP 状态。
- **鉴权**：`Authorization: Bearer <token>`；token 存在 `localStorage` 的 `template_token`。
- **幂等**：带 `@Idempotent()` 的接口要求 `Idempotency-Key` 头（缺失直接 400）。
  `request.post()` 默认自动带一个 UUID，无需调用方关心。
- **权限码**：与后端 `RbacGuard` 同一套规则 —— `*:*:*` 全通、`system:*` 段末通配、
  `!system:*` 否定且 **deny 优先**。菜单/按钮显隐都用它。

## 环境变量（可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | 接口前缀 |
| `VITE_CAPTCHA_ENABLED` | `false` | 是否展示图形验证码（需与后端 `CAPTCHA_ENABLED` 一致） |

## 部署

`pnpm build` 产物 `dist/` 由 Nginx 站点 `template-admin` 托管（端口 8080），
`/api` 反代到 Nest。见 `../deploy/nginx/template-admin.conf`。

## 后台准入（console:access）

本端只给**超管 + 管理员**用，靠权限码 `console:access`（见 `stores/auth.ts` 的
`canAccessConsole` 与 `router/index.ts` 的守卫）。

准入码刻意**不落在 `system:` 域**：管理员的授权是 `*:*:*,!system:*`，
`!system:*` 会把整个 system 域挡掉 —— 若用 `system:console:access`，连管理员都进不来。

注意这只是**前端顺手挡一下**（可绕过）：真正的边界是后端每个接口上的
`@RequiresPermissions`。

## 第一版范围

已完成：登录、布局与菜单权限、用户管理（含角色授权/临时授权）、角色管理、部门树管理。
未做：菜单/字典/参数/操作日志/登录日志、文件上传、CASL 规则可视化编辑、`CUSTOM` 数据范围的部门集合选择。
