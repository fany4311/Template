import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * 前端（web）构建配置 —— 面向业务用户的最小壳。
 *
 * 产物 dist/ 由 Nginx 静态托管；开发期 /api 代理到本机 Nest 后端。
 * 端口与 deploy/ecosystem.dev.config.cjs 里的 web-dev 进程一致（5184）。
 *
 * ⚠️ 为什么是 5184 而不是 5174：隔壁 Csmu_BigScreen 的 dev 占着 5173/5174，
 *   同机共存就得错开。后端 3010 同理（prod 占着 3000）。
 *
 * ⚠️ 后端端口为什么是 3010 而不是 3000：
 *   dev 与 prod 要能**同时跑**。prod 后端起在 3000（Nginx 站点指向它），
 *   所以 dev 让到 3010。见 deploy/ecosystem.dev.config.cjs 顶部说明。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5184,
    // 端口被占时**直接报错**，不悄悄换成 5185
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
