// Spec 2026-09-14 §7.1-7.2: every RunState is classified ONCE — active, idle
// or terminal — and the cap counts exactly the active ones. The dangerous
// direction for a cap is UNDER-counting (it over-dispatches silently), so this
// suite pins the partition rather than trusting a negative-form SQL predicate.
import { describe, it, expect } from 'vitest';
import {
  ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES, RUN_STATES, RUN_TRANSITIONS,
  type RunState,
} from '../../shared/api.js';

describe('run-state classification (spec §7.1)', () => {
  const lists: Record<string, readonly RunState[]> = {
    ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES,
  };

  it('places every RunState in exactly one list', () => {
    for (const s of RUN_STATES) {
      const homes = Object.entries(lists).filter(([, l]) => l.includes(s)).map(([n]) => n);
      expect(homes, `${s} is classified ${homes.length} times: ${homes.join(', ')}`).toHaveLength(1);
    }
  });

  it('classifies nothing that is not a RunState, and covers all of them', () => {
    const union = [...ACTIVE_RUN_STATES, ...IDLE_RUN_STATES, ...TERMINAL_RUN_STATES].sort();
    expect(union).toEqual([...RUN_STATES].sort());
  });

  it('counts `unknown` as ACTIVE — the safe direction for a cap', () => {
    expect(ACTIVE_RUN_STATES).toContain('unknown');
    expect(TERMINAL_RUN_STATES).not.toContain('unknown');
  });

  it('agrees with the transition table about what is terminal — except `unknown`, which has no edges for a different reason', () => {
    const noExit = (Object.keys(RUN_TRANSITIONS) as RunState[])
      .filter((s) => RUN_TRANSITIONS[s].length === 0 && s !== 'unknown').sort();
    expect([...TERMINAL_RUN_STATES].sort()).toEqual(noExit);
    for (const s of [...ACTIVE_RUN_STATES, ...IDLE_RUN_STATES]) {
      if (s === 'unknown') continue;
      expect(RUN_TRANSITIONS[s].length, `${s} is non-terminal but has no exit`).toBeGreaterThan(0);
    }
  });

  it('names the two states a dispatched session is actually busy in, and only those', () => {
    expect([...ACTIVE_RUN_STATES].filter((s) => s !== 'unknown').sort()).toEqual(['dispatched', 'working']);
    expect([...IDLE_RUN_STATES].sort()).toEqual(['awaiting-review', 'closing', 'merging', 'planned']);
  });
});
