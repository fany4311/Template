import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import type { QueryLoginLogInput } from './dto/login-log.dto.js';
import { LoginLog } from './entities/login-log.entity.js';

const MSG_LOG_NOT_FOUND = '登录日志不存在';

/** 登录日志留存天数：`sys_config` 的 `loginlog.retentionDays` > 环境变量 > 默认 90 */
const RETENTION_CONFIG_KEY = 'loginlog.retentionDays';
const DEFAULT_RETENTION_DAYS = 90;
/** 单批删除行数（有长事务会锁住整表，分批 + 每小时继续） */
const PURGE_BATCH_SIZE = 2000;
/** 一轮最多删多少批（2000 × 100 = 20 万/轮，没删完下一小时接着） */
const PURGE_MAX_ROUNDS = 100;

/** 登录日志写入载荷（调用方无需关心 id / 登录时间） */
export interface LoginLogEntry {
  username: string;
  ip?: string;
  userAgent?: string;
  /** 1 成功 / 0 失败 */
  status: number;
  msg?: string;
}

/**
 * 登录日志服务：登录流程旁路记录 + 管理端查询/清理。
 *
 * 注意：`record()` 是旁路写入，**不参与业务事务**，且内部吞掉所有异常，
 * 保证登录成功/失败的结果不受日志写入影响。
 */
@Injectable()
export class LoginLogService {
  private readonly logger = new Logger(LoginLogService.name);

  constructor(
    @InjectRepository(LoginLog) private readonly repo: Repository<LoginLog>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  /** 写入一条登录日志（旁路：失败只打印，不抛出、不阻塞主流程） */
  async record(entry: LoginLogEntry): Promise<void> {
    try {
      await this.repo.insert({
        username: entry.username.slice(0, 50),
        ip: entry.ip?.slice(0, 45),
        userAgent: entry.userAgent?.slice(0, 255),
        status: entry.status,
        msg: entry.msg?.slice(0, 255),
      });
    } catch (err) {
      // 日志写入失败绝不能影响登录本身
      console.error('[LoginLog] 登录日志写入失败', err);
    }
  }

  /** 分页查询（按登录时间倒序） */
  async page(query: QueryLoginLogInput): Promise<PageResult<LoginLog>> {
    const qb = this.repo.createQueryBuilder('l');
    if (query.username) {
      qb.andWhere('l.username LIKE :username', {
        username: `%${query.username}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('l.status = :status', { status: query.status });
    }
    qb.orderBy('l.loginTime', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  /** 删除单条（bigint 主键用 string 接收，硬删） */
  async remove(id: string): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(LoginLog);
      const log = await repo.findOneBy({ id });
      if (!log) throw new NotFoundException(MSG_LOG_NOT_FOUND);
      await repo.delete(id);
      return true;
    });
  }

  /** 清空全部登录日志（DELETE 而非 TRUNCATE，保持事务语义） */
  async clear(): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(LoginLog);
      await repo.createQueryBuilder().delete().execute();
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // 留存
  // -------------------------------------------------------------------------

  /**
   * 登录日志留存天数。
   *
   * 为什么需要：审计有 `OpsService` 的每小时清理，登录日志却一直只有
   * 「手动清空全部」一条路 —— 校园系统一天几千次登录，一年就是几十万行，
   * 既拖慢查询也让 `sys_login_log` 无限膨胀。留存天数做成可配置，
   * 派生项目按本单位合规要求改。
   */
  async retentionDays(): Promise<number> {
    try {
      const rows: Array<{ config_value: string }> =
        await this.repo.manager.query(
          'SELECT config_value FROM sys_config WHERE config_key = ? AND status = 1 LIMIT 1',
          [RETENTION_CONFIG_KEY],
        );
      const parsed = Number(rows[0]?.config_value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    } catch {
      // 未配置是常态；库不可用时也别把定时任务带崩
    }
    const env = Number(process.env.LOGINLOG_RETENTION_DAYS);
    return Number.isFinite(env) && env > 0
      ? Math.floor(env)
      : DEFAULT_RETENTION_DAYS;
  }

  /** 分批删除超期登录日志（按 login_time 走索引） */
  async cleanup(
    days?: number,
  ): Promise<{ deleted: number; retentionDays: number }> {
    const retention = days ?? (await this.retentionDays());
    const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);
    let deleted = 0;

    for (let round = 0; round < PURGE_MAX_ROUNDS; round += 1) {
      const result: { affectedRows?: number } = await this.repo.manager.query(
        'DELETE FROM sys_login_log WHERE login_time < ? ORDER BY id LIMIT ?',
        [cutoff, PURGE_BATCH_SIZE],
      );
      const affected = Number(result.affectedRows ?? 0);
      deleted += affected;
      if (affected < PURGE_BATCH_SIZE) break;
    }

    return { deleted, retentionDays: retention };
  }

  /** 每小时清理一次（与 outbox / 幂等 / 文件 / 审计同节奏） */
  @Cron(CronExpression.EVERY_HOUR, { name: 'loginlog-cleanup' })
  async cleanupTask(): Promise<void> {
    // e2e 并行跑时不要插入额外写入，避免污染用例断言
    if (process.env.NODE_ENV === 'test') return;
    try {
      const { deleted, retentionDays } = await this.cleanup();
      if (deleted > 0) {
        this.logger.log(
          `登录日志清理：删除 ${deleted} 条（留存 ${retentionDays} 天）`,
        );
      }
    } catch (err) {
      // 定时任务不能把进程带崩：记录后等下个周期重试
      this.logger.error(`登录日志清理失败：${(err as Error).message}`);
    }
  }
}
