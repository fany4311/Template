# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-24

---

## 现在做什么

- **工具链已铺平**（2026-11-24）：`oxlint` + `oxfmt` 覆盖三个子项目，**prettier 已移除**；
  全仓按 oxfmt 重排（server 77 文件 / web_admin 41 / web 7，纯换行与引号，无逻辑改动）；
  `verify.sh` 增加「前端 lint」与「格式检查」两步。
- **`dataScope=CUSTOM` 已完成**（2026-11-24）：`sys_role_dept` 表 + 迁移、会话带
  `dataScopeDepts`、`DataScopeService` 的 CUSTOM 分支、角色编辑页部门树多选（空选拦提交）。
  端到端实测：CUSTOM=部门1 → 0 条、部门2 → 2 条、admin(ALL) → 2 条。
  同时修掉一个真缺口：`hazard` / `user` 三处调用点手搓 `{userId, deptId}`，把
  `dataScopeDepts` 丢了（CUSTOM 静默空集）。
- **E2E 已跑通**（2026-11-24）：`web_admin/e2e/` 认证链路 **3 通过 / 2 跳过**
  （跳过的两条要超管密码，走 `E2E_ADMIN_USER` / `E2E_ADMIN_PASS`）。
  跑通过程中修掉一个真 bug：未登录访问深链时先命中 public 的 catch-all →
  渲染 404 而不是登录页（守卫已加 `to.name !== 'not-found'`）。
- **数据变更按标签失效**：`composables/useRefetch.ts`（等价 TanStack `queryKey` 的 1%），
  `useCrud` 支持 `tags`；已接线 用户 / 角色 / 部门 三处。
- 库与账号三角色化已收口（详见 `log/20261124_库与账号三角色化.md`）。

## 下一步

> 选型复核结论见 `整体方案与选型.md` §4.1：运行时不换，只补工具链。

- [ ] **P1 E2E 跑通并补链路**：先在有网的机器 `npx playwright install chromium`，
      把认证 4 条跑绿；再补「建角色→建用户并授权」「隐患流转到销号」「附件上传-下载-回收」。
- [ ] **P2 `@nestjs/storage@0.0.4`**：0.0.x 随时可改 API。当前用法极浅（
      `storage.disk()` / `defaultDisk` / `put` / `get` / `delete` 五个），
      替换成本约半天（S3 兼容用一个适配器即可）。**现在只 pin 版本，等文件模块要加密/多桶时一起换。**
- [ ] **P2 部署端巡检**：`deploy/check.sh`（连通性、磁盘、备份时效 + sha256 复校）。
      注：本机无 `mysqldump`/`mysql` 客户端，`backup.sh` 只能在部署端跑（`restore.sh` 已有容器回退）。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

## 阻塞

- 无。

## 验证台账

- 2026-11-24 `verify.sh` 增加迁移一致性门禁（`migration:show` 出现 `[ ]` 即失败）。
  用探针迁移实测：插入未执行迁移 → verify exit=1；删掉 → 全绿。探针的 dist 残留已清。
- 2026-11-24 `dataScope=CUSTOM` 端到端：建角色（部门1,2）→ 详情回读 [1,2] → 改 [2] → 空数组；
  临时用户持该角色登录，隐患列表 CUSTOM=1 → 0 条 / =2 → 2 条 / admin(ALL) → 2 条；
  测试数据（用户/角色/关联）已清理。E2E 6/6 通过。
- 2026-11-24 E2E 首次跑绿：`npx playwright test` → 3 passed / 2 skipped（18s→2.6s）。
  同时验证 WSL2 无 IPv6 出口导致浏览器下载卡住，`--dns-result-order=ipv4first` 可解。
- 2026-11-24 守卫修复后 `scripts/verify.sh` 全绿。
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
