import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';

/**
 * TypeORM 数据源（供 CLI 迁移使用，非 Nest 运行时）。
 *
 * 迁移命令走「先编译再执行」的稳妥方式（见 package.json 的 migration:* 脚本），
 * 因此本文件以 dist/core/database/data-source.js 的形态被 typeorm CLI 加载。
 *
 * 环境变量：优先 .env.$NODE_ENV，其次 .env.comm（用 Node 内置 process.loadEnvFile 读取）。
 */
const env = process.env.NODE_ENV ?? 'dev';
for (const file of [`.env.${env}`, '.env.comm']) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

const dir = import.meta.dirname; // 编译后为 dist/core/database

export default new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  charset: 'utf8mb4_unicode_ci',
  // 实体/迁移用编译后的 glob（ESM 下不能用 __dirname）
  entities: [`${dir}/../../**/*.entity.js`],
  migrations: [`${dir}/migrations/*.js`],
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  extra: { connectionLimit: Number(process.env.DB_POOL_SIZE) || 10 },
});
