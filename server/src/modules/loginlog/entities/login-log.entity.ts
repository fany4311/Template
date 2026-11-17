import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 登录日志表（sys_login_log）—— append-only，只追加不修改。
 *
 * 设计要点：
 * - 不继承 BaseEntity：登录记录没有"更新/软删"语义。
 * - 写入为旁路（登录流程的成功/失败都不能被日志写入影响）。
 * - 常用查询维度建索引：login_time（倒序分页）/ username（按账号排查）。
 */
@Entity('sys_login_log')
@Index('idx_login_log_time', ['loginTime'])
@Index('idx_login_log_username', ['username'])
export class LoginLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ length: 50, comment: '登录账号' })
  username: string;

  @Column({ length: 45, nullable: true, comment: '来源 IP' })
  ip?: string;

  @Column({
    name: 'user_agent',
    length: 255,
    nullable: true,
    comment: '浏览器 UA',
  })
  userAgent?: string;

  @Column({ type: 'int', comment: '1成功 0失败' })
  status: number;

  @Column({ length: 255, nullable: true, comment: '结果说明/失败原因' })
  msg?: string;

  @CreateDateColumn({ name: 'login_time' })
  loginTime: Date;
}
