import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { HazardScope } from './hazard.entity.js';
import type { HazardAction, HazardStatus } from '../hazard.state.js';

/**
 * 隐患流转日志（biz_hazard_log）。
 *
 * 只追加不修改：一单四制的"留痕"落点 —— 谁、何时、从什么状态到什么状态、说了什么。
 * 业务流转日志与系统的 sys_audit_log 分工：
 * - biz_hazard_log：面向业务的单据轨迹，前端"流转记录"时间线直接展示
 * - sys_audit_log：面向安全的接口调用审计
 *
 * 故不继承 BaseEntity（无需 update_time / delete_time）。
 */
@Entity('biz_hazard_log')
@Index('idx_hazard_log_hazard', ['hazardId', 'id'])
export class HazardLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'hazard_id', type: 'int' })
  hazardId: number;

  @Column({ type: 'varchar', length: 32 })
  action: HazardAction;

  @Column({ name: 'action_label', length: 32 })
  actionLabel: string;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus?: HazardStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus: HazardStatus;

  @Column({ name: 'operator_id', type: 'int' })
  operatorId: number;

  @Column({ name: 'operator_name', length: 50, default: '' })
  operatorName: string;

  @Column({ name: 'dept_id', type: 'int', nullable: true })
  deptId?: number | null;

  /** 本次流转说明：整改措施 / 复查意见 / 驳回原因 */
  @Column({ type: 'varchar', length: 500, default: '' })
  remark: string;

  /** 冗余快照：便于日志长期留存（业务表可能被清理） */
  @Column({ name: 'hazard_no', length: 32, default: '' })
  hazardNo: string;

  @Column({ name: 'scope', type: 'varchar', length: 16, default: 'DEPT' })
  scope: HazardScope;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;
}
