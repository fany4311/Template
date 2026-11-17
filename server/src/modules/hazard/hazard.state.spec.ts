import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  availableActions,
  HazardTransitionError,
  HAZARD_ACTIONS,
  HAZARD_STATUSES,
  HAZARD_TRANSITIONS,
  isTerminal,
  type HazardAction,
  type HazardStatus,
} from './hazard.state.js';

/**
 * 状态机单元测试（不需要数据库）。
 * 这是整个闭环最核心的规则层，必须穷举验证：漏一个非法流转就是一次脏数据。
 */
describe('隐患状态机', () => {
  it('每个动作的目标状态都在状态集合内', () => {
    for (const action of HAZARD_ACTIONS) {
      expect(HAZARD_STATUSES).toContain(HAZARD_TRANSITIONS[action].to);
      for (const from of HAZARD_TRANSITIONS[action].from) {
        expect(HAZARD_STATUSES).toContain(from);
      }
    }
  });

  it('除创建动作外，每个动作都至少有一个起始状态', () => {
    for (const action of HAZARD_ACTIONS) {
      if (action === 'REPORT') {
        expect(HAZARD_TRANSITIONS[action].from).toHaveLength(0);
      } else {
        expect(HAZARD_TRANSITIONS[action].from.length).toBeGreaterThan(0);
      }
    }
  });

  it('终态不可再流转', () => {
    for (const action of HAZARD_ACTIONS) {
      for (const terminal of HAZARD_STATUSES.filter(isTerminal)) {
        expect(() => assertTransition(action, terminal)).toThrow(
          HazardTransitionError,
        );
      }
    }
  });

  it('合法流转返回目标状态', () => {
    expect(assertTransition('ACCEPT', 'REPORTED').to).toBe('PROCESSING');
    expect(assertTransition('RECTIFY', 'PROCESSING').to).toBe('RECTIFIED');
    expect(assertTransition('REVIEW_PASS', 'RECTIFIED').to).toBe('REVIEWED');
    expect(assertTransition('REVIEW_BACK', 'RECTIFIED').to).toBe('PROCESSING');
    expect(assertTransition('ARCHIVE', 'REVIEWED').to).toBe('ARCHIVED');
    expect(assertTransition('REJECT', 'REPORTED').to).toBe('REJECTED');
  });

  it('非法流转抛出业务异常（含中文原因，便于前端直接提示）', () => {
    // 未受理不能直接整改
    expect(() => assertTransition('RECTIFY', 'REPORTED')).toThrow(/不允许执行/);
    // 未整改不能复查
    expect(() => assertTransition('REVIEW_PASS', 'PROCESSING')).toThrow(
      HazardTransitionError,
    );
    // 未复查不能归档
    expect(() => assertTransition('ARCHIVE', 'RECTIFIED')).toThrow(
      HazardTransitionError,
    );
    // 终态
    expect(() => assertTransition('ARCHIVE', 'ARCHIVED')).toThrow(/已结束/);
  });

  it('availableActions 与流转表一致', () => {
    for (const status of HAZARD_STATUSES) {
      const expected = HAZARD_ACTIONS.filter((a) =>
        HAZARD_TRANSITIONS[a].from.includes(status),
      );
      expect(availableActions(status)).toEqual(expected);
    }
    expect(availableActions('ARCHIVED')).toEqual([]);
    expect(availableActions('REJECTED')).toEqual([]);
    expect(availableActions('REPORTED')).toEqual<HazardAction[]>([
      'ACCEPT',
      'REJECT',
    ]);
  });

  it('每个流转动作都绑定了权限码', () => {
    for (const action of HAZARD_ACTIONS) {
      expect(HAZARD_TRANSITIONS[action].permission).toMatch(
        /^hazard:[a-z]+:[a-z]+$/,
      );
    }
  });

  it('状态与动作没有重复定义', () => {
    expect(new Set(HAZARD_STATUSES).size).toBe(HAZARD_STATUSES.length);
    expect(new Set(HAZARD_ACTIONS).size).toBe(HAZARD_ACTIONS.length);
  });

  it('每个状态都能从 REPORTED 可达（不会有孤岛状态）', () => {
    const reachable = new Set<HazardStatus>(['REPORTED']);
    let changed = true;
    while (changed) {
      changed = false;
      for (const action of HAZARD_ACTIONS) {
        const t = HAZARD_TRANSITIONS[action];
        if (t.from.some((f) => reachable.has(f)) && !reachable.has(t.to)) {
          reachable.add(t.to);
          changed = true;
        }
      }
    }
    expect([...reachable].sort()).toEqual([...HAZARD_STATUSES].sort());
  });
});
