import { describe, expect, it, vi } from 'vitest';
import { IdempotencyCleanupTask } from '../../src/modules/idempotency/idempotency.cleanup.task.js';
import { OutboxCleanupTask } from '../../src/modules/outbox/outbox.cleanup.task.js';

/** 极简 ConfigService 桩：只实现 get */
function configStub(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as never;
}

describe('IdempotencyCleanupTask', () => {
  it('test 环境直接跳过（不插入额外写入污染 e2e 断言）', async () => {
    const service = { purgeExpired: vi.fn() };
    const task = new IdempotencyCleanupTask(
      service as never,
      configStub({ 'app.env': 'test' }),
    );
    await task.handle();
    expect(service.purgeExpired).not.toHaveBeenCalled();
  });

  it('正常环境按小时回收并记录条数', async () => {
    const service = { purgeExpired: vi.fn().mockResolvedValue(12) };
    const task = new IdempotencyCleanupTask(
      service as never,
      configStub({ 'app.env': 'dev' }),
    );
    await task.handle();
    expect(service.purgeExpired).toHaveBeenCalledTimes(1);
  });

  it('回收失败不抛出（定时任务不能把进程带崩）', async () => {
    const service = {
      purgeExpired: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const task = new IdempotencyCleanupTask(
      service as never,
      configStub({ 'app.env': 'dev' }),
    );
    await expect(task.handle()).resolves.toBeUndefined();
  });

  it('上一轮未结束时跳过（避免并发重复删除）', async () => {
    let release: (n: number) => void = () => {};
    const service = {
      purgeExpired: vi.fn(
        () => new Promise<number>((resolve) => (release = resolve)),
      ),
    };
    const task = new IdempotencyCleanupTask(
      service as never,
      configStub({ 'app.env': 'dev' }),
    );

    const first = task.handle();
    await task.handle(); // 第二次应当直接跳过
    expect(service.purgeExpired).toHaveBeenCalledTimes(1);

    release(0);
    await first;
  });
});

describe('OutboxCleanupTask', () => {
  function qbReturning(rows: Array<{ id: string }>) {
    const qb = {
      select: () => qb,
      where: () => qb,
      andWhere: () => qb,
      limit: () => qb,
      getRawMany: () => Promise.resolve(rows),
    };
    return qb;
  }

  it('test 环境直接跳过', async () => {
    const repo = { createQueryBuilder: vi.fn(), delete: vi.fn() };
    const task = new OutboxCleanupTask(
      repo as never,
      configStub({ 'app.env': 'test' }),
    );
    await task.handle();
    expect(repo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('只删终态（sent / failed），按保留期分批', async () => {
    const repo = {
      createQueryBuilder: vi
        .fn()
        // sent 一批（不足一批即结束）
        .mockReturnValueOnce(qbReturning([{ id: '1' }, { id: '2' }]))
        // failed 一批
        .mockReturnValueOnce(qbReturning([{ id: '3' }])),
      delete: vi.fn().mockResolvedValue({ affected: 2 }),
    };
    const task = new OutboxCleanupTask(
      repo as never,
      configStub({
        'app.env': 'dev',
        'app.outboxSentRetentionDays': 7,
        'app.outboxFailedRetentionDays': 30,
      }),
    );

    await task.handle();
    expect(repo.delete).toHaveBeenNthCalledWith(1, ['1', '2']);
    expect(repo.delete).toHaveBeenNthCalledWith(2, ['3']);
  });

  it('保留期配置非法时回退默认值（不会 NaN 化 cutoff）', async () => {
    const repo = {
      createQueryBuilder: vi.fn().mockReturnValue(qbReturning([])),
      delete: vi.fn(),
    };
    const task = new OutboxCleanupTask(
      repo as never,
      configStub({
        'app.env': 'dev',
        'app.outboxSentRetentionDays': 'abc',
        'app.outboxFailedRetentionDays': -1,
      }),
    );
    await expect(task.handle()).resolves.toBeUndefined();
  });

  it('清理失败不抛出', async () => {
    const repo = {
      createQueryBuilder: vi.fn(() => {
        throw new Error('db down');
      }),
      delete: vi.fn(),
    };
    const task = new OutboxCleanupTask(
      repo as never,
      configStub({ 'app.env': 'dev' }),
    );
    await expect(task.handle()).resolves.toBeUndefined();
  });
});
