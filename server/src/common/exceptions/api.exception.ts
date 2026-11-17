import { HttpException } from '@nestjs/common';

/**
 * 业务异常：service 里主动抛出，由全局过滤器转成 { code, msg } 响应。
 * 用法：throw new ApiException('用户名或密码错误', 500);
 *
 * 约定（与参考项目一致）：HTTP 状态码固定 200，业务码放 errCode，
 * 前端统一从 body.code 判断成功/失败，规避跨域/gateway 对 4xx/5xx 的干扰。
 * 401 = 未登录/过期，403 = 无权限，500 = 业务错误。
 */
export class ApiException extends HttpException {
  private readonly errCode: number;

  constructor(msg: string, errCode = 500) {
    super(msg, 200);
    this.errCode = errCode;
  }

  getErrCode(): number {
    return this.errCode;
  }
}
