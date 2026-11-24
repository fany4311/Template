import { Logger } from '@nestjs/common';
import { ModulesContainer, NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';
import {
  EXTRA_PERMISSIONS,
  collectPermissionCatalog,
} from '../common/authz/permission-catalog.js';

/**
 * 权限一致性检查（pnpm authz:check）。
 *
 * authz:sync 只保证「代码 → 权限表」单向同步；本命令检查三方是否对得上：
 *   代码声明的码  ⇄  sys_permission  ⇄  sys_menu.perms
 *
 * 三类问题：
 * 1. 代码里有、权限表没有        → 忘了 sync（角色界面勾不到）
 * 2. 菜单 perms 不在权限表/代码里 → 菜单点进去 403，或码拼错
 * 3. 有 list/view 权限码但没有任何菜单入口 → 功能可达性缺失（只告警）
 *
 * 退出码：0 = 无错误（可含告警）；1 = 有错误。
 * 不做写库动作 —— 写库是 authz:sync 的事。
 */

interface MenuRow {
  name: string;
  path: string;
  perms: string;
}

async function main(): Promise<void> {
  const logger = new Logger('authz:check');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const modules = app.get(ModulesContainer);
    const controllers: Function[] = [];
    for (const [, moduleRef] of modules) {
      for (const [, wrapper] of moduleRef.controllers) {
        if (wrapper.metatype) controllers.push(wrapper.metatype);
      }
    }

    const { entries, invalid } = collectPermissionCatalog(controllers);
    const codeSet = new Set(entries.map((e) => e.code));
    for (const extra of EXTRA_PERMISSIONS) codeSet.add(extra.code);

    const dataSource = app.get(DataSource);
    const permissionRows: Array<{ code: string }> = await dataSource.query(
      'SELECT code FROM sys_permission WHERE status = 1',
    );
    const dbCodes = new Set(permissionRows.map((r) => r.code));

    const menuRows: MenuRow[] = await dataSource.query(
      "SELECT name, path, perms FROM sys_menu WHERE perms IS NOT NULL AND perms <> '' AND status = 1",
    );
    const menuCodes = new Set(menuRows.map((r) => r.perms));

    const errors: string[] = [];
    const warnings: string[] = [];

    if (invalid.length) {
      errors.push('装饰器里存在不合规权限码：' + invalid.join(', '));
    }

    const missingInDb = [...codeSet].filter((code) => !dbCodes.has(code));
    if (missingInDb.length) {
      errors.push(
        '代码里有、sys_permission 没有（先跑 pnpm authz:sync）：' +
          missingInDb.join(', '),
      );
    }

    const orphanMenu = menuRows.filter((row) => !codeSet.has(row.perms));
    if (orphanMenu.length) {
      errors.push(
        '菜单 perms 在代码里找不到（拼错或接口已删）：' +
          orphanMenu.map((r) => r.name + '(' + r.perms + ')').join(', '),
      );
    }

    // 只对「列表/查看」类码要求有入口：add/edit/remove 天然没有独立菜单
    // 例外：由其它页面内部调用、本就不需要独立菜单的码
    const noMenuAllowed = new Set(['system:permission:list']);
    const entryCodes = [...codeSet].filter((code) =>
      /:(list|view)$/.test(code),
    );
    const noMenu = entryCodes.filter(
      (code) => !menuCodes.has(code) && !noMenuAllowed.has(code),
    );
    if (noMenu.length) {
      warnings.push('有权限码但没有任何菜单入口：' + noMenu.join(', '));
    }

    console.log(
      '==> 代码权限码 ' +
        codeSet.size +
        ' · 权限表 ' +
        dbCodes.size +
        ' · 菜单 ' +
        menuRows.length,
    );

    for (const message of warnings) logger.warn(message);
    for (const message of errors) logger.error(message);

    if (!errors.length) {
      console.log(
        '✓ 权限一致性检查通过' + (warnings.length ? '（含告警）' : ''),
      );
    }
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    await app.close();
  }
}

await main();
