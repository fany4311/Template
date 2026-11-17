import type { MongoAbility } from '@casl/ability';

/**
 * 权限引擎类型（CASL）：
 * - 动作：manage(通配) / create / read / update / delete / export / approve ...
 * - 主体：业务资源名（PascalCase），'all' 为通配
 * 规则可带 conditions 实现 ABAC（属性条件）与 ReBAC-lite（关系条件，如 deptId/ownerId）。
 */
export type AppAction =
  | 'manage'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'export'
  | 'approve'
  | (string & {});

export type AppSubject =
  | 'all'
  | 'User'
  | 'Role'
  | 'Permission'
  | 'Dept'
  | 'Dict'
  | 'AuditLog'
  | 'File'
  | 'Outbox'
  | (string & {});

export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/** 单条授权规则（持久化在 Role.rules） */
export interface AbilityRule {
  action: AppAction;
  subject: AppSubject;
  /** ABAC/ReBAC 条件，如 { deptId: '${user.deptId}' } 或 { ownerId: '${user.userId}' } */
  conditions?: Record<string, any>;
  fields?: string[];
  /** 反向规则（禁止） */
  inverted?: boolean;
}
