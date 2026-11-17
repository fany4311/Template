# 迁移目录（TypeORM migrations）

- 命名：`{时间戳}-{说明}.ts`，由 `pnpm migration:generate` 生成或手写。
- 生产禁用 `synchronize`，一律走迁移；采用 expand-contract 以支持零停机发布。
- CLI 走「先编译再执行」：脚本内已 `pnpm build` 后加载 `dist/core/database/data-source.js`。
