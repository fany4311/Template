import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiOkZod } from '../../common/swagger/api-ok.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { permissionGroupSchema } from './dto/permission.response.js';
import { PermissionService } from './permission.service.js';

/**
 * 权限清单（只读）。
 *
 * 存在的唯一理由：角色编辑界面要"按模块分组树形勾选"，不能再自由手输。
 * 清单由 `pnpm authz:sync` 从代码反射生成，不提供写入接口 ——
 * 允许接口改清单，等于允许人凭空造出代码里不存在的权限码（正是要消灭的病）。
 */
@ApiTags('权限清单')
@ApiBearerAuth()
@Controller('permission')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  @RequiresPermissions('system:permission:list')
  @ApiOperation({ summary: '按模块分组的权限清单' })
  @ApiOkZod(
    'SysPermissionGroups',
    permissionGroupSchema.array(),
    '模块分组：[{ module, moduleLabel, permissions[] }]',
  )
  list() {
    return this.permissionService.list();
  }
}
