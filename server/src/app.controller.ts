import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** @Public() 演示：公开接口跳过登录鉴权，响应仍统一包装 */
  @Get('hello')
  @Public()
  getHello(): string {
    return this.appService.getHello();
  }
}
