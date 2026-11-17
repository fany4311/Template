import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import type { HazardStatus } from '../hazard.state.js';

/** 隐患可见范围 */
export type HazardScope =
  /** 本部门闭环：仅上报人 + 主责部门可见 */
  | 'DEPT'
  /** 多部门协同：主责部门 + 协办部门均可见、可整改 */
  | 'OPEN'
  /** 全校通报（预留） */
  | 'SCHOOL';

/**
 * 隐患单（biz_hazard）—— 第一个业务闭环的聚合根。
 *
 * 与底座的关系（底座本身不含任何业务名词）：
 * - 权限入口：@RequiresPermissions（RBAC 权限码）
 * - 资源动作：@CheckPolicies（CASL，action=accept/rectify/review/archive）
 * - 可见性  ：DataScopeService（角色 dataScope）+ 协办部门并集
 * - 一致性  ：txHost.withTransaction（状态 + 流转日志 + Outbox 事件同事务）
 * - 可靠投递：Outbox（省平台适配器消费）
 *
 * 字段设计要点：
 * - status 只能由 HazardService 经状态机修改（hazard.state.ts）
 * - assignee_dept_id（主责）+ cooperate_dept_ids（协办）共同决定可见性
 * - reporter_dept_id 冗余存上报时部门快照：上报人调岗不影响历史单据归属
 */
@Entity('biz_hazard')
@Index('idx_hazard_status', ['status'])
@Index('idx_hazard_assignee', ['assigneeDeptId'])
@Index('idx_hazard_reporter', ['reporterId'])
export class Hazard extends BaseEntity {
  @Column({
    name: 'hazard_no',
    length: 32,
    unique: true,
    comment: '隐患编号，如 HZ20260210123000123',
  })
  hazardNo: string;

  @Column({ length: 200, comment: '隐患标题' })
  title: string;

  @Column({ type: 'text', comment: '隐患描述' })
  content: string;

  @Column({ length: 255, default: '', comment: '发生地点' })
  location: string;

  @Column({ length: 32, default: '', comment: '隐患类别（字典 hazard_category）' })
  category: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'LOW',
    comment: '隐患等级 LOW/MEDIUM/HIGH/URGENT（字典 hazard_level）',
  })
  level: string;

  @Column({
    type: 'varchar',
    length: 16,
    default: 'DEPT',
    comment: '可见范围 DEPT 本部门 / OPEN 多部门协同 / SCHOOL 全校',
  })
  scope: HazardScope;

  @Column({ type: 'varchar', length: 20, default: 'REPORTED', comment: '状态' })
  status: HazardStatus;

  // ---------------- 责任归属 ----------------

  @Column({ name: 'reporter_id', type: 'int', comment: '上报人' })
  reporterId: number;

  @Column({ name: 'reporter_name', length: 50, default: '', comment: '上报人快照' })
  reporterName: string;

  @Column({ name: 'reporter_dept_id', type: 'int', nullable: true, comment: '上报时部门快照' })
  reporterDeptId?: number | null;

  @Column({
    name: 'assignee_dept_id',
    type: 'int',
    nullable: true,
    comment: '主责部门（受理时确定，默认上报人部门）',
  })
  assigneeDeptId?: number | null;

  /** 协办部门 id 数组；多部门协同的核心字段 */
  @Column({
    name: 'cooperate_dept_ids',
    type: 'json',
    nullable: true,
    comment: '协办部门 id 数组',
  })
  cooperateDeptIds: number[] = [];

  @Column({ name: 'handler_id', type: 'int', nullable: true, comment: '当前处理人' })
  handlerId?: number | null;

  @Column({ name: 'handler_name', length: 50, default: '', comment: '当前处理人快照' })
  handlerName: string;

  // ---------------- 时限（一单四制的"限时办结"） ----------------

  @Column({
    name: 'deadline_at',
    type: 'datetime',
    nullable: true,
    comment: '受理期限（上报后 N 小时）',
  })
  deadlineAt?: Date | null;

  @Column({
    name: 'rectify_deadline',
    type: 'datetime',
    nullable: true,
    comment: '整改期限（受理时确定）',
  })
  rectifyDeadline?: Date | null;

  // ---------------- 整改 ----------------

  @Column({ name: 'rectify_measure', type: 'text', nullable: true, comment: '整改措施' })
  rectifyMeasure?: string | null;

  @Column({ name: 'rectify_time', type: 'datetime', nullable: true, comment: '整改完成时间' })
  rectifyTime?: Date | null;

  // ---------------- 复查 ----------------

  @Column({ name: 'review_opinion', length: 500, default: '', comment: '复查意见' })
  reviewOpinion: string;

  @Column({ name: 'reviewer_id', type: 'int', nullable: true, comment: '复查人' })
  reviewerId?: number | null;

  @Column({ name: 'review_time', type: 'datetime', nullable: true, comment: '复查时间' })
  reviewTime?: Date | null;

  // ---------------- 归档 ----------------

  @Column({ name: 'archive_opinion', length: 500, default: '', comment: '归档意见' })
  archiveOpinion: string;

  @Column({ name: 'archiver_id', type: 'int', nullable: true, comment: '归档人' })
  archiverId?: number | null;

  @Column({ name: 'archive_time', type: 'datetime', nullable: true, comment: '归档时间' })
  archiveTime?: Date | null;

  // ---------------- 驳回 ----------------

  @Column({ name: 'reject_reason', length: 500, default: '', comment: '驳回原因' })
  rejectReason: string;
}
