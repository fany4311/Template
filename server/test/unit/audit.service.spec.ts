import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../src/modules/audit/audit.service.js';
import type { AuditEntry } from '../../src/modules/audit/audit.types.js';

const ENTRY: AuditEntry = {
  traceId: 'trace-1',
  actorId: 1,
  actorName: 'tester',
  action: 'system:user:add',
  result: 'success',
  method: 'POST',
  path: '/api/v1/user',
  ip: '127.0.0.1',
  durationMs: 5,
};

function makeRepo(saveImpl?: () => Promise<unknown>) {
  return {
    save: vi.fn(saveImpl ?? (() => Promise.resolve({}))),
    create: vi.fn((v: unknown) => v),
    createQueryBuilder: vi.fn(),
    findOneBy: vi.fn(),
  };
}

function makeLogger() {
  return {
    setContext: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

function makeService(opts: {
  mode?: string;
  repo?: ReturnType<typeof makeRepo>;
  events?: { emit: () => void };
}) {
  const repo = opts.repo ?? makeRepo();
  const events = opts.events ?? { emit: vi.fn() };
  const logger = makeLogger();
  const config = {
    get: (key: string) =>
      key === 'app.auditMode' ? (opts.mode ?? 'async') : undefined,
  };
  const service = new AuditService(
    events as never,
    config as never,
    logger as never,
    repo as never,
  );
  return { service, repo, events, logger };
}

describe('AuditService.record', () => {
  it('async（默认）：只投递事件，不 await 落库 → 返回 void', () => {
    const { service, repo, events } = makeService({});
    const ret = service.record(ENTRY);
    expect(ret).toBeUndefined();
    expect(events.emit).toHaveBeenCalledWith('audit.write', ENTRY);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('sync：请求内直接落库并返回 Promise', async () => {
    const { service, repo, events } = makeService({ mode: 'sync' });
    const ret = service.record(ENTRY);
    expect(ret).toBeInstanceOf(Promise);
    await ret;
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('AUDIT_MODE 非法值（含大写）按 async 处理，不静默变 sync', () => {
    for (const mode of ['SYNCED', 'sync ', 'yes', '1']) {
      const { service, events } = makeService({ mode });
      void service.record(ENTRY);
      // 'sync ' 被 trim 后是 sync，属于合法值；其余应回退 async
      if (mode.trim().toLowerCase() === 'sync') continue;
      expect(events.emit).toHaveBeenCalled();
    }
  });
});

describe('AuditService.persist（失败兜底）', () => {
  it('瞬时失败会重试，成功后不报错', async () => {
    let calls = 0;
    const repo = makeRepo(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('deadlock'))
        : Promise.resolve({});
    });
    const { service, logger } = makeService({ mode: 'sync', repo });

    await expect(service.persist(ENTRY)).resolves.toBeUndefined();
    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('重试耗尽 → 不抛出，但把**完整条目**打进日志（可从日志重建）', async () => {
    const repo = makeRepo(() => Promise.reject(new Error('db down')));
    const { service, logger } = makeService({ mode: 'sync', repo });

    await expect(service.persist(ENTRY)).resolves.toBeUndefined();
    expect(repo.save).toHaveBeenCalledTimes(3);

    const [, msg] = logger.error.mock.calls[0] as [unknown, string];
    const payload = logger.error.mock.calls[0]?.[0] as { entry?: AuditEntry };
    expect(String(msg)).toContain('审计写入失败');
    // 老实现只记 action + traceId，丢的内容无法重建
    expect(payload.entry).toEqual(ENTRY);
  });
});
