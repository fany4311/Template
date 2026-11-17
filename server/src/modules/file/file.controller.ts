import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Readable } from 'node:stream';
import type { Response } from 'express';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { Keep } from '../../common/decorators/keep.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { User } from '../../common/decorators/user.decorator.js';
import type { JwtUser } from '../auth/auth.interface.js';
import { MAX_FILE_SIZE } from './file.constants.js';
import { FileContentTypeValidator, FileExtValidator } from './file.security.js';
import {
  queryBizFileSchema,
  queryFileSchema,
  uploadFileSchema,
  bindFilesSchema,
  unbindFilesSchema,
  type BindFilesInput,
  type QueryBizFileInput,
  type QueryFileInput,
  type UnbindFilesInput,
  type UploadFileInput,
} from './dto/file.dto.js';
import {
  bindResultSchema,
  bizFileListSchema,
  fileDetailResponseSchema,
  fileRemoveResultSchema,
  fileResponseSchema,
  unbindResultSchema,
  uploadResultSchema,
} from './dto/file.response.js';
import { toFileView, toLinkView } from './dto/file.mapper.js';
import { FILE_PERMISSIONS } from './file.constants.js';
import { FileService } from './file.service.js';

/**
 * 文件与附件（底座能力，无业务名词）。
 *
 * 权限模型是**两层**的，与隐患模块同一思路：
 * - 系统管理动作（列表/删除任意文件）用 RBAC 权限码 `system:file:*`
 * - 业务附件（上传/绑定/查看）走 `FileBizRegistry` 委托给业务模块判定，
 *   底座不写死任何业务规则
 *
 * 上传走 multipart，落盘策略见 FileService.upload：
 * 服务端判类型（Magic Number）、服务端生成对象键、同内容秒传。
 */
@ApiTags('文件与附件')
@ApiBearerAuth()
@Controller('file')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  // -------------------------------------------------------------------------
  // 上传
  // -------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.OK)
  // 上传是重操作，单独收紧限流（全局是 300/min）
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  // limits 交一点给 multer：超限直接 413 且不入内存，比在 Pipe 里判更早更省
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { files: 1, fileSize: MAX_FILE_SIZE },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        bizType: { type: 'string', description: '业务类型（可选，用于收紧收件策略）' },
        bizId: { type: 'string', description: '业务对象 id（可选）' },
        bizField: { type: 'string', description: '附件用途（可选）' },
      },
    },
  })
  @ApiOperation({
    summary: '上传文件（服务端判定类型、内容寻址去重、可选立即绑定）',
  })
  @ApiOkZod('FileUploadResult', uploadResultSchema, '上传结果 { file, deduped }')
  @Auditable({ action: 'system:file:upload', resourceType: 'file' })
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [
          new MaxFileSizeValidator({
            maxSize: MAX_FILE_SIZE,
            message: `文件不能超过 ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`,
          }),
          // 二进制看 Magic Number、文本看内容特征；都不依赖客户端声明的 MIME
          new FileContentTypeValidator(),
          new FileExtValidator(),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body({ schema: uploadFileSchema }) dto: UploadFileInput,
    @User() user: JwtUser,
  ) {
    const result = await this.fileService.upload(file, user, dto);
    return { file: toFileView(result.file), deduped: result.deduped };
  }

  // -------------------------------------------------------------------------
  // 业务附件（鉴权委托给业务模块）
  // -------------------------------------------------------------------------

  @Get('biz/:bizType/:bizId')
  @ApiOperation({ summary: '查询业务对象下的附件（鉴权由业务模块判定）' })
  @ApiOkZod('BizFileList', bizFileListSchema, '附件列表 [{ link, file }]')
  async listByBiz(
    @Param('bizType') bizType: string,
    @Param('bizId') bizId: string,
    @Query({ schema: queryBizFileSchema }) query: QueryBizFileInput,
    @User() user: JwtUser,
  ) {
    const items = await this.fileService.listByBiz(
      bizType,
      bizId,
      user,
      query.bizField,
    );
    return items.map((item) => ({
      link: toLinkView(item.link),
      file: toFileView(item.file),
    }));
  }

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: '把已上传文件绑定到业务对象（重复绑定幂等）' })
  @ApiOkZod('FileBindResult', bindResultSchema, '绑定结果 { bound, skipped }')
  @Auditable({ action: 'system:file:bind', resourceType: 'file' })
  bind(@Body({ schema: bindFilesSchema }) dto: BindFilesInput, @User() user: JwtUser) {
    return this.fileService.bind(dto, user);
  }

  @Post('unbind')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @ApiOperation({ summary: '从业务对象解绑文件（不删文件本体）' })
  @ApiOkZod('FileUnbindResult', unbindResultSchema, '解绑结果 { unbound }')
  @Auditable({ action: 'system:file:unbind', resourceType: 'file' })
  unbind(
    @Body({ schema: unbindFilesSchema }) dto: UnbindFilesInput,
    @User() user: JwtUser,
  ) {
    return this.fileService.unbind(dto, user);
  }

  // -------------------------------------------------------------------------
  // 管理端与下载
  // -------------------------------------------------------------------------

  @Get()
  @RequiresPermissions(FILE_PERMISSIONS.LIST)
  @ApiOperation({ summary: '分页查询文件（管理端）' })
  @ApiOkZod('FilePage', pageOf(fileResponseSchema), '文件分页结果 { list, total }')
  async page(@Query({ schema: queryFileSchema }) query: QueryFileInput) {
    const { list, total } = await this.fileService.page(query);
    return { list: list.map(toFileView), total };
  }

  @Get(':id')
  @ApiOperation({ summary: '文件详情（含绑定关系）' })
  @ApiOkZod('FileDetail', fileDetailResponseSchema, '文件详情 { file, links }')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @User() user: JwtUser,
  ) {
    const { file, links } = await this.fileService.detail(id, user);
    return { file: toFileView(file), links: links.map(toLinkView) };
  }

  @Get(':id/download')
  @Keep()
  @ApiOperation({
    summary: '下载文件（服务端代理：鉴权 + 审计 + 防盗链，流式返回）',
  })
  @Auditable({
    action: 'system:file:download',
    resourceType: 'file',
    resourceIdParam: 'id',
  })
  async download(
    @Param('id', ParseIntPipe) id: number,
    @User() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dl = await this.fileService.openDownload(id, user);
    res.setHeader('Content-Type', dl.contentType);
    res.setHeader('Content-Disposition', dl.contentDisposition);
    res.setHeader('Content-Length', String(dl.size));
    res.setHeader('ETag', dl.etag);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // 附件属于私密内容，禁止中间代理缓存
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Readable.from(dl.body));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  // 不挂权限码：上传人删自己传错的文件是正常操作。
  // 真正的边界在 FileService.assertCanWrite（上传人本人 / system:file:remove 管理员），
  // 在这里加权限码反而会把「删自己的文件」也挡掉。
  @ApiOperation({ summary: '删除文件（上传人本人或文件管理员；软删）' })
  @ApiOkZod('FileRemoveResult', fileRemoveResultSchema, '删除结果')
  @Auditable({
    action: 'system:file:remove',
    resourceType: 'file',
    resourceIdParam: 'id',
  })
  async remove(@Param('id', ParseIntPipe) id: number, @User() user: JwtUser) {
    await this.fileService.remove(id, user);
    return null;
  }
}
