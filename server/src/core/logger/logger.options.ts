import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Params } from 'nestjs-pino';

const LOG_DIR = './logs';

/**
 * pino 配置：控制台(pino-pretty) + 文件。
 * prod 按天轮转(pino-roll)，dev 单文件。
 */
export function createPinoOptions(config: ConfigService): Params {
  const isProd = config.get<string>('app.env') === 'prod';

  const fileTarget = isProd
    ? {
        target: 'pino-roll',
        options: {
          file: `${LOG_DIR}/app-YYYY-MM-DD.log`,
          frequency: 'daily',
          mkdir: true,
          dateFormat: 'yyyy-MM-dd',
        },
      }
    : {
        target: 'pino/file',
        options: { destination: `${LOG_DIR}/app.log`, mkdir: true },
      };

  return {
    // 中间件默认用裸 `*`，path-to-regexp v8 不认，换成具名通配 `*path`
    forRoutes: [{ path: '*path', method: RequestMethod.ALL }],
    pinoHttp: {
      // 纯应用日志：不自动记 HTTP 请求
      autoLogging: false,
      level: config.get<string>('log.level', 'info'),
      transport: {
        targets: [
          fileTarget,
          {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
        ],
      },
    },
  };
}
