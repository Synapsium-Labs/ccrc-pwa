// The temp-root collector's pacing and its attention causes (child-reclamation spec §5.10, pacing). Per id, in memory
// only: a DEFERRAL count that never enters a tier, and three runs (FAILING, VERB-FAILED, TERMINAL), each paced by wave
// 8's formula, IMPORTED: membership and j from `childReclaimTierFrom`, the wait from `childReclaimTierPaceMs` or
// `childReclaimBackoffMs`. The next ask is the LATEST of every wait. These rows pin the pure half (L1,
// `server/src/collectLane.ts`); the counts below are driven against the imported pace, never a copied sequence.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHILD_RECLAIM_DEFER_CEILING_MS, CHILD_RECLAIM_TIER_ENTRY_RUN, childReclaimBackoffMs, childReclaimTierFrom,
  childReclaimTierPaceMs,
} from '../src/childReclaimSweep.js';
import {
  COLLECT_CHANGED_RECENTLY_SPAN_MS, COLLECT_PROBE_CLASS, COLLECT_RUN_NONE, COLLECT_VERDICT_TABLE, COLLECT_VERDICT_WORDS,
  collectAfterAct, collectAfterAudit, collectAfterFoldFailed, collectAfterHold, collectAfterPresence, collectAfterWouldCollect,
  collectAttentionCauses, collectDue, collectFeedCueOfAct, collectFeedCueOfAudit, collectFeedStep, collectFirstSighting,
  collectIdleSchedule, collectLicence,
  collectNextAskMono, collectRefusalClass, collectRipe, collectRunTier, collectWouldCollectKey, collectWouldCollectStands,
  type CollectAudit, type CollectEntry, type CollectResult,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DAY, DIE, MIN, NO_DOCUMENT, OBSERVE, PASS, T1, T2, UNREADABLE, WALL0, collectable,
  failedAct, refusedAct, step, unmeasured, verdict,
} from './collectAnswers.js';
import { CCD } from './ccdWsHelpers.js';
import { codeOnly } from './sourceScan.js';

const C = CHILD_RECLAIM_DEFER_CEILING_MS;
const K = CHILD_RECLAIM_TIER_ENTRY_RUN;
const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** One id's memory, every generation from one counter, every answer fresh unless said. */
const id = () => {
  let g = 0;
  let e: CollectEntry = collectFirstSighting(++g);
  const self = {
    e: (): CollectEntry => e,
    audit: (a: CollectAudit, mono: number, wall?: number) => { e = collectAfterAudit(e, a, step(mono, ++g, wall), true); return self; },
    act: (r: CollectResult, mono: number) => { e = collectAfterAct(e, r, step(mono, ++g)); return self; },
    hold: (mono: number) => { e = collectAfterHold(e, 'run-open', step(mono, ++g)); return self; },
    presence: (mono: number) => { e = collectAfterPresence(e, step(mono, ++g)); return self; },
    wouldCollect: (mono: number) => { e = collectAfterWouldCollect(e, step(mono, ++g)); return self; },
    next: (): number | null => collectNextAskMono(e, PASS, OBSERVE),
  };
  return self;
};
/** The imported pace for a run's k-th answer: the tier's once on the tier, else the ramp. */
const runWait = (token: 'failing' | 'verb-failed' | 'terminal', k: number, stuck: boolean): number => {
  const t = childReclaimTierFrom(token, k, stuck);
  return t.tier ? childReclaimTierPaceMs(t.tierJ) : childReclaimBackoffMs(k, PASS);
};
const BOX_WIDE = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'box-wide').map(([p]) => p);
const PER_LEAF = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'per-leaf').map(([p]) => p);
const LOAD = Object.entries(COLLECT_PROBE_CLASS).filter(([, c]) => c === 'load-sensitive').map(([p]) => p);
const DEFER_WORDS = COLLECT_VERDICT_WORDS.filter((w) => COLLECT_VERDICT_TABLE[w].pace === 'defer');
const TERMINAL_WORDS = COLLECT_VERDICT_WORDS.filter((w) => COLLECT_VERDICT_TABLE[w].pace === 'terminal');

describe('the verdict table is ccd\'s collector refusal words, and agrees with the refusal table', () => {
  it('holds exactly the words ccd\'s `_ws_collect_refuse` is called with, in both directions', () => {
    const src = readFileSync(CCD, 'utf8');
    const words = [...new Set([...src.matchAll(/\b_ws_collect_refuse ([a-z-]+) /g)].map((m) => m[1]!))].sort();
    expect(words.length, 'a floor: the scan reads something').toBeGreaterThanOrEqual(9);
    expect([...COLLECT_VERDICT_WORDS].sort()).toEqual(words);
  });

  it('a word is terminal here exactly when the verb\'s refusal table reads it terminal', () => {
    expect(TERMINAL_WORDS).toEqual(['witness-mismatch', 'quarantine-kept', 'containment-unproven']);
    for (const w of COLLECT_VERDICT_WORDS) {
      expect(collectRefusalClass(w), w).toBe(COLLECT_VERDICT_TABLE[w].pace === 'terminal' ? 'terminal' : 'retry');
    }
  });
});

describe('the DEFERRAL count', () => {
  const ADVANCING: readonly (readonly [string, (i: ReturnType<typeof id>, m: number) => void])[] = [
    ...DEFER_WORDS.map((w) => [`the verdict ${w}`, (i: ReturnType<typeof id>, m: number) => { i.audit(verdict(w), m); }] as const),
    ...BOX_WIDE.map((p) => [`unmeasured ${p}`, (i: ReturnType<typeof id>, m: number) => { i.audit(unmeasured(p), m); }] as const),
    ['a verb refusal', (i, m) => { i.act(refusedAct('state-changed'), m); }],
    ['a recognised pre-lock die', (i, m) => { i.act(DIE, m); }],
    ['changed-recently with no idleAt', (i, m) => { i.audit(verdict('changed-recently', null), m); }],
    ['not-witnessed', (i, m) => { i.audit(verdict('not-witnessed'), m); }],
  ];

  it.each(ADVANCING)('%s advances it, and waits the imported ramp over it from its own last arrival', (_l, adv) => {
    const i = id();
    for (let k = 1; k <= 6; k += 1) {
      adv(i, k * DAY);
      expect(i.e().deferrals, `k=${k}`).toBe(k);
      expect(i.next(), `k=${k}`).toBeGreaterThanOrEqual(k * DAY + childReclaimBackoffMs(k, PASS));
    }
    expect([i.e().failing, i.e().verbFailed, i.e().terminal].map((r) => r.kind), 'it never enters a run').toEqual(['none', 'none', 'none']);
  });

  it('a box-wide probe, repeated for ever, never reaches a tier: the ramp\'s cap is its longest wait', () => {
    const i = id();
    for (let k = 1; k <= 40; k += 1) i.audit(unmeasured('flock'), k * DAY);
    expect(i.next()).toBe(40 * DAY + C);
    expect(collectAttentionCauses(i.e())).toEqual([]);
  });

  const CLEARING: readonly (readonly [string, (i: ReturnType<typeof id>, m: number) => void])[] = [
    ['collectable', (i, m) => { i.audit(collectable(T1), m); }],
    ['changed-recently with an idleAt', (i, m) => { i.audit(verdict('changed-recently', 0), m); }],
    ['a terminal verdict', (i, m) => { i.audit(verdict('quarantine-kept'), m); }],
    ['a per-leaf probe', (i, m) => { i.audit(unmeasured('mode'), m); }],
    ['a load-sensitive probe', (i, m) => { i.audit(unmeasured('checkouts'), m); }],
    ['no document', (i, m) => { i.audit(NO_DOCUMENT, m); }],
    ['an unreadable document', (i, m) => { i.audit(UNREADABLE, m); }],
    ['the verb\'s failed', (i, m) => { i.act(failedAct(), m); }],
    ['an act with no document', (i, m) => { i.act(ACT_NO_DOCUMENT, m); }],
    ['collected', (i, m) => { i.act(COLLECTED, m); }],
  ];

  it.each(CLEARING)('%s clears it', (_l, clear) => {
    const i = id().audit(verdict('in-use'), 0).audit(verdict('in-use'), MIN);
    expect(i.e().deferrals).toBe(2);
    clear(i, 2 * MIN);
    expect([i.e().deferrals, i.e().deferredAtMono]).toEqual([0, null]);
  });

  it('not-witnessed clears the three runs as it advances the count, and a verb refusal of it reads the same, beside the floor', () => {
    const runs = (e: CollectEntry) => [e.failing, e.verbFailed, e.terminal];
    const audited = id().audit(unmeasured('checkouts'), 0).act(failedAct(), MIN).audit(verdict('quarantine-kept'), 2 * MIN)
      .audit(verdict('in-use'), 3 * MIN).audit(verdict('not-witnessed'), 4 * MIN);
    expect(runs(audited.e()), 'the audit').toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
    expect(audited.e().deferrals, 'the audit').toBe(2);
    const refused = id().audit(unmeasured('checkouts'), 0).act(failedAct(), MIN).audit(verdict('quarantine-kept'), 2 * MIN)
      .act(refusedAct('not-witnessed'), 3 * MIN);
    expect(runs(refused.e()), 'the verb').toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
    expect([refused.e().deferrals, refused.e().refusedAtMono, refused.next()], 'the verb').toEqual([1, 3 * MIN, 3 * MIN + C]);
  });
});

describe('the FAILING run', () => {
  it('every load-sensitive probe, an unknown one, no document, an unreadable document and an unknown verdict advance it', () => {
    const answers: CollectAudit[] = [...LOAD.map(unmeasured), unmeasured('a-probe-no-build-knows'),
      unmeasured('constructor'), NO_DOCUMENT, UNREADABLE, verdict('a-verdict-no-build-knows'), verdict('constructor'),
      verdict('toString')];
    const i = id();
    answers.forEach((a, k) => i.audit(a, k * DAY));
    expect(i.e().failing).toMatchObject({ kind: 'run', run: answers.length, stuck: false, word: 'toString' });
  });

  it('its token is its class, so alternating probes never restart it: on the tier at the fourth', () => {
    const i = id();
    const probes = ['idle:timeout', 'idle:walk-failed', 'checkouts', 'rows', 'lock'];
    probes.forEach((p, k) => {
      i.audit(unmeasured(p), k * DAY);
      expect(collectRunTier(i.e().failing, 'failing'), p).toEqual(childReclaimTierFrom('failing', k + 1, false));
      expect(i.next(), p).toBe(k * DAY + runWait('failing', k + 1, false));
    });
    expect(collectRunTier(i.e().failing, 'failing')).toMatchObject({ tier: true, tierJ: 1 });
  });

  it('a per-leaf deterministic probe enters the tier at once, and a later answer of another class keeps it there', () => {
    for (const p of PER_LEAF) {
      const i = id().audit(unmeasured(p), 0);
      expect(collectRunTier(i.e().failing, 'failing'), p).toMatchObject({ tier: true, tierJ: 0, tierRun: 1 });
      expect(i.next(), p).toBe(C);
      i.audit(unmeasured('checkouts'), C);
      expect(collectRunTier(i.e().failing, 'failing'), p).toMatchObject({ tier: true, tierRun: 2 });
      expect(i.next(), p).toBe(2 * C);
    }
  });

  it('one id with a lock that answers `lock` on every audit reaches the tier at the fourth', () => {
    const i = id();
    for (let k = 1; k <= K; k += 1) i.audit(unmeasured('lock'), k * DAY);
    expect(collectRunTier(i.e().failing, 'failing')).toMatchObject({ tier: true, tierJ: 0 });
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'failing', word: 'lock', detail: 'lock: d' }]);
  });

  it('is cleared only by collectable, changed-recently, not-witnessed and collected', () => {
    const keeps: readonly CollectAudit[] = [verdict('in-use'), verdict('quarantine-kept'), unmeasured('flock')];
    for (const a of keeps) {
      const i = id().audit(unmeasured('checkouts'), 0).audit(a, MIN);
      expect(i.e().failing, JSON.stringify(a)).toMatchObject({ kind: 'run', run: 1 });
    }
    for (const r of [failedAct(), refusedAct('state-changed'), DIE, ACT_NO_DOCUMENT]) {
      const i = id().audit(unmeasured('checkouts'), 0).act(r, MIN);
      expect(i.e().failing, JSON.stringify(r)).toMatchObject({ kind: 'run', run: 1 });
    }
    for (const a of [collectable(T1), verdict('changed-recently', 0), verdict('not-witnessed')]) {
      expect(id().audit(unmeasured('checkouts'), 0).audit(a, MIN).e().failing, JSON.stringify(a)).toEqual(COLLECT_RUN_NONE);
    }
    expect(id().audit(unmeasured('checkouts'), 0).act(COLLECTED, MIN).e().failing).toEqual(COLLECT_RUN_NONE);
  });
});

describe('the VERB-FAILED run', () => {
  it('failed, then collectable twice, waits the ramp; the fourth failure waits the tier pace; an observation never clears it', () => {
    const i = id();
    let t = 0;
    for (let k = 1; k <= 6; k += 1) {
      i.act(failedAct(), t);
      expect(i.e().verbFailed, `failure ${k}`).toMatchObject({ kind: 'run', run: k });
      const wait = runWait('verb-failed', k, false);
      expect(wait, `failure ${k}`).toBe(k < K ? childReclaimBackoffMs(k, PASS) : childReclaimTierPaceMs(k - K));
      expect(i.next(), `failure ${k}`).toBe(t + wait);
      t += wait;
      i.audit(collectable(T1), t);                // the learning audit: observation 1
      t += OBSERVE;
      i.audit(collectable(T1), t);                // the job's audit: observation 2, and the act at once
    }
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'verb-failed', word: 'probe-unmeasured', detail: 'probe-unmeasured: d' }]);
  });

  it('an act with no document advances it as `failed` does', () => {
    expect(id().act(ACT_NO_DOCUMENT, 0).act(failedAct(), MIN).e().verbFailed).toMatchObject({ kind: 'run', run: 2 });
  });

  it('is cleared only by collected and not-witnessed', () => {
    for (const a of [collectable(T1), verdict('changed-recently', 0), verdict('in-use'), unmeasured('checkouts'), verdict('quarantine-kept')]) {
      expect(id().act(failedAct(), 0).audit(a, MIN).e().verbFailed, JSON.stringify(a)).toMatchObject({ kind: 'run', run: 1 });
    }
    expect(id().act(failedAct(), 0).audit(verdict('not-witnessed'), MIN).e().verbFailed).toEqual(COLLECT_RUN_NONE);
    expect(id().act(failedAct(), 0).act(COLLECTED, MIN).e().verbFailed).toEqual(COLLECT_RUN_NONE);
  });
});

describe('the TERMINAL run', () => {
  /** Asks at EXACTLY each next ask, latency 0, for `span`; every other answer is `between` when given. Returns the
   *  arrivals of the terminal answers, and the memory at the end. */
  const drive = (span: number, between: CollectAudit | null) => {
    const i = id();
    const terminal: number[] = [];
    let t = 0;
    for (let k = 0; t < span; k += 1) {
      const a = between !== null && k % 2 === 1 ? between : verdict(k % 4 === 0 ? 'quarantine-kept' : 'witness-mismatch');
      i.audit(a, t);
      if (a.kind === 'verdict') terminal.push(t);
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    return { terminal, e: i.e() };
  };

  it('enters the tier at once, and ccd\'s word changing never restarts it', () => {
    const i = id().audit(verdict('witness-mismatch'), 0).audit(verdict('quarantine-kept'), C).audit(verdict('containment-unproven'), 2 * C);
    expect(collectRunTier(i.e().terminal, 'terminal')).toEqual(childReclaimTierFrom('terminal', 3, true));
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'terminal', word: 'containment-unproven', detail: 'containment-unproven: d' }]);
  });

  it('is asked no sooner than the imported pace: 12 journaled terminal audits in the first 24 h, then 6 a day', () => {
    const { terminal } = drive(3 * DAY, null);
    terminal.slice(1).forEach((at, k) => {
      expect(at - terminal[k]!, `gap after the terminal answer ${k + 1}`).toBe(runWait('terminal', k + 1, true));
    });
    expect(terminal.filter((at) => at < DAY)).toHaveLength(12);
    expect(terminal.filter((at) => at >= DAY && at < 2 * DAY)).toHaveLength(6);
    expect(terminal.filter((at) => at >= 2 * DAY && at < 3 * DAY)).toHaveLength(6);
  });

  it('the same bound holds with a terminal answer alternating with `unmeasured checkouts`, and the run counts through them', () => {
    const { terminal, e } = drive(3 * DAY, unmeasured('checkouts'));
    terminal.slice(1).forEach((at, k) => {
      expect(at - terminal[k]!, `gap after the terminal answer ${k + 1}`).toBeGreaterThanOrEqual(runWait('terminal', k + 1, true));
    });
    expect(e.terminal).toMatchObject({ kind: 'run', run: terminal.length });
    expect(terminal.filter((at) => at < DAY).length).toBeLessThanOrEqual(12);
    expect(terminal.filter((at) => at >= DAY && at < 2 * DAY).length).toBeLessThanOrEqual(6);
  });

  it('any other answer between two terminal answers leaves the run, its j and its last terminal arrival as they stand', () => {
    const between: readonly CollectAudit[] = [unmeasured('checkouts'), unmeasured('flock'), verdict('in-use'), NO_DOCUMENT,
      verdict('changed-recently', 0), collectable(T1)];
    for (const a of between) {
      const i = id();
      for (let k = 0; k < 6; k += 1) i.audit(verdict('quarantine-kept'), k * DAY);
      const before = i.e().terminal;
      i.audit(a, 6 * DAY);
      expect(i.e().terminal, JSON.stringify(a)).toEqual(before);
    }
  });

  it('a verb refusal or failure of a terminal word advances it too, ahead of the verb-failed row, and a retryable one does not', () => {
    for (const w of TERMINAL_WORDS) {
      expect(id().act(refusedAct(w), 0).e().terminal, w).toMatchObject({ kind: 'run', run: 1, word: w });
    }
    expect(id().act(refusedAct('state-changed'), 0).e().terminal).toEqual(COLLECT_RUN_NONE);
    const kept = id().act(failedAct('quarantine-kept'), 0).e();
    expect([kept.terminal, kept.verbFailed], 'failed quarantine-kept')
      .toEqual([expect.objectContaining({ kind: 'run', run: 1, word: 'quarantine-kept' }), COLLECT_RUN_NONE]);
    expect(id().act(failedAct(), 0).e().terminal, 'failed probe-unmeasured').toEqual(COLLECT_RUN_NONE);
  });

  it('a refused containment-unproven, then two collectable audits, waits the terminal pace, and the item is listed at once', () => {
    const i = id().act(refusedAct('containment-unproven'), 0);
    expect(collectAttentionCauses(i.e()), 'listed at once')
      .toEqual([{ kind: 'terminal', word: 'containment-unproven', detail: 'containment-unproven: d' }]);
    let t = i.next()!;
    expect(t, 'the first ask waits the terminal pace').toBe(runWait('terminal', 1, true));
    i.audit(collectable(T1), t);
    t += OBSERVE;
    i.audit(collectable(T1), t);
    expect(i.e().terminal, 'the observations leave the run').toMatchObject({ kind: 'run', run: 1 });
    i.act(refusedAct('containment-unproven'), t);
    expect(i.e().terminal).toMatchObject({ kind: 'run', run: 2 });
    expect(i.next(), 'the next ask waits the terminal pace again').toBe(t + runWait('terminal', 2, true));
  });

  it('is cleared only by collected and not-witnessed', () => {
    expect(id().audit(verdict('quarantine-kept'), 0).act(COLLECTED, C).e().terminal).toEqual(COLLECT_RUN_NONE);
    expect(id().audit(verdict('quarantine-kept'), 0).audit(verdict('not-witnessed'), C).e().terminal).toEqual(COLLECT_RUN_NONE);
    expect(id().audit(verdict('quarantine-kept'), 0).act(failedAct(), C).e().terminal).toMatchObject({ kind: 'run', run: 1 });
  });
});

describe('a verb refusal: at most 96 a day per id', () => {
  it('a refusal floors the next learning audit a ceiling later, though the observation that follows clears the count', () => {
    expect(DAY / C, 'the bound is a day over the ceiling').toBe(96);
    const i = id();
    let t = 0;
    let refusals = 0;
    while (t < DAY) {
      const first = i.e().obs;
      i.audit(collectable(T1), t);
      if (collectLicence(first, collectable(T1), t, OBSERVE, true).kind === 'licensed') {
        i.act(refusedAct('in-use'), t);
        refusals += 1;
      }
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    expect(refusals).toBeGreaterThan(0);
    expect(refusals).toBeLessThanOrEqual(96);
  });
});

describe('a fold that failed: the pair resets under a new generation, the id takes the refusal floor, and nothing else moves (spec §5.10)', () => {
  /** An entry with every field populated: the chain seeds what it can, the rest is set by spread. */
  const populated = (): CollectEntry => {
    const i = id().wouldCollect(0).act(refusedAct('quarantine-kept'), 0).act(failedAct(), MIN)
      .audit(unmeasured('checkouts'), 2 * MIN).act(DIE, 3 * MIN).hold(4 * MIN);
    return {
      ...collectFeedStep(i.e(), { kind: 'row', key: 'x', outlivesObservations: true }).entry,
      obs: { token: T1, arrivedMono: 5 * MIN },
      presence: { count: 2, sinceMono: MIN, atMono: 4 * MIN },
      streak: { word: 'in-use', sinceMono: MIN, lastMono: 4 * MIN, detail: 'in-use: d' },
      scheduleMono: 40 * MIN,
    };
  };
  const NOW = 7 * MIN;
  const GEN = 9_000;

  it('ends observation 1, stamps a generation the lane never used, stamps the refusal floor, and keeps every other field as it was', () => {
    const before = populated();
    expect(before.obs, 'observation 1 stands').not.toBeNull();
    expect(before.refusedAtMono, 'an earlier refusal floor stands').not.toBe(NOW);
    expect(before.idGen).not.toBe(GEN);
    const after = collectAfterFoldFailed(before, step(NOW, GEN));
    expect(after.obs).toBeNull();
    expect(after.idGen).toBe(GEN);
    expect(after.refusedAtMono).toBe(NOW);
    expect(Object.keys(after).sort(), 'no field added or dropped').toEqual(Object.keys(before).sort());
    for (const k of Object.keys(before) as (keyof CollectEntry)[]) {
      if (k === 'obs' || k === 'idGen' || k === 'refusedAtMono') continue;
      expect(after[k], `${k} is the input's own`).toBe(before[k]);
    }
  });

  it('the next ask waits the ceiling from the fold, so the lane is never faster for a defect', () => {
    const after = collectAfterFoldFailed(collectFirstSighting(1), step(NOW, GEN));
    expect(collectNextAskMono(after, PASS, OBSERVE)).toBe(NOW + C);
    expect(collectNextAskMono(collectAfterFoldFailed(populated(), step(NOW, GEN)), PASS, OBSERVE)).toBeGreaterThanOrEqual(NOW + C);
  });
});

describe('a recognised pre-lock die', () => {
  const FLOCK_DIE: CollectResult = { kind: 'die', word: 'flock-unavailable' };
  const BAD_TOKEN_DIE: CollectResult = { kind: 'die', word: 'bad-token' };

  it('takes the refusal floor, save flock-unavailable, which latches box-wide and waits the ramp alone', () => {
    const lock = id().act(DIE, 0);
    expect([lock.e().dieAtMono, lock.next()], 'lock-unopenable: the floor').toEqual([0, C]);
    const flock = id().act(FLOCK_DIE, 0);
    expect([flock.e().dieAtMono, flock.next()], 'flock-unavailable: the ramp alone').toEqual([null, childReclaimBackoffMs(1, PASS)]);
    expect([lock.e().deferrals, flock.e().deferrals], 'each a deferral').toEqual([1, 1]);
    expect([lock.e().failing, lock.e().verbFailed, lock.e().terminal], 'neutral to every run')
      .toEqual([COLLECT_RUN_NONE, COLLECT_RUN_NONE, COLLECT_RUN_NONE]);
  });

  it('a die on every act is asked no oftener than the floor allows, though each observation clears the count', () => {
    const i = id();
    let t = 0;
    let dies = 0;
    while (t < DAY) {
      const first = i.e().obs;
      i.audit(collectable(T1), t);
      if (collectLicence(first, collectable(T1), t, OBSERVE, true).kind === 'licensed') {
        i.act(DIE, t);
        dies += 1;
      }
      const next = i.next();
      if (next === null || next <= t) throw new Error(`the lane would ask again at once, at ${t}`);
      t = next;
    }
    expect(dies).toBeGreaterThan(0);
    expect(dies).toBeLessThanOrEqual(96);
  });

  it('the same die word recurring for the ceiling, through the observations between, is attention', () => {
    const i = id().act(DIE, 0).audit(collectable(T1), C / 2).act(DIE, C - 1);
    expect(collectAttentionCauses(i.e())).toEqual([]);
    i.audit(collectable(T1), C - 1).act(DIE, C);
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'die', word: 'lock-unopenable', sinceMono: 0 }]);
    i.hold(C + 1).presence(C + 2);
    expect(collectAttentionCauses(i.e()).map((c) => c.kind), 'a hold and a presence defer end nothing').toEqual(['die']);
    expect(collectAttentionCauses(id().act(DIE, 0).act(BAD_TOKEN_DIE, C).e()), 'another die word starts it again').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).audit(unmeasured('checkouts'), C / 2).act(DIE, C).e()),
      'an answer that is not collectable ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).act(refusedAct('state-changed'), C / 2).act(DIE, C).e()),
      'another act outcome ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(DIE, 0).wouldCollect(C / 2).act(DIE, C).e()), 'a would-collect ends it').toEqual([]);
    expect(collectAttentionCauses(id().act(FLOCK_DIE, 0).act(FLOCK_DIE, C).e()), 'flock-unavailable is the box-wide line\'s')
      .toEqual([]);
  });
});

describe('the next ask: the LATEST of every wait', () => {
  it('a fresh memory, as after a restart, is due at once and is no ripe pair', () => {
    const e = collectFirstSighting(1);
    expect(collectNextAskMono(e, PASS, OBSERVE)).toBeNull();
    expect(collectDue(e, 0, PASS, OBSERVE)).toBe(true);
    expect(collectRipe(e, 0, PASS, OBSERVE)).toBe(false);
    expect(collectDue(e, Number.NaN, PASS, OBSERVE), 'a clock that is no number is never due').toBe(false);
  });

  it('observation 1 holds the id back the observation interval, then it is RIPE', () => {
    const i = id().audit(collectable(T1), 0);
    expect(i.next()).toBe(OBSERVE);
    expect(collectRipe(i.e(), OBSERVE - 1, PASS, OBSERVE)).toBe(false);
    expect(collectRipe(i.e(), OBSERVE, PASS, OBSERVE)).toBe(true);
  });

  it('takes the latest of the waits, each from its own last arrival', () => {
    // a terminal answer at 0 (its wait: a ceiling), then a load-sensitive one at 1 min (its own ramp: 2 min)
    const i = id().audit(verdict('quarantine-kept'), 0).audit(unmeasured('checkouts'), MIN);
    expect(i.next()).toBe(Math.max(runWait('terminal', 1, true), MIN + runWait('failing', 1, false)));
    // a verb refusal at 2 min: its deferral ramp (2 min) and its floor (a ceiling)
    i.act(refusedAct('state-changed'), 2 * MIN);
    expect(i.next()).toBe(2 * MIN + C);
    // a would-collect at 20 min: the shadow floor
    i.wouldCollect(20 * MIN);
    expect(i.next()).toBe(20 * MIN + C);
    // a pre-lock die at 40 min: the die floor
    i.act(DIE, 40 * MIN);
    expect(i.next()).toBe(40 * MIN + C);
  });
});

describe('changed-recently: re-asked from ccd\'s idleAt', () => {
  const ARRIVE = 10 * DAY;
  const WALL = WALL0 + ARRIVE;
  const at = (idleAt: number | null, wall = WALL) => collectIdleSchedule(idleAt, { monoMs: ARRIVE, wallMs: wall }, PASS);

  it('arrival + clamp(idleAt·1000 − wall, the pass interval, 24 h)', () => {
    expect(at(Math.ceil(WALL / 1000) + 3600)).toEqual({ kind: 'at', monoMs: ARRIVE + (Math.ceil(WALL / 1000) + 3600) * 1000 - WALL });
    expect(at(Math.floor(WALL / 1000) - 10), 'the lower end').toEqual({ kind: 'at', monoMs: ARRIVE + PASS });
    expect(at(0), 'the lower end').toEqual({ kind: 'at', monoMs: ARRIVE + PASS });
    expect(at(Math.ceil(WALL / 1000) + 2 * 86_400), 'the upper end').toEqual({ kind: 'at', monoMs: ARRIVE + COLLECT_CHANGED_RECENTLY_SPAN_MS });
    expect(at(999_999_999_999_999), 'the upper end').toEqual({ kind: 'at', monoMs: ARRIVE + COLLECT_CHANGED_RECENTLY_SPAN_MS });
    expect(COLLECT_CHANGED_RECENTLY_SPAN_MS, 'HARDCODED on purpose').toBe(86_400_000);
  });

  it('an idleAt that is not a finite non-negative integer, or a wall clock that is no number, takes the deferral wait', () => {
    for (const bad of [null, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(at(bad), String(bad)).toEqual({ kind: 'no-idle-at' });
      const i = id().audit(verdict('changed-recently', bad), ARRIVE);
      expect([i.e().deferrals, i.e().scheduleMono, i.next()], String(bad)).toEqual([1, null, ARRIVE + childReclaimBackoffMs(1, PASS)]);
    }
    expect(at(Math.ceil(WALL / 1000), Number.NaN)).toEqual({ kind: 'no-idle-at' });
  });

  it('it clears the deferral count and the failing run, and its schedule is the next ask', () => {
    const idle = Math.ceil(WALL / 1000) + 7200;
    const i = id().audit(unmeasured('checkouts'), ARRIVE - 2 * MIN).audit(verdict('in-use'), ARRIVE - MIN);
    expect([i.e().deferrals, i.e().failing.kind]).toEqual([1, 'run']);
    i.audit(verdict('changed-recently', idle), ARRIVE, WALL);
    expect([i.e().deferrals, i.e().failing]).toEqual([0, COLLECT_RUN_NONE]);
    expect(i.next()).toBe(ARRIVE + idle * 1000 - WALL);
  });

  it('answering without a break for 24 h is listed, and any other answer starts the clock again', () => {
    const i = id().audit(verdict('changed-recently', 0), 0).audit(verdict('changed-recently', 0), DAY - 1);
    expect(collectAttentionCauses(i.e())).toEqual([]);
    i.audit(verdict('changed-recently', 0), DAY);
    expect(collectAttentionCauses(i.e())).toEqual([{ kind: 'changed-recently', detail: 'changed-recently: d', sinceMono: 0 }]);
    i.audit(unmeasured('flock'), DAY + 1).audit(verdict('changed-recently', 0), 2 * DAY);
    expect(collectAttentionCauses(i.e())).toEqual([]);
  });
});

describe('the shadow floor', () => {
  it('a would-collect resets the pair, moves no run, and floors the next learning audit a ceiling later', () => {
    const i = id().act(failedAct(), 0).audit(collectable(T1), 10 * MIN);
    const before = i.e();
    i.wouldCollect(11 * MIN);
    expect(i.e()).toEqual({ ...before, obs: null, idGen: i.e().idGen, wouldCollectAtMono: 11 * MIN });
    expect(i.next()).toBe(11 * MIN + C);
    expect(collectDue(i.e(), 11 * MIN + C - 1, PASS, OBSERVE)).toBe(false);
  });
});

describe('the hold and the presence defer', () => {
  it('a hold resets the pair, counts nothing else, and waits a ceiling every time, never the next pass', () => {
    const i = id().act(failedAct(), 0).audit(verdict('quarantine-kept'), MIN).audit(collectable(T1), 2 * MIN);
    for (let k = 1; k <= 6; k += 1) {
      const before = i.e();
      i.hold(k * DAY);
      expect(i.e().obs, `hold ${k}`).toBeNull();
      expect([i.e().deferrals, i.e().failing, i.e().verbFailed, i.e().terminal], `hold ${k}`)
        .toEqual([before.deferrals, before.failing, before.verbFailed, before.terminal]);
      expect(i.next(), `hold ${k}`).toBe(k * DAY + C);
      i.audit(collectable(T1), k * DAY + C);
    }
  });

  it('a presence defer resets the pair and waits the imported ramp over a count of its own', () => {
    const i = id();
    let t = 0;
    for (let k = 1; k <= 6; k += 1) {
      i.audit(collectable(T1), t).presence(t + OBSERVE);
      expect(i.e().obs, `presence ${k}`).toBeNull();
      expect(i.next(), `presence ${k}`).toBe(t + OBSERVE + childReclaimBackoffMs(k, PASS));
      t = i.next()!;
    }
  });

  it('each is listed once it has stood without a break for a ceiling, through the observations between', () => {
    const held = id().hold(0).audit(collectable(T1), C - 2).hold(C - 1);
    expect(collectAttentionCauses(held.e())).toEqual([]);
    held.audit(collectable(T1), C).hold(C);
    expect(collectAttentionCauses(held.e())).toEqual([{ kind: 'held', why: 'run-open', sinceMono: 0 }]);
    held.audit(unmeasured('checkouts'), C + 1).hold(2 * C);
    expect(collectAttentionCauses(held.e()).map((c) => c.kind), 'another answer starts it again').toEqual([]);

    const seen = id().presence(0).audit(collectable(T1), C - 1).presence(C);
    expect(collectAttentionCauses(seen.e())).toEqual([{ kind: 'presence', sinceMono: 0 }]);
    seen.act(refusedAct('state-changed'), C + 1).presence(2 * C);
    expect(collectAttentionCauses(seen.e())).toEqual([]);
  });

  it('a hold ends presence\'s continuity, and a presence defer ends the hold\'s', () => {
    const seen = id().presence(0).hold(C / 2).presence(C);
    expect([seen.e().presence?.sinceMono, collectAttentionCauses(seen.e())], 'a hold between: presence starts again')
      .toEqual([C, []]);
    const held = id().hold(0).presence(C / 2).hold(C);
    expect([held.e().held?.sinceMono, collectAttentionCauses(held.e())], 'a presence defer between: the hold starts again')
      .toEqual([C, []]);
  });

  it('every act outcome and a would-collect end the hold\'s continuity and presence\'s', () => {
    for (const r of [refusedAct('state-changed'), failedAct(), ACT_NO_DOCUMENT, DIE, COLLECTED]) {
      const held = id().hold(0).act(r, C / 2).hold(C);
      expect([held.e().held?.sinceMono, collectAttentionCauses(held.e())], `${r.kind}: the hold starts again`).toEqual([C, []]);
    }
    const held = id().hold(0).wouldCollect(C / 2).hold(C);
    expect([held.e().held?.sinceMono, collectAttentionCauses(held.e())], 'a would-collect: the hold starts again')
      .toEqual([C, []]);
    const seen = id().presence(0).wouldCollect(C / 2).presence(C);
    expect([seen.e().presence?.sinceMono, collectAttentionCauses(seen.e())], 'a would-collect: presence starts again')
      .toEqual([C, []]);
  });
});

describe('every answer but a collectable one ends the hold\'s, presence\'s and the die\'s continuity, and the schedule too unless it is changed-recently\'s own (spec §5.10, pacing)', () => {
  const IDLE = WALL0 / 1000 + 3600;
  /** A: a changed-recently streak with its schedule, then a hold. B: a die, then a presence defer. */
  const setups = () => ({
    a: id().audit(verdict('changed-recently', IDLE), 0).hold(MIN),
    b: id().act(DIE, 0).presence(MIN),
  });
  const readA = (e: CollectEntry) => [e.held, e.streak?.sinceMono ?? null, e.scheduleMono];
  const readB = (e: CollectEntry) => [e.die, e.presence];
  const apply = (a: CollectAudit, mono = 2 * MIN) => {
    const { a: ia, b: ib } = setups();
    ia.audit(a, mono); ib.audit(a, mono);
    return { a: ia.e(), b: ib.e() };
  };

  it('the setups hold what the rows below end', () => {
    const { a, b } = setups();
    expect(a.e().held, 'A: the hold').not.toBeNull();
    expect(a.e().streak?.sinceMono, 'A: the changed-recently streak').toBe(0);
    expect(a.e().scheduleMono, 'A: the schedule').not.toBeNull();
    expect(b.e().die, 'B: the die').not.toBeNull();
    expect(b.e().presence, 'B: the presence defer').not.toBeNull();
  });

  const ENDING: readonly (readonly [string, CollectAudit])[] = [
    ['a terminal verdict (quarantine-kept)', verdict('quarantine-kept')],
    ['not-witnessed', verdict('not-witnessed')],
    ['an unmeasured box-wide probe', unmeasured('flock')],
    ['an unmeasured per-leaf probe', unmeasured('mode')],
    ['an unmeasured load-sensitive probe', unmeasured('checkouts')],
    ['no document', NO_DOCUMENT],
    ['an unreadable document', UNREADABLE],
    ['a verdict no build knows', verdict('a-verdict-no-build-knows')],
  ];
  it.each(ENDING)('%s ends every clock and the schedule', (_l, answer) => {
    const { a, b } = apply(answer);
    expect(readA(a)).toEqual([null, null, null]);
    expect(readB(b)).toEqual([null, null]);
  });

  it('in-use, a deferral word: the hold and the schedule end, a NEW streak starts at the answer, and the die and presence end', () => {
    const { a, b } = apply(verdict('in-use'));
    expect(readA(a)).toEqual([null, 2 * MIN, null]);
    expect(readB(b)).toEqual([null, null]);
  });

  it('changed-recently with an idleAt: the hold ends, the streak continues from its first answer, and the schedule is the new answer\'s', () => {
    const later = IDLE + 600;
    const { a, b } = apply(verdict('changed-recently', later));
    const at = collectIdleSchedule(later, { monoMs: 2 * MIN, wallMs: WALL0 + 2 * MIN }, PASS);
    expect(at.kind).toBe('at');
    expect(readA(a)).toEqual([null, 0, at.kind === 'at' ? at.monoMs : null]);
    expect(a.scheduleMono, 'not A\'s old schedule').not.toBe(setups().a.e().scheduleMono);
    expect(readB(b)).toEqual([null, null]);
  });

  it('changed-recently with no idleAt: the hold ends, the streak continues, and there is NO schedule, not A\'s old one', () => {
    const { a, b } = apply(verdict('changed-recently', null));
    expect(readA(a)).toEqual([null, 0, null]);
    expect(readB(b)).toEqual([null, null]);
  });

  it('CONTROL: a collectable answer, fresh or stale, ends the streak and the schedule but not the hold, the die or presence', () => {
    for (const observes of [true, false]) {
      const { a: ia, b: ib } = setups();
      const a = collectAfterAudit(ia.e(), collectable(T1), step(2 * MIN, 50), observes);
      const b = collectAfterAudit(ib.e(), collectable(T1), step(2 * MIN, 50), observes);
      expect(a.held, `A, observes=${observes}: the hold stands`).toEqual(ia.e().held);
      expect([a.streak, a.scheduleMono], `A, observes=${observes}: the streak and the schedule end`).toEqual([null, null]);
      expect(b.die, `B, observes=${observes}: the die stands`).toEqual(ib.e().die);
      expect(b.presence, `B, observes=${observes}: presence stands`).toEqual(ib.e().presence);
    }
  });
});

describe('the deferral words\' own attention', () => {
  it('in-use at once; registered and in-progress past the ceiling; paused never', () => {
    expect(collectAttentionCauses(id().audit(verdict('in-use'), 0).e())).toEqual([{ kind: 'in-use', detail: 'in-use: d', sinceMono: 0 }]);
    for (const w of ['registered', 'in-progress']) {
      const i = id().audit(verdict(w), 0).audit(verdict(w), C - 1);
      expect(collectAttentionCauses(i.e()), w).toEqual([]);
      i.audit(verdict(w), C);
      expect(collectAttentionCauses(i.e()), w).toEqual([{ kind: w, detail: `${w}: d`, sinceMono: 0 }]);
    }
    expect(collectAttentionCauses(id().audit(verdict('paused'), 0).audit(verdict('paused'), DAY).e())).toEqual([]);
    const changed = id().audit(verdict('registered'), 0).audit(verdict('in-progress'), C - 1).audit(verdict('in-progress'), C);
    expect(collectAttentionCauses(changed.e()), 'a streak is of one word').toEqual([]);
  });

  it('not-witnessed raises nothing: it clears the three runs, advances the deferral count and ends the continuity clocks, as every answer but a collectable one does, and leaves every floor and the feed episode standing', () => {
    expect(collectAttentionCauses(id().audit(verdict('not-witnessed'), 0).e()), 'a fresh entry raises nothing').toEqual([]);
    // every field the title names, seeded through the transitions: the three floors, the three runs, the deferral
    // count, the hold's and the die's continuity, and a feed episode that outlives observations
    const i = id().wouldCollect(0).act(refusedAct('quarantine-kept'), 0).act(failedAct(), MIN)
      .audit(unmeasured('checkouts'), 2 * MIN).act(DIE, 3 * MIN).hold(4 * MIN);
    // The chain cannot seed presence, the streak or the schedule (a hold clears presence, an act clears the streak, and
    // an answer that starts a streak ends the die), so each is set here by spread: the whole-entry comparison below then
    // proves every one ended.
    const before: CollectEntry = {
      ...collectFeedStep(i.e(), { kind: 'row', key: 'x', outlivesObservations: true }).entry,
      presence: { count: 2, sinceMono: MIN, atMono: 4 * MIN },
      streak: { word: 'in-use', sinceMono: MIN, lastMono: 4 * MIN, detail: 'in-use: d' },
      scheduleMono: 40 * MIN,
    };
    expect([before.presence, before.streak, before.scheduleMono].map((x) => x !== null), 'presence, the streak and the schedule stand')
      .toEqual([true, true, true]);
    expect([before.terminal.kind, before.verbFailed.kind, before.failing.kind], 'the three runs stand').toEqual(['run', 'run', 'run']);
    expect([before.deferrals, before.deferredAtMono], 'a deferral count').toEqual([1, 3 * MIN]);
    expect([before.held === null, before.die === null], 'the hold and the die clocks').toEqual([false, false]);
    expect([before.wouldCollectAtMono, before.refusedAtMono, before.dieAtMono], 'the three floors').toEqual([0, 0, 3 * MIN]);
    expect([before.feedEpisode, before.feedOutlivesObservations], 'the feed episode').toEqual(['x', true]);
    const after = collectAfterAudit(before, verdict('not-witnessed'), step(5 * MIN, 99), true);
    expect(after).toEqual({
      ...before, idGen: 99, obs: null, evidence: { runId: 7, leaf: '/home/u/.cc-tmp/demo-a' },
      failing: COLLECT_RUN_NONE, verbFailed: COLLECT_RUN_NONE, terminal: COLLECT_RUN_NONE,
      deferrals: 2, deferredAtMono: 5 * MIN,
      held: null, presence: null, streak: null, scheduleMono: null, die: null,
    });
  });
});

describe('the evidence: the latest document\'s', () => {
  it('a collectable, verdict or unmeasured document brings its own witness run and leaf; no document and an unreadable one keep the last', () => {
    const i = id().audit(collectable(T1, { witnessRun: 3, leaf: '/l/3' }), 0);
    expect(i.e().evidence, 'a collectable').toEqual({ runId: 3, leaf: '/l/3' });
    i.audit({ kind: 'verdict', verdict: 'quarantine-kept', idleAt: null, witnessRun: 5, leaf: '/l/5', detail: 'd' }, MIN);
    expect(i.e().evidence, 'a verdict').toEqual({ runId: 5, leaf: '/l/5' });
    i.audit({ kind: 'unmeasured', probe: 'checkouts', witnessRun: null, leaf: '/l/6', detail: 'd' }, 2 * MIN);
    expect(i.e().evidence, 'an unmeasured answer, a null run included').toEqual({ runId: null, leaf: '/l/6' });
    i.audit({ kind: 'verdict', verdict: 'a-verdict-no-build-knows', idleAt: null, witnessRun: 8, leaf: null, detail: 'd' }, 3 * MIN);
    expect(i.e().evidence, 'an unknown verdict').toEqual({ runId: 8, leaf: null });
    i.audit(NO_DOCUMENT, 4 * MIN).audit(UNREADABLE, 5 * MIN).act(failedAct(), 6 * MIN);
    expect(i.e().evidence, 'no document, an unreadable one and an act keep the last').toEqual({ runId: 8, leaf: null });
  });
});

describe('the feed episode', () => {
  it('one row per episode of a key; a repeat is quiet, and another key ends it', () => {
    const e0 = collectFirstSighting(1);
    const a = collectFeedStep(e0, { kind: 'row', key: 'in-use' });
    expect(a.opened).toBe('in-use');
    expect(collectFeedStep(a.entry, { kind: 'row', key: 'in-use' }).opened).toBeNull();
    const b = collectFeedStep(a.entry, { kind: 'row', key: 'registered' });
    expect(b.opened).toBe('registered');
    expect(collectFeedStep(b.entry, { kind: 'row', key: 'in-use' }).opened).toBe('in-use');
  });

  it('an observation of a token keeps that token\'s would-collect episode and ends any other; a quiet step ends nothing', () => {
    const wc = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    const kept = collectFeedStep(wc, { kind: 'observe', token: T1 });
    expect(kept.entry.feedEpisode).toBe(collectWouldCollectKey(T1));
    expect(collectFeedStep(kept.entry, { kind: 'row', key: collectWouldCollectKey(T1) }).opened, 'the same token: quiet').toBeNull();
    const other = collectFeedStep(wc, { kind: 'observe', token: T2 });
    expect(other.entry.feedEpisode).toBeNull();
    expect(collectFeedStep(other.entry, { kind: 'row', key: collectWouldCollectKey(T1) }).opened).toBe(collectWouldCollectKey(T1));
    const inUse = collectFeedStep(collectFirstSighting(1), { kind: 'row', key: 'in-use' }).entry;
    expect(collectFeedStep(inUse, { kind: 'observe', token: T1 }).entry.feedEpisode).toBeNull();
    expect(collectFeedStep(inUse, { kind: 'quiet' }).entry.feedEpisode).toBe('in-use');
  });

  it('a refusal or a die episode outlives observations; every other act episode does not', () => {
    const observe = { kind: 'observe', token: T1 } as const;
    const outlasts: readonly CollectResult[] = [
      refusedAct('in-use'), refusedAct('containment-unproven'), DIE, { kind: 'die', word: 'flock-unavailable' },
    ];
    for (const r of outlasts) {
      const cue = collectFeedCueOfAct(r);
      const opened = collectFeedStep(collectFirstSighting(1), cue);
      expect(opened.opened, `${r.kind}: its row`).toBe(cue.kind === 'row' ? cue.key : null);
      const twice = collectFeedStep(collectFeedStep(opened.entry, observe).entry, { kind: 'observe', token: T2 }).entry;
      expect(twice.feedEpisode, `${r.kind}: two observations of two tokens end nothing`).toBe(opened.opened);
      expect(collectFeedStep(twice, cue).opened, `${r.kind}: and the same cue then writes nothing`).toBeNull();
    }
    const ends: readonly CollectResult[] = [COLLECTED, failedAct(), failedAct('quarantine-kept'), ACT_NO_DOCUMENT];
    for (const r of ends) {
      const cue = collectFeedCueOfAct(r);
      const opened = collectFeedStep(collectFirstSighting(1), cue);
      expect(opened.opened, `${r.kind}: its row`).not.toBeNull();
      const after = collectFeedStep(opened.entry, observe).entry;
      expect([after.feedEpisode, after.feedOutlivesObservations], `${r.kind}: an observation ends it`).toEqual([null, false]);
      expect(collectFeedStep(after, cue).opened, `${r.kind}: and the same cue writes its row again`).toBe(opened.opened);
    }
  });

  it('a refusal episode still ends at any row cue of another key: an audit answer, another act outcome or a would-collect', () => {
    const refused = collectFeedStep(collectFirstSighting(1), collectFeedCueOfAct(refusedAct('in-use'))).entry;
    expect(refused.feedOutlivesObservations).toBe(true);
    const audit = collectFeedStep(refused, collectFeedCueOfAudit(verdict('in-use')));
    expect([audit.opened, audit.entry.feedEpisode, audit.entry.feedOutlivesObservations], 'an audit in-use opens its own episode')
      .toEqual(['in-use', 'in-use', false]);
    const wc = collectFeedStep(refused, { kind: 'row', key: collectWouldCollectKey(T1) });
    expect([wc.opened, wc.entry.feedOutlivesObservations], 'a would-collect opens').toEqual([collectWouldCollectKey(T1), false]);
    expect(collectFeedStep(wc.entry, { kind: 'observe', token: T2 }).entry.feedEpisode, 'and ends at another token\'s observation').toBeNull();
    const failed = collectFeedStep(refused, collectFeedCueOfAct(failedAct()));
    expect([failed.opened, failed.entry.feedOutlivesObservations], 'another act outcome opens').toEqual(['failed probe-unmeasured', false]);
    expect(collectFeedStep(refused, { kind: 'quiet' }).entry, 'a quiet step ends nothing').toBe(refused);
  });

  it('the flag, never the key\'s text, decides: an AUDIT verdict spelled like an act\'s key is ended by an observation', () => {
    const audit = collectFeedStep(collectFirstSighting(1), collectFeedCueOfAudit(verdict('refused in-use')));
    expect([audit.opened, audit.entry.feedOutlivesObservations]).toEqual(['refused in-use', false]);
    expect(collectFeedStep(audit.entry, { kind: 'observe', token: T1 }).entry.feedEpisode).toBeNull();
    // the same key from an act's cue is the same episode (quiet), and the act's cue says it outlives observations
    const act = collectFeedStep(audit.entry, collectFeedCueOfAct(refusedAct('in-use')));
    expect([act.opened, act.entry.feedOutlivesObservations], 'the repeat of a key stores the cue\'s own flag').toEqual([null, true]);
    expect(collectFeedStep(act.entry, { kind: 'observe', token: T1 }).entry.feedEpisode).toBe('refused in-use');
  });

  it('a first sighting starts with no episode and no flag, and a collected act carries the flag beside the episode', () => {
    expect(collectFirstSighting(1)).toMatchObject({ feedEpisode: null, feedOutlivesObservations: false });
    const refused = collectFeedStep(collectFirstSighting(1), collectFeedCueOfAct(refusedAct('in-use'))).entry;
    expect(collectAfterAct(refused, COLLECTED, step(MIN, 9)))
      .toMatchObject({ feedEpisode: 'refused in-use', feedOutlivesObservations: true });
  });

  it('a would-collect episode stands, for Task 5\'s projection, until another key or another token\'s observation ends it', () => {
    const e0 = collectFirstSighting(1);
    expect(collectWouldCollectStands(e0)).toBe(false);
    const wc = collectFeedStep(e0, { kind: 'row', key: collectWouldCollectKey(T1) }).entry;
    expect(collectWouldCollectStands(wc)).toBe(true);
    expect(collectWouldCollectStands(collectFeedStep(wc, { kind: 'observe', token: T1 }).entry), 'its own token keeps it').toBe(true);
    expect(collectWouldCollectStands(collectFeedStep(wc, { kind: 'observe', token: T2 }).entry), 'another token').toBe(false);
    expect(collectWouldCollectStands(collectFeedStep(e0, { kind: 'row', key: 'in-use' }).entry), 'another key').toBe(false);
  });
});

describe('wave 8\'s formula, imported: one definer', () => {
  it('childReclaimTierFrom is exported unchanged', () => {
    expect(childReclaimTierFrom('terminal', 1, true)).toEqual({ tier: true, tierToken: 'terminal', tierJ: 0, tierRun: 1 });
    expect(childReclaimTierFrom('failing', K + 2, false)).toEqual({ tier: true, tierToken: 'failing', tierJ: 2, tierRun: K + 2 });
    expect(childReclaimTierFrom('failing', K - 1, false)).toEqual({ tier: false, tierToken: 'failing', tierJ: 0, tierRun: K - 1 });
  });

  it('the collector imports the derivation and both waits, and spells no formula of its own', () => {
    const lane = codeOnly(readFileSync(path.join(srcRoot, 'collectLane.ts'), 'utf8'));
    const from = [...new Set([...lane.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]))].sort();
    expect(from, 'L1: L0 and the one L1 file whose formula it shares').toEqual(['../../shared/api.js', './childReclaimSweep.js']);
    const imported = /import\s*\{([^}]*)\}\s*from\s*'\.\/childReclaimSweep\.js'/.exec(lane)?.[1] ?? '';
    for (const name of ['childReclaimTierFrom', 'childReclaimTierPaceMs', 'childReclaimBackoffMs']) {
      expect(imported, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
    expect(lane).not.toMatch(/\*\*|Math\.pow|CHILD_RECLAIM_TIER_CAP_MS|CHILD_RECLAIM_TIER_ENTRY_RUN/);
    const definers = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
      .filter((f) => /CHILD_RECLAIM_DEFER_CEILING_MS \* 2 \*\*/.test(codeOnly(readFileSync(path.join(srcRoot, f), 'utf8'))));
    expect(definers).toEqual(['childReclaimSweep.ts']);
  });
});
