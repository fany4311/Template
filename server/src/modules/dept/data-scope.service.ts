import { Injectable } from '@nestjs/common';
import type { DataScope } from '../../common/enums/data-scope.enum.js';
import { DeptService } from './dept.service.js';

/** 数据范围判定所需的用户信息 */
export interface DataScopeUser {
  userId: number;
  deptId?: number;
}

/** 数据范围列名配置（不同实体列名不同） */
export interface DataScopeOptions {
  /** 部门列，如 'u.deptId' */
  deptColumn?: string;
  /** 归属人列，如 'u.id' / 'h.createdBy'（SELF 用） */
  ownerColumn?: string;
}

/** 解析结果：可追加到 QueryBuilder 的 where 片段与参数 */
export interface DataScopeResult {
  clause: string;
  params: Record<string, unknown>;
}

/**
 * 数据范围（dataScope）查询层助手。
 *
 * 把角色的数据范围翻译成 SQL 条件，统一在查询层收敛，避免散落各处。
 * 语义（多角色取并集）：
 * - ALL             → 无限制
 * - DEPT            → 本部门
 * - DEPT_AND_CHILD  → 本部门及以下（按 sys_dept.ancestors 求子树）
 * - SELF            → 归属人 = 当前用户
 * - CUSTOM          → 预留（自定义部门集合，暂按无权限处理）
 *
 * 用法：
 *   const { clause, params } = await dataScope.resolve(user, user.dataScopes, {
 *     deptColumn: 'u.deptId', ownerColumn: 'u.id',
 *   });
 *   qb.andWhere(clause, params);
 */
@Injectable()
export class DataScopeService {
  constructor(private readonly deptService: DeptService) {}

  async resolve(
    user: DataScopeUser,
    scopes: DataScope[],
    options: DataScopeOptions,
  ): Promise<DataScopeResult> {
    if (scopes.includes('ALL')) {
      return { clause: '1 = 1', params: {} };
    }

    const ors: string[] = [];
    const params: Record<string, unknown> = {};
    let idx = 0;

    const needDept =
      scopes.includes('DEPT') || scopes.includes('DEPT_AND_CHILD');
    if (needDept && options.deptColumn && user.deptId) {
      const key = `ds_dept_${idx++}`;
      if (scopes.includes('DEPT_AND_CHILD')) {
        params[key] = await this.deptService.findDescendantIds(user.deptId);
        ors.push(`${options.deptColumn} IN (:...${key})`);
      } else {
        params[key] = user.deptId;
        ors.push(`${options.deptColumn} = :${key}`);
      }
    }

    if (scopes.includes('SELF') && options.ownerColumn) {
      const key = `ds_owner_${idx++}`;
      params[key] = user.userId;
      ors.push(`${options.ownerColumn} = :${key}`);
    }

    // 没有任何可用的范围条件 → 一律不可见（fail-closed）
    if (!ors.length) return { clause: '1 = 0', params: {} };
    return { clause: `(${ors.join(' OR ')})`, params };
  }
}
