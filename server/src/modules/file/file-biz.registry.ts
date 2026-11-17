import { Injectable, Logger } from '@nestjs/common';
import type { JwtUser } from '../auth/auth.interface.js';
import type { FileAcceptPolicy } from './file.policy.js';
import type { FileEntity } from './entities/file.entity.js';

/**
 * 业务侧访问判定上下文（底座只透传，不解释含义）。
 */
export type FileBizContext = Pick<
  JwtUser,
  'userId' | 'username' | 'deptId' | 'roles' | 'permissions' | 'dataScopes'
>;

/**
 * 业务适配器：由业务模块实现「当前用户能否访问这个业务对象」。
 *
 * 这是文件模块与业务解耦的关键 —— 底座**不认识** `hazard` / `notice` 这些名字，
 * 只把判定权交回给业务模块（与 `ProvinceSyncPort` 同一思路）。
 *
 * 三个可选扩展点都不带业务名词，业务模块自行填：
 * - `fields`  ：限制附件用途（如只允许 `cover` / `photo`）
 * - `accept`  ：收紧收件策略（如「导入学员」只收 xlsx 且 ≤5MB）
 * - `onBound` ：附件绑定后的回调（如解析 Excel 写业务表）——
 *   **当前不做实现**，只留接入位；它必须是幂等的，因为重复绑定同一文件是合法操作。
 */
export interface FileBizHandler {
  /**
   * 当前用户能否访问该业务对象。
   * 返回 false 或抛错都视为无权限（fail-closed）。
   */
  canAccess(ctx: FileBizContext, bizId: string): Promise<boolean>;

  /** 允许的附件用途；不填表示不限制 */
  fields?: readonly string[];

  /** 该业务的收件策略（只收紧全局策略，见 file.policy.ts） */
  accept?: FileAcceptPolicy;

  /**
   * 附件绑定成功后调用（同一事务内）。
   *
   * 供「上传 Excel 后解析入库」这类流程挂载；本基座暂不提供实现，
   * 但接口先定下来，业务模块接入时不需要改文件模块。
   */
  onBound?: (
    ctx: FileBizContext,
    bizId: string,
    files: readonly FileEntity[],
  ) => Promise<void>;
}

/**
 * 业务类型 → 访问判定器 的注册表。
 *
 * **fail-closed**：未注册的 bizType 一律拒绝。
 * 默认放行会让新业务忘记注册时产生越权读取附件（附件往往比列表数据更敏感）。
 */
@Injectable()
export class FileBizRegistry {
  private readonly logger = new Logger(FileBizRegistry.name);
  private readonly handlers = new Map<string, FileBizHandler>();

  /** 业务模块在 onModuleInit 中调用（重复注册后者覆盖，便于测试） */
  register(bizType: string, handler: FileBizHandler): void {
    this.handlers.set(bizType, handler);
  }

  /** 注销（模块销毁 / 测试隔离用） */
  unregister(bizType: string): void {
    this.handlers.delete(bizType);
  }

  has(bizType: string): boolean {
    return this.handlers.has(bizType);
  }

  /** 已注册的业务类型（管理端展示用） */
  list(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** 该业务的收件策略覆盖（未注册返回 undefined，表示沿用全局） */
  acceptOf(bizType: string): FileAcceptPolicy | undefined {
    return this.handlers.get(bizType)?.accept;
  }

  /**
   * 判定访问权。任何异常都按无权限处理，并记 warn 便于排查业务适配器 bug
   * （不要让适配器崩溃变成 500，也不要让它变成放行）。
   */
  async canAccess(
    ctx: FileBizContext,
    bizType: string,
    bizId: string,
  ): Promise<boolean> {
    const handler = this.handlers.get(bizType);
    if (!handler) return false;
    try {
      return await handler.canAccess(ctx, bizId);
    } catch (err) {
      this.logger.warn(
        `业务访问判定异常，按无权限处理：bizType=${bizType} bizId=${bizId} err=${(err as Error).message}`,
      );
      return false;
    }
  }

  /** 校验附件用途是否被业务允许 */
  acceptsField(bizType: string, bizField: string): boolean {
    const handler = this.handlers.get(bizType);
    if (!handler?.fields) return true;
    return handler.fields.includes(bizField);
  }

  /**
   * 绑定后回调。异常向上抛 —— 它在业务事务内，失败应回滚整个绑定，
   * 而不是留下「附件挂上了但没解析」的半成品。
   */
  async notifyBound(
    ctx: FileBizContext,
    bizType: string,
    bizId: string,
    files: readonly FileEntity[],
  ): Promise<void> {
    const handler = this.handlers.get(bizType);
    if (!handler?.onBound || files.length === 0) return;
    await handler.onBound(ctx, bizId, files);
  }
}
