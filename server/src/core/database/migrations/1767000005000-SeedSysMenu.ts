import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 系统管理域菜单种子。
 *
 * 说明：
 * - 使用固定主键（1..9）+ INSERT IGNORE，保证重复执行安全、且不覆盖管理员后续修改。
 * - ancestors 与 parent_id 手工对齐（顶级为 '0'，子级为 '0,1'）。
 * - 菜单是「通用管理域」的基础设施：前端路由由 /menu/routes 动态注册，
 *   组件路径相对 src/views（不带 .vue 后缀）。
 * - 业务模块接入时按同样格式追加自己的菜单（M/C/F 三级）。
 */
export class SeedSysMenu1767000005000 implements MigrationInterface {
  name = 'SeedSysMenu1767000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT IGNORE INTO sys_menu
        (id, parent_id, name, type, path, component, perms, icon, sort, visible, status, ancestors)
      VALUES
        (1, NULL, '系统管理', 'M', '/system', '', '', 'Setting', 1, 1, 1, '0'),
        (2, 1, '用户管理', 'C', '/system/user', 'system/UserView', 'system:user:list', 'User', 1, 1, 1, '0,1'),
        (3, 1, '角色管理', 'C', '/system/role', 'system/RoleView', 'system:role:list', 'Avatar', 2, 1, 1, '0,1'),
        (4, 1, '部门管理', 'C', '/system/dept', 'system/DeptView', 'system:dept:list', 'OfficeBuilding', 3, 1, 1, '0,1'),
        (5, 1, '菜单管理', 'C', '/system/menu', 'system/MenuView', 'system:menu:list', 'Menu', 4, 1, 1, '0,1'),
        (6, 1, '字典管理', 'C', '/system/dict', 'system/DictView', 'system:dict:list', 'Collection', 5, 1, 1, '0,1'),
        (7, 1, '参数设置', 'C', '/system/config', 'system/ConfigView', 'system:config:list', 'Tools', 6, 1, 1, '0,1'),
        (8, 1, '操作日志', 'C', '/system/audit', 'system/AuditLogView', 'system:auditlog:list', 'Document', 7, 1, 1, '0,1'),
        (9, 1, '登录日志', 'C', '/system/loginlog', 'system/LoginLogView', 'system:loginlog:list', 'Key', 8, 1, 1, '0,1')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM sys_menu WHERE id BETWEEN 1 AND 9`);
  }
}
