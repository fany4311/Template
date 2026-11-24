import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import {
  queryLoginLogSchema,
  type QueryLoginLogInput,
} from './dto/login-log.dto.js';
import { loginLogResponseSchema } from './dto/loginlog.response.js';
import { LoginLogService } from './loginlog.service.js';

/** 路径参数 id schema：bigint 主键，用字符串接收 */
const idParamSchema = z.string().regex(/^\d+$/, 'id 必须为数字');

/**
 * 登录日志管理（系统管理域，只读查询 + 清理）。
 * 权限码约定：system:loginlog:list / system:loginlog:remove。
 */
@ApiTags('登录日志')
@ApiBearerAuth()
@Controller('loginlog')
export class LoginLogController {
  constructor(private readonly loginLogService: LoginLogService) {}

  @Get()
  @RequiresPermissions('system:loginlog:list')
  @ApiOperation({ summary: '分页查询登录日志' })
  @ApiOkZod(
    'SysLoginLogPage',
    pageOf(loginLogResponseSchema),
    '登录日志分页结果 { list, total }，按时间倒序',
  )
  page(@Query({ schema: queryLoginLogSchema }) query: QueryLoginLogInput) {
    return this.loginLogService.page(query);
  }

  @Delete(':id')
  @RequiresPermissions('system:loginlog:remove')
  @Auditable({
    action: 'system:loginlog:remove',
    resourceType: 'loginLog',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除登录日志（硬删）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(@Param('id', { schema: idParamSchema }) id: string) {
    return this.loginLogService.remove(id);
  }

  /** 清空接口：无路径参数，与上面的 :id 路由不冲突（声明顺序仅作可读性保留） */
  @Delete()
  @RequiresPermissions('system:loginlog:remove')
  @Auditable({ action: 'system:loginlog:clear', resourceType: 'loginLog' })
  @ApiOperation({ summary: '清空登录日志' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示清空成功')
  clear() {
    return this.loginLogService.clear();
  }
}
