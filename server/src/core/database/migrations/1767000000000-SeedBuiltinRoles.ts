import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 内置角色 seed（5 级）。
 *
 * 蒙权分离（自上而下）：
 * - superadmin（系统管理员）：仅 `system:*`，无业务权限；唯一、不可删（RoleService 保护）
 * - admin（校级管理员）：`*:*:*` + `!system:*` → 业务全权，但**不得进入系统管理域**
 * - manager（部门管理员）：DEPT_AND_CHILD 数据范围，业务权限码待业务模块落地后补
 * - operator（业务操作员）：SELF 数据范围
 * - auditor（审计员）：DEPT 数据范围，只读
 *
 * 说明：permissions 为 simple-array，存逗号分隔文本；空数组存空串。
 * 幂等：ON DUPLICATE KEY UPDATE 保证重复执行不报错、不覆盖已改配置。
 *
 * ⚠️ 历史遗迹（不要照抄上面的超管策略）：
 * 本迁移里超管 = `system:*`（刻意不给业务权限）属于**已废弃的蒙权分离**。
 * 现已改为决策 B：超管权限串是**纯通配 `*:*:*`**，身份由 `level === 0` 承担；
 * 收敛动作在 `1767000018000-RoleSuperadminWildcard`。
 * 本文件保持原样（已执行的迁移是不可涂改的账），仅作史证。
 */
export class SeedBuiltinRoles1767000000000 implements MigrationInterface {
  name = 'SeedBuiltinRoles1767000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const roles: Array<{
      key: string;
      name: string;
      permissions: string;
      dataScope: string;
      sort: number;
    }> = [
      {
        key: 'superadmin',
        name: '系统管理员',
        permissions: 'system:*',
        dataScope: 'ALL',
        sort: 1,
      },
      {
        key: 'admin',
        name: '校级管理员',
        permissions: '*:*:*,!system:*',
        dataScope: 'ALL',
        sort: 2,
      },
      {
        key: 'manager',
        name: '部门管理员',
        permissions: '',
        dataScope: 'DEPT_AND_CHILD',
        sort: 3,
      },
      {
        key: 'operator',
        name: '业务操作员',
        permissions: '',
        dataScope: 'SELF',
        sort: 4,
      },
      {
        key: 'auditor',
        name: '审计员',
        permissions: '',
        dataScope: 'DEPT',
        sort: 5,
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO sys_role
           (role_key, role_name, permissions, data_scope, sort, status, create_time, update_time)
         VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE role_key = role_key`,
        [role.key, role.name, role.permissions, role.dataScope, role.sort],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM sys_role
       WHERE role_key IN ('superadmin', 'admin', 'manager', 'operator', 'auditor')`,
    );
  }
}
