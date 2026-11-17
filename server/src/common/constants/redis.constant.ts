/**
 * Redis key 前缀常量。
 * 统一管理，避免魔法字符串散落业务代码。
 */
/** 登录验证码：auth:captcha:{uuid} → 验证码文本，5 分钟过期 */
export const CAPTCHA_KEY = 'auth:captcha';
/** 登录 token：auth:token:{userId} → jwt，2 小时过期，支持登出/踢下线 */
export const TOKEN_KEY = 'auth:token';
/** 用户角色缓存：auth:roles:{userId} → JSON string[]，登录成功后写入 */
export const USER_ROLES_KEY = 'auth:roles';
/** 用户权限码缓存：auth:perms:{userId} → JSON string[]，登录成功后写入 */
export const USER_PERMS_KEY = 'auth:perms';
/** 用户 CASL 规则缓存：auth:rules:{userId} → JSON AbilityRule[]，登录成功后写入 */
export const USER_RULES_KEY = 'auth:rules';
/** 用户档案缓存：auth:profile:{userId} → JSON { deptId, post } */
export const USER_PROFILE_KEY = 'auth:profile';
