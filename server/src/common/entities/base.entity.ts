import {
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 实体基类：所有业务实体继承，自动带审计字段。
 * 用法：export class User extends BaseEntity {}
 * 注意：基类不用 @Entity()，字段自动合并到子类表。
 *
 * 字段映射蛇形列名（create_time），与 MySQL 惯例一致。
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @CreateDateColumn({ name: 'create_time' })
  createTime: Date;

  @UpdateDateColumn({ name: 'update_time' })
  updateTime: Date;

  /** 软删除标记：用 repository.softDelete() 触发，查询自动过滤 */
  @DeleteDateColumn({ name: 'delete_time', select: false })
  deleteTime: Date | null;
}
