# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-24

---

## 现在做什么

- **工具链已铺平**（2026-11-24）：`oxlint` + `oxfmt` 覆盖三个子项目，**prettier 已移除**；
  全仓按 oxfmt 重排（server 77 文件 / web_admin 41 / web 7，纯换行与引号，无逻辑改动）；
  `verify.sh` 增加「前端 lint」与「格式检查」两步。
- **E2E 骨架已就位**：`web_admin/e2e/`（认证 4 条）+ `playwright.config.ts`；
  **浏览器未安装**（本机到 `cdn.playwright.dev` 不通），所以**尚未真正跑过**。
- **数据变更按标签失效**：`composables/useRefetch.ts`（等价 TanStack `queryKey` 的 1%），
  `useCrud` 支持 `tags`；已接线 用户 / 角色 / 部门 三处。
- 库与账号三角色化已收口（详见 `log/20261124_库与账号三角色化.md`）。

## 下一步

> 选型复核结论见 `整体方案与选型.md` §4.1：运行时不换，只补工具链。

- [ ] **P1 权限缺口**：`dataScope=CUSTOM` 界面禁用、后端「暂按无权限处理」，
      被传进来就是静默查不到数据（不报错）。补 `sys_role_dept` + `DataScopeService` 分支 +
      角色编辑页部门树多选。**CASL `rules` 编辑 UI 不做**（用户决定）。
- [ ] **P1 E2E 跑通并补链路**：先在有网的机器 `npx playwright install chromium`，
      把认证 4 条跑绿；再补「建角色→建用户并授权」「隐患流转到销号」「附件上传-下载-回收」。
- [ ] **P2 部署端巡检**：`deploy/check.sh`（连通性、磁盘、备份时效 + sha256 复校）。
      注：本机无 `mysqldump`/`mysql` 客户端，`backup.sh` 只能在部署端跑（`restore.sh` 已有容器回退）。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

## 阻塞

- 无。

## 验证台账

- 2026-11-24 工具链改造后 `scripts/verify.sh` 全绿（新增前端 lint / 格式检查两步）：
  后端 tsc + oxlint + 权限一致性（48 码）+ 单测 16 文件 113 用例；前端 lint ×2 +
  `oxfmt --check` ×3 + `vue-tsc` + `vite build` ×2。
- **E2E 未执行**：用例与配置已提交，浏览器装不上（CDN 不可达）。不许写成"已验证"。
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
