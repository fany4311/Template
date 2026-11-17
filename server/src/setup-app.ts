import {
  INestApplication,
  StandardSchemaValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { setupSwagger } from './setup-swagger.js';

/**
 * 应用级通用配置：main.ts 与 e2e 测试共用，保证行为一致。
 * 包含：pino 日志接管 / Standard Schema 校验管道 / 前缀+版本化 / CORS / helmet / Swagger。
 */
export function setupApp(app: INestApplication) {
  const config = app.get(ConfigService);

  // nestjs-pino 接管 Nest 内部日志
  app.useLogger(app.get(Logger));

  // 全局校验管道（Nest 12 新特性）：只校验声明了 schema 的参数，其余原样放行。
  // 路由参数通过装饰器 schema 选项绑定：@Body({ schema }) / @Query({ schema }) / @Param('id', { schema })。
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      errorHttpStatusCode: 400,
    }),
  );

  // 全局前缀：/api
  app.setGlobalPrefix(config.get<string>('app.prefix', 'api'));

  // 反向代理跳数（Express `trust proxy`）：只信任本机一层 Nginx。
  // 不配的话 `req.ip` 恒为 Nginx 地址（127.0.0.1）—— 限流按 IP 计数会让全校用户
  // 共用一个配额，审计 / 登录日志里的 IP 也全部相同、无法追责。
  // trust=1 只信任 socket 那一跳，客户端自带的伪造 XFF 位于更左侧、会被忽略。
  // 前面还有 CDN / 网关时按实际层数上调（见 .env 的 TRUST_PROXY）。
  const trustProxy = config.get<number | false>('app.trustProxy');
  if (trustProxy !== false && trustProxy !== 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  }

  // URI 版本化：/api/v1
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.get<string>('app.version', '1'),
  });

  // 跨域开关（.env: CORS_ENABLED）
  if (config.get<boolean>('app.corsEnabled')) {
    app.enableCors({ origin: true, credentials: true });
  }

  // 安全头（helmet），关闭 CSP 避免干扰 Swagger 等
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Swagger 文档：/api/docs
  setupSwagger(app);

  return app;
}
