import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileBizRegistry } from './file-biz.registry.js';
import { FileCleanupTask } from './file.cleanup.task.js';
import { FileController } from './file.controller.js';
import { FileService } from './file.service.js';
import { FileEntity } from './entities/file.entity.js';
import { FileLink } from './entities/file-link.entity.js';

/**
 * 文件与附件模块（底座能力）。
 *
 * 依赖的底座能力：
 * - 存储  ：`StorageDisk` / `Storage`（@nestjs/storage，全局注册于 CoreModule）
 * - 事务  ：ClsPluginTransactional（绑定/解绑是「关联 + 计数 + 状态」的原子操作）
 * - 审计  ：AuditInterceptor（上传/下载/绑定/解绑/删除都留痕）
 * - 幂等  ：IdempotencyInterceptor（绑定/解绑可安全重试）
 *
 * 与业务的边界：
 * 本模块**不认识任何业务对象**。业务模块通过 `FileBizRegistry.register()`
 * 注入「谁能看这个业务对象的附件」与更严的收件策略，
 * 未注册的 bizType 一律拒绝（fail-closed）。
 *
 * `FileBizRegistry` 必须导出：业务模块在自己模块的 providers 里用它注册，
 * 而 Nest 的 provider 是按模块可见性解析的 —— 不导出会拿到另一个实例。
 */
@Module({
  imports: [TypeOrmModule.forFeature([FileEntity, FileLink])],
  controllers: [FileController],
  providers: [FileService, FileBizRegistry, FileCleanupTask],
  exports: [FileService, FileBizRegistry],
})
export class FileModule {}
