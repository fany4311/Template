import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 文件与业务对象的多态绑定（sys_file_link）。
 *
 * 一个文件可被多个业务对象引用（复用/秒传）；一个业务对象可有多个附件，
 * 用 `bizField` 区分用途（如隐患的 `reportPhoto` / `rectifyPhoto`）。
 *
 * **不继承 BaseEntity**：这是纯关联表，解绑用物理删除。
 * 若用软删，`uk_file_link` 会被已解绑的历史行占住，导致「解绑后再绑定」冲突；
 * 「谁在什么时候解绑了哪个文件」已由审计日志（@Auditable）记录，不需要在这里留痕。
 */
@Entity('sys_file_link')
@Index('idx_file_link_biz', ['bizType', 'bizId'])
@Index('uk_file_link', ['fileId', 'bizType', 'bizId', 'bizField'], {
  unique: true,
})
export class FileLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'file_id', type: 'int', comment: '文件 id' })
  fileId: number;

  /** 业务类型（由业务模块向 FileBizRegistry 注册，如 'hazard'） */
  @Column({ name: 'biz_type', length: 64, comment: '业务类型' })
  bizType: string;

  /** 业务对象 id（字符串兼容非自增主键） */
  @Column({ name: 'biz_id', length: 64, comment: '业务对象 id' })
  bizId: string;

  /** 附件用途（同一业务对象的多个附件位，如 cover / photo） */
  @Column({ name: 'biz_field', length: 64, default: '', comment: '附件用途' })
  bizField: string;

  /** 同用途内的排序 */
  @Column({ type: 'int', default: 0, comment: '排序' })
  sort: number;

  @Column({ name: 'create_by', type: 'int', comment: '绑定人' })
  createBy: number;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;
}
