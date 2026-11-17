import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AllExceptionFilter } from './filters/all-exception.filter.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { PoliciesGuard } from './guards/policies.guard.js';
import { RbacGuard } from './guards/rbac.guard.js';
import { AbilityFactory } from './authz/ability.factory.js';
import { AuditInterceptor } from './interceptors/audit.interceptor.js';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor.js';
import { TraceIdInterceptor } from './interceptors/trace-id.interceptor.js';
import { TransformInterceptor } from './interceptors/transform.interceptor.js';

/**
 * 通用模块：全局过滤器 / 守卫 / 拦截器等纯代码注册处。
 * 用 APP_* token 注册，走 DI，可注入依赖，e2e 测试同样生效。
 *
 * 守卫顺序（Nest 按声明顺序执行）：JwtAuthGuard（登录态）→ RbacGuard（角色/权限码）→ PoliciesGuard（CASL 策略）。
 * 拦截器顺序：TraceId → Audit → Idempotency → Transform（幂等回放需在 Transform 之外层）。
 */
@Module({
  providers: [
    AbilityFactory,
    { provide: APP_FILTER, useClass: AllExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_GUARD, useClass: PoliciesGuard },
    { provide: APP_INTERCEPTOR, useClass: TraceIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class CommonModule {}
