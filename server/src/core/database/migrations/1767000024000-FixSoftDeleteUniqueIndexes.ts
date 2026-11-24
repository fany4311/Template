import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 修复「软删 + 单列唯一」互撞：把唯一键扩展到含 `delete_time`。
 *
 * ## 问题
 * `sys_user.username`、`sys_config.config_key`、`sys_dict_type.dict_type`
 * 的唯一索引**只含业务列**，而这三张表都继承软删基类（`delete_time`）。
 * 软删不删物理行，于是：
 *   1. 删掉账号 `zhangsan`（行还在，`delete_time` 非空）；
 *   2. 重建 `zhangsan`：`findOneBy({username})` 因软删过滤**查不到**→ 放行 →
 *      `INSERT` 撞唯一键 → 客户端看到「数据库操作失败」。
 * 实测（2026-11-24）三张表均复现 1062。
 *
 * ## 修法
 * 唯一键改成 `(业务列, delete_time)`。MySQL 的唯一索引里 **NULL 不参与比较**，
 * 所以：活行（`delete_time IS NULL`）仍然唯一，墓碑行可以有无数条同名。
 * 这正是 `sys_file.uk_file_sha_uploader(sha256, uploader_id, delete_time)` 已经在用的写法。
 *
 * ## 为什么不写死索引名
 * `sys_user` 的旧索引名是 TypeORM `unique: true` 生成的哈希名
 * （`IDX_9e7164b2f1ea1348bc0eb0a7da`），派生项目改了实体后哈希会变。
 * 所以这里按 `information_schema` 现场找「只含该单列的唯一索引」再改 —— DDL 幂等。
 */
export class FixSoftDeleteUniqueIndexes1767000024000 implements MigrationInterface {
  name = 'FixSoftDeleteUniqueIndexes1767000024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.replaceSingleUnique(
      queryRunner,
      'sys_user',
      'username',
      'uk_user_username',
    );
    await this.replaceSingleUnique(
      queryRunner,
      'sys_config',
      'config_key',
      'uk_config_key',
    );
    await this.replaceSingleUnique(
      queryRunner,
      'sys_dict_type',
      'dict_type',
      'uk_dict_type',
    );

    // 数据范围（dataScope）按 dept_id 过滤用户，此前无索引 = 全表扫
    await this.ensureIndex(queryRunner, 'sys_user', 'idx_user_dept', [
      'dept_id',
    ]);
    // 部门树按 parent_id 找子节点
    await this.ensureIndex(queryRunner, 'sys_dept', 'idx_dept_parent', [
      'parent_id',
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.restoreSingleUnique(
      queryRunner,
      'sys_user',
      'username',
      'uk_user_username',
    );
    await this.restoreSingleUnique(
      queryRunner,
      'sys_config',
      'config_key',
      'uk_config_key',
    );
    await this.restoreSingleUnique(
      queryRunner,
      'sys_dict_type',
      'dict_type',
      'uk_dict_type',
    );
    await this.dropIndexIfExists(queryRunner, 'sys_user', 'idx_user_dept');
    await this.dropIndexIfExists(queryRunner, 'sys_dept', 'idx_dept_parent');
  }

  // -------------------------------------------------------------------------

  /**
   * 把 `table(column)` 的单列唯一索引换成 `table(column, delete_time)`。
   *
   * 幂等要点：
   * - 目标索引**已经是对的列组合** → 只清理其他单列唯一，不重建（重跑安全）；
   * - 目标索引**同名但列不对**（`sys_config.uk_config_key` / `sys_dict_type.uk_dict_type`
   *   就是这样 —— 旧索引名恰好等于目标名）→ 不能只判「名字存在就跳过」，
   *   否则什么都没改（初版迁移就踩了这个）。
   *
   * 重建顺序：先建**临时名**复合索引 → 删掉所有单列唯一（含同名旧索引）→ RENAME。
   * 不先删旧：中间窗口内活行会重复，而迁移本该可以被重跑。
   */
  private async replaceSingleUnique(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    targetName: string,
  ): Promise<void> {
    const wanted = `${column},delete_time`;
    if ((await this.indexColumns(queryRunner, table, targetName)) === wanted) {
      await this.dropOtherSingleUnique(queryRunner, table, column, targetName);
      return;
    }

    const tmpName = `tmp_${targetName}`;
    if ((await this.indexColumns(queryRunner, table, tmpName)) !== wanted) {
      // 临时索引存在但列不对（上轮失败残留）→ 先删再建
      await this.dropIndexIfExists(queryRunner, table, tmpName);
      await queryRunner.query(
        `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`${tmpName}\` (\`${column}\`, \`delete_time\`)`,
      );
    }

    // 清掉所有单列唯一（包括同名旧索引），保留临时索引
    await this.dropOtherSingleUnique(queryRunner, table, column, tmpName);

    const stillThere = await this.indexColumns(queryRunner, table, targetName);
    if (stillThere === null) {
      await queryRunner.query(
        `ALTER TABLE \`${table}\` RENAME INDEX \`${tmpName}\` TO \`${targetName}\``,
      );
    } else if (stillThere !== wanted) {
      // 理论上不会走到：目标名还在且列不对
      throw new Error(
        `${table}.${targetName} 仍是 (${stillThere})，无法改成 (${wanted})`,
      );
    }
  }

  /** down：恢复单列唯一（先确保复合已拆，再建单列） */
  private async restoreSingleUnique(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    currentName: string,
  ): Promise<void> {
    if ((await this.indexColumns(queryRunner, table, currentName)) === column) {
      return;
    }
    await this.dropIndexIfExists(queryRunner, table, currentName);
    if (
      (await this.singleColumnUniqueIndexes(queryRunner, table, column)).length
    ) {
      return;
    }
    await queryRunner.query(
      `ALTER TABLE \`${table}\` ADD UNIQUE KEY \`uk_${table}_${column}\` (\`${column}\`)`,
    );
  }

  /** 删掉除 `keepName` 外的、只含该单列的唯一索引 */
  private async dropOtherSingleUnique(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    keepName: string,
  ): Promise<void> {
    const names = await this.singleColumnUniqueIndexes(
      queryRunner,
      table,
      column,
    );
    for (const name of names) {
      if (name === keepName) continue;
      await queryRunner.query(
        `ALTER TABLE \`${table}\` DROP INDEX \`${name}\``,
      );
    }
  }

  /** 索引的列组合（按顺序逗号分隔）；索引不存在返回 null */
  private async indexColumns(
    queryRunner: QueryRunner,
    table: string,
    name: string,
  ): Promise<string | null> {
    const rows: Array<{ cols: string | null }> = await queryRunner.query(
      `SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, name],
    );
    const cols = rows[0]?.cols ?? null;
    return cols;
  }

  /** 查「非主键、单列、唯一、列名匹配」的索引名 */
  private async singleColumnUniqueIndexes(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<string[]> {
    const rows: Array<{ name: string; cols: string }> = await queryRunner.query(
      `SELECT INDEX_NAME AS name, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND NON_UNIQUE = 0
          AND INDEX_NAME <> 'PRIMARY'
        GROUP BY INDEX_NAME`,
      [table],
    );
    return rows.filter((r) => r.cols === column).map((r) => r.name);
  }

  private async indexExists(
    queryRunner: QueryRunner,
    table: string,
    name: string,
  ): Promise<boolean> {
    const rows: Array<{ c: number | string }> = await queryRunner.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, name],
    );
    return Number(rows[0]?.c ?? 0) > 0;
  }

  private async ensureIndex(
    queryRunner: QueryRunner,
    table: string,
    name: string,
    columns: string[],
  ): Promise<void> {
    if (await this.indexExists(queryRunner, table, name)) return;
    const cols = columns.map((c) => `\`${c}\``).join(', ');
    await queryRunner.query(
      `ALTER TABLE \`${table}\` ADD KEY \`${name}\` (${cols})`,
    );
  }

  private async dropIndexIfExists(
    queryRunner: QueryRunner,
    table: string,
    name: string,
  ): Promise<void> {
    if (!(await this.indexExists(queryRunner, table, name))) return;
    await queryRunner.query(`ALTER TABLE \`${table}\` DROP INDEX \`${name}\``);
  }
}
