// The persistent tier, wired (child-reclamation spec §5.7, "the persistent tier"). The L1 rows
// (`child-reclaim-persistent-tier.test.ts`) pin the memory. Only the lane can show these:
//   - a LOST memory (a restart, a raised switch) is re-seeded from the mirror at the next first sighting;
//   - the re-seeded child is asked once on its next due pass, then waits the tier pace, never the 15-minute ramp;
//   - a rejection, which names no word, leaves the tier as it stands.
// FIXTURE HOME only. The rig is the ONE shared lane fixture (`childReclaimGenerationFixture.ts`). Its `exec`
// option stubs the executor at `Deps.childReclaimExec`, so nothing here runs ccd.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHILD_RECLAIM_SWEEP_MS } from '../src/watch.js';
import { RECLAIM_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { CHILD_RECLAIM_DEFER_CEILING_MS, childReclaimBackoffMs, childReclaimTierPaceMs } from '../src/childReclaimSweep.js';
import type { ChildReclaimOutcome, ChildReclaimRequest } from '../src/coord/childReclaim.js';
import { G1, G2, laneFixture } from './childReclaimGenerationFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

const ID = 'demo-a';
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const A = 'worktree-remove-failed';
const STUCK = 'containment-refuted';

/** The shared lane rig with the executor stubbed, and its answer switchable per case. Its watcher has never
 *  run, so its memory is a freshly restarted process's. */
const fixture = () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let answer: (req: ChildReclaimRequest) => ChildReclaimOutcome = (req) =>
    ({ kind: 'reclaimed', sessionId: req.sessionId, runId: req.runId, wip: { kind: 'none' }, secretsDropped: 0 });
  const f = laneFixture({ exec: (req) => answer(req) });
  const reclaimLine = (outcome: string, over: Record<string, unknown> = {}): void =>
    f.journal(ID, 'reclaim', outcome, { verb: 'ws-reclaim', ...over });
  /** A child of an abandoned run: its row, its marker and wave 7's `.generation` written, and its `create` mirrored. */
  const plantChild = (): void => { f.finishedChild(ID, G1); };
  /** ccd's own record of `n` earlier attempts that each failed with `word`. */
  const failures = (n: number, word: string): void => {
    for (let k = 0; k < n; k += 1) { f.advance(1); reclaimLine('intent'); reclaimLine('failed', { refusal: word }); }
  };
  /** The executor's answer for a failure with `word`, which ccd also journals. */
  const failedAs = (word: string) => (req: ChildReclaimRequest): ChildReclaimOutcome => {
    reclaimLine('failed', { refusal: word });
    return { kind: 'failed', sessionId: req.sessionId, runId: req.runId,
      resume: word === STUCK ? 'stuck' : 'resumable', detail: `${word}: d`, token: word };
  };
  /** ccd's own record of one earlier attempt the box refused with a RETRY word (ccd/ccd:30280's one emit). */
  const boxRetry = (word: string): void => { f.advance(1); reclaimLine('intent'); reclaimLine('refused', { refusal: word }); };
  /** `ws-add` minted the slug again: a new generation, and its `create` mirrored. */
  const remintSlug = (): void => { f.remint(ID, G2); f.journal(ID, 'create', 'done', { verb: 'ws-add' }); };
  return {
    reg: f.reg, requests: f.requests, plantChild, failures, boxRetry, failedAs, remintSlug, pass: f.pass, next: f.next,
    advance: f.advance, advanceTo: f.advanceTo, mono: f.mono,
    answer: (fn: (req: ChildReclaimRequest) => ChildReclaimOutcome) => { answer = fn; },
    entryOf: () => f.entryOf(ID),
  };
};

describe('the persistent tier, wired', () => {
  it('a restart does not fall back to the 15-minute ramp: the seed asks once, then waits the tier pace', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(6, A);
    await f.pass();                                                 // the first sighting, seeded from the mirror
    expect(f.requests).toHaveLength(0);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 6, tierJ: 2, lastFailedAt: null, consecutiveFailures: 0 });
    f.answer(f.failedAs(A));
    f.next();
    const askedAt = f.mono();
    await f.pass();
    expect(f.requests, 'asked once, on its next due pass').toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 7, tierJ: 3, consecutiveFailures: 1, lastFailedAt: askedAt });
    const pace = childReclaimTierPaceMs(3);
    expect(pace).toBe(8 * C);
    // today's ramp would ask two passes later, and one ceiling later at the latest
    for (const t of [childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS), C, pace - 2 * CHILD_RECLAIM_SWEEP_MS]) {
      f.advanceTo(askedAt + t);
      await f.pass();
      expect(f.requests, `at +${t} ms`).toHaveLength(1);
    }
    f.advanceTo(askedAt + pace);
    await f.pass();
    expect(f.requests, 'and asked again at exactly its tier pace').toHaveLength(2);
  });

  it('a memory clear never starves a tier child: the re-sighting asks it once on its next due pass', async () => {
    const f = fixture();
    f.plantChild();
    f.answer(f.failedAs(STUCK));
    await f.pass();
    f.next(); await f.pass();                                       // asked: stuck
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: STUCK, tierJ: 0 });
    writeFileSync(path.join(f.reg, RECLAIM_PAUSE_MARKER), '');
    f.next(); await f.pass();
    expect(f.entryOf(), 'the raised switch clears the memory').toBeUndefined();
    rmSync(path.join(f.reg, RECLAIM_PAUSE_MARKER));
    f.next(); await f.pass();                                       // the first sighting again, re-seeded
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: STUCK, tierRun: 1, tierJ: 0, lastFailedAt: null });
    expect(f.requests).toHaveLength(1);
    f.next(); await f.pass();
    expect(f.requests, 'asked once on its next due pass, never a fresh tier wait').toHaveLength(2);
    f.next(); await f.pass();
    expect(f.requests, 'then the tier pace again').toHaveLength(2);
  });

  it('a rejection names no word: the tier and its pace stand', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(4, A);
    await f.pass();
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0 });
    f.answer(() => { throw new Error('a defect the executor could not name'); });
    f.next();
    const askedAt = f.mono();
    await f.pass();
    expect(f.requests).toHaveLength(1);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0, consecutiveFailures: 1, lastFailedAt: askedAt });
    f.advanceTo(askedAt + childReclaimBackoffMs(1, CHILD_RECLAIM_SWEEP_MS));
    await f.pass();
    expect(f.requests, 'the ordinary ramp would have asked here').toHaveLength(1);
    f.advanceTo(askedAt + C);
    await f.pass();
    expect(f.requests).toHaveLength(2);
  });

  it('a journaled box retry refusal never resets the seed: the lane injects the one token kind', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(2, A);
    f.boxRetry('attached');                                         // the executor answered this one as a deferral
    f.failures(2, A);
    await f.pass();                                                 // the first sighting, seeded from the mirror
    expect(f.requests).toHaveLength(0);
    expect(f.entryOf()).toMatchObject({ tier: true, tierToken: A, tierRun: 4, tierJ: 0, lastFailedAt: null });
  });

  it('the seed reads the CURRENT generation only: a slug minted again never inherits the old workspace\'s tier', async () => {
    const f = fixture();
    f.plantChild();
    f.failures(6, A);
    f.advance(1_000);
    f.remintSlug();                                                 // ws-add minted the slug again
    await f.pass();
    expect(f.entryOf()).toMatchObject({ tier: false, tierToken: null, tierRun: 0, tierJ: 0 });
  });
});
