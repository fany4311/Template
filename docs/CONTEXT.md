# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-24

---

## 现在做什么

- **全量质量评审已出结论**（2026-11-24）：总分 **8.1/10**；明细与证据见
  `log/20261124_质量评审与P1修复.md`。评审方法全部可复现（verify / e2e / cov / audit /
  openapi 比对 / 库表实查 / 探针实测）。
- **本轮修掉的**（均已 `verify.sh` + `pnpm test:e2e` 复验）：
  - P1 软删 + 单列唯一互撞 → 迁移 `1767000024000` 把 3 张表的唯一键扩为 `(列, delete_time)`，
    实体同步；实测「软删后重建同名」三例全部通过。
  - P1 Swagger 生产公开 → `SWAGGER_ENABLED`，prod 默认关。
  - P2 删除保护 → 用户：拒删自己 / 拒删持有超管角色的账号；部门：有挂人拒删。
  - P2 审计 `detail` → `@Auditable({ capture })` 默认记入参，拦截器统一脱敏 + 截断。
  - P2 登录日志留存 → 每小时分批清理（默认 90 天，可配）。
  - P2 覆盖率口径 → `coverage.include: src/**`；**真实基线 18.93%**（旧 77% 是假象）。
  - P3 索引 → `idx_user_dept` / `idx_dept_parent`。
  - P1 账号侧能力 → 不预置，改为部署文档必查项（`docs/部署端环境.md`「账号与登录安全」）。
  - P1 multer high → `pnpm-workspace.yaml` 的 `overrides: multer >=2.5.0`
    （实际 2.5.0），audit 降为 0 high。
  - P2 `scope=SCHOOL` 落地：可见性 SQL 加 `OR h.scope='SCHOOL'`，前端上报加
    「全校通报」单选 + 提示、列表补可见范围筛选，e2e 新增一条。
  - P3 外键：**有意不加**，理由与补偿写进 `坑与约束.md`（含孤儿巡检 SQL）。
- 库与账号三角色化、`dataScope=CUSTOM`、E2E 认证链路均已收口（见 `docs/log/`）。

## 下一步

> 选型复核结论见 `整体方案与选型.md` §4.1：运行时不换，只补工具链。

**排期中（已列入但未动）**

- [ ] **P2 `@nestjs/storage@0.0.4`**：0.0.x 随时可改 API。当前用法极浅（
      `storage.disk()` / `defaultDisk` / `put` / `get` / `delete` 五个），
      替换成本约半天（S3 兼容用一个适配器即可）。**现在只 pin 版本，等文件模块要加密/多桶时一起换。**
- [ ] **P2 部署端巡检**：`deploy/check.sh`（连通性、磁盘、备份时效 + sha256 复校）。
      注：本机无 `mysqldump`/`mysql` 客户端，`backup.sh` 只能在部署端跑（`restore.sh` 已有容器回退）。
- [ ] **E2E 补链路**：现只有认证 3 条 + CUSTOM 1 条（超管相关需 `E2E_ADMIN_*`）。
      待补「建角色→建用户并授权」「隐患流转到销号」「附件上传-下载-回收」「删除保护」。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

**暂缓（有意不做）**

- CI / 提交前自动化校验：小项目通用模板，暂不引入（`verify.sh` 手动跑）。
- 前端主包 1.12 MB：已确认可接受。

## 阻塞

- 无。

## 验证台账

- 2026-11-24 本轮修复后 `scripts/verify.sh` **exit 0**（真实退出码，未用管道遮蔽）：
  后端 tsc + oxlint + 权限一致性（48 码）+ 迁移门禁 + 前端 lint×2 + 单测 17 文件 124 用例 +
  oxfmt ×3 + `vue-tsc` + `vite build` ×2。
- 2026-11-24 `pnpm test:e2e`（`template_tmp`，已跑新迁移）→ **13 文件 / 110 用例全绿**（28s）。
  删除保护、审计 detail、迁移均未破坏既有行为。
- 2026-11-24 软删唯一索引探针：`sys_user` / `sys_config` / `sys_dict_type` 各自
  「插入 → 软删 → 重插同名」全部成功（各 2 行：1 墓碑 + 1 活行）；探针数据已物理清理。
- 2026-11-24 新覆盖率口径：**18.93%** stmts / 19.21% branch / 16.23% func / 18.96% lines
  （464/2451 可覆盖行）。单测只盖关键纯函数，业务行为由 e2e 负责。
- 2026-11-24 `scope=SCHOOL` 落地后：`hazard.e2e-spec.ts` **17/17**（含新增的
  「SCHOOL 单对信息中心可见、详情 200；对照 DEPT 单仍 404」）；
  全量 e2e **13 文件 / 111 用例全绿**；`verify.sh` **exit 0**。
- 2026-11-24 `pnpm audit --prod`：**0 high + 2 moderate**（multer 已由 override 钉到 2.5.0；
  剩下 `typeorm→glob/minimatch` 不在请求路径）。web_admin 0。
- 2026-11-24 multer 2.4.0 → 2.5.0 后 `test/file.e2e-spec.ts` **20 条全过**（上传路径无回归）。
- 2026-11-24 `openapi:dump` 与仓库产物比对零漂移（修改 dept/user 的 summary 后已重跑）。
- 2026-11-24 全量实测复现的问题：`scope=SCHOOL` 单对信息中心不可见（0 条）；Swagger
  在 dev 匿名 200（prod 修后为 404）。
- 2026-11-24 库与账号三角色化执行完毕：`db-apply.sh` 建库建号（三段密码互不相同）、
  `db-reset.sh --yes` 重建 `template_tmp`、dev 三进程 online、`/health/ready` 数据库 up。
- 2026-11-24 恢复演练脚本实测：dump(16K) → `template_tmp_restore` 19 表 / 5 用户 / 5 角色，
  源库未受影响；`--db template_prod` 被拒（exit 1）。