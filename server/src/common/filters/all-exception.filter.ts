import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { ApiException } from '../exceptions/api.exception.js';

interface ErrorBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

/**
 * 全局异常过滤器：与 TransformInterceptor 保持一致，统一输出 { code, msg, data }。
 *   - ApiException（业务异常）→ HTTP 200 + 业务 code（若依约定，前端统一看 body.code）
 *   - HttpException（框架异常）→ 原始 HTTP 状态 + code 取 statusCode
 *   - QueryFailedError（数据库）→ 500，不泄露 SQL
 *   - 其他 Error → 500
 *
 * 开关：.env FILTER_ENABLED=false 时退回 Nest 默认响应。
 */
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
    private readonly cls: ClsService,
  ) {
    this.logger.setContext(AllExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 开关：关闭时退回框架默认行为
    if (!this.config.get<boolean>('app.filterEnabled', true)) {
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;
      response
        .status(status)
        .json(
          exception instanceof HttpException
            ? exception.getResponse()
            : { statusCode: status, message: 'Internal Server Error' },
        );
      return;
    }

    const path = request.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let data: unknown;

    if (exception instanceof ApiException) {
      // 业务异常：HTTP 200，业务码在 code（若依约定）
      status = HttpStatus.OK;
      code = exception.getErrCode();
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        // 直接用字符串构造的 HttpException（如 ThrottlerException）没有 statusCode 字段。
        // 不显式补 code 就会沿用初值 500 —— 前端按 body.code 判时会把 429/403
        // 误报成“服务器错误”。内置异常（NotFoundException 等）走 createBody 生成对象，
        // 不走这一支，所以这个坑只在“字符串构造 + 非 500 状态码”时发作。
        code = status;
        data = res;
      } else {
        const body = res as ErrorBody;
        message = Array.isArray(body.message)
          ? body.message.join('; ')
          : (body.message ?? body.error ?? '');
        data = body.message;
        code = body.statusCode ?? status;
      }
    } else if (exception instanceof Error) {
      // 数据库错误：不泄露 SQL 给客户端
      if (exception.name === 'QueryFailedError') {
        message = '数据库操作失败';
      } else {
        message = exception.message || 'Internal Server Error';
      }
    }

    this.logger.error({ err: exception, status, code, path }, message);

    // traceId 与响应头 X-Trace-Id 一致，便于对照日志/链路定位问题
    response
      .status(status)
      .json({ code, msg: message, data, traceId: this.cls.getId() });
  }
}
