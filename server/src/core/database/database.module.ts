import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

/**
 * 全局 TypeORM 模块（多驱动：mysql / mariadb / postgres / sqlite）。
 * .env: DB_TYPE / DB_HOST / DB_PORT / DB_USERNAME / DB_PASSWORD / DB_DATABASE
 *       DB_SYNCHRONIZE（开发 true / 生产 false，生产用 migration）
 *
 * autoLoadEntities: true → 各业务模块 TypeOrmModule.forFeature([XxxEntity])
 * 注册的实体自动加载，无需集中登记。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: config.get<'mysql' | 'mariadb' | 'postgres' | 'sqlite'>(
          'db.type',
          'mysql',
        ),
        host: config.get<string>('db.host', 'localhost'),
        port: config.get<number>('db.port', 3306),
        username: config.get<string>('db.username'),
        password: config.get<string>('db.password'),
        database: config.get<string>('db.database', 'nest_template'),
        autoLoadEntities: true,
        // 开发自动建表；生产必须改为 false 并用 migration 管理
        synchronize: config.get<boolean>('db.synchronize', false),
        // 连接池
        extra: {
          connectionLimit: config.get<number>('db.poolSize', 10),
        },
        logging: config.get<boolean>('db.logging', false),
      }),
    }),
  ],
})
export class DatabaseModule {}
