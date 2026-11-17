import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 隐患闭环接入配置：内置角色授权 + 字典 + 菜单。
 *
 * 为什么单独一个迁移（不塞进各业务模块）：
 * 权限码、字典、菜单是**接入底座的三件套**，每个新业务模块都要做一遍，
 * 集中在一个迁移里可以照抄。后续新模块复制本文件改内容即可。
 *
 * 角色授权策略（与 docs/权限设计-CASL.md 一致）：
 * - superadmin 不动：`system:*`，**刻意不给业务权限**（系统管理员只管网）
 * - admin      不动：`*:*:*,!system:*` 覆盖全部业务动作（含复查）
 * - manager    部门管理员：受理/整改/驳回（部门级闭环）
 * - operator   业务操作员：上报 + 查看
 * - auditor    审计员：查看 + 归档（**数据范围提升为 ALL**，否则无法归档全校单据）
 *
 * ⚠️ superadmin 那一行已废：决策 B 下超管是纯通配 `*:*:*`（业务也全权），
 * 见 `1767000018000-RoleSuperadminWildcard`。本文件中「superadmin 不动」指的是
 * 本迁移不去改它，并非说它永远只能是 `system:*`。
 *
 * 幂等：仅当 permissions 为空时才写入，避免覆盖运维后续的调整。
 */
export class SeedHazardSetup1767000007000 implements MigrationInterface {
  name = 'SeedHazardSetup1767000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------- 1. 内置角色授权 ----------------

    const roles: Array<{
      key: string;
      permissions: string;
      rules: unknown;
      dataScope?: string;
    }> = [
      {
        key: 'manager',
        permissions: [
          'hazard:report:list',
          'hazard:report:query',
          'hazard:report:accept',
          'hazard:report:reject',
          'hazard:report:rectify',
        ].join(','),
        rules: [
          { action: 'read', subject: 'Hazard' },
          { action: 'accept', subject: 'Hazard' },
          { action: 'reject', subject: 'Hazard' },
          { action: 'rectify', subject: 'Hazard' },
        ],
      },
      {
        key: 'operator',
        permissions: [
          'hazard:report:add',
          'hazard:report:list',
          'hazard:report:query',
        ].join(','),
        rules: [
          { action: 'read', subject: 'Hazard' },
          { action: 'create', subject: 'Hazard' },
        ],
      },
      {
        key: 'auditor',
        permissions: [
          'hazard:report:list',
          'hazard:report:query',
          'hazard:report:archive',
        ].join(','),
        rules: [
          { action: 'read', subject: 'Hazard' },
          { action: 'archive', subject: 'Hazard' },
        ],
        // 审计员要能归档全校单据，数据范围必须是 ALL
        dataScope: 'ALL',
      },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `UPDATE sys_role
            SET permissions = ?, rules = ?, data_scope = COALESCE(?, data_scope), update_time = NOW()
          WHERE role_key = ? AND (permissions IS NULL OR permissions = '')`,
        [
          role.permissions,
          JSON.stringify(role.rules),
          role.dataScope ?? null,
          role.key,
        ],
      );
    }

    // ---------------- 2. 字典 ----------------

    await queryRunner.query(
      `INSERT IGNORE INTO sys_dict_type (dict_name, dict_type, status, remark)
       VALUES ('隐患类别', 'hazard_category', 1, '隐患闭环-类别'),
              ('隐患等级', 'hazard_level', 1, '隐患闭环-等级')`,
    );

    const dictData: Array<[string, string, string, number, string]> = [
      ['hazard_category', '消防安全', 'FIRE', 1, 'danger'],
      ['hazard_category', '交通安全', 'TRAFFIC', 2, 'warning'],
      ['hazard_category', '食品安全', 'FOOD', 3, 'warning'],
      ['hazard_category', '设施设备', 'FACILITY', 4, 'info'],
      ['hazard_category', '治安安全', 'SECURITY', 5, 'danger'],
      ['hazard_category', '其他', 'OTHER', 99, 'info'],
      ['hazard_level', '低风险', 'LOW', 1, 'info'],
      ['hazard_level', '一般隐患', 'MEDIUM', 2, 'warning'],
      ['hazard_level', '较大隐患', 'HIGH', 3, 'danger'],
      ['hazard_level', '重大隐患', 'URGENT', 4, 'danger'],
    ];

    for (const [dictType, label, value, sort, tagType] of dictData) {
      await queryRunner.query(
        `INSERT IGNORE INTO sys_dict_data
           (dict_type, dict_label, dict_value, dict_sort, tag_type, status, remark)
         VALUES (?, ?, ?, ?, ?, 1, '')`,
        [dictType, label, value, sort, tagType],
      );
    }

    // ---------------- 3. 菜单 ----------------
    // 不用固定主键：sys_menu.id 是自增的，且运维可能在库中新增过菜单，
    // 硬编码主键会撞车（真实踩过一次：id=10 已被“用户新增按钮”占用）。
    // 改为按业务唯一键（path / perms）解析，缺失才插入。

    const parentId = await this.ensureMenu(queryRunner, {
      name: '隐患闭环',
      type: 'M',
      path: '/hazard',
      component: '',
      perms: '',
      icon: 'Warning',
      sort: 2,
      parentId: null,
      ancestors: '0',
    });

    await this.ensureMenu(queryRunner, {
      name: '隐患台账',
      type: 'C',
      path: '/hazard/list',
      component: 'hazard/HazardView',
      perms: 'hazard:report:list',
      icon: 'List',
      sort: 1,
      parentId,
      ancestors: `0,${parentId}`,
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 先删子再删父；全部按业务唯一键定位，不碰运维自建的菜单
    await queryRunner.query(
      `DELETE FROM sys_menu WHERE perms = 'hazard:report:list' AND path = '/hazard/list'`,
    );
    await queryRunner.query(
      `DELETE FROM sys_menu WHERE type = 'M' AND path = '/hazard'`,
    );
    await queryRunner.query(
      `DELETE FROM sys_dict_data WHERE dict_type IN ('hazard_category', 'hazard_level')`,
    );
    await queryRunner.query(
      `DELETE FROM sys_dict_type WHERE dict_type IN ('hazard_category', 'hazard_level')`,
    );
    for (const key of ['manager', 'operator', 'auditor']) {
      await queryRunner.query(
        `UPDATE sys_role SET permissions = '', rules = NULL WHERE role_key = ?`,
        [key],
      );
    }
    await queryRunner.query(
      `UPDATE sys_role SET data_scope = 'DEPT' WHERE role_key = 'auditor'`,
    );
  }

  /** 按 path 取菜单 id，不存在则创建（返回 id） */
  private async ensureMenu(
    queryRunner: QueryRunner,
    menu: {
      name: string;
      type: string;
      path: string;
      component: string;
      perms: string;
      icon: string;
      sort: number;
      parentId: number | null;
      ancestors: string;
    },
  ): Promise<number> {
    const found: Array<{ id: number }> = await queryRunner.query(
      'SELECT id FROM sys_menu WHERE path = ? ORDER BY id LIMIT 1',
      [menu.path],
    );
    if (found.length) return found[0].id;

    const result: { insertId: number } = await queryRunner.query(
      `INSERT INTO sys_menu
         (parent_id, name, type, path, component, perms, icon, sort, visible, status, ancestors,
          create_time, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, NOW(), NOW())`,
      [
        menu.parentId,
        menu.name,
        menu.type,
        menu.path,
        menu.component,
        menu.perms,
        menu.icon,
        menu.sort,
        menu.ancestors,
      ],
    );
    return Number(result.insertId);
  }
}
