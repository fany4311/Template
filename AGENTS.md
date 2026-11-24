# AGENTS.md — 项目上下文路由

> 本文件是**路由索引**，不是知识库。
> 结构信息用 `codegraph_*` / `ffgrep` **现场取**，不要在此罗列。
> 目标：常驻窗口只放「最小高信号集 + 索引」，细节用时才 dereference。

---

## 黄金法则

1. **能工具拿到的就不手写**
   - 代码结构 / 谁调用谁 / 影响面 → `codegraph_search` `codegraph_node` `codegraph_explore` `codegraph_impact`
   - 文本 / 常量 / 配置字面量 → `ffgrep`
   - 接口契约 → `web_admin/openapi.json`（由 `dump-openapi` 生成）
   - 权限码清单 → `pnpm authz:sync` 落库的 `sys_permission`
2. **只手写代码里看不见的**：意图（为什么）、硬约束（不能做什么）、跨文件契约、踩过的坑。
3. **改完先报告，等确认再提交**；提交前 `svn update`。不确定就问，不猜。
4. 少耦合、可拓展；**能工具规范生成的就不手写**（减错、便于二次修改）。
5. 直改 `trunk`，**不从零起**；派生新项目走 `docs/init.md`。

---

## 当前状态（每次会话先看）

| 作用 | 文件 | 谁维护 | 更新方式 |
|---|---|---|---|
| 意图与硬约束（**权威**） | `docs/INTENT.md` | 人类 | 改架构/改铁律才动 |
| 执行状态快照 | `docs/CONTEXT.md` | AI | 开工前读，**收尾覆盖** |
| 历史记录（只读） | `docs/log/` | AI + 人类 | **append-only**，完成即归档 |
| 血泪清单 | `docs/坑与约束.md` | 双方 | 新增坑才追加，不删 |

---

## 会要命的约束（其余见 `docs/坑与约束.md`）

- **ESM**：相对导入必须带 `.js`；禁 `src/...` 路径别名；用 `import.meta.dirname`；内置模块加 `node:` 前缀。
- **数据库**：`DB_SYNCHRONIZE=false`（三份 `.env`）；已跑迁移不可改，只能追加；派生新系统**必须独立库**。
- **库与账号**：三类角色 `<项目>`(dev) / `<项目>_prod` / `<项目>_tmp`；定义在 `server/sql/databases.sql`，
  台账在 `docs/库台账.md`。**一库一账号，禁止跨库 GRANT** —— dev 凭据必须读写不了 prod 库。
- **TypeORM**：联合类型字段必须显式 `type`。
- **工具链**：`oxlint` 检查 + `oxfmt` 格式化（**prettier 已移除，别加回来**）；
  前端也必须过 lint —— `verify.sh` 已包含，前端再也不能只有 `vue-tsc`。
- **权限码**：接口（DTO）只收具体码（2–3 段小写，不含 `*` / `!`）；`*:*:*` 必须独占。
- **同机共存**：绝不 `pm2 kill` / 停 nginx；端口 / PM2 名 / 站点名 / 目录 / token key 全局唯一；库 / Redis 索引 / bucket 独立。
- **依赖**：严禁自改版本；新增依赖先问。
- **提交**：只创建清单类文件；动架构先汇报；提交信息简洁。

---

## 常青契约（按需读，别全读）

| 主题 | 文件 |
|---|---|
| 目录与编码规范 | `docs/目录与编码规范.md` |
| 错误码与响应契约 | `docs/错误码与响应契约.md` |
| 权限设计（CASL） | `docs/权限设计-CASL.md` |
| 横切地基：事务与审计 | `docs/横切地基-事务与审计.md` |
| 文件与附件 | `docs/文件与附件.md` |
| 整体方案与选型 | `docs/整体方案与选型.md` |
| 通用底座：范围与冻结点 | `docs/通用底座-范围与冻结点.md` |
| 通用管理域 | `docs/通用管理域.md` |
| 隐患闭环（示例业务） | `docs/隐患闭环.md` |
| 部署端环境 | `docs/部署端环境.md` |
| 库与账号台账 | `docs/库台账.md` |
| 本地环境 | `docs/本地环境.md` |
| 派生新项目清单 | `docs/init.md` |

---

## 怎么查（优先顺序）

`codegraph_search` / `codegraph_node` / `codegraph_explore`
→ `ffgrep`（优先裸标识符）
→ `read`

**不要一上来就 grep 全仓。**

---

## 结构速览（仅 5 行，详细用 codegraph）

- `server/` — NestJS 12 + ESM 后端；`src/modules/*` 业务模块，`src/common/*` 横切，`src/core/*` 基础设施，`src/core/database/migrations/*` 迁移。
- `web_admin/` — Vue3 + Element Plus 后台（端口 5183 dev / 8080 prod）。
- `web/` — Vue3 最小壳（端口 5184 dev / 8084 prod）。
- `deploy/` — `template.sh`（dev/prod 启停）、`rename.sh`（派生改名）、nginx、pm2 配置、`.env.prod.example`。
- `docs/` — 本目录，随 tag 派生。
