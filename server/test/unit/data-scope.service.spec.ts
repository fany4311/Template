import { describe, expect, it } from 'vitest';
import { DataScopeService } from '../../src/modules/dept/data-scope.service.js';
import type { DataScope } from '../../src/common/enums/data-scope.enum.js';

/**
 * 数据范围 → SQL 条件。
 *
 * 重点在 **CUSTOM**：它曾经是"预留（暂按无权限处理）"，
 * 现在是"会话里预先算好的部门集合"。这里钉住三条语义：
 * 1. 有部门集合 → 按集合过滤；
 * 2. 集合为空 → **看不到任何数据**（fail-closed），绝不能退化成"不过滤"；
 * 3. 多角色并集 → 是 OR，不是 AND。
 */
const deptService = {
  // DEPT_AND_CHILD 用：这里只模拟一个部门及其子部门
  findDescendantIds: async (deptId: number) => [deptId, deptId * 100],
};

function makeService(): DataScopeService {
  return new DataScopeService(deptService as never);
}

const user = { userId: 7, deptId: 3, dataScopeDepts: [11, 12] };
const opts = { deptColumn: 'h.deptId', ownerColumn: 'h.createdBy' };

async function resolve(scopes: DataScope[], u = user) {
  return makeService().resolve(u, scopes, opts);
}

describe('DataScopeService', () => {
  it('ALL → 不加限制', async () => {
    expect(await resolve(['ALL'])).toEqual({ clause: '1 = 1', params: {} });
  });

  it('ALL 优先于其它范围', async () => {
    expect((await resolve(['DEPT', 'ALL'])).clause).toBe('1 = 1');
  });

  it('DEPT → 本部门', async () => {
    const r = await resolve(['DEPT']);
    expect(r.clause).toBe('(h.deptId = :ds_dept_0)');
    expect(r.params).toEqual({ ds_dept_0: 3 });
  });

  it('DEPT_AND_CHILD → 本部门及子树', async () => {
    const r = await resolve(['DEPT_AND_CHILD']);
    expect(r.clause).toBe('(h.deptId IN (:...ds_dept_0))');
    expect(r.params.ds_dept_0).toEqual([3, 300]);
  });

  it('SELF → 只看自己录入的', async () => {
    const r = await resolve(['SELF']);
    expect(r.clause).toBe('(h.createdBy = :ds_owner_0)');
    expect(r.params.ds_owner_0).toBe(7);
  });

  it('CUSTOM → 按会话里的部门集合过滤', async () => {
    const r = await resolve(['CUSTOM']);
    expect(r.clause).toBe('(h.deptId IN (:...ds_custom_0))');
    expect(r.params.ds_custom_0).toEqual([11, 12]);
  });

  it('CUSTOM 但集合为空 → 看不到任何数据（fail-closed）', async () => {
    const r = await resolve(['CUSTOM'], {
      userId: 7,
      deptId: 3,
      dataScopeDepts: [],
    });
    expect(r.clause).toBe('1 = 0');
  });

  it('CUSTOM 且没带 dataScopeDepts → 同样 fail-closed', async () => {
    const r = await resolve(['CUSTOM'], { userId: 7, deptId: 3 });
    expect(r.clause).toBe('1 = 0');
  });

  it('多角色取并集（OR），不是交集', async () => {
    const r = await resolve(['CUSTOM', 'SELF']);
    expect(r.clause).toBe(
      '(h.deptId IN (:...ds_custom_0) OR h.createdBy = :ds_owner_1)',
    );
    expect(r.params).toEqual({ ds_custom_0: [11, 12], ds_owner_1: 7 });
  });

  it('参数名不冲突：DEPT + SELF 同时存在', async () => {
    const r = await resolve(['DEPT', 'SELF']);
    expect(r.clause).toBe(
      '(h.deptId = :ds_dept_0 OR h.createdBy = :ds_owner_1)',
    );
  });

  it('没有任何可用范围 → 一律不可见', async () => {
    const r = await resolve([]);
    expect(r.clause).toBe('1 = 0');
  });
});
