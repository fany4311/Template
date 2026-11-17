import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditService } from './audit.service.js';
import { AUDIT_WRITE_EVENT } from './audit.service.js';
import type { AuditEntry } from './audit.types.js';

/**
 * 审计落库监听器：订阅 audit.write 事件，append-only 写入 sys_audit_log。
 *
 * - 落库与重试/失败兜底统一走 `AuditService.persist()`，两条路径（sync / async）
 *   行为一致：失败也不会反噬业务，但**完整条目一定进日志**。
 * - 记录在途写入，进程停机时先排空，避免"连接已关仍写审计"的报错。
 */
@Injectable()
export class AuditListener implements OnApplicationShutdown {
  private readonly inflight = new Set<Promise<void>>();

  constructor(private readonly audit: AuditService) {}

  @OnEvent(AUDIT_WRITE_EVENT, { async: true })
  handle(entry: AuditEntry): Promise<void> {
    const task = this.audit.persist(entry).finally(() => {
      this.inflight.delete(task);
    });
    this.inflight.add(task);
    return task;
  }

  /** 关机时排空在途审计写入（优雅停机） */
  async onApplicationShutdown(): Promise<void> {
    if (this.inflight.size) {
      await Promise.allSettled(this.inflight);
    }
  }
}
