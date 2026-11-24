import { expect, test } from '@playwright/test';
import {
  ADMIN_PASS,
  ADMIN_USER,
  DEMO_PASS,
  DEMO_USER,
  hasAdmin,
  login,
  logout,
  submitLogin,
} from './helpers';

/**
 * 金链路 1：认证与后台准入
 *
 * 这里有个容易踩的事实：**业务账号进不了后台**。
 * 演示账号（manager_bw 等）只有 `hazard:*` 之类业务权限，没有 `console:access`，
 * 登录成功会被守卫踢回登录页并提示「该账号没有后台访问权限」。
 * 能进后台的只有 `*:*:*` 的超管 —— 那条链路需要密码，走 E2E_ADMIN_USER/PASS。
 */
test.describe('认证', () => {
  test('未登录访问深链 → 跳登录页并记住来源', async ({ page }) => {
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

    await expect(page.getByText('用户名或密码错误')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('业务账号登录成功，但没有后台权限 → 提示并留在登录页', async ({
    page,
  }) => {
    // 登录请求本身是成功的（200 + token），随后被后台准入守卫拦下并清空登录态
    await submitLogin(page);
    await expect(page.getByText('该账号没有后台访问权限')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/login/);
  });

  test('超管登录 → 进入后台，刷新后仍在登录态', async ({ page }) => {
    test.skip(
      !hasAdmin,
      '未配置 E2E_ADMIN_USER / E2E_ADMIN_PASS（超管密码不入库）',
    );

    await login(page, ADMIN_USER, ADMIN_PASS);
    await expect(page.getByRole('menubar')).toBeVisible();

    // 会话在 Redis 里，刷新后 token 仍有效
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('menubar')).toBeVisible();
  });

  test('超管登出后访问受保护页会被拦', async ({ page }) => {
    test.skip(!hasAdmin, '未配置 E2E_ADMIN_USER / E2E_ADMIN_PASS');

    await login(page, ADMIN_USER, ADMIN_PASS);
    await logout(page);

    await page.goto('/system/user');
    await expect(page).toHaveURL(/\/login/);
    expect(DEMO_PASS).toBeTruthy();
  });
});
