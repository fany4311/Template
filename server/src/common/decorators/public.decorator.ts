import { SetMetadata } from '@nestjs/common';
import { PUBLIC_KEY } from '../constants/decorator.constant.js';

/**
 * 标记接口为公开（跳过全局 JwtAuthGuard 鉴权）。
 * 用法：@Public() 加在 controller 方法或类上。
 * 注意：只跳过登录鉴权，权限/角色校验不适用（RBAC 守卫对无元数据是 no-op）。
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
