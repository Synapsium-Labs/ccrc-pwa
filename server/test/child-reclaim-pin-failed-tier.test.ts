// The persistent tier's carried case (child-reclamation spec §5.7, "the persistent tier"): a repository whose
// admin entry is corrupt fails every reclaim the same way. Each audit mints a fresh token, and each act answers
// `failed:pin-failed` with `crumb:false`, which reads not-resumable. The tier counts the failure WORD, never the
// audit token, so that run of failures still enters the tier at the K-th, and is asked ever more slowly instead of
// on the ordinary ramp. These rows pin the path from ccd's document, through the one projection, to the memory.
import { describe, it, expect } from 'vitest';
import {
  CHILD_RECLAIM_TIER_ENTRY_RUN, childReclaimFirstSighting, childReclaimNextEntry, childReclaimTierOf,
  type ChildReclaimAsk, type ChildReclaimLaneNow, type ChildReclaimSweepEntry, type ChildReclaimSweepOutcome,
} from '../src/childReclaimSweep.js';
import { childReclaimSweepOutcomeOf, parseChildReclaimResult } from '../src/coord/childReclaim.js';

const NOW = 1_790_000_000_000;
const PASS = 60_000;
const K = CHILD_RECLAIM_TIER_ENTRY_RUN;
const BORN = NOW - 3_600_000;
const RUN = 7;
const ID = 'demo-a';
const WORD = 'pin-failed';

const at = (mono: number): ChildReclaimLaneNow => ({ monoMs: mono, wallMs: mono });
const ask = (mono: number): ChildReclaimAsk => ({ at: at(mono), licensed: false, asHolder: false });

/** ccd's answer to one act on that repository, read and projected as the lane reads and projects it. */
const projected = (): ChildReclaimSweepOutcome => {
  const p = parseChildReclaimResult(ID, JSON.stringify({ failed: WORD, detail: 'the admin entry is blank', crumb: false }), '');
  if (p.kind !== 'failed') throw new Error(`expected a failed read, got ${p.kind}`);
  return childReclaimSweepOutcomeOf({ ...p, sessionId: ID, runId: RUN });
};

describe('the carried case through the one projection (spec §5.7)', () => {
  it('a not-resumable pin-failed answer keeps its word, so the tier can count it', () => {
    const p = parseChildReclaimResult(ID, JSON.stringify({ failed: WORD, detail: 'd', crumb: false }), '');
    expect(p).toMatchObject({ kind: 'failed', resume: 'not-resumable', token: WORD });
    expect(projected()).toEqual({ kind: 'failed', token: WORD, stuck: false });
  });
});

describe('the carried case entering the tier (spec §5.7)', () => {
  it('K pin-failed answers in a row enter the tier at the K-th, and the ones before it do not', () => {
    const fold = (n: number): ChildReclaimSweepEntry => Array.from({ length: n }, projected).reduce(
      (e, o, k) => childReclaimNextEntry(e, o, ask(NOW + k * PASS), at(NOW + k * PASS), PASS)!,
      childReclaimFirstSighting(NOW, BORN, RUN, { kind: 'absent' }));
    expect(K).toBe(4);
    expect([1, 2, 3, 4, 5].map((n) => childReclaimTierOf(fold(n)))).toEqual([
      { tier: false, tierToken: WORD, tierJ: 0, tierRun: 1 },
      { tier: false, tierToken: WORD, tierJ: 0, tierRun: 2 },
      { tier: false, tierToken: WORD, tierJ: 0, tierRun: 3 },
      { tier: true, tierToken: WORD, tierJ: 0, tierRun: 4 },
      { tier: true, tierToken: WORD, tierJ: 1, tierRun: 5 },
    ]);
  });
});
