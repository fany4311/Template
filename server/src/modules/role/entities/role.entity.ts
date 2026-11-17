import { Column, Entity } from 'typeorm';
import type { AbilityRule } from '../../../common/authz/ability.types.js';
import type { DataScope } from '../../../common/enums/data-scope.enum.js';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 角色实体（sys_role 表）。
 * RBAC 核心变化：权限码从"用户身上"挪到"角色身上"，
 * 用户通过 sys_user_role 中间表挂角色 → 继承角色权限。
 *
 * 约定：
 * - permissions 含 '*:*:*' 视为业务全权（RbacGuard 放行一切）
 * - level 是角色的**稳定标识**（role_key 已废弃删除）：0–4 是内置角色，越小越核心，
 *   5+ 为自建角色，由 _RoleService.create_ 在事务内分配。代码/前端一律用 level 判身份，
 *   不要用 roleName（可改）或 permissions（可编）。
 * - isBuiltin 是**内置标记**：内置角色不可删除（level 0 的超管另有一层「不可改权限」的锁）。
 */
@Entity('sys_role')
export class Role extends BaseEntity {
  /**
   * 角色编号：0-4 内置（越小越核心），5+ 自建，唯一。
   *
   * ⚠️ 不是数据库 AUTO_INCREMENT —— MySQL 一张表只允许一个自增列，`id` 已占用。
   * 编号由 **RoleService.create 在事务内分配**（悲观锁 + MAX(level)+1），
   * 数据库这层只保证 NOT NULL + UNIQUE 兜底。
   *
   * 语义只保留「编号/优先级」（越小越核心）：**是不是内置角色看 `isBuiltin`**，
   * 不要再用 `level <= 4` 去推断。
   *
   * `update: false`：编号是身份，分配后不允许改（改身份 = 改权限归属，太危险）。
   * 注意后果：**任何**绕过 RoleService 直接 `repo.save(Role)` 的地方都必须自己
   * 给出 level，否则会撞 NOT NULL 约束。
   */
  @Column({
    type: 'smallint',
    unique: true,
    update: false,
    comment: '角色编号：0-4 内置（越小越核心），5+ 自建，唯一',
  })
  level: number;

  @Column({ length: 50, name: 'role_name', comment: '角色名称，如 管理员' })
  roleName: string;

  /**
   * 是否内置角色：1 是 / 0 否。**内置角色不可删除**。
   *
   * 为什么要有这个字段（而不是靠 `level <= 4` 推断）：范围约定会在「加第 6 个
   * 内置角色」的当天失效。成熟系统一律用显式布尔标记（JumpServer `builtin`、
   * LobeChat `is_system`、spfn `is_builtin` + `priority`）。
   *
   * `insert: false` + `update: false`：该列**只由迁移/seed 通过原生 SQL 维护**，
   * 任何业务代码（含绕过 RoleService 直接 `repo.save`）都改不动它。
   * 后果：`repo.create({ isBuiltin: 1 })` 会被静默忽略（落库取数据库默认值 0），
   * 这是刻意的 fail-safe —— 宁可少一个内置标记，也不能让接口随意造出「不可删角色」。
   */
  @Column({
    name: 'is_builtin',
    type: 'tinyint',
    default: 0,
    insert: false,
    update: false,
    comment: '内置角色：1是 0否（内置不可删）',
  })
  isBuiltin: number;

  /** 权限码列表：['content:list']；'*:*:*' = 超管 */
  @Column('simple-array', { nullable: true, comment: '权限码列表' })
  permissions: string[] = [];

  /** CASL 规则（支持 conditions 实现 ABAC/ReBAC-lite） */
  @Column({ type: 'json', nullable: true, comment: 'CASL 规则' })
  rules?: AbilityRule[];

  /** 数据范围：决定该角色能看到的数据范围（放角色、不绑部门） */
  @Column({ name: 'data_scope', type: 'varchar', length: 20, default: 'SELF' })
  dataScope: DataScope = 'SELF';

  @Column({ default: 1, comment: '状态：1正常 0禁用' })
  status: number;
}
