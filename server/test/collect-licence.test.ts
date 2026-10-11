// The temp-root collector's licence (child-reclamation spec §5.10, "two observations, one job, one act"). The lane
// spends a `ws-collect` token only on two `collectable` answers with ONE token: the second the executor's own audit,
// ARRIVING at least the observation interval after the first, with nothing else answered between, and neither
// composed before a reset. These rows pin the pure half (L1, `server/src/collectLane.ts`). The executor that applies
// it is `coord/collectTempRoot.ts`'s, and the lane's own suite pins that each L4 trigger makes its reset.
import { describe, it, expect } from 'vitest';
import {
  collectAfterAct, collectAfterAudit, collectAfterHold, collectAfterPresence, collectAfterWouldCollect, collectCapture,
  collectClearPair, collectFirstSighting, collectFresh, collectLicence, collectLicenceStands,
  type CollectAudit, type CollectCapture, type CollectEntry, type CollectLicence, type CollectObservation,
} from '../src/collectLane.js';
import {
  ACT_NO_DOCUMENT, COLLECTED, DIE, NO_DOCUMENT, OBSERVE, T1, T2, UNREADABLE, collectable, failedAct, refusedAct, step,
  unmeasured, verdict,
} from './collectAnswers.js';

/** ONE lane's memory of ONE id, driven as the lane drives it: every generation from one counter, a request
 *  CAPTURED when composed, its answer applied when it arrives, observation 1 read before the answer is applied. */
const lane = () => {
  let g = 0;
  let laneGen = ++g;
  let e: CollectEntry | undefined = collectFirstSighting(++g);
  const self = {
    entry: (): CollectEntry | undefined => e,
    laneGen: (): number => laneGen,
    /** The generations step 6 reads NOW, as the executor's port answers `generations(id)`: a forgotten id's is -1. */
    now: (): CollectCapture => (e === undefined ? { lane: laneGen, id: -1 } : collectCapture(laneGen, e)),
    /** Observation 1 as memory holds it now, as the port answers `observation(id)`. */
    obs: (): CollectObservation | null => e?.obs ?? null,
    /** A request composed now. */
    compose: (): CollectCapture => collectCapture(laneGen, e!),
    /** Its audit answer, arriving at `mono`: what the licence rule says of it as observation 2. */
    answer: (cap: CollectCapture, a: CollectAudit, mono: number): CollectLicence => {
      const fresh = collectFresh(cap, laneGen, e);
      const licence = collectLicence(e?.obs ?? null, a, mono, OBSERVE, fresh);
      if (e !== undefined) e = collectAfterAudit(e, a, step(mono, ++g), fresh);
      return licence;
    },
    /** A request composed and answered at `mono`, nothing between. */
    ask: (a: CollectAudit, mono: number): CollectLicence => self.answer(self.compose(), a, mono),
    act: (mono: number, r = COLLECTED) => { e = collectAfterAct(e!, r, step(mono, ++g)); },
    hold: (mono: number) => { e = collectAfterHold(e!, 'run-open', step(mono, ++g)); },
    presence: (mono: number) => { e = collectAfterPresence(e!, step(mono, ++g)); },
    wouldCollect: (mono: number) => { e = collectAfterWouldCollect(e!, step(mono, ++g)); },
    /** A lane-wide clear: one mechanism in L1, whatever raised it. */
    clearLane: () => { laneGen = ++g; if (e !== undefined) e = collectClearPair(e); },
    forget: () => { e = undefined; },
    sight: () => { e = collectFirstSighting(++g); },
  };
  return self;
};

const licensedAt = (l: CollectLicence): number => {
  if (l.kind !== 'licensed') throw new Error(`expected a licence, got ${l.kind}`);
  return l.first.arrivedMono;
};

/** Every answer and every step that is not an observation of the token held, each applied at `mono`. */
const RESETTING: readonly (readonly [string, (l: ReturnType<typeof lane>, mono: number) => void])[] = [
  ...['changed-recently', 'not-witnessed', 'registered', 'in-use', 'paused', 'in-progress', 'witness-mismatch',
    'quarantine-kept', 'containment-unproven', 'a-verdict-no-build-knows'].map((w) =>
    [`the verdict ${w}`, (l: ReturnType<typeof lane>, m: number) => { l.ask(verdict(w, 1), m); }] as const),
  ...['flock', 'mode', 'checkouts', 'a-probe-no-build-knows'].map((p) =>
    [`unmeasured ${p}`, (l: ReturnType<typeof lane>, m: number) => { l.ask(unmeasured(p), m); }] as const),
  ['no document', (l, m) => { l.ask(NO_DOCUMENT, m); }],
  ['an unreadable document', (l, m) => { l.ask(UNREADABLE, m); }],
  ['the act: collected', (l, m) => { l.act(m, COLLECTED); }],
  ['the act: refused', (l, m) => { l.act(m, refusedAct('state-changed')); }],
  ['the act: failed', (l, m) => { l.act(m, failedAct()); }],
  ['the act: a pre-lock die', (l, m) => { l.act(m, DIE); }],
  ['the act: no document', (l, m) => { l.act(m, ACT_NO_DOCUMENT); }],
  ['the open-run hold', (l, m) => { l.hold(m); }],
  ['the presence defer', (l, m) => { l.presence(m); }],
  ['a would-collect', (l, m) => { l.wouldCollect(m); }],
];

/** Every reset that makes an earlier request stale. The five lane-wide ones are one mechanism here. */
const RESETS: readonly (readonly [string, (l: ReturnType<typeof lane>, mono: number) => void])[] = [
  ...['a marker flip', 'a raised pause', 'a missing capability', 'a learning audit the box refused', 'an unlistable registry']
    .map((k) => [k, (l: ReturnType<typeof lane>) => { l.clearLane(); }] as const),
  ['the open-run hold', (l, m) => { l.hold(m); }],
  ['the presence defer', (l, m) => { l.presence(m); }],
  ['a would-collect', (l, m) => { l.wouldCollect(m); }],
  ['a verb outcome', (l, m) => { l.act(m, refusedAct('state-changed')); }],
  ['another answer for the id', (l, m) => { l.ask(verdict('in-use'), m); }],
  ['forgetting the id, then sighting it again', (l) => { l.forget(); l.sight(); }],
];

describe('the rule: two observations of one token, the interval apart, nothing between', () => {
  it('one observation never licenses: a fresh memory, as after a restart, needs two', () => {
    const l = lane();
    expect(l.ask(collectable(T1), 0)).toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), OBSERVE))).toBe(0);
  });

  it('two observations under the interval compose nothing; at exactly the interval, yes', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(collectable(T1), OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(l.entry()?.obs, 'a continuing pair keeps observation 1\'s first arrival').toEqual({ token: T1, arrivedMono: 0 });
    expect(licensedAt(l.ask(collectable(T1), OBSERVE))).toBe(0);
  });

  it('T1 then T2: a different token is a new observation 1, never a partner', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(collectable(T2), OBSERVE)).toEqual({ kind: 'token-changed' });
    expect(l.entry()?.obs).toEqual({ token: T2, arrivedMono: OBSERVE });
    expect(l.ask(collectable(T2), 2 * OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(licensedAt(l.ask(collectable(T2), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it('collectable, in-use, collectable: an answer between resets the pair, so the partner must be fresh', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    l.ask(verdict('in-use'), OBSERVE / 2);
    expect(l.ask(collectable(T1), OBSERVE)).toEqual({ kind: 'no-first' });
    expect(l.ask(collectable(T1), 2 * OBSERVE - 1)).toEqual({ kind: 'too-soon' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it.each(RESETTING)('so does %s', (_label, between) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    between(l, OBSERVE / 2);
    expect(l.entry()?.obs).toBeNull();
    expect(l.ask(collectable(T1), 10 * OBSERVE)).toEqual({ kind: 'no-first' });
  });

  it('observation 2 must itself be collectable', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    expect(l.ask(verdict('changed-recently', 1), OBSERVE)).toEqual({ kind: 'not-collectable' });
  });

  it('all three token modes take the one rule: a resume or a witness-only document licenses no sooner', () => {
    for (const over of [{ resume: 'moved' }, { resume: 'unmoved', witnessRun: null }, { leaf: null }]) {
      const l = lane();
      l.ask(collectable(T1, over), 0);
      expect(l.ask(collectable(T1, over), OBSERVE - 1), JSON.stringify(over)).toEqual({ kind: 'too-soon' });
      expect(licensedAt(l.ask(collectable(T1, over), OBSERVE)), JSON.stringify(over)).toBe(0);
    }
  });

  it('a clock that is no number never licenses, nor does an interval that is not positive', () => {
    const first: CollectObservation = { token: T1, arrivedMono: 0 };
    expect(collectLicence({ token: T1, arrivedMono: Number.NaN }, collectable(T1), OBSERVE, OBSERVE, true).kind).toBe('too-soon');
    expect(collectLicence(first, collectable(T1), Number.NaN, OBSERVE, true).kind).toBe('too-soon');
    expect(collectLicence(first, collectable(T1), Number.POSITIVE_INFINITY, OBSERVE, true).kind).toBe('too-soon');
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(collectLicence(first, collectable(T1), 10 * OBSERVE, interval, true).kind, String(interval)).toBe('too-soon');
    }
  });

  it('the licence carries no token of its own: the argv\'s token is observation 2\'s', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const licence = l.ask(collectable(T1), OBSERVE);
    expect(Object.keys(licence).sort()).toEqual(['first', 'kind']);
  });
});

describe('a stale answer is never an observation', () => {
  it.each(RESETS)('an answer composed before %s seeds nothing, and the first licence after needs two fresh observations', (_label, reset) => {
    const l = lane();
    const stale = l.compose();
    reset(l, OBSERVE / 4);
    expect(l.answer(stale, collectable(T1), OBSERVE / 2)).toEqual({ kind: 'stale' });
    expect(l.entry()?.obs ?? null, 'the stale answer seeded no observation 1').toBeNull();
    expect(l.ask(collectable(T1), OBSERVE), 'the first fresh answer is only observation 1').toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it.each(RESETS)('a pair standing before %s is no partner for a stale observation 2', (_label, reset) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const stale = l.compose();
    reset(l, OBSERVE / 2);
    expect(l.answer(stale, collectable(T1), 2 * OBSERVE)).toEqual({ kind: 'stale' });
  });

  it('a lane-wide clear drops observation 1: the first licence after a flip follows two observations composed after it', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    l.clearLane();
    expect(l.ask(collectable(T1), OBSERVE)).toEqual({ kind: 'no-first' });
    expect(licensedAt(l.ask(collectable(T1), 2 * OBSERVE))).toBe(OBSERVE);
  });

  it('the job\'s own observation 2 does not stale its capture: a continuing pair keeps the id\'s generation', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs())).toBe(true);
  });

  it('freshness is a plain boolean: a stale answer\'s entry is still the id\'s, and still paces', () => {
    const l = lane();
    const stale = l.compose();
    l.clearLane();
    const remembered = (): CollectEntry | undefined => l.entry();
    const e = remembered();
    if (collectFresh(stale, l.laneGen(), e)) throw new Error('expected a stale answer');
    if (e === undefined) throw new Error('the id is remembered');
    // Were `collectFresh` a type predicate, its false arm would narrow `e` to `undefined`, the check above to `never`,
    // and this line would not compile (TS2339: the test project's tsc, run by typecheck-tests, is the red).
    expect(e.idGen).toBe(l.entry()!.idGen);
    expect(collectAfterAudit(e, verdict('in-use'), step(OBSERVE, 99), false).deferrals, 'the stale answer paced it').toBe(1);
  });
});

describe('step 6: the licence stands only as it was found', () => {
  it.each(RESETS)('it falls after %s', (_label, reset) => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    reset(l, OBSERVE + 1);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs())).toBe(false);
  });

  it('it re-reads observation 1 itself: a pair cleared, or another first arrival, stands for nothing whatever the generations say', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), collectClearPair(l.entry()!).obs)).toBe(false);
    expect(collectLicenceStands(licence.first, cap, l.now(), { token: T1, arrivedMono: 1 })).toBe(false);
    expect(collectLicenceStands(licence.first, cap, l.now(), { token: T2, arrivedMono: 0 })).toBe(false);
  });

  it('the generations alone fell it too: memory\'s very observation 1, under a moved lane or id generation, stands for nothing', () => {
    const l = lane();
    l.ask(collectable(T1), 0);
    const cap = l.compose();
    const licence = l.answer(cap, collectable(T1), OBSERVE);
    if (licence.kind !== 'licensed') throw new Error(licence.kind);
    expect(collectLicenceStands(licence.first, cap, l.now(), l.obs()), 'as found').toBe(true);
    expect(collectLicenceStands(licence.first, cap, { ...l.now(), lane: l.now().lane + 1 }, l.obs()), 'the lane').toBe(false);
    expect(collectLicenceStands(licence.first, cap, { ...l.now(), id: -1 }, l.obs()), 'a forgotten id').toBe(false);
  });
});

describe('what a lane-wide clear clears', () => {
  it('the observation pair, and nothing else: every run, count, clock and episode stands', () => {
    const l = lane();
    l.ask(unmeasured('checkouts'), 0);
    l.ask(verdict('quarantine-kept'), OBSERVE);
    l.act(2 * OBSERVE, failedAct());
    l.ask(collectable(T1), 3 * OBSERVE);
    const e = l.entry()!;
    expect(e.obs).not.toBeNull();
    expect(collectClearPair(e)).toEqual({ ...e, obs: null });
  });
});
