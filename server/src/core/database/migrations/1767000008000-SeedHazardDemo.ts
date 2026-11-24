import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 演示账号统一密码。
 *
 * ⚠️ 为了安全，密码哈希只对**非生产**环境有效：`up()` 开头遇到 `NODE_ENV=prod`
 * 会整段跳过。派生项目若要在生产保留任何演示数据，请另写自己的 seed 脚本，
 * 不要把这个开关拆掉。
 */
const DEMO_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$3AJD2vJlL+ZUlxOIMjK85g$+SlfTg7LV+7BZ8uz7n0Fy9iTjdELr44rz8dkJ0Xmx4M';

/**
 * 隐患闭环模拟数据（两条对照单据）。
 *
 * 目的：用**同一个底座**跑出两种协作形态，验证数据范围的正确性。
 *
 * | 编号        | 范围 | 主责   | 协办     | 预期效果                       |
 * |-------------|------|--------|----------|--------------------------------|
 * | DEMO-HZ-0001| DEPT | 保卫处 | 无       | 信息中心**看不到**（本部门闭环）|
 * | DEMO-HZ-0002| OPEN | 保卫处 | 信息中心 | 信息中心**能看到并整改**（协同）|
 *
 * 幂等：部门/用户/授权/单据全部按业务唯一键 INSERT IGNORE 或先查后插，
 * 重复执行不会产生重复数据，也不会覆盖已修改的内容。
 *
 * **环境开关**：`NODE_ENV=prod` 时整个 `up()` 直接 return（见下方注释）。
 *
 * 演示账号（密码统一 `Demo@12345`）：
 * - operator_bw   业务操作员（消防科）  → 上报
 * - manager_bw    部门管理员（保卫处）  → 受理 / 整改
 * - manager_xx    部门管理员（信息中心）→ 协办（只有 DEMO-HZ-0002 可见）
 * - auditor_school 审计员（全校）       → 归档
 * 校级管理员复查用 `admin` 角色的账号（见 .env.dev 下的既有账号）。
 */
export class SeedHazardDemo1767000008000 implements MigrationInterface {
  name = 'SeedHazardDemo1767000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 生产环境**整段跳过**。
    //
    // 本迁移不只建演示单据，还会建 4 个可登录账号（密码 `Demo@12345` 明文写在
    // DEMO_PASSWORD_HASH 附近、随源码分发）。fresh 部署到生产就等于凭空送出
    // 4 个公开口令的账号 —— 所以必须按环境断开，而不是靠一句「上线前记得删掉」
    // 的注释（人工一定会忘）。
    //
    // 已跑过本迁移的库不受影响：TypeORM 按类名记在 migrations 表里，不会重跑。
    // dev / test 照旧执行（演示数据是 e2e 与手工验证的样本）。
    if (process.env.NODE_ENV === 'prod') {
      console.warn(
        '[SeedHazardDemo] NODE_ENV=prod，跳过演示数据（部门 / 演示账号 / 演示单据）',
      );
      return;
    }

    // ---------------- 1. 部门（按名称解析，缺失才建） ----------------

    const root = await this.ensureDept(queryRunner, '长沙医学院', null, '0', 1);
    const baoWei = await this.ensureDept(
      queryRunner,
      '保卫处',
      root,
      `0,${root}`,
      1,
    );
    const xinXi = await this.ensureDept(
      queryRunner,
      '信息中心',
      root,
      `0,${root}`,
      2,
    );
    const xiaoFang = await this.ensureDept(
      queryRunner,
      '消防科',
      baoWei,
      `0,${root},${baoWei}`,
      1,
    );

    // ---------------- 2. 演示账号 ----------------

    const operatorBw = await this.ensureUser(
      queryRunner,
      'operator_bw',
      '保卫处业务员',
      xiaoFang,
      'operator',
    );
    await this.ensureUser(
      queryRunner,
      'manager_bw',
      '保卫处管理员',
      baoWei,
      'manager',
    );
    await this.ensureUser(
      queryRunner,
      'manager_xx',
      '信息中心管理员',
      xinXi,
      'manager',
    );
    await this.ensureUser(
      queryRunner,
      'auditor_school',
      '校级审计员',
      root,
      'auditor',
    );

    // ---------------- 3. 两条对照单据 ----------------

    // 单 1：本部门闭环（信息中心不可见）
    await this.ensureHazard(queryRunner, {
      hazardNo: 'DEMO-HZ-0001',
      title: '教学楼三层消防栓压力不足',
      content:
        '日常巡查发现第三教学楼三层东侧消防栓压力表指针长期处于红区，' +
        '经初步判断为管网局部泄漏导致，需专业排查。',
      location: '第三教学楼 3F 东侧',
      category: 'FIRE',
      level: 'HIGH',
      scope: 'DEPT',
      reporterId: operatorBw,
      reporterName: '保卫处业务员',
      reporterDeptId: xiaoFang,
      assigneeDeptId: baoWei,
      cooperateDeptIds: [],
      operatorId: operatorBw,
    });

    // 单 2：多部门协同（信息中心可见并可整改）
    await this.ensureHazard(queryRunner, {
      hazardNo: 'DEMO-HZ-0002',
      title: '学生公寓门禁识别率偏低',
      content:
        '学生公寓 2 栋门禁在早晚高峰频繁识别失败，学生需重复刷卡。' +
        '涉及门禁终端硬件与后台对接，需保卫处与信息中心协同处理。',
      location: '学生公寓 2 栋门禁',
      category: 'SECURITY',
      level: 'MEDIUM',
      scope: 'OPEN',
      reporterId: operatorBw,
      reporterName: '保卫处业务员',
      reporterDeptId: xiaoFang,
      assigneeDeptId: baoWei,
      cooperateDeptIds: [xinXi],
      operatorId: operatorBw,
    });
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM biz_hazard_log WHERE hazard_no IN ('DEMO-HZ-0001', 'DEMO-HZ-0002')`,
    );
    await queryRunner.query(
      `DELETE FROM biz_hazard WHERE hazard_no IN ('DEMO-HZ-0001', 'DEMO-HZ-0002')`,
    );
    await queryRunner.query(
      `DELETE FROM sys_user_role WHERE user_id IN
         (SELECT id FROM sys_user WHERE username IN
            ('operator_bw', 'manager_bw', 'manager_xx', 'auditor_school'))`,
    );
    await queryRunner.query(
      `DELETE FROM sys_user WHERE username IN
         ('operator_bw', 'manager_bw', 'manager_xx', 'auditor_school')`,
    );
  }

  // -------------------------------------------------------------------------

  /** 按名称取部门 id，不存在则创建 */
  private async ensureDept(
    queryRunner: QueryRunner,
    name: string,
    parentId: number | null,
    ancestors: string,
    sort: number,
  ): Promise<number> {
    const found: Array<{ id: number }> = await queryRunner.query(
      'SELECT id FROM sys_dept WHERE name = ? ORDER BY id LIMIT 1',
      [name],
    );
    if (found.length) return found[0].id;

    const result: { insertId: number } = await queryRunner.query(
      `INSERT INTO sys_dept (parent_id, name, ancestors, sort, status, create_time, update_time)
       VALUES (?, ?, ?, ?, 1, NOW(), NOW())`,
      [parentId, name, ancestors, sort],
    );
    return Number(result.insertId);
  }

  /** 按用户名取用户 id，不存在则创建并授权角色 */
  private async ensureUser(
    queryRunner: QueryRunner,
    username: string,
    nickname: string,
    deptId: number,
    roleKey: string,
  ): Promise<number> {
    const found: Array<{ id: number }> = await queryRunner.query(
      'SELECT id FROM sys_user WHERE username = ? LIMIT 1',
      [username],
    );
    let userId: number;
    if (found.length) {
      userId = found[0].id;
    } else {
      const result: { insertId: number } = await queryRunner.query(
        `INSERT INTO sys_user
           (username, password, nickname, email, phone, dept_id, post, status, create_time, update_time)
         VALUES (?, ?, ?, '', '', ?, ?, 1, NOW(), NOW())`,
        [username, DEMO_PASSWORD_HASH, nickname, deptId, '演示账号'],
      );
      userId = Number(result.insertId);
    }

    const role: Array<{ id: number }> = await queryRunner.query(
      'SELECT id FROM sys_role WHERE role_key = ? LIMIT 1',
      [roleKey],
    );
    if (role.length) {
      await queryRunner.query(
        `INSERT IGNORE INTO sys_user_role
           (user_id, role_id, expire_at, source, granted_by, create_time, update_time)
         VALUES (?, ?, NULL, 'direct', NULL, NOW(), NOW())`,
        [userId, role[0].id],
      );
    }
    return userId;
  }

  /** 按编号取隐患 id，不存在则创建 + 补一条上报流转日志 */
  private async ensureHazard(
    queryRunner: QueryRunner,
    h: {
      hazardNo: string;
      title: string;
      content: string;
      location: string;
      category: string;
      level: string;
      scope: string;
      reporterId: number;
      reporterName: string;
      reporterDeptId: number;
      assigneeDeptId: number;
      cooperateDeptIds: number[];
      operatorId: number;
    },
  ): Promise<void> {
    const found: Array<{ id: number }> = await queryRunner.query(
      'SELECT id FROM biz_hazard WHERE hazard_no = ? LIMIT 1',
      [h.hazardNo],
    );
    if (found.length) return;

    const result: { insertId: number } = await queryRunner.query(
      `INSERT INTO biz_hazard
         (hazard_no, title, content, location, category, level, scope, status,
          reporter_id, reporter_name, reporter_dept_id, assignee_dept_id,
          cooperate_dept_ids, handler_name, review_opinion, archive_opinion,
          reject_reason, deadline_at, create_time, update_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'REPORTED',
               ?, ?, ?, ?, CAST(? AS CHAR), '', '', '', '', DATE_ADD(NOW(), INTERVAL 1 DAY), NOW(), NOW())`,
      [
        h.hazardNo,
        h.title,
        h.content,
        h.location,
        h.category,
        h.level,
        h.scope,
        h.reporterId,
        h.reporterName,
        h.reporterDeptId,
        h.assigneeDeptId,
        JSON.stringify(h.cooperateDeptIds),
      ],
    );

    await queryRunner.query(
      `INSERT INTO biz_hazard_log
         (hazard_id, hazard_no, scope, action, action_label, from_status, to_status,
          operator_id, operator_name, dept_id, remark, create_time)
       VALUES (?, ?, ?, 'REPORT', '上报', NULL, 'REPORTED', ?, ?, ?, ?, NOW())`,
      [
        Number(result.insertId),
        h.hazardNo,
        h.scope,
        h.operatorId,
        h.reporterName,
        h.reporterDeptId,
        h.content.slice(0, 200),
      ],
    );
  }
}
