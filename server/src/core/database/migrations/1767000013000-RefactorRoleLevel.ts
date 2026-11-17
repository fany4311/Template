import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 角色编号化：`role_key` → `level`（唯一编号）。
 *
 * 为什么改：
 * - `role_key` 是人可读的字符串标识，但它同时被当成「程序判据」用
 *   （`role.roleKey === 'superadmin'`、e2e 直接用 roleKey 建角色）。
 *   标识一旦被改名，判据就静默失效。
 * - 编号是**稳定且有序**的：越小越核心。内置角色固定占 0–4，
 *   自建角色从 5 起往后排，天然排在后面。
 *
 * 编号分配（与 1767000000000-SeedBuiltinRoles 的 sort 一致）：
 *   0 superadmin 系统管理员 / 1 admin 校级管理员 / 2 manager 部门管理员
 *   3 operator 业务操作员 / 4 auditor 审计员
 *   5+ 自建角色
 *
 * ⚠️ 编号为什么不是数据库 AUTO_INCREMENT：
 *   MySQL 一张表**只允许一个自增列**，而 `id` 已经是自增主键，加不了第二个。
 *   所以编号由应用侧分配（RoleService.allocateLevel：事务内悲观锁 MAX(level)+1），
 *   数据库这层只保证 **NOT NULL + UNIQUE** 兜底。细节见 role.service.ts。
 *
 * ⚠️ 列宽用 smallint 而不是 tinyint：编号既然由应用分配、且要容纳长期
 *   运行中不断新建/删除的角色，tinyint 的无符号上限（127）太紧。语义
 *   （0-4 内置、5+ 自建）不变。
 *
 * ⚠️ 本迁移必须在 1767000012000 之后跑：之前的 seed 都还在用 role_key。
 */
export class RefactorRoleLevel1767000013000 implements MigrationInterface {
  name = 'RefactorRoleLevel1767000013000';

  /** 内置角色的固定编号（越小越核心） */
  private readonly builtinLevels: Array<[string, number]> = [
    ['superadmin', 0],
    ['admin', 1],
    ['manager', 2],
    ['operator', 3],
    ['auditor', 4],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ⚠️ MySQL 的 DDL 会**隐式提交**事务：本迁移一旦中途失败，TypeORM 的
    // ROLLBACK 撤不回已经执行的 ALTER，库里会留下半成品（列已加、migrations
    // 里没记录）。重跑前必须手工把半成品清掉，否则 ADD COLUMN 会报重复列。
    // 排查：SHOW CREATE TABLE sys_role; 然后
    //   ALTER TABLE sys_role DROP INDEX IDX_sys_role_level, DROP COLUMN level;

    // 1) 先加可空列：此时还没有唯一约束，逐条回填不会互相撞
    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        ADD COLUMN \`level\` smallint DEFAULT NULL
          COMMENT '角色编号：0-4 内置（越小越核心），5+ 自建，唯一'
    `);

    // 2) 内置角色钉死编号
    for (const [key, level] of this.builtinLevels) {
      await queryRunner.query(
        `UPDATE \`sys_role\` SET \`level\` = ? WHERE \`role_key\` = ?`,
        [level, key],
      );
    }

    // 3) 其余（自建 / 被改名过而漏掉的内置）按 id 顺序从 5 起排，
    //    保证有确定顺序，避免下面 NOT NULL 时留下 NULL。
    //    ⚠️ @n 必须先赋值：MySQL 里未初始化的用户变量是 NULL，
    //    `NULL + 1` 还是 NULL，后面 MODIFY ... NOT NULL 会直接失败。
    //    queryRunner 复用同一连接，所以变量能跨语句保持。
    await queryRunner.query(`SET @n = 4`);
    await queryRunner.query(`
      UPDATE \`sys_role\`
         SET \`level\` = (@n := @n + 1)
       WHERE \`level\` IS NULL
       ORDER BY \`id\`
    `);

    // 4) 落成 NOT NULL + 唯一（编号的唯一性靠它兜底）
    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        MODIFY COLUMN \`level\` smallint NOT NULL
          COMMENT '角色编号：0-4 内置（越小越核心），5+ 自建，唯一'
    `);
    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        ADD UNIQUE KEY \`IDX_sys_role_level\` (\`level\`)
    `);

    // 5) 删掉 role_key（连带它上面的唯一索引自动消失）
    await queryRunner.query(`
      ALTER TABLE \`sys_role\` DROP COLUMN \`role_key\`
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 反向：把 level 还原成人可读的 role_key，再删列。
    // 自建角色（5+）没有原名可还原，用 role_<level> 兜底 —— 只求可回滚，不求语义等价。
    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        ADD COLUMN \`role_key\` varchar(50) COLLATE utf8mb4_unicode_ci
          DEFAULT NULL COMMENT '角色标识，如 admin'
    `);

    for (const [key, level] of this.builtinLevels) {
      await queryRunner.query(
        `UPDATE \`sys_role\` SET \`role_key\` = ? WHERE \`level\` = ?`,
        [key, level],
      );
    }
    await queryRunner.query(`
      UPDATE \`sys_role\` SET \`role_key\` = CONCAT('role_', \`level\`)
       WHERE \`role_key\` IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        MODIFY COLUMN \`role_key\` varchar(50) COLLATE utf8mb4_unicode_ci
          NOT NULL COMMENT '角色标识，如 admin'
    `);
    await queryRunner.query(`
      ALTER TABLE \`sys_role\`
        ADD UNIQUE KEY \`IDX_2320bd906a4f61ac7ddcb645cd\` (\`role_key\`)
    `);

    await queryRunner.query(`
      ALTER TABLE \`sys_role\` DROP INDEX \`IDX_sys_role_level\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`sys_role\` DROP COLUMN \`level\`
    `);
  }
}
