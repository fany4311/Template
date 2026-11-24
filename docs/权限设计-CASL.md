# 权限设计：RBAC + ABAC + ReBAC-lite（CASL）

> 一套机制同时覆盖「谁能做什么」（RBAC）、「什么条件下能做」（ABAC）、
> 「基于关系能做」（ReBAC-lite，如本人/本部门）。**机制进底座，策略留业务**。

## 1. 选型与分层

- 引擎：`@casl/ability` v7。预留 `PolicyPort`，将来可平滑换 `@openfga/sdk`（Zanzibar）等外部授权服务。
- **RBAC**：角色 → 权限码（`system:user:add`）+ 角色 → 规则（无 conditions）。
- **ABAC**：规则带 `conditions`，如 `{ status: 1 }`。
- **ReBAC-lite**：条件里用占位符引用当前用户关系维度，如 `{ deptId: '${deptId}' }`、`{ ownerId: '${userId}' }`。

## 2. 数据模型

- `Role.permissions: string[]` —— 权限码，`'*:*:*'` 为超管（按钮/菜单级）。
- `Role.rules: AbilityRule[]` —— CASL 规则（支持 conditions）。

```ts
interface AbilityRule {
  action: AppAction;        // read / create / update / delete / manage / export ...
  subject: AppSubject;      // User / Role / Hazard / 'all' ...
  conditions?: Record<string, any>;  // ABAC / ReBAC-lite
  fields?: string[];
  inverted?: boolean;       // 反向（禁止）
}
```

## 3. 运行时链路

```
登录：汇总各角色的 permissions + rules → Redis 缓存（auth:perms / auth:rules）
请求：JwtStrategy → request.user{ roles, permissions, rules }
守卫：JwtAuthGuard → RbacGuard(权限码) → PoliciesGuard(CASL 策略)
```

`AbilityFactory.createForUser(user)` 由 permissions + rules 建 ability（`*:*:*` → `manage all`），
`PoliciesGuard` 执行 `@CheckPolicies` 声明的策略。

## 4. 用法

```ts
@CheckPolicies((ability) => ability.can('read', 'User'))   // 接口级
@Get() page() { ... }

// 资源级（ABAC/ReBAC-lite）：服务内按具体资源判定
const ability = abilityFactory.createForUser(user);
if (!ability.can('update', subject('Hazard', hazard))) {
  throw new ApiException('无权修改该隐患', 403);
}
```

## 5. 与 RBAC 的关系

| 机制 | 管什么 | 装饰器 |
|---|---|---|
| RBAC 权限码 | 能不能进这个接口（粗粒度） | `@RequiresPermissions` / `@RequiresRoles` |
| CASL 策略 | 能不能对这个资源做这个动作（细粒度、可带条件） | `@CheckPolicies` |

系统管理域（user/role/dept）只用 `@RequiresPermissions`；`@CheckPolicies` 留给**业务资源**的细粒度判定。

## 6. 代码

`common/authz/{ability.types.ts, ability.factory.ts}`、`common/decorators/check-policies.decorator.ts`、
`common/guards/policies.guard.ts`；单测 `common/authz/ability.factory.spec.ts`。

## 7. 权限码匹配规则（RbacGuard）

`@RequiresPermissions` 支持段末通配与**否定**（deny 优先于 allow）：

| 用户持有 | 可匹配 |
|---|---|
| `*:*:*` | 一切 |
| `system:*` | `system:user:add`、`system:dept:list` … |
| `system:user:add` | 仅精确 |
| `!system:*` | **禁止** system 域全部 |

> 字符串参数 = 任一满足（OR）；数组参数 = 全部满足（AND）。
> 例：`['*:*:*', '!system:*']` = 业务全权、但不得进入系统管理域。
> 唯一实现：`common/authz/permission.util.ts`。

## 8. 组织与数据范围（dataScope）

数据范围放在**角色**上、与部门解耦，用户调岗只改 `User.deptId` 即自动生效。

- 枚举：`ALL / DEPT_AND_CHILD / DEPT / SELF / CUSTOM`（`Role.dataScope`）。
- 部门树：`sys_dept`（`parentId` + `ancestors` 祖先路径，便于求子树）。
- 用户：`User.deptId`、`User.post`。
- 解析：`DataScopeService.resolve(user, scopes, { deptColumn, ownerColumn })`
  → 返回可 `qb.andWhere(clause, params)` 的片段；**多角色取并集**，无可用条件时 **fail-closed**（`1 = 0`）。

登录时把 `dataScopes` 并集写入会话（`auth:profile`），`JwtStrategy` 挂到 `request.user.dataScopes`，
查询层统一收敛，避免过滤散落各处：

```ts
const { clause, params } = await dataScope.resolve(
  { userId: user.userId, deptId: user.deptId }, user.dataScopes,
  { deptColumn: 'u.deptId', ownerColumn: 'u.id' },
);
qb.andWhere(clause, params);
```

## 9. 授权：显式用户-角色与临时授权

`User.roles` 由隐式多对多改为**显式关联实体** `UserRole`（`sys_user_role`）：

| 字段 | 作用 |
|---|---|
| `userId` / `roleId` | 授权关系（`uk_user_role` 唯一） |
| `expireAt` | 到期时间；非空 = **临时授权**，到期自动失效 |
| `source` | `direct` 永久 / `temp` 临时 |
| `grantedBy` | 授权人 |

- 有效角色 = `expireAt IS NULL OR expireAt > now`（登录/查询均过滤）。
- 接口：`POST /user/:id/roles`、`DELETE /user/:id/roles/:roleId`、`GET /user/:id/roles`。
- **权限变更即时生效**：授权/撤销/改部门/禁用后 `SessionService.invalidate(userId)` 删会话，旧 token 立即 401。
- **回收任务** `AuthorizationTask`（每 10 分钟）：清理到期临时授权 + 兜底失效禁用用户会话。

## 10. 内置角色（seed 迁移）

| level | 名称 | permissions | dataScope |
|---|---|---|---|
| `0` | 系统管理员 | `*:*:*`（唯一、不可删、不可改权限） | ALL |
| `1` | 校级管理员 | `*:*:*,!system:*`（业务全权、禁系统域） | ALL |
| `2` | 部门管理员 | 待业务权限码补充 | DEPT_AND_CHILD |
| `3` | 业务操作员 | 待业务权限码补充 | SELF |
| `4` | 审计员 | 待业务权限码补充 | DEPT |

> **角色标识从 `role_key`（字符串）改成 `level`（编号）**：字符串标识会被人改，
> 一旦被当成程序判据（`roleKey === 'superadmin'`）就静默失效；编号由服务端分配且不可改，才是稳定身份。
> 内置占 0–4（`is_builtin=1`），自建角色从 5 起；**超管判据 = `level === 0`**，不是「permissions 是什么」——
> 权限串是会被改的数据，不能当身份。

> **超管权限 = 纯 `*:*:*`（决策 B）**：不再挂 `console:access` 等具体码。
> 理由：「通配 + 具体码」混用时，后来人无法判断那个具体码是「通配漏了」还是「刻意例外」，
> 等于制造了不可推理的状态。`*:*:*` 本已覆盖一切码，补丁需求自动消失。
> 代价：放弃「超管不碰业务数据」的蒙权分离 —— 超管确实能读业务数据，这靠审计（全操作留痕）约束，而非权限串。

> 历史遗迹：`1767000000000-SeedBuiltinRoles` 里超管写的是 `system:*`，
> `1767000018000-RoleSuperadminWildcard` 收敛成 `*:*:*`。迁移是**不可涂改的账**，故只加注释不改行为。

## 11. 权限清单（`sys_permission`）与 `pnpm authz:sync`

### 要解决的问题
权限码的真实出处只有一个 —— 代码里的 `@RequiresPermissions('system:role:list')`；
但角色的权限串是**另一份手抄副本**（迁移/seed 写、界面手输），两份无一致性机制，必然生三种病：
**幽灵码**（接口改名了，角色还挂旧码，看着有权限实际永不命中）、
**拼错码**（`system:role:lst` 看着正常就是不生效）、
**答不出「系统共有哪些权限码」**（只能 grep，且 grep 不可靠）。

### 采集：运行时反射，不是扫源码
装饰器实参不一定是字面量（隐患模块写的是 `@RequiresPermissions(HAZARD_PERMISSIONS.LIST)`），
文本扫描会**整条漏掉**。所以从 Nest 运行时元数据（`decorator:permissions`）取值，常量早已求值。

名称与分组也自动化，使清单与接口文档同源：

| 来源 | 用途 |
|---|---|
| `@ApiOperation({ summary })` | 权限名称 |
| `@ApiTags('角色管理')` | 模块显示名 |
| `EXTRA_PERMISSIONS`（代码常量） | 非接口码，如 `console:access` |

### 同步语义
- **upsert**：按 `code` 唯一键新增/更新名称与分组。
- **停用而非删除**：代码里找不到的码置 `status=0`（角色可能还引用着，删掉就查不到它的来历）。
- **空结果拒绝执行**：采集为空必是采集逻辑坏了，照跑会把整张清单停用。
- **不参与鉴权**：`RbacGuard` 只读 `sys_role.permissions`，清单为空也不影响鉴权 —— 避免「没同步 → 全员失权」。

```bash
pnpm authz:sync          # 改了装饰器后跑一次
```
部署侧 `deploy/template.sh` 在 pm2 重载前自动跑，**失败只告警不阻断启动**（清单是界面数据源，不应升级成可用性事故）。

### 界面
角色编辑弹窗的「权限」＝**按模块分组的树形勾选**（数据源 `GET /permission`）：只能选不能编；
角色里挂着但清单没有的码，单独归入「已失效 / 未收录」标红，**允许取消勾选**
（没这组，编辑老角色时幽灵码会被静默丢弃或永远删不掉）。

> **含平台级授权的角色（如校级管理员 `*:*:*,!system:*`）权限区只读。**
> 这类码不经接口写入，界面上放行也会被 DTO 拒；前端判据是「权限串里含 `*` 或 `!`」，
> **不是 `isBuiltin`** —— 部门管理员 / 业务操作员 / 审计员同为内置角色，权限为空，必须允许配置。
> 保存时只下发 `roleName` / `dataScope` / `status`，不回传 `permissions`（保持库中原值）。
> 少了这条，编辑校级管理员会先被前端兜底校验拦成「权限码格式非法」。

### 不变的边界
- 接口（DTO）**一律拒收** `*` 与 `!`：通配与否定只能由迁移 / seed 写入，
  否则任何持 `system:role:edit` 的角色都能给自己手输 `*:*:*` 提权。
- 权限码格式 `域:资源[:动作]`，2–3 段小写标识符（`console:access` 合法）。
  唯一实现：`common/authz/permission-code.ts`（后端）与 `web_admin/src/utils/permission.ts`（前端匹配器，与后端同源）。

## 12. 待做

- ~~数据范围 `CUSTOM`（自定义部门集合）~~ —— **已完成**（2026-11-24）：
  `sys_role_dept` + `DataScopeService` 的 CUSTOM 分支 + 角色编辑页部门树多选。
  CUSTOM 的部门集合在**登录时算并集写进会话**（`dataScopeDepts`），查询层不再回库查。
- 角色规则（CASL rules）编辑 UI —— **明确不做**（用户决定：规则属于平台设计，
  由迁移/seed 维护，界面放开等于给了提权入口）。
- 外部授权服务（OpenFGA）适配器（按需）。
- 业务资源的 `@CheckPolicies` 资源级判定。
