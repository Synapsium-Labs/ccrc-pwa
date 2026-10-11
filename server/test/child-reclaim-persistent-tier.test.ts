// The persistent tier (child-reclamation spec §5.9, "the persistent tier"). A failure that will not heal by itself
// (the stuck class, or the same word four times running) is asked about ever more slowly, but is never given up on:
// min(4 h, ceiling × 2^j). These rows pin the memory (L1, pure), the restart seed that rebuilds it from the
// mirror, and the ONE projection (coord/childReclaim.ts) that carries the stuck class to it. The lane's wiring
// is `child-reclaim-tier-lane.test.ts`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_PRE_LOCK_TOKEN, CHILD_RECLAIM_SWEEP_REJECTED,
  CHILD_RECLAIM_TIER_CAP_MS, CHILD_RECLAIM_TIER_ENTRY_RUN, CHILD_RECLAIM_TIER_NONE,
  childReclaimBackoffMs, childReclaimDue, childReclaimFailureWaitMs, childReclaimFirstSighting, childReclaimNextEntry,
  childReclaimTierCountable, childReclaimTierOf, childReclaimTierPaceMs, childReclaimTierSeed,
  isChildReclaimPreLockToken,
  type ChildReclaimAsk, type ChildReclaimLaneNow, type ChildReclaimSweepEntry, type ChildReclaimSweepOutcome,
  type ChildReclaimTierState,
} from '../src/childReclaimSweep.js';
import {
  CHILD_RECLAIM_PROBE_UNMEASURED, childReclaimSweepOutcomeOf, childReclaimTokenKind, isChildReclaimStuckToken,
  parseChildReclaimResult,
} from '../src/coord/childReclaim.js';
import type { LifecycleAct, LifecycleOutcome, MirroredLifecycleEvent } from '../../shared/api.js';

const NOW = 1_790_000_000_000;
/** The lane's pass interval, an ARGUMENT to every pacing function (this L1 file imports no L4 constant). */
const PASS = 60_000;
const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const CAP = CHILD_RECLAIM_TIER_CAP_MS;
const K = CHILD_RECLAIM_TIER_ENTRY_RUN;
/** The birth of the generation every entry here describes (ccd's clock, compared for equality only). */
const BORN = NOW - 3_600_000;
const RUN = 7;
const A = 'worktree-remove-failed';
const B = 'pin-failed';
const STUCK = 'containment-refuted';

const at = (mono: number): ChildReclaimLaneNow => ({ monoMs: mono, wallMs: mono });
const ask = (mono: number): ChildReclaimAsk => ({ at: at(mono), licensed: false, asHolder: false });
/** A first sighting, keyed by its registry generation (spec §5.5): no `.generation` file reads `absent`. */
const fresh = (): ChildReclaimSweepEntry => childReclaimFirstSighting(NOW, BORN, RUN, { kind: 'absent' });
/** A failure as the projection hands it to the memory: ccd's word, and the one stuck spelling. */
const failed = (token: string | null): ChildReclaimSweepOutcome =>
  ({ kind: 'failed', token, stuck: isChildReclaimStuckToken(token) });
/** One answer after another, a pass apart. */
const fold = (entry: ChildReclaimSweepEntry, outcomes: readonly ChildReclaimSweepOutcome[]): ChildReclaimSweepEntry =>
  outcomes.reduce((e, o, k) => childReclaimNextEntry(e, o, ask(NOW + k * PASS), at(NOW + k * PASS), PASS)!, entry);
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);
const tierOf = (e: ChildReclaimTierState): ChildReclaimTierState => childReclaimTierOf(e);

/** One mirrored journal row of `demo-a`, every field the type carries (copy the field list from
 *  `child-reclaim-sweep-policy.test.ts`'s `ev` if `MirroredLifecycleEvent` has gained one). */
const ev = (act: LifecycleAct, outcome: LifecycleOutcome, over: Partial<MirroredLifecycleEvent> = {}):
  MirroredLifecycleEvent => ({
  uid: null, at: NOW, act, badact: null, outcome, badoutcome: null, id: 'demo-a', tx: null,
  verb: act === 'create' ? 'ws-add' : 'ws-reclaim', refusal: null, detail: null, truncated: false,
  obs: null, dec: null, meas: null, raw: '', gen: '1', ingestedAt: NOW + 5, ...over,
});
/** What ccd journals for one failed attempt: its `intent`, then the word. A pre-lock die is journaled `refused`
 *  (it never took the lock); a word-less failure is written here as `failed` with no refusal. */
const attempt = (w: string | null): MirroredLifecycleEvent[] => [
  ev('reclaim', 'intent'),
  w !== null && isChildReclaimPreLockToken(w) ? ev('reclaim', 'refused', { refusal: w }) : ev('reclaim', 'failed', { refusal: w }),
];
/** The current generation: its opening create at BORN, then one attempt per word. */
const generation = (...words: (string | null)[]): MirroredLifecycleEvent[] =>
  [ev('create', 'done', { at: BORN }), ...words.flatMap(attempt)];
const seed = (rows: readonly MirroredLifecycleEvent[]): ChildReclaimTierState =>
  childReclaimTierSeed(rows, BORN, isChildReclaimStuckToken, childReclaimTokenKind);
/** What ccd journals for an attempt the box REFUSED with `w`: its `intent`, then the one `refused` emit every
 *  `ws-reclaim` refusal goes through (ccd/ccd:30280). */
const refusedAttempt = (w: string): MirroredLifecycleEvent[] => [ev('reclaim', 'intent'), ev('reclaim', 'refused', { refusal: w })];
/** A refused word no build was compiled to know: `childReclaimTokenKind` answers null for it. */
const UNKNOWN_REFUSAL = 'a-word-this-build-never-knew';
/** mulberry32: a seeded row replays exactly. */
const mulberry32 = (s: number): (() => number) => {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};

describe('the persistent tier: its two constants', () => {
  it('K is 4, the failure at which the ordinary ramp first reaches the ceiling, and the cap is four hours', () => {
    // HARDCODED literals on purpose: the mutation controls for the two constants.
    expect(CHILD_RECLAIM_TIER_ENTRY_RUN).toBe(4);
    expect(CHILD_RECLAIM_TIER_CAP_MS).toBe(14_400_000);
    expect(childReclaimBackoffMs(K - 1, PASS)).toBeLessThan(C);
    expect(childReclaimBackoffMs(K, PASS)).toBe(C);
  });
});

describe('entry', () => {
  it('(b) the K-th consecutive failure with the SAME word enters, and the three before it do not', () => {
    expect([1, 2, 3, 4, 5].map((n) => tierOf(fold(fresh(), times(n, failed(A)))))).toEqual([
      { tier: false, tierToken: A, tierJ: 0, tierRun: 1 },
      { tier: false, tierToken: A, tierJ: 0, tierRun: 2 },
      { tier: false, tierToken: A, tierJ: 0, tierRun: 3 },
      { tier: true, tierToken: A, tierJ: 0, tierRun: 4 },
      { tier: true, tierToken: A, tierJ: 1, tierRun: 5 },
    ]);
  });

  it('(a) a stuck answer enters at once, and j counts only past K, as the restart seed counts it', () => {
    expect(tierOf(fold(fresh(), [failed(STUCK)]))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
    expect(tierOf(fold(fresh(), times(K + 2, failed(STUCK))))).toEqual({ tier: true, tierToken: STUCK, tierJ: 2, tierRun: K + 2 });
  });

  it('a null word and every pre-lock word never count toward (b), however long they run', () => {
    expect(Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)).toEqual(expect.arrayContaining(['flock-unavailable', 'lock-unopenable']));
    for (const w of [null, ...Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)]) {
      expect(childReclaimTierCountable(w), String(w)).toBe(false);
      expect(tierOf(fold(fresh(), times(3 * K, failed(w)))), String(w)).toEqual(CHILD_RECLAIM_TIER_NONE);
    }
    expect(childReclaimTierCountable(A)).toBe(true);
    expect(childReclaimTierCountable(CHILD_RECLAIM_PROBE_UNMEASURED), 'the exit-1 audit\'s word counts').toBe(true);
  });

  it('an uncountable failure neither breaks, advances nor ends a run: the tier state stands as it was', () => {
    const member = fold(fresh(), times(K, failed(A)));
    for (const w of [null, ...Object.values(CHILD_RECLAIM_PRE_LOCK_TOKEN)]) {
      expect(tierOf(fold(member, [failed(w)])), String(w)).toEqual(tierOf(member));
    }
    expect(tierOf(fold(fresh(), [failed(A), failed(A), failed(null), failed('flock-unavailable'), failed(A), failed(A)])))
      .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
  });

  it('a rejection is written as a failure that names no word, so it is neutral too', () => {
    expect(CHILD_RECLAIM_SWEEP_REJECTED).toEqual({ kind: 'failed', token: null, stuck: false });
  });
});

describe('exit', () => {
  it('a different countable word ends the tier and starts a new run; a stuck word re-enters at once', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    expect(tierOf(fold(member, [failed(B)]))).toEqual({ tier: false, tierToken: B, tierJ: 0, tierRun: 1 });
    expect(tierOf(fold(member, [failed(STUCK)]))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
  });

  it('any refusal ends it, and reclaimed and gone forget the child', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    expect(tierOf(fold(member, [{ kind: 'refused', token: 'tree-unreadable' }]))).toEqual(CHILD_RECLAIM_TIER_NONE);
    for (const kind of ['reclaimed', 'gone'] as const) {
      expect(childReclaimNextEntry(member, { kind }, ask(NOW), at(NOW), PASS), kind).toBeNull();
    }
  });
});

describe('deferral', () => {
  it('keeps the tier (membership, its word, j and the run) and clears the ramp exactly as before', () => {
    const member = fold(fresh(), times(K + 1, failed(A)));
    for (const why of ['presence', 'attached', 'held', 'state-changed', 'generation-changed']) {
      const d = fold(member, [{ kind: 'deferred', why }]);
      expect(tierOf(d), why).toEqual(tierOf(member));
      expect(d, why).toMatchObject({ consecutiveFailures: 0, lastFailedAt: null });
      expect(childReclaimDue(d, NOW, PASS), `${why}: due on its next pass, so the presence lease is unchanged`).toBe(true);
      expect(tierOf(fold(d, [failed(A)])), `${why}: the next failure resumes the tier at j + 1`)
        .toEqual({ tier: true, tierToken: A, tierJ: 2, tierRun: K + 2 });
    }
  });
});

describe('pace', () => {
  it('min(cap, ceiling × 2^j): finite for every j, never below the ceiling', () => {
    const js = [0, 1, 2, 3, 4, 5, 50, 1e6, Infinity, Number.NaN, -3];
    const paces = js.map((j) => childReclaimTierPaceMs(j));
    expect(paces).toEqual([C, 2 * C, 4 * C, 8 * C, CAP, CAP, CAP, CAP, CAP, C, C]);
    for (const p of paces) expect(Number.isFinite(p)).toBe(true);
  });

  it('never faster than today: a member waits at least the ordinary ramp, and a non-member waits exactly it', () => {
    for (let k = 0; k <= 40; k += 1) {
      const e: ChildReclaimSweepEntry = { ...fresh(), consecutiveFailures: k, lastFailedAt: NOW };
      expect(childReclaimFailureWaitMs(e, PASS), `k=${k}`).toBe(childReclaimBackoffMs(k, PASS));
      for (let j = 0; j <= 10; j += 1) {
        expect(childReclaimFailureWaitMs({ ...e, tier: true, tierToken: A, tierJ: j, tierRun: K + j }, PASS), `k=${k} j=${j}`)
          .toBeGreaterThanOrEqual(childReclaimBackoffMs(k, PASS));
      }
    }
  });

  it('childReclaimDue reads the tier pace: a member at j = 1 waits two ceilings where today waits one', () => {
    const base: ChildReclaimSweepEntry = { ...fresh(), consecutiveFailures: 5, lastFailedAt: NOW };
    const member: ChildReclaimSweepEntry = { ...base, tier: true, tierToken: A, tierJ: 1, tierRun: K + 1 };
    expect(childReclaimDue(base, NOW + C, PASS)).toBe(true);
    expect(childReclaimDue(member, NOW + C, PASS)).toBe(false);
    expect(childReclaimDue(member, NOW + 2 * C - 1, PASS)).toBe(false);
    expect(childReclaimDue(member, NOW + 2 * C, PASS)).toBe(true);
  });
});

describe('the restart seed (childReclaimTierSeed)', () => {
  it('seeds nothing with no reclaim outcome in the generation', () => {
    expect(seed([])).toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(seed(generation())).toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(seed([ev('create', 'done', { at: BORN }), ev('reclaim', 'intent')])).toEqual(CHILD_RECLAIM_TIER_NONE);
  });

  it('six failures of one word, read past their intents, seed a member at j = 2', () => {
    expect(seed(generation(...times(6, A)))).toEqual({ tier: true, tierToken: A, tierJ: 2, tierRun: 6 });
  });

  it('a latest word in the stuck class seeds a member at once', () => {
    expect(seed(generation(A, STUCK))).toEqual({ tier: true, tierToken: STUCK, tierJ: 0, tierRun: 1 });
  });

  it('fewer than K seeds no member but carries its run, so the K-th failure is the same failure after a restart', () => {
    const s = seed(generation(A, A, A));
    expect(s).toEqual({ tier: false, tierToken: A, tierJ: 0, tierRun: 3 });
    expect(tierOf(fold({ ...fresh(), ...s }, [failed(A)]))).toMatchObject({ tier: true, tierRun: 4 });
  });

  it('a different word ends the count, so only the latest run is read', () => {
    expect(seed(generation(...times(5, A), B, B))).toEqual({ tier: false, tierToken: B, tierJ: 0, tierRun: 2 });
  });

  it('a pre-lock refusal and a word-less failure are read past, as the live memory is neutral to them', () => {
    expect(seed(generation(A, A, 'flock-unavailable', null, 'token-malformed', A, A)))
      .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
  });

  it('a journaled box retry refusal and an unclassified refused word are read past, as the live memory keeps the tier through them', () => {
    expect(childReclaimTokenKind('attached')).toBe('retry');
    expect(childReclaimTokenKind(UNKNOWN_REFUSAL)).toBeNull();
    for (const w of ['attached', 'held', 'in-progress', UNKNOWN_REFUSAL]) {
      expect(seed([...generation(A, A), ...refusedAttempt(w), ...attempt(A), ...attempt(A)]), w)
        .toEqual({ tier: true, tierToken: A, tierJ: 0, tierRun: 4 });
    }
  });

  it('any other reclaim outcome ends the walk; another act is read past', () => {
    for (const end of [ev('reclaim', 'refused', { refusal: 'tree-unreadable' }), ev('reclaim', 'refused', { refusal: 'no-such-session' }),
      ev('reclaim', 'done'), ev('reclaim', 'unknown')]) {
      expect(seed([...generation(...times(5, A)), end]), `${end.outcome}:${String(end.refusal)}`).toEqual(CHILD_RECLAIM_TIER_NONE);
    }
    expect(seed([...generation(...times(4, A)), ev('hold', 'done')])).toMatchObject({ tier: true, tierRun: 4 });
  });

  it('reads the entry\'s OWN generation: an opening create at another birth, or no birth, seeds nothing', () => {
    expect(childReclaimTierSeed(generation(...times(6, A)), BORN + 1, isChildReclaimStuckToken, childReclaimTokenKind))
      .toEqual(CHILD_RECLAIM_TIER_NONE);
    expect(childReclaimTierSeed(generation(...times(6, A)), null, isChildReclaimStuckToken, childReclaimTokenKind))
      .toEqual(CHILD_RECLAIM_TIER_NONE);
  });

  it('reads no clock: past the opening create, no row\'s own `at` changes the answer', () => {
    const plain = generation(...times(6, A));
    const skewed = plain.map((e, k) => (k === 0 ? e : { ...e, at: k % 2 === 0 ? null : NOW + 10 * 86_400_000 }));
    expect(seed(skewed)).toEqual(seed(plain));
  });

  it('the seed and the live memory agree on every sequence: a restart reads back what the process that died held', () => {
    const rnd = mulberry32(78);
    const words: readonly (string | null)[] =
      [A, B, STUCK, null, 'flock-unavailable', 'token-malformed', 'defer', 'box-retry', 'refused-unknown'];
    for (let trial = 0; trial < 500; trial += 1) {
      let live = fresh();
      const rows: MirroredLifecycleEvent[] = [ev('create', 'done', { at: BORN })];
      const seq: (string | null)[] = [];
      const n = 1 + Math.floor(rnd() * 14);
      for (let k = 0; k < n; k += 1) {
        const w = words[Math.floor(rnd() * words.length)]!;
        seq.push(w);
        // A deferral is journaled nowhere (a retryable verdict never is), and the memory keeps the tier through it.
        if (w === 'defer') { live = fold(live, [{ kind: 'deferred', why: 'presence' }]); continue; }
        // A box retry refusal IS journaled (`refused attached`), and the executor answers it as a deferral.
        if (w === 'box-retry') {
          live = fold(live, [{ kind: 'deferred', why: 'attached' }]);
          rows.push(...refusedAttempt('attached'));
          continue;
        }
        // A refused word this build cannot classify is journaled too, and answered as a failure that names no word.
        if (w === 'refused-unknown') {
          live = fold(live, [failed(null)]);
          rows.push(...refusedAttempt(UNKNOWN_REFUSAL));
          continue;
        }
        live = fold(live, [failed(w)]);
        rows.push(...attempt(w));
      }
      expect(seed(rows), JSON.stringify(seq)).toEqual(tierOf(live));
    }
  });
});

describe('the one projection, coord/childReclaim.ts → the memory', () => {
  it('carries ccd\'s word and the one stuck spelling, and agrees with the parser\'s stuck class', () => {
    const o = { sessionId: 'demo-a', runId: RUN, detail: 'd' } as const;
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'stuck', token: STUCK }))
      .toEqual({ kind: 'failed', token: STUCK, stuck: true });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'resumable', token: A }))
      .toEqual({ kind: 'failed', token: A, stuck: false });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'failed', resume: 'resumable', token: null }))
      .toEqual({ kind: 'failed', token: null, stuck: false });
    expect(childReclaimSweepOutcomeOf({ kind: 'gone', sessionId: 'demo-a' })).toEqual({ kind: 'gone' });
    expect(childReclaimSweepOutcomeOf({ kind: 'reclaimed', sessionId: 'demo-a', runId: RUN, wip: { kind: 'none' }, secretsDropped: 0 }))
      .toEqual({ kind: 'reclaimed' });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'refused', token: 'tree-unreadable', sentence: 's' }))
      .toEqual({ kind: 'refused', token: 'tree-unreadable' });
    expect(childReclaimSweepOutcomeOf({ ...o, kind: 'deferred', why: 'presence' })).toEqual({ kind: 'deferred', why: 'presence' });
    for (const [word, stuck] of [[STUCK, true], [A, false]] as const) {
      const p = parseChildReclaimResult('demo-a', JSON.stringify({ failed: word, detail: 'x', crumb: true }), '');
      if (p.kind !== 'failed') throw new Error(`expected a failed read, got ${p.kind}`);
      expect(p.resume === 'stuck', word).toBe(stuck);
      expect(childReclaimSweepOutcomeOf({ ...p, sessionId: 'demo-a', runId: RUN }), word).toEqual({ kind: 'failed', token: word, stuck });
    }
  });
});

describe('the backoff\'s docstrings', () => {
  it('no longer promise that a failing child is asked at least once a ceiling', () => {
    const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'childReclaimSweep.ts'), 'utf8');
    expect(src).not.toContain('still asked for at least once a');
    expect(src).not.toContain('The same span caps the failure backoff');
  });
});
