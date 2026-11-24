import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import {
  createRoleSchema,
  queryRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type QueryRoleInput,
  type UpdateRoleInput,
} from './dto/role.dto.js';
import { roleResponseSchema } from './dto/role.response.js';
import { RoleService } from './role.service.js';

const idParamSchema = z.coerce.number().int().positive();

/**
 * 角色管理（通用管理域）。
 * 权限码约定：system:role:list / add / edit / remove。
 */
@ApiTags('角色管理')
@ApiBearerAuth()
@Controller('role')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @RequiresPermissions('system:role:list')
  @ApiOperation({ summary: '分页查询角色' })
  @ApiOkZod(
    'SysRolePage',
    pageOf(roleResponseSchema),
    '分页结果 { list, total }',
  )
  page(@Query({ schema: queryRoleSchema }) query: QueryRoleInput) {
    return this.roleService.page(query);
  }

  @Get(':id')
  @RequiresPermissions('system:role:list')
  @ApiOperation({ summary: '角色详情' })
  @ApiOkZod('SysRole', roleResponseSchema, '返回角色详情')
  detail(@Param('id', { schema: idParamSchema }) id: number) {
    return this.roleService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:role:add')
  @Auditable({ action: 'system:role:add', resourceType: 'role' })
  @Idempotent({ scope: 'system:role:add' })
  @ApiOperation({ summary: '创建角色' })
  @ApiOkZod('SysRole', roleResponseSchema, '返回创建后的角色')
  create(@Body({ schema: createRoleSchema }) dto: CreateRoleInput) {
    return this.roleService.create(dto);
  }

  @Put(':id')
  @RequiresPermissions('system:role:edit')
  @Auditable({
    action: 'system:role:edit',
    resourceType: 'role',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '更新角色' })
  @ApiOkZod('SysRole', roleResponseSchema, '返回更新后的角色')
  update(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateRoleSchema }) dto: UpdateRoleInput,
  ) {
    return this.roleService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermissions('system:role:remove')
  @Auditable({
    action: 'system:role:remove',
    resourceType: 'role',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除角色（软删除）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(@Param('id', { schema: idParamSchema }) id: number) {
    return this.roleService.remove(id);
  }
}
