import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 文件模块接入配置：菜单 + 权限码。
 *
 * 角色授权**不需要在此处理**：
 * - `superadmin` 是 `system:*` → 已覆盖 `system:file:*`
 * - `admin` 是 `*:*:*,!system:*` → 已覆盖 `system:file:*`
 * 其余角色不配文件管理权限（上传/下载是登录用户的基础能力，不靠权限码控制，
 * 而是由「归属 + 业务访问判定」决定，见 FileService.assertCanRead）。
 *
 * ⚠️ 上面两行是当时的实际数据。决策 B 之后超管改为纯通配 `*:*:*`，依旧覆盖
 * `system:file:*`，结论不变；只是理由从「`system:*` 前缀」换成「通配」。
 *
 * 菜单按业务唯一键（path / perms）解析，不硬编码主键 —— 与隐患模块一致，
 * 避免运维在库中新增过菜单后主键撞车。
 */
export class SeedFileSetup1767000010000 implements MigrationInterface {
  name = 'SeedFileSetup1767000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const parentId = await this.ensureMenu(queryRunner, {
      name: '文件管理',
      type: 'M',
      path: '/file',
      component: '',
      perms: '',
      icon: 'FolderOpened',
      sort: 9,
      parentId: null,
      ancestors: '0',
    });

    await this.ensureMenu(queryRunner, {
      name: '文件列表',
      type: 'C',
      path: '/file/list',
      component: 'system/FileView',
      perms: 'system:file:list',
      icon: 'Document',
      sort: 1,
      parentId,
      ancestors: `0,${parentId}`,
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM sys_menu WHERE perms = 'system:file:list' AND path = '/file/list'`,
    );
    await queryRunner.query(
      `DELETE FROM sys_menu WHERE type = 'M' AND path = '/file'`,
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
    return result.insertId;
  }
}
