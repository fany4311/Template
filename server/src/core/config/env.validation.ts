import { z } from 'zod';

/**
 * 环境变量校验 schema（Nest 12 + Standard Schema，Zod 版本）。
 * 只声明需要校验/带默认值的关键项；未声明变量由 @nestjs/config 自动回填，不会丢失。
 * 业务代码读取方式不变：config.get('app.port') / config.get('db.host')。
 *
 * ## 设计原则：能启动时发现的配置错误，绝不留到运行时
 * 派生项目最常踩的坑，是把模板 env 原样带进生产 —— 弱 `JWT_SECRET`、沿用 dev 库名、
 * 忘了关 `DB_SYNCHRONIZE`。这些错误在生产表现为「进程活着但行为诡异」（token 能被
 * 别的环境伪造、表被 synchronize 悄悄改），排查成本极高。
 * 这里一次性堵死：**起不来比带病运行好查得多**。
 */

/** 从 env 字符串解析布尔：'1'/'true'/'yes'（不区分大小写）→ true；其余 / 缺省 → 默认值 */
const boolFromEnv = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? defaultValue
        : /^(1|true|yes)$/i.test(v.trim()),
    );

/**
 * 生产环境绝对不允许出现的密钥值：模板占位与各环境示例值。
 * 命中即拒绝启动 —— 这类值一旦上线，等于把签发权公开（源码里就能搜到）。
 */
const FORBIDDEN_PROD_SECRETS: readonly string[] = [
  'nest-template-secret', // configuration.ts 的代码级兜底
  'change-me-in-prod', // .env.example
  'change-me-to-random-32-bytes', // deploy/.env.prod.example
  'template-dev-secret', // dev 实测值
  'template-test-secret', // test 实测值
];

export const envValidationSchema = z
  .object({
    NODE_ENV: z.enum(['dev', 'prod', 'test']).default('dev'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    DB_TYPE: z
      .enum(['mysql', 'mariadb', 'postgres', 'sqlite'])
      .default('mysql'),

    // 认证密钥：全环境最低 16 字符；prod 另有更严要求（见下方 superRefine）
    JWT_SECRET: z
      .string()
      .min(16, 'JWT_SECRET 至少 16 个字符（生产建议 32 字节随机值）'),

    // 数据库名必填：漏配时 TypeORM 会拿 undefined 去连库，报错信息极难定位
    DB_DATABASE: z
      .string()
      .min(1, 'DB_DATABASE 不能为空（每个派生项目必须使用独立数据库）'),

    // 生产禁止 synchronize：与迁移并存会抢先改表，破坏迁移的可追溯性
    DB_SYNCHRONIZE: boolFromEnv(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'prod') return;

    if (env.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: '生产环境 JWT_SECRET 至少 32 个字符',
      });
    }
    if (FORBIDDEN_PROD_SECRETS.includes(env.JWT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message:
          '生产环境 JWT_SECRET 仍是模板 / 其它环境的默认值 —— 换一个 ≥32 字节随机串（openssl rand -base64 48）',
      });
    }
    if (env.DB_SYNCHRONIZE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_SYNCHRONIZE'],
        message: '生产环境 DB_SYNCHRONIZE 必须为 false（建表一律走迁移）',
      });
    }
  });
