import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 角色 ↔ 自定义部门（`sys_role_dept`）。
 *
 * 只在角色的 `dataScope = CUSTOM` 时有意义：表示"这个角色能看的部门集合"。
 * 其它数据范围（ALL / DEPT / DEPT_AND_CHILD / SELF）不读这张表，
 * 但**不清空**已有数据 —— 用户把范围临时改回 DEPT 再看回来，不该丢配置。
 *
 * 为什么是独立关联表而不是 `sys_role.dept_ids` JSON 列：
 * - 以后要按部门反查"哪些角色能看它"（组织调整时很常见），JSON 列做不到索引；
 * - 部门被删时能靠外键语义（哪怕逻辑外键）清理，JSON 里留脏 id 无从发现。
 */
@Entity('sys_role_dept')
@Unique('UQ_role_dept', ['roleId', 'deptId'])
@Index('IDX_role_dept_role', ['roleId'])
export class RoleDept extends BaseEntity {
  @Column({ name: 'role_id', type: 'int', comment: '角色 id' })
  roleId: number;

  @Column({ name: 'dept_id', type: 'int', comment: '部门 id' })
  deptId: number;
}
