import { Module } from '@nestjs/common';
import { CommonModule } from '../../common/common.module.js';
import { ConfigModule } from '../config/config.module.js';
import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

/** 系统监控：运行概览 / 指标 / 审计留存（运维面）。 */
@Module({
  imports: [CommonModule, ConfigModule],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
