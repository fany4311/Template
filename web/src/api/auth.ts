import { request } from './http';
import type { LoginResult, Profile } from './types';

/** 登录请求体 */
export interface LoginBody {
  username: string;
  password: string;
  captchaUuid?: string;
  captchaCode?: string;
}

/** 图形验证码（后端 CAPTCHA_ENABLED 开启时才需要） */
export interface CaptchaResult {
  uuid: string;
  img: string;
}

export const authApi = {
  captcha: () => request.get<CaptchaResult>('/auth/captcha'),
  login: (body: LoginBody) => request.post<LoginResult>('/auth/login', body),
  logout: () => request.post<void>('/auth/logout'),
  profile: () => request.get<Profile>('/auth/profile'),
};
