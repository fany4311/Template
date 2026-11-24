import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Redis 客户端注入 token */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * 全局 Redis 模块：提供可注入的 ioredis 客户端。
 * 用法：@Inject(REDIS_CLIENT) private readonly redis: Redis
 * 或直接注入 RedisService（封装了常用方法）。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * 关连接 —— **不加这段，进程永远不退出**。
   *
   * ioredis 的 socket 是活跃 handle，`app.close()` 不会帮你关它。
   * 后果不是「内存泄漏」而是更直接的：
   * - `pnpm authz:sync` / `node dist/scripts/authz-sync.js` 跑完 sync 后
   *   停在事件循环里不退 → `template.sh prod start` **卡在第 4 步**（无超时，永久挂）；
   * - SIGTERM 优雅停机失效：进程不自己退，只能等 PM2 的 kill_timeout 到了
   *   发 SIGKILL —— 所谓「优雅停机」实际上没有优雅过。
   *
   * 用 `quit()` 而不是 `disconnect()`：前者会把已排队的命令发完再关（幂等键、
   * 防重锁这类写入正在途中时，直接断开会让它们静默丢失）；后者会立即抛掉在途命令。
   * 但连接不可达时 `quit()` 可能一直等，所以加 2s 兜底强制断开。
   */
  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'end') return;
    const forceTimer = setTimeout(() => {
      this.logger.warn('Redis 优雅关闭超时，强制断开');
      this.client.disconnect();
    }, 2000);
    // 不让这个定时器自己拖住退出（只会在 quit() 真没回来时触发）
    forceTimer.unref?.();
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(
        `Redis 关闭出错，改为强制断开：${(err as Error).message}`,
      );
      this.client.disconnect();
    } finally {
      clearTimeout(forceTimer);
    }
  }

  /** 取原始 ioredis 客户端（高级用法） */
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string | number, ttlSeconds?: number) {
    if (ttlSeconds) {
      return this.client.set(key, String(value), 'EX', ttlSeconds);
    }
    return this.client.set(key, String(value));
  }

  async del(...keys: string[]) {
    return this.client.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /** 防并发锁：成功返回 true，失败返回 false（已有人持有） */
  async tryLock(key: string, ttlSeconds = 10): Promise<boolean> {
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async unlock(key: string) {
    await this.client.del(key);
  }
}
