# Template 管理平台 · 后端（server）

基于 **NestJS 12 + ESM + TypeScript 6 + TypeORM + MySQL + Redis + Zod(Standard Schema)**。
由 `Nest-template`（Nest 11/CJS）升级改造而来，遵循项目根 `AGENT.md`。

- 接口：`/api/v1`（URI 版本化）
- 文档：`/api/docs`（Swagger，右上角 Authorize 填 `Bearer {token}`）
- 健康：`/api/v1/health/live`、`/api/v1/health/ready`

## 快速开始

```bash
pnpm install
cp .env.example .env.dev      # 按本地环境填值
pnpm start:dev
```

> 依赖 MySQL 8 + Redis（本地见 `~/Docker/{mysql,redis}/compose.yaml`）。
> 开发用 `DB_SYNCHRONIZE=true` 自动建表；**生产必须 false，改用迁移**。

## 技术要点

| 能力      | 实现                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| 模块系统  | **ESM**（`"type":"module"`，相对导入带 `.js`）                                          |
| 入参校验  | **Standard Schema（Zod）** + `StandardSchemaValidationPipe`，路由参数 `@Body({schema})` |
| 配置校验  | `@nestjs/config` + Zod `validationSchema`                                               |
| 认证      | @nestjs/jwt + passport-jwt + Redis token（登出/踢下线）                                 |
| 密码      | `@node-rs/argon2`（argon2id）                                                           |
| RBAC      | `@RequiresRoles` / `@RequiresPermissions` + 全局 RbacGuard                              |
| 统一响应  | `{code,msg,data}` + `X-Trace-Id`；异常含 `traceId`/`errorCode`                          |
| 上下文    | `nestjs-cls`（traceId，后续复用于事务/审计）                                            |
| 日志      | nestjs-pino + pino-roll                                                                 |
| 健康检查  | @nestjs/terminus v12（`HealthIndicatorService` 新 API）                                 |
| 限流      | @nestjs/throttler（默认 300 次/分）                                                     |
| 事件/定时 | @nestjs/event-emitter（进程内）/ @nestjs/schedule                                       |
| 迁移      | TypeORM migrations（先编译再执行，`pnpm migration:*`）                                  |
| 测试/Lint | Vitest / oxlint                                                                         |

## 结构

见 `../docs/目录与编码规范.md`。

## 现状（Day 1）

已完成：ESM + Nest 12 升级、Zod 校验、健康检查、traceId、限流/事件/定时装配、迁移骨架、
auth/user 模块（RBAC 演示）跑通、vitest + oxlint、部署骨架（`../deploy`）。

待办（后续）：事务/幂等/审计管道、CASL 权限引擎、OTel、省平台 adapter（等 API 文档）、
MinIO 文件、备份脚本落地、前端初始化。
