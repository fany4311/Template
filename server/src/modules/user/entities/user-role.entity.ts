import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';
import { Role } from '../../role/entities/role.entity.js';

/**
 * 用户-角色授权（sys_user_role）—— 显式关联实体（替代多对多隐式表）。
 *
 * 支持**临时授权**：expireAt 非空则到期失效（由定时任务回收）。
 * source: direct(直接授予) / temp(临时授权)
 */
@Entity('sys_user_role')
@Index('uk_user_role', ['userId', 'roleId'], { unique: true })
export class UserRole extends BaseEntity {
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'role_id', type: 'int' })
  roleId: number;

  /** 到期时间；null = 永久 */
  @Column({ name: 'expire_at', type: 'datetime', nullable: true })
  expireAt: Date | null = null;

  @Column({ type: 'varchar', length: 16, default: 'direct' })
  source: 'direct' | 'temp';

  /** 授权人（userId） */
  @Column({ name: 'granted_by', type: 'int', nullable: true })
  grantedBy?: number;

  @ManyToOne(() => Role, { eager: true })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
