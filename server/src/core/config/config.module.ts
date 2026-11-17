import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import configuration from './configuration.js';
import { envValidationSchema } from './env.validation.js';

/**
 * 环境配置模块：全局注册，全项目注入 ConfigService 使用。
 * 特定环境文件在前（优先加载），.env.comm 兜底公共变量。
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'dev'}`, '.env.comm'],
      // 载入通用环境变量为命名空间配置
      load: [configuration],
      // 关键项校验：Nest 12 的 validationSchema 接受任意 Standard Schema（此处 Zod）
      validationSchema: envValidationSchema,
    }),
  ],
})
export class ConfigModule {}
