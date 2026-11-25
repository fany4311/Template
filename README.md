# Template — 通用管理系统底座

适用于大部分「后台管理 + 审批流转」类系统的**通用底座**：机制进底座，业务留派生项目。
自带一个完整示例业务（隐患闭环），用于验证底座够用。

- 后端：Node 24 + pnpm + NestJS 12（ESM）+ Zod 4 + TypeORM + MySQL + Redis
- 前端：Vue 3 + Vite + Element Plus（`web_admin` 后台 / `web` 面向业务用户的最小壳）
- 能力：RBAC + CASL 权限、事务与 Outbox、审计管道、文件与附件、字典/参数/部门/菜单、幂等、限流
- 派生：从基线复制一份副本改，**不从零起** —— 见 `docs/init.md`

## 快速开始（本地）

```bash
bash scripts/db-apply.sh                 # 建库建号（读三份 .env 的密码）
cd server && pnpm install && pnpm migration:run
cd .. && bash deploy/template.sh dev start   # 后端 3010 / 后台 5183 / 前端 5184
```

提交前跑一遍校验：`bash scripts/verify.sh`。

## 文档怎么读

| 想了解 | 去看 |
|---|---|
| 这是什么 / 硬边界 / 端口冻结 | `docs/INTENT.md` |
| 现在做到哪、下一步 | `docs/CONTEXT.md` |
| 踩过的坑与不能做的事 | `docs/坑与约束.md` |
| 目录与编码规范、错误码契约、权限设计、文件、部署 | `docs/` 下同名文档 |
| 给 AI 助手看的项目路由 | `AGENTS.md` |
| 历史记录（只读） | `docs/log/` |
