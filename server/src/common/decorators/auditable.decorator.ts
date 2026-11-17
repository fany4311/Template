import { SetMetadata } from '@nestjs/common';
import { AUDIT_KEY } from '../constants/decorator.constant.js';

/**
 * 审计元数据：标注哪些接口需要写入审计日志（由 AuditInterceptor 处理）。
 * 审计是**独立管道**：经事件异步落库，不占用业务事务，也不影响业务结果。
 *
 * 用法：
 *   @Auditable({ action: 'system:user:add', resourceType: 'user' })
 *   @Auditable({ action: 'system:user:edit', resourceType: 'user', resourceIdParam: 'id' })
 */
export interface AuditMetadata {
  /** 动作标识，建议用权限码风格：域:功能:动作 */
  action: string;
  /** 资源类型，如 user / hazard */
  resourceType?: string;
  /** 从路由参数取资源 id 的参数名，如 'id' */
  resourceIdParam?: string;
}

export const Auditable = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_KEY, metadata);
