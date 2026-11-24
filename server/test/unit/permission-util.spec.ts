import { describe, expect, it } from 'vitest';
import {
  matchPattern,
  matchPermission,
} from '../../src/common/authz/permission.util.js';
// 故意让后端单测读前端文件：两个前端 app 都没有测试运行器，而为它们各引一套
// 构建期依赖（vitest + 配置 + scripts）的代价，远大于这一个文件。
// 两份都是零 import 的纯函数文件，SWC/vitest 直接转换即可。
import { matchPermission as matchPermissionAdmin } from '../../../web_admin/src/utils/permission.ts';
import { matchPermission as matchPermissionWeb } from '../../../web/src/utils/permission.ts';

/**
 * 三份权限匹配实现的一致性用例表。
 *
 * 表是**唯一事实源**：要加分支，先在这里加一行，红了再去补三份实现。
 */
const CASES: Array<{
  name: string;
  granted: string[];
  required: string;
  expected: boolean;
}> = [
  // 超管
  {
    name: '超管通配匹配一切',
    granted: ['*:*:*'],
    required: 'x:y:z',
    expected: true,
  },
  {
    name: '超管也匹配 2 段码',
    granted: ['*:*:*'],
    required: 'console:access',
    expected: true,
  },
  // 精确
  {
    name: '精确相等',
    granted: ['system:user:list'],
    required: 'system:user:list',
    expected: true,
  },
  {
    name: '不同码不放行',
    granted: ['system:user:list'],
    required: 'system:user:add',
    expected: false,
  },
  // given 侧段末通配
  {
    name: 'given 通配匹配子码',
    granted: ['system:*'],
    required: 'system:user:list',
    expected: true,
  },
  {
    name: 'given 两段通配',
    granted: ['system:user:*'],
    required: 'system:user:add',
    expected: true,
  },
  {
    name: 'given 通配不跨模块',
    granted: ['system:*'],
    required: 'hazard:report:list',
    expected: false,
  },
  // required 侧段末通配（web 副本曾经缺这一支）
  {
    name: 'required 通配（反向）',
    granted: ['system:user:list'],
    required: 'system:user:*',
    expected: true,
  },
  {
    name: 'required 两段通配（反向）',
    granted: ['system:user:add'],
    required: 'system:*',
    expected: true,
  },
  {
    name: 'required 通配但不匹配（反向）',
    granted: ['hazard:report:list'],
    required: 'system:*',
    expected: false,
  },
  // deny 优先
  {
    name: 'deny 压过 allow（同码）',
    granted: ['*:*:*', '!system:file:remove'],
    required: 'system:file:remove',
    expected: false,
  },
  {
    name: 'deny 用通配压整个模块',
    granted: ['*:*:*', '!system:*'],
    required: 'system:role:list',
    expected: false,
  },
  {
    name: 'deny 了 system 不影响业务域',
    granted: ['*:*:*', '!system:*'],
    required: 'hazard:report:list',
    expected: true,
  },
  {
    name: 'deny 用反向通配',
    granted: ['system:*', '!system:user:*'],
    required: 'system:user:*',
    expected: false,
  },
  // 边界
  {
    name: '空列表不放行',
    granted: [],
    required: 'system:user:list',
    expected: false,
  },
  {
    name: '只有 deny 不放行',
    granted: ['!system:*'],
    required: 'system:user:list',
    expected: false,
  },
  {
    name: '前缀不是段边界',
    granted: ['system:user'],
    required: 'system:username:list',
    expected: false,
  },
];

describe('权限匹配 · 后端语义', () => {
  for (const c of CASES) {
    it(`${c.name}：${JSON.stringify(c.granted)} vs ${c.required} → ${c.expected}`, () => {
      expect(matchPermission(c.granted, c.required)).toBe(c.expected);
    });
  }

  it('matchPattern：单条匹配（供外部核对）', () => {
    expect(matchPattern('*:*:*', 'a:b:c')).toBe(true);
    expect(matchPattern('system:*', 'system:user:list')).toBe(true);
    expect(matchPattern('system:user:list', 'system:user:*')).toBe(true);
    expect(matchPattern('system:user', 'system:username:list')).toBe(false);
  });

  it('matchPermission 容忍 null/undefined 授权列表', () => {
    // 后端可能拿到未绑定角色的用户（permissions 为 null）
    expect(matchPermission(undefined as unknown as string[], 'a:b:c')).toBe(
      false,
    );
    expect(matchPermission(null as unknown as string[], 'a:b:c')).toBe(false);
  });
});

describe('权限匹配 · 三份副本一致性', () => {
  it('web_admin 与后端逐条一致', () => {
    const diff = CASES.filter(
      (c) => matchPermissionAdmin(c.granted, c.required) !== c.expected,
    ).map((c) => `${JSON.stringify(c.granted)} vs ${c.required}`);
    expect(diff).toEqual([]);
  });

  it('web（最小壳）与后端逐条一致', () => {
    const diff = CASES.filter(
      (c) => matchPermissionWeb(c.granted, c.required) !== c.expected,
    ).map((c) => `${JSON.stringify(c.granted)} vs ${c.required}`);
    expect(diff).toEqual([]);
  });

  it('两份前端副本互相一致（任一方加分支都会在这里红）', () => {
    const diff = CASES.filter(
      (c) =>
        matchPermissionAdmin(c.granted, c.required) !==
        matchPermissionWeb(c.granted, c.required),
    ).map((c) => `${JSON.stringify(c.granted)} vs ${c.required}`);
    expect(diff).toEqual([]);
  });
});
