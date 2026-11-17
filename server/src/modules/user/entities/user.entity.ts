import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 用户实体（sys_user 表）。
 * - 密码列 select:false → 默认查询不返回，需用 addSelect 显式取（登录场景）
 * - 部门 deptId：数据范围（dataScope）依据；调岗只改此字段
 * - 岗位 post：预设字段（不做独立概念）
 * - 角色走显式关联表 sys_user_role（支持临时授权），见 UserRole
 */
@Entity('sys_user')
export class User extends BaseEntity {
  @Column({ unique: true, length: 50, comment: '登录账号' })
  username: string;

  @Column({ length: 100, select: false, comment: '密码(argon2)' })
  password: string;

  @Column({ length: 50, default: '', comment: '昵称' })
  nickname: string;

  @Column({ length: 100, default: '', comment: '邮箱' })
  email: string;

  @Column({ length: 20, default: '', comment: '手机号' })
  phone: string;

  @Column({ name: 'dept_id', type: 'int', nullable: true, comment: '所属部门' })
  deptId?: number;

  @Column({ length: 64, default: '', comment: '岗位（预设字段）' })
  post: string;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;
}
