import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SysPermission } from './entities/permission.entity.js';
import { PermissionController } from './permission.controller.js';
import { PermissionService } from './permission.service.js';

/**
 * 权限清单模块（通用管理域，只读）。
 *
 * 清单是**派生数据**：源头是各控制器上的 `@RequiresPermissions`，
 * 由 `pnpm authz:sync` 反射同步进 `sys_permission`。
 * 因此本模块没有新增/编辑/删除接口 —— 想加权限码，去写装饰器。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SysPermission])],
  controllers: [PermissionController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class PermissionModule {}
