import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 字典数据实体（sys_dict_data 表）。
 *
 * 约定：
 * - 通过 dictType 与 sys_dict_type 关联（字符串外键，不加数据库约束）
 * - tagType 供前端标签着色使用，空串表示默认样式
 */
@Entity('sys_dict_data')
@Index('idx_dict_data_type', ['dictType'])
export class DictData extends BaseEntity {
  @Column({ name: 'dict_type', length: 100, comment: '所属字典类型标识' })
  dictType: string;

  @Column({ name: 'dict_label', length: 100, comment: '显示名' })
  dictLabel: string;

  @Column({ name: 'dict_value', length: 100, comment: '值' })
  dictValue: string;

  @Column({ name: 'dict_sort', default: 0, comment: '排序' })
  dictSort: number;

  @Column({
    name: 'tag_type',
    length: 20,
    default: '',
    comment: '前端标签类型：success/warning/info/danger，空=默认',
  })
  tagType: string;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;

  @Column({ length: 255, default: '', comment: '备注' })
  remark: string;
}
