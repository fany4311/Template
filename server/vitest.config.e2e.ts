import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Nest 依赖注入需要 emitDecoratorMetadata；esbuild 不支持该选项，故用 SWC 转换 TS。
    // （本项目禁用路径别名，故无需 tsconfig-paths 插件）
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    /**
     * e2e **必须串行**。
     *
     * e2e 跑在独立的 `template_test` 库（见 `.env.test`），与 dev 库物理隔离，
     * 所以在 dev server 运行中也可以直接跑，不会互相污染。
     *
     * 但仍然要串行：所有 spec 共享同一个 test 库、同一个 Redis DB 和同一条 Outbox 队列。
     * 并行跑时会出现真实的相互干扰：
     * - 一个 spec 的 `app.close()` 让另一个 spec 正在用的连接报
     *   `Can't add new command when connection is in closed state`
     * - Outbox 轮询器同时被多个进程消费，同一个事件被抢走，轮询用例超时
     * - 计数/存在性断言被另一个 spec 的写入污染（如「回滚后角色数不变」）
     *
     * 串行后 10 个文件 80 个用例全绿，耗时约 25s，代价可以接受。
     *
     * 新环境准备测试库：
     *   CREATE DATABASE template_test ...（utf8mb4_unicode_ci）
     *   NODE_ENV=test pnpm migration:run    # 含 CreateCoreSchema 基线建表
     */
    fileParallelism: false,
  },
});
