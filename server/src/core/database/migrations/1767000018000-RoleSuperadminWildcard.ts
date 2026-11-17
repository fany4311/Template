import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 超管权限收敛为「纯通配」`*:*:*`（决策 B）。
 *
 * ## 背景：`console:access` 那个补丁是个症状
 * 准入码 `console:access` 刻意不放在 `system:` 域下（放进去就会被校级管理员的
 * `!system:*` 一起否掉）。而原先超管的授权是 `system:*` —— 正好不含这个码，
 * 于是只能写一个专用迁移（`1767000012000`）往超管的权限串里**追加**一个具体码，
 * 结果库里出现 `system:*,console:access` 这种「通配 + 具体码」混用。
 *
 * 混用的真正问题是**不可判定**：`*:*:*` 已经是全权，后面再挂具体码，
 * 后来人无法判断它是"通配漏了要补"还是"零散例外"。
 *
 * ## 决策：超管 = `*:*:*`，且禁止再挂任何其它码
 * - `*:*:*` 自动覆盖 `console:access`，**补丁的需求从根上消失**；
 * - 超管的身份由 `level === 0` 承担（编号不可改），权限串只表达"能做什么"，
 *   两者职责分开；「内置」另由 `is_builtin` 表达；
 * - 环境无关：派生新系统时不用再逐个决定超管该有哪些业务权限；
 * - 与若依 / Casbin 一致 —— 超管是特殊主体，天然全权。
 *
 * ## 代价（如实记录）
 * 放弃了「超管不碰业务数据」的蒙权分离。该分离**本来就不是安全边界**：
 * 超管手握 `system:role:edit`，随时能给自己加业务权限码，只是一个可绕过的
 * 形式约束，却要每个派生系统重复裁剪一遍。收益不抵成本。
 *
 * ## 号段为什么是 18000
 * 与 `1767000017000` 同理：原写作 `15000`，与派生项目 Csmu_BigScreen 在自己库里
 * 执行过的 `SuperadminWildcard1767000015000` 同号。现已分库，整体后移脱钩。
 * 值得一提的是那条同名迁移把超管写成了 `*:*:*,console:access` —— 与本决策冲突，
 * 分库后本库不再受影响，本条将其覆盖为纯通配。
 *
 * ## 幂等
 * `WHERE level = 0 AND permissions <> '*:*:*'` —— 重复执行是 no-op。
 * 已应用的 `1767000012000` 不改（迁移是一本不可涂改的账），由本条覆盖其结果。
 */
export class RoleSuperadminWildcard1767000018000
  implements MigrationInterface
{
  name = 'RoleSuperadminWildcard1767000018000';

  /** 历史值：本条迁移生效前，超管的权限串长这样（down 用） */
  private static readonly LEGACY = 'system:*,console:access';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE sys_role SET permissions = '*:*:*'
        WHERE level = 0 AND permissions <> '*:*:*'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE sys_role SET permissions = ?
        WHERE level = 0 AND permissions = '*:*:*'`,
      [RoleSuperadminWildcard1767000018000.LEGACY],
    );
  }
}
