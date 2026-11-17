import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageModule } from '@nestjs/storage';
import { ConfigModule } from './config/config.module.js';
import { createStorageOptions } from './storage/storage.config.js';
import { DatabaseModule } from './database/database.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SessionModule } from './session/session.module.js';

/**
 * 核心模块：聚合基础设施（config / logger / database / redis / session / storage）。
 * 全部 @Global() 注册，业务模块无需 import 即可注入 ConfigService、RedisService、SessionService 等。
 *
 * StorageModule 默认 isGlobal：任何模块都可直接注入 `StorageDisk`（默认盘）
 * 或 `@InjectDisk('name')`（指定盘），文件模块只是它的消费者之一。
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    DatabaseModule,
    RedisModule,
    SessionModule,
    StorageModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createStorageOptions,
    }),
  ],
  exports: [ConfigModule, LoggerModule, SessionModule],
})
export class CoreModule {}
