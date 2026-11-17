import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type SyncStatus = 'SUCCESS' | 'FAILED';

/**
 * 省平台同步记录（biz_hazard_sync）。
 *
 * 为什么单独建表（而不是只看 sys_outbox）：
 * - sys_outbox 记录的是**内部**事件投递（是否被消费）
 * - 本表记录的是**对外**同步结果（省平台返回了什么、失败原因、重试次数）
 * 二者语义不同：outbox 投递成功 ≠ 省平台受理成功。分开才能在对接出问题时定位。
 *
 * 当前省平台 API 未提供（对接方"湖南手拉手技术"），适配器为 Mock 实现，
 * 故 status 恒为 SUCCESS、response_body 为模拟回执。真接口到位后只需替换
 * ProvinceSyncPort 的实现，本表结构不变。
 */
@Entity('biz_hazard_sync')
@Index('idx_hazard_sync_hazard', ['hazardId'])
export class HazardSync {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'hazard_id', type: 'int' })
  hazardId: number;

  @Column({ name: 'hazard_no', length: 32 })
  hazardNo: string;

  /** 事件唯一标识（幂等键；Outbox 至少一次投递，同一事件重复投递只落一条） */
  @Column({ name: 'event_id', length: 36, unique: true })
  eventId: string;

  /** 触发本次同步的事件类型，如 hazard.reported */
  @Column({ name: 'event_type', length: 64 })
  eventType: string;

  /** 同步后的目标状态（供展示/排查，不作为幂等键） */
  @Column({ name: 'to_status', type: 'varchar', length: 20 })
  toStatus: string;

  @Column({
    name: 'direction',
    type: 'varchar',
    length: 8,
    default: 'PUSH',
    comment: 'PUSH 上行 / PULL 下行',
  })
  direction: 'PUSH' | 'PULL';

  @Column({ type: 'varchar', length: 16, default: 'SUCCESS' })
  status: SyncStatus;

  @Column({ name: 'request_body', type: 'json', nullable: true })
  requestBody?: Record<string, any> | null;

  @Column({ name: 'response_body', type: 'json', nullable: true })
  responseBody?: Record<string, any> | null;

  @Column({ length: 500, default: '', comment: '失败原因' })
  error: string;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'target', length: 100, default: '', comment: '目标系统标识' })
  target: string;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;
}
