// The readiness deciders' cases and mutant sets (Overlord W1 readiness, plan `w1-readiness.md` Task 1 Step 6; the floors rule
// is D-8217's): `overlordReadiness`, `readinessFactsOf`, `readinessNotices` and `servedReadiness`, each against the cases that
// judge it, written once here as suite cases over a module. `mutation-floors.test.ts` runs them against each textual mutant of
// server/src/coord/overlordReadiness.ts, and a test of the real module can run the same functions. The cases assert what
// `overlord-readiness.test.ts` and `overlord-readiness-notices.test.ts` assert: the exhaustive reference written from the
// plan's numbered row list, monotonicity, the unmeasured-is-never-ready property, the facts mapping, the notice rules and the
// served rules. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  READINESS_DEAF_MS, READINESS_DIALOG_MS, READINESS_FRESH_MS, READINESS_HOOK_QUIET_MS, READINESS_LONG_TURN_MS,
  READINESS_RESTART_WINDOW_MS, READINESS_RESTARTS_PER_HOUR, READINESS_WORDS, STRAND_CAUSES, admitRank,
  type ReadinessWire, type ReadinessWord, type StrandCause,
} from '../../../shared/overlord-readiness.js';
import type { DesignationRead, DesignationView } from '../../../shared/overlord-designation.js';
import { STOP_FAILURE_ERRORS } from '../../src/coord/stopFailure.js';
import type { TurnMarkRead } from '../../src/coord/stall.js';
import type { HookStateRead } from '../../src/hookstate.js';
import type { OverlordBodyState } from '../../src/coord/overlordDesignation.js';
import type { MessageFacts } from '../../src/coord/overlordInbox.js';
import type {
  Buildable, Fact, GenerationReading, NoticeInputs, ReadinessAnswer, ReadinessFacts, ReadinessItemRecord, ReadinessNotice,
  ReadinessNowRow, ReadinessReadings, SubjectReadings,
} from '../../src/coord/overlordReadiness.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordReadiness.ts');
export const OVERLORD_READINESS_KEY = 'server/src/coord/overlordReadiness.ts#overlordReadiness';
export const READINESS_FACTS_OF_KEY = 'server/src/coord/overlordReadiness.ts#readinessFactsOf';
export const READINESS_NOTICES_KEY = 'server/src/coord/overlordReadiness.ts#readinessNotices';
export const SERVED_READINESS_KEY = 'server/src/coord/overlordReadiness.ts#servedReadiness';
export const READINESS_COUNT_OF_KEY = 'server/src/coord/overlordReadiness.ts#readinessCountOf';

export type ReadinessModule = typeof import('../../src/coord/overlordReadiness.js');
type M = ReadinessModule;

// ------------------------------------------------------------------------------------------------------------ fixtures

const NOW = 10_000_000;
const m = <T>(value: T): Fact<T> => ({ kind: 'measured', value });
const u = (why: string): { kind: 'unmeasured'; why: string } => ({ kind: 'unmeasured', why });
const NB = { kind: 'not-built' } as const;
const ME = 'cc-overlord-a';

// ------------------------------------------------------------------------------------------------------ overlordReadiness

interface Ans { word: ReadinessWord; why: string | null; until: number | null; strandCause: StrandCause | null; restartable: boolean }
const BOUND = 9_100;

/** Table 6.4a written from the plan's numbered row list, first match: the reference the decider is held to. */
function reference(f: ReadinessFacts, now: number): Ans {
  const A = (word: ReadinessWord, o: Partial<Ans> = {}): Ans => ({ word, why: null, until: null, strandCause: null, restartable: false, ...o });
  if (f.subject.kind === 'measured' && f.subject.value === null) return A('absent');
  if (f.off.kind === 'measured' && f.off.value !== null) return A('off', { why: f.off.value });
  const doubt = [f.subject.kind === 'unmeasured' ? f.subject.why : null, f.registry.kind === 'unmeasured' ? f.registry.why : null,
    f.off.kind === 'unmeasured' ? f.off.why : null, f.body.kind === 'unmeasured' ? f.body.why : null].find((w) => w !== null);
  if (doubt !== undefined) return A('unmeasured', { why: doubt });
  if (f.restarts.kind === 'unmeasured') return A('unmeasured', { why: f.restarts.why });
  if (f.restarts.value >= READINESS_RESTARTS_PER_HOUR + 1) return A('dead', { restartable: f.restartable });
  const body = f.body;
  const downFor = body.kind === 'down' && body.since !== null ? now - body.since : null;
  const downPast = downFor !== null && downFor > BOUND;
  if (body.kind === 'gone' || body.kind === 'asleep' || downPast) {
    if (f.generation.kind === 'unmeasured') return A('unmeasured', { why: f.generation.why });
    if (f.generation.value.kind !== 'renewing') return A('dead', { restartable: f.restartable });
  }
  if (body.kind === 'down' && !downPast) return A('restarting', { until: body.since === null ? null : body.since + BOUND });
  if (f.generation.kind === 'unmeasured') return A('unmeasured', { why: f.generation.why });
  if (f.generation.value.kind === 'renewing') return A('renewing', { until: f.generation.value.until });
  if (f.generation.value.kind === 'degraded') return A('degraded');
  if (f.stranded.kind === 'unmeasured') return A('unmeasured', { why: f.stranded.why });
  if (f.stranded.value !== null) return A('stranded', { why: f.stranded.value, strandCause: f.stranded.value });
  if (f.dialogSince !== null && f.dialogSince <= now - 30_000) return A('dialog-open');
  if (f.wedged.kind === 'unmeasured') return A('unmeasured', { why: f.wedged.why });
  if (f.wedged.value) return A('wedged');
  const halves: Buildable<boolean>[] = [f.deaf, f.heldDeaf];
  if (halves.some((h) => h.kind === 'measured' && h.value)) return A('deaf');
  const lost = halves.find((h) => h.kind === 'unmeasured');
  if (lost !== undefined && lost.kind === 'unmeasured') return A('unmeasured', { why: lost.why });
  if (f.saturated.kind === 'measured' && f.saturated.value) return A('saturated');
  if (f.saturated.kind === 'unmeasured') return A('unmeasured', { why: f.saturated.why });
  if (f.proofAt.kind === 'unmeasured') return A('unmeasured', { why: f.proofAt.why });
  if (f.proofAt.value === null) return A('unproved');
  if (f.leftReadyAt !== null && !(f.proofAt.value > f.leftReadyAt)) return A('unproved');
  return A('ready');
}

/** What is compared: the word, the figures it carries, and the input an `unmeasured` or `off` names. */
const compared = (a: Ans | ReadinessAnswer): Omit<Ans, 'why'> & { why?: string | null } => ({
  word: a.word, until: a.until, strandCause: a.strandCause, restartable: a.restartable,
  ...(a.word === 'unmeasured' || a.word === 'off' ? { why: a.why } : {}),
});

const BEST: ReadinessFacts = {
  subject: m({ sessionId: ME, bound: true }), off: m(null), registry: m('read'), body: { kind: 'up' }, restarts: m(0),
  generation: m({ kind: 'proven' }), stranded: m(null), dialogSince: null, wedged: m(false), deaf: m(false), heldDeaf: NB,
  saturated: NB, proofAt: m(5001), leftReadyAt: 5000, restartable: false,
};

/** Each fact's arms, best first, a later arm at least as bad as an earlier one. Measured values sit on each side of each threshold. */
const ARMS: Record<string, readonly unknown[]> = {
  subject: [m({ sessionId: ME, bound: true }), u('w:subject'), m(null)],
  off: [m(null), u('w:off'), m('rung')],
  registry: [m('read'), u('w:registry')],
  body: [{ kind: 'up' }, { kind: 'down', since: NOW - 9_099 }, { kind: 'down', since: NOW - 9_100 }, { kind: 'down', since: NOW - 9_101 },
    { kind: 'asleep' }, { kind: 'gone', cause: 'absent' }, { kind: 'unmeasured', why: 'w:body' }],
  restarts: [m(0), m(2), m(3), u('w:restarts')],
  generation: [m({ kind: 'proven' }), m({ kind: 'degraded' }), m({ kind: 'renewing', until: 777 }), u('w:generation')],
  stranded: [m(null), m('limited'), u('w:stranded')],
  dialogSince: [null, NOW - 29_999, NOW - 30_000],
  wedged: [m(false), m(true), u('w:wedged')],
  deaf: [m(false), NB, m(true), u('w:deaf')],
  heldDeaf: [NB, m(false), m(true), u('w:heldDeaf')],
  saturated: [NB, m(false), m(true), u('w:saturated')],
  proofAt: [m(5001), m(5000), m(null), u('w:proofAt')],
  leftReadyAt: [null, 5000],
  restartable: [false, true],
};
interface Axis { readonly key: string; readonly arms: readonly unknown[] }
const axis = (key: string, pick?: readonly number[]): Axis => {
  const all = ARMS[key] ?? [];
  return { key, arms: pick === undefined ? all : pick.map((i) => all[i]) };
};
const DOMAINS: Readonly<Record<string, readonly Axis[]>> = {
  head: ['subject', 'off', 'registry', 'body', 'restarts', 'generation', 'stranded', 'dialogSince', 'restartable'].map((k) => axis(k)),
  tail: ['generation', 'stranded', 'dialogSince', 'wedged', 'deaf', 'heldDeaf', 'saturated', 'proofAt', 'leftReadyAt'].map((k) => axis(k)),
  cross: [axis('subject'), axis('off', [0, 2]), axis('body', [0, 1, 3, 5, 6]), axis('restarts', [0, 2, 3]), axis('generation'),
    axis('stranded', [0, 1]), axis('dialogSince', [0, 2]), axis('wedged'), axis('deaf', [0, 2, 3]), axis('proofAt', [0, 2, 3])],
};
const sizeOf = (d: readonly Axis[]): number => d.reduce((n, a) => n * a.arms.length, 1);
const strides = (d: readonly Axis[]): number[] => {
  const out: number[] = []; let s = 1;
  for (const a of d) { out.push(s); s *= a.arms.length; }
  return out;
};
function factsAt(d: readonly Axis[], idx: number): ReadinessFacts {
  const patch: Record<string, unknown> = {};
  let rest = idx;
  for (const a of d) { patch[a.key] = a.arms[rest % a.arms.length]; rest = Math.floor(rest / a.arms.length); }
  return { ...BEST, ...patch } as ReadinessFacts;
}
const rank = (a: { word: ReadinessWord }): number => admitRank(a.word);

export function overlordReadinessCases(mod: M): Record<string, SuiteCase> {
  const cases: Record<string, SuiteCase> = {
    'the best facts read ready': () => { expect(mod.overlordReadiness(BEST, NOW).word).toBe('ready'); },
    'the restart bound: 9099 and 9100 ms are restarting until the bound, 9101 is dead': () => {
      const at = (ago: number): ReadinessFacts => ({ ...BEST, body: { kind: 'down', since: NOW - ago } });
      for (const ago of [9_099, 9_100]) {
        const a = mod.overlordReadiness(at(ago), NOW);
        expect([ago, a.word, a.until]).toEqual([ago, 'restarting', NOW - ago + 9_100]);
      }
      expect(mod.overlordReadiness(at(9_101), NOW).word).toBe('dead');
      expect(mod.overlordReadiness({ ...at(9_101), generation: m({ kind: 'renewing', until: 9 }) }, NOW).word).toBe('renewing');
    },
    'the restart count: two is not dead, three is dead whatever the generation': () => {
      expect(mod.overlordReadiness({ ...BEST, restarts: m(2) }, NOW).word).toBe('ready');
      expect(mod.overlordReadiness({ ...BEST, restarts: m(3) }, NOW).word).toBe('dead');
      expect(mod.overlordReadiness({ ...BEST, restarts: m(3), generation: m({ kind: 'renewing', until: 1 }) }, NOW).word).toBe('dead');
    },
    'the dead answer names its cause and carries the restart door only on dead': () => {
      const gone = mod.overlordReadiness({ ...BEST, body: { kind: 'gone', cause: 'orphan' }, restartable: true }, NOW);
      expect([gone.word, gone.why, gone.restartable]).toEqual(['dead', 'orphan', true]);
      expect(mod.overlordReadiness({ ...BEST, body: { kind: 'asleep' }, restartable: true }, NOW).why).toBe('asleep');
      expect(mod.overlordReadiness({ ...BEST, body: { kind: 'down', since: NOW - 9_101 } }, NOW).why).toBe('restart-bound');
      const third = mod.overlordReadiness({ ...BEST, restarts: m(3), restartable: true }, NOW);
      expect([third.why, third.restartable]).toEqual(['third-restart', true]);
      expect(mod.overlordReadiness({ ...BEST, wedged: m(true), restartable: true }, NOW).restartable).toBe(false);
    },
    'proof equal to leftReadyAt is not proof; one ms after is ready; a never-left word needs only some proof': () => {
      expect(mod.overlordReadiness({ ...BEST, proofAt: m(5000), leftReadyAt: 5000 }, NOW).word).toBe('unproved');
      expect(mod.overlordReadiness({ ...BEST, proofAt: m(5001), leftReadyAt: 5000 }, NOW).word).toBe('ready');
      expect(mod.overlordReadiness({ ...BEST, proofAt: m(4999), leftReadyAt: 5000 }, NOW).word).toBe('unproved');
      expect(mod.overlordReadiness({ ...BEST, proofAt: m(1), leftReadyAt: null }, NOW).word).toBe('ready');
      expect(mod.overlordReadiness({ ...BEST, proofAt: m(null), leftReadyAt: null }, NOW).word).toBe('unproved');
    },
    'the dialog stands open from 30 s, not before': () => {
      expect(mod.overlordReadiness({ ...BEST, dialogSince: NOW - READINESS_DIALOG_MS + 1 }, NOW).word).toBe('ready');
      expect(mod.overlordReadiness({ ...BEST, dialogSince: NOW - READINESS_DIALOG_MS }, NOW).word).toBe('dialog-open');
    },
    'not-built is no input: neither deaf nor saturated, and the best facts with both not-built read ready': () => {
      expect(mod.overlordReadiness({ ...BEST, deaf: NB, heldDeaf: NB, saturated: NB }, NOW).word).toBe('ready');
      expect(mod.overlordReadiness({ ...BEST, deaf: m(false), heldDeaf: m(true) }, NOW).word).toBe('deaf');
      expect(mod.overlordReadiness({ ...BEST, deaf: NB, heldDeaf: NB, saturated: m(true) }, NOW).word).toBe('saturated');
    },
  };
  for (const k of ['subject', 'off', 'registry', 'body', 'restarts', 'generation', 'stranded', 'wedged', 'deaf', 'heldDeaf', 'saturated',
    'proofAt'] as const) {
    cases[`${k} unmeasured, every other fact at its best, reads unmeasured and names it`] = () => {
      const f = { ...BEST, [k]: k === 'body' ? { kind: 'unmeasured', why: `w:${k}` } : u(`w:${k}`) } as ReadinessFacts;
      const a = mod.overlordReadiness(f, NOW);
      expect(['ready', 'unproved']).not.toContain(a.word);
      expect([a.word, a.why]).toEqual(['unmeasured', `w:${k}`]);
    };
  }
  for (const [name, d] of Object.entries(DOMAINS)) {
    cases[`every combination of the ${name} domain answers what the reference answers`] = () => {
      const bad: string[] = [];
      for (let i = 0, n = sizeOf(d); i < n; i += 1) {
        const f = factsAt(d, i);
        const want = reference(f, NOW);
        const got = mod.overlordReadiness(f, NOW);
        if (JSON.stringify(compared(got)) !== JSON.stringify(compared(want)) && bad.length < 3) {
          bad.push(`#${i} ${JSON.stringify(f)} -> got ${JSON.stringify(compared(got))}, want ${JSON.stringify(compared(want))}`);
        }
      }
      expect(bad).toEqual([]);
    };
  }
  for (const [name, d] of Object.entries(DOMAINS)) {
    cases[`monotonic over the ${name} domain: a worse fact, or a later now, never raises admitRank`] = () => {
      const n = sizeOf(d); const st = strides(d);
      const ranks = new Int8Array(n);
      for (let i = 0; i < n; i += 1) ranks[i] = rank(mod.overlordReadiness(factsAt(d, i), NOW));
      const bad: string[] = [];
      for (let i = 0; i < n; i += 1) {
        for (let k = 0; k < d.length; k += 1) {
          const arms = d[k]?.arms.length ?? 0; const at = Math.floor(i / (st[k] ?? 1)) % arms;
          for (let j = at + 1; j < arms; j += 1) {
            if ((ranks[i + (j - at) * (st[k] ?? 0)] ?? 0) > (ranks[i] ?? 0) && bad.length < 3) bad.push(`#${i} fact ${d[k]?.key} arm ${at} -> ${j}`);
          }
        }
      }
      for (const later of [NOW + 1, NOW + 30_000, NOW + 10_000_000]) {
        for (let i = 0; i < n; i += 1) {
          if (rank(mod.overlordReadiness(factsAt(d, i), later)) > (ranks[i] ?? 0) && bad.length < 3) bad.push(`#${i} now +${later - NOW}`);
        }
      }
      expect(bad).toEqual([]);
    };
  }
  return cases;
}

// ------------------------------------------------------------------------------------------------------- readinessFactsOf

const view = (over: Record<string, unknown> = {}): DesignationView => ({
  bound: { sessionId: ME, generation: 'g1' }, pending: null, term: 1, designatedTerm: 1, model: 'opus', accountPools: [], pastIds: [],
  actor: 'operator', lastAttempt: null, stopsOwed: [], ...over,
}) as unknown as DesignationView;
const DESIGNATED: DesignationRead = { kind: 'designated', sessionId: ME, term: 1, row: view() };
const pendingRead = (deadlineAt: number): DesignationRead => ({
  kind: 'not-designated',
  row: view({ bound: null, pending: { sessionId: 'cc-overlord-b', kind: 'start', deadlineAt, since: NOW, actor: 'operator', generation: null } }),
});
const markOf = (over: Record<string, unknown> = {}): TurnMarkRead => ({
  ok: true, sessionId: ME, state: 'done', event: 'Stop', at: NOW - 1_000, turnAt: null, stopAt: null, bg: 0, bgKinds: [], bgIds: [],
  err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: 0, graceUntil: null, ...over,
}) as unknown as TurnMarkRead;
const ABSENT_MARK: TurnMarkRead = { ok: false, reason: 'absent' };
const hookOf = (state: 'working' | 'waiting' | 'done', updatedAt: number): HookStateRead => ({
  ok: true, state: { state, updatedAt, event: null, ask: null, subagents: [], graphQueries: null, graphGateDenials: null, interrupted: false },
});
const NO_HOOK: HookStateRead = { ok: false, reason: 'no-state' };
const gen = (over: Partial<GenerationReading> = {}): GenerationReading =>
  ({ state: 'active', deadlineAt: null, proven: true, startReportedAt: 1_000, n: 1, ...over });
const sub = (over: Partial<SubjectReadings> = {}): SubjectReadings => ({
  ladder: { kind: 'read', operatorRung: 'full' }, body: { kind: 'up' }, generation: { ok: true, value: gen() }, restarts: { ok: true, value: 0 }, lastDownAt: null,
  candidates: { kind: 'candidates', list: [{ id: 'lane-a', limits: undefined, serves: 'yes' }, { id: 'lane-b', limits: undefined, serves: 'yes' }] },
  resets: { ok: true, value: {} }, strand: { kind: 'none' }, swapBlocked: null, turnMark: ABSENT_MARK, hookState: NO_HOOK, sessionStatus: 'idle',
  dialogSince: null, unsettled: { kind: 'measured', value: [] }, servedReadAt: { kind: 'measured', value: 'none' },
  continuityReadAt: { ok: true, value: null }, ...over,
});
const row = (over: Partial<ReadinessNowRow> = {}): ReadinessNowRow => ({
  id: 5, sessionId: ME, word: 'ready', why: null, until: null, strandCause: null, restartable: false, at: 2_000, readySince: 2_000, readySessionId: ME,
  leftReadyAt: null, episodeFirstId: null, pushedAt: null, ...over,
});
const readings = (s: Partial<SubjectReadings> | null = {}, over: Partial<ReadinessReadings> = {}): ReadinessReadings => ({
  registry: 'listed', designation: DESIGNATED, mailDisabled: 'clear', stored: { ok: true, value: 'none' },
  subject: s === null ? null : sub(s), ...over,
});

export function readinessFactsOfCases(mod: M): Record<string, SuiteCase> {
  const wordOf = (r: ReadinessReadings, now = NOW): ReadinessWord => mod.overlordReadiness(mod.readinessFactsOf(r, now), now).word;
  const down = (ago: number): OverlordBodyState => ({ kind: 'down', since: NOW - ago });
  const completed = (n: number, s: Partial<SubjectReadings>): ReadinessFacts => mod.readinessFactsOf(readings({ restarts: { ok: true, value: n }, ...s }), NOW);
  const msg = (at: number, state: MessageFacts['state']): MessageFacts => ({ id: 1, at, term: 1, state, cut: false });
  const deafAt = (msgAt: number, readySince: number | null, now: number, state: MessageFacts['state'] = 'recorded'): Buildable<boolean> =>
    mod.readinessFactsOf(readings({ unsettled: { kind: 'measured', value: [msg(msgAt, state)] } },
      { stored: { ok: true, value: readySince === null ? 'none' : row({ readySince }) } }), now).deaf;
  const wedged = (s: Partial<SubjectReadings>): Fact<boolean> => mod.readinessFactsOf(readings(s), NOW).wedged;
  const stranded = (s: Partial<SubjectReadings>): Fact<StrandCause | null> => mod.readinessFactsOf(readings(s), NOW).stranded;
  const cand = (id: string, serves: 'yes' | 'at-ceiling' | 'unmeasured') => ({ id, limits: undefined, serves });
  const list = (...c: ReturnType<typeof cand>[]): SubjectReadings['candidates'] => ({ kind: 'candidates', list: c });
  return {
    'restarts: one completed and the body down is the second in progress, restarting': () => {
      const f = completed(1, { body: down(1_000) });
      expect(f.restarts).toEqual(m(2));
      expect(mod.overlordReadiness(f, NOW).word).toBe('restarting');
    },
    'restarts: two completed and the body down is the third, dead within the bound': () => {
      const f = completed(2, { body: down(1_000) });
      expect(f.restarts).toEqual(m(3));
      expect(mod.overlordReadiness(f, NOW).word).toBe('dead');
    },
    'restarts: two completed and the body up adds nothing': () => {
      const f = completed(2, { body: { kind: 'up' } });
      expect(f.restarts).toEqual(m(2));
      expect(mod.overlordReadiness(f, NOW).word).not.toBe('dead');
    },
    // Fix round 1, F1 (slug restart-under-way-until-minted): back up, the restart is under way until its generation mints.
    'restarts: back up after a down sighting, no generation since: the third is still under way, dead': () => {
      const f = completed(2, { body: { kind: 'up' }, lastDownAt: NOW - 60_000, generation: { ok: true, value: gen({ startReportedAt: NOW - 120_000 }) } });
      expect(f.restarts).toEqual(m(3));
      expect(mod.overlordReadiness(f, NOW).word).toBe('dead');
    },
    'restarts: a sighting exactly an hour old still counts, and a generation started at the sighting is not minted since': () => {
      const at = NOW - READINESS_RESTART_WINDOW_MS;
      expect(completed(2, { body: { kind: 'up' }, lastDownAt: at, generation: { ok: true, value: gen({ startReportedAt: at - 1 }) } }).restarts).toEqual(m(3));
      expect(completed(2, { body: { kind: 'up' }, lastDownAt: NOW - 60_000, generation: { ok: true, value: gen({ startReportedAt: NOW - 60_000 }) } }).restarts).toEqual(m(3));
      expect(completed(2, { body: { kind: 'up' }, lastDownAt: NOW - 60_000, generation: { ok: true, value: gen({ startReportedAt: NOW - 59_999 }) } }).restarts).toEqual(m(2));
    },
    'restarts: back up with a renewing generation after a down sighting adds nothing': () => {
      const f = completed(2, { body: { kind: 'up' }, lastDownAt: NOW - 60_000, generation: { ok: true, value: gen({ state: 'draining', startReportedAt: NOW - 120_000 }) } });
      expect(f.restarts).toEqual(m(2));
    },
    // Fix round 1, F10 (slug readiness-ready-clock-per-binding): another session's ready row starts no deaf clock.
    'deaf: a ready row of another session starts no clock for this subject': () => {
      const r = readings({ unsettled: { kind: 'measured', value: [msg(NOW - 10 * READINESS_DEAF_MS, 'recorded')] } },
        { stored: { ok: true, value: row({ readySince: NOW - 20 * READINESS_DEAF_MS, readySessionId: 'cc-overlord-before' }) } });
      expect(mod.readinessFactsOf(r, NOW).deaf).toEqual(m(false));
      const own = readings({ unsettled: { kind: 'measured', value: [msg(NOW - 10 * READINESS_DEAF_MS, 'recorded')] } },
        { stored: { ok: true, value: row({ readySince: NOW - 20 * READINESS_DEAF_MS }) } });
      expect(mod.readinessFactsOf(own, NOW).deaf).toEqual(m(true));
    },
    'restarts: three completed and the generation renewing is dead': () => {
      expect(mod.overlordReadiness(completed(3, { generation: { ok: true, value: gen({ state: 'draining', proven: false }) } }), NOW).word).toBe('dead');
    },
    'restarts: a renewing generation with the body down adds no restart': () => {
      const f = completed(2, { body: down(60_000), generation: { ok: true, value: gen({ state: 'probing', deadlineAt: 4_242, proven: false }) } });
      expect(f.restarts).toEqual(m(2));
      const a = mod.overlordReadiness(f, NOW);
      expect([a.word, a.until]).toEqual(['renewing', 4_242]);
    },
    'restarts: a doubt about the generation counts the restart in progress': () => {
      expect(completed(1, { body: down(1_000), generation: { ok: true, value: null } }).restarts).toEqual(m(2));
      expect(completed(1, { body: down(1_000), generation: { ok: false, detail: 'db' } }).restarts).toEqual(m(2));
    },
    'the generation: an unproven active one reads renewing to its deadline, a degraded one degraded, a proven one proven': () => {
      const at = (g: Partial<GenerationReading>): ReadinessFacts['generation'] => mod.readinessFactsOf(readings({ generation: { ok: true, value: gen(g) } }), NOW).generation;
      expect(at({ state: 'active', proven: false, deadlineAt: 55 })).toEqual(m({ kind: 'renewing', until: 55 }));
      expect(at({ state: 'degraded' })).toEqual(m({ kind: 'degraded' }));
      expect(at({ state: 'active', proven: true })).toEqual(m({ kind: 'proven' }));
    },
    'restarts: a failed read is unmeasured': () => {
      const f = mod.readinessFactsOf(readings({ restarts: { ok: false, detail: 'db busy' } }), NOW);
      expect(f.restarts.kind).toBe('unmeasured');
      expect(mod.overlordReadiness(f, NOW).word).toBe('unmeasured');
    },
    'the restartable fact is the restart door\'s: gone yes, up no, down no': () => {
      expect(mod.readinessFactsOf(readings({ body: { kind: 'gone', cause: 'orphan' } }), NOW).restartable).toBe(true);
      expect(mod.readinessFactsOf(readings({ body: { kind: 'up' } }), NOW).restartable).toBe(false);
      expect(mod.readinessFactsOf(readings({ body: { kind: 'down', since: NOW } }), NOW).restartable).toBe(false);
    },
    'a pending subject with no generation reads renewing through the attempt\'s deadline': () => {
      const f = mod.readinessFactsOf(readings({ generation: { ok: true, value: null } }, { designation: pendingRead(NOW + 60_000) }), NOW);
      expect(f.subject).toEqual(m({ sessionId: 'cc-overlord-b', bound: false }));
      const a = mod.overlordReadiness(f, NOW);
      expect([a.word, a.until]).toEqual(['renewing', NOW + 60_000]);
    },
    'a bound subject with no generation is unmeasured; no pending row is absent; an unreadable designation is unmeasured': () => {
      expect(wordOf(readings({ generation: { ok: true, value: null } }))).toBe('unmeasured');
      expect(wordOf(readings({}, { designation: { kind: 'not-designated', row: null } }))).toBe('absent');
      expect(wordOf(readings({}, { designation: { kind: 'unmeasured', why: 'db' } }))).toBe('unmeasured');
    },
    'proof: a served read newer than the generation start counts, an equal one does not': () => {
      const g = { ok: true, value: gen({ startReportedAt: 5_000 }) } as const;
      expect(mod.readinessFactsOf(readings({ generation: g, servedReadAt: { kind: 'measured', value: 5_001 } }), NOW).proofAt).toEqual(m(5_001));
      expect(mod.readinessFactsOf(readings({ generation: g, servedReadAt: { kind: 'measured', value: 5_000 } }), NOW).proofAt).toEqual(m(null));
    },
    'proof: a done turn with a stop over an idle session counts, over a busy one it does not': () => {
      const t = markOf({ state: 'done', stopAt: 7_000 });
      expect(mod.readinessFactsOf(readings({ turnMark: t, sessionStatus: 'idle' }), NOW).proofAt).toEqual(m(7_000));
      expect(mod.readinessFactsOf(readings({ turnMark: t, sessionStatus: 'busy' }), NOW).proofAt).toEqual(m(null));
    },
    'proof: all three sources unread is unmeasured, one read source with none is no proof': () => {
      const none = mod.readinessFactsOf(readings({
        servedReadAt: { kind: 'unmeasured', why: 'db' }, continuityReadAt: { ok: false, detail: 'db' }, turnMark: { ok: false, reason: 'malformed' },
      }), NOW);
      expect(none.proofAt.kind).toBe('unmeasured');
      expect(mod.readinessFactsOf(readings({ servedReadAt: { kind: 'unmeasured', why: 'db' }, continuityReadAt: { ok: false, detail: 'db' } }), NOW).proofAt)
        .toEqual(m(null));
    },
    'the deaf clock runs from readySince when later, and is not deaf at 119999 ms': () => {
      expect(deafAt(500, 10_000, 10_000 + READINESS_DEAF_MS - 1)).toEqual(m(false));
      expect(deafAt(500, 10_000, 10_000 + READINESS_DEAF_MS)).toEqual(m(true));
    },
    'the deaf clock runs from the message\'s arrival when that is later': () => {
      expect(deafAt(50_000, 10_000, 50_000 + READINESS_DEAF_MS - 1)).toEqual(m(false));
      expect(deafAt(50_000, 10_000, 50_000 + READINESS_DEAF_MS)).toEqual(m(true));
    },
    'a null readySince reads no message deaf': () => { expect(deafAt(1, null, NOW)).toEqual(m(false)); },
    'a picked-up or settled message is not waiting; delivered and queued are': () => {
      expect(deafAt(1, 1, NOW, 'picked-up')).toEqual(m(false));
      expect(deafAt(1, 1, NOW, 'settled')).toEqual(m(false));
      expect(deafAt(1, 1, NOW, 'delivered')).toEqual(m(true));
      expect(deafAt(1, 1, NOW, 'queued')).toEqual(m(true));
    },
    'an unknown message state, an unreadable inbox and an unreadable stored row read deaf unmeasured': () => {
      expect(deafAt(1, 1, NOW, 'unknown').kind).toBe('unmeasured');
      expect(mod.readinessFactsOf(readings({ unsettled: { kind: 'unmeasured', why: 'db' } }), NOW).deaf.kind).toBe('unmeasured');
      expect(mod.readinessFactsOf(readings({}, { stored: { ok: false, detail: 'db' } }), NOW).deaf.kind).toBe('unmeasured');
    },
    'W1 passes not-built for exactly the held-rows half and the saturation fact; leftReadyAt comes from the stored row': () => {
      const f = mod.readinessFactsOf(readings({}), NOW);
      expect([f.heldDeaf, f.saturated]).toEqual([NB, NB]);
      expect(mod.readinessFactsOf(readings({}, { stored: { ok: true, value: row({ leftReadyAt: 3_333 }) } }), NOW).leftReadyAt).toBe(3_333);
      expect(f.leftReadyAt).toBeNull();
    },
    'wedged: an absent turn marker is not wedged': () => { expect(wedged({ turnMark: ABSENT_MARK })).toEqual(m(false)); },
    'wedged: a working turn only when over ten minutes old': () => {
      expect(wedged({ turnMark: markOf({ state: 'working', turnAt: NOW - READINESS_LONG_TURN_MS }) })).toEqual(m(false));
      expect(wedged({ turnMark: markOf({ state: 'working', turnAt: NOW - READINESS_LONG_TURN_MS - 1 }) })).toEqual(m(true));
    },
    'wedged: working with no hook event for over five minutes': () => {
      expect(wedged({ hookState: hookOf('working', NOW - READINESS_HOOK_QUIET_MS) })).toEqual(m(false));
      expect(wedged({ hookState: hookOf('working', NOW - READINESS_HOOK_QUIET_MS - 1) })).toEqual(m(true));
      expect(wedged({ hookState: hookOf('waiting', 1) })).toEqual(m(false));
    },
    'wedged: an unreadable marker is unmeasured, but no hook state is not': () => {
      expect(wedged({ turnMark: { ok: false, reason: 'malformed' } }).kind).toBe('unmeasured');
      expect(wedged({ hookState: { ok: false, reason: 'unmeasured' } }).kind).toBe('unmeasured');
      expect(wedged({ hookState: NO_HOOK })).toEqual(m(false));
    },
    'the dialog\'s first sighting is carried, and the decider counts the 30 s': () => {
      expect(mod.readinessFactsOf(readings({ dialogSince: NOW - 5 }), NOW).dialogSince).toBe(NOW - 5);
      expect(wordOf(readings({ dialogSince: NOW - READINESS_DIALOG_MS + 1 }))).not.toBe('dialog-open');
      expect(wordOf(readings({ dialogSince: NOW - READINESS_DIALOG_MS }))).toBe('dialog-open');
    },
    'strand: an empty candidate list strands set-admits-none': () => { expect(stranded({ candidates: list() })).toEqual(m('set-admits-none')); },
    'strand: every candidate at its ceiling strands limited': () => {
      expect(stranded({ candidates: list(cand('lane-a', 'at-ceiling'), cand('lane-b', 'at-ceiling')) })).toEqual(m('limited'));
    },
    'strand: none yes and every one exhausted strands limited': () => {
      const at = { kind: 'at', atS: 100 } as const;
      expect(stranded({ candidates: list(cand('lane-a', 'unmeasured'), cand('lane-b', 'at-ceiling')), resets: { ok: true, value: { 'lane-a': at, 'lane-b': at } } }))
        .toEqual(m('limited'));
    },
    'strand: one candidate yes strands nothing, whatever the others': () => {
      const at = { kind: 'at', atS: 100 } as const;
      expect(stranded({ candidates: list(cand('lane-a', 'yes'), cand('lane-b', 'at-ceiling')), resets: { ok: true, value: { 'lane-a': at, 'lane-b': at } } }))
        .toEqual(m(null));
    },
    'strand: none yes, one not exhausted, one unmeasured is unmeasured, never limited': () => {
      expect(stranded({ candidates: list(cand('lane-a', 'unmeasured'), cand('lane-b', 'at-ceiling')),
        resets: { ok: true, value: { 'lane-a': { kind: 'none-exhausted' }, 'lane-b': { kind: 'at', atS: 1 } } } }).kind).toBe('unmeasured');
    },
    'strand: a failed resets read with none yes, and unmeasured candidates, are unmeasured': () => {
      expect(stranded({ candidates: list(cand('lane-a', 'unmeasured')), resets: { ok: false, detail: 'x' } }).kind).toBe('unmeasured');
      expect(stranded({ candidates: { kind: 'unmeasured', why: 'designation-unreadable' } }).kind).toBe('unmeasured');
    },
    'strand: a blocked swap strands swap-blocked': () => { expect(stranded({ swapBlocked: { at: 1, reason: 'x' } })).toEqual(m('swap-blocked')); },
    'strand: a failed turn strands turn-failed exactly for the owner\'s account class': () => {
      const classes = STOP_FAILURE_ERRORS as Readonly<Record<string, string>>;
      expect(Object.keys(classes).filter((e) => classes[e] === 'account').length).toBeGreaterThan(0);
      for (const err of Object.keys(classes)) {
        expect([err, stranded({ turnMark: markOf({ state: 'failed', err }) })]).toEqual([err, m(classes[err] === 'account' ? 'turn-failed' : null)]);
      }
      expect(stranded({ turnMark: markOf({ state: 'done', err: 'rate_limit' }) })).toEqual(m(null));
    },
    'strand: a token the classifier cannot name is unmeasured, and a measured cause still wins': () => {
      for (const err of ['a_token_from_a_later_build', null]) expect(stranded({ turnMark: markOf({ state: 'failed', err }) }).kind).toBe('unmeasured');
      const a = mod.overlordReadiness(mod.readinessFactsOf(readings({ turnMark: markOf({ state: 'failed', err: 'a_token_from_a_later_build' }) }), NOW), NOW);
      expect([a.word, a.why]).toEqual(['unmeasured', 'stranded: turn-failed token unclassified unread']);
      expect(stranded({ swapBlocked: { at: 1, reason: 'x' }, turnMark: markOf({ state: 'failed', err: 'a_token_from_a_later_build' }) })).toEqual(m('swap-blocked'));
    },
    'strand: a marked strand strands unread; an unreadable marker or no record is unmeasured': () => {
      expect(stranded({ strand: { kind: 'marked', reason: 'ccd words' } })).toEqual(m('unread'));
      expect(stranded({ strand: { kind: 'unreadable' } }).kind).toBe('unmeasured');
      expect(stranded({ strand: { kind: 'no-record' } }).kind).toBe('unmeasured');
    },
    'strand: the order of causes is set-admits-none, limited, swap-blocked, turn-failed, unread': () => {
      const all = { candidates: list(), swapBlocked: { at: 1, reason: 'x' }, turnMark: markOf({ state: 'failed', err: 'rate_limit' }),
        strand: { kind: 'marked', reason: 'r' } as const };
      expect(stranded(all)).toEqual(m('set-admits-none'));
      expect(stranded({ ...all, candidates: list(cand('lane-a', 'at-ceiling')) })).toEqual(m('limited'));
      expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')) })).toEqual(m('swap-blocked'));
      expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')), swapBlocked: null })).toEqual(m('turn-failed'));
      expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')), swapBlocked: null, turnMark: ABSENT_MARK })).toEqual(m('unread'));
      const a = mod.overlordReadiness(mod.readinessFactsOf(readings({ candidates: list() }), NOW), NOW);
      expect([a.word, a.strandCause]).toEqual(['stranded', 'set-admits-none']);
    },
    'the brakes: mail-disabled reads off, the rung off reads off, and no subject reads absent': () => {
      expect(wordOf(readings(null, { mailDisabled: 'set', designation: { kind: 'not-designated', row: null } }))).toBe('absent');
      expect(wordOf(readings({}, { mailDisabled: 'set' }))).toBe('off');
      expect(wordOf(readings({ ladder: { kind: 'read', operatorRung: 'off' } }))).toBe('off');
    },
    'the registry: an unreadable ladder or listing is unmeasured, boot and failed name themselves': () => {
      const named = (r: ReadinessReadings): [ReadinessWord, string | null] => {
        const a = mod.overlordReadiness(mod.readinessFactsOf(r, NOW), NOW);
        return [a.word, a.why];
      };
      expect(named(readings({ ladder: { kind: 'unmeasured', why: 'db' } }))[0]).toBe('unmeasured');
      expect(named(readings({}, { mailDisabled: 'unmeasurable' }))[0]).toBe('unmeasured');
      expect(named(readings({}, { registry: 'boot' }))).toEqual(['unmeasured', 'boot']);
      expect(named(readings({}, { registry: 'failed' }))).toEqual(['unmeasured', 'registry']);
    },
  };
}

// ------------------------------------------------------------------------------------------------------- readinessNotices

const ans = (word: ReadinessWord, over: Partial<ReadinessAnswer> = {}): ReadinessAnswer =>
  ({ word, why: null, until: null, strandCause: null, restartable: false, ...over });
const strandedAns = (cause: StrandCause): ReadinessAnswer => ans('stranded', { why: cause, strandCause: cause });
const rec = (id: number, item: ReadinessItemRecord['item'], key: string, itemState: ReadinessItemRecord['itemState'] = 'open'): ReadinessItemRecord =>
  ({ id, item, key, itemId: 100 + id, raisedAt: 1, itemState });

export function readinessNoticesCases(mod: M): Record<string, SuiteCase> {
  const notices = (word: ReadinessAnswer, over: Partial<NoticeInputs> = {}, written: Partial<NoticeInputs['written']> = {}): readonly ReadinessNotice[] =>
    mod.readinessNotices({ written: { answer: word, episodeFirst: false, rowId: 7, ...written }, records: [], count: m(2), holds: { kind: 'not-wired' }, ...over });
  const settle = (recordId: number, note = 'cleared'): ReadinessNotice => ({ kind: 'settle', recordId, note });
  const raise = (item: 'stranded' | 'count' | 'hold', key: string): ReadinessNotice => ({ kind: 'raise', item, key });
  return {
    'dead pushes only on the episode\'s first write, with Restart when restartable': () => {
      expect(notices(ans('dead', { restartable: true }), {}, { episodeFirst: true })).toEqual([{ kind: 'dead-push', rowId: 7, withRestart: true }]);
      expect(notices(ans('dead', { restartable: false }), {}, { episodeFirst: true })).toEqual([{ kind: 'dead-push', rowId: 7, withRestart: false }]);
      expect(notices(ans('dead', { restartable: true }), {}, { episodeFirst: false })).toEqual([]);
      expect(notices(ans('wedged'), {}, { episodeFirst: true })).toEqual([]);
    },
    'a dead first write with no row id pushes nothing': () => {
      expect(notices(ans('dead'), {}, { episodeFirst: true, rowId: null })).toEqual([]);
    },
    'absent settles every live record with the note retired and raises nothing': () => {
      const records = [rec(1, 'stranded', 'limited'), rec(2, 'count', 'count', 'checking'), rec(3, 'hold', 'lane-a')];
      expect(notices(ans('absent'), { records, count: m(1), holds: { kind: 'read', lanes: ['lane-b'] } }))
        .toEqual([settle(1, 'retired'), settle(2, 'retired'), settle(3, 'retired')]);
    },
    'a record whose item was dismissed, done, withdrawn or missing is closed, never settled': () => {
      for (const itemState of ['dismissed', 'done', 'withdrawn', 'missing'] as const) {
        expect([itemState, notices(ans('ready'), { records: [rec(1, 'stranded', 'limited', itemState)] })]).toEqual([itemState, [{ kind: 'close', recordId: 1 }]]);
      }
      expect(notices(ans('absent'), { records: [rec(1, 'count', 'count', 'done')] })).toEqual([{ kind: 'close', recordId: 1 }]);
      for (const w of ['ready', 'stranded', 'absent', 'unproved'] as const) {
        const out = notices(w === 'stranded' ? strandedAns('limited') : ans(w), { records: [rec(1, 'stranded', 'limited', 'dismissed')] });
        expect(out.filter((n) => n.kind === 'settle')).toEqual([]);
        expect(out.filter((n) => n.kind === 'close')).toEqual([{ kind: 'close', recordId: 1 }]);
      }
    },
    'a closed record\'s cause recurring raises a new item': () => {
      expect(notices(strandedAns('limited'), { records: [rec(1, 'stranded', 'limited', 'dismissed')] }))
        .toEqual([{ kind: 'close', recordId: 1 }, raise('stranded', 'limited')]);
    },
    'stranded raises once per cause': () => {
      expect(notices(strandedAns('limited'))).toEqual([raise('stranded', 'limited')]);
      expect(notices(strandedAns('limited'), { records: [rec(1, 'stranded', 'limited')] })).toEqual([]);
    },
    'stranded settles a record whose cause no longer holds, and raises the new cause': () => {
      expect(notices(strandedAns('turn-failed'), { records: [rec(1, 'stranded', 'limited')] })).toEqual([settle(1), raise('stranded', 'turn-failed')]);
    },
    'a word after stranded settles every stranded record': () => {
      for (const w of ['dialog-open', 'wedged', 'deaf', 'saturated', 'unproved', 'ready'] as const) {
        expect([w, notices(ans(w), { records: [rec(1, 'stranded', 'limited')] })]).toEqual([w, [settle(1)]]);
      }
    },
    'an unmeasured word, and a word before stranded, settle nothing': () => {
      for (const w of ['unmeasured', 'off', 'dead', 'restarting', 'renewing', 'degraded'] as const) {
        expect([w, notices(ans(w), { records: [rec(1, 'stranded', 'limited')] })]).toEqual([w, []]);
      }
    },
    'the count item is raised below two, and once': () => {
      expect(notices(ans('ready'), { count: m(1) })).toEqual([raise('count', 'count')]);
      expect(notices(ans('ready'), { count: m(0) })).toEqual([raise('count', 'count')]);
      expect(notices(ans('ready'), { count: m(1), records: [rec(1, 'count', 'count')] })).toEqual([]);
      expect(notices(ans('ready'), { count: m(2) })).toEqual([]);
    },
    'the count item is settled when the count reads two or more': () => {
      expect(notices(ans('ready'), { count: m(2), records: [rec(1, 'count', 'count')] })).toEqual([settle(1)]);
      expect(notices(ans('ready'), { count: m(3), records: [rec(1, 'count', 'count')] })).toEqual([settle(1)]);
    },
    'under a set-admits-none strand the count item is not raised, and a standing one is settled': () => {
      expect(notices(strandedAns('set-admits-none'), { count: m(0) })).toEqual([raise('stranded', 'set-admits-none')]);
      expect(notices(strandedAns('set-admits-none'), { count: m(0), records: [rec(1, 'stranded', 'set-admits-none'), rec(2, 'count', 'count')] }))
        .toEqual([settle(2)]);
    },
    'beside any other cause the count item is raised and left standing': () => {
      for (const cause of STRAND_CAUSES.filter((c) => c !== 'set-admits-none')) {
        expect([cause, notices(strandedAns(cause), { count: m(1) })]).toEqual([cause, [raise('stranded', cause), raise('count', 'count')]]);
        expect([cause, notices(strandedAns(cause), { count: m(1), records: [rec(1, 'stranded', cause), rec(2, 'count', 'count')] })]).toEqual([cause, []]);
      }
    },
    'a set-admits-none item standing under a later word still holds the count item\'s place only until it is settled': () => {
      // The word is past stranded: the set-admits-none record is settled this pass, so the count item is judged by its own count.
      expect(notices(ans('ready'), { count: m(1), records: [rec(1, 'stranded', 'set-admits-none')] })).toEqual([settle(1), raise('count', 'count')]);
      // The word is before stranded (nothing measured): a standing set-admits-none item still holds the count item's place.
      expect(notices(ans('dead'), { count: m(1), records: [rec(1, 'stranded', 'set-admits-none'), rec(2, 'count', 'count')] })).toEqual([settle(2)]);
      expect(notices(ans('dead'), { count: m(1), records: [rec(1, 'stranded', 'set-admits-none')] })).toEqual([]);
    },
    'an unmeasured count raises nothing and settles nothing': () => {
      expect(notices(ans('ready'), { count: u('count: x'), records: [rec(1, 'count', 'count')] })).toEqual([]);
      expect(notices(ans('ready'), { count: u('count: x') })).toEqual([]);
    },
    'holds not-wired and unmeasured raise and settle nothing': () => {
      const records = [rec(1, 'hold', 'lane-a')];
      expect(notices(ans('ready'), { records, holds: { kind: 'not-wired' } })).toEqual([]);
      expect(notices(ans('ready'), { records, holds: { kind: 'unmeasured' } })).toEqual([]);
      expect(notices(ans('ready'), { holds: { kind: 'unmeasured' } })).toEqual([]);
    },
    'holds read raises one item per held lane without a record, and settles a cleared lane\'s': () => {
      expect(notices(ans('ready'), { records: [rec(1, 'hold', 'lane-b'), rec(2, 'hold', 'lane-c')], holds: { kind: 'read', lanes: ['lane-a', 'lane-b'] } }))
        .toEqual([settle(2), raise('hold', 'lane-a')]);
      expect(notices(ans('ready'), { holds: { kind: 'read', lanes: ['lane-a', 'lane-b'] } })).toEqual([raise('hold', 'lane-a'), raise('hold', 'lane-b')]);
    },
    'the dead push and the items are independent': () => {
      expect(notices(ans('dead'), { count: m(1) }, { episodeFirst: true })).toEqual([{ kind: 'dead-push', rowId: 7, withRestart: false }, raise('count', 'count')]);
    },
  };
}

// ------------------------------------------------------------------------------------------------------- servedReadiness

export function servedReadinessCases(mod: M): Record<string, SuiteCase> {
  const stored = row({ word: 'ready', why: 'w', until: 9, strandCause: null, at: 1_234, restartable: true });
  const served = (lastPassMono: number | null, nowMono = 100_000, nowWall = 5_000_000): ReadinessWire =>
    mod.servedReadiness(stored, { lastPassMono, nowMono, nowWall });
  const flat = { lastPassMono: 1, nowMono: 2, nowWall: 3 };
  return {
    'before this process\'s first pass: unmeasured, boot, since now': () => {
      const w = served(null);
      expect([w.word, w.why, w.since, w.until, w.restartable, w.strandCause, w.questionsGo]).toEqual(['unmeasured', 'boot', 5_000_000, null, false, null, 'operator']);
      expect(mod.servedReadiness('none', { lastPassMono: null, nowMono: 1, nowWall: 7 }).why).toBe('boot');
    },
    'a pass 30000 ms ago serves the stored word': () => {
      const w = served(100_000 - READINESS_FRESH_MS);
      expect([w.word, w.since, w.why, w.until, w.questionsGo]).toEqual(['ready', 1_234, 'w', 9, 'operator']);
    },
    'a pass 30001 ms ago is unmeasured, stale, since the moment the limit passed': () => {
      const w = served(100_000 - READINESS_FRESH_MS - 1);
      expect([w.word, w.why, w.since, w.until, w.restartable]).toEqual(['unmeasured', 'stale', 5_000_000 - 1, null, false]);
      const long = served(100_000 - READINESS_FRESH_MS - 5_000);
      expect([long.word, long.since]).toEqual(['unmeasured', 5_000_000 - 5_000]);
    },
    'a fresh pass over no stored row is unmeasured, boot': () => {
      const w = mod.servedReadiness('none', { lastPassMono: 99_999, nowMono: 100_000, nowWall: 7 });
      expect([w.word, w.why, w.since]).toEqual(['unmeasured', 'boot', 7]);
    },
    'restartable is served only for dead': () => {
      for (const w of READINESS_WORDS) expect([w, mod.servedReadiness(row({ word: w, restartable: true }), flat).restartable]).toEqual([w, w === 'dead']);
      expect(mod.servedReadiness(row({ word: 'dead', restartable: false }), flat).restartable).toBe(false);
    },
    'the strand cause, the why and the until ride through': () => {
      const w = mod.servedReadiness(row({ word: 'stranded', strandCause: 'limited', why: 'limited', until: 4 }), flat);
      expect([w.word, w.strandCause, w.why, w.until]).toEqual(['stranded', 'limited', 'limited', 4]);
    },
  };
}

// --------------------------------------------------------------------------------------------------------------- the sets

const set = (cases: (mod: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: MODULE, mutants, suite: cases });

export const OVERLORD_READINESS_SET = set(overlordReadinessCases, [
  // The plan's six.
  { id: 'OR-1 swap stranded and dialog-open',
    old: `  // 8. stranded
  if (f.stranded.kind === 'unmeasured') return answer('unmeasured', f.stranded.why);
  if (f.stranded.value !== null) return answer('stranded', f.stranded.value, { strandCause: f.stranded.value });
  // 9. dialog-open
  if (f.dialogSince !== null && now - f.dialogSince >= READINESS_DIALOG_MS) return answer('dialog-open');`,
    new: `  // 9. dialog-open
  if (f.dialogSince !== null && now - f.dialogSince >= READINESS_DIALOG_MS) return answer('dialog-open');
  // 8. stranded
  if (f.stranded.kind === 'unmeasured') return answer('unmeasured', f.stranded.why);
  if (f.stranded.value !== null) return answer('stranded', f.stranded.value, { strandCause: f.stranded.value });` },
  { id: 'OR-2 swap dialog-open and wedged',
    old: `  // 9. dialog-open
  if (f.dialogSince !== null && now - f.dialogSince >= READINESS_DIALOG_MS) return answer('dialog-open');
  // 10. wedged
  if (f.wedged.kind === 'unmeasured') return answer('unmeasured', f.wedged.why);
  if (f.wedged.value) return answer('wedged');`,
    new: `  // 10. wedged
  if (f.wedged.kind === 'unmeasured') return answer('unmeasured', f.wedged.why);
  if (f.wedged.value) return answer('wedged');
  // 9. dialog-open
  if (f.dialogSince !== null && now - f.dialogSince >= READINESS_DIALOG_MS) return answer('dialog-open');` },
  { id: 'OR-3 a measured unmeasured wedged read as the row\'s fault',
    old: "if (f.wedged.kind === 'unmeasured') return answer('unmeasured', f.wedged.why);", new: "if (f.wedged.kind === 'unmeasured') return answer('wedged');" },
  { id: 'OR-4 an unmeasured stranded read as the row\'s fault',
    old: "if (f.stranded.kind === 'unmeasured') return answer('unmeasured', f.stranded.why);",
    new: "if (f.stranded.kind === 'unmeasured') return answer('stranded', f.stranded.why);" },
  { id: 'OR-5 the renewing guard on the third-restart clause',
    old: 'if (f.restarts.value > READINESS_RESTARTS_PER_HOUR) return answer(',
    new: "if (f.restarts.value > READINESS_RESTARTS_PER_HOUR && !(f.generation.kind === 'measured' && f.generation.value.kind === 'renewing')) return answer(" },
  { id: 'OR-6 >= for the restart bound',
    old: 'now - body.since > READINESS_RESTART_BOUND_MS', new: 'now - body.since >= READINESS_RESTART_BOUND_MS' },
  { id: 'OR-7 >= for the restart count',
    old: 'f.restarts.value > READINESS_RESTARTS_PER_HOUR) return', new: 'f.restarts.value >= READINESS_RESTARTS_PER_HOUR) return' },
  { id: 'OR-8 > for the dialog bound',
    old: 'now - f.dialogSince >= READINESS_DIALOG_MS', new: 'now - f.dialogSince > READINESS_DIALOG_MS' },
  { id: 'OR-9 not-built read as true for the saturation',
    old: "if (f.saturated.kind === 'measured' && f.saturated.value) return answer('saturated');",
    new: "if (f.saturated.kind === 'not-built' || (f.saturated.kind === 'measured' && f.saturated.value)) return answer('saturated');" },
  { id: 'OR-10 not-built read as true for the held-rows half',
    old: "(f.heldDeaf.kind === 'measured' && f.heldDeaf.value)) return answer('deaf');",
    new: "(f.heldDeaf.kind === 'not-built' || (f.heldDeaf.kind === 'measured' && f.heldDeaf.value))) return answer('deaf');" },
  { id: 'OR-11 proof equal to leftReadyAt is proof',
    old: 'p <= f.leftReadyAt', new: 'p < f.leftReadyAt' },
  { id: 'OR-12 no proof is not unproved',
    old: 'if (p === null || (f.leftReadyAt !== null && p <= f.leftReadyAt)) return answer(\'unproved\');',
    new: "if (p !== null && f.leftReadyAt !== null && p <= f.leftReadyAt) return answer('unproved');" },
  { id: 'OR-13 the dead cause of a bound body is asleep',
    old: ": 'restart-bound';", new: ": 'asleep';" },
  { id: 'OR-14 the renewing row drops its deadline',
    old: "return answer('renewing', null, { until: gen.until });", new: "return answer('renewing');" },
]);

export const READINESS_FACTS_OF_SET = set(readinessFactsOfCases, [
  // The plan's five.
  { id: 'FA-1 drop the in-progress +1', old: 's.restarts.value + inProgress', new: 's.restarts.value' },
  { id: 'FA-2 add the +1 while renewing',
    old: "const underWay = s.body.kind === 'down' ? !renewing", new: "const underWay = s.body.kind === 'down' ? true" },
  { id: 'FA-3 read limited when some candidate is at its ceiling (the plan\'s "chat line": the ceiling line)',
    old: "c.list.every((x) => x.serves === 'at-ceiling')", new: "c.list.some((x) => x.serves === 'at-ceiling')" },
  { id: 'FA-4 an absent turn marker read as wedged',
    old: "if (!t.ok && t.reason !== 'absent') return unmeasured(`wedged: turn marker ${t.reason}`);",
    new: "if (!t.ok && t.reason === 'absent') return measured(true);\n  if (!t.ok) return unmeasured(`wedged: turn marker ${t.reason}`);" },
  { id: 'FA-5 the deaf clock starts with a null readySince',
    old: '  if (since === null) return measured(false);\n', new: '' },
  // Beyond the plan's list.
  { id: 'FA-6 a doubt about the generation does not count the restart in progress',
    old: "const renewing = generation.kind === 'measured' && generation.value.kind === 'renewing';",
    new: "const renewing = !(generation.kind === 'measured' && generation.value.kind !== 'renewing');" },
  { id: 'FA-7 >= for the long turn',
    old: 'now - t.turnAt > READINESS_LONG_TURN_MS', new: 'now - t.turnAt >= READINESS_LONG_TURN_MS' },
  { id: 'FA-8 >= for the hook quiet',
    old: 'now - h.state.updatedAt > READINESS_HOOK_QUIET_MS', new: 'now - h.state.updatedAt >= READINESS_HOOK_QUIET_MS' },
  { id: 'FA-9 no hook state read as unmeasured',
    old: "h.reason !== 'no-state'", new: "h.reason === 'no-state'" },
  { id: 'FA-10 > for the deaf bound',
    old: 'now - Math.max(m.at, since) >= READINESS_DEAF_MS', new: 'now - Math.max(m.at, since) > READINESS_DEAF_MS' },
  { id: 'FA-11 the deaf clock runs from the earlier of arrival and readySince',
    old: 'Math.max(m.at, since)', new: 'Math.min(m.at, since)' },
  { id: 'FA-12 proof equal to the generation start counts',
    old: '(start === null || at > start)', new: '(start === null || at >= start)' },
  { id: 'FA-13 boot and registry swapped',
    old: "unmeasured(raw.registry === 'boot' ? 'boot' : 'registry')", new: "unmeasured(raw.registry === 'boot' ? 'registry' : 'boot')" },
  { id: 'FA-14 a blocked swap strands nothing',
    old: 'if (s.swapBlocked !== null) return measured(\'swap-blocked\');', new: '' },
  { id: 'FA-15 any classified failure strands turn-failed',
    old: "if (cls === 'account') return measured('turn-failed');", new: "if (cls !== undefined && cls !== null) return measured('turn-failed');" },
  { id: 'FA-16 the restart door always acts', old: 'restartable: restartVerdict(binding, s.body, now).ok,', new: 'restartable: true,' },
  { id: 'FA-17 a pending subject reads no deadline',
    old: 'subject.value.bound ? null : pending?.deadlineAt ?? null', new: 'null' },
  { id: 'FA-18 a bound subject with no generation reads renewing, a pending one unmeasured',
    old: "return bound ? unmeasured('generation: none live') : measured({ kind: 'renewing', until: pendingUntil });",
    new: "return bound ? measured({ kind: 'renewing', until: pendingUntil }) : unmeasured('generation: none live');" },
  { id: 'FA-19 an unproven generation reads proven',
    old: "return g.proven ? measured({ kind: 'proven' }) : measured({ kind: 'renewing', until: g.deadlineAt });",
    new: "return measured({ kind: 'proven' });" },
  // Fix round 1 (review 3922): F1, the restart under way after the body is back up, and F10, the ready clock's session.
  { id: 'FA-20 the restart under way ends when the body is back up',
    old: '    : downAt !== null && now - downAt <= READINESS_RESTART_WINDOW_MS && !renewing && !mintedSince;', new: '    : false;' },
  { id: 'FA-21 a sighting exactly an hour old no longer counts',
    old: 'now - downAt <= READINESS_RESTART_WINDOW_MS', new: 'now - downAt < READINESS_RESTART_WINDOW_MS' },
  { id: 'FA-22 a generation started at the sighting reads minted since', old: 'genRow.startReportedAt > downAt', new: 'genRow.startReportedAt >= downAt' },
  { id: 'FA-23 a renewing generation counts a restart under way once back up',
    old: '&& !renewing && !mintedSince;', new: '&& !mintedSince;' },
  { id: 'FA-24 the ready clock of any session',
    old: "stored.value === 'none' || stored.value.readySessionId !== subjectId ? null", new: "stored.value === 'none' ? null" },
]);

export const READINESS_NOTICES_SET = set(readinessNoticesCases, [
  // The plan's five.
  { id: 'NO-1 push on a level, without episodeFirst',
    old: "a.word === 'dead' && n.written.episodeFirst && n.written.rowId !== null", new: "a.word === 'dead' && n.written.rowId !== null" },
  { id: 'NO-2 raise the count item under a set-admits-none strand',
    old: 'if (low && !setNamed && countLive.length === 0)', new: 'if (low && countLive.length === 0)' },
  { id: 'NO-3 settle an item on an unmeasured cause',
    old: "const strandMeasured = a.word !== 'unmeasured' && at >= STRANDED_AT;", new: "const strandMeasured = a.word === 'unmeasured' || at >= STRANDED_AT;" },
  { id: 'NO-4 settle instead of close a dismissed item',
    old: "else out.push({ kind: 'close', recordId: r.id });",
    new: "else out.push({ kind: 'settle', recordId: r.id, note: READINESS_SETTLE_NOTE.cleared });" },
  { id: 'NO-5 raise on absent',
    old: "    for (const r of live) settle(r, READINESS_SETTLE_NOTE.retired);\n    return out;\n", new: '    for (const r of live) settle(r, READINESS_SETTLE_NOTE.retired);\n' },
  // Beyond the plan's list.
  { id: 'NO-6 an unmeasured count settles its item',
    old: "if (n.count.kind === 'measured') {", new: "if (n.count.kind !== 'unmeasured' || true) {" },
  { id: 'NO-7 the count threshold is three', old: 'n.count.value < 2', new: 'n.count.value < 3' },
  { id: 'NO-8 a dead push with no row id',
    old: "a.word === 'dead' && n.written.episodeFirst && n.written.rowId !== null", new: "a.word === 'dead' && n.written.episodeFirst" },
  { id: 'NO-9 the push always offers Restart', old: 'withRestart: a.restartable', new: 'withRestart: true' },
  { id: 'NO-10 a stranded record of the standing cause is settled',
    old: 'for (const r of strandedLive) if (r.key !== cause) settle(', new: 'for (const r of strandedLive) if (r.key === cause) settle(' },
  { id: 'NO-11 a standing stranded record does not stop a raise',
    old: '!strandedLive.some((r) => r.key === cause)', new: 'true' },
  { id: 'NO-12 holds not read settle and raise',
    old: "if (n.holds.kind === 'read') {", new: "if (n.holds.kind !== 'not-wired') {" },
  { id: 'NO-13 a cleared hold is not settled',
    old: 'for (const r of holdLive) if (!held.has(r.key)) settle(', new: 'for (const r of holdLive) if (held.has(r.key)) settle(' },
  { id: 'NO-14 a held lane with a record is raised again',
    old: '!holdLive.some((r) => r.key === lane)', new: 'true' },
  { id: 'NO-15 a checking item is not live',
    old: 'const LIVE_ITEM_STATES: ReadonlySet<string> = new Set(OPEN_ITEM_STATES);',
    new: "const LIVE_ITEM_STATES: ReadonlySet<string> = new Set(OPEN_ITEM_STATES.filter((x) => x !== 'checking'));" },
  { id: 'NO-16 a standing set-admits-none record is not read before stranded',
    old: ': strandedLive.some((r) => r.key === \'set-admits-none\');', new: ': false;' },
]);

export const SERVED_READINESS_SET = set(servedReadinessCases, [
  // The plan's two.
  { id: 'SR-1 serve the stored word before the first pass',
    old: 'if (lastPassMono === null) return doubt(READINESS_SERVED_WHY.boot, nowWall);',
    new: "if (lastPassMono === null && stored === 'none') return doubt(READINESS_SERVED_WHY.boot, nowWall);" },
  { id: 'SR-2 serve it past the limit',
    old: 'if (age > READINESS_FRESH_MS) return', new: 'if (age > READINESS_FRESH_MS + 1) return' },
  // Beyond the plan's list.
  { id: 'SR-3 serve it at the limit', old: 'if (age > READINESS_FRESH_MS) return', new: 'if (age >= READINESS_FRESH_MS) return' },
  { id: 'SR-4 stale since now', old: 'nowWall - (age - READINESS_FRESH_MS)', new: 'nowWall' },
  { id: 'SR-5 stale and boot swapped', old: 'doubt(READINESS_SERVED_WHY.stale, ', new: 'doubt(READINESS_SERVED_WHY.boot, ' },
  { id: 'SR-6 restartable on any word', old: "stored.word === 'dead' && stored.restartable", new: 'stored.restartable' },
  { id: 'SR-7 no stored row serves its word', old: "if (stored === 'none') return doubt(READINESS_SERVED_WHY.boot, nowWall);", new: '' },
  { id: 'SR-8 the since is now', old: 'since: stored.at,', new: 'since: nowWall,' },
  { id: 'SR-9 the strand cause is dropped', old: 'strandCause: stored.strandCause,', new: 'strandCause: null,' },
]);

/** Fix round 1, F8: the count item's figure, with its unmeasured-candidate guard. */
export function readinessCountOfCases(mod: M): Record<string, SuiteCase> {
  const cand = (id: string, serves: 'yes' | 'at-ceiling' | 'unmeasured') => ({ id, limits: undefined, serves });
  const of = (...c: ReturnType<typeof cand>[]): Parameters<M['readinessCountOf']>[0] => ({ kind: 'candidates', list: c });
  return {
    'count: no list read is unmeasured': () => { expect(mod.readinessCountOf(null).kind).toBe('unmeasured'); },
    'count: an unmeasured candidate list is unmeasured': () => {
      expect(mod.readinessCountOf({ kind: 'unmeasured', why: 'designation-unreadable' }).kind).toBe('unmeasured');
    },
    'count: one candidate merely unread makes the figure unmeasured, never one short': () => {
      expect(mod.readinessCountOf(of(cand('lane-a', 'yes'), cand('lane-b', 'unmeasured'))).kind).toBe('unmeasured');
    },
    'count: only the candidates that serve are counted': () => {
      expect(mod.readinessCountOf(of(cand('lane-a', 'yes'), cand('lane-b', 'at-ceiling'), cand('lane-c', 'yes')))).toEqual(m(2));
      expect(mod.readinessCountOf(of())).toEqual(m(0));
    },
  };
}

export const READINESS_COUNT_OF_SET = set(readinessCountOfCases, [
  { id: 'CO-1 the unmeasured-candidate guard deleted',
    old: "  if (c.list.some((x) => x.serves === 'unmeasured')) return unmeasured('count: a candidate is unmeasured');\n", new: '' },
  { id: 'CO-2 every candidate counted', old: "c.list.filter((x) => x.serves === 'yes').length", new: 'c.list.length' },
  { id: 'CO-3 no list read counts none', old: "if (c === null) return unmeasured('count: not read');", new: 'if (c === null) return measured(0);' },
  { id: 'CO-4 an unmeasured list counts none', old: 'if (c.kind !== \'candidates\') return unmeasured(`count: ${c.kind}`);', new: "if (c.kind !== 'candidates') return measured(0);" },
]);

export const READINESS_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [OVERLORD_READINESS_KEY]: OVERLORD_READINESS_SET as MutantSet<never>,
  [READINESS_FACTS_OF_KEY]: READINESS_FACTS_OF_SET as MutantSet<never>,
  [READINESS_NOTICES_KEY]: READINESS_NOTICES_SET as MutantSet<never>,
  [SERVED_READINESS_KEY]: SERVED_READINESS_SET as MutantSet<never>,
  [READINESS_COUNT_OF_KEY]: READINESS_COUNT_OF_SET as MutantSet<never>,
};
