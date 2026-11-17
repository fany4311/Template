import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { createPinoOptions } from './logger.options.js';

/**
 * 全局日志模块：控制台 + 文件，纯应用日志。
 * 业务代码直接注入 PinoLogger 使用。
 *
 * 预留：数据库日志 —— 将来 TypeORM 自定义 logger（实现其 Logger 接口）
 * 把 query 日志送进同一 pino，在本模块加一个 typeorm.logger.ts 即可。
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createPinoOptions,
    }),
  ],
})
export class LoggerModule {}
