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
  createDictDataSchema,
  createDictTypeSchema,
  queryDictDataSchema,
  queryDictTypeSchema,
  updateDictDataSchema,
  updateDictTypeSchema,
  type CreateDictDataInput,
  type CreateDictTypeInput,
  type QueryDictDataInput,
  type QueryDictTypeInput,
  type UpdateDictDataInput,
  type UpdateDictTypeInput,
} from './dto/dict.dto.js';
import {
  dictDataResponseSchema,
  dictOptionResponseSchema,
  dictTypeResponseSchema,
} from './dto/dict.response.js';
import { DictService } from './dict.service.js';

const idParamSchema = z.coerce.number().int().positive();
const dictTypeParamSchema = z.string().min(1).max(100);

/**
 * 字典管理（通用管理域）。
 * 权限码约定：system:dict:list / add / edit / remove。
 * 选项接口仅需登录：供前端下拉/标签渲染直接消费。
 */
@ApiTags('字典管理')
@ApiBearerAuth()
@Controller('dict')
export class DictController {
  constructor(private readonly dictService: DictService) {}

  // ---------------- 字典类型 ----------------

  @Get('type')
  @RequiresPermissions('system:dict:list')
  @ApiOperation({ summary: '分页查询字典类型' })
  @ApiOkZod(
    'SysDictTypePage',
    pageOf(dictTypeResponseSchema),
    '字典类型分页结果 { list, total }',
  )
  pageType(@Query({ schema: queryDictTypeSchema }) query: QueryDictTypeInput) {
    return this.dictService.pageType(query);
  }

  @Post('type')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:dict:add')
  @Auditable({ action: 'system:dict:add', resourceType: 'dict' })
  @Idempotent({ scope: 'system:dict:type:add' })
  @ApiOperation({ summary: '创建字典类型' })
  @ApiOkZod('SysDictType', dictTypeResponseSchema, '返回创建后的字典类型')
  createType(@Body({ schema: createDictTypeSchema }) dto: CreateDictTypeInput) {
    return this.dictService.createType(dto);
  }

  @Put('type/:id')
  @RequiresPermissions('system:dict:edit')
  @Auditable({
    action: 'system:dict:edit',
    resourceType: 'dict',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '更新字典类型（改标识时级联更新字典数据）' })
  @ApiOkZod('SysDictType', dictTypeResponseSchema, '返回更新后的字典类型')
  updateType(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateDictTypeSchema }) dto: UpdateDictTypeInput,
  ) {
    return this.dictService.updateType(id, dto);
  }

  @Delete('type/:id')
  @RequiresPermissions('system:dict:remove')
  @Auditable({
    action: 'system:dict:remove',
    resourceType: 'dict',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除字典类型（软删除，级联软删字典数据）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示成功')
  removeType(@Param('id', { schema: idParamSchema }) id: number) {
    return this.dictService.removeType(id);
  }

  // ---------------- 字典数据 ----------------

  @Get('data')
  @RequiresPermissions('system:dict:list')
  @ApiOperation({ summary: '分页查询字典数据' })
  @ApiOkZod(
    'SysDictDataPage',
    pageOf(dictDataResponseSchema),
    '字典数据分页结果 { list, total }',
  )
  pageData(@Query({ schema: queryDictDataSchema }) query: QueryDictDataInput) {
    return this.dictService.pageData(query);
  }

  @Post('data')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:dict:add')
  @Auditable({ action: 'system:dict:add', resourceType: 'dict' })
  @Idempotent({ scope: 'system:dict:data:add' })
  @ApiOperation({ summary: '创建字典数据' })
  @ApiOkZod('SysDictData', dictDataResponseSchema, '返回创建后的字典数据')
  createData(@Body({ schema: createDictDataSchema }) dto: CreateDictDataInput) {
    return this.dictService.createData(dto);
  }

  @Put('data/:id')
  @RequiresPermissions('system:dict:edit')
  @Auditable({
    action: 'system:dict:edit',
    resourceType: 'dict',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '更新字典数据' })
  @ApiOkZod('SysDictData', dictDataResponseSchema, '返回更新后的字典数据')
  updateData(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateDictDataSchema }) dto: UpdateDictDataInput,
  ) {
    return this.dictService.updateData(id, dto);
  }

  @Delete('data/:id')
  @RequiresPermissions('system:dict:remove')
  @Auditable({
    action: 'system:dict:remove',
    resourceType: 'dict',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除字典数据（软删除）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示成功')
  removeData(@Param('id', { schema: idParamSchema }) id: number) {
    return this.dictService.removeData(id);
  }

  // ---------------- 前端下拉选项 ----------------

  @Get('options/:dictType')
  @ApiOperation({ summary: '按类型查询字典选项（登录即可，前端下拉用）' })
  @ApiOkZod(
    'SysDictOptions',
    z.array(dictOptionResponseSchema),
    '返回 [{ label, value, tagType }]',
  )
  options(
    @Param('dictType', { schema: dictTypeParamSchema }) dictType: string,
  ) {
    return this.dictService.options(dictType);
  }
}
