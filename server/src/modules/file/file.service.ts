import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Storage, StorageDisk } from '@nestjs/storage';
import { createHash } from 'node:crypto';
import { In, IsNull, Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { matchPermission } from '../../common/authz/permission.util.js';
import type { JwtUser } from '../auth/auth.interface.js';
import { FileEntity } from './entities/file.entity.js';
import { FileLink } from './entities/file-link.entity.js';
import type {
  BindFilesInput,
  QueryFileInput,
  UnbindFilesInput,
  UploadFileInput,
} from './dto/file.dto.js';
import { FileBizRegistry, type FileBizContext } from './file-biz.registry.js';
import { TEMP_FILE_TTL_HOURS } from './file.constants.js';
import {
  acceptsExtension,
  resolveAcceptPolicy,
  resolveGlobalAcceptPolicy,
} from './file.policy.js';
import { extOf, sanitizeFileName } from './file.security.js';

const MSG_NOT_FOUND = '文件不存在';

/** 下载句柄：由 controller 决定用 StreamableFile 还是直写响应 */
export interface FileDownload {
  file: FileEntity;
  body: AsyncIterable<Buffer>;
  size: number;
  contentType: string;
  /** RFC 6266 的 Content-Disposition 取值 */
  contentDisposition: string;
  /** 用于协商的弱 ETag（内容寻址，天然可做缓存） */
  etag: string;
}

/** 上传结果：新建或秒传 */
export interface UploadResult {
  file: FileEntity;
  deduped: boolean;
}

/**
 * 文件服务 —— 底座能力，**不含任何业务名词**。
 *
 * 职责边界：
 * - 收件：策略校验、摘要去重、写对象存储、落元数据
 * - 绑定：多态关联（bizType / bizId / bizField），访问判定委托给 `FileBizRegistry`
 * - 取件：鉴权后以流返回（**不暴露** objectKey / bucket，下载统一走后端代理）
 * - 回收：软删 + 「最后一个引用消失才删物理对象」
 *
 * 不在职责内：业务对象本身的权限规则、Excel 解析等 —— 由业务模块通过 registry 注入。
 */
@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);

  constructor(
    @InjectRepository(FileEntity)
    private readonly fileRepo: Repository<FileEntity>,
    @InjectRepository(FileLink)
    private readonly linkRepo: Repository<FileLink>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly storage: Storage,
    private readonly registry: FileBizRegistry,
  ) {}

  // -------------------------------------------------------------------------
  // 收件
  // -------------------------------------------------------------------------

  /**
   * 上传单个文件。
   *
   * `dto.bizType` 可选：先上传后绑定的场景没有业务上下文，用全局策略；
   * 一旦给了 bizType，就按该业务更严的策略复验（见 file.policy.ts）。
   */
  async upload(
    upload: Express.Multer.File | undefined,
    user: JwtUser,
    dto: UploadFileInput,
  ): Promise<UploadResult> {
    if (!upload?.buffer) {
      throw new ApiException('未接收到文件内容');
    }

    const policy = dto.bizType
      ? resolveAcceptPolicy(this.registry.acceptOf(dto.bizType))
      : resolveGlobalAcceptPolicy();

    if (!acceptsExtension(policy, upload.originalname)) {
      throw new ApiException(`不支持的文件类型：.${extOf(upload.originalname)}`);
    }
    if (upload.size > policy.maxSize) {
      throw new ApiException(
        `文件超过大小上限（${Math.round(policy.maxSize / 1024 / 1024)}MB）`,
      );
    }

    const originalName = sanitizeFileName(upload.originalname);
    const ext = extOf(originalName);
    const mime = upload.mimetype || 'application/octet-stream';
    const sha256 = createHash('sha256').update(upload.buffer).digest('hex');

    // 秒传：同一用户已有同内容且未删除的记录 → 直接复用，不重复写盘
    const existing = await this.fileRepo.findOne({
      where: { sha256, uploaderId: user.userId, deleteTime: IsNull() },
    });
    if (existing) {
      return { file: existing, deduped: true };
    }

    const disk = this.storage.disk();
    const objectKey = this.objectKeyOf(sha256, ext, user.userId);
    await disk.put(objectKey, upload.buffer, { contentType: mime });

    const saved = await this.fileRepo.save(
      this.fileRepo.create({
        sha256,
        originalName,
        ext,
        mime,
        size: upload.size,
        disk: this.storage.defaultDisk,
        objectKey,
        uploaderId: user.userId,
        uploaderName: user.username,
        uploaderDeptId: user.deptId ?? null,
        status: 'TEMP',
        refCount: 0,
        expireAt: this.tempExpiry(),
      }),
    );

    this.logger.debug(
      `文件已入库 id=${saved.id} size=${saved.size} key=${objectKey}`,
    );
    return { file: saved, deduped: false };
  }

  // -------------------------------------------------------------------------
  // 绑定 / 解绑
  // -------------------------------------------------------------------------

  /**
   * 把一个或多个已上传文件绑定到业务对象。
   *
   * 全部在一个事务里：引用计数、状态、关联行、业务回调要么全成要么全不成。
   * 重复绑定（唯一键命中）按幂等处理，不报错 —— 前端重试/双击是常态。
   */
  async bind(
    dto: BindFilesInput,
    user: JwtUser,
  ): Promise<{ bound: number; skipped: number }> {
    const ctx = this.ctxOf(user);
    await this.assertCanAccessBiz(ctx, dto.bizType, dto.bizId);

    if (!this.registry.acceptsField(dto.bizType, dto.bizField)) {
      throw new ApiException(`该业务不接受用途为「${dto.bizField}」的附件`);
    }

    const files = await this.fileRepo.find({
      where: { id: In(dto.fileIds), deleteTime: IsNull() },
    });
    if (files.length !== dto.fileIds.length) {
      throw new ApiException(MSG_NOT_FOUND);
    }
    for (const file of files) {
      this.assertCanWrite(file, user);
      this.assertAcceptedByBiz(dto.bizType, file);
    }

    const newlyBound: FileEntity[] = [];

    const result = await this.txHost.withTransaction(async () => {
      const fileRepo = this.txHost.tx.getRepository(FileEntity);
      const linkRepo = this.txHost.tx.getRepository(FileLink);

      for (const file of files) {
        const exists = await linkRepo.findOne({
          where: {
            fileId: file.id,
            bizType: dto.bizType,
            bizId: dto.bizId,
            bizField: dto.bizField,
          },
        });
        if (exists) continue;

        await linkRepo.save(
          linkRepo.create({
            fileId: file.id,
            bizType: dto.bizType,
            bizId: dto.bizId,
            bizField: dto.bizField,
            sort: 0,
            createBy: user.userId,
          }),
        );
        await fileRepo.increment({ id: file.id }, 'refCount', 1);
        await fileRepo.update(
          { id: file.id },
          { status: 'ACTIVE', expireAt: null },
        );
        newlyBound.push(file);
      }

      // 业务后处理（如解析 Excel）。失败则整个绑定回滚，避免半成品
      await this.registry.notifyBound(ctx, dto.bizType, dto.bizId, newlyBound);

      return { bound: newlyBound.length, skipped: files.length - newlyBound.length };
    });

    if (result.bound > 0) {
      this.logger.log(
        `绑定附件 bizType=${dto.bizType} bizId=${dto.bizId} fileIds=${dto.fileIds.join(',')}`,
      );
    }
    return result;
  }

  /** 解绑：只删关联，不动文件本体；引用计数归零后回到 TEMP 等待回收 */
  async unbind(
    dto: UnbindFilesInput,
    user: JwtUser,
  ): Promise<{ unbound: number }> {
    const ctx = this.ctxOf(user);
    await this.assertCanAccessBiz(ctx, dto.bizType, dto.bizId);

    const links = await this.linkRepo.find({
      where: {
        fileId: In(dto.fileIds),
        bizType: dto.bizType,
        bizId: dto.bizId,
        bizField: dto.bizField,
      },
    });
    if (links.length === 0) return { unbound: 0 };

    await this.txHost.withTransaction(async () => {
      const fileRepo = this.txHost.tx.getRepository(FileEntity);
      const linkRepo = this.txHost.tx.getRepository(FileLink);

      await linkRepo.delete({ id: In(links.map((l) => l.id)) });

      for (const fileId of new Set(links.map((l) => l.fileId))) {
        await fileRepo.decrement({ id: fileId }, 'refCount', 1);
        // 引用归零 → 回到 TEMP，超期由清理任务回收
        await fileRepo
          .createQueryBuilder()
          .update(FileEntity)
          .set({ status: 'TEMP', expireAt: this.tempExpiry() })
          .where('id = :id AND ref_count <= 0', { id: fileId })
          .execute();
      }
    });

    return { unbound: links.length };
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  /** 管理端分页（权限码控制入口） */
  async page(query: QueryFileInput): Promise<PageResult<FileEntity>> {
    const qb = this.fileRepo
      .createQueryBuilder('f')
      .where('f.delete_time IS NULL');

    if (query.keyword) {
      qb.andWhere('f.original_name LIKE :kw', { kw: `%${query.keyword}%` });
    }
    if (query.ext) qb.andWhere('f.ext = :ext', { ext: query.ext });
    if (query.status) qb.andWhere('f.status = :status', { status: query.status });
    if (query.uploaderId) {
      qb.andWhere('f.uploader_id = :uid', { uid: query.uploaderId });
    }

    // 按业务对象反查：先取关联的 file_id，避免 JOIN 出重复行、影响 total
    if (query.bizType && query.bizId) {
      const rows: Array<{ file_id: number }> = await this.linkRepo.query(
        `SELECT DISTINCT file_id FROM sys_file_link
          WHERE biz_type = ? COLLATE utf8mb4_unicode_ci
            AND biz_id = ? COLLATE utf8mb4_unicode_ci`,
        [query.bizType, query.bizId],
      );
      const ids = rows.map((r) => r.file_id);
      if (ids.length === 0) return buildPageResult([], 0);
      qb.andWhere('f.id IN (:...ids)', { ids });
    }

    qb.orderBy('f.id', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);

    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  /** 详情（含绑定关系） */
  async detail(
    id: number,
    user: JwtUser,
  ): Promise<{ file: FileEntity; links: FileLink[] }> {
    const file = await this.findOrFail(id);
    await this.assertCanRead(file, user);
    const links = await this.linkRepo.find({ where: { fileId: id } });
    return { file, links };
  }

  /** 业务对象下的附件（用途分组由前端按 bizField 做） */
  async listByBiz(
    bizType: string,
    bizId: string,
    user: JwtUser,
    bizField?: string,
  ): Promise<Array<{ link: FileLink; file: FileEntity }>> {
    const ctx = this.ctxOf(user);
    await this.assertCanAccessBiz(ctx, bizType, bizId);

    const where = { bizType, bizId } as Record<string, unknown>;
    if (bizField) where.bizField = bizField;
    const links = await this.linkRepo.find({
      where,
      order: { bizField: 'ASC', sort: 'ASC', id: 'ASC' },
    });
    if (links.length === 0) return [];

    const files = await this.fileRepo.find({
      where: { id: In(links.map((l) => l.fileId)), deleteTime: IsNull() },
    });
    const byId = new Map(files.map((f) => [f.id, f]));

    return links
      .filter((l) => byId.has(l.fileId))
      .map((l) => ({ link: l, file: byId.get(l.fileId) as FileEntity }));
  }

  // -------------------------------------------------------------------------
  // 下载
  // -------------------------------------------------------------------------

  /**
   * 取下载句柄。
   *
   * 走服务端代理而不是直链：只有这样才能同时满足鉴权、数据隔离、审计与防盗链。
   * 流式返回，不把整个文件读进内存。
   */
  async openDownload(
    id: number,
    user: JwtUser,
  ): Promise<FileDownload> {
    const file = await this.findOrFail(id);
    await this.assertCanRead(file, user);

    const disk: StorageDisk = this.storage.disk(file.disk);
    const { body } = await disk.get(file.objectKey);

    return {
      file,
      body,
      size: file.size,
      contentType: file.mime,
      contentDisposition: contentDisposition(
        'attachment',
        file.originalName,
      ),
      etag: `"${file.sha256.slice(0, 32)}"`,
    };
  }

  // -------------------------------------------------------------------------
  // 删除与回收
  // -------------------------------------------------------------------------

  /**
   * 删除文件：软删元数据 + 解除全部业务绑定 + 删物理对象。
   *
   * 不再区分「被引用就不能删」：删除语义就是「这个文件不要了」，
   * 它在多少个业务对象上挂过，一并解绑。**留痕靠审计**（@Auditable 记录
   * 操作人、目标、结果），这里额外打一条日志说明连带解绑了几处，
   * 便于事后回答「我的附件怎么没了」。
   */
  async remove(id: number, user: JwtUser): Promise<void> {
    const file = await this.findOrFail(id);
    this.assertCanWrite(file, user);

    const boundCount = await this.linkRepo.count({ where: { fileId: id } });
    await this.softRemove(file);

    this.logger.log(
      `删除文件 id=${id} name=${file.originalName} 连带解绑 ${boundCount} 处业务引用`,
    );
  }

  /**
   * 清理超期临时文件（由 file.cleanup.task.ts 定时调用）。
   *
   * 只回收「TEMP + 无业务引用 + 已过期」的文件：
   * 已绑定（ACTIVE）的文件永远不因超期被删，那是业务数据的一部分。
   */
  async purgeExpiredTemp(limit = 200): Promise<number> {
    // expire_at 为 NULL 的 TEMP 属异常数据（正常流转不会产生），
    // 若只按 `expire_at <= now` 过滤，这类行永远匹配不上 → 永久逃逸，故一并回收。
    const expired = await this.fileRepo
      .createQueryBuilder('f')
      .where('f.delete_time IS NULL')
      .andWhere('f.status = :status', { status: 'TEMP' })
      .andWhere('f.ref_count <= 0')
      .andWhere('(f.expire_at IS NULL OR f.expire_at <= :now)', {
        now: new Date(),
      })
      .orderBy('f.id', 'ASC')
      .limit(limit)
      .getMany();

    for (const file of expired) {
      await this.softRemove(file);
    }
    if (expired.length > 0) {
      this.logger.log(`回收超期临时文件 ${expired.length} 个`);
    }
    return expired.length;
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  /**
   * 软删 + 物理删。
   *
   * 不做「还有没有别的记录在用这份字节」的判断：`objectKey` 里带 uploaderId，
   * 一个对象键唯一对应一条记录，删字节不会波及任何其它文件。
   * 这就是「删除 = 确定」得以成立的结构前提。
   *
   * 顺带清掉全部绑定关系：留着是悬空数据，且 `uk_file_link` 会被历史行占住，
   * 导致「同一文件解绑再绑定」冲突。解绑了哪些业务对象由调用方记审计。
   */
  private async softRemove(file: FileEntity): Promise<void> {
    await this.txHost.withTransaction(async () => {
      await this.txHost.tx.getRepository(FileLink).delete({ fileId: file.id });
      await this.txHost.tx.getRepository(FileEntity).softDelete({ id: file.id });
    });

    try {
      await this.storage.disk(file.disk).delete(file.objectKey);
    } catch (err) {
      // 元数据已删，物理对象残留不会造成越权（下载需元数据）；
      // 记 warn 由运维异步清理，不要因为存储抖动让删除接口失败。
      this.logger.warn(
        `物理对象删除失败 key=${file.objectKey}: ${(err as Error).message}`,
      );
    }
  }

  private async findOrFail(id: number): Promise<FileEntity> {
    const file = await this.fileRepo.findOne({
      where: { id, deleteTime: IsNull() },
    });
    if (!file) throw new NotFoundException(MSG_NOT_FOUND);
    return file;
  }

  /** 读权限：上传人 / 文件管理员 / 已绑定业务允许的业务读者 */
  private async assertCanRead(file: FileEntity, user: JwtUser): Promise<void> {
    if (file.uploaderId === user.userId) return;
    if (matchPermission(user.permissions, 'system:file:list')) return;

    const links = await this.linkRepo.find({ where: { fileId: file.id } });
    const ctx = this.ctxOf(user);
    for (const link of links) {
      if (await this.registry.canAccess(ctx, link.bizType, link.bizId)) return;
    }
    // 统一 404：不泄漏「这个 id 存在但你不能看」
    throw new NotFoundException(MSG_NOT_FOUND);
  }

  /** 写权限：上传人 / 文件管理员 */
  private assertCanWrite(file: FileEntity, user: JwtUser): void {
    if (file.uploaderId === user.userId) return;
    if (matchPermission(user.permissions, 'system:file:remove')) return;
    throw new ApiException('无权操作该文件', 403);
  }

  /** 业务对象访问判定委托给业务模块；未注册即拒绝 */
  private async assertCanAccessBiz(
    ctx: FileBizContext,
    bizType: string,
    bizId: string,
  ): Promise<void> {
    if (!this.registry.has(bizType)) {
      throw new ApiException(`未注册的业务类型：${bizType}`, 403);
    }
    if (!(await this.registry.canAccess(ctx, bizType, bizId))) {
      throw new ApiException('无权访问该业务对象', 403);
    }
  }

  /** 绑定前按业务策略再验一次扩展名（业务可收紧到只收 xlsx 之类） */
  private assertAcceptedByBiz(bizType: string, file: FileEntity): void {
    const policy = resolveAcceptPolicy(this.registry.acceptOf(bizType));
    if (!policy.extensions.has(file.ext)) {
      throw new ApiException(
        `业务「${bizType}」不接受 .${file.ext || '无扩展名'} 类型的附件`,
      );
    }
  }

  private ctxOf(user: JwtUser): FileBizContext {
    return {
      userId: user.userId,
      username: user.username,
      deptId: user.deptId,
      roles: user.roles,
      permissions: user.permissions,
      dataScopes: user.dataScopes,
    };
  }

  /**
   * 对象键：服务端生成，**含上传人命名空间**。
   *
   * 结构：`{yyyy}/{MM}/{sha256 前两位}/{uploaderId}/{sha256}.{ext}`
   *
   * - 不含原始文件名（杜绝路径穿越与「用文件名做注入」）
   * - **按上传人隔离**：同一份内容不同人上传各存一份字节，一个对象键只可能被
   *   一条有效记录引用 → 删除时无需判断「还有没有别人在用」，从根上消除
   *   「删一个连带删掉别人」的竞态。牺牲的存储冗余对校内附件量可忽略。
   * - 同用户同内容复用同键（覆盖写幂等，内容必然相同）
   * - 按日期分片，便于生命周期策略与按天归档
   */
  private objectKeyOf(sha256: string, ext: string, uploaderId: number): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const suffix = ext ? `.${ext}` : '';
    return `${yyyy}/${mm}/${sha256.slice(0, 2)}/${uploaderId}/${sha256}${suffix}`;
  }

  private tempExpiry(): Date {
    return new Date(Date.now() + TEMP_FILE_TTL_HOURS * 60 * 60 * 1000);
  }
}

/**
 * RFC 6266 的 Content-Disposition。
 *
 * 中文文件名必须走 `filename*=UTF-8''...`，否则浏览器拿到乱码；
 * ASCII 兜底给老客户端。同时把可能破坏头部的字符替换掉，避免响应头注入。
 */
export function contentDisposition(
  type: 'inline' | 'attachment',
  filename: string,
): string {
  const ascii = filename
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
