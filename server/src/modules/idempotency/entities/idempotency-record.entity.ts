import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * 幂等记录表（sys_idempotency）—— DB 持久化，保证多实例一致。
 *
 * key = `${scope}:${userId}:${clientKey}`（业务作用域 + 用户 + 客户端幂等键）
 * status: processing（首次执行中）| done（已完成，可回放响应）
 */
@Entity('sys_idempotency')
@Index('idx_idem_expire', ['expireAt'])
export class IdempotencyRecord {
  @PrimaryColumn({ length: 191 })
  key: string;

  /** 请求内容指纹（method+url+body），用于识别"同 key 不同内容" */
  @Column({ name: 'request_hash', length: 64 })
  requestHash: string;

  @Column({ length: 16, default: 'processing' })
  status: 'processing' | 'done';

  /** 首次请求的响应体（已包装后的最终结构），用于回放 */
  @Column({ name: 'response_body', type: 'json', nullable: true })
  responseBody?: Record<string, any> | null;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @Column({ name: 'expire_at', type: 'datetime' })
  expireAt: Date;
}
