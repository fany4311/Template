import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { User } from '../../common/decorators/user.decorator.js';
import { ApiOkZod } from '../../common/swagger/api-ok.js';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { JwtUser } from './auth.interface.js';
import { loginSchema, type LoginInput } from './dto/login.dto.js';
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from './dto/password.dto.js';
import {
  captchaResponseSchema,
  loginResponseSchema,
  profileResponseSchema,
} from './dto/auth.response.js';

/**
 * 认证接口：验证码 / 登录 / 登出 / 当前用户信息。
 * login、captcha 用 @Public() 跳过全局鉴权，其余默认需登录。
 * 入参校验走 Nest 12 Standard Schema：@Body({ schema }) / @Query({ schema })。
 *
 * 限流：全局默认 300 次/分钟太宽松 —— 对**匿名**的 login / captcha 等于没防。
 * 撞库的成本就是这两行，所以在这两个接口上单独收紧（按 IP 计数，依赖 trust proxy，
 * 见 setup-app.ts；不配 trust proxy 时全校共用一个计数器，反而会误伤正常用户）。
 */
@ApiTags('认证')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('captcha')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: '获取图形验证码' })
  @ApiOkZod('CaptchaResult', captchaResponseSchema, '返回 { img: svg, uuid }，登录时回传 uuid+code')
  captcha() {
    return this.authService.createCaptcha();
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  // 登录：同一 IP 每分钟最多 5 次（含失败）。单个账号被撞库时靠它限速，
  // 真正的账号锁定策略应由派生项目按合规要求再加。
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Auditable({ action: 'auth:login' })
  @ApiOperation({ summary: '登录' })
  @ApiOkZod('LoginResult', loginResponseSchema, '返回 { token, user }')
  login(@Body({ schema: loginSchema }) dto: LoginInput, @Req() req: Request) {
    // 请求信息仅用于登录日志记录（ip / UA）。
    // ip 取 req.ip：已由 setup-app.ts 配置 trust proxy，反代后即为真实客户端 IP。
    return this.authService.login(dto, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Auditable({ action: 'auth:logout' })
  @ApiOperation({ summary: '登出（token 立即失效）' })
  @ApiOkZod('VoidResult', null, '登出成功，无返回体')
  logout(@User('userId') userId: number) {
    return this.authService.logout(userId);
  }

  @Get('profile')
  @ApiOperation({ summary: '当前登录用户信息（含角色/权限）' })
  @ApiOkZod('Profile', profileResponseSchema, '当前用户信息（含角色/权限/数据范围）')
  profile(@User() user: JwtUser) {
    return this.authService.getInfo(user);
  }

  /**
   * 自助改密（登录即可调用，不需要权限码）。
   *
   * 改完会**使当前会话失效**（安全设计，见 AuthService.changePassword），
   * 前端收到成功后应清除本地 token 并跳登录页。
   * `required: false`：客户端没带 Idempotency-Key 也能用 —— 改密用旧密码做校验，
   * 天然抗重放（第二次旧密码已不对），不需要幂等表记账。
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Idempotent({ scope: 'auth:password', required: false })
  @Auditable({ action: 'auth:password' })
  @ApiOperation({ summary: '修改自己的密码（成功后当前会话失效）' })
  @ApiOkZod('VoidResult', null, '改密成功，无返回体；需重新登录')
  changePassword(
    @User('userId') userId: number,
    @Body({ schema: changePasswordSchema }) dto: ChangePasswordInput,
  ) {
    return this.authService.changePassword(userId, dto);
  }
}
