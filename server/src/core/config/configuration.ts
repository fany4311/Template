/**
 * load 函数：把扁平 env 转成带命名空间的配置对象。
 * 业务代码用 config.get('app.port') / config.get('db.host') 读取。
 */

/**
 * 解析 TRUST_PROXY（Express `trust proxy` 跳数）。
 *
 * 生产拓扑是「浏览器 → Nginx → Node」，填 `1` 才会让 `req.ip` 取到真实客户端 IP。
 * 不填的后果：`req.ip` 恒为 Nginx 地址（127.0.0.1）—— 限流按 IP 计数时**全校共用
 * 一个配额**（一个用户能把全校接口刷成 429），审计/登录日志里的 IP 也全部相同、无法追责。
 *
 * - 缺省 / 空    → 1（信任本机一层 Nginx，本项目默认拓扑）
 * - `0` / `false` → 不信任任何代理头（Node 直连对外时用这个，否则客户端可伪造 XFF）
 * - 正整数       → 信任的跳数（前面还有 CDN / 网关时按实际层数上调）
 */
function parseTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || raw.trim() === '') return 1;
  const v = raw.trim().toLowerCase();
  if (v === 'false' || v === '0') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * 解析 AUDIT_MODE。
 *
 * - `async`（缺省）：审计条目进进程内事件队列，不阻塞响应。
 * - `sync`：请求内等落库再返回 —— 等保/审计合规要求「操作与审计不能偷偷分家」时用。
 *
 * 写成白名单而不是 `!== 'async'`：拼错（如 `SYNC` 大写、`sync-foo`）时如果被当成
 * sync 以外的东西，就会静默退化成 async —— 而配这个变量的人恰恰是最在意审计的那批人。
 */
function parseAuditMode(raw: string | undefined): 'sync' | 'async' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'sync') return 'sync';
  if (v === '' || v === 'async') return 'async';
  // 非法值不静默：启动日志里应该有痕迹（用 console 是因为此时 logger 还没建好）
  console.warn(
    `[config] AUDIT_MODE="${raw}" 无法识别，已回退为 async（可选值：async | sync）`,
  );
  return 'async';
}

export default () => ({
  app: {
    port: Number(process.env.PORT) || 3000,
    env: process.env.NODE_ENV ?? 'dev',
    name: process.env.APP_NAME ?? 'nest-app',
    // 全局前缀：/api/v1
    prefix: process.env.API_PREFIX ?? 'api',
    version: process.env.API_VERSION ?? '1',
    corsEnabled: process.env.CORS_ENABLED === 'true',
    // 反向代理跳数（Express trust proxy）—— 决定 req.ip 是否可信，见 parseTrustProxy
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    // 统一异常过滤器开关：默认开启，显式设 false 才退回 Nest 默认响应
    filterEnabled: process.env.FILTER_ENABLED !== 'false',
    // 登录验证码开关（联调时可关）
    captchaEnabled: process.env.CAPTCHA_ENABLED === 'true',
    // Outbox 轮询投递开关（测试可关闭）
    outboxEnabled: process.env.OUTBOX_ENABLED !== 'false',
    // 全局限流开关（默认开）。e2e 建议关：同一 IP 高频登录会触发 429，测试时好时坏
    throttleEnabled: process.env.THROTTLE_ENABLED !== 'false',
    // Swagger 文档开关：dev/test 默认开，prod 默认关（显式 SWAGGER_ENABLED=true 才开）。
    // 匿名列出全量接口契约，等于把攻击面写清楚，生产不需要。
    swaggerEnabled:
      process.env.SWAGGER_ENABLED === undefined
        ? process.env.NODE_ENV !== 'prod'
        : process.env.SWAGGER_ENABLED === 'true',
    // 审计写入模式：async（默认，进程内事件异步落库）| sync（请求内等落库，合规场景用）
    auditMode: parseAuditMode(process.env.AUDIT_MODE),
    // Outbox 终态事件保留天数（过期由 OutboxCleanupTask 回收）
    outboxSentRetentionDays:
      Number(process.env.OUTBOX_SENT_RETENTION_DAYS) || 7,
    outboxFailedRetentionDays:
      Number(process.env.OUTBOX_FAILED_RETENTION_DAYS) || 30,
  },
  // JWT 认证
  jwt: {
    // 仅兜底用：启动时 env.validation.ts 已强制要求 JWT_SECRET ≥16 字符，
    // 生产环境还要求 ≥32 且不得是模板值 —— 这里给默认值只是为了类型不为 undefined
    secret: process.env.JWT_SECRET ?? 'nest-template-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
    // Redis token 缓存秒数（默认 2h，与 expiresIn 对齐）
    tokenTtl: Number(process.env.JWT_TOKEN_TTL) || 7200,
  },
  // 数据库预留：支持多驱动，DB_TYPE 切换 mysql / postgres / sqlite / mariadb
  db: {
    type: process.env.DB_TYPE ?? 'mysql',
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    poolSize: Number(process.env.DB_POOL_SIZE) || 10,
    logging: process.env.DB_LOGGING === 'true',
  },
  // 缓存数据库预留：redis
  cache: {
    type: process.env.CACHE_TYPE ?? 'redis',
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB) || 0,
  },
  // 日志
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
  },
  // 对象存储（可拔插：s3 / local / memory）
  storage: {
    driver: (process.env.STORAGE_DRIVER ?? 's3') as 's3' | 'local' | 'memory',
    // 默认盘名。业务代码只认盘名，不认厂商
    disk: process.env.STORAGE_DISK ?? 'default',
    s3: {
      endpoint: process.env.STORAGE_S3_ENDPOINT ?? 'http://127.0.0.1:9010',
      region: process.env.STORAGE_S3_REGION ?? 'us-east-1',
      bucket: process.env.STORAGE_S3_BUCKET ?? 'template',
      accessKey: process.env.STORAGE_S3_ACCESS_KEY ?? '',
      secretKey: process.env.STORAGE_S3_SECRET_KEY ?? '',
      // MinIO 等自建存储必须 path-style
      forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE !== 'false',
      serverSideEncryption:
        process.env.STORAGE_S3_SERVER_SIDE_ENCRYPTION === 'true',
    },
    local: {
      root: process.env.STORAGE_LOCAL_ROOT ?? './data/uploads',
    },
  },
});
