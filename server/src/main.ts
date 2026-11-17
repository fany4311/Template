import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  setupApp(app);

  // 优雅停机：SIGTERM/SIGINT 时停止接收新请求并断开连接
  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  await app.listen(port);
  app.get(Logger).log(`API server started at http://localhost:${port}/api/v1`);
}

await bootstrap();
