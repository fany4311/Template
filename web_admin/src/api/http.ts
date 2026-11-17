import axios, { type AxiosError } from 'axios';
import { ElMessage } from 'element-plus';
import type { AjaxResult } from './types';

/** 业务/网络异常（统一抛出，便于调用方按 code 分支） */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'template_token';

export const tokenStorage = {
  get: (): string => localStorage.getItem(TOKEN_KEY) ?? '',
  set: (token: string): void => {
    localStorage.setItem(TOKEN_KEY, token);
  },
  clear: (): void => {
    localStorage.removeItem(TOKEN_KEY);
  },
};

let unauthorizedHandler: (() => void) | null = null;

/** 注册 401 处理（main.ts 里绑定为「清空登录态 + 跳登录页」） */
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

/**
 * 生成幂等键（UUID v4）。
 *
 * 不能用 `crypto.randomUUID()`：它是**安全上下文限定 API**，只有 https 和
 * http://localhost|127.0.0.1 才有。校内是 http://内网IP 部署，那里
 * `crypto.randomUUID` 是 undefined，调用会直接抛 TypeError —— 且抛在 axios 发请求
 * 之前，表现为「点了按钮没反应、服务端日志一条都没有」。
 *
 * `crypto.getRandomValues` 在非安全上下文可用，故用它自行拼装。
 */
function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export const http = axios.create({ baseURL, timeout: 20_000 });

http.interceptors.request.use((config) => {
  const token = tokenStorage.get();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

/**
 * 统一失败处理。
 * 后端约定：业务异常 = HTTP 200 + body.code；框架异常 = 原始 HTTP 状态 + body.code。
 * 两种情况都收敛到这里，前端只看 code。
 */
function fail(code: number, message: string): Promise<never> {
  if (code === 401) {
    ElMessage.error('登录已失效，请重新登录');
    tokenStorage.clear();
    unauthorizedHandler?.();
  } else {
    ElMessage.error(message || '请求失败');
  }
  return Promise.reject(new ApiError(code, message));
}

http.interceptors.response.use(
  (response) => {
    const body = response.data as AjaxResult<unknown> | undefined;
    if (body && typeof body === 'object' && typeof body.code === 'number') {
      if (body.code === 200) return body.data as never;
      return fail(body.code, body.msg);
    }
    return body as never;
  },
  (error: AxiosError<AjaxResult<unknown>>) => {
    const status = error.response?.status ?? 0;
    const message = error.response?.data?.msg ?? error.message ?? '网络异常';
    return fail(status, message);
  },
);

/**
 * 轻量请求封装：响应已是解包后的业务数据。
 *
 * POST/PUT 默认携带 Idempotency-Key：后端 @Idempotent() 接口要求该头（缺失直接 400），
 * 对未声明幂等的接口无副作用；DELETE 天然幂等，后端不校验。
 * 调用方可通过 opts.idempotencyKey 复用同一键（如失败重试）。
 */
export const request = {
  get: <T>(url: string, params?: object): Promise<T> =>
    http.get(url, { params }) as unknown as Promise<T>,
  post: <T>(
    url: string,
    data?: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<T> =>
    http.post(url, data, {
      headers: {
        'Idempotency-Key': opts?.idempotencyKey ?? newIdempotencyKey(),
      },
    }) as unknown as Promise<T>,
  put: <T>(
    url: string,
    data?: unknown,
    opts?: { idempotencyKey?: string },
  ): Promise<T> =>
    http.put(url, data, {
      headers: {
        'Idempotency-Key': opts?.idempotencyKey ?? newIdempotencyKey(),
      },
    }) as unknown as Promise<T>,
  delete: <T>(url: string): Promise<T> =>
    http.delete(url) as unknown as Promise<T>,
};
