import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 菜单重组：把「操作日志 / 登录日志 / 系统监控」收进「日志与监控」篮子，文件管理提为顶层。
 *
 * 只改菜单树（parent_id / ancestors / path / sort），**不动任何权限码**：
 * 角色授权按权限码走，挪位置不改变谁能看。
 *
 * 幂等：篮子不存在才插；子项按 path 定位，不存在自然跳过（精简部署可能没装日志/监控）。
 */
export class GroupMenus1767000022000 implements MigrationInterface {
  name = 'GroupMenus1767000022000';

  private async idOf(
    queryRunner: QueryRunner,
    path: string,
    type?: string,
  ): Promise<number | null> {
    const sql = type
      ? 'SELECT id FROM sys_menu WHERE path = ? AND type = ? LIMIT 1'
      : 'SELECT id FROM sys_menu WHERE path = ? LIMIT 1';
    const rows: Array<{ id: number }> = await queryRunner.query(
      sql,
      type ? [path, type] : [path],
    );
    return rows[0]?.id ?? null;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 新篮子：日志与监控（排在系统管理、隐患闭环之后）
    await queryRunner.query(
      [
        'INSERT INTO sys_menu (parent_id, name, type, path, component, perms, icon, sort, visible, status, ancestors)',
        "SELECT NULL, '日志与监控', 'M', '/monitor', '', '', 'Monitor', 3, 1, 1, '0'",
        "WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE path = '/monitor')",
      ].join('\n'),
    );
    const monitorId = await this.idOf(queryRunner, '/monitor', 'M');
    if (!monitorId) return;

    // 2) 三个子项挂到新篮子，path 一并迁到 /monitor/*
    const moves: Array<{ from: string; to: string; sort: number }> = [
      { from: '/system/audit', to: '/monitor/audit', sort: 1 },
      { from: '/system/loginlog', to: '/monitor/loginlog', sort: 2 },
      { from: '/system/ops', to: '/monitor/ops', sort: 3 },
    ];
    for (const move of moves) {
      await queryRunner.query(
        'UPDATE sys_menu SET parent_id = ?, ancestors = ?, path = ?, sort = ? WHERE path = ?',
        [monitorId, '0,' + monitorId, move.to, move.sort, move.from],
      );
    }

    // 3) 文件管理提为顶层（path 不变，仍是 /file）
    await queryRunner.query(
      "UPDATE sys_menu SET parent_id = NULL, ancestors = '0', sort = 4 WHERE path = '/file' AND type = 'M'",
    );
    const fileId = await this.idOf(queryRunner, '/file', 'M');
    if (fileId) {
      await queryRunner.query(
        'UPDATE sys_menu SET ancestors = ? WHERE parent_id = ?',
        ['0,' + fileId, fileId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const systemId = await this.idOf(queryRunner, '/system', 'M');
    const monitorId = await this.idOf(queryRunner, '/monitor', 'M');

    if (systemId) {
      const back: Array<{ to: string; from: string; sort: number }> = [
        { from: '/monitor/audit', to: '/system/audit', sort: 7 },
        { from: '/monitor/loginlog', to: '/system/loginlog', sort: 8 },
        { from: '/monitor/ops', to: '/system/ops', sort: 9 },
      ];
      for (const move of back) {
        await queryRunner.query(
          'UPDATE sys_menu SET parent_id = ?, ancestors = ?, path = ?, sort = ? WHERE path = ?',
          [systemId, '0,' + systemId, move.to, move.sort, move.from],
        );
      }

      await queryRunner.query(
        "UPDATE sys_menu SET parent_id = ?, ancestors = ?, sort = 9 WHERE path = '/file' AND type = 'M'",
        [systemId, '0,' + systemId],
      );
      const fileId = await this.idOf(queryRunner, '/file', 'M');
      if (fileId) {
        await queryRunner.query(
          'UPDATE sys_menu SET ancestors = ? WHERE parent_id = ?',
          ['0,' + systemId + ',' + fileId, fileId],
        );
      }
    }

    if (monitorId) {
      await queryRunner.query("DELETE FROM sys_menu WHERE path = '/monitor'");
    }
  }
}
