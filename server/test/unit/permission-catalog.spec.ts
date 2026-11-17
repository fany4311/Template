import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  collectPermissionCatalog,
  EXTRA_PERMISSIONS,
} from '../../src/common/authz/permission-catalog.js';
import { PERMISSIONS_KEY } from '../../src/common/constants/decorator.constant.js';
import { isConcretePermissionCode } from '../../src/common/authz/permission-code.js';

/** 模拟 `@RequiresPermissions(...)` 的效果（元数据形状与装饰器一致：string[][]） */
function mark(
  handler: object,
  permissions: (string | string[])[],
  summary?: string,
): void {
  Reflect.defineMetadata(
    PERMISSIONS_KEY,
    permissions.map((p) => (Array.isArray(p) ? p : [p])),
    handler,
  );
  if (summary) {
    Reflect.defineMetadata('swagger/apiOperation', { summary }, handler);
  }
}

function controller(
  tags: string[] | undefined,
  build: (proto: Record<string, unknown>) => void,
): Function {
  class Fake {}
  if (tags) Reflect.defineMetadata('swagger/apiUseTags', tags, Fake);
  build(Fake.prototype as unknown as Record<string, unknown>);
  return Fake;
}

describe('权限清单采集器', () => {
  it('采集码 + 名称 + 模块，并按模块分组排序', () => {
    const RoleCtl = controller(['角色管理'], (proto) => {
      proto.page = function page() {};
      proto.create = function create() {};
      mark(proto.page as object, ['system:role:list'], '分页查询角色');
      mark(proto.create as object, ['system:role:add'], '创建角色');
    });
    const HazardCtl = controller(['隐患闭环'], (proto) => {
      proto.list = function list() {};
      mark(proto.list as object, ['hazard:report:list'], '分页查询隐患');
    });

    const { entries, invalid } = collectPermissionCatalog([RoleCtl, HazardCtl]);

    expect(invalid).toEqual([]);
    // 非接口码（EXTRA_PERMISSIONS）恒定存在，这里只看从装饰器采到的
    const extraCodes = new Set(EXTRA_PERMISSIONS.map((e) => e.code));
    expect(entries.filter((e) => !extraCodes.has(e.code))).toEqual([
      {
        code: 'hazard:report:list',
        name: '分页查询隐患',
        module: 'hazard',
        moduleLabel: '隐患闭环',
      },
      {
        code: 'system:role:add',
        name: '创建角色',
        module: 'system',
        moduleLabel: '角色管理',
      },
      {
        code: 'system:role:list',
        name: '分页查询角色',
        module: 'system',
        moduleLabel: '角色管理',
      },
    ]);
  });

  it('常量引用的码同样能采到（这正是不能用 grep 的原因）', () => {
    // 装饰器里写 HAZARD_PERMISSIONS.LIST 时，运行时元数据里已是求值后的字符串
    const HAZARD_LIST = 'hazard:report:list';
    const Ctl = controller(['隐患闭环'], (proto) => {
      proto.list = function list() {};
      mark(proto.list as object, [HAZARD_LIST], '分页查询隐患');
    });

    const { entries } = collectPermissionCatalog([Ctl]);
    expect(entries.map((e) => e.code)).toContain('hazard:report:list');
  });

  it('通配符与否定前缀不进清单，但会被报告为不合规', () => {
    const Ctl = controller(['系统'], (proto) => {
      proto.a = function a() {};
      proto.b = function b() {};
      proto.c = function c() {};
      mark(proto.a as object, ['*:*:*'], '全通配');
      mark(proto.b as object, ['!system:role:remove'], '否定');
      mark(proto.c as object, ['system:*'], '段末通配');
    });

    const { entries, invalid } = collectPermissionCatalog([Ctl]);
    expect(entries).toEqual(EXTRA_PERMISSIONS.map((e) => ({ ...e })));
    expect(invalid).toEqual(['!system:role:remove', '*:*:*', 'system:*']);
  });

  it('大写与段数不对的码也不合规', () => {
    const Ctl = controller(['系统'], (proto) => {
      proto.a = function a() {};
      proto.b = function b() {};
      proto.c = function c() {};
      mark(proto.a as object, ['System:Role:list'], '大写');
      mark(proto.b as object, ['system:role:list:extra'], '四段');
      mark(proto.c as object, ['nosep'], '无分隔');
    });

    const { entries, invalid } = collectPermissionCatalog([Ctl]);
    expect(entries).toEqual(EXTRA_PERMISSIONS.map((e) => ({ ...e })));
    expect(invalid.sort()).toEqual([
      'System:Role:list',
      'nosep',
      'system:role:list:extra',
    ]);
  });

  it('没有 @ApiOperation 时退回「控制器.方法」便于定位', () => {
    const Ctl = controller(['系统'], (proto) => {
      proto.orphan = function orphan() {};
      mark(proto.orphan as object, ['system:orphan:list']);
    });

    const { entries } = collectPermissionCatalog([Ctl]);
    const hit = entries.find((e) => e.code === 'system:orphan:list');
    expect(hit?.name).toBe('Fake.orphan');
  });

  it('数组参数（AND 语义）里的每个码都会入清单', () => {
    const Ctl = controller(['系统'], (proto) => {
      proto.a = function a() {};
      mark(proto.a as object, [['system:a:read', 'system:a:write']], '读写');
    });

    const { entries } = collectPermissionCatalog([Ctl]);
    const codes = entries.map((e) => e.code);
    expect(codes).toContain('system:a:read');
    expect(codes).toContain('system:a:write');
  });

  it('同一码被多个接口使用时记为共用，但仍只入清单一次', () => {
    const Ctl = controller(['角色管理'], (proto) => {
      proto.page = function page() {};
      proto.detail = function detail() {};
      mark(proto.page as object, ['system:role:list'], '分页查询角色');
      mark(proto.detail as object, ['system:role:list'], '角色详情');
    });

    const { entries, shared } = collectPermissionCatalog([Ctl]);
    expect(entries.filter((e) => e.code === 'system:role:list')).toHaveLength(1);
    expect(shared).toEqual([
      { code: 'system:role:list', names: ['分页查询角色', '角色详情'] },
    ]);
  });

  it('非接口权限码（EXTRA_PERMISSIONS）始终在清单里', () => {
    const { entries } = collectPermissionCatalog([]);
    expect(entries).toEqual(EXTRA_PERMISSIONS.map((e) => ({ ...e })));
    // console 排在 system 前
    expect(entries[0]?.module).toBe('console');
    // system:file:remove 只被 FileService 消费（删除路由故意不挂码），
    // 不登记就永远不会出现在 sys_permission → 角色界面勾不到 → 能力不可授予
    expect(entries.map((e) => e.code)).toContain('system:file:remove');
  });

  it('权限码格式判定：2–3 段小写合法，其余非法', () => {
    expect(isConcretePermissionCode('console:access')).toBe(true);
    expect(isConcretePermissionCode('system:role:list')).toBe(true);
    expect(isConcretePermissionCode('system:list')).toBe(true);
    expect(isConcretePermissionCode('*:*:*')).toBe(false);
    expect(isConcretePermissionCode('system:*')).toBe(false);
    expect(isConcretePermissionCode('!system:role:list')).toBe(false);
    expect(isConcretePermissionCode('a:b:c:d')).toBe(false);
    expect(isConcretePermissionCode(' system:role:list')).toBe(false);
  });
});
