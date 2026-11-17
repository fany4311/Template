import { SetMetadata } from '@nestjs/common';
import { KEEP_KEY } from '../constants/decorator.constant.js';

/**
 * 跳过统一响应包装（TransformInterceptor）。
 * 场景：文件下载、流式响应、第三方格式等不需要 {code, msg, data} 包装的接口。
 * 用法：@Keep()
 */
export const Keep = () => SetMetadata(KEEP_KEY, true);
