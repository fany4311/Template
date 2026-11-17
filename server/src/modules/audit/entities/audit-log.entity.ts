import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 审计日志表（sys_audit_log）—— append-only，独立于业务事务。
 *
 * 设计要点：
 * - 不继承 BaseEntity：审计记录不可修改/软删。
 * - 关键查询维度建索引：actor_id / action / create_time（留存≥3 年，后续按月分区）。
 * - 大表清理/归档由独立保留策略任务负责（见 roadmap「数据生命周期」）。
 */
@Entity('sys_audit_log')
@Index('idx_audit_actor', ['actorId'])
@Index('idx_audit_action', ['action'])
@Index('idx_audit_create_time', ['createTime'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'trace_id', length: 64, nullable: true })
  traceId?: string;

  @Column({ name: 'actor_id', type: 'int', nullable: true })
  actorId?: number;

  @Column({ name: 'actor_name', length: 64, nullable: true })
  actorName?: string;

  @Column({ length: 64 })
  action: string;

  @Column({ name: 'resource_type', length: 64, nullable: true })
  resourceType?: string;

  @Column({ name: 'resource_id', length: 64, nullable: true })
  resourceId?: string;

  @Column({ length: 8 })
  result: 'success' | 'fail';

  @Column({ name: 'error_code', length: 64, nullable: true })
  errorCode?: string;

  @Column({ name: 'http_method', length: 8 })
  method: string;

  @Column({ length: 255 })
  path: string;

  @Column({ length: 45, nullable: true })
  ip?: string;

  @Column({ name: 'user_agent', length: 255, nullable: true })
  userAgent?: string;

  @Column({ type: 'json', nullable: true })
  detail?: Record<string, unknown>;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs?: number;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;
}
