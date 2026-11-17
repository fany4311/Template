import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module.js';
import { ShareService } from './share.service.js';

/**
 * 共享模块：业务模块通用的 service / 工具。
 * 接入 CoreModule 拿 config / logger；业务模块 import 本模块即可。
 */
@Module({
  imports: [CoreModule],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
