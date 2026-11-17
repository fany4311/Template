/**
 * Outbox 事件载荷与处理器接口。
 * 业务在事务内 append，由 OutboxPublisher 可靠投递（至少一次），
 * 用于跨聚合一致性（如"用户创建后"发通知）与省平台同步的可靠投递底座。
 */
export interface OutboxAppend {
  /** 事件类型，建议 `聚合.动作`，如 `user.created` / `hazard.reported` */
  eventType: string;
  /** 事件体（会被 JSON 序列化） */
  payload: Record<string, any>;
  aggregateType?: string;
  aggregateId?: string;
  /** 可投递时间（默认立即）；用于延迟重试 */
  availableAt?: Date;
}

export interface OutboxHandler {
  handle(payload: Record<string, any>): Promise<void>;
}
