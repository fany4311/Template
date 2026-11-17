import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { RedisService } from '../../src/core/redis/redis.service.js';

/**
 * 回归保护：Redis 客户端**必须**在模块销毁时关闭。
 *
 * 不关的后果不是「内存泄漏」，而是进程根本不退出 —— 实测表现是
 * `node dist/scripts/authz-sync.js` 跑完 sync 后停在事件循环里，
 * 导致 `template.sh prod start` 无超时地卡在第 4 步（见 docs/坑与约束.md）。
 */
function fakeClient(over: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
    ...over,
  };
}

/** 只给构造函数用一次，断言仍打在上面那个普通对象上（避开 unbound-method 警告） */
function asRedis(client: object): Redis {
  return client as unknown as Redis;
}

describe('RedisService 生命周期', () => {
  it('onModuleDestroy 调 quit() 温和关闭连接', async () => {
    const client = fakeClient();
    await new RedisService(asRedis(client)).onModuleDestroy();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('连接已结束（status=end）时不重复关闭', async () => {
    const client = fakeClient({ status: 'end' });
    await new RedisService(asRedis(client)).onModuleDestroy();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('quit() 失败时退回 disconnect()，不能让异常冒出打断停机', async () => {
    const client = fakeClient({
      quit: vi.fn(async () => {
        throw new Error('Connection is closed.');
      }),
    });
    await expect(
      new RedisService(asRedis(client)).onModuleDestroy(),
    ).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });
});
