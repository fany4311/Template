import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 参数配置实体（sys_config 表）。
 *
 * 约定：
 * - configKey 全局唯一，业务代码通过 ConfigService.getValue(key) 读取
 * - configType：'Y' 系统内置（不可删除，值可改）/ 'N' 普通（可增删改）
 * - 值为文本存储，业务侧自行按需解析（JSON/数字/布尔等）
 */
@Entity('sys_config')
// 唯一键含 delete_time：软删的参数键可以被重新创建（否则删过一次就永远建不回来）
@Index('uk_config_key', ['configKey', 'deleteTime'], { unique: true })
export class Config extends BaseEntity {
  @Column({ name: 'config_name', length: 100, comment: '参数名称' })
  configName: string;

  @Column({
    name: 'config_key',
    length: 100,
    comment: '参数键，如 sys.user.initPassword',
  })
  configKey: string;

  @Column({ name: 'config_value', type: 'text', comment: '参数值' })
  configValue: string;

  @Column({
    name: 'config_type',
    type: 'varchar',
    length: 1,
    default: 'N',
    comment: '是否系统内置：Y内置不可删 / N可编辑',
  })
  configType: string;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;

  @Column({ length: 255, default: '', comment: '备注' })
  remark: string;
}
