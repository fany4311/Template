/**
 * 数据范围（ABAC/ReBAC 的核心机制）。
 * 放在角色上；用户部门变化时自动生效，无需改角色。
 */
export type DataScope =
  | 'ALL' // 全校
  | 'DEPT_AND_CHILD' // 本部门及以下
  | 'DEPT' // 本部门
  | 'SELF' // 本人
  | 'CUSTOM'; // 自定义部门集合

export const DATA_SCOPE_VALUES: readonly DataScope[] = [
  'ALL',
  'DEPT_AND_CHILD',
  'DEPT',
  'SELF',
  'CUSTOM',
];
