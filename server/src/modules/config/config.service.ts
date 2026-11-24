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
  CSV_MAX_FAILED,
  CSV_MAX_ROWS,
  type ImportFailure,
  type ImportResult,
} from '../../common/import-export/csv.js';
import { configImportRowSchema } from './config.csv.js';
import {
  type ConfigExportQuery,
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

  /**
   * 导出：与列表同样的筛选条件，顺序稳定（id 升序）。
   * 超上限直接拒绝而不是静默截断 —— 截断的文件看不出少了数据，比报错危险。
   */
  async exportRows(query: ConfigExportQuery): Promise<Config[]> {
    const qb = this.configRepo.createQueryBuilder('c');
    if (query.keyword) {
      qb.andWhere('(c.configName LIKE :kw OR c.configKey LIKE :kw)', {
        kw: '%' + query.keyword + '%',
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('c.status = :status', { status: query.status });
    }
    const rows = await qb
      .orderBy('c.id', 'ASC')
      .limit(CSV_MAX_ROWS + 1)
      .getMany();
    if (rows.length > CSV_MAX_ROWS) {
      throw new ApiException(
        '单次最多导出 ' + CSV_MAX_ROWS + ' 行，请先按关键字或状态缩小范围',
      );
    }
    return rows;
  }

  /**
   * 逐行导入：部分成功。
   *
   * 为什么不做整单事务：5000 行里错 3 行就全部回滚，用户必须改到全对才能用，
   * 体验极差。这里逐行独立写入并回报失败行号，改完重试即可；
   * 已存在的参数键按失败返回，不会覆盖线上值。
   */
  async importRows(records: Record<string, string>[]): Promise<ImportResult> {
    const failed: ImportFailure[] = [];
    let ok = 0;
    let failedTruncated = false;

    const pushFailure = (row: number, message: string): void => {
      if (failed.length < CSV_MAX_FAILED) failed.push({ row, message });
      else failedTruncated = true;
    };

    for (let index = 0; index < records.length; index += 1) {
      const rowNo = index + 2; // 表头占 1 行，数据从第 2 行起，与 Excel 行号对齐
      const parsed = configImportRowSchema.safeParse(records[index]);
      if (!parsed.success) {
        pushFailure(rowNo, parsed.error.issues[0]?.message ?? '格式不正确');
        continue;
      }

      const row = parsed.data;
      try {
        const exists = await this.configRepo.findOneBy({
          configKey: row.configKey,
        });
        if (exists) {
          pushFailure(rowNo, '参数键已存在：' + row.configKey);
          continue;
        }
        await this.configRepo.insert({ ...row });
        ok += 1;
      } catch {
        pushFailure(rowNo, '写入失败，请检查参数值长度');
      }
    }

    return { total: records.length, ok, failed, failedTruncated };
  }
}
