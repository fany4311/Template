import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { OutboxService } from '../outbox/outbox.service.js';
import type { JwtUser } from '../auth/auth.interface.js';
import { DataScopeService } from '../dept/data-scope.service.js';
import { Dept } from '../dept/entities/dept.entity.js';
import type {
  AcceptHazardInput,
  ArchiveHazardInput,
  CreateHazardInput,
  QueryHazardInput,
  RectifyHazardInput,
  RejectHazardInput,
  ReviewHazardInput,
} from './dto/hazard.dto.js';
import { Hazard } from './entities/hazard.entity.js';
import { HazardLog } from './entities/hazard-log.entity.js';
import { HazardSync } from './entities/hazard-sync.entity.js';
import {
  HAZARD_ACTION_EVENTS,
  type HazardEventPayload,
} from './hazard.events.js';
import {
  assertTransition,
  availableActions,
  HAZARD_STATUS_LABELS,
  HAZARD_TRANSITIONS,
  type HazardAction,
  type HazardStatus,
} from './hazard.state.js';

const MSG_NOT_FOUND = '隐患不存在';

/** 对外视图（实体 + 派生字段） */
export interface HazardView extends Hazard {
  statusLabel: string;
  assigneeDeptName: string;
  cooperateDeptNames: string[];
  overdue: boolean;
  availableActions: HazardAction[];
}

/** 列表查询后的加工依赖 */
interface EnrichContext {
  deptNames: Map<number, string>;
}

/**
 * 隐患服务 —— 第一个业务闭环的落点，也是底座的验证用例。
 *
 * 每个流转动作都是同一个骨架（acceptAction 之外的 5 个动作共用 `flow`）：
 *   1) 带数据范围取单据（取不到 = 不存在或不可见，统一 404，不泄漏存在性）
 *   2) 状态机校验（assertTransition，非法流转直接拒绝）
 *   3) 更新字段 + 落流转日志 + append Outbox 事件（**同一事务**）
 *
 * 之所以把 6 个动作收敛成一个 `flow()`：状态机、权限码、日志、事件四者必须同步演进，
 * 分散成 6 份实现必然出现"某个动作忘了发事件"这类问题。
 */
@Injectable()
export class HazardService {
  constructor(
    @InjectRepository(Hazard)
    private readonly hazardRepo: Repository<Hazard>,
    @InjectRepository(HazardLog)
    private readonly logRepo: Repository<HazardLog>,
    @InjectRepository(HazardSync)
    private readonly syncRepo: Repository<HazardSync>,
    @InjectRepository(Dept)
    private readonly deptRepo: Repository<Dept>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly dataScope: DataScopeService,
    private readonly outbox: OutboxService,
  ) {}

  // -------------------------------------------------------------------------
  // 可见性（数据范围 + 协办部门并集）
  // -------------------------------------------------------------------------

  /**
   * 可见性条件。
   *
   * 三层并集：
   * 1. 角色 dataScope（ALL / 本部门及以下 / 本部门 / 本人）—— 底座机制
   * 2. 我是上报人 —— 自己报的单永远看得见（即使被驳回）
   * 3. 我部门在协办列表 —— **多部门协同的关键**：协办方即使 dataScope=SELF 也能参与
   *
   * 第 3 条必须在 SQL 里做（不能在结果集过滤），否则分页 total 会不对。
   */
  private async visibility(
    user: JwtUser,
  ): Promise<{ clause: string; params: Record<string, unknown> }> {
    const base = await this.dataScope.resolve(
      { userId: user.userId, deptId: user.deptId },
      user.dataScopes ?? [],
      { deptColumn: 'h.assignee_dept_id', ownerColumn: 'h.reporter_id' },
    );

    const ors = [`(${base.clause})`];
    const params: Record<string, unknown> = { ...base.params };

    ors.push('h.reporter_id = :vis_me');
    params.vis_me = user.userId;

    if (user.deptId) {
      // JSON 数组包含：MySQL 把绑定串按 JSON 文档解析
      ors.push(
        'JSON_CONTAINS(COALESCE(h.cooperate_dept_ids, JSON_ARRAY()), :vis_dept)',
      );
      params.vis_dept = String(user.deptId);
    }

    return { clause: `(${ors.join(' OR ')})`, params };
  }

  /**
   * 判定当前用户能否看到某隐患（不抛错）。
   *
   * 供文件模块的附件鉴权复用**同一套**可见性规则 —— 附件权限跟业务对象权限
   * 必须同源，否则会出现「看不到单据却能下载它的附件」这种越权。
   */
  async canAccess(user: JwtUser, id: number): Promise<boolean> {
    if (!Number.isInteger(id) || id <= 0) return false;
    try {
      await this.findVisibleOrFail(id, user);
      return true;
    } catch {
      return false;
    }
  }

  /** 带数据范围取单条；不可见一律 404（不泄漏单据是否存在） */
  private async findVisibleOrFail(id: number, user: JwtUser): Promise<Hazard> {
    const { clause, params } = await this.visibility(user);
    const hazard = await this.hazardRepo
      .createQueryBuilder('h')
      .where('h.id = :id', { id })
      .andWhere(clause, params)
      .getOne();
    if (!hazard) throw new NotFoundException(MSG_NOT_FOUND);
    return hazard;
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  async page(
    query: QueryHazardInput,
    user: JwtUser,
  ): Promise<PageResult<HazardView>> {
    const { clause, params } = await this.visibility(user);

    const qb = this.hazardRepo.createQueryBuilder('h').where(clause, params);

    if (query.keyword) {
      qb.andWhere(
        '(h.title LIKE :kw OR h.hazard_no LIKE :kw OR h.location LIKE :kw)',
        { kw: `%${query.keyword}%` },
      );
    }
    if (query.status)
      qb.andWhere('h.status = :status', { status: query.status });
    if (query.level) qb.andWhere('h.level = :level', { level: query.level });
    if (query.scope) qb.andWhere('h.scope = :scope', { scope: query.scope });
    if (query.category) {
      qb.andWhere('h.category = :category', { category: query.category });
    }
    if (query.onlyMine && user.deptId) {
      qb.andWhere(
        '(h.assignee_dept_id = :mine OR JSON_CONTAINS(COALESCE(h.cooperate_dept_ids, JSON_ARRAY()), :mineJson))',
        { mine: user.deptId, mineJson: String(user.deptId) },
      );
    }

    qb.orderBy('h.id', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);

    const [list, total] = await qb.getManyAndCount();
    const ctx = await this.buildContext(list);
    return buildPageResult(
      list.map((h) => this.toView(h, ctx)),
      total,
    );
  }

  /** 详情：隐患 + 流转轨迹 + 省平台同步记录 */
  async detail(
    id: number,
    user: JwtUser,
  ): Promise<HazardView & { logs: HazardLog[]; syncRecords: HazardSync[] }> {
    const hazard = await this.findVisibleOrFail(id, user);
    const [logs, syncRecords, ctx] = await Promise.all([
      this.logRepo.find({ where: { hazardId: id }, order: { id: 'ASC' } }),
      this.syncRepo.find({ where: { hazardId: id }, order: { id: 'ASC' } }),
      this.buildContext([hazard]),
    ]);
    return { ...this.toView(hazard, ctx), logs, syncRecords };
  }

  /** 批量补齐部门名，避免 N+1 */
  private async buildContext(list: Hazard[]): Promise<EnrichContext> {
    const ids = new Set<number>();
    for (const h of list) {
      if (h.assigneeDeptId) ids.add(h.assigneeDeptId);
      if (h.reporterDeptId) ids.add(h.reporterDeptId);
      for (const d of h.cooperateDeptIds ?? []) ids.add(d);
    }
    if (!ids.size) return { deptNames: new Map() };
    const depts = await this.deptRepo.find({
      where: { id: In([...ids]) },
      select: { id: true, name: true },
    });
    return { deptNames: new Map(depts.map((d) => [d.id, d.name])) };
  }

  /** 实体 → 对外视图（派生 statusLabel / 部门名 / 逾期 / 可执行动作） */
  private toView(hazard: Hazard, ctx: EnrichContext): HazardView {
    const cooperate = hazard.cooperateDeptIds ?? [];
    return Object.assign(hazard, {
      statusLabel: HAZARD_STATUS_LABELS[hazard.status],
      assigneeDeptName: hazard.assigneeDeptId
        ? (ctx.deptNames.get(hazard.assigneeDeptId) ?? '')
        : '',
      cooperateDeptNames: cooperate
        .map((id) => ctx.deptNames.get(id) ?? '')
        .filter(Boolean),
      overdue: this.isOverdue(hazard),
      availableActions: availableActions(hazard.status),
    });
  }

  /** 逾期判定：有整改期限、未办结、且已过期 */
  private isOverdue(hazard: Hazard): boolean {
    const deadline = hazard.rectifyDeadline;
    if (!deadline) return false;
    if (hazard.status === 'ARCHIVED' || hazard.status === 'REJECTED')
      return false;
    return deadline.getTime() < Date.now();
  }

  // -------------------------------------------------------------------------
  // 上报
  // -------------------------------------------------------------------------

  /** 上报隐患（创建入口；scope=DEPT 时主责部门默认取上报人部门） */
  async report(dto: CreateHazardInput, user: JwtUser): Promise<HazardView> {
    const hazard = await this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Hazard);
      // 创建动作没有前置状态，不走 assertTransition（其 from 为空集）
      const transition = HAZARD_TRANSITIONS.REPORT;

      const cooperate = dto.cooperateDeptIds ?? [];
      const assignee = dto.assigneeDeptId ?? user.deptId ?? null;
      if (dto.scope === 'OPEN' && !cooperate.length) {
        throw new ApiException('多部门协同单必须至少指定一个协办部门');
      }

      const saved = await repo.save(
        repo.create({
          hazardNo: this.generateHazardNo(),
          title: dto.title,
          content: dto.content,
          location: dto.location,
          category: dto.category,
          level: dto.level,
          scope: dto.scope,
          status: transition.to,
          reporterId: user.userId,
          reporterName: user.username,
          reporterDeptId: user.deptId ?? null,
          assigneeDeptId: assignee,
          cooperateDeptIds: cooperate,
          rectifyDeadline: dto.rectifyDeadline
            ? new Date(dto.rectifyDeadline)
            : null,
          // 受理期限：上报后 24 小时（一单四制的"限时办结"，暂为常量）
          deadlineAt: new Date(Date.now() + 24 * 3600 * 1000),
        }),
      );

      await this.writeLog(
        saved,
        'REPORT',
        null,
        transition.to,
        dto.content.slice(0, 200),
        user,
      );
      await this.publish(
        saved,
        'REPORT',
        null,
        user,
        dto.content.slice(0, 200),
      );
      return saved;
    });

    const ctx = await this.buildContext([hazard]);
    return this.toView(hazard, ctx);
  }

  // -------------------------------------------------------------------------
  // 流转动作
  // -------------------------------------------------------------------------

  /** 受理：确定主责/协办部门、处理人、整改期限 → 整改中 */
  async accept(
    id: number,
    dto: AcceptHazardInput,
    user: JwtUser,
  ): Promise<HazardView> {
    return this.flow(id, 'ACCEPT', user, dto.remark, async (hazard, repo) => {
      if (dto.assigneeDeptId !== undefined) {
        hazard.assigneeDeptId = dto.assigneeDeptId;
      }
      if (dto.cooperateDeptIds !== undefined) {
        hazard.cooperateDeptIds = dto.cooperateDeptIds;
      }
      hazard.handlerId = dto.handlerId ?? user.userId;
      hazard.handlerName = user.username;
      if (dto.rectifyDeadline) {
        hazard.rectifyDeadline = new Date(dto.rectifyDeadline);
      }
      await repo.save(hazard);
    });
  }

  /** 驳回：单据终止 */
  async reject(
    id: number,
    dto: RejectHazardInput,
    user: JwtUser,
  ): Promise<HazardView> {
    return this.flow(id, 'REJECT', user, dto.reason, async (hazard, repo) => {
      hazard.rejectReason = dto.reason;
      await repo.save(hazard);
    });
  }

  /** 提交整改 → 待复查 */
  async rectify(
    id: number,
    dto: RectifyHazardInput,
    user: JwtUser,
  ): Promise<HazardView> {
    return this.flow(
      id,
      'RECTIFY',
      user,
      dto.rectifyMeasure,
      async (hazard, repo) => {
        hazard.rectifyMeasure = dto.rectifyMeasure;
        hazard.rectifyTime = new Date();
        await repo.save(hazard);
      },
    );
  }

  /** 复查：passed=true → 待归档；passed=false → 退回整改 */
  async review(
    id: number,
    dto: ReviewHazardInput,
    user: JwtUser,
  ): Promise<HazardView> {
    const action: HazardAction = dto.passed ? 'REVIEW_PASS' : 'REVIEW_BACK';
    return this.flow(id, action, user, dto.opinion, async (hazard, repo) => {
      hazard.reviewOpinion = dto.opinion;
      hazard.reviewerId = user.userId;
      hazard.reviewTime = new Date();
      if (!dto.passed) {
        // 退回整改：清空上次整改结果，避免前端显示"已整改"的假象
        hazard.rectifyMeasure = null;
        hazard.rectifyTime = null;
      }
      await repo.save(hazard);
    });
  }

  /** 归档 → 终态（审计员执行，只归档不改内容） */
  async archive(
    id: number,
    dto: ArchiveHazardInput,
    user: JwtUser,
  ): Promise<HazardView> {
    return this.flow(id, 'ARCHIVE', user, dto.opinion, async (hazard, repo) => {
      hazard.archiveOpinion = dto.opinion;
      hazard.archiverId = user.userId;
      hazard.archiveTime = new Date();
      await repo.save(hazard);
    });
  }

  /**
   * 流转骨架：可见性 → 状态机 → 变更 → 日志 → 事件，全部在一个事务内。
   * @param mutate 动作特有的字段变更（在事务内执行）
   */
  private async flow(
    id: number,
    action: HazardAction,
    user: JwtUser,
    remark: string,
    mutate: (hazard: Hazard, repo: Repository<Hazard>) => Promise<void>,
  ): Promise<HazardView> {
    const hazard = await this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Hazard);
      const current = await this.findVisibleOrFail(id, user);
      const transition = assertTransition(action, current.status);

      const from = current.status;
      await mutate(current, repo);
      current.status = transition.to;
      const saved = await repo.save(current);

      await this.writeLog(saved, action, from, transition.to, remark, user);
      await this.publish(saved, action, from, user, remark);
      return saved;
    });

    const ctx = await this.buildContext([hazard]);
    return this.toView(hazard, ctx);
  }

  /** 写业务流转日志（同事务） */
  private async writeLog(
    hazard: Hazard,
    action: HazardAction,
    from: HazardStatus | null,
    to: HazardStatus,
    remark: string,
    user: JwtUser,
  ): Promise<void> {
    const repo = this.txHost.tx.getRepository(HazardLog);
    await repo.save(
      repo.create({
        hazardId: hazard.id,
        hazardNo: hazard.hazardNo,
        scope: hazard.scope,
        action,
        actionLabel: HAZARD_TRANSITIONS[action].label,
        fromStatus: from,
        toStatus: to,
        operatorId: user.userId,
        operatorName: user.username,
        deptId: user.deptId ?? null,
        remark,
      }),
    );
  }

  /** 发领域事件（同事务），由省平台适配器异步消费 */
  private async publish(
    hazard: Hazard,
    action: HazardAction,
    from: HazardStatus | null,
    user: JwtUser,
    remark: string,
  ): Promise<void> {
    const payload: HazardEventPayload = {
      eventId: randomUUID(),
      eventType: HAZARD_ACTION_EVENTS[action],
      hazardId: hazard.id,
      hazardNo: hazard.hazardNo,
      action,
      fromStatus: from,
      toStatus: hazard.status,
      title: hazard.title,
      category: hazard.category,
      level: hazard.level,
      scope: hazard.scope,
      location: hazard.location,
      assigneeDeptId: hazard.assigneeDeptId ?? null,
      cooperateDeptIds: hazard.cooperateDeptIds ?? [],
      operatorId: user.userId,
      operatorName: user.username,
      occurredAt: new Date().toISOString(),
      remark,
    };
    await this.outbox.append({
      eventType: payload.eventType,
      aggregateType: 'Hazard',
      aggregateId: String(hazard.id),
      payload,
    });
  }

  // -------------------------------------------------------------------------
  // 删除
  // -------------------------------------------------------------------------

  /** 删除（软删除）：终态单据只允许管理员删；未办结的必须走驳回 */
  async remove(id: number, user: JwtUser): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Hazard);
      const hazard = await this.findVisibleOrFail(id, user);
      if (hazard.status !== 'ARCHIVED' && hazard.status !== 'REJECTED') {
        throw new ApiException('隐患尚未办结，请先驳回或归档后再删除');
      }
      await repo.softDelete(id);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // 工具
  // -------------------------------------------------------------------------

  /** 生成隐患编号：HZ + yyyyMMdd + 6 位随机（唯一索引兜底） */
  private generateHazardNo(): string {
    const d = new Date();
    const ymd = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('');
    const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    return `HZ${ymd}${rand}`;
  }
}
