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
import { Keep } from '../../common/decorators/keep.decorator.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  exportRows as rowsToCsv,
  readRows,
} from '../../common/import-export/csv.js';
import { USER_EXPORT_COLUMNS, USER_IMPORT_COLUMNS } from './user.csv.js';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { User as CurrentUser } from '../../common/decorators/user.decorator.js';
import type { JwtUser } from '../auth/auth.interface.js';
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from '../auth/dto/password.dto.js';
import {
  createUserSchema,
  exportUserSchema,
  grantRolesSchema,
  queryUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type ExportUserQuery,
  type GrantRolesInput,
  type QueryUserInput,
  type UpdateUserInput,
} from './dto/user.dto.js';
import {
  userResponseSchema,
  userRoleResponseSchema,
} from './dto/user.response.js';
import { UserService } from './user.service.js';

/** 路径参数 id schema（Standard Schema，统一走全局校验管道） */
const idParamSchema = z.coerce.number().int().positive();

const importResultSchema = z.object({
  total: z.number(),
  ok: z.number(),
  failed: z.array(z.object({ row: z.number(), message: z.string() })),
  failedTruncated: z.boolean(),
});

/**
 * 用户管理接口。
 * 权限码约定：system:user:list / add / edit / remove / grant。
 */
@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequiresPermissions('system:user:list')
  @ApiOperation({ summary: '分页查询用户（受 dataScope 约束）' })
  @ApiOkZod(
    'SysUserPage',
    pageOf(userResponseSchema),
    '分页结果 { list, total }',
  )
  page(
    @Query({ schema: queryUserSchema }) query: QueryUserInput,
    @CurrentUser() user: JwtUser,
  ) {
    return this.userService.page(query, user);
  }

  @Get('export')
  @RequiresPermissions('system:user:export')
  @Auditable({ action: 'system:user:export', resourceType: 'user' })
  @ApiOperation({ summary: '导出用户（CSV，最多 5000 条，按数据范围）' })
  @ApiProduces('text/csv')
  @Keep()
  async exportCsv(
    @Query({ schema: exportUserSchema }) query: ExportUserQuery,
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const rows = await this.userService.exportRows(query, user);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="users-' + date + '.csv"',
    );
    return new StreamableFile(
      Buffer.from(rowsToCsv(rows, USER_EXPORT_COLUMNS), 'utf8'),
    );
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:user:import')
  @Auditable({ action: 'system:user:import', resourceType: 'user' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: 2 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: '导入用户（CSV，逐行返回失败原因）' })
  @ApiOkZod('UserImportResult', importResultSchema, '导入结果')
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new ApiException('请选择要导入的 CSV 文件', 400);
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      throw new ApiException(
        '只支持 .csv 文件（Excel 请另存为 CSV UTF-8）',
        400,
      );
    }
    const records = readRows(file.buffer.toString('utf8'), USER_IMPORT_COLUMNS);
    return this.userService.importRows(records);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:user:add')
  @Auditable({ action: 'system:user:add', resourceType: 'user' })
  @Idempotent({ scope: 'system:user:add' })
  @ApiOperation({ summary: '创建用户' })
  @ApiOkZod('SysUser', userResponseSchema, '返回创建后的用户')
  create(@Body({ schema: createUserSchema }) dto: CreateUserInput) {
    return this.userService.create(dto);
  }

  @Put(':id')
  @RequiresPermissions('system:user:edit')
  @Auditable({
    action: 'system:user:edit',
    resourceType: 'user',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '更新用户' })
  @ApiOkZod('SysUser', userResponseSchema, '返回更新后的用户')
  update(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateUserSchema }) dto: UpdateUserInput,
  ) {
    return this.userService.update(id, dto);
  }

  @Delete(':id')
  @RequiresPermissions('system:user:remove')
  @Auditable({
    action: 'system:user:remove',
    resourceType: 'user',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除用户（软删除）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(
    @Param('id', { schema: idParamSchema }) id: number,
    @CurrentUser() operator: JwtUser,
  ) {
    return this.userService.remove(id, operator.userId);
  }

  /**
   * 管理员重置他人密码（不需要原密码）。
   *
   * 与自助改密的区别：这里**只换新密码**，靠 `system:user:reset-pwd` 控权；
   * 若要求管理员也知道旧密码，等于强迫共享口令，审计反而没法追责。
   * 重置后目标用户的会话立即失效，他下次必须用新密码登录。
   */
  @Put(':id/password')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:user:reset-pwd')
  @Idempotent({ scope: 'system:user:reset-pwd', required: false })
  @Auditable({
    action: 'system:user:reset-pwd',
    resourceType: 'user',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '重置指定用户密码' })
  @ApiOkZod('VoidResult', null, '重置成功，无返回体；目标用户需重新登录')
  resetPassword(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: resetPasswordSchema }) dto: ResetPasswordInput,
  ) {
    return this.userService.updatePassword(id, dto.newPassword);
  }

  @Get(':id/roles')
  @RequiresPermissions('system:user:list')
  @ApiOperation({ summary: '用户角色授权列表' })
  @ApiOkZod(
    'SysUserRoles',
    z.array(userRoleResponseSchema),
    '授权记录列表（含临时授权到期时间）',
  )
  listGrants(@Param('id', { schema: idParamSchema }) id: number) {
    return this.userService.listGrants(id);
  }

  @Post(':id/roles')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:user:grant')
  @Auditable({
    action: 'system:user:grant',
    resourceType: 'user',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '授予角色（expireAt 非空则为临时授权）' })
  @ApiOkZod('VoidResult', null, '授权成功，无返回体')
  grantRoles(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: grantRolesSchema }) dto: GrantRolesInput,
    @CurrentUser() operator: JwtUser,
  ) {
    return this.userService.grantRoles(id, dto.roleIds, {
      expireAt: dto.expireAt ? new Date(dto.expireAt) : null,
      grantedBy: operator.userId,
    });
  }

  @Delete(':id/roles/:roleId')
  @RequiresPermissions('system:user:grant')
  @Auditable({
    action: 'system:user:revoke',
    resourceType: 'user',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '撤销角色授权' })
  @ApiOkZod('VoidResult', null, '撤销成功，无返回体')
  revokeRole(
    @Param('id', { schema: idParamSchema }) id: number,
    @Param('roleId', { schema: idParamSchema }) roleId: number,
  ) {
    return this.userService.revokeRole(id, roleId);
  }
}
