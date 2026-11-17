# CONTEXT — 执行状态快照

> **AI 维护**。开工前先读；**收尾必须覆盖写**（不是追加），完成项清出去进 `docs/log/`。
> 只写「现在/下一步」；历史一律去 `docs/log/`。随时带「最后更新」时间戳。

**最后更新**：2026-11-17

---

## 现在做什么

- Template 副本已接入本地 MySQL / Redis：20 个迁移已跑、48 条权限码已同步，超管可登录后台（5183）。
- P0 / P1 / P2 全部落地：主题与暗色、列表抽象、CSV 导入导出、`gen:module`、
  监控与审计留存、备份恢复、权限一致性门禁、字典缓存、用户导入导出。
- 系统域全部列表页 + 两个日志页已统一到 `useCrud` / `DataTable`；树表只换表格。
- 生成器补齐：`--menu-parent`（挂父菜单）、`--unique`（唯一键 + 前置查重）、`file` 字段
  （不建列，自动生成 `FileBizHandler` + 前端 `BizFiles` 附件抽屉）。
- **工作区有未提交改动**：后端 `gen-module.ts`、前端 8 个视图/组件 + `BizFiles.vue`、四份文档。

## 下一步

- [ ] 提交并推送：`main` 已领先 `origin/main` 6 个提交，加上本轮改动；
      建议拆两个提交（视图迁移 / 平台级授权锁定），推送前先跑全量 `scripts/verify.sh`。
- [ ] 角色 CASL `rules` 编辑 UI 与 `dataScope=CUSTOM` 部门集合（见 `权限设计-CASL.md` §12）。
- [ ] 派生新项目时按 `docs/init.md` 替换身份与环境；本副本不再改身份。

## 阻塞

- 无。

## 验证台账

- 2026-11-17 全量 `scripts/verify.sh`：后端 tsc / oxlint / authz-check（48 码）/ 单测 16 文件 113 用例、
  前端 `vue-tsc -b` / `vite build` —— 全绿。
- 生成器增强另用临时库 `template_gen_test` 走了一遍建库 → 迁移 → 校验 → 回滚 → 删库：
  菜单 parent/ancestors 正确、UNIQUE 键生效、down 干净；生成物在时前后端均可构建。
- 前端产物 index 1.12 MB（gzip 373 KB）；HazardView 19.5 KB、UserView 14.1 KB、RoleView 10.8 KB。
- 手工验证：角色（超管锁、通配授权锁）、用户（授权 / 重置密码）、隐患全流程流转 —— 用户已确认。
