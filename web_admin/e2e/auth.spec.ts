import { expect, test } from '@playwright/test';
import { DEMO_PASS, DEMO_USER, login, logout } from './helpers';

/**
 * 金链路 1：认证
 * 这三条是"整个后台还能不能用"的最小证据：能挡住未登录、能识别错密码、能正常登录。
 */
test.describe('认证', () => {
  test('未登录访问后台 → 跳登录页并记住来源', async ({ page }) => {
    await page.goto('/system/user');
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveURL(/redirect=/);
    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
  });

  test('密码错误 → 停在登录页并提示', async ({ page }) => {
    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill(DEMO_USER);
    await page.getByPlaceholder('请输入密码').fill('definitely-wrong-pass');
    await page.getByRole('button', { name: /登\s*录/ }).click();

    await expect(page.getByText('用户名或密码错误')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test('正确登录 → 进入后台，刷新后仍在登录态', async ({ page }) => {
    await login(page);

    // 布局壳（侧边菜单）出现 = 已进入后台
    await expect(page.locator('.el-menu')).toBeVisible();

    // 刷新后 token 仍有效（会话在 Redis，不是内存态）
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('.el-menu')).toBeVisible();
  });

  test('登出后回到登录页，再访问受保护页会被拦', async ({ page }) => {
    await login(page);
    await logout(page);

    await page.goto('/system/user');
    await expect(page).toHaveURL(/\/login/);
    expect(DEMO_PASS).toBeTruthy();
  });
});
