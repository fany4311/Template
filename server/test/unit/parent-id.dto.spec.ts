import { describe, expect, it } from 'vitest';
import { parentIdSchema } from '../../src/common/dto/parent-id.util.js';
import {
  createDeptSchema,
  updateDeptSchema,
} from '../../src/modules/dept/dto/dept.dto.js';
import { createMenuSchema } from '../../src/modules/menu/dto/menu.dto.js';

/**
 * 回归保护：`parentId` 必须能表达「移到顶级」。
 *
 * 老写法 `z.coerce.number().int().positive().optional()` 会把 `null` / `''` 强转成 `0`，
 * 再被 `.positive()` 拒掉（实测 `null`、`0` 两条都 FAIL），结果就是
 * **部门/菜单一旦挂到别人下面，就永远搬不回顶级** —— 界面上表现为「选『顶级』保存报错」。
 */
describe('parentId：null / 0 / 空串都表示「顶级」', () => {
  const payload = (parentId: unknown) => ({ name: 'x', parentId });

  it('createDeptSchema：三种「置根」写法都归一成 null', () => {
    for (const raw of [null, 0, '0', '']) {
      expect(createDeptSchema.parse(payload(raw)).parentId).toBeNull();
    }
  });

  it('createDeptSchema：正常 id 仍解析为数字', () => {
    expect(createDeptSchema.parse(payload(7)).parentId).toBe(7);
    expect(createDeptSchema.parse(payload('7')).parentId).toBe(7);
  });

  it('createDeptSchema：不传 parentId 时保持 undefined（与「显式置根」区分开）', () => {
    expect(createDeptSchema.parse({ name: 'x' }).parentId).toBeUndefined();
  });

  it('createDeptSchema：非法值仍然拒绝', () => {
    expect(createDeptSchema.safeParse(payload(-1)).success).toBe(false);
    expect(createDeptSchema.safeParse(payload(1.5)).success).toBe(false);
    expect(createDeptSchema.safeParse(payload('abc')).success).toBe(false);
  });

  it('updateDeptSchema（PATCH）：未传 ≠ 传 null', () => {
    // 未传 → 服务层知道「用户没提这个字段」，保持原样
    expect(updateDeptSchema.parse({ name: 'y' })).toEqual({ name: 'y' });
    // 显式传 null → 服务层据此执行「移到顶级」
    expect(updateDeptSchema.parse({ parentId: null }).parentId).toBeNull();
    expect(updateDeptSchema.parse({ parentId: 0 }).parentId).toBeNull();
    expect(updateDeptSchema.parse({ parentId: 3 }).parentId).toBe(3);
  });

  it('createMenuSchema：同一套归一规则（菜单也有同样的坑）', () => {
    const base = { name: 'm', type: 'M' as const };
    expect(createMenuSchema.parse({ ...base, parentId: null }).parentId).toBeNull();
    expect(createMenuSchema.parse({ ...base, parentId: 0 }).parentId).toBeNull();
    expect(createMenuSchema.parse({ ...base, parentId: '' }).parentId).toBeNull();
    expect(createMenuSchema.parse({ ...base, parentId: 4 }).parentId).toBe(4);
    expect(createMenuSchema.parse(base).parentId).toBeUndefined();
  });

  it('两个 DTO 共用同一个 schema 实例（不会再出现「同一坑修两遍」）', () => {
    expect(createDeptSchema.shape.parentId).toBe(parentIdSchema);
    expect(createMenuSchema.shape.parentId).toBe(parentIdSchema);
    expect(updateDeptSchema.shape.parentId).toBeDefined();
  });
});
