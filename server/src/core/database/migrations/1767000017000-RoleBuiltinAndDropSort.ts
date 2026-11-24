import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 角色模型收口：新增「内置角色」显式标记，删除冗余的 `sort`。
 *
 * ## 为什么加 `is_builtin`
 * 原先"是不是内置角色"靠**隐式约定**「level ≤ 4」推断（`BUILTIN_MAX_LEVEL`）。
 * 这是范围约定，不是数据：将来要加第 6 个内置角色，就得重排编号，或者默认
 * 「5 也是内置」——约定当天就破。
 *
 * 成熟系统一律用**显式布尔标记**：
 * - JumpServer `Role.builtin`
 * - LobeChat `roles.is_system`
 * - spfn/auth `is_builtin` + `is_system`（另有 `priority` 整数，正对应我们的 level）
 * - PostgreSQL RBAC 设计惯例 `is_system BOOLEAN NOT NULL DEFAULT FALSE`
 *
 * 于是 `level` 只留「编号/优先级」一层语义，「内置」由数据说话。
 *
 * ## 为什么删 `sort`
 * `level` 已经承担顺序语义（越小越核心、内置固定 0–4、自建从 5 起递增）。
 * 列表按 `level` 排序，`sort` 剩下的唯一自由度就是「把 level 4 排到 level 0 前面」——
 * 直接否定 level 的语义；而界面又提供 `sort` 输入框，改了却不生效，属于**界面骗人**。
 * 参照：RuoYi 同时有 `role_id`(身份) + `role_sort`(排序) 是因为它**没有** level 这种编号；
 * 我们两者语义重叠，只保留 level。
 *
 * ## 回填基线（幂等）
 * `UPDATE ... WHERE level <= 4`：内置角色固定占 0–4，自建角色由
 * `RoleService.allocateLevel()` 从 5 起分配，**永远不会**落进这个区间，
 * 所以该语句可重复执行、不会误伤自建角色。
 *
 * ## 为什么号段是 17000（而不是最初的 14000）
 * 本迁移最初写作 `1767000014000`。当时本库被派生项目 Csmu_BigScreen **共用**，
 * 它已在本库执行过自己的 `GrantSuperadminScreen1767000014000` /
 * `SuperadminWildcard1767000015000`。TypeORM 按**类名**判重（不按 timestamp），
 * 于是同号不同名并不冲突；但两套迁移交织在同一张 `migrations` 表里，人工核对时
 * 极易误判哪条跑过、哪条没跑。现已分库，号段整体后移到 17000/18000，
 * 与派生项目的号段彻底脱钩。
 *
 * ## 为什么必须幂等（不是洁癖，是实测踩过）
 * 开发库 `DB_SYNCHRONIZE=true` 时 TypeORM 已经**自行**加过 `is_builtin`、删过 `sort`；
 * 生产库同理。此时裸 `ALTER TABLE ADD COLUMN` 会 `Duplicate column name` 直接失败，
 * 而 DDL 是隐式提交，失败会留下半成品。故所有 DDL 先查 `information_schema` 再决定。
 */
export class RoleBuiltinAndDropSort1767000017000 implements MigrationInterface {
  name = 'RoleBuiltinAndDropSort1767000017000';

  private static readonly TABLE = 'sys_role';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 内置标记（0/1），与 sys_menu.visible、sys_role.status 的写法保持一致
    if (
      !(await queryRunner.hasColumn(
        RoleBuiltinAndDropSort1767000017000.TABLE,
        'is_builtin',
      ))
    ) {
      await queryRunner.query(
        `ALTER TABLE sys_role
           ADD COLUMN is_builtin tinyint(1) NOT NULL DEFAULT 0
           COMMENT '内置角色：1是 0否（内置不可删）'`,
      );
    }

    // 2) 回填基线：内置角色即 level 0-4（理由见类注释，幂等安全）
    await queryRunner.query(
      `UPDATE sys_role SET is_builtin = 1 WHERE level <= 4`,
    );

    // 3) 排序字段下线：顺序语义由 level 独家承担
    if (
      await queryRunner.hasColumn(
        RoleBuiltinAndDropSort1767000017000.TABLE,
        'sort',
      )
    ) {
      await queryRunner.query(`ALTER TABLE sys_role DROP COLUMN sort`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      !(await queryRunner.hasColumn(
        RoleBuiltinAndDropSort1767000017000.TABLE,
        'sort',
      ))
    ) {
      await queryRunner.query(
        `ALTER TABLE sys_role
           ADD COLUMN sort int NOT NULL DEFAULT 0 COMMENT '排序'`,
      );
    }
    if (
      await queryRunner.hasColumn(
        RoleBuiltinAndDropSort1767000017000.TABLE,
        'is_builtin',
      )
    ) {
      await queryRunner.query(`ALTER TABLE sys_role DROP COLUMN is_builtin`);
    }
  }
}
