import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { DataSource, Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  CSV_MAX_FAILED,
  CSV_MAX_ROWS,
  type ImportFailure,
  type ImportResult,
} from '../../common/import-export/csv.js';
import { SessionService } from '../../core/session/session.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { JwtUser } from '../auth/auth.interface.js';
import { DataScopeService } from '../dept/data-scope.service.js';
import type { Role } from '../role/entities/role.entity.js';
import type {
  CreateUserInput,
  ExportUserQuery,
  QueryUserInput,
  UpdateUserInput,
} from './dto/user.dto.js';
import { userImportRowSchema } from './user.csv.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';

const MSG_USER_EXISTS = '用户名已存在';
const MSG_USER_NOT_FOUND = '用户不存在';

/**
 * 用户服务：登录查询 + CRUD + 角色授权（显式 sys_user_role，支持临时授权）。
 * 写操作走事务；涉及权限/部门的变更会使该用户会话失效（强制刷新）。
 */
@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly outbox: OutboxService,
    private readonly session: SessionService,
    private readonly dataScope: DataScopeService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ---------------- 导入 / 导出 ----------------

  /**
   * 导出：与列表同样的筛选 + **同样的数据范围**。
   * 导出必须走 dataScope，否则「列表看不到的用户」能从 CSV 里捞出来。
   */
  async exportRows(query: ExportUserQuery, user: JwtUser): Promise<User[]> {
    const qb = this.userRepo.createQueryBuilder('u');
    const { clause, params } = await this.dataScope.resolve(
      { userId: user.userId, deptId: user.deptId },
      user.dataScopes ?? [],
      { deptColumn: 'u.deptId', ownerColumn: 'u.id' },
    );
    qb.andWhere(clause, params);

    if (query.keyword) {
      qb.andWhere('(u.username LIKE :kw OR u.nickname LIKE :kw)', {
        kw: '%' + query.keyword + '%',
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('u.status = :status', { status: query.status });
    }
    if (query.deptId !== undefined) {
      qb.andWhere('u.deptId = :deptId', { deptId: query.deptId });
    }

    const rows = await qb.orderBy('u.id', 'ASC').limit(CSV_MAX_ROWS + 1).getMany();
    if (rows.length > CSV_MAX_ROWS) {
      throw new ApiException('单次最多导出 ' + CSV_MAX_ROWS + ' 条，请先按关键字或部门缩小范围');
    }
    return rows;
  }

  /**
   * 逐行导入用户：部分成功。
   * 初始密码：行内给了就用行内（≥8 位）；否则读参数 sys.user.initPassword。
   * 不做默认口令兜底 —— 硬编码默认密码等于给每个部署留一个后门。
   */
  async importRows(records: Record<string, string>[]): Promise<ImportResult> {
    const failed: ImportFailure[] = [];
    let ok = 0;
    let failedTruncated = false;
    const pushFailure = (row: number, message: string): void => {
      if (failed.length < CSV_MAX_FAILED) failed.push({ row, message });
      else failedTruncated = true;
    };

    const fallbackPassword = await this.defaultInitPassword();
    // 同一批通常共用一个初始密码：hash 一次即可（argon2 单次约几十毫秒）
    const hashCache = new Map<string, string>();

    for (let index = 0; index < records.length; index += 1) {
      const rowNo = index + 2;
      const parsed = userImportRowSchema.safeParse(records[index]);
      if (!parsed.success) {
        pushFailure(rowNo, parsed.error.issues[0]?.message ?? '格式不正确');
        continue;
      }

      const row = parsed.data;

      try {
        // 先判重：账号已存在时，提示"密码不够"会把人带偏
        const exists = await this.userRepo.findOneBy({ username: row.username });
        if (exists) {
          pushFailure(rowNo, '账号已存在：' + row.username);
          continue;
        }

        const plain = row.initialPassword || fallbackPassword;
        if (!plain || plain.length < 8) {
          pushFailure(rowNo, '缺少初始密码（至少 8 位），且参数 sys.user.initPassword 未配置');
          continue;
        }

        let deptId: number | null = null;
        if (row.deptName) {
          const depts: Array<{ id: number }> = await this.dataSource.query(
            'SELECT id FROM sys_dept WHERE name = ? AND delete_time IS NULL LIMIT 2',
            [row.deptName],
          );
          if (depts.length === 0) {
            pushFailure(rowNo, '部门不存在：' + row.deptName);
            continue;
          }
          if (depts.length > 1) {
            pushFailure(rowNo, '部门重名，无法唯一确定：' + row.deptName);
            continue;
          }
          deptId = depts[0]!.id;
        }

        let hash = hashCache.get(plain);
        if (!hash) {
          hash = await argonHash(plain);
          hashCache.set(plain, hash);
        }

        await this.userRepo.insert({
          username: row.username,
          password: hash,
          nickname: row.nickname,
          email: '',
          phone: row.phone,
          post: row.post,
          status: 1,
          deptId,
        } as never);
        ok += 1;
      } catch {
        pushFailure(rowNo, '写入失败，请检查字段长度');
      }
    }

    return { total: records.length, ok, failed, failedTruncated };
  }

  private async defaultInitPassword(): Promise<string> {
    try {
      const rows: Array<{ config_value: string }> = await this.dataSource.query(
        "SELECT config_value FROM sys_config WHERE config_key = 'sys.user.initPassword' AND status = 1 LIMIT 1",
      );
      const value = rows[0]?.config_value ?? '';
      return value.length >= 8 ? value : '';
    } catch {
      return '';
    }
  }

  /** 登录查询：按用户名取用户（带出密码） */
  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.username = :username', { username })
      .getOne();
  }

  /** 校验密码（argon2） */
  verifyPassword(plain: string, hashStr: string): Promise<boolean> {
    return argonVerify(hashStr, plain);
  }

  findById(id: number): Promise<User | null> {
    return this.userRepo.findOneBy({ id });
  }

  /** 取带密码哈希的用户（仅改密 / 校验原密码用，不得外传） */
  findByIdWithPassword(id: number): Promise<User | null> {
    return this.userRepo
      .createQueryBuilder('u')
      .addSelect('u.password')
      .where('u.id = :id', { id })
      .getOne();
  }

  /**
   * 设置新密码（哈希后写库），并使该用户**所有会话失效**。
   *
   * 为什么要失效会话：改密的常见动机是「怀疑密码泄露」。如果旧 token 还能继续用，
   * 改密就变成一件自我安慰的事 —— 攻击者照样拿着旧 token 操作，直到 2 小时 TTL 到期。
   * 副作用：改密人自己也会被踢下线（前端据此跳登录页）。
   */
  async updatePassword(id: number, plain: string): Promise<void> {
    const password = await argonHash(plain);
    await this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(User);
      const user = await repo.findOneBy({ id });
      if (!user) throw new NotFoundException(MSG_USER_NOT_FOUND);
      await repo.update({ id }, { password });
    });
    await this.session.invalidate(id);
  }

  /** 有效角色（过滤已过期的临时授权） */
  async getEffectiveRoles(userId: number): Promise<Role[]> {
    const grants = await this.userRoleRepo
      .createQueryBuilder('ur')
      .leftJoinAndSelect('ur.role', 'role')
      .where('ur.userId = :userId', { userId })
      .andWhere('(ur.expireAt IS NULL OR ur.expireAt > :now)', {
        now: new Date(),
      })
      .getMany();
    return grants.map((g) => g.role).filter((r): r is Role => Boolean(r));
  }

  /**
   * 分页查询：keyword 模糊匹配 用户名/昵称。
   * 传入当前登录用户时，按角色 dataScope 收敛可见范围（查询层过滤）。
   */
  async page(query: QueryUserInput, user?: JwtUser): Promise<PageResult<User>> {
    const qb = this.userRepo.createQueryBuilder('u');
    if (user) {
      const { clause, params } = await this.dataScope.resolve(
        { userId: user.userId, deptId: user.deptId },
        user.dataScopes ?? [],
        { deptColumn: 'u.deptId', ownerColumn: 'u.id' },
      );
      qb.andWhere(clause, params);
    }
    if (query.keyword) {
      qb.andWhere('(u.username LIKE :kw OR u.nickname LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('u.status = :status', { status: query.status });
    }
    if (query.deptId !== undefined) {
      qb.andWhere('u.deptId = :deptId', { deptId: query.deptId });
    }
    qb.orderBy('u.id', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  /** 创建用户：事务内写用户 + 授权 + Outbox 事件 */
  async create(dto: CreateUserInput) {
    const { roleIds, ...rest } = dto;
    const password = await argonHash(dto.password);

    const saved = await this.txHost.withTransaction(async () => {
      const userRepo = this.txHost.tx.getRepository(User);
      const exists = await userRepo.findOneBy({ username: dto.username });
      if (exists) throw new ApiException(MSG_USER_EXISTS);

      const created = await userRepo.save(userRepo.create({ ...rest, password }));
      if (roleIds?.length) {
        const urRepo = this.txHost.tx.getRepository(UserRole);
        await urRepo.save(
          roleIds.map((roleId) =>
            urRepo.create({ userId: created.id, roleId, source: 'direct' }),
          ),
        );
      }
      await this.outbox.append({
        eventType: 'user.created',
        aggregateType: 'user',
        aggregateId: String(created.id),
        payload: { userId: created.id, username: created.username },
      });
      return created;
    });

    const { password: _ignored, ...safe } = saved;
    void _ignored;
    return safe;
  }

  /** 更新用户（不含密码）；传 roleIds 则重置角色授权 */
  async update(id: number, dto: UpdateUserInput) {
    const { roleIds, ...rest } = dto;
    const saved = await this.txHost.withTransaction(async () => {
      const userRepo = this.txHost.tx.getRepository(User);
      const user = await userRepo.findOneBy({ id });
      if (!user) throw new NotFoundException(MSG_USER_NOT_FOUND);
      Object.assign(user, rest);
      const result = await userRepo.save(user);

      if (roleIds) {
        const urRepo = this.txHost.tx.getRepository(UserRole);
        await urRepo.delete({ userId: id });
        if (roleIds.length) {
          await urRepo.save(
            roleIds.map((roleId) =>
              urRepo.create({ userId: id, roleId, source: 'direct' }),
            ),
          );
        }
      }
      return result;
    });

    await this.session.invalidate(id);
    return saved;
  }

  /** 删除用户（软删除）+ 解绑所有角色 */
  async remove(id: number): Promise<boolean> {
    await this.txHost.withTransaction(async () => {
      const userRepo = this.txHost.tx.getRepository(User);
      const user = await userRepo.findOneBy({ id });
      if (!user) throw new NotFoundException(MSG_USER_NOT_FOUND);
      await userRepo.softDelete(id);
      await this.txHost.tx.getRepository(UserRole).delete({ userId: id });
    });
    await this.session.invalidate(id);
    return true;
  }

  /** 授权（支持临时授权：expireAt 非空则到期失效） */
  async grantRoles(
    userId: number,
    roleIds: number[],
    opts?: { expireAt?: Date | null; grantedBy?: number },
  ): Promise<void> {
    await this.txHost.withTransaction(async () => {
      const urRepo = this.txHost.tx.getRepository(UserRole);
      for (const roleId of roleIds) {
        const expireAt = opts?.expireAt ?? null;
        // 先清旧记录再插入，避免唯一索引 (user_id, role_id) 冲突
        await urRepo.delete({ userId, roleId });
        await urRepo.save(
          urRepo.create({
            userId,
            roleId,
            expireAt,
            source: expireAt ? 'temp' : 'direct',
            grantedBy: opts?.grantedBy,
          }),
        );
      }
    });
    await this.session.invalidate(userId);
  }

  /** 用户的角色授权列表（含临时授权到期时间） */
  listGrants(userId: number): Promise<UserRole[]> {
    return this.userRoleRepo.find({
      where: { userId },
      order: { id: 'ASC' },
    });
  }

  /** 撤销某个角色授权 */
  async revokeRole(userId: number, roleId: number): Promise<void> {
    await this.txHost.withTransaction(async () => {
      await this.txHost.tx.getRepository(UserRole).delete({ userId, roleId });
    });
    await this.session.invalidate(userId);
  }
}
