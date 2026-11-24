# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-24

---

## 现在做什么

- **库与账号改造已落文件、等执行 DDL**（本轮新增）：`server/sql/databases.sql` 成为库/账号/授权的
  单一真源，台账在 `docs/库台账.md`；三类角色 `<项目>`(dev) / `_prod` / `_tmp`；
  **一库一账号**（`template_dev` / `template_prod` / `template_tmp`，各自只授本库）。
  `template_test` 已改名 `template_tmp`（`.env.test` / 台账 / vitest 注释已同步）。
  新增 `scripts/db-reset.sh`（tmp 库 DROP→CREATE→授权→迁移 一条命令，默认只敢动 `*_tmp`）。
  顺手修了两处隐患：`backup.sh` 默认备份的是 **dev 库**（`DB_NAME` 现在必填）；
  `restore.sh` 只认 `DB_USER`、而 `.env.prod` 给的是 `DB_USERNAME` → 会静默退回旧共享账号。
- Template 副本已接入本地 MySQL / Redis：20 个迁移已跑、48 条权限码已同步，超管可登录后台（5183）。
- P0 / P1 / P2 全部落地：主题与暗色、列表抽象、CSV 导入导出、`gen:module`、
  监控与审计留存、备份恢复、权限一致性门禁、字典缓存、用户导入导出。
- 系统域全部列表页 + 两个日志页已统一到 `useCrud` / `DataTable`；树表只换表格。
- 生成器补齐：`--menu-parent`（挂父菜单）、`--unique`（唯一键 + 前置查重）、`file` 字段
  （不建列，自动生成 `FileBizHandler` + 前端 `BizFiles` 附件抽屉）。
- **工作区有未提交改动**：后端 `gen-module.ts`、前端 8 个视图/组件 + `BizFiles.vue`、四份文档。

## 下一步

> 选型复核（对照一份外部多项目栈）结论已落到 `整体方案与选型.md` §4.1：运行时不换，只补工具链。
> 复核中纠正一处误判：**会话撤销已实现**（`core/session` + `JwtStrategy` 比对 Redis token，
> 登出 / 踢人 / 权限变更即失效），不需要用 Redis 黑名单或换 Better Auth 重做。

- [ ] **执行库与账号 DDL**（在托管 MySQL 的机器上，顺序不能反）：
      **✅ 已完成（2026-11-24）**：`bash scripts/db-apply.sh` 建库建号（幂等）、
      `db-reset.sh` 重建 `template_tmp`、`verify.sh` 全绿、dev 三进程 online、health/ready 数据库 up。
      遗留：`'template'@'%'` **尚未 DROP**（旧共享账号），需先确认部署端无其它项目复用。
      注：本机还有 `csmu0_db`（用 root 账号，不属本项目身份，不在本次改动范围）。
- [ ] **P1 E2E 金链路**：现状只有静态检查 + 单测，**没有一条验证流程真能跑通**
      （`验证台账` 里「隐患全流程 —— 用户已确认」是手工证据）。Playwright 只写 3 条：
      登录→建角色→建用户并授权 / 隐患流转到销号 / 附件上传-下载-回收。
- [ ] **P1 前端工具链铺平**：`web_admin` / `web` 目前**无 lint 无 format**（只有 `vue-tsc`），
      与后端 `oxlint + prettier` 不对称。用已有依赖补齐并进 `verify.sh`；**不引入 oxfmt**。
- [ ] **P2 部署端巡检**：新增 `deploy/check.sh`（MySQL / Redis / MinIO 连通、磁盘余量、
      备份文件时效 + sha256 复校）。`backup.sh` 做了 gzip 校验，但**没人定期跑**——等于没备份。
- [ ] 提交并推送：`main` 已领先 `origin/main` 6 个提交，加上本轮改动；
      建议拆两个提交（视图迁移 / 平台级授权锁定），推送前先跑全量 `scripts/verify.sh`。
- [ ] 角色 CASL `rules` 编辑 UI 与 `dataScope=CUSTOM` 部门集合（见 `权限设计-CASL.md` §12）。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

## 阻塞

- 无。

## 验证台账

- 2026-11-24 库与账号改造执行完毕：`db-apply.sh` 建库建号（三段密码互不相同、每账号只授本库）、
  `db-reset.sh --yes` 重建 `template_tmp` 并跑完迁移、`scripts/verify.sh` **全绿**、
  dev 三进程 online、`/health/ready` 数据库 up、admin 200 / web 200。
  当日库里另有派生项目 `csmu*` / `safe_campus*` / `nest_template` / `tsg` —— 不属本项目身份，未动。
- 2026-11-17 全量 `scripts/verify.sh`：后端 tsc / oxlint / authz-check（48 码）/ 单测 16 文件 113 用例、
  前端 `vue-tsc -b` / `vite build` —— 全绿。
- 生成器增强另用临时库 `template_gen_test` 走了一遍建库 → 迁移 → 校验 → 回滚 → 删库：
  菜单 parent/ancestors 正确、UNIQUE 键生效、down 干净；生成物在时前后端均可构建。
- 前端产物 index 1.12 MB（gzip 373 KB）；HazardView 19.5 KB、UserView 14.1 KB、RoleView 10.8 KB。
- 手工验证：角色（超管锁、通配授权锁）、用户（授权 / 重置密码）、隐患全流程流转 —— 用户已确认。
