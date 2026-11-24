# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-24

---

## 现在做什么

- **库与账号三角色化已收口**（详见 `log/20261124_库与账号三角色化.md`）：
  `server/sql/databases.sql` 为单一真源、一库一账号、`db-apply.sh` / `db-reset.sh` 落地、
  恢复演练改为固定名 `_tmp_restore` 且剥掉 dump 里的 `USE` / `CREATE DATABASE`。
- 工作区干净，`main` 与 `origin/main` 已同步（本轮 3 个提交已推送）。
- Template 副本已接入本地 MySQL / Redis：迁移已跑、48 条权限码已同步，超管可登录后台（5183）。
- P0 / P1 / P2 全部落地：主题与暗色、列表抽象、CSV 导入导出、`gen:module`、
  监控与审计留存、备份恢复、权限一致性门禁、字典缓存、用户导入导出。
- 系统域全部列表页 + 两个日志页已统一到 `useCrud` / `DataTable`；树表只换表格。

## 下一步

> 选型复核（对照一份外部多项目栈）结论已落到 `整体方案与选型.md` §4.1：运行时不换，只补工具链。
> 复核中纠正一处误判：**会话撤销已实现**（`core/session` + `JwtStrategy` 比对 Redis token），
> 不需用 Redis 黑名单或换 Better Auth 重做。

- [ ] **P1 权限缺口（建议下一件做）**：`dataScope=CUSTOM` 现在界面禁用、后端
      「暂按无权限处理」——枚举与接口都接受 CUSTOM，一旦被传进来就是**静默查不到数据**，
      不报错。补 `sys_role_dept` + `DataScopeService` 的 CUSTOM 分支 + 角色编辑页部门树多选；
      同批做角色 CASL `rules` 编辑 UI（`权限设计-CASL.md` §12）。
- [ ] **P1 E2E 金链路**：现状只有静态检查 + 单测，没有一条验证流程真能跑通。
      Playwright 只写 3 条：登录→建角色→建用户并授权 / 隐患流转到销号 / 附件上传-下载-回收。
      建议排在权限缺口之后（用测试钉住刚做的行为）。
- [ ] **P1 前端工具链铺平**：`web_admin` / `web` 目前无 lint 无 format（只有 `vue-tsc`）。
      用已有依赖补齐并进 `verify.sh`；**不引入 oxfmt**。
- [ ] **P2 部署端巡检**：`deploy/check.sh`（MySQL / Redis / MinIO 连通、磁盘余量、
      备份文件时效 + sha256 复校）。`backup.sh` 有 gzip 校验但没人定期跑 —— 等于没备份。
      注：本机没有 `mysqldump`/`mysql` 客户端，`backup.sh` 目前只能在部署端跑（restore.sh 已做容器回退）。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

## 阻塞

- 无。

## 验证台账

- 2026-11-24 恢复演练脚本改造后实测：dump(16K) → `template_tmp_restore` 19 表 / 5 用户 / 5 角色，
  源库 `template` 19 表 5 用户未受影响，演练库已删；`--db template_prod` 被拒（exit 1）。
  同时修掉一个真 bug：`--databases` 型 dump 含 `USE`，原样灌会写回源库（目标库 0 表）。
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
