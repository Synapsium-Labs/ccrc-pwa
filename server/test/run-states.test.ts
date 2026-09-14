// Spec 2026-09-14 §7.1-7.2: every RunState is classified ONCE — active, idle
// or terminal — and the cap counts exactly the active ones. The dangerous
// direction for a cap is UNDER-counting (it over-dispatches silently), so this
// suite pins the partition rather than trusting a negative-form SQL predicate.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES, RUN_STATES, RUN_TRANSITIONS,
  REVIEW_RUN_TRANSITIONS, transitionsFor, RUN_KINDS,
  type RunState,
} from '../../shared/api.js';

describe('run-state classification (spec §7.1)', () => {
  const lists: Record<string, readonly RunState[]> = {
    ACTIVE_RUN_STATES, IDLE_RUN_STATES, TERMINAL_RUN_STATES,
  };

  it('RUN_STATES is the whole RunState — the same keys the transition table is compiled against', () => {
    expect([...RUN_STATES].sort()).toEqual((Object.keys(RUN_TRANSITIONS) as RunState[]).sort());
  });

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

describe('transitions by kind (spec §5.2)', () => {
  it('a review run goes planned -> dispatched -> working -> done | failed and nowhere else', () => {
    expect(REVIEW_RUN_TRANSITIONS).toEqual({
      planned: ['dispatched', 'failed'],
      dispatched: ['working', 'failed'],
      working: ['done', 'failed'],
      'awaiting-review': [], merging: [], closing: [],
      done: [], failed: [], unknown: [],
    });
  });
  it('transitionsFor names the two tables and an empty one for unknown', () => {
    expect(transitionsFor('work')).toBe(RUN_TRANSITIONS);
    expect(transitionsFor('review')).toBe(REVIEW_RUN_TRANSITIONS);
    for (const s of RUN_STATES) expect(transitionsFor('unknown')[s]).toEqual([]);
  });
  it('every RunKind has a table whose keys are exactly RUN_STATES', () => {
    for (const k of RUN_KINDS) {
      expect(Object.keys(transitionsFor(k)).sort()).toEqual([...RUN_STATES].sort());
    }
  });
  it('a review run never reaches awaiting-review, merging or closing from any state', () => {
    for (const s of RUN_STATES) {
      for (const bad of ['awaiting-review', 'merging', 'closing'] as const) {
        expect(REVIEW_RUN_TRANSITIONS[s], `${s} -> ${bad}`).not.toContain(bad);
      }
    }
  });
  it('nothing under server/src indexes a transition table directly — transitionsFor is the one reader', () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.name.startsWith('__') ? [] : e.isDirectory() ? walk(path.join(d, e.name))
        : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
    const offenders = walk(root).filter((f) => /\b(RUN_TRANSITIONS|REVIEW_RUN_TRANSITIONS)\[/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});
