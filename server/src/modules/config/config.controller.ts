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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import {
  createConfigSchema,
  queryConfigSchema,
  updateConfigSchema,
  type CreateConfigInput,
  type QueryConfigInput,
  type UpdateConfigInput,
} from './dto/config.dto.js';
import { configResponseSchema, configValueResponseSchema } from './dto/config.response.js';
import { ConfigService } from './config.service.js';

const idParamSchema = z.coerce.number().int().positive();
const keyParamSchema = z.string().min(1).max(100);

/**
 * 参数配置管理（通用管理域）。
 * 权限码约定：system:config:list / add / edit / remove。
 *
 * 路由顺序：`/config/key/:configKey` 必须声明在 `/config/:id` 之前，
 * 否则会被 `:id` 匹配吞掉（Express 按注册顺序匹配）。
 */
@ApiTags('参数配置')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @RequiresPermissions('system:config:list')
  @ApiOperation({ summary: '分页查询参数配置' })
  @ApiOkZod('SysConfigPage', pageOf(configResponseSchema), '参数分页结果 { list, total }')
  page(@Query({ schema: queryConfigSchema }) query: QueryConfigInput) {
    return this.configService.page(query);
  }

  // 必须放在 @Get(':id') 之前，避免被 :id 路由吞掉
  @Get('key/:configKey')
  @ApiOperation({ summary: '按参数键取值（登录即可）' })
  @ApiOkZod('SysConfigValue', configValueResponseSchema, '返回 { configKey, configValue }')
  getByKey(
    @Param('configKey', { schema: keyParamSchema }) configKey: string,
  ) {
    return this.configService.getValue(configKey);
  }

  @Get(':id')
  @RequiresPermissions('system:config:list')
  @ApiOperation({ summary: '参数配置详情' })
  @ApiOkZod('SysConfig', configResponseSchema, '返回参数配置详情')
  detail(@Param('id', { schema: idParamSchema }) id: number) {
    return this.configService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:config:add')
  @Auditable({ action: 'system:config:add', resourceType: 'config' })
  @Idempotent({ scope: 'system:config:add' })
  @ApiOperation({ summary: '创建参数配置' })
  @ApiOkZod('SysConfig', configResponseSchema, '返回创建后的参数配置')
  create(@Body({ schema: createConfigSchema }) dto: CreateConfigInput) {
    return this.configService.create(dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:config:edit')
  @Auditable({
    action: 'system:config:edit',
    resourceType: 'config',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'system:config:edit' })
  @ApiOperation({ summary: '更新参数配置' })
  @ApiOkZod('SysConfig', configResponseSchema, '返回更新后的参数配置')
  update(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateConfigSchema }) dto: UpdateConfigInput,
  ) {
    return this.configService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:config:remove')
  @Auditable({
    action: 'system:config:remove',
    resourceType: 'config',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'system:config:remove' })
  @ApiOperation({ summary: '删除参数配置（软删除，系统内置不可删）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(@Param('id', { schema: idParamSchema }) id: number) {
    return this.configService.remove(id);
  }
}
