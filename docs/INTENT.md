# INTENT — 意图与硬边界（人类权威）

> 本文件由**人类**维护，是「为什么这么做」与「绝对不许做什么」的唯一权威。
> AI 只读不改；如发现与代码冲突，先问人。
> 只写代码里看不见的东西；结构/接口/字段一律用 `codegraph`、`openapi.json` 现场取。

---

## 1. 这是什么

适用于大部分系统，比如「湖南省校园数字化安全管理和应急平台 + 校内自建上报系统」的**通用管理系统底座**（`Template`）。

- 交付形态：**底座 + 示例业务（hazard）**；派生新项目 = 从底座 tag 复制后改造，**不从零起**。
- 底座**只做机制，不做业务**；底座内不允许出现业务名词（`hazard` 是明确的示例例外，**完全不动**）。
- 四层覆盖：① 接入契约 ② 核心业务权限（RBAC + ABAC + ReBAC-lite）③ 数据安全 ④ 运行保障。

## 2. 技术基线（不许擅动版本）

- 后端：Node 24 + pnpm + **NestJS 12** + ESM（`.ts` 源，`nodenext`）+ Zod 4 + TypeORM + argon2。
- 前端：Vue 3 + Vite + Element Plus，**静态托管**。
- 架构：Nest 六边形；**CASL 单引擎**做权限；pino 日志 + 独立审计管道（**OTel 指标/链路为目标设计，未落地**）。
- **版本基线规则**：前后端退回「上一代成熟主版本」，特殊的除外。
- **严禁自作主张改依赖版本**；新增依赖必须先点头。

## 3. 硬边界（不许做 / 必须做）

- ESM 铁律：相对导入必须带 `.js`；禁 `src/...` 别名；`import.meta.dirname`；`node:` 前缀。
- 生产 `DB_SYNCHRONIZE` **必须 false**；已跑迁移**不可改**，修正一律追加。
- 派生新系统**必须独立**：库 / 账号 / Redis 索引 / bucket / 端口 / PM2 名 / 站点名 / token key。
- 同机共存：绝不 `pm2 kill`、绝不 `systemctl stop nginx`、绝不 `nginx -s stop`；只停本项目。
- 接口只接受**具体权限码**（2–3 段小写标识符，不含 `*`、不含 `!`）；通配/否定只由迁移/seed 写入。
- 业务异常约定：`ApiException` → HTTP 200 + `body.code`（若依约定），e2e 按此断言。
- **改完先报告，不自动提交**；提交前 `svn update`；提交信息简洁。

## 4. 存储决策

- 可拔插：`STORAGE_DRIVER=local | s3`。
- **派生新项目默认 `local`**（`STORAGE_LOCAL_ROOT=./data/uploads`）；要对象存储再切 `s3`。
- s3 走独立容器 `minio`，bucket 私有，下载走后端代理，`objectKey` 服务端生成。
- 不做跨用户内容去重（`objectKey` 带 `uploaderId` 命名空间）。
- 切 s3 时 `FORCE_PATH_STYLE=true`、`SERVER_SIDE_ENCRYPTION=false`（MinIO 未开 KMS）。

## 5. 角色/权限模型（已冻结）

- 角色编号化：`level` smallint、**唯一、非自增**；内置 0–4（superadmin 0 / admin 1 / manager 2 / operator 3 / auditor 4），自建 5+。
- **超管判据 = `level === 0`**；`role_key` 列**不恢复**。
- `is_builtin`：内置角色不可删；超管角色**只读**，服务端只放行改 `roleName`。
- AUTHZ 变更（权限/规则/数据范围/状态）→ **事务提交后**失效会话。
- 超管权限 = 纯 `*:*:*`，禁止再挂具体码或 `!` deny。

## 6. 端口 / 命名冻结（同机多项目共存）

| 用途 | dev | prod |
|---|---|---|
| api | 3010 | 3000 |
| web_admin | 5183 | nginx 8080 |
| web | 5184 | nginx 8084 |

- `BigScreen` 占 5173/5174/8081/8082，**已彻底分家**（独立库 `bigscreen*`）。
- 改端口必须三处同步：`deploy/template.sh`、两个 `vite.config.ts`、Nginx conf（重新渲染）。
- 部署端可改项统一标 `# TODO(部署端)`。

## 7. 文档归属

- 实现说明写在**底座仓库 `docs/`**，随 tag 派生；派生项目**只读不复制**。
- 常青契约留 `docs/`；一次性记录归档 `docs/log/`；进行中只留 `docs/CONTEXT.md`。
