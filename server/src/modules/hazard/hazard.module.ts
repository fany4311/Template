import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dept } from '../dept/entities/dept.entity.js';
import { DeptModule } from '../dept/dept.module.js';
import { HazardFileHandler } from './adapters/hazard-file.handler.js';
import { HazardSyncHandler } from './adapters/hazard-sync.handler.js';
import { MockProvinceAdapter } from './adapters/mock-province.adapter.js';
import { Hazard } from './entities/hazard.entity.js';
import { HazardLog } from './entities/hazard-log.entity.js';
import { HazardSync } from './entities/hazard-sync.entity.js';
import { FileModule } from '../file/file.module.js';
import { HazardController } from './hazard.controller.js';
import { HazardService } from './hazard.service.js';
import { PROVINCE_SYNC_PORT } from './ports/province-sync.port.js';

/**
 * 隐患闭环模块 —— 第一个业务模块，用来验证底座是否真的够用。
 *
 * 依赖的底座能力（均来自 common / core，本模块只做业务）：
 * - 权限  ：RbacGuard（权限码）+ PoliciesGuard（CASL 动作）
 * - 数据  ：DataScopeService（角色数据范围）
 * - 事务  ：ClsPluginTransactional（txHost.withTransaction）
 * - 幂等  ：IdempotencyInterceptor（@Idempotent）
 * - 审计  ：AuditInterceptor（@Auditable）
 * - 事件  ：OutboxService + OutboxPublisher（事务性发件箱）
 *
 * 省平台对接通过端口注入，当前是 Mock：
 *   PROVINCE_SYNC_PORT → MockProvinceAdapter
 * 真接口到位后只改这一行 provider，业务代码不动。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Hazard, HazardLog, HazardSync, Dept]),
    DeptModule,
    // 用文件底座：需要 FileBizRegistry（provider 按模块可见性解析，必须 import）
    FileModule,
  ],
  controllers: [HazardController],
  providers: [
    HazardService,
    HazardSyncHandler,
    HazardFileHandler,
    { provide: PROVINCE_SYNC_PORT, useClass: MockProvinceAdapter },
  ],
  exports: [HazardService],
})
export class HazardModule {}
