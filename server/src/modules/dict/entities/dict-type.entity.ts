import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 字典类型实体（sys_dict_type 表）。
 *
 * 约定：
 * - dictType 为业务侧引用的唯一标识（如 sys_user_sex），全局唯一
 * - 删除类型时级联软删该类型下所有字典数据（见 DictService.removeType）
 */
@Entity('sys_dict_type')
export class DictType extends BaseEntity {
  @Column({ name: 'dict_name', length: 100, comment: '字典名称' })
  dictName: string;

  @Column({
    name: 'dict_type',
    length: 100,
    unique: true,
    comment: '字典类型标识，如 sys_user_sex',
  })
  dictType: string;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;

  @Column({ length: 255, default: '', comment: '备注' })
  remark: string;
}
