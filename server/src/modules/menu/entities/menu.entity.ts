import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/** 菜单类型：M=目录 C=菜单 F=按钮 */
export const MENU_TYPES = ['M', 'C', 'F'] as const;
export type MenuType = (typeof MENU_TYPES)[number];

/**
 * 菜单（sys_menu）：前端动态路由 + 按钮权限码的载体。
 * ancestors 存祖先路径（如 "0,1,3"），便于父子关系与级联维护。
 *
 * 注意：type/visible/status 这类有限取值列显式声明 type，避免 TypeORM 推断失败。
 */
@Entity('sys_menu')
export class Menu extends BaseEntity {
  @Column({ name: 'parent_id', type: 'int', nullable: true })
  parentId: number | null;

  @Column({ length: 50, comment: '菜单名称' })
  name: string;

  /** 类型：M=目录 C=菜单 F=按钮（联合取值，必须显式 varchar） */
  @Column({ name: 'type', type: 'varchar', length: 1, comment: 'M目录 C菜单 F按钮' })
  type: MenuType;

  @Column({ length: 200, default: '', comment: '路由地址' })
  path: string;

  @Column({ length: 255, default: '', comment: '前端组件路径' })
  component: string;

  @Column({ length: 100, default: '', comment: '权限码' })
  perms: string;

  @Column({ length: 64, default: '', comment: '图标' })
  icon: string;

  @Column({ default: 0, comment: '排序' })
  sort: number;

  @Column({ default: 1, comment: '是否显示：1显示 0隐藏' })
  visible: number;

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;

  /** 祖先 id 路径，逗号分隔，根为 '0' */
  @Column({ length: 500, default: '0', comment: '祖先路径' })
  ancestors: string;
}
