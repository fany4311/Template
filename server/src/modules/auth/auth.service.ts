import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import svgCaptcha from 'svg-captcha';
import { randomUUID } from 'node:crypto';
import { CAPTCHA_KEY } from '../../common/constants/redis.constant.js';
import type { AbilityRule } from '../../common/authz/ability.types.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { RedisService } from '../../core/redis/redis.service.js';
import { LoginLogService } from '../loginlog/loginlog.service.js';
import { RoleService } from '../role/role.service.js';
import { UserService } from '../user/user.service.js';
import type { JwtUser, LoginMeta, Payload } from './auth.interface.js';
import { SessionService } from '../../core/session/session.service.js';
import { type LoginInput } from './dto/login.dto.js';
import type { ChangePasswordInput } from './dto/password.dto.js';

/** 验证码有效期（秒） */
const CAPTCHA_TTL = 5 * 60;

/**
 * 认证服务：验证码 / 登录 / 登出 / 当前用户信息。
 * 登录成功 → 签发 JWT + 缓存会话（角色/权限/规则/档案），形成完整鉴权闭环。
 * 有效期通过 UserService.getEffectiveRoles 过滤（临时授权到期即失效）。
 *
 * 登录日志：成功/失败都记一条（旁路，不参与业务事务、失败不影响登录）。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly session: SessionService,
    private readonly loginLog: LoginLogService,
    private readonly roleService: RoleService,
  ) {}

  /** 生成数学图形验证码（svg），答案存 Redis 5 分钟 */
  async createCaptcha() {
    const { data, text } = svgCaptcha.createMathExpr({
      noise: 3,
      color: true,
      width: 120,
      height: 40,
    });
    const uuid = randomUUID();
    await this.redis.set(`${CAPTCHA_KEY}:${uuid}`, text, CAPTCHA_TTL);
    return { img: data, uuid };
  }

  /** 校验验证码（一次有效） */
  private async verifyCaptcha(uuid?: string, code?: string) {
    if (!uuid || !code) throw new ApiException('验证码不能为空');
    const key = `${CAPTCHA_KEY}:${uuid}`;
    const cached = await this.redis.get(key);
    if (!cached) throw new ApiException('验证码已过期，请刷新');
    await this.redis.del(key);
    if (cached.toLowerCase() !== code.toLowerCase()) {
      throw new ApiException('验证码错误');
    }
  }

  /** 登录：验证码 → 账号密码（argon2）→ 签发 JWT → 缓存会话 */ async login(
    dto: LoginInput,
    meta?: LoginMeta,
  ) {
    try {
      if (this.config.get<boolean>('app.captchaEnabled', false)) {
        await this.verifyCaptcha(dto.captchaUuid, dto.captchaCode);
      }

      const user = await this.userService.findByUsername(dto.username);
      if (!user) throw new ApiException('用户名或密码错误');
      const ok = await this.userService.verifyPassword(
        dto.password,
        user.password,
      );
      if (!ok) throw new ApiException('用户名或密码错误');
      if (user.status !== 1) throw new ApiException('账号已被禁用', 403);

      const roles = await this.userService.getEffectiveRoles(user.id);
      // 角色只往下传**编号**（level），不传名称：名称可改，编号才是稳定标识
      const roleLevels = roles.map((r) => r.level);
      const permissions = [
        ...new Set(roles.flatMap((r) => r.permissions ?? [])),
      ];
      const rules: AbilityRule[] = roles.flatMap((r) => r.rules ?? []);
      const dataScopes = [...new Set(roles.map((r) => r.dataScope))];
      // CUSTOM 的部门集合只在登录时算一次，之后从会话读（不在每次请求回库查）
      const dataScopeDepts = await this.roleService.getCustomDeptIds(roles);

      const payload: Payload = { userId: user.id, username: user.username };
      const token = this.jwtService.sign(payload);

      await this.session.save(user.id, {
        token,
        roles: roleLevels,
        permissions,
        rules,
        deptId: user.deptId,
        post: user.post,
        dataScopes,
        dataScopeDepts,
      });

      this.recordLogin(user.username, meta, 1, '登录成功');

      return {
        token,
        user: {
          userId: user.id,
          username: user.username,
          nickname: user.nickname,
        },
      };
    } catch (err) {
      this.recordLogin(dto.username, meta, 0, this.resolveLoginMsg(err));
      throw err;
    }
  }

  /** 旁路写登录日志：不 await、不抛出，保证登录结果不受影响 */
  private recordLogin(
    username: string,
    meta: LoginMeta | undefined,
    status: number,
    msg: string,
  ): void {
    void this.loginLog
      .record({
        username,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        status,
        msg,
      })
      .catch(() => undefined);
  }

  /** 失败原因：业务异常取其消息，其余统一兜底 */
  private resolveLoginMsg(err: unknown): string {
    if (err instanceof ApiException) return err.message;
    return '登录失败';
  }

  /** 登出：删除会话缓存，token 立即失效 */
  async logout(userId: number) {
    await this.session.invalidate(userId);
  }

  /**
   * 自助改密：校验原密码 → 写新哈希 → 使会话失效。
   *
   * 校验原密码不只是为了防误操作：后台常出现在公共电脑上未退出的场景，
   * 只凭“已经登录”就能改密，等于把账号直接送给下一个用电脑的人。
   */
  async changePassword(
    userId: number,
    dto: ChangePasswordInput,
  ): Promise<null> {
    const user = await this.userService.findByIdWithPassword(userId);
    if (!user) throw new ApiException('用户不存在', 401);
    if (user.status !== 1) throw new ApiException('账号已被禁用', 403);

    const ok = await this.userService.verifyPassword(
      dto.oldPassword,
      user.password,
    );
    if (!ok) throw new ApiException('原密码不正确');

    await this.userService.updatePassword(userId, dto.newPassword);
    return null;
  }

  /** 当前登录用户信息（含角色/权限/规则，供前端做按钮级权限控制） */
  async getInfo(user: JwtUser) {
    const dbUser = await this.userService.findById(user.userId);
    if (!dbUser) throw new ApiException('用户不存在', 401);
    const roles = await this.userService.getEffectiveRoles(user.userId);
    const roleLevels = roles.map((r) => r.level);
    // 名称只用于展示，与 roleLevels 同序；程序判据一律用编号（名称可改）
    const roleNames = roles.map((r) => r.roleName);
    const permissions = [...new Set(roles.flatMap((r) => r.permissions ?? []))];
    const rules: AbilityRule[] = roles.flatMap((r) => r.rules ?? []);
    return {
      userId: dbUser.id,
      username: dbUser.username,
      nickname: dbUser.nickname,
      email: dbUser.email,
      phone: dbUser.phone,
      deptId: dbUser.deptId,
      post: dbUser.post,
      roles: roleLevels,
      roleNames,
      permissions,
      rules,
      dataScopes: roles.map((r) => r.dataScope),
    };
  }
}
