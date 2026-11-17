import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { LoginlogModule } from '../loginlog/loginlog.module.js';
import { UserModule } from '../user/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';

/**
 * 认证模块：登录 / 登出 / JWT 签发与校验策略。
 * JwtModule 全局配置读取 .env 的 JWT_SECRET / JWT_EXPIRES_IN。
 */
@Module({
  imports: [
    UserModule,
    LoginlogModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.secret'),
        signOptions: {
          // expiresIn 支持 '2h' / '7d' 等字符串写法
          expiresIn: config.get('jwt.expiresIn', '2h'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
