import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { PermissionCatalogEntry } from '../../common/authz/permission-catalog.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  type PermissionGroup,
  type PermissionResponse,
} from './dto/permission.response.js';
import { SysPermission } from './entities/permission.entity.js';

/** 一次同步的统计 */
export interface PermissionSyncResult {
  /** 新增的码 */
  inserted: number;
  /** 元数据（名称/分组）有变化的码 */
  updated: number;
  /** 代码中已不存在、被置为停用的码 */
  deprecated: number;
  /** 清单总条目数 */
  total: number;
}

/**
 * 权限清单服务。
 *
 * 两个职责，刻意放在一起：
 * - `list()`：给角色界面渲染「按模块分组树形勾选」；
 * - `sync()`：被 `pnpm authz:sync` 调用，把反射采集结果落库。
 *
 * ⚠️ 本服务**不参与鉴权**。`RbacGuard` 只看 `sys_role.permissions` 的字符串匹配，
 * 与这张表无关。即使清单为空，鉴权行为也不变 —— 这是刻意的：
 * 让鉴权只依赖一个真相源（角色权限串），避免"清单没同步导致全员失权"这类事故。
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(SysPermission)
    private readonly repo: Repository<SysPermission>,
  ) {}

  /**
   * 清单（按模块分组）。
   * 包含已停用条目：角色里可能还挂着旧码，界面需要能显示「该码已失效」，
   * 否则用户只会看到一个勾选框莫名其妙地"自己没了"。
   */
  async list(): Promise<PermissionGroup[]> {
    const rows = await this.repo.find({
      order: { module: 'ASC', moduleLabel: 'ASC', code: 'ASC' },
    });

    const groups = new Map<string, PermissionGroup>();
    for (const row of rows) {
      const key = `${row.module}\u0000${row.moduleLabel}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          module: row.module,
          moduleLabel: row.moduleLabel || row.module,
          permissions: [],
        };
        groups.set(key, group);
      }
      group.permissions.push(this.toResponse(row));
    }
    return [...groups.values()];
  }

  /**
   * 同步：upsert + 停用（**从不物理删除**）。
   *
   * 为什么停用而不是删除：角色权限串里可能引用着这条码，
   * 删掉清单后它就成了无据可查的幽灵；保留一行 `status=0`
   * 至少能回答"这个码曾经存在、对应哪个接口、为什么没了"。
   */
  async sync(entries: PermissionCatalogEntry[]): Promise<PermissionSyncResult> {
    // 防呆：扫描结果为空一定是采集逻辑坏了（模块没注册/路径不对），
    // 此时若照常执行会把整张清单停用，界面瞬间空白 —— 宁可报错。
    if (!entries.length) {
      throw new ApiException(
        '权限清单采集结果为空，已中止同步（避免误停用全部权限）',
      );
    }

    const existing = await this.repo.find();
    const byCode = new Map(existing.map((row) => [row.code, row]));

    let inserted = 0;
    let updated = 0;

    for (const entry of entries) {
      const current = byCode.get(entry.code);
      if (!current) {
        await this.repo.insert({
          code: entry.code,
          name: entry.name,
          module: entry.module,
          moduleLabel: entry.moduleLabel,
          status: 1,
        });
        inserted += 1;
        continue;
      }

      const changed =
        current.name !== entry.name ||
        current.module !== entry.module ||
        current.moduleLabel !== entry.moduleLabel ||
        current.status !== 1;
      if (changed) {
        await this.repo.update(current.id, {
          name: entry.name,
          module: entry.module,
          moduleLabel: entry.moduleLabel,
          status: 1,
        });
        updated += 1;
      }
      byCode.delete(entry.code);
    }

    // 剩下的 = 代码里已不存在
    const stale = [...byCode.values()].filter((row) => row.status === 1);
    for (const row of stale) {
      await this.repo.update(row.id, { status: 0 });
    }

    return {
      inserted,
      updated,
      deprecated: stale.length,
      total: entries.length,
    };
  }

  private toResponse(row: SysPermission): PermissionResponse {
    return {
      id: row.id,
      createTime: row.createTime.toISOString(),
      updateTime: row.updateTime.toISOString(),
      code: row.code,
      name: row.name,
      module: row.module,
      moduleLabel: row.moduleLabel,
      status: row.status,
    };
  }
}
