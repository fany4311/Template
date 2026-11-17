import type { DataSource } from 'typeorm';

/**
 * 清理 e2e 运行产生的审计/登录日志。
 *
 * 为什么需要：`sys_audit_log` / `sys_login_log` 是给运维看的两张表，
 * 而每个 e2e 用例都要登录 + 调写接口，一次全量跑就灌进上百条 `e2e_*` 记录，
 * 把真实操作淹没（真实踩过：操作日志 1600 条里 90% 是测试噪音）。
 *
 * 只删测试账号（`e2e_*` / `idem_*`）产生的行，**不碰真实账号**。
 * 注意 `\_` 是 MySQL 里对下划线的转义（下划线在 LIKE 里是单字符通配符）。
 */
export async function purgeE2ELogs(ds: DataSource): Promise<void> {
  await ds.query(
    `DELETE FROM sys_audit_log
      WHERE actor_name LIKE 'e2e\\_%' OR actor_name LIKE 'idem\\_%'`,
  );
  await ds.query(
    `DELETE FROM sys_login_log
      WHERE username LIKE 'e2e\\_%' OR username LIKE 'idem\\_%'`,
  );
}
