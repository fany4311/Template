import { NestFactory, ModulesContainer } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module.js';
import { collectPermissionCatalog } from '../common/authz/permission-catalog.js';
import { PermissionService } from '../modules/permission/permission.service.js';

/**
 * 权限清单同步：`pnpm authz:sync`
 *
 * 做的事只有一件 —— 把**代码里真实存在的权限码**同步进 `sys_permission` 表，
 * 让角色界面能"按模块分组勾选"，而不是让人手输字符串。
 *
 * ## 为什么启动整个 Nest 应用
 * 权限码来自 `@RequiresPermissions` 的**运行时元数据**。装饰器实参可能是常量
 * （例如隐患模块的 `HAZARD_PERMISSIONS.LIST`），文本扫描会漏；只有让 Nest
 * 真正装配一遍模块，元数据才是求值后的真值。代价是启动约 1~2 秒，值得。
 *
 * ## 什么时候跑
 * - 开发：加了/改了接口权限码之后手动跑一次；
 * - 部署：`template.sh` 在 `migration:run` 之后、重启进程之前跑一次。
 *   跑失败的策略是**不回滚、不阻断启动**（清单只是界面数据源，
 *   不参与鉴权），但要打印醒目告警 —— 否则下次没人知道清单是陈旧的。
 *
 * ## 退出码
 * - 0：同步成功（哪怕有停用项，属正常）；
 * - 1：装饰器里写了不合规的权限码（通配/否定/大写/段数不对）。
 *   这类码不会被收录，静默跳过等于埋雷，所以直接失败。
 */
async function main() {
  const logger = new Logger('authz:sync');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const modulesContainer = app.get(ModulesContainer);
    const controllers: Function[] = [];
    for (const [, moduleRef] of modulesContainer) {
      for (const [, wrapper] of moduleRef.controllers) {
        if (wrapper.metatype) controllers.push(wrapper.metatype);
      }
    }

    const { entries, shared, invalid } = collectPermissionCatalog(controllers);

    logger.log(
      `扫描 ${controllers.length} 个控制器，发现 ${entries.length} 个权限码`,
    );

    // 按模块打印，方便肉眼核对"新加的码进去了吗"
    const grouped = new Map<string, string[]>();
    for (const entry of entries) {
      const key = `${entry.module} / ${entry.moduleLabel || '(无标签)'}`;
      const list = grouped.get(key) ?? [];
      list.push(`${entry.code}  —  ${entry.name}`);
      grouped.set(key, list);
    }
    for (const [group, list] of grouped) {
      console.log(`\n[${group}]`);
      for (const line of list) console.log(`  ${line}`);
    }

    if (shared.length) {
      console.log(
        `\n共用权限码 ${shared.length} 个（正常：列表与详情通常共用 list）：` +
          shared.map((s) => s.code).join(', '),
      );
    }

    if (invalid.length) {
      logger.error(
        `发现 ${invalid.length} 个不合规权限码（通配/否定/格式错误），不入清单：` +
          invalid.join(', '),
      );
    }

    const service = app.get(PermissionService);
    const result = await service.sync(entries);
    console.log(
      `\n[authz:sync] 新增 ${result.inserted} · 更新 ${result.updated} · ` +
        `停用 ${result.deprecated} · 清单共 ${result.total} 条`,
    );

    if (result.deprecated) {
      logger.warn(
        `${result.deprecated} 个权限码在代码中已不存在，已置为停用（未删除）。` +
          `请检查还有哪些角色挂着它们：SELECT level, role_name, permissions FROM sys_role;`,
      );
    }

    process.exitCode = invalid.length ? 1 : 0;
  } finally {
    await app.close();
  }
}

await main();
