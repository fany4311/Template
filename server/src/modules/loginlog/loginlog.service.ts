import { Injectable, NotFoundException } from '@nestjs/common';
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
}
