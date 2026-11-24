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
    include: ['**/*.spec.ts'],
    /**
     * 覆盖率口径：**全量 src**，不只是被测试 import 过的文件。
     *
     * 不写 include 时 vitest 只统计“被测试碰到的”文件，数字很好看（77%），
     * 但像 dept/user/role service 这种全靠 e2e 盖的文件根本不进报表 —— 看着像 77%，
     * 实际单测覆盖可能只有一半。先让数字可信，再谈达标线。
     * 注：不设 thresholds —— 单测只盖关键纯函数，业务行为由 110 条 e2e 负责，
     *     拿单测覆盖率当提交门禁会逼人写假用例。
     */
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/scripts/**',
        'src/core/database/migrations/**',
        'src/**/*.entity.ts',
        'src/**/*.dto.ts',
        'src/**/*.response.ts',
        'src/**/*.interface.ts',
        'src/**/*.types.ts',
        'src/**/*.module.ts',
        'src/setup-swagger.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
