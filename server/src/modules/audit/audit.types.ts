/**
 * 审计条目（写入审计管道的载荷）。
 * 采用 append-only 语义：只新增，不修改、不删除。
 */
export interface AuditEntry {
  /** 链路 id（与响应头 X-Trace-Id 一致） */
  traceId?: string;
  /** 操作者 */
  actorId?: number;
  actorName?: string;
  /** 动作，权限码风格：域:功能:动作 */
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** 结果 */
  result: 'success' | 'fail';
  /** 失败时的错误码 */
  errorCode?: string;
  /** 请求信息 */
  method: string;
  path: string;
  ip?: string;
  userAgent?: string;
  /** 附加信息（脱敏后的入参摘要等） */
  detail?: Record<string, unknown>;
  /** 处理耗时（毫秒） */
  durationMs?: number;
}
