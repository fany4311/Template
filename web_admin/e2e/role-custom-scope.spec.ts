import { expect, test } from '@playwright/test';
import { ADMIN_PASS, ADMIN_USER, hasAdmin, login } from './helpers';

/**
 * 金链路 2：角色「自定义数据范围」
 *
 * 这一条钉住三件事：
 * 1. 「自定义部门」选项**可选**（曾经是 disabled 的）；
 * 2. 选中后出现部门树选择器；
 * 3. 一个部门都不选时**拦提交**（空集合 = 看不到任何数据，不该被静默保存）。
 */
test.describe('角色 · 自定义数据范围', () => {
  test.skip(!hasAdmin, '需要超管账号：设 E2E_ADMIN_USER / E2E_ADMIN_PASS');

  test('选「自定义部门」后出现部门选择器，空选被拦', async ({ page }) => {
    await login(page, ADMIN_USER, ADMIN_PASS);

    await page.goto('/system/role');
    await expect(page.getByRole('button', { name: /新\s*建/ })).toBeVisible();

    await page.getByRole('button', { name: /新\s*建/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 1) 自定义选项不再是灰的
    const scopeSelect = dialog.locator('.el-select').first();
    await scopeSelect.click();
    const customOption = page.getByRole('option', { name: '自定义部门' });
    await expect(customOption).toBeVisible();
    await expect(customOption).not.toHaveClass(/is-disabled/);
    await customOption.click();

    // 2) 部门树选择器出现（el-tree-select 的可访问名来自 label「可见部门」，
    //    不是 placeholder —— placeholder 渲染在内部 input 上，role 查询拿不到）
    const deptSelect = dialog.getByRole('combobox', { name: /可见部门/ });
    await expect(deptSelect).toBeVisible();

    // 3) 填个名字但**不选部门** → 提交被校验拦住（对话框不关、仍有必填提示）
    await dialog.getByPlaceholder('如：部门管理员').fill('E2E自定义范围校验');
    await dialog.getByRole('button', { name: /确\s*定|保\s*存/ }).click();
    await expect(dialog.getByText('自定义范围至少要选一个部门')).toBeVisible();
    await expect(dialog).toBeVisible();
  });
});
