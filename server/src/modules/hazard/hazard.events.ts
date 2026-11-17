import type { HazardAction, HazardStatus } from './hazard.state.js';

/**
 * 隐患领域事件（Outbox）。
 *
 * 用途：
 * 1. 省平台同步 —— 每次流转发一条事件，由省平台适配器消费（当前为 Mock）。
 * 2. 后续可挂其他消费者（短信/企业微信督办、超时预警）而无需改业务代码。
 *
 * 约定：事件名 `聚合.动作`，见 outbox.types.ts。
 */
export const HAZARD_EVENTS = {
  REPORTED: 'hazard.reported',
  ACCEPTED: 'hazard.accepted',
  REJECTED: 'hazard.rejected',
  RECTIFIED: 'hazard.rectified',
  REVIEWED: 'hazard.reviewed',
  ARCHIVED: 'hazard.archived',
} as const satisfies Record<string, string>;

/** 动作 → 事件类型 */
export const HAZARD_ACTION_EVENTS: Record<HazardAction, string> = {
  REPORT: HAZARD_EVENTS.REPORTED,
  ACCEPT: HAZARD_EVENTS.ACCEPTED,
  REJECT: HAZARD_EVENTS.REJECTED,
  RECTIFY: HAZARD_EVENTS.RECTIFIED,
  REVIEW_PASS: HAZARD_EVENTS.REVIEWED,
  REVIEW_BACK: HAZARD_EVENTS.RECTIFIED,
  ARCHIVE: HAZARD_EVENTS.ARCHIVED,
};

/** 所有隐患事件类型（供订阅/校验） */
export const HAZARD_EVENT_TYPES: readonly string[] =
  Object.values(HAZARD_EVENTS);

/** 事件载荷：省平台同步所需的全部对外字段（不泄漏内部主键语义） */
export interface HazardEventPayload {
  /**
   * 事件唯一标识（发布时生成，随事件一起持久化）。
   *
   * 为什么需要它：Outbox 是**至少一次**投递，处理器必须能识别"同一条事件"。
   * 不能用 (hazardNo, toStatus) 当幂等键 —— 复查退回会让单据回到 PROCESSING，
   * 与受理时的 toStatus 相同，会被误判为重复而漏推一次。
   */
  eventId: string;
  /** 事件类型（Outbox 处理器回调只拿到 payload，故带上） */
  eventType: string;
  /** 本校侧隐患主键（省平台若需回查可用；非对外编号） */
  hazardId: number;
  /** 业务编号，省平台用它做幂等主键 */
  hazardNo: string;
  action: HazardAction;
  fromStatus: HazardStatus | null;
  toStatus: HazardStatus;
  title: string;
  category: string;
  level: string;
  scope: string;
  location: string;
  /** 主责部门 */
  assigneeDeptId: number | null;
  /** 协办部门 */
  cooperateDeptIds: number[];
  operatorId: number;
  operatorName: string;
  /** 发生时间（ISO 字符串，便于跨系统对齐） */
  occurredAt: string;
  /** 本次流转的说明（整改措施 / 复查意见 / 驳回原因） */
  remark: string;
}
