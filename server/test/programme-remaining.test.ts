// Overlord W2 remaining work A (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md, Task 1): the
// remaining-work vocabulary and the body's rules. The row cases live in `sim/programmeFactsSets.ts`, so the mutation floor
// runs the same cases against each mutant; this file adds the exhaustive property over a generated domain.
import { describe, it, expect } from 'vitest';
import { edgeTargetVerdict, remainingBodyOf } from '../src/coord/programmeRemaining.js';
import {
  EDGE_KIND_OF_PREDICATE, EDGE_KINDS, EDGE_PREDICATES, EDGE_STATES, EDGE_WHY_MAX, EDGES_PER_STATEMENT_MAX, REMAINING_REASON_MAX,
  REMAINING_WAVES_MAX, edgeTargetKey, isEdgePredicate, parseEdgeTarget, type EdgeKind, type EdgePredicate,
} from '../../shared/programmeFacts.js';
import {
  DECIDE, EDGES_MAX, GOOD, LANDED, MERGED, NOW, REASON_MAX, WAVES_MAX, WHY_MAX, edgeTargetCases, remainingBodyCases,
} from './sim/programmeFactsSets.js';

describe('the remaining-work vocabulary', () => {
  it('the written-out bounds the cases use are the shipped constants', () => {
    expect([REMAINING_WAVES_MAX, REMAINING_REASON_MAX, EDGE_WHY_MAX, EDGES_PER_STATEMENT_MAX]).toEqual([WAVES_MAX, REASON_MAX, WHY_MAX, EDGES_MAX]);
  });

  it('EDGE_KIND_OF_PREDICATE covers every predicate, each with a known kind', () => {
    // Compile-time: a predicate missing from the table does not type-check against this annotation.
    const cover: Record<EdgePredicate, EdgeKind> = EDGE_KIND_OF_PREDICATE;
    expect(Object.keys(cover).sort()).toEqual([...EDGE_PREDICATES].sort());
    for (const k of Object.values(cover)) expect(EDGE_KINDS).toContain(k);
    expect(EDGE_STATES).toEqual(['open', 'met', 'target-ended', 'target-unmeasurable']);
  });

  it('CHARACTERIZATION (remaining work B\'s move): the edge predicates, their order, their kinds and their guard', () => {
    expect(EDGE_PREDICATES).toEqual(['run-closed', 'pr-merged', 'operator-confirms']);
    expect({ ...EDGE_KIND_OF_PREDICATE }).toEqual({ 'run-closed': 'needs-landed', 'pr-merged': 'needs-landed', 'operator-confirms': 'needs-decision' });
    for (const w of EDGE_PREDICATES) expect(isEdgePredicate(w)).toBe(true);
    for (const w of ['review-passed', 'goals-modified', 'run-merged', '']) expect(isEdgePredicate(w)).toBe(false);
  });

  it('edgeTargetKey is one canonical form, and parseEdgeTarget reads it back and nothing else', () => {
    for (const t of [LANDED.target, MERGED.target, DECIDE.target] as const) {
      expect(parseEdgeTarget(edgeTargetKey(t as never))).toEqual(t);
    }
    expect(edgeTargetKey({ pr: 7, runId: 41, predicate: 'pr-merged' } as never)).toBe('{"predicate":"pr-merged","runId":41,"pr":7}');
    for (const bad of ['', 'x', '[]', 'null', '{"predicate":"run-closed"}', '{"predicate":"run-closed","runId":0}',
      '{"predicate":"run-closed","runId":1,"pr":2}', '{"predicate":"review-passed","runId":1}']) {
      expect(parseEdgeTarget(bad), bad).toBeNull();
    }
  });
});

describe('remainingBodyOf, row by row', () => {
  for (const [name, run] of Object.entries(remainingBodyCases({ remainingBodyOf }))) it(name, run);
});

describe('edgeTargetVerdict', () => {
  for (const [name, run] of Object.entries(edgeTargetCases({ edgeTargetVerdict }))) it(name, run);
});

describe('remainingBodyOf, the exhaustive property', () => {
  // Each field present and good, absent, wrong-typed or out of range. The model names the first row a body fails; the
  // decider's detail must name that row, and only the all-good combination is accepted (row 10 is the only accepting
  // row, and an earlier row wins).
  const ABSENT = Symbol('absent');
  type V = unknown;
  const DOMAIN: Record<string, { v: V; bad: boolean }[]> = {
    lo: [{ v: 1, bad: false }, { v: ABSENT, bad: true }, { v: 'x', bad: true }, { v: 100, bad: true }, { v: 4, bad: false }],
    hi: [{ v: 3, bad: false }, { v: ABSENT, bad: true }, { v: null, bad: true }, { v: -1, bad: true }],
    reason: [{ v: 'r', bad: false }, { v: ABSENT, bad: true }, { v: 5, bad: true }, { v: 'a\nb', bad: true }],
    runId: [{ v: 7, bad: false }, { v: ABSENT, bad: false }, { v: 'x', bad: true }, { v: 0, bad: true }],
    edges: [
      { v: ABSENT, bad: false }, { v: [LANDED], bad: false }, { v: 'x', bad: true },
      { v: Array.from({ length: 11 }, (_, i) => ({ ...LANDED, target: { predicate: 'run-closed', runId: i + 1 } })), bad: true },
      { v: [{ ...LANDED, kind: 'needs-x' }], bad: true },
      { v: [{ ...LANDED, target: { predicate: 'run-closed', runId: -2 } }], bad: true },
      { v: [LANDED, LANDED], bad: true },
    ],
  };
  const ROW_RE: Record<number, RegExp> = {
    2: /^(lo|hi) must/, 3: /^lo must not exceed hi$/, 4: /^reason must/, 5: /^runId must/, 6: /^edges must/,
    7: /^edge \d+: kind/, 8: /^edge \d+: target runId must/, 9: /^edge \d+: duplicate edge/,
  };
  const fields = Object.keys(DOMAIN);
  const combos: Record<string, { v: V; bad: boolean }>[] = [{}];
  for (const f of fields) {
    const next: typeof combos = [];
    for (const c of combos) for (const opt of DOMAIN[f]!) next.push({ ...c, [f]: opt });
    combos.splice(0, combos.length, ...next);
  }
  /** The model: the first row this combination fails, or 10. */
  function rowOf(c: Record<string, { v: V; bad: boolean }>): number {
    if (c.lo!.bad || c.hi!.bad) return 2;
    if ((c.lo!.v as number) > (c.hi!.v as number)) return 3;
    if (c.reason!.bad) return 4;
    if (c.runId!.bad) return 5;
    const e = c.edges!.v;
    if (e === 'x' || (Array.isArray(e) && e.length > 10)) return 6;
    if (Array.isArray(e) && e.some((x) => (x as { kind: string }).kind === 'needs-x')) return 7;
    if (Array.isArray(e) && e.some((x) => ((x as { target: { runId: number } }).target.runId) < 0)) return 8;
    if (Array.isArray(e) && e.length === 2) return 9;
    return 10;
  }

  it(`every one of ${combos.length} combinations is refused by its first failing row, and only the good ones are accepted`, () => {
    expect(combos.length).toBe(5 * 4 * 4 * 4 * 7);
    let accepted = 0;
    for (const c of combos) {
      const body: Record<string, unknown> = {};
      for (const f of fields) if (c[f]!.v !== ABSENT) body[f] = c[f]!.v;
      const want = rowOf(c);
      const got = remainingBodyOf(body, NOW);
      const label = JSON.stringify(body);
      if (want === 10) {
        expect(got.ok, label).toBe(true);
        accepted++;
      } else {
        expect(got.ok, label).toBe(false);
        if (!got.ok) expect(got.detail, label).toMatch(ROW_RE[want]!);
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });

  it('monotonic: the good body with any one field broken is refused', () => {
    expect(remainingBodyOf(GOOD, NOW).ok).toBe(true);
    for (const f of fields) {
      for (const opt of DOMAIN[f]!.filter((o) => o.bad)) {
        const body: Record<string, unknown> = { ...GOOD };
        if (opt.v === ABSENT) delete body[f]; else body[f] = opt.v;
        expect(remainingBodyOf(body, NOW).ok, `${f} = ${String(opt.v === ABSENT ? 'absent' : JSON.stringify(opt.v))}`).toBe(false);
      }
    }
  });
});
