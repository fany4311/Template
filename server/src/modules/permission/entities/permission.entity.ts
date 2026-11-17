import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity.js';

/**
 * 权限清单（sys_permission 表）：**系统中真实存在的权限码目录**。
 *
 * ## 为什么需要这张表
 * 权限码原先只有一个出处 —— 代码里的 `@RequiresPermissions('system:role:list')`。
 * 但库里的角色权限串（`sys_role.permissions`）是**另一份手抄副本**：
 * 靠迁移 / seed 写、靠界面手输。两份副本没有任何机制保证一致，
 * 于是必然出现：
 * - **幽灵码**：代码里早已改名，角色里还留着旧码 —— 界面看着有权限，实际永不命中；
 * - **拼错码**：`system:role:lst`，看起来完全正常，就是没权限；
 * - 没人能回答"系统一共有哪些权限码"，只能 grep。
 *
 * 本表由 `pnpm authz:sync` **从代码反射生成**，是唯一的权威清单。
 * 角色界面据此渲染「按模块分组树形勾选」，不再允许自由输入。
 *
 * ## 生产原则
 * - `code` 唯一；同步只做 upsert + 停用（`status=0`），**从不物理删除**——
 *   角色里可能还引用着旧码，删了清单就查不到它的来历了。
 * - 本表**不参与鉴权**：`RbacGuard` 永远只看 `sys_role.permissions` 的字符串匹配。
 *   清单只是"元数据/界面数据源"，绝不能变成鉴权的第二个真相源。
 * - 不继承软删除语义的额外列：`status=0` 即"已停用（代码里已不存在）"。
 */
@Entity('sys_permission')
export class SysPermission extends BaseEntity {
  /** 权限码：`域:资源[:动作]`，2–3 段小写标识符，如 `system:role:list` */
  @Column({ length: 64, unique: true, comment: '权限码，如 system:role:list' })
  code: string;

  /** 人类可读名称：取自同方法上的 `@ApiOperation({ summary })` */
  @Column({ length: 100, default: '', comment: '权限名称（取自接口 summary）' })
  name: string;

  /** 分组键：权限码第一段，如 `system` / `hazard` / `console` */
  @Column({ length: 32, comment: '模块键（权限码第一段）' })
  module: string;

  /**
   * 分组显示名：取自所属控制器的 `@ApiTags('角色管理')`。
   * 与 `module` 分开存，是因为同一段下可能有多个控制器、标签各不相同，
   * 界面按 `moduleLabel` 聚合更贴近人的认知。
   */
  @Column({
    name: 'module_label',
    length: 50,
    default: '',
    comment: '模块显示名（取自 @ApiTags）',
  })
  moduleLabel: string;

  /**
   * 状态：1 有效 / 0 已停用。
   * 同步时"代码里找不到" → 置 0（不删除），界面置灰显示并阻止新勾选。
   */
  @Column({ default: 1, comment: '状态：1有效 0已停用（代码中已不存在）' })
  status: number;
}
