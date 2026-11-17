import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { SessionService } from '../../core/session/session.service.js';
import { UserRole } from './entities/user-role.entity.js';
import { User } from './entities/user.entity.js';

/**
 * 授权回收定时任务：
 * 1. 清理已到期的临时授权（sys_user_role.expire_at <= now），使失效用户的会话失效；
 * 2. 兜底：禁用（离职）用户的残留会话强制失效。
 *
 * 权限变更即时生效的方式：删缓存 + 使令牌失效 → 下次请求 401，重新登录后按最新授权重建会话。
 */
@Injectable()
export class AuthorizationTask {
  private readonly logger = new Logger(AuthorizationTask.name);

  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly session: SessionService,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'authz-revoke-expired' })
  async revokeExpired(): Promise<void> {
    const now = new Date();

    // 1. 到期临时授权回收
    const expired = await this.userRoleRepo.find({
      where: { expireAt: LessThanOrEqual(now) },
    });
    if (expired.length) {
      const userIds = [...new Set(expired.map((g) => g.userId))];
      await this.userRoleRepo.delete({ expireAt: LessThanOrEqual(now) });
      for (const userId of userIds) {
        await this.session.invalidate(userId);
      }
      this.logger.log(
        `回收到期临时授权 ${expired.length} 条，涉及 ${userIds.length} 名用户`,
      );
    }

    // 2. 禁用用户会话兜底失效
    const disabled = await this.userRepo.find({
      where: { status: 0 },
      select: { id: true },
    });
    for (const user of disabled) {
      const token = await this.session.getToken(user.id);
      if (token) await this.session.invalidate(user.id);
    }
  }
}
