import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from '../app.module.js';
import { setupApp } from '../setup-app.js';
import { buildOpenApiDocument } from '../setup-swagger.js';

/**
 * 导出 OpenAPI JSON 供前端 codegen（openapi-typescript）。
 *
 * 不监听端口：仅初始化应用 → 生成文档 → 写文件 → 退出。
 * 运行：pnpm openapi:dump（脚本内已先 build）
 * 产物：trunk/web_admin/openapi.json
 *
 * 为什么写到 web_admin 而不是 web：OpenAPI 类型是给**后台**用的
 * （web 最小壳只有登录，接口类型手写）。前端拆分 web→web_admin 后这里跟着改，
 * 否则产物会落到 web/ 而 web_admin 拿到的还是旧 schema。
 */
async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app);
  await app.init();

  const document = buildOpenApiDocument(app);
  // dist/scripts/*.js → ../../../web_admin = trunk/web_admin
  const out = resolve(import.meta.dirname, '../../../web_admin/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();
  console.log(`[openapi] written: ${out}`);
  process.exit(0);
}

await main();
