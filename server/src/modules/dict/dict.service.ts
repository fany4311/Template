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
  type CreateDictDataInput,
  type CreateDictTypeInput,
  type QueryDictDataInput,
  type QueryDictTypeInput,
  type UpdateDictDataInput,
  type UpdateDictTypeInput,
} from './dto/dict.dto.js';
import { DictData } from './entities/dict-data.entity.js';
import { DictType } from './entities/dict-type.entity.js';

const MSG_TYPE_EXISTS = '字典类型已存在';
const MSG_TYPE_NOT_FOUND = '字典类型不存在';
const MSG_DATA_NOT_FOUND = '字典数据不存在';

/** 下拉选项返回结构 */
export interface DictOption {
  label: string;
  value: string;
  tagType: string;
}

/**
 * 字典服务：字典类型 + 字典数据。
 * 写操作走事务（txHost.tx），保证类型与数据的一致性。
 *
 * 级联规则：
 * - 改类型标识：同步更新该类型下所有字典数据的 dict_type（updateType）
 * - 删类型：软删该类型下所有字典数据（removeType）
 */
@Injectable()
export class DictService {
  constructor(
    @InjectRepository(DictType)
    private readonly typeRepo: Repository<DictType>,
    @InjectRepository(DictData)
    private readonly dataRepo: Repository<DictData>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
  ) {}

  // ---------------- 字典类型 ----------------

  async pageType(query: QueryDictTypeInput): Promise<PageResult<DictType>> {
    const qb = this.typeRepo.createQueryBuilder('t');
    if (query.keyword) {
      qb.andWhere('(t.dictName LIKE :kw OR t.dictType LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    qb.orderBy('t.id', 'DESC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  async createType(dto: CreateDictTypeInput): Promise<DictType> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(DictType);
      const exists = await repo.findOneBy({ dictType: dto.dictType });
      if (exists) throw new ApiException(MSG_TYPE_EXISTS);
      return repo.save(repo.create(dto));
    });
  }

  async updateType(id: number, dto: UpdateDictTypeInput): Promise<DictType> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(DictType);
      const type = await repo.findOneBy({ id });
      if (!type) throw new NotFoundException(MSG_TYPE_NOT_FOUND);

      const oldDictType = type.dictType;
      if (dto.dictType && dto.dictType !== oldDictType) {
        const dup = await repo.findOneBy({ dictType: dto.dictType });
        if (dup) throw new ApiException(MSG_TYPE_EXISTS);
      }

      Object.assign(type, dto);
      const saved = await repo.save(type);

      // 级联：类型标识变更时同步字典数据
      if (dto.dictType && dto.dictType !== oldDictType) {
        const dataRepo = this.txHost.tx.getRepository(DictData);
        await dataRepo.update(
          { dictType: oldDictType },
          { dictType: dto.dictType },
        );
      }
      return saved;
    });
  }

  async removeType(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(DictType);
      const type = await repo.findOneBy({ id });
      if (!type) throw new NotFoundException(MSG_TYPE_NOT_FOUND);

      // 级联：软删该类型下所有字典数据
      const dataRepo = this.txHost.tx.getRepository(DictData);
      await dataRepo.softDelete({ dictType: type.dictType });

      await repo.softDelete(id);
      return true;
    });
  }

  // ---------------- 字典数据 ----------------

  async pageData(query: QueryDictDataInput): Promise<PageResult<DictData>> {
    const qb = this.dataRepo.createQueryBuilder('d');
    if (query.dictType) {
      qb.andWhere('d.dictType = :dictType', { dictType: query.dictType });
    }
    if (query.keyword) {
      qb.andWhere('(d.dictLabel LIKE :kw OR d.dictValue LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('d.status = :status', { status: query.status });
    }
    qb.orderBy('d.dictSort', 'ASC')
      .addOrderBy('d.id', 'ASC')
      .skip((query.pageNum - 1) * query.pageSize)
      .take(query.pageSize);
    const [list, total] = await qb.getManyAndCount();
    return buildPageResult(list, total);
  }

  async createData(dto: CreateDictDataInput): Promise<DictData> {
    return this.txHost.withTransaction(async () => {
      const typeRepo = this.txHost.tx.getRepository(DictType);
      const type = await typeRepo.findOneBy({ dictType: dto.dictType });
      if (!type) throw new ApiException(MSG_TYPE_NOT_FOUND);

      const repo = this.txHost.tx.getRepository(DictData);
      return repo.save(repo.create(dto));
    });
  }

  async updateData(id: number, dto: UpdateDictDataInput): Promise<DictData> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(DictData);
      const data = await repo.findOneBy({ id });
      if (!data) throw new NotFoundException(MSG_DATA_NOT_FOUND);

      if (dto.dictType && dto.dictType !== data.dictType) {
        const typeRepo = this.txHost.tx.getRepository(DictType);
        const type = await typeRepo.findOneBy({ dictType: dto.dictType });
        if (!type) throw new ApiException(MSG_TYPE_NOT_FOUND);
      }

      Object.assign(data, dto);
      return repo.save(data);
    });
  }

  async removeData(id: number): Promise<boolean> {
    return this.txHost.withTransaction(async () => {
      const repo = this.txHost.tx.getRepository(DictData);
      const data = await repo.findOneBy({ id });
      if (!data) throw new NotFoundException(MSG_DATA_NOT_FOUND);
      await repo.softDelete(id);
      return true;
    });
  }

  // ---------------- 前端下拉选项 ----------------

  /** 查询某类型下的可用选项（仅 status=1），按 dictSort、id 升序 */
  async options(dictType: string): Promise<DictOption[]> {
    const list = await this.dataRepo.find({
      where: { dictType, status: 1 },
      order: { dictSort: 'ASC', id: 'ASC' },
    });
    return list.map((item) => ({
      label: item.dictLabel,
      value: item.dictValue,
      tagType: item.tagType,
    }));
  }
}
