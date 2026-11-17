import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigController } from './config.controller.js';
import { ConfigService } from './config.service.js';
import { Config } from './entities/config.entity.js';

/**
 * 参数配置模块（通用管理域）：可运行时调整的键值参数。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Config])],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
