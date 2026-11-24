import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 用户实体（sys_user 表）。
 * - 密码列 select:false → 默认查询不返回，需用 addSelect 显式取（登录场景）
 * - 部门 deptId：数据范围（dataScope）依据；调岗只改此字段
 * - 岗位 post：预设字段（不做独立概念）
 * - 角色走显式关联表 sys_user_role（支持临时授权），见 UserRole
 *
 * 唯一键**包含 delete_time**：软删行仍然物理存在，若唯一键只含 username，
 * 删掉一个账号后就再也建不出同名账号（insert 撞 1062，而 `findOneBy` 因软删过滤
 * 查不到它 → 界面只报「数据库操作失败」）。MySQL 唯一索引里 NULL 不冲突，
 * 所以「活行唯一、墓碑行可重复」正好是想要的效果。同款写法见 `sys_file`。
 */
@Entity('sys_user')
@Index('uk_user_username', ['username', 'deleteTime'], { unique: true })
@Index('idx_user_dept', ['deptId'])
export class User extends BaseEntity {
  @Column({ length: 50, comment: '登录账号' })
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
