import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TOKEN_KEY,
  USER_PERMS_KEY,
  USER_PROFILE_KEY,
  USER_ROLES_KEY,
  USER_RULES_KEY,
} from '../../common/constants/redis.constant.js';
import type { AbilityRule } from '../../common/authz/ability.types.js';
import type { DataScope } from '../../common/enums/data-scope.enum.js';
import { RedisService } from '../../core/redis/redis.service.js';

/** 会话写入数据 */
export interface SessionData {
  /** 仅在登录时写入 token；刷新上下文时可省略 */
  token?: string;
  /** 角色编号（level）列表 */
  roles: number[];
  permissions: string[];
  rules: AbilityRule[];
  deptId?: number;
  post?: string;
  /** 角色的数据范围并集（查询层过滤依据） */
  dataScopes: DataScope[];
}

/** 会话读取上下文 */
export interface SessionContext {
  /** 角色编号（level）列表 */
  roles: number[];
  permissions: string[];
  rules: AbilityRule[];
  deptId?: number;
  post?: string;
  dataScopes: DataScope[];
}

/**
 * 会话缓存：集中管理 auth:* 键（token / 角色 / 权限码 / CASL 规则 / 档案）。
 * 权限相关变更后调用 invalidate() 使该用户令牌失效，强制重新登录以刷新。
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  private get ttl(): number {
    return this.config.get<number>('jwt.tokenTtl', 7200);
  }

  async save(userId: number, data: SessionData): Promise<void> {
    const ttl = this.ttl;
    const ops: Promise<unknown>[] = [
      this.redis.set(
        `${USER_ROLES_KEY}:${userId}`,
        JSON.stringify(data.roles),
        ttl,
      ),
      this.redis.set(
        `${USER_PERMS_KEY}:${userId}`,
        JSON.stringify(data.permissions),
        ttl,
      ),
      this.redis.set(
        `${USER_RULES_KEY}:${userId}`,
        JSON.stringify(data.rules),
        ttl,
      ),
      this.redis.set(
        `${USER_PROFILE_KEY}:${userId}`,
        JSON.stringify({
          deptId: data.deptId,
          post: data.post,
          dataScopes: data.dataScopes,
        }),
        ttl,
      ),
    ];
    if (data.token) {
      ops.push(this.redis.set(`${TOKEN_KEY}:${userId}`, data.token, ttl));
    }
    await Promise.all(ops);
  }

  getToken(userId: number): Promise<string | null> {
    return this.redis.get(`${TOKEN_KEY}:${userId}`);
  }

  async getContext(userId: number): Promise<SessionContext> {
    const [roles, permissions, rules, profile] = await Promise.all([
      this.redis.get(`${USER_ROLES_KEY}:${userId}`),
      this.redis.get(`${USER_PERMS_KEY}:${userId}`),
      this.redis.get(`${USER_RULES_KEY}:${userId}`),
      this.redis.get(`${USER_PROFILE_KEY}:${userId}`),
    ]);
    const p = profile
      ? (JSON.parse(profile) as {
          deptId?: number;
          post?: string;
          dataScopes?: DataScope[];
        })
      : {};
    return {
      roles: roles ? JSON.parse(roles) : [],
      permissions: permissions ? JSON.parse(permissions) : [],
      rules: rules ? (JSON.parse(rules) as AbilityRule[]) : [],
      deptId: p.deptId,
      post: p.post,
      dataScopes: p.dataScopes ?? [],
    };
  }

  /** 使会话失效（权限/部门/状态变更后调用，强制重新登录） */
  async invalidate(userId: number): Promise<void> {
    await this.redis.del(
      `${TOKEN_KEY}:${userId}`,
      `${USER_ROLES_KEY}:${userId}`,
      `${USER_PERMS_KEY}:${userId}`,
      `${USER_RULES_KEY}:${userId}`,
      `${USER_PROFILE_KEY}:${userId}`,
    );
  }
}
