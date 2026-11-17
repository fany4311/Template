import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 核心表结构基线（**必须在所有 seed 迁移之前执行**）。
 *
 * 背景与教训：
 * 项目最初这几张表是靠 dev 环境 `DB_SYNCHRONIZE=true` 由 TypeORM 自动创建的，
 * 没有对应的建表迁移。后果是「空库跑迁移」根本跑不起来 ——
 * 最早执行的 `1767000000000-SeedBuiltinRoles` 要往 `sys_role` 插数据，而表还不存在。
 * 生产环境按 `.env.example`（`DB_SYNCHRONIZE=false`）启动会直接失败。
 *
 * 本迁移补齐：
 * - `sys_dept` / `sys_role` / `sys_user` / `sys_user_role`
 * - `sys_audit_log`（只追加，无 update/delete 语义）
 * - `sys_idempotency` / `sys_outbox`
 *
 * 另外几组表本来就有专用建表迁移（sys_menu / sys_dict_* / sys_config /
 * sys_login_log / biz_hazard* / sys_file），这里不重复。
 *
 * 全部使用 `CREATE TABLE IF NOT EXISTS`：既有环境（表由 synchronize 建好）
 * 执行本迁移是 no-op，不会因为「表已存在」中断升级。
 *
 * DDL 取自线上库的 `SHOW CREATE TABLE`，索引名与 TypeORM 生成的一致
 * （含 `IDX_*` 哈希名），避免后续 `migration:generate` 产生无意义的改名 diff。
 */
export class CreateCoreSchema1766999990000 implements MigrationInterface {
  name = 'CreateCoreSchema1766999990000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 部门树（自引用 parent_id，不用外键约束以支持批量调整）
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_dept\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`update_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`delete_time\` datetime(6) DEFAULT NULL,
        \`parent_id\` int DEFAULT NULL,
        \`name\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`ancestors\` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '0',
        \`sort\` int NOT NULL DEFAULT '0' COMMENT '排序',
        \`status\` int NOT NULL DEFAULT '1' COMMENT '状态：1正常 0禁用',
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_role\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`update_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`delete_time\` datetime(6) DEFAULT NULL,
        \`role_key\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色标识，如 admin',
        \`role_name\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色名称，如 管理员',
        \`permissions\` text COLLATE utf8mb4_unicode_ci COMMENT '权限码列表',
        \`status\` int NOT NULL DEFAULT '1' COMMENT '状态：1正常 0禁用',
        \`rules\` json DEFAULT NULL COMMENT 'CASL 规则',
        \`data_scope\` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'SELF',
        \`sort\` int NOT NULL DEFAULT '0' COMMENT '排序',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_2320bd906a4f61ac7ddcb645cd\` (\`role_key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`update_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`delete_time\` datetime(6) DEFAULT NULL,
        \`username\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录账号',
        \`password\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '密码(argon2)',
        \`nickname\` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '昵称',
        \`email\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '邮箱',
        \`phone\` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '手机号',
        \`status\` int NOT NULL DEFAULT '1' COMMENT '状态：1正常 0禁用',
        \`dept_id\` int DEFAULT NULL COMMENT '所属部门',
        \`post\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '岗位（预设字段）',
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_9e7164b2f1ea1348bc0eb0a7da\` (\`username\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_user_role\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`update_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        \`delete_time\` datetime(6) DEFAULT NULL,
        \`user_id\` int NOT NULL,
        \`role_id\` int NOT NULL,
        \`expire_at\` datetime DEFAULT NULL,
        \`source\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'direct',
        \`granted_by\` int DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uk_user_role\` (\`user_id\`,\`role_id\`),
        KEY \`FK_e8300bfcf561ed417f5f02c6776\` (\`role_id\`),
        CONSTRAINT \`FK_e8300bfcf561ed417f5f02c6776\`
          FOREIGN KEY (\`role_id\`) REFERENCES \`sys_role\` (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 审计表只追加：没有 update_time / delete_time，删除接口也不存在
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_audit_log\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`trace_id\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`actor_id\` int DEFAULT NULL,
        \`actor_name\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`action\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`resource_type\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`resource_id\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`result\` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`error_code\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`http_method\` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`path\` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`ip\` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`user_agent\` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`detail\` json DEFAULT NULL,
        \`duration_ms\` int DEFAULT NULL,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`idx_audit_create_time\` (\`create_time\`),
        KEY \`idx_audit_action\` (\`action\`),
        KEY \`idx_audit_actor\` (\`actor_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_idempotency\` (
        \`key\` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`request_hash\` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`status\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
        \`response_body\` json DEFAULT NULL,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`expire_at\` datetime NOT NULL,
        PRIMARY KEY (\`key\`),
        KEY \`idx_idem_expire\` (\`expire_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`sys_outbox\` (
        \`id\` bigint NOT NULL AUTO_INCREMENT,
        \`event_type\` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
        \`aggregate_type\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`aggregate_id\` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`payload\` json NOT NULL,
        \`status\` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
        \`retries\` int NOT NULL DEFAULT '0',
        \`last_error\` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
        \`available_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`claimed_at\` datetime DEFAULT NULL,
        \`create_time\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`sent_at\` datetime DEFAULT NULL,
        PRIMARY KEY (\`id\`),
        KEY \`idx_outbox_status_available\` (\`status\`,\`available_at\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 依赖顺序：先删带外键的，再删被引用的
    for (const table of [
      'sys_outbox',
      'sys_idempotency',
      'sys_audit_log',
      'sys_user_role',
      'sys_user',
      'sys_role',
      'sys_dept',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
