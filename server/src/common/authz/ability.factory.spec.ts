import { subject } from '@casl/ability';
import { AbilityFactory } from './ability.factory.js';
import type { AbilityRule } from './ability.types.js';

describe('AbilityFactory', () => {
  const factory = new AbilityFactory();

  it('超管权限码 *:*:* → manage all', () => {
    const ability = factory.createForUser({ permissions: ['*:*:*'] });
    expect(ability.can('manage', 'all')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(true);
  });

  it('无权限 → 不能做任何事', () => {
    const ability = factory.createForUser({ permissions: [] });
    expect(ability.can('read', 'User')).toBe(false);
  });

  it('显式规则 → RBAC 放行', () => {
    const rules: AbilityRule[] = [
      { action: 'read', subject: 'User' },
      { action: 'update', subject: 'Role' },
    ];
    const ability = factory.createForUser({ permissions: [], rules });
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('update', 'Role')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });

  it('ABAC/ReBAC：conditions 占位符替换后按属性判定', () => {
    const rules: AbilityRule[] = [
      {
        action: 'update',
        subject: 'Hazard',
        conditions: { deptId: '${deptId}' },
      },
    ];
    const ability = factory.createForUser({
      permissions: [],
      rules,
      deptId: 7,
    });
    expect(ability.can('update', subject('Hazard', { deptId: 7 }))).toBe(true);
    expect(ability.can('update', subject('Hazard', { deptId: 9 }))).toBe(false);
  });

  it('反向规则（inverted）禁止', () => {
    const rules: AbilityRule[] = [
      { action: 'manage', subject: 'User' },
      { action: 'delete', subject: 'User', inverted: true },
    ];
    const ability = factory.createForUser({ permissions: [], rules });
    expect(ability.can('read', 'User')).toBe(true);
    expect(ability.can('delete', 'User')).toBe(false);
  });
});
