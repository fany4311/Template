import { describe, expect, it } from 'vitest';
import { updateRoleSchema } from '../../src/modules/role/dto/role.dto.js';
import { updateMenuSchema } from '../../src/modules/menu/dto/menu.dto.js';

describe('PATCH 语义：未传字段不得被默认值污染', () => {
  it('role: 只传 roleName 不产生 permissions/status', () => {
    const out = updateRoleSchema.parse({ roleName: '改名' });
    expect(out).toEqual({ roleName: '改名' });
  });
  it('menu: 只传 name 不产生 perms/path/visible', () => {
    const out = updateMenuSchema.parse({ name: '改名' });
    expect(out).toEqual({ name: '改名' });
  });
  it('role: 显式传空数组视为有意清空', () => {
    expect(updateRoleSchema.parse({ permissions: [] })).toEqual({
      permissions: [],
    });
  });
  it('role: 权限码格式校验在 update 下依然生效', () => {
    expect(() => updateRoleSchema.parse({ permissions: ['*:*:*'] })).toThrow();
  });
});
