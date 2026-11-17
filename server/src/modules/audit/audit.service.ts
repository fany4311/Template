import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import type { Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import type { QueryAuditInput } from './dto/audit.dto.js';
import { AuditLog } from './entities/audit-log.entity.js';
import type { AuditEntry } from './audit.types.js';

/** 审计事件名（独立管道入口） */
export const AUDIT_WRITE_EVENT = 'audit.write';

const MSG_AUDIT_NOT_FOUND = '操作日志不存在';

/** 写库重试次数（瞬时故障兜底） */
const PERSIST_ATTEMPTS = 3;
/** 重试退避：50ms → 200ms */
const RETRY_BACKOFF_MS = [50, 200];

/**
 * 审计服务：
 * - 写入：`record()` 投递审计条目 → 落库（两种模式，见下）
 * - 查询：只读分页/详情（审计 append-only，不提供改删）。
 *
 * ## 两种写入模式（`AUDIT_MODE`）
 *
 * - `async`（**默认**）：经进程内事件异步落库。业务延迟不受影响，代价是
 *   「业务成功 + 审计失败」时响应已经返回，补不回来。
 * - `sync`：当前请求内 `await` 落库。等保/审计合规场景用它 —— 至少让
 *   审计失败体现为**请求变慢或在日志里可见**，而不是静默丢一条。
 *   注意：它**不等于**「审计与业务同事务」—— 审计写在自己连接上，
 *   业务事务已提交，失败也无法回滚业务（这是 append-only 审计的固有取舍）。
 *
 * ## 失败兜底
 *
 * 两种模式都会先把条目重试 3 次（50ms / 200ms 退避，扛一下连接抖动）；
 * 最终失败时把**完整条目**打进 pino 错误日志，可从日志重建这条审计。
 * 老实现只打了 action + traceId，等于「知道丢了一条，但不知道丢的是什么」。
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {
    this.logger.setContext(AuditService.name);
  }

  /**
   * 记录一条审计。
   * `sync` 模式返回 Promise，调用方（AuditInterceptor）应当 await / 不阻塞业务；
   * `async` 模式返回 void，条目交给 AuditListener。
   */
  record(entry: AuditEntry): Promise<void> | void {
    if (this.mode === 'sync') {
      return this.persist(entry);
    }
    // 只投递，不 await；由 AuditListener 异步持久化
    this.events.emit(AUDIT_WRITE_EVENT, entry);
  }

  private get mode(): 'sync' | 'async' {
    return this.config.get<string>('app.auditMode') === 'sync'
      ? 'sync'
      : 'async';
  }

  /**
   * 落库（带有限重试）。**永不抛出** —— 审计失败不能反噬业务。
   * 由 AuditListener 与本服务共享（两条路径的失败兜底必须一致）。
   */
  async persist(entry: AuditEntry): Promise<void> {
    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++) {
      try {
        await this.repo.save(this.repo.create(entry));
        return;
      } catch (err) {
        if (attempt === PERSIST_ATTEMPTS) {
          // 最终失败：完整条目进日志，作为可重建的兜底记录
          this.logger.error(
            { err, entry },
            '审计写入失败（已重试 ' + PERSIST_ATTEMPTS + ' 次），条目以下方 entry 为准，可从日志重建',
          );
          return;
        }
        await delay(RETRY_BACKOFF_MS[attempt - 1] ?? 200);
      }
    }
  }

  /** 分页查询操作日志（按操作时间倒序） */
  async page(query: QueryAuditInput): Promise<PageResult<AuditLog>> {
    const qb = this.repo.createQueryBuilder('a');
    if (query.actorName) {
      qb.andWhere('a.actorName LIKE :actorName', {
        actorName: `%${query.actorName}%`,
      });
    }
    if (query.action) {
      qb.andWhere('a.action LIKE :action', { action: `%${query.action}%` });
    }
    if (query.result) {
      qb.andWhere('a.result = :result', { result: query.result });
    }
    if (query.startTime) {
      qb.andWhere('a.createTime >= :startTime', {
        startTime: new Date(query.startTime),
      });
    }
    if (query.endTime) {
      qb.andWhere('a.createTime <= :endTime', {
        endTime: new Date(query.endTime),
      });
    }
    qb.orderBy('a.createTime', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  /** 操作日志详情（bigint 主键用 string 接收） */
  async findById(id: string): Promise<AuditLog> {
    const log = await this.repo.findOneBy({ id });
    if (!log) throw new NotFoundException(MSG_AUDIT_NOT_FOUND);
    return log;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
