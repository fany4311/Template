import type { HazardEventPayload } from '../hazard.events.js';

/** 适配器调用结果 */
export interface ProvinceSyncResult {
  /** 省平台是否受理成功 */
  success: boolean;
  /** 省平台回执（原样落库，便于排查） */
  response?: Record<string, any>;
  /** 失败原因 */
  error?: string;
}

/**
 * 省平台同步端口（六边形架构的"端口"）。
 *
 * 为什么先立端口：省平台 API 尚未提供（对接方"湖南手拉手技术"），
 * 但本校侧的闭环必须能独立跑通、独立测试。把"对外同步"收敛成一个接口后：
 * - 当前注入 MockProvinceAdapter（只落库 + 打日志）
 * - 真接口到位后新增 HttpProvinceAdapter，仅改 hazard.module.ts 的 provider，
 *   业务代码（HazardService）一行不动
 *
 * 这也符合底座原则：业务依赖抽象，不依赖具体外部系统。
 */
export interface ProvinceSyncPort {
  /** 目标系统标识（落 biz_hazard_sync.target） */
  readonly target: string;

  /** 推送一次隐患流转 */
  push(payload: HazardEventPayload): Promise<ProvinceSyncResult>;
}

/** 依赖注入令牌 */
export const PROVINCE_SYNC_PORT = Symbol('PROVINCE_SYNC_PORT');
