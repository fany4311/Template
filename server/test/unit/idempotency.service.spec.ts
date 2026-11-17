import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../src/common/exceptions/api.exception.js';
import { IdempotencyService } from '../../src/modules/idempotency/idempotency.service.js';

/** 唯一键冲突（mysql2 形态） */
const dupError = Object.assign(new Error('ER_DUP_ENTRY'), {
  code: 'ER_DUP_ENTRY',
  errno: 1062,
});

function makeRepo(overrides: Record<string, unknown> = {}) {
  const repo = {
    insert: vi.fn(),
    findOneBy: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    createQueryBuilder: vi.fn(),
    ...overrides,
  };
  return repo;
}

describe('IdempotencyService.acquire', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: IdempotencyService;

  beforeEach(() => {
    repo = makeRepo();
    service = new IdempotencyService(repo as never);
  });

  it('首次占位成功', async () => {
    repo.insert.mockResolvedValue({});
    await expect(service.acquire('k', 'h', 60)).resolves.toEqual({
      acquired: true,
    });
  });

  it('冲突且能查到记录 → 返回已有记录（交给拦截器回放/判重）', async () => {
    repo.insert.mockRejectedValue(dupError);
    const record = { key: 'k', requestHash: 'h', status: 'done' };
    repo.findOneBy.mockResolvedValue(record);
    await expect(service.acquire('k', 'h', 60)).resolves.toEqual({
      acquired: false,
      record,
    });
    // 查到就返回，不该重试第二次
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it('冲突但查不到记录 → 有限次重试后抛 409，而不是无限递归', async () => {
    repo.insert.mockRejectedValue(dupError);
    repo.findOneBy.mockResolvedValue(null);

    await expect(service.acquire('k', 'h', 60)).rejects.toBeInstanceOf(
      ApiException,
    );
    // 上限 3 次；老实现是无上限递归（此断言同时防止回归）
    expect(repo.insert).toHaveBeenCalledTimes(3);
    expect(repo.findOneBy).toHaveBeenCalledTimes(3);
  });

  it('非唯一键错误直接抛出（不吞真故障）', async () => {
    repo.insert.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await expect(service.acquire('k', 'h', 60)).rejects.toThrow(
      'connect ECONNREFUSED',
    );
    expect(repo.findOneBy).not.toHaveBeenCalled();
  });
});

describe('IdempotencyService.purgeExpired', () => {
  function qbWith(rows: Array<{ key: string }>) {
    const qb = {
      select: () => qb,
      where: () => qb,
      limit: () => qb,
      getRawMany: () => Promise.resolve(rows),
    };
    return qb;
  }

  it('把过期的 key 分批删掉并返回总数', async () => {
    const repo = makeRepo();
    repo.createQueryBuilder
      .mockReturnValueOnce(qbWith([{ key: 'a' }, { key: 'b' }]))
      .mockReturnValueOnce(qbWith([]));
    repo.delete.mockResolvedValue({ affected: 2 });

    const service = new IdempotencyService(repo as never);
    await expect(service.purgeExpired()).resolves.toBe(2);
    expect(repo.delete).toHaveBeenCalledWith(['a', 'b']);
  });

  it('没有过期记录时不执行 DELETE', async () => {
    const repo = makeRepo();
    repo.createQueryBuilder.mockReturnValueOnce(qbWith([]));

    const service = new IdempotencyService(repo as never);
    await expect(service.purgeExpired()).resolves.toBe(0);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
