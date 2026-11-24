import { expect, type Page } from '@playwright/test';

/**
 * 演示账号（迁移 `1767000008000-SeedHazardDemo` 建，密码统一 `Demo@12345`）。
 * 生产库不会生成这些账号（迁移在 `NODE_ENV=prod` 下直接 return）。
 *
 * 需要超管才能进的页面，用 `E2E_ADMIN_USER` / `E2E_ADMIN_PASS` 覆盖；
 * 没配时相关用例自动 skip（不失败），避免"默认跑不过"。
 */
export const DEMO_USER = process.env.E2E_USER ?? 'manager_bw';
export const DEMO_PASS = process.env.E2E_PASS ?? 'Demo@12345';

export const ADMIN_USER = process.env.E2E_ADMIN_USER ?? '';
export const ADMIN_PASS = process.env.E2E_ADMIN_PASS ?? '';
export const hasAdmin = Boolean(ADMIN_USER && ADMIN_PASS);

/** 走真实登录表单（验证码默认关闭；开启时用例会失败，这是有意的提醒） */
export async function login(page: Page, user = DEMO_USER, pass = DEMO_PASS): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('请输入用户名').fill(user);
  await page.getByPlaceholder('请输入密码').fill(pass);
  await page.getByRole('button', { name: /登\s*录/ }).click();
  // 登录成功后路由离开 /login；失败会停在原页并弹出错误
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** 清掉本地登录态，模拟未登录访问 */
export async function logout(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}
