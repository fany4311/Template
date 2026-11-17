import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';
import { getResponseSchemas } from './common/swagger/api-ok.js';

/**
 * OpenAPI 文档配置（Swagger UI 与前端 codegen 共用同一份配置，避免漂移）。
 * 访问地址：{host}/api/docs（JSON: {host}/api/docs-json）
 */
export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle('Template 管理平台 API')
    .setDescription('校内自建安全管理平台后端接口文档（NestJS 12 + ESM）')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}

/**
 * 生成文档并注入响应组件。
 *
 * 响应 schema 由控制器上的 `@ApiOkZod(...)` 在模块加载时登记（见 common/swagger/api-ok.ts），
 * 这里统一写入 `components.schemas`，接口侧只保留 `$ref`，避免同一结构重复内联。
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());
  document.components ??= {};
  document.components.schemas ??= {};
  for (const [name, schema] of getResponseSchemas()) {
    document.components.schemas[name] = schema as never;
  }
  return document;
}

/**
 * Swagger UI 配置。右上角 Authorize 填 `Bearer {token}` 即可带鉴权调试。
 */
export function setupSwagger(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}
