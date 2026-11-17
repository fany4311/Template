/**
 * PM2 进程配置 —— **prod（生产环境）**。
 *
 * 由 `deploy/template.sh` 统一启停，**不要直接 pm2 start**（脚本里还包含迁移/构建/站点安装）。
 *
 * 生产的分工（一句话）：
 *   **pm2 管进程，Nginx 管静态与入口。**
 *   两个前端（web_admin / web）编译成静态文件、由 Nginx 直接托管（后台 8080、前端 8081）；
 *   后端由 pm2 拉起并监听 127.0.0.1:3000，Nginx 只把 `/api/` 转发到它
 *   （同源转发 = 前端不用跨域、不用把 IP 写进构建产物；后端进程本身仍然只归 pm2 管）。
 *
 * ┌────────────────────────────────┬──────┬─────────────────────────┐
 * │ template-api-prod       │ 3000 │ Nest 后端（.env.prod）   │
 * └────────────────────────────────┴──────┴─────────────────────────┘
 * 与隔壁项目的隔离（同机多项目共存的关键）：
 * - 进程名 `template-api-prod`；
 * - 端口 3000：本项目 dev 后端占 3010；
 * - 库 `template`、Redis db1、MinIO 桶 `template`（见 .env.prod.example）；
 * - 日志写 `server/logs/prod-*.log`。
 *
 * 为什么 fork 单实例（不是 cluster）：
 * 应用里有 3 个进程内定时任务（Outbox 轮询、文件清理、授权到期扫描）。
 * cluster 多实例会让它们各跑一份：Outbox 靠 DB 的 claimed_at 抢占是安全的，
 * 但文件清理和授权扫描都是全表扫描 —— 多实例纯属重复劳动 + 日志噪音。
 * 校园级并发单进程足够；真需要横向扩时再给定时任务加分布式锁。
 *
 * 为什么 autorestart 是 true：生产进程崩了必须自愈，不能等人发现。
 * max_restarts + min_uptime 兜住「无限崩溃重启」。
 */
const path = require('node:path');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const LOG_DIR = path.join(SERVER_DIR, 'logs');

module.exports = {
  apps: [
    {
      name: 'template-api-prod',
      cwd: SERVER_DIR,
      script: path.join(SERVER_DIR, 'dist', 'main.js'),
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      restart_delay: 2000,
      watch: false,
      max_memory_restart: '700M',
      // 优雅停机：等 HTTP 连接排空、事务提交完再退出
      kill_timeout: 10000,
      env: {
        // 读 server/.env.prod（PORT=3000 / 独立库·缓存·桶）
        // 必须显式给，不能靠外层环境：缺了它 config.module 会按默认 dev 加载 .env.dev，
        // 变成「用生产进程连开发库」。migration:run 同理（见 template.sh 的 step_migrate）。
        NODE_ENV: 'prod',
      },
      error_file: path.join(LOG_DIR, 'prod-error.log'),
      out_file: path.join(LOG_DIR, 'prod-out.log'),
      merge_logs: true,
      time: true,
    },
  ],
};
