import { request } from './http';
import type {
  CaptchaResult,
  JsonBody,
  LoginResult,
  Profile,
} from './types';

/** 登录请求体（codegen 生成） */
export type LoginBody = JsonBody<'AuthController_login_v1'>;
/** 自助改密（需校验原密码） */
export type ChangePasswordBody = JsonBody<'AuthController_changePassword_v1'>;

export const authApi = {
  /** 图形验证码（开启 CAPTCHA_ENABLED 时登录必填） */
  captcha: () => request.get<CaptchaResult>('/auth/captcha'),
  login: (body: LoginBody) => request.post<LoginResult>('/auth/login', body),
  logout: () => request.post<void>('/auth/logout'),
  profile: () => request.get<Profile>('/auth/profile'),
  /**
   * 修改自己的密码。
   * 后端改完会**使当前会话失效**：调用方成功后应主动清 token 并跳登录页，
   * 否则下一个请求要撞 401 才被动跳转（体验上像“莫名其妙掉线”）。
   */
  changePassword: (body: ChangePasswordBody) =>
    request.post<void>('/auth/password', body),
};
