import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { FileService } from './file.service.js';

/**
 * 超期临时文件回收（每小时一次）。
 *
 * 只回收「上传后一直没绑定任何业务对象」的文件 —— 用户传错、传完放弃、
 * 或前端上传成功但用户没点保存，这些不该永久占着存储。
 *
 * 不回收已绑定（ACTIVE）的文件：它们是业务数据的一部分，
 * 生命周期跟业务对象走（业务解绑后才回到 TEMP，再按 TTL 回收）。
 */
@Injectable()
export class FileCleanupTask {
  private readonly logger = new Logger(FileCleanupTask.name);
  private running = false;

  constructor(
    private readonly fileService: FileService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'file-cleanup' })
  async handle(): Promise<void> {
    // e2e 并行跑时不要插入额外写入，避免污染用例断言
    if (this.config.get<string>('app.env') === 'test') return;

    // 单机多实例 / 上一轮还没跑完时跳过，避免重复删除与日志噪声
    if (this.running) {
      this.logger.debug('上一轮清理尚未结束，跳过本次');
      return;
    }

    this.running = true;
    try {
      const removed = await this.fileService.purgeExpiredTemp();
      if (removed > 0) {
        this.logger.log(`本轮回收 ${removed} 个超期临时文件`);
      }
    } catch (err) {
      // 定时任务不能把进程带崩：记录后等下个周期重试
      this.logger.error(`临时文件回收失败：${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
