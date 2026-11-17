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
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Keep } from '../../common/decorators/keep.decorator.js';
import {
  exportRows as rowsToCsv,
  readRows,
} from '../../common/import-export/csv.js';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { CONFIG_CSV_COLUMNS } from './config.csv.js';
import {
  createConfigSchema,
  exportConfigSchema,
  queryConfigSchema,
  updateConfigSchema,
  type ConfigExportQuery,
  type CreateConfigInput,
  type QueryConfigInput,
  type UpdateConfigInput,
} from './dto/config.dto.js';
import { configResponseSchema, configValueResponseSchema } from './dto/config.response.js';
import { ConfigService } from './config.service.js';

const idParamSchema = z.coerce.number().int().positive();
const keyParamSchema = z.string().min(1).max(100);

/** 导入结果契约（供 OpenAPI 与契约测试复用） */
const importResultSchema = z.object({
  total: z.number(),
  ok: z.number(),
  failed: z.array(z.object({ row: z.number(), message: z.string() })),
  failedTruncated: z.boolean(),
});

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

  // ---------------------------------------------------------------------------
  // 导入 / 导出（CSV）
  // 两条路由都必须声明在 @Get(':id') 之前，否则 'export' 会被 :id 吞掉
  // ---------------------------------------------------------------------------

  @Get('export')
  @RequiresPermissions('system:config:export')
  @Auditable({ action: 'system:config:export', resourceType: 'config' })
  @ApiOperation({ summary: '导出参数配置（CSV，最多 5000 行）' })
  @ApiProduces('text/csv')
  @Keep()
  async exportCsv(
    @Query({ schema: exportConfigSchema }) query: ConfigExportQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rows = await this.configService.exportRows(query);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="config-' + date + '.csv"',
    );
    return new StreamableFile(Buffer.from(rowsToCsv(rows, CONFIG_CSV_COLUMNS), 'utf8'));
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:config:import')
  @Auditable({ action: 'system:config:import', resourceType: 'config' })
  // 导入是重操作：限制文件大小（multer 在入内存前就拒），行数上限在 readRows 里
  @UseInterceptors(
    FileInterceptor('file', { limits: { files: 1, fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiOperation({ summary: '导入参数配置（CSV，最多 5000 行，逐行返回失败原因）' })
  @ApiOkZod('ConfigImportResult', importResultSchema, '导入结果')
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApiException('请选择要导入的 CSV 文件', 400);
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new ApiException('只支持 .csv 文件（Excel 请另存为 CSV UTF-8）', 400);
    }
    const records = readRows(file.buffer.toString('utf8'), CONFIG_CSV_COLUMNS);
    return this.configService.importRows(records);
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
