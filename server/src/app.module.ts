import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule, getDataSourceToken } from '@nestjs/typeorm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsModule } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { CommonModule } from './common/common.module.js';
import { AppThrottlerGuard } from './common/guards/throttler.guard.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { ConfigModule } from './modules/config/config.module.js';
import { DeptModule } from './modules/dept/dept.module.js';
import { DictModule } from './modules/dict/dict.module.js';
import { FileModule } from './modules/file/file.module.js';
import { HazardModule } from './modules/hazard/hazard.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { LoginlogModule } from './modules/loginlog/loginlog.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { PermissionModule } from './modules/permission/permission.module.js';
import { RoleModule } from './modules/role/role.module.js';
import { UserModule } from './modules/user/user.module.js';
import { ShareModule } from './share/share.module.js';
// <gen:import>（gen:module 在此插入新模块的 import，勿删）

/**
 * 根模块：业务模块必须手动注册进 imports，否则不加载。
 *
 * 基础能力装配：
 * - ClsModule：AsyncLocalStorage 上下文（traceId / 事务 / 审计共享）
 *   - 插件 ClsPluginTransactional：提供 @Transactional() 与 TransactionHost（TypeORM 适配）
 * - EventEmitterModule：进程内异步事件（审计管道；后续 Outbox→MQ）
 * - ScheduleModule：定时任务（省平台同步、保留策略等）
 * - ThrottlerModule：限流（默认 300 次/分钟，按需在接口上收紧）
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: () => randomUUID(),
      },
      plugins: [
        new ClsPluginTransactional({
          imports: [TypeOrmModule],
          adapter: new TransactionalAdapterTypeOrm({
            dataSourceToken: getDataSourceToken(),
          }),
        }),
      ],
    }),
    EventEmitterModule.forRoot({ global: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ShareModule,
    CommonModule,
    AuditModule,
    IdempotencyModule,
    OutboxModule,
    HealthModule,
    AuthModule,
    DeptModule,
    MenuModule,
    DictModule,
    ConfigModule,
    LoginlogModule,
    FileModule,
    HazardModule,
    RoleModule,
    PermissionModule,
    UserModule,
    // <gen:module>（gen:module 在此插入新模块，勿删）
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局限流守卫：ThrottlerGuard 子类，只把默认英文异常换成中文（见 common/guards/throttler.guard.ts）
    // 默认 300 次/分钟/路由（按 IP 计数，依赖 trust proxy）；匿名接口在各自控制器上收紧
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
  ],
})
export class AppModule {}
