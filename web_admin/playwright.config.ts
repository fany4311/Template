import { defineConfig, devices } from '@playwright/test';

/**
 * E2E 配置（金链路）。
 *
 * 前提：dev 三进程已在跑（`bash deploy/template.sh dev start`）。
 * 这里**不托管** webServer —— dev 用 PM2 管，测试再起一套会撞端口、抢同一个库。
 *
 * 串行（workers = 1）：所有用例共用一个后端、一个库、一套 Redis 会话。
 * 并行时的相互干扰是真实的：一个用例把数据删了，另一个的断言就挂。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5183',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
