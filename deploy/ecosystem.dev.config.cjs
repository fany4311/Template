/**
 * PM2 进程配置 —— **dev（本机开发环境）**。
 *
 * 三条进程，一条命令全起：
 *   bash deploy/template.sh dev start
 *
 * ┌───────────────────────────────────┬──────┬───────────────────────────────┐
 * │ template-api-dev           │ 3010 │ Nest 后端（node dist/main.js）│
 * │ template-web-admin-dev     │ 5183 │ 后台 web_admin（vite dev）    │
 * │ template-web-dev           │ 5184 │ 前端 web（vite dev）          │
 * └───────────────────────────────────┴──────┴───────────────────────────────┘
 *
 * ⚠️ 三个坑，都踩过：
 * 1. **vite 必须指 `node_modules/vite/bin/vite.js`**：pm2 直接跑 `pnpm .bin/vite`
 *    （shell 包装脚本）会 SyntaxError。
 * 2. 端口用 `--strictPort`（在各自的 vite.config.ts 里设 true）：端口被占时
 *    **直接失败**，而不是悄悄换到下一个 —— 悄悄换端口的结果是「你改的代码没生效」，
 *    比报错难查十倍。
 * 3. **后端 dev 用 3010，不是 3000**：prod 后端起在 3000（Nginx 站点指向它），
 *    dev 与 prod 要能**同时跑**，所以 dev 让一位。见 deploy/template.sh 顶部说明。
 * 4. **前端 dev 用 5183/5184，不是 5173/5174**：隔壁项目 BigScreen 的 dev
 *    占着 5173/5174，同机共存必须错开。安装到别的机器时可改，见 template.sh 顶部。
 *
 * dev 与 prod 是**两套独立进程名**（`-dev` / `-prod`），互不干扰：
 *   dev  : 3010 + 5183 + 5184（vite 热更新）
 *   prod : 3000（仅后端）；web_admin 8080 / web 8084 由 Nginx 托管静态产物
 */
const path = require('node:path');

const TRUNK = path.join(__dirname, '..');
const SERVER_DIR = path.join(TRUNK, 'server');
const ADMIN_DIR = path.join(TRUNK, 'web_admin');
const WEB_DIR = path.join(TRUNK, 'web');
const LOG_DIR = path.join(TRUNK, 'logs', 'dev');

/** vite 的真实入口（见上面第 1 条坑） */
const viteBin = (dir) => path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js');

module.exports = {
  apps: [
    {
      name: 'template-api-dev',
      cwd: SERVER_DIR,
      // dev 也跑构建产物：改动后 `pnpm build && pm2 restart` 即可，
      // 比 `nest start --watch` 省内存，也更接近生产的启动方式
      script: path.join(SERVER_DIR, 'dist', 'main.js'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 2000,
      watch: false,
      max_memory_restart: '700M',
      kill_timeout: 10000,
      env: {
        // 读 server/.env.dev（端口 3010 / 库 template / redis db1 都在里面）
        NODE_ENV: 'dev',
      },
      error_file: path.join(LOG_DIR, 'api-error.log'),
      out_file: path.join(LOG_DIR, 'api-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'template-web-admin-dev',
      cwd: ADMIN_DIR,
      script: viteBin(ADMIN_DIR),
      // 端口在 vite.config.ts 里（5183 + strictPort）
      args: '',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'development',
      },
      error_file: path.join(LOG_DIR, 'admin-error.log'),
      out_file: path.join(LOG_DIR, 'admin-out.log'),
      merge_logs: true,
      time: true,
    },
    {
      name: 'template-web-dev',
      cwd: WEB_DIR,
      script: viteBin(WEB_DIR),
      args: '',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      watch: false,
      max_memory_restart: '900M',
      env: {
        NODE_ENV: 'development',
      },
      error_file: path.join(LOG_DIR, 'web-error.log'),
      out_file: path.join(LOG_DIR, 'web-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
