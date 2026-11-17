import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { Repository } from 'typeorm';
import {
  buildPageResult,
  type PageResult,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  type ConfigValueResult,
  type CreateConfigInput,
  type QueryConfigInput,
  type UpdateConfigInput,
} from './dto/config.dto.js';
import { Config } from './entities/config.entity.js';

const MSG_CONFIG_KEY_EXISTS = '参数键已存在';
const MSG_CONFIG_NOT_FOUND = '参数不存在';
const MSG_BUILTIN_CANNOT_REMOVE = '系统内置参数不可删除';
/** 系统内置标记：不可删除（值仍可修改） */
const CONFIG_TYPE_BUILTIN = 'Y';

/**
 * 参数配置服务：统一存放可运行时调整的参数（键值对）。
 * 写操作走事务（txHost.tx），保证「唯一校验 + 落库」原子性。
 */
@Injectable()
export class ConfigService {
  constructor(
    @InjectRepository(Config) private readonly configRepo: Repository<Config>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  async page(query: QueryConfigInput): Promise<PageResult<Config>> {
    const qb = this.configRepo.createQueryBuilder('c');
    if (query.keyword) {
      qb.andWhere('(c.configName LIKE :kw OR c.configKey LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('c.status = :status', { status: query.status });
    }
    qb.orderBy('c.id', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  findById(id: number): Promise<Config | null> {
    return this.configRepo.findOneBy({ id });
  }

  /** 按参数键取值（仅取启用状态），业务侧读取配置的统一入口 */
  async getValue(configKey: string): Promise<ConfigValueResult> {
    const config = await this.configRepo.findOneBy({ configKey, status: 1 });
    if (!config) throw new ApiException(MSG_CONFIG_NOT_FOUND);
    return { configKey: config.configKey, configValue: config.configValue };
  }

  async create(dto: CreateConfigInput): Promise<Config> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Config);
      const exists = await repo.findOneBy({ configKey: dto.configKey });
      if (exists) throw new ApiException(MSG_CONFIG_KEY_EXISTS);
      return repo.save(repo.create(dto));
    });
  }

  /** 更新参数；改键时校验唯一（内置参数允许改值，但键仍受唯一约束保护） */
  async update(id: number, dto: UpdateConfigInput): Promise<Config> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Config);
      const config = await repo.findOneBy({ id });
      if (!config) throw new NotFoundException(MSG_CONFIG_NOT_FOUND);
      if (dto.configKey && dto.configKey !== config.configKey) {
        const dup = await repo.findOneBy({ configKey: dto.configKey });
        if (dup) throw new ApiException(MSG_CONFIG_KEY_EXISTS);
      }
      Object.assign(config, dto);
      return repo.save(config);
    });
  }

  /** 删除参数（软删除）；系统内置参数拒绝删除 */
  async remove(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(Config);
      const config = await repo.findOneBy({ id });
      if (!config) throw new NotFoundException(MSG_CONFIG_NOT_FOUND);
      if (config.configType === CONFIG_TYPE_BUILTIN) {
        throw new ApiException(MSG_BUILTIN_CANNOT_REMOVE);
      }
      await repo.softDelete(id);
      return true;
    });
  }
}
