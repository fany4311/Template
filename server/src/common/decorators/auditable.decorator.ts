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
  /**
   * 是否记录入参摘要（默认 `'body'`）。
   *
   * 为什么默认记：只记「谁在何时调了什么」时，事后无法回答
   * 「他把哪条数据的哪一列改成了什么」—— 等保的「操作内容可追溯」要的就是这个。
   * 密码/密钥类字段由拦截器**统一脱敏**（见 AuditInterceptor.sanitize），
   * 不需要每个接口自己记得排除。
   *
   * 设为 `false` 用于大体积/无意义的写入（如文件上传的二进制字段）。
   */
  capture?: 'body' | false;
}

export const Auditable = (metadata: AuditMetadata) =>
  SetMetadata(AUDIT_KEY, metadata);
