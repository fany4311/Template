import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { AuditService } from './audit.service.js';
import { queryAuditSchema, type QueryAuditInput } from './dto/audit.dto.js';
import { auditResponseSchema } from './dto/audit.response.js';

/** 路径参数 id schema：bigint 主键，用字符串接收 */
const idParamSchema = z.string().regex(/^\d+$/, 'id 必须为数字');

/**
 * 操作日志查询（审计域，只读）。
 * 审计日志 append-only：只提供查询，不提供修改/删除接口。
 * 权限码：system:auditlog:list。
 */
@ApiTags('操作日志')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequiresPermissions('system:auditlog:list')
  @ApiOperation({ summary: '分页查询操作日志' })
  @ApiOkZod('SysAuditLogPage', pageOf(auditResponseSchema), '操作日志分页结果 { list, total }，按时间倒序')
  page(@Query({ schema: queryAuditSchema }) query: QueryAuditInput) {
    return this.auditService.page(query);
  }

  @Get(':id')
  @RequiresPermissions('system:auditlog:list')
  @ApiOperation({ summary: '操作日志详情' })
  @ApiOkZod('SysAuditLog', auditResponseSchema, '返回单条审计记录，不存在则 404')
  detail(@Param('id', { schema: idParamSchema }) id: string) {
    return this.auditService.findById(id);
  }
}
