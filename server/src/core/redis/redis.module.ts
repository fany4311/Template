import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service.js';

/**
 * 全局 Redis 模块（ioredis，不依赖 @nestjs-modules/ioredis）。
 * .env: REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_DB
 * 连接失败只告警不阻塞启动（业务用到时再报错）。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const client = new Redis({
          host: config.get<string>('cache.host', 'localhost'),
          port: config.get<number>('cache.port', 6379),
          password: config.get<string>('cache.password') || undefined,
          db: config.get<number>('cache.db', 0),
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            // 指数退避，最多 30s；连不上只警告，不阻塞进程
            const delay = Math.min(times * 500, 30000);
            return delay;
          },
        });
        client.on('error', (err) => {
          // Avoid spamming at startup; Nest logging takes over
          console.error(`[Redis] connection error: ${err.message}`);
        });
        client.on('connect', () => console.log('[Redis] connected'));
        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
