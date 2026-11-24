import { PERMISSIONS_KEY } from '../constants/decorator.constant.js';
import { isConcretePermissionCode, moduleKeyOf } from './permission-code.js';

/**
 * 权限清单采集器：从**运行时的控制器元数据**反射出系统里真实存在的权限码。
 *
 * ## 为什么是反射，不是 grep 源码
 * 装饰器的实参不一定是字面量。本项目的隐患模块写的是：
 *
 * ```ts
 * @RequiresPermissions(HAZARD_PERMISSIONS.LIST)   // 常量引用
 * ```
 *
 * 文本扫描会把这类**整条漏掉**（或扫出 `HAZARD_PERMISSIONS.LIST` 这种假码）。
 * 反射拿到的是 Nest 实际注册的元数据，常量早已求值 —— 不存在解析歧义，
 * 也不会因为格式化、换行、别名 import 而变化。
 *
 * ## 名称从哪来
 * - 权限名：同方法上的 `@ApiOperation({ summary: '分页查询角色' })`
 *   —— 写接口文档时顺手写的那句话，天然是"这个码能干什么"的说明；
 * - 模块名：控制器上的 `@ApiTags('角色管理')`。
 *
 * 两者都是 Swagger 元数据（`swagger/apiOperation` / `swagger/apiUseTags`），
 * 由 `@nestjs/swagger` 写在原型/类上。这样权限清单与接口文档**同源**，
 * 不会出现"文档叫 A、权限清单叫 B"的分裂。
 *
 * ## 只收具体码
 * `*:*:*`、`system:*`、`!system:*` 一律跳过：它们是**底座级授权手段**，
 * 由迁移/seed 写入角色，不属于"可勾选的功能权限"。让它们进清单只会诱导人去勾。
 */

/** Swagger 元数据 key（@nestjs/swagger 内部常量，未导出，故字面量） */
const API_OPERATION_KEY = 'swagger/apiOperation';
const API_TAGS_KEY = 'swagger/apiUseTags';

export interface PermissionCatalogEntry {
  /** 权限码，如 `system:role:list` */
  code: string;
  /** 人类可读名称 */
  name: string;
  /** 模块键（码的第一段） */
  module: string;
  /** 模块显示名 */
  moduleLabel: string;
}

interface SwaggerOperationMeta {
  summary?: string;
}

/**
 * 非接口触发的权限码。
 *
 * 有些码**不对应任何接口上的 `@RequiresPermissions`**，反射扫不到，必须在此登记：
 *
 * - `console:access`：前端后台站点准入，由 `web_admin` 的守卫读取，后端没有接口用它。
 * - `system:file:remove`：删除**他人**文件的开关。删除路由**故意不挂**权限码
 *   —— 否则会把「上传人删自己传错的文件」也挡掉。真正的判定在
 *   `FileService.assertCanWrite`（上传人本人 ‖ 持有此码）。不在这个登记册里，
 *   它就永远不会出现在 `sys_permission`，角色界面勾不到 → 这条能力永远无法授予。
 *
 * 登记在这里而不是塞进某个控制器，是为了不为了「让扫描器看见」而凭空造一个接口
 * —— 那才是真正的形式主义。**注意**：登记只影响权限清单与角色勾选 UI，
 * 不影响任何运行时鉴权（`RbacGuard` 只看 `sys_role.permissions`）。
 */
export const EXTRA_PERMISSIONS: readonly PermissionCatalogEntry[] = [
  {
    code: 'console:access',
    name: '进入后台管理端',
    module: 'console',
    moduleLabel: '控制台准入',
  },
  {
    code: 'system:file:remove',
    name: '删除任意文件（非上传人）',
    module: 'system',
    // 与 FileController 的 @ApiTags 保持一致，界面里和 system:file:list 分到同一组
    moduleLabel: '文件与附件',
  },
];

/** 采集结果 + 诊断信息 */
export interface CatalogScanResult {
  entries: PermissionCatalogEntry[];
  /**
   * 同一个码被**多个接口**声明。这通常**不是错误**：
   * 列表与详情共用一个 `list` 权限是常规设计（看见列表就能看详情）。
   * 保留该信息只为回答"这个码到底控制什么" —— 单看名称容易误判。
   */
  shared: Array<{ code: string; names: string[] }>;
  /** 装饰器里写的不合规码（通配/否定/格式错），供同步脚本报错 */
  invalid: string[];
}

/**
 * 从控制器类集合中采集权限清单。
 *
 * 纯函数式：只读元数据、不改任何东西，便于单测直接喂 mock 控制器。
 */
export function collectPermissionCatalog(
  controllers: readonly Function[],
): CatalogScanResult {
  const byCode = new Map<string, PermissionCatalogEntry>();
  const namesByCode = new Map<string, string[]>();
  const invalid = new Set<string>();

  for (const controller of controllers) {
    if (typeof controller !== 'function') continue;
    const proto = controller.prototype as Record<string, unknown> | undefined;
    if (!proto) continue;

    const tags = Reflect.getOwnMetadata(API_TAGS_KEY, controller) as
      | string[]
      | undefined;
    const moduleLabel = tags?.[0] ?? '';

    for (const methodName of Object.getOwnPropertyNames(proto)) {
      if (methodName === 'constructor') continue;
      const handler = proto[methodName];
      if (typeof handler !== 'function') continue;

      // RbacGuard 读同一份元数据：string[][]，外层 OR、内层 AND
      const declared = Reflect.getOwnMetadata(PERMISSIONS_KEY, handler) as
        | string[][]
        | undefined;
      if (!declared?.length) continue;

      const operation = Reflect.getOwnMetadata(API_OPERATION_KEY, handler) as
        | SwaggerOperationMeta
        | undefined;
      const summary = operation?.summary?.trim();

      for (const code of declared.flat()) {
        if (!isConcretePermissionCode(code)) {
          invalid.add(code);
          continue;
        }
        if (!byCode.has(code)) {
          byCode.set(code, {
            code,
            // 没有 summary 时退回「控制器.方法名」，至少能定位到代码
            name: summary || `${controller.name}.${methodName}`,
            module: moduleKeyOf(code),
            moduleLabel,
          });
        }
        const names = namesByCode.get(code) ?? [];
        if (!names.includes(summary || methodName)) {
          names.push(summary || methodName);
        }
        namesByCode.set(code, names);
      }
    }
  }

  // 非接口码并入（若代码里已声明同名码，以代码为准，避免覆盖真实名称）
  for (const extra of EXTRA_PERMISSIONS) {
    if (!byCode.has(extra.code)) byCode.set(extra.code, { ...extra });
  }

  const shared = [...namesByCode.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([code, names]) => ({ code, names }));

  const entries = [...byCode.values()].sort(
    (a, b) =>
      a.module.localeCompare(b.module) ||
      a.moduleLabel.localeCompare(b.moduleLabel) ||
      a.code.localeCompare(b.code),
  );

  return { entries, shared, invalid: [...invalid].sort() };
}
