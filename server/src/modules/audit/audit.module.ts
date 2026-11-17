import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditController } from './audit.controller.js';
import { AuditListener } from './audit.listener.js';
import { AuditService } from './audit.service.js';
import { AuditLog } from './entities/audit-log.entity.js';

/**
 * 审计模块（全局）：独立审计管道。
 * - AuditService：投递审计条目（事件）+ 只读查询
 * - AuditListener：异步落库 sys_audit_log
 * - AuditController：操作日志查询（只读，append-only）
 * 业务模块无需 import，注入 AuditService 即可记录自定义审计。
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  controllers: [AuditController],
  providers: [AuditService, AuditListener],
  exports: [AuditService],
})
export class AuditModule {}
