import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { User } from '../user/entities/user.entity.js';
import type {
  CreateDeptInput,
  QueryDeptInput,
  UpdateDeptInput,
} from './dto/dept.dto.js';
import { Dept } from './entities/dept.entity.js';

const MSG_DEPT_NOT_FOUND = '部门不存在';
const ROOT_ANCESTORS = '0';

/** 树节点 */
export type DeptTreeNode = Dept & { children: DeptTreeNode[] };

/** 平铺列表 → 树 */
export function buildDeptTree(list: Dept[]): DeptTreeNode[] {
  const map = new Map<number, DeptTreeNode>();
  for (const dept of list) {
    map.set(dept.id, Object.assign(dept as DeptTreeNode, { children: [] }));
  }
  const roots: DeptTreeNode[] = [];
  for (const node of map.values()) {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * 部门服务：树形组织结构（ancestors 存祖先路径，供 dataScope 的"本部门及以下"使用）。
 * 写操作走事务。
 */
@Injectable()
export class DeptService {
  constructor(
    @InjectRepository(Dept) private readonly deptRepo: Repository<Dept>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  findById(id: number): Promise<Dept | null> {
    return this.deptRepo.findOneBy({ id });
  }

  /** 平铺分页列表 */
  async list(query: QueryDeptInput): Promise<Dept[]> {
    const qb = this.deptRepo.createQueryBuilder('d');
    if (query.keyword) {
      qb.andWhere('d.name LIKE :kw', { kw: `%${query.keyword}%` });
    }
    if (query.status !== undefined) {
      qb.andWhere('d.status = :status', { status: query.status });
    }
    return qb.orderBy('d.sort', 'ASC').addOrderBy('d.id', 'ASC').getMany();
  }

  /** 树形列表 */
  async tree(query: QueryDeptInput): Promise<DeptTreeNode[]> {
    return buildDeptTree(await this.list(query));
  }

  /**
   * 自身 + 全部子孙部门 id（"本部门及以下"数据范围）。
   * ancestors 形如 "0,1,5"，故 id=5 的子孙满足 ancestors LIKE '%,5,%' 或 '%,5'。
   */
  async findDescendantIds(deptId: number): Promise<number[]> {
    const rows = await this.deptRepo
      .createQueryBuilder('d')
      .select('d.id', 'id')
      .where('d.id = :id OR d.ancestors LIKE :mid OR d.ancestors LIKE :end', {
        id: deptId,
        mid: `%,${deptId},%`,
        end: `%,${deptId}`,
      })
      .getRawMany<{ id: number }>();
    const ids = rows.map((r) => Number(r.id));
    return ids.length ? ids : [deptId];
  }

  async create(dto: CreateDeptInput): Promise<Dept> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Dept);
      let ancestors = ROOT_ANCESTORS;
      if (dto.parentId) {
        const parent = await repo.findOneBy({ id: dto.parentId });
        if (!parent) throw new ApiException('上级部门不存在');
        ancestors = `${parent.ancestors},${parent.id}`;
      }
      return repo.save(repo.create({ ...dto, ancestors }));
    });
  }

  /** 更新部门；若变更上级，同步重写自身与全部子孙的 ancestors */
  async update(id: number, dto: UpdateDeptInput): Promise<Dept> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Dept);
      const dept = await repo.findOneBy({ id });
      if (!dept) throw new NotFoundException(MSG_DEPT_NOT_FOUND);

      // 与 menu.service 同形：`null` / `0` 在 DTO 就归一成 `null`（= 顶级），
      // 这里只判“父级到底变没变”
      const nextParentId =
        dto.parentId !== undefined ? dto.parentId : dept.parentId;
      const parentChanged = (nextParentId ?? null) !== (dept.parentId ?? null);
      if (parentChanged) {
        let ancestors = ROOT_ANCESTORS;
        if (nextParentId) {
          if (nextParentId === id) throw new ApiException('上级部门不能是自己');
          const parent = await repo.findOneBy({ id: nextParentId });
          if (!parent) throw new ApiException('上级部门不存在');
          const parentPath = parent.ancestors.split(',');
          if (parent.id === id || parentPath.includes(String(id))) {
            throw new ApiException('上级部门不能是自身的子部门');
          }
          ancestors = `${parent.ancestors},${parent.id}`;
        }

        const oldPrefix = `${dept.ancestors},${dept.id}`;
        const newPrefix = `${ancestors},${dept.id}`;
        Object.assign(dept, dto, { parentId: nextParentId, ancestors });
        const saved = await repo.save(dept);

        // 子孙：把祖先路径前缀 oldPrefix 换成 newPrefix
        //
        // **必须带逗号边界**（= :p 或 LIKE ':p,%'）。只写 LIKE '${oldPrefix}%'
        // 会把兄弟子树一起改掉：id=1 的 oldPrefix 是 '0,1'，而 '0,10'（父级 id=10
        // 的兄弟）也以 '0,1' 开头 —— 一次挪部门会静默改坏别的枝条，进而让数据范围
        // （ancestors 求子树）跟着错。菜单模块一直是正确的（同款写法），部门漏了。
        const descendants = await repo
          .createQueryBuilder('d')
          .where('(d.ancestors = :p OR d.ancestors LIKE :pc)', {
            p: oldPrefix,
            pc: `${oldPrefix},%`,
          })
          .getMany();
        for (const child of descendants) {
          child.ancestors = newPrefix + child.ancestors.slice(oldPrefix.length);
          await repo.save(child);
        }
        return saved;
      }

      Object.assign(dept, dto);
      return repo.save(dept);
    });
  }

  /**
   * 删除部门（软删除）；存在下级或**仍有用户挂靠**则拒绝。
   *
   * 为什要看用户：`sys_user.dept_id` 没有外键，删掉部门后那些用户的 deptId 成了
   * 悬空值 —— 界面看不出异常，但 dataScope 的「本部门」按 deptId 过滤 → **静默失权**。
   * 角色侧同类保护见 `RoleService.remove`（有持有人拒删）。
   */
  async remove(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Dept);
      const dept = await repo.findOneBy({ id });
      if (!dept) throw new NotFoundException(MSG_DEPT_NOT_FOUND);
      const children = await repo.countBy({ parentId: id });
      if (children > 0) throw new ApiException('存在下级部门，不能删除');
      const holders = await this.userRepo.countBy({ deptId: id });
      if (holders > 0) {
        throw new ApiException(
          `该部门下还有 ${holders} 个用户，请先调岗后再删除`,
        );
      }
      await repo.softDelete(id);
      return true;
    });
  }
}
