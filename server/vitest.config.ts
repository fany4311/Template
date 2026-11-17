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
  },
});
