// The act states and ACT_TRANSITIONS (Overlord W2, act rows A, Task A1; spec Table 10.1b; plan w2-act-rows.md §4.1, Table 1).
import { describe, expect, it } from 'vitest';
import {
  ACT_LANE_STATES, ACT_MOVERS, ACT_OPEN_STATES, ACT_STATES, ACT_SUMMARY_MAX, ACT_TARGET_KINDS, ACT_TARGET_REF_KINDS,
  ACT_TERMINAL_STATES, ACT_TRANSITIONS, ACT_WHY_MAX, actMoveAllowed, isActState, isActTargetKind, isActTargetRefKind,
  type ActMover, type ActState,
} from '../../shared/overlordActs.js';

const row = (from: ActState | null, to: ActState): readonly ActMover[] | undefined =>
  ACT_TRANSITIONS.find((t) => t.from === from && t.to === to)?.by;

describe('ACT_TRANSITIONS, row by row (Table 1)', () => {
  it('the act door enters pending and done, and nothing else enters but staging', () => {
    expect(row(null, 'pending')).toEqual(['door']);
    expect(row(null, 'done')).toEqual(['door']);
    expect(row(null, 'staged')).toEqual(['staging']);
    expect(ACT_TRANSITIONS.filter((t) => t.from === null).map((t) => t.to).sort()).toEqual(['done', 'pending', 'staged']);
  });
  it('pending leaves to done, refused and unknown, by the door, the lane and the boot pass', () => {
    for (const to of ['done', 'refused', 'unknown'] as const) expect(row('pending', to)).toEqual(['door', 'lane', 'boot']);
    expect(ACT_TRANSITIONS.filter((t) => t.from === 'pending').map((t) => t.to).sort()).toEqual(['done', 'refused', 'unknown']);
  });
  it("unknown leaves to done and refused, by the lane and the boot pass only (only by a measurement)", () => {
    for (const to of ['done', 'refused'] as const) expect(row('unknown', to)).toEqual(['lane', 'boot']);
    const exits = ACT_TRANSITIONS.filter((t) => t.from === 'unknown');
    expect(exits.map((t) => t.to).sort()).toEqual(['done', 'refused']);
    expect([...new Set(exits.flatMap((t) => t.by))].sort()).toEqual(['boot', 'lane']);
  });
  it("staged leaves to effective, vetoed, voided and preempted, by W3's staging", () => {
    for (const to of ['effective', 'vetoed', 'voided', 'preempted'] as const) expect(row('staged', to)).toEqual(['staging']);
    expect(ACT_TRANSITIONS.filter((t) => t.from === 'staged')).toHaveLength(4);
  });
  it('has exactly twelve rows, no two alike', () => {
    expect(ACT_TRANSITIONS).toHaveLength(12);
    expect(new Set(ACT_TRANSITIONS.map((t) => `${t.from}>${t.to}`)).size).toBe(12);
  });
  it('nothing enters shadow, and shadow has no exit', () => {
    expect(ACT_TRANSITIONS.some((t) => t.to === 'shadow')).toBe(false);
    expect(ACT_TRANSITIONS.some((t) => t.from === 'shadow')).toBe(false);
  });
  it('every mover and state a row names is a word of its list', () => {
    for (const t of ACT_TRANSITIONS) {
      expect(t.from === null || ACT_STATES.includes(t.from)).toBe(true);
      expect(ACT_STATES).toContain(t.to);
      for (const b of t.by) expect(ACT_MOVERS).toContain(b);
    }
  });
});

describe('the derived lists', () => {
  it('ACT_STATES is the map\'s keys, in Table 10.1b\'s order', () => {
    expect(ACT_STATES).toEqual(['pending', 'done', 'refused', 'unknown', 'staged', 'effective', 'vetoed', 'voided', 'preempted', 'shadow']);
    expect(ACT_STATES.every(isActState)).toBe(true);
    expect(isActState('settled')).toBe(false);
    expect(isActState('hasOwnProperty')).toBe(false);
  });
  it('the terminal states are those no row leaves: done, refused, effective, vetoed, voided, preempted and shadow', () => {
    expect([...ACT_TERMINAL_STATES].sort()).toEqual(['done', 'effective', 'preempted', 'refused', 'shadow', 'vetoed', 'voided']);
    expect(ACT_TERMINAL_STATES).toEqual(ACT_STATES.filter((s) => !ACT_TRANSITIONS.some((t) => t.from === s)));
  });
  it('every non-terminal state has an exit', () => {
    expect(ACT_OPEN_STATES).toEqual(['pending', 'unknown', 'staged']);
    for (const s of ACT_OPEN_STATES) expect(ACT_TRANSITIONS.some((t) => t.from === s)).toBe(true);
  });
  it('the lane re-measures pending and unknown', () => {
    expect(ACT_LANE_STATES).toEqual(['pending', 'unknown']);
  });
  it('actMoveAllowed reads the table, mover included', () => {
    expect(actMoveAllowed(null, 'done', 'door')).toBe(true);
    expect(actMoveAllowed(null, 'done', 'lane')).toBe(false);
    expect(actMoveAllowed('pending', 'unknown', 'door')).toBe(true);
    expect(actMoveAllowed('unknown', 'done', 'door')).toBe(false);
    expect(actMoveAllowed('unknown', 'done', 'lane')).toBe(true);
    expect(actMoveAllowed('done', 'refused', 'lane')).toBe(false);
    expect(actMoveAllowed(null, 'shadow', 'door')).toBe(false);
  });
});

describe('the targets and the caps', () => {
  it('the natural key targets: message, delivery, request and note (the W2 index adds delivery, request and the note)', () => {
    expect(ACT_TARGET_KINDS).toEqual(['message', 'delivery', 'request', 'note']);
    expect(isActTargetKind('start')).toBe(false);
    expect(isActTargetKind('toString')).toBe(false);
  });
  it("the targets list's kinds are Table 10.1a's and the natural key's", () => {
    expect(ACT_TARGET_REF_KINDS).toEqual(['programme', 'session', 'item', 'ask', 'run', 'request', 'message', 'delivery', 'note']);
    for (const k of ACT_TARGET_KINDS) expect(isActTargetRefKind(k)).toBe(true);
  });
  it('the summary and the why are capped at 200 and 600 characters (Table 11.5b)', () => {
    expect([ACT_SUMMARY_MAX, ACT_WHY_MAX]).toEqual([200, 600]);
  });
});
