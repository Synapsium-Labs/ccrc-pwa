// Overlord W2 remaining work B (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md, Task 4): an
// edge's verdict from the done-test reader's answer. The row cases live in `sim/programmeFactsSets.ts`, so the mutation
// floor runs the same cases against each mutant; this file adds the exhaustive table over the domain and the
// monotonicity property.
import { describe, it, expect } from 'vitest';
import { EDGE_VERDICT_WORDS, edgeVerdict, type EdgeVerdictEdge } from '../src/coord/edgeVerdict.js';
import { EDGE_EVIDENCE_MAX, EDGE_STATES, EDGE_UNMEASURABLE_AFTER_MS } from '../../shared/programmeFacts.js';
import type { TargetAnswer } from '../../shared/doneTests.js';
import { ANSWERS, EVIDENCE_MAX, NOW, UNMEASURABLE_AFTER_MS, edgeVerdictCases, settleOf } from './sim/programmeFactsSets.js';

describe('edgeVerdict: the rows', () => {
  for (const [name, run] of Object.entries(edgeVerdictCases({ edgeVerdict }))) it(name, run);
});

describe('edgeVerdict: the domain', () => {
  it('the written-out bounds the cases use are the shipped constants', () => {
    expect([EDGE_EVIDENCE_MAX, EDGE_UNMEASURABLE_AFTER_MS]).toEqual([EVIDENCE_MAX, UNMEASURABLE_AFTER_MS]);
  });

  // Every edge state, read or unreadable, times every answer kind, times a clock that is null or at any age.
  const clocks = [null, NOW, NOW - 1, NOW - UNMEASURABLE_AFTER_MS + 1, NOW - UNMEASURABLE_AFTER_MS, NOW - 10 * UNMEASURABLE_AFTER_MS];
  const edges: EdgeVerdictEdge[] = [];
  for (const state of EDGE_STATES) {
    for (const unmeasuredSince of clocks) {
      edges.push({ state, unmeasuredSince });
      if (state === 'open') {
        edges.push({ state, stateUnreadable: true, unmeasuredSince });
        edges.push({ state, kindUnreadable: true, unmeasuredSince });
        edges.push({ state, targetUnreadable: true, unmeasuredSince });
      }
    }
  }
  const settled = (e: EdgeVerdictEdge) =>
    e.state === 'open' && e.stateUnreadable !== true && e.kindUnreadable !== true && e.targetUnreadable !== true;
  const old = (e: EdgeVerdictEdge) => e.unmeasuredSince !== null && NOW - e.unmeasuredSince >= UNMEASURABLE_AFTER_MS;

  /** The table, written out over the domain: the expected word and the state or clock it hands the writer. */
  const expected = (e: EdgeVerdictEdge, a: TargetAnswer): [string, string] => {
    if (!settled(e)) return ['none', '-'];
    if (a.kind === 'unmeasured') return old(e) ? ['unmeasurable', 'target-unmeasurable'] : ['unmeasured', `clock ${e.unmeasuredSince ?? NOW}`];
    if (a.kind === 'unmeasurable') return ['unmeasurable', 'target-unmeasurable'];
    if (a.kind === 'passed') return ['met', 'met'];
    if (a.kind === 'ended') return ['ended', 'target-ended'];
    return ['pending', 'clock null'];
  };

  it('is total and first match over every edge, answer and clock', () => {
    let n = 0;
    for (const e of edges) {
      for (const a of ANSWERS) {
        const v = edgeVerdict(e, a, NOW);
        expect(EDGE_VERDICT_WORDS).toContain(v.verdict);
        const got: [string, string] = v.verdict === 'none' ? ['none', '-']
          : [v.verdict, v.settle.kind === 'end' ? v.settle.state : `clock ${v.settle.unmeasuredSince}`];
        expect(got, JSON.stringify({ e, a })).toEqual(expected(e, a));
        n += 1;
      }
      expect(settleOf(edgeVerdict(e, null, NOW)), 'a target not asked is never settled').toBe('none');
    }
    expect(n).toBe(edges.length * ANSWERS.length);
  });

  it('is monotonic: an unmeasured answer in place of any answer never moves a verdict to met or ended', () => {
    const unmeasured: TargetAnswer[] = [{ kind: 'unmeasured', why: 'Error' }, { kind: 'unmeasured', why: 'thrown' }];
    for (const e of edges) {
      for (const u of unmeasured) {
        const v = edgeVerdict(e, u, NOW).verdict;
        expect(['met', 'ended']).not.toContain(v);
      }
      // And no answer clears an edge that is not open, or one whose state this build cannot read.
      if (!settled(e)) for (const a of ANSWERS) expect(settleOf(edgeVerdict(e, a, NOW))).toBe('none');
    }
  });

  it('never reads an unmeasured or unmeasurable answer as met', () => {
    for (const e of edges) {
      for (const a of ANSWERS.filter((x) => x.kind === 'unmeasured' || x.kind === 'unmeasurable')) {
        const v = edgeVerdict(e, a, NOW);
        if (v.verdict !== 'none' && v.settle.kind === 'end') expect(v.settle.state).toBe('target-unmeasurable');
      }
    }
  });
});
