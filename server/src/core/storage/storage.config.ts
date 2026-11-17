import type { ConfigService } from '@nestjs/config';
import { InMemoryDisk, LocalDisk, S3Disk, type StorageModuleOptions } from '@nestjs/storage';

/**
 * 存储引擎装配。
 *
 * 底座只认 **disk 名字**，不认具体厂商：业务代码注入 `StorageDisk`（或
 * `@InjectDisk('name')`）即可，换引擎只改这里的工厂，业务代码零改动。
 * 这也是「可拔插」的落点 —— 与早先自写的 StoragePort 相比，少一层适配：
 * `StorageDisk` 本身就是抽象类（Local / S3 / 内存 同一套 put/get/stat/signedUrl）。
 *
 * 支持的驱动：
 * - `s3`    ：S3 兼容对象存储（MinIO / AWS / R2 / B2），**生产用这个**
 * - `local` ：本地目录，适合单机部署或离线演示
 * - `memory`：进程内存，仅供测试（e2e 不依赖外部服务）
 */
export type StorageDriver = 's3' | 'local' | 'memory';

/**
 * 由配置构造盘实例。
 *
 * 注意 `disks` 里放的是**实例**而不是类：本工厂持有配置，构造参数在此一次算清；
 * 放类的话 Nest 需要实例化，而它拿不到 ConfigService 里的这些值。
 */
export function createStorageOptions(config: ConfigService): StorageModuleOptions {
  const driver = config.getOrThrow<StorageDriver>('storage.driver');
  const diskName = config.getOrThrow<string>('storage.disk');

  return {
    default: diskName,
    disks: { [diskName]: buildDisk(driver, config) },
  };
}

function buildDisk(driver: StorageDriver, config: ConfigService) {
  switch (driver) {
    case 'memory':
      return new InMemoryDisk();

    case 'local':
      return new LocalDisk({
        root: config.getOrThrow<string>('storage.local.root'),
      });

    case 's3':
      return new S3Disk({
        bucket: config.getOrThrow<string>('storage.s3.bucket'),
        endpoint: config.getOrThrow<string>('storage.s3.endpoint'),
        region: config.getOrThrow<string>('storage.s3.region'),
        // MinIO 等自建存储必须用 path-style：`/bucket/key` 而非 `bucket.host/key`
        forcePathStyle: config.getOrThrow<boolean>('storage.s3.forcePathStyle'),
        credentials: {
          accessKeyId: config.getOrThrow<string>('storage.s3.accessKey'),
          secretAccessKey: config.getOrThrow<string>('storage.s3.secretKey'),
        },
        // 服务端加密：MinIO 未开 KMS 时不要设，否则请求会带不支持的头部
        ...(config.get<boolean>('storage.s3.serverSideEncryption')
          ? { serverSideEncryption: 'AES256' as const }
          : {}),
      });

    default: {
      // 穷举保护：新增驱动时编译期就会报错，而不是运行时静默落到某分支
      const never: never = driver;
      throw new Error(`未知的存储驱动：${String(never)}`);
    }
  }
}
