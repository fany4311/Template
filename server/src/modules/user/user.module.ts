import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeptModule } from '../dept/dept.module.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';
import { UserController } from './user.controller.js';
import { UserService } from './user.service.js';
import { AuthorizationTask } from './authorization.task.js';

/**
 * 用户模块：注册实体 → forFeature 提供 Repository。
 * - 角色授权走显式 sys_user_role（UserRole）
 * - 依赖 DeptModule 提供的 DataScopeService（数据范围过滤）
 * - AuthorizationTask：定时回收到期临时授权 / 禁用用户的会话
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, UserRole]), DeptModule],
  controllers: [UserController],
  providers: [UserService, AuthorizationTask],
  exports: [UserService],
})
export class UserModule {}
