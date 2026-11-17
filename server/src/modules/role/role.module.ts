import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserRole } from '../user/entities/user-role.entity.js';
import { Role } from './entities/role.entity.js';
import { RoleController } from './role.controller.js';
import { RoleService } from './role.service.js';

/**
 * 角色模块（通用管理域）：RBAC/CASL 角色与规则管理。
 *
 * 额外注册 `UserRole`：删除角色前要统计持有人（防止“软删后持有人静默失权”），
 * 改权限后要按角色反查持有人以失效会话。
 * `SessionService` 来自全局 SessionModule（@Global），无需在此 import。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Role, UserRole])],
  controllers: [RoleController],
  providers: [RoleService],
  exports: [RoleService],
})
export class RoleModule {}
