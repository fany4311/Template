import { Global, Module } from '@nestjs/common';
import { SessionService } from './session.service.js';

/**
 * 会话缓存模块（全局）：集中管理 auth:* 会话键，供认证与各业务模块失效会话。
 */
@Global()
@Module({
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
