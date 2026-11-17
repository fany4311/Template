import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Outbox 事件表（sys_outbox）。
 * 业务事务内写入（与业务数据同事务，保证原子），由轮询器可靠投递。
 *
 * status: pending → processing → sent / failed
 */
@Entity('sys_outbox')
@Index('idx_outbox_status_available', ['status', 'availableAt'])
export class OutboxEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'event_type', length: 100 })
  eventType: string;

  @Column({ name: 'aggregate_type', length: 64, nullable: true })
  aggregateType?: string;

  @Column({ name: 'aggregate_id', length: 64, nullable: true })
  aggregateId?: string;

  @Column({ type: 'json' })
  payload: Record<string, any>;

  @Column({ length: 16, default: 'pending' })
  status: 'pending' | 'processing' | 'sent' | 'failed';

  @Column({ type: 'int', default: 0 })
  retries: number;

  @Column({ name: 'last_error', length: 500, nullable: true })
  lastError?: string;

  @Column({
    name: 'available_at',
    type: 'datetime',
    default: () => 'CURRENT_TIMESTAMP',
  })
  availableAt: Date;

  @Column({ name: 'claimed_at', type: 'datetime', nullable: true })
  claimedAt?: Date;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt?: Date;
}
