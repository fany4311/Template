/**
 * 隐患闭环状态机。
 *
 * 业务语义（一单四制：清单制、交办制、督办制、销号制）：
 *
 *   REPORTED ──受理──► PROCESSING ──整改──► RECTIFIED ──复查通过──► REVIEWED ──归档──► ARCHIVED
 *       │                  │                    │                     │
 *       └──────────────────┴────────────────────┴──驳回──► REJECTED    └─复查退回─► PROCESSING
 *
 * 设计原则：
 * - 状态与流转集中在**一个文件**，服务层只能通过 assertTransition 改状态，
 *   避免状态判断散落在各接口里（否则新增动作必然漏改）。
 * - 每个动作绑定一个权限码，与控制器上的 @RequiresPermissions 同源，
 *   防止"能调接口但状态不允许"和"状态允许但无权限"两套判断打架。
 */

/**
 * 隐患权限码。
 *
 * 统一 3 段式 `域:资源:动作`，与系统管理域（system:user:add）保持同一形状，
 * 这样 `hazard:*` / `!hazard:*` 这类段末通配才有意义。
 *
 * 状态机流转直接引用本表，**权限码只有一处定义**，避免控制器与状态机对不上。
 */
export const HAZARD_PERMISSIONS = {
  LIST: 'hazard:report:list',
  QUERY: 'hazard:report:query',
  ADD: 'hazard:report:add',
  ACCEPT: 'hazard:report:accept',
  REJECT: 'hazard:report:reject',
  RECTIFY: 'hazard:report:rectify',
  REVIEW: 'hazard:report:review',
  ARCHIVE: 'hazard:report:archive',
  REMOVE: 'hazard:report:remove',
} as const;

/** 隐患状态 */
export const HAZARD_STATUSES = [
  'REPORTED', // 待受理
  'PROCESSING', // 整改中
  'RECTIFIED', // 待复查
  'REVIEWED', // 已复查（待归档）
  'ARCHIVED', // 已归档（终态）
  'REJECTED', // 已驳回（终态）
] as const;

export type HazardStatus = (typeof HAZARD_STATUSES)[number];

/** 流转动作 */
export const HAZARD_ACTIONS = [
  'REPORT',
  'ACCEPT',
  'REJECT',
  'RECTIFY',
  'REVIEW_PASS',
  'REVIEW_BACK',
  'ARCHIVE',
] as const;

export type HazardAction = (typeof HAZARD_ACTIONS)[number];

export interface HazardTransition {
  /** 允许的起始状态；空数组表示"创建"动作（无前置状态） */
  from: readonly HazardStatus[];
  /** 目标状态 */
  to: HazardStatus;
  /** 中文名（写流转日志 / 审计用） */
  label: string;
  /** 该动作对应的权限码 */
  permission: string;
}

/** 流转表：动作 → (起始状态集, 目标状态) */
export const HAZARD_TRANSITIONS: Record<HazardAction, HazardTransition> = {
  REPORT: {
    from: [],
    to: 'REPORTED',
    label: '上报',
    permission: HAZARD_PERMISSIONS.ADD,
  },
  ACCEPT: {
    from: ['REPORTED'],
    to: 'PROCESSING',
    label: '受理',
    permission: HAZARD_PERMISSIONS.ACCEPT,
  },
  REJECT: {
    from: ['REPORTED', 'PROCESSING', 'RECTIFIED'],
    to: 'REJECTED',
    label: '驳回',
    permission: HAZARD_PERMISSIONS.REJECT,
  },
  RECTIFY: {
    from: ['PROCESSING'],
    to: 'RECTIFIED',
    label: '提交整改',
    permission: HAZARD_PERMISSIONS.RECTIFY,
  },
  REVIEW_PASS: {
    from: ['RECTIFIED'],
    to: 'REVIEWED',
    label: '复查通过',
    permission: HAZARD_PERMISSIONS.REVIEW,
  },
  REVIEW_BACK: {
    from: ['RECTIFIED'],
    to: 'PROCESSING',
    label: '复查退回',
    permission: HAZARD_PERMISSIONS.REVIEW,
  },
  ARCHIVE: {
    from: ['REVIEWED'],
    to: 'ARCHIVED',
    label: '归档',
    permission: HAZARD_PERMISSIONS.ARCHIVE,
  },
};

/** 终态：不可再流转 */
export const HAZARD_TERMINAL: readonly HazardStatus[] = ['ARCHIVED', 'REJECTED'];

export function isTerminal(status: HazardStatus): boolean {
  return HAZARD_TERMINAL.includes(status);
}

/** 状态中文名（前端展示 / 日志） */
export const HAZARD_STATUS_LABELS: Record<HazardStatus, string> = {
  REPORTED: '待受理',
  PROCESSING: '整改中',
  RECTIFIED: '待复查',
  REVIEWED: '待归档',
  ARCHIVED: '已归档',
  REJECTED: '已驳回',
};

import { ApiException } from '../../common/exceptions/api.exception.js';

/**
 * 流转非法（状态不允许 / 已终态）。
 *
 * 继承 ApiException 而非 Error：状态机拒绝属于**业务规则**，
 * 应按项目约定返回 HTTP 200 + 业务码 500 + 可读原因（见 AllExceptionFilter），
 * 而不是掉进“未预期异常”分支被归为 500 Internal Server Error。
 */
export class HazardTransitionError extends ApiException {
  constructor(
    readonly action: HazardAction,
    readonly from: HazardStatus,
  ) {
    const t = HAZARD_TRANSITIONS[action];
    super(
      `当前状态「${HAZARD_STATUS_LABELS[from]}」不允许执行「${t.label}」` +
        (isTerminal(from) ? '，该隐患已结束' : ''),
    );
    this.name = 'HazardTransitionError';
  }
}

/**
 * 校验流转合法性，返回该动作的流转定义。
 * 服务层改状态前**必须**调用；非法流转直接抛错（fail-closed）。
 */
export function assertTransition(
  action: HazardAction,
  from: HazardStatus,
): HazardTransition {
  const transition = HAZARD_TRANSITIONS[action];
  if (!transition.from.includes(from)) {
    throw new HazardTransitionError(action, from);
  }
  return transition;
}

/** 当前状态下可执行的动作（供前端渲染按钮，避免前端硬编码状态判断） */
export function availableActions(status: HazardStatus): HazardAction[] {
  return HAZARD_ACTIONS.filter((action) =>
    HAZARD_TRANSITIONS[action].from.includes(status),
  );
}
