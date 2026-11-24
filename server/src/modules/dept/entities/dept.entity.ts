import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 部门（sys_dept）：树形组织结构，用于数据范围（dataScope）判定。
 * ancestors 存祖先路径（如 "0,1,5"），便于"本部门及以下"快速查询。
 */
@Entity('sys_dept')
@Index('idx_dept_parent', ['parentId'])
export class Dept extends BaseEntity {
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId?: number | null;

  @Column({ length: 64 })
  name: string;

  /** 祖先 id 路径，逗号分隔，根为 '0' */
  @Column({ length: 500, default: '0' })
  ancestors: string;

  @Column({ default: 0, comment: '排序' })
  sort: number;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;
}
