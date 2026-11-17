import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoginLog } from './entities/login-log.entity.js';
import { LoginLogController } from './loginlog.controller.js';
import { LoginLogService } from './loginlog.service.js';

/**
 * 登录日志模块（系统管理域）：登录流程旁路写入 + 管理端查询/清理。
 * AuthModule 注入 LoginLogService 记录登录成功/失败。
 */
@Module({
  imports: [TypeOrmModule.forFeature([LoginLog])],
  controllers: [LoginLogController],
  providers: [LoginLogService],
  exports: [LoginLogService],
})
export class LoginlogModule {}
