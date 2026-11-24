import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { SessionService } from '../../core/session/session.service.js';
import { UserRole } from '../user/entities/user-role.entity.js';
import {
  type CreateRoleInput,
  type QueryRoleInput,
  type UpdateRoleInput,
} from './dto/role.dto.js';
import { RoleDept } from './entities/role-dept.entity.js';
import { Role } from './entities/role.entity.js';

const MSG_ROLE_NOT_FOUND = '角色不存在';

/**
 * 内置超管的编号（`sys_role.level = 0`）。
 *
 * 判据用 level 而不是 permissions：
 * - 权限码是**可编辑的数据**（后台能改），拿它当身份判据等于把门锁装在门牌上；
 * - 超管权限现在是 `*:*:*`，但那是**可配置的结果**，不是身份本身。
 * level 由服务端分配且不可改（实体里 `update: false`），才是稳定身份。
 */
export const SUPERADMIN_LEVEL = 0;

/** 内置角色占用的最大编号（0-4），自建角色从它 +1 起排 */
export const BUILTIN_MAX_LEVEL = 4;

/** 是否内置超管角色（唯一；不可删，且权限/数据范围/状态不可改） */
export function isSuperAdmin(role: Pick<Role, 'level'>): boolean {
  return role.level === SUPERADMIN_LEVEL;
}

/**
 * 是否内置角色（不可删）。
 * 判据是 `is_builtin` 这个**显式数据**，不是 `level <= 4` 这种范围约定 ——
 * 范围约定会在「加第 6 个内置角色」的当天失效。
 */
export function isBuiltinRole(role: Pick<Role, 'isBuiltin'>): boolean {
  return role.isBuiltin === 1;
}

/**
 * 影响「这个人能做什么」的字段。
 * 两个用途：
 * 1. 超管角色上**锁死**（改了可能把系统锁死：清空 `permissions` 后没人能进系统域，
 *    且没有任何界面能救回来）；
 * 2. 变更后**失效会话**（会话里缓存着旧的权限快照，不失效就是"撤权撤不掉"）。
 *
 * 改 `roleName` 不在其中：它只影响展示，踢人下线属于误伤。
 */
const AUTHZ_FIELDS = ['permissions', 'rules', 'dataScope', 'status'] as const;

/** 取「权限指纹」：只包含影响能力判定的字段，用于判断本次修改是否需要失效会话 */
function authzFingerprint(role: Role): string {
  return JSON.stringify(AUTHZ_FIELDS.map((f) => role[f] ?? null));
}

/**
 * 角色服务：RBAC/CASL 的载体（权限码 + 规则）。
 * 写操作走事务（txHost.tx），保证一致。
 */
@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(RoleDept)
    private readonly roleDeptRepo: Repository<RoleDept>,
    private readonly session: SessionService,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async findById(id: number): Promise<Role | null> {
    const role = await this.roleRepo.findOneBy({ id });
    if (!role) return null;
    const [withDepts] = await this.attachDeptIds([role]);
    return withDepts ?? role;
  }

  /**
   * 给角色对象挂上 `deptIds`（自定义数据范围的部门集合）。
   *
   * 为什么不放进实体列：`deptIds` 是派生数据（来自 sys_role_dept），
   * 放进 @Column 会让 save() 试图写一个不存在的列。
   */
  private async attachDeptIds<T extends Role>(roles: T[]): Promise<T[]> {
    if (!roles.length) return roles;
    const ids = roles.map((r) => r.id);
    const rows = await this.roleDeptRepo.find({
      where: { roleId: In(ids) },
      select: ['roleId', 'deptId'],
    });
    const byRole = new Map<number, number[]>();
    for (const row of rows) {
      const list = byRole.get(row.roleId) ?? [];
      list.push(row.deptId);
      byRole.set(row.roleId, list);
    }
    return roles.map((r) =>
      Object.assign(r, { deptIds: byRole.get(r.id) ?? [] }),
    );
  }

  /** 覆盖角色的自定义部门集合（事务内先删后插，避免残留已取消的部门） */
  private async replaceDeptIds(
    repo: Repository<RoleDept>,
    roleId: number,
    deptIds: number[],
  ): Promise<void> {
    // 硬删：关联表没有业务含义，留软删行会撞唯一键（同一个部门再次选中时插不进去）
    await repo.delete({ roleId });
    const unique = [...new Set(deptIds)];
    if (!unique.length) return;
    await repo.insert(unique.map((deptId) => ({ roleId, deptId })));
  }

  /**
   * 取一组角色在 `CUSTOM` 范围内的部门并集（登录时写进会话用）。
   * 非 CUSTOM 的角色不贡献部门 —— 它们的范围由 DEPT / DEPT_AND_CHILD / SELF 表达。
   */
  async getCustomDeptIds(
    roles: Pick<Role, 'id' | 'dataScope'>[],
  ): Promise<number[]> {
    const roleIds = roles
      .filter((r) => r.dataScope === 'CUSTOM')
      .map((r) => r.id);
    if (!roleIds.length) return [];
    const rows = await this.roleDeptRepo.find({
      where: { roleId: In(roleIds) },
      select: ['deptId'],
    });
    return [...new Set(rows.map((r) => r.deptId))];
  }

  async page(query: QueryRoleInput): Promise<PageResult<Role>> {
    const qb = this.roleRepo.createQueryBuilder('r');
    if (query.keyword) {
      // 角色标识（role_key）已废弃，只按名称搜
      qb.andWhere('r.roleName LIKE :kw', { kw: `%${query.keyword}%` });
    }
    if (query.status !== undefined) {
      qb.andWhere('r.status = :status', { status: query.status });
    }
    // 编号升序：内置角色（0-4）永远排在最前面，自建角色按编号跟在后面
    qb.orderBy('r.level', 'ASC')
      .addOrderBy('r.id', 'ASC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(await this.attachDeptIds(list), total);
  }

  async create(dto: CreateRoleInput): Promise<Role> {
    const { deptIds, ...roleFields } = dto;
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Role);
      const level = await this.allocateLevel(repo);
      const saved = await repo.save(repo.create({ ...roleFields, level }));
      if (deptIds?.length) {
        await this.replaceDeptIds(
          this.txHost.tx.getRepository(RoleDept),
          saved.id,
          deptIds,
        );
      }
      return saved;
    });
  }

  /**
   * 分配下一个角色编号：MAX(level) + 1（内置 0-4，自建从 5 起）。
   *
   * 为什么要在应用侧算：
   * - MySQL 一张表**只允许一个自增列**，`id` 已经是自增主键，`level` 加不了自增；
   * - 那就退一步：先取 `MAX(level)` 再 +1，唯一索引兜底（撞了就报错，不会静默串号）。
   *
   * 为什么要先加锁：
   * - 两个并发创建可能读到同一个 MAX。所以先用一次**悲观写锁**
   *   （`SELECT id ... FOR UPDATE`）把角色创建串行化。角色创建是低频操作，
   *   锁整张 `sys_role`（行数是个位/十位）完全可以接受。
   *
   * ⚠️ 两处 `withDeleted()` 都不能省：
   *   软删的角色**物理行还在**、编号仍被占用。漏掉已删行会让新编号撞上
   *   墓碑行的唯一键（表现为「删了角色反而建不出新角色」）。
   */
  private async allocateLevel(repo: Repository<Role>): Promise<number> {
    await repo
      .createQueryBuilder('r')
      .withDeleted()
      .select('r.id')
      .setLock('pessimistic_write')
      .getMany();
    const raw = await repo
      .createQueryBuilder('r')
      .withDeleted()
      .select('MAX(r.level)', 'max')
      .getRawOne<{ max: number | string | null }>();
    return Number(raw?.max ?? BUILTIN_MAX_LEVEL) + 1;
  }

  async update(id: number, dto: UpdateRoleInput): Promise<Role> {
    const outcome = await this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Role);
      const role = await repo.findOneBy({ id });
      if (!role) throw new NotFoundException(MSG_ROLE_NOT_FOUND);

      this.assertSuperAdminWritable(role, dto);

      // deptIds 不是角色表的列，先摘出来单独处理
      const { deptIds, ...fields } = dto;
      // 只覆盖**显式传入**的字段：DTO 里被省略的键不能把库里的值改成 undefined
      const patch = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== undefined),
      );
      const before = authzFingerprint(role);
      Object.assign(role, patch);
      const saved = await repo.save(role);

      // 部门集合变了也算授权变更：会话里缓存着 dataScopeDepts，
      // 不失效就是"改了数据范围、本人却还按旧范围看"。
      let deptChanged = false;
      if (deptIds !== undefined) {
        const deptRepo = this.txHost.tx.getRepository(RoleDept);
        const prev = await deptRepo.find({
          where: { roleId: id },
          select: ['deptId'],
        });
        const prevSet = new Set(prev.map((r) => r.deptId));
        const nextSet = new Set(deptIds);
        deptChanged =
          prevSet.size !== nextSet.size ||
          [...nextSet].some((d) => !prevSet.has(d));
        if (deptChanged) await this.replaceDeptIds(deptRepo, id, deptIds);
      }

      const authzChanged = before !== authzFingerprint(saved) || deptChanged;
      return { saved, authzChanged };
    });

    // 会话失效放在**事务提交之后**：Redis 不受事务保护，
    // 写在事务里会出现「事务回滚了，人却被踢下线了」。
    if (outcome.authzChanged) await this.invalidateRoleHolders(id);
    return outcome.saved;
  }

  /**
   * 超管角色只读（服务端强拦，前端置灰只是顺手挡）。
   *
   * 为什么必须拦：超管是系统管理域**唯一**的入口。把它的 `permissions` 清空
   * （或删掉）之后，没有人能再进系统管理域，也没有任何界面能把这个洞补回来 ——
   * 系统当场锁死，只能改库。参照若依 `checkRoleAllowed()`：超管行干脆不给操作按钮。
   * 要停用超管请改 `status`（但那条路也被这里堵住了，属于刻意：超管一旦停用，
   * 同样没人能进系统域）。
   *
   * 只放行 `roleName`：改名不影响能力，也救不了系统。
   */
  private assertSuperAdminWritable(role: Role, dto: UpdateRoleInput): void {
    if (!isSuperAdmin(role)) return;
    const violated = AUTHZ_FIELDS.filter((f) => dto[f] !== undefined);
    if (violated.length) {
      throw new ApiException(
        `内置超级管理员角色为系统域唯一入口，禁止修改：${violated.join('、')}（仅允许改名称）`,
      );
    }
  }

  async remove(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Role);
      const role = await repo.findOneBy({ id });
      if (!role) throw new NotFoundException(MSG_ROLE_NOT_FOUND);

      if (isBuiltinRole(role)) {
        throw new ApiException('内置角色不可删除（如需停用请将状态改为禁用）');
      }

      // 有用户持有 → 拒绝删除。
      // 为什么不能"删了就算"：角色是**软删**，而取有效角色的 join 会过滤掉软删行，
      // 于是持有人**静默失去权限**（比硬删还隐蔽）；若依同样先查
      // `countUserRoleByRoleId() > 0` 再拒。提示里给出人数，方便管理员定位。
      const holders = await this.countHolders(id);
      if (holders > 0) {
        throw new ApiException(
          `该角色已分配给 ${holders} 个用户，请先解除授权后再删除`,
        );
      }

      await repo.softDelete(id);
      // 关联表跟着清：角色是软删，但 sys_role_dept 没有业务含义，
      // 留着就是孤儿行（以后按部门反查"哪些角色能看它"会查到已删角色）。
      await this.txHost.tx.getRepository(RoleDept).delete({ roleId: id });
      return true;
    });
  }

  private async countHolders(roleId: number): Promise<number> {
    return this.userRoleRepo
      .createQueryBuilder('ur')
      .where('ur.role_id = :roleId', { roleId })
      .getCount();
  }

  /**
   * 让持有该角色的所有会话失效（下次请求 401 → 重新登录）。
   *
   * 不做这一步的后果是**撤权不生效**：会话里缓存着 permissions 快照，
   * 在 TTL（2 小时）内旧 token 依然是旧权限 ——
   * 「给权限立刻能用、撤权限撤不掉」，只剩一半是危险的。
   * 对齐若依 `clearAllCachedAuthorizationInfo()`。
   *
   * 注：删除角色**不需要**调这个 —— 有持有人的角色已经拒绝删除了。
   */
  private async invalidateRoleHolders(roleId: number): Promise<void> {
    const rows = await this.userRoleRepo
      .createQueryBuilder('ur')
      .select('ur.user_id', 'userId')
      .where('ur.role_id = :roleId', { roleId })
      .getRawMany<{ userId: number | string }>();
    const userIds = [...new Set(rows.map((r) => Number(r.userId)))];
    await Promise.all(userIds.map((uid) => this.session.invalidate(uid)));
  }
}
