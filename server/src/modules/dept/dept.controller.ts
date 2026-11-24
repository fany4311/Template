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
import { ApiOkZod } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import {
  createDeptSchema,
  queryDeptSchema,
  updateDeptSchema,
  type CreateDeptInput,
  type QueryDeptInput,
  type UpdateDeptInput,
} from './dto/dept.dto.js';
import { deptResponseSchema } from './dto/dept.response.js';
import { DeptService } from './dept.service.js';

const idParamSchema = z.coerce.number().int().positive();

/**
 * 部门管理（通用管理域）。
 * 权限码约定：system:dept:list / add / edit / remove。
 */
@ApiTags('部门管理')
@ApiBearerAuth()
@Controller('dept')
export class DeptController {
  constructor(private readonly deptService: DeptService) {}

  @Get('tree')
  @RequiresPermissions('system:dept:list')
  @ApiOperation({ summary: '部门树' })
  @ApiOkZod(
    'SysDeptTree',
    z.array(deptResponseSchema),
    '返回部门树（含 children）',
  )
  tree(@Query({ schema: queryDeptSchema }) query: QueryDeptInput) {
    return this.deptService.tree(query);
  }

  @Get()
  @RequiresPermissions('system:dept:list')
  @ApiOperation({ summary: '部门平铺列表' })
  @ApiOkZod('SysDeptList', z.array(deptResponseSchema), '返回部门平铺列表')
  list(@Query({ schema: queryDeptSchema }) query: QueryDeptInput) {
    return this.deptService.list(query);
  }

  @Get(':id')
  @RequiresPermissions('system:dept:list')
  @ApiOperation({ summary: '部门详情' })
  @ApiOkZod('SysDept', deptResponseSchema, '返回部门详情')
  detail(@Param('id', { schema: idParamSchema }) id: number) {
    return this.deptService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:dept:add')
  @Auditable({ action: 'system:dept:add', resourceType: 'dept' })
  @Idempotent({ scope: 'system:dept:add' })
  @ApiOperation({ summary: '创建部门' })
  @ApiOkZod('SysDept', deptResponseSchema, '返回创建后的部门')
  create(@Body({ schema: createDeptSchema }) dto: CreateDeptInput) {
    return this.deptService.create(dto);
  }

  @Put(':id')
  @RequiresPermissions('system:dept:edit')
  @Auditable({
    action: 'system:dept:edit',
    resourceType: 'dept',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '更新部门' })
  @ApiOkZod('SysDept', deptResponseSchema, '返回更新后的部门')
  update(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateDeptSchema }) dto: UpdateDeptInput,
  ) {
    return this.deptService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermissions('system:dept:remove')
  @Auditable({
    action: 'system:dept:remove',
    resourceType: 'dept',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除部门（软删除；有下级或仍有用户挂靠则拒绝）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(@Param('id', { schema: idParamSchema }) id: number) {
    return this.deptService.remove(id);
  }
}
