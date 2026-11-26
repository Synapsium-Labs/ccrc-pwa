// The Overlord's readiness word: its vocabulary and its four deciders (Overlord spec §6.4, Table 6.4a, H20; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-readiness.md` Task 1, Step 2). Pure: no database, no clock, no fleet.
// The decider is checked three ways: against a reference written here from the plan's numbered row list (first match), over
// finite domains of every combination of each fact's arms; by two properties (a worse fact never raises `admitRank`, and an
// unmeasured fact with every other at its best is never `ready` nor `unproved`); and case by case for the thresholds, the
// restart count's off-by-one, the strand cause, the served word and each notice rule.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATION_OUTCOMES } from '../../shared/continuity.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import {
  READINESS_DEAF_MS, READINESS_DIALOG_MS, READINESS_FRESH_MS, READINESS_HOOK_QUIET_MS,
  READINESS_LONG_TURN_MS, READINESS_RESTART_BOUND_MS, READINESS_RESTART_WINDOW_MS, READINESS_RESTARTS_PER_HOUR, READINESS_WORDS, RESTART_OUTCOME_MAP,
  RESTART_OUTCOMES, STRAND_CAUSES, admitRank, type ReadinessWire, type ReadinessWord, type StrandCause,
} from '../../shared/overlord-readiness.js';
import { STOP_FAILURE_ERRORS } from '../src/coord/stopFailure.js';
import type { TurnMarkRead } from '../src/coord/stall.js';
import type { HookStateRead } from '../src/hookstate.js';
import type { OverlordBodyState } from '../src/coord/overlordDesignation.js';
import type { MessageFacts } from '../src/coord/overlordInbox.js';
import {
  overlordReadiness, readinessFactsOf, readinessNotices, servedReadiness,
  type Buildable, type Fact, type GenerationReading, type NoticeInputs, type ReadinessAnswer, type ReadinessFacts,
  type ReadinessItemRecord, type ReadinessNotice, type ReadinessNowRow, type ReadinessReadings, type SubjectReadings,
} from '../src/coord/overlordReadiness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = 10_000_000;
const m = <T>(value: T): Fact<T> => ({ kind: 'measured', value });
const u = (why: string): { kind: 'unmeasured'; why: string } => ({ kind: 'unmeasured', why });
const NB = { kind: 'not-built' } as const;

// ── The reference, written from the plan's numbered row list (Task 1, "The order of overlordReadiness") ────────────────

interface Ans { word: ReadinessWord; why: string | null; until: number | null; strandCause: StrandCause | null; restartable: boolean }
const BOUND = 9_100;

function reference(f: ReadinessFacts, now: number): Ans {
  const A = (word: ReadinessWord, o: Partial<Ans> = {}): Ans => ({ word, why: null, until: null, strandCause: null, restartable: false, ...o });
  // 1. absent
  if (f.subject.kind === 'measured' && f.subject.value === null) return A('absent');
  // 2. off
  if (f.off.kind === 'measured' && f.off.value !== null) return A('off', { why: f.off.value });
  // 3. unmeasured: subject, registry, off or body (the registry before the brakes: a failed listing is why mail-disabled is
  //    unread, so the why names the listing, as the plan's Table 2 and Task 3 say: "a failed listing writes unmeasured with why
  //    registry")
  const doubt = [f.subject.kind === 'unmeasured' ? f.subject.why : null, f.registry.kind === 'unmeasured' ? f.registry.why : null,
    f.off.kind === 'unmeasured' ? f.off.why : null, f.body.kind === 'unmeasured' ? f.body.why : null]
    .find((w) => w !== null);
  if (doubt !== undefined) return A('unmeasured', { why: doubt });
  // 4. dead, in three clauses, and unmeasured where a clause needs an input it lacks
  if (f.restarts.kind === 'unmeasured') return A('unmeasured', { why: f.restarts.why });
  if (f.restarts.value >= READINESS_RESTARTS_PER_HOUR + 1) return A('dead', { restartable: f.restartable });
  const body = f.body;
  const downFor = body.kind === 'down' && body.since !== null ? now - body.since : null;
  const downPast = downFor !== null && downFor > BOUND;
  if (body.kind === 'gone' || body.kind === 'asleep' || downPast) {
    if (f.generation.kind === 'unmeasured') return A('unmeasured', { why: f.generation.why });
    if (f.generation.value.kind !== 'renewing') return A('dead', { restartable: f.restartable });
  }
  // 5. restarting
  if (body.kind === 'down' && !downPast) return A('restarting', { until: body.since === null ? null : body.since + BOUND });
  // 6. renewing
  if (f.generation.kind === 'unmeasured') return A('unmeasured', { why: f.generation.why });
  if (f.generation.value.kind === 'renewing') return A('renewing', { until: f.generation.value.until });
  // 7. degraded
  if (f.generation.value.kind === 'degraded') return A('degraded');
  // 8. stranded
  if (f.stranded.kind === 'unmeasured') return A('unmeasured', { why: f.stranded.why });
  if (f.stranded.value !== null) return A('stranded', { why: f.stranded.value, strandCause: f.stranded.value });
  // 9. dialog-open
  if (f.dialogSince !== null && f.dialogSince <= now - 30_000) return A('dialog-open');
  // 10. wedged
  if (f.wedged.kind === 'unmeasured') return A('unmeasured', { why: f.wedged.why });
  if (f.wedged.value) return A('wedged');
  // 11. deaf: either half true, or either half unmeasured; not-built is no input
  const halves: Buildable<boolean>[] = [f.deaf, f.heldDeaf];
  if (halves.some((h) => h.kind === 'measured' && h.value)) return A('deaf');
  const lost = halves.find((h) => h.kind === 'unmeasured');
  if (lost !== undefined && lost.kind === 'unmeasured') return A('unmeasured', { why: lost.why });
  // 12. saturated
  if (f.saturated.kind === 'measured' && f.saturated.value) return A('saturated');
  if (f.saturated.kind === 'unmeasured') return A('unmeasured', { why: f.saturated.why });
  // 13. unproved: no proof, or not newer than the last leaving of ready; unmeasured here
  if (f.proofAt.kind === 'unmeasured') return A('unmeasured', { why: f.proofAt.why });
  if (f.proofAt.value === null) return A('unproved');
  if (f.leftReadyAt !== null && !(f.proofAt.value > f.leftReadyAt)) return A('unproved');
  // 14. ready
  return A('ready');
}

/** What is compared: the word, the figures the word carries, and the input an `unmeasured` or `off` names. A dead cause is the
 *  implementation's own wording, pinned separately. */
const compared = (a: Ans | ReadinessAnswer): Omit<Ans, 'why'> & { why?: string | null } => ({
  word: a.word, until: a.until, strandCause: a.strandCause, restartable: a.restartable,
  ...(a.word === 'unmeasured' || a.word === 'off' ? { why: a.why } : {}),
});

// ── The domains ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const BEST: ReadinessFacts = {
  subject: m({ sessionId: 'cc-overlord-a', bound: true }), off: m(null), registry: m('read'), body: { kind: 'up' }, restarts: m(0),
  generation: m({ kind: 'proven' }), stranded: m(null), dialogSince: null, wedged: m(false), deaf: m(false), heldDeaf: NB,
  saturated: NB, proofAt: m(5001), leftReadyAt: 5000, restartable: false,
};

/** Each fact's arms, best first and worse after: any later arm is at least as bad as an earlier one (the monotonic test reads
 *  that order). Measured values sit on each side of every threshold. */
const ARMS: Record<string, readonly unknown[]> = {
  subject: [m({ sessionId: 'cc-overlord-a', bound: true }), u('w:subject'), m(null)],
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
/** Head rows' facts, the tail at its best. */
const DOMAIN_HEAD: readonly Axis[] = ['subject', 'off', 'registry', 'body', 'restarts', 'generation', 'stranded', 'dialogSince', 'restartable']
  .map((k) => axis(k));
/** Tail rows' facts, the head at its best (the body up). */
const DOMAIN_TAIL: readonly Axis[] = ['generation', 'stranded', 'dialogSince', 'wedged', 'deaf', 'heldDeaf', 'saturated', 'proofAt', 'leftReadyAt']
  .map((k) => axis(k));
/** Head and tail together, each fact with fewer arms. */
const DOMAIN_CROSS: readonly Axis[] = [axis('subject'), axis('off', [0, 2]), axis('body', [0, 1, 3, 5, 6]), axis('restarts', [0, 2, 3]),
  axis('generation'), axis('stranded', [0, 1]), axis('dialogSince', [0, 2]), axis('wedged'), axis('deaf', [0, 2, 3]), axis('proofAt', [0, 2, 3])];
const DOMAINS = { head: DOMAIN_HEAD, tail: DOMAIN_TAIL, cross: DOMAIN_CROSS } as const;

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

describe('the domains', () => {
  it('CONTROL: each product is under 200k and the three together are the pinned count', () => {
    for (const d of Object.values(DOMAINS)) expect(sizeOf(d)).toBeLessThan(200_000);
    expect(sizeOf(DOMAIN_HEAD) + sizeOf(DOMAIN_TAIL) + sizeOf(DOMAIN_CROSS)).toBe(36_288 + 55_296 + 38_880);
  });
});

describe('overlordReadiness against the reference written from the plan\'s rows', () => {
  const seen = new Set<ReadinessWord>();
  for (const [name, d] of Object.entries(DOMAINS)) {
    it(`every combination of the ${name} domain answers what the reference answers`, () => {
      const bad: string[] = [];
      const n = sizeOf(d);
      for (let i = 0; i < n; i += 1) {
        const f = factsAt(d, i);
        const want = reference(f, NOW);
        seen.add(want.word);
        const got = overlordReadiness(f, NOW);
        if (JSON.stringify(compared(got)) !== JSON.stringify(compared(want)) && bad.length < 5) {
          bad.push(`#${i} ${JSON.stringify(f)} -> got ${JSON.stringify(compared(got))}, want ${JSON.stringify(compared(want))}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
  it('CONTROL: the three domains together reach every one of the fourteen words', () => {
    expect([...seen].sort()).toEqual([...READINESS_WORDS].sort());
  });
});

describe('monotonic: a worse fact never raises admitRank', () => {
  for (const [name, d] of Object.entries(DOMAINS)) {
    it(`over the ${name} domain, one fact moved to a later arm, or a later now`, () => {
      const n = sizeOf(d); const st = strides(d);
      const ranks = new Int8Array(n);
      for (let i = 0; i < n; i += 1) ranks[i] = rank(overlordReadiness(factsAt(d, i), NOW));
      const bad: string[] = [];
      for (let i = 0; i < n; i += 1) {
        for (let k = 0; k < d.length; k += 1) {
          const arms = d[k]?.arms.length ?? 0; const at = Math.floor(i / (st[k] ?? 1)) % arms;
          for (let j = at + 1; j < arms; j += 1) {
            const worse = i + (j - at) * (st[k] ?? 0);
            if ((ranks[worse] ?? 0) > (ranks[i] ?? 0) && bad.length < 5) bad.push(`#${i} fact ${d[k]?.key} arm ${at} -> ${j}`);
          }
        }
      }
      for (const later of [NOW + 1, NOW + 30_000, NOW + 10_000_000]) {
        for (let i = 0; i < n; i += 1) {
          if (rank(overlordReadiness(factsAt(d, i), later)) > (ranks[i] ?? 0) && bad.length < 5) bad.push(`#${i} now +${later - NOW}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }
  it('CONTROL: the best facts read ready, and a mutated order would be caught (a worse arm that raised the rank is seen)', () => {
    expect(overlordReadiness(BEST, NOW).word).toBe('ready');
    expect(rank(overlordReadiness({ ...BEST, proofAt: m(null) }, NOW))).toBeLessThan(2);
  });
});

describe('unmeasured is never ready', () => {
  const fields: (keyof ReadinessFacts)[] = ['subject', 'off', 'registry', 'body', 'restarts', 'generation', 'stranded', 'wedged', 'deaf',
    'heldDeaf', 'saturated', 'proofAt'];
  for (const k of fields) {
    it(`${k} unmeasured, every other fact at its best, reads unmeasured and names it`, () => {
      const f = { ...BEST, [k]: k === 'body' ? { kind: 'unmeasured', why: `w:${k}` } : u(`w:${k}`) } as ReadinessFacts;
      const a = overlordReadiness(f, NOW);
      expect(['ready', 'unproved']).not.toContain(a.word);
      expect(a.word).toBe('unmeasured');
      expect(a.why).toBe(`w:${k}`);
    });
  }
});

// ── The raw readings ────────────────────────────────────────────────────────────────────────────────────────────────────

const ME = 'cc-overlord-a';
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
  continuityReadAt: { ok: true, value: null }, holds: { kind: 'read', lanes: [] }, ...over,
});
const row = (over: Partial<ReadinessNowRow> = {}): ReadinessNowRow => ({
  id: 5, sessionId: ME, word: 'ready', why: null, until: null, strandCause: null, restartable: false, at: 2_000, readySince: 2_000, readySessionId: ME,
  leftReadyAt: null, episodeFirstId: null, pushedAt: null, ...over,
});
const readings = (s: Partial<SubjectReadings> | null = {}, over: Partial<ReadinessReadings> = {}): ReadinessReadings => ({
  registry: 'listed', designation: DESIGNATED, mailDisabled: 'clear', stored: { ok: true, value: 'none' },
  subject: s === null ? null : sub(s), ...over,
});
const wordOf = (r: ReadinessReadings, now = NOW): ReadinessWord => overlordReadiness(readinessFactsOf(r, now), now).word;

describe('the restart count through readinessFactsOf (F1: restartsSince counts completed restarts)', () => {
  const down = (ago: number): OverlordBodyState => ({ kind: 'down', since: NOW - ago });
  const completed = (n: number, s: Partial<SubjectReadings>): ReadinessFacts =>
    readinessFactsOf(readings({ restarts: { ok: true, value: n }, ...s }), NOW);
  it('1 completed and the body down is the second restart in progress: restarting', () => {
    const f = completed(1, { body: down(1_000) });
    expect(f.restarts).toEqual(m(2));
    expect(overlordReadiness(f, NOW).word).toBe('restarting');
  });
  it('2 completed and the body down is the third: dead, even within the bound', () => {
    const f = completed(2, { body: down(1_000) });
    expect(f.restarts).toEqual(m(3));
    expect(overlordReadiness(f, NOW).word).toBe('dead');
  });
  it('2 completed and the body up is not dead', () => {
    const f = completed(2, { body: { kind: 'up' } });
    expect(f.restarts).toEqual(m(2));
    expect(overlordReadiness(f, NOW).word).not.toBe('dead');
  });
  // F1 (review 3922): `restartsSince` counts minted generations only, so a restart whose body is back up but whose generation
  // is not minted yet is still the one in progress, until a generation started after the last down sighting is live.
  describe('the restart under way after the body is back up (F1, lastDownAt)', () => {
    const upAfter = (s: Partial<SubjectReadings>): ReadinessFacts => completed(2, { body: { kind: 'up' }, ...s });
    it('2 completed, the body up, a down sighting within the hour and the live generation older than it: the third, dead', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: true, value: gen({ proven: true, startReportedAt: NOW - 50_000 }) } });
      expect(f.restarts).toEqual(m(3));
      expect(overlordReadiness(f, NOW)).toMatchObject({ word: 'dead', why: 'third-restart' });
    });
    it('the same with a generation started after the down sighting: minted, so not added and not dead', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: true, value: gen({ proven: true, startReportedAt: NOW - 1_000 }) } });
      expect(f.restarts).toEqual(m(2));
      expect(overlordReadiness(f, NOW).word).not.toBe('dead');
    });
    it('the same with the down sighting older than the hour: not added and not dead', () => {
      const f = upAfter({ lastDownAt: NOW - READINESS_RESTART_WINDOW_MS - 1, generation: { ok: true, value: gen({ proven: true, startReportedAt: 1_000 }) } });
      expect(f.restarts).toEqual(m(2));
      expect(overlordReadiness(f, NOW).word).not.toBe('dead');
    });
    it('a down sighting exactly an hour old still counts (the window is inclusive)', () => {
      const f = upAfter({ lastDownAt: NOW - READINESS_RESTART_WINDOW_MS, generation: { ok: true, value: gen({ proven: true, startReportedAt: 1_000 }) } });
      expect(f.restarts).toEqual(m(3));
    });
    it('the body up with a renewing generation adds nothing, whatever the sighting', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: true, value: gen({ state: 'probing', deadlineAt: 4_242, proven: false, startReportedAt: NOW - 50_000 }) } });
      expect(f.restarts).toEqual(m(2));
      expect(overlordReadiness(f, NOW).word).not.toBe('dead');
    });
    it('no down sighting (lastDownAt null) adds nothing: the case above stays as it was', () => {
      expect(upAfter({ lastDownAt: null }).restarts).toEqual(m(2));
    });
    // Review 3941 A3: the minted test is strict. A generation that started at the very instant of the sighting is the one the
    // down sighting belongs to, not a replacement, so the restart is still under way; one millisecond later it is minted.
    it('a generation started exactly at the down sighting is not minted since: the restart counts, the third, dead', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: true, value: gen({ proven: true, startReportedAt: NOW - 5_000 }) } });
      expect(f.restarts).toEqual(m(3));
      expect(overlordReadiness(f, NOW)).toMatchObject({ word: 'dead', why: 'third-restart' });
    });
    it('a generation started one millisecond after the down sighting is minted: not added', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: true, value: gen({ proven: true, startReportedAt: NOW - 5_000 + 1 }) } });
      expect(f.restarts).toEqual(m(2));
    });
    // Review 3941 A7: doubt lowers on the up half too. An unreadable generation is neither renewing nor minted since, so a down
    // sighting inside the hour is still a restart under way: with two counted, the third, dead.
    it('the generation unreadable, the body up, a down sighting inside the hour and two counted: the restart counts, dead', () => {
      const f = upAfter({ lastDownAt: NOW - 5_000, generation: { ok: false, detail: 'db busy' } });
      expect(f.restarts).toEqual(m(3));
      expect(overlordReadiness(f, NOW)).toMatchObject({ word: 'dead', why: 'third-restart' });
    });
    it('the generation unreadable and the body down (the down half): the same restart counts, dead', () => {
      const f = completed(2, { body: down(1_000), generation: { ok: false, detail: 'db busy' } });
      expect(f.restarts).toEqual(m(3));
      expect(overlordReadiness(f, NOW)).toMatchObject({ word: 'dead', why: 'third-restart' });
    });
  });
  it('3 completed, the body up and the generation proven: dead', () => {
    expect(overlordReadiness(completed(3, { body: { kind: 'up' }, generation: { ok: true, value: gen({ proven: true }) } }), NOW).word).toBe('dead');
  });
  it('3 completed and the generation renewing: dead (a crash loop wins over a renewal)', () => {
    expect(overlordReadiness(completed(3, { generation: { ok: true, value: gen({ state: 'draining', proven: false }) } }), NOW).word).toBe('dead');
  });
  it('2 completed, the generation renewing and the body down past the bound: no restart is added, and it reads renewing', () => {
    const f = completed(2, { body: down(60_000), generation: { ok: true, value: gen({ state: 'probing', deadlineAt: 4_242, proven: false }) } });
    expect(f.restarts).toEqual(m(2));
    const a = overlordReadiness(f, NOW);
    expect([a.word, a.until]).toEqual(['renewing', 4_242]);
  });
  it('a failed restarts read is unmeasured and names it', () => {
    const f = readinessFactsOf(readings({ restarts: { ok: false, detail: 'db busy' } }), NOW);
    expect(f.restarts.kind).toBe('unmeasured');
    expect(overlordReadiness(f, NOW).word).toBe('unmeasured');
  });
});

describe('the restart bound', () => {
  const at = (ago: number): ReadinessFacts => ({ ...BEST, body: { kind: 'down', since: NOW - ago } });
  it('9099 and 9100 ms down are within the bound: restarting, until the first sighting plus the bound', () => {
    for (const ago of [9_099, 9_100]) {
      const a = overlordReadiness(at(ago), NOW);
      expect([ago, a.word, a.until]).toEqual([ago, 'restarting', NOW - ago + 9_100]);
    }
  });
  it('9101 ms down is past it: dead', () => {
    expect(overlordReadiness(at(9_101), NOW).word).toBe('dead');
  });
  it('a renewing generation holds a body down past the bound off dead', () => {
    expect(overlordReadiness({ ...at(9_101), generation: m({ kind: 'renewing', until: 9 }) }, NOW).word).toBe('renewing');
  });
});

describe('the dead answer', () => {
  it('carries the restart door\'s verdict only on dead, and names a cause', () => {
    const gone = overlordReadiness({ ...BEST, body: { kind: 'gone', cause: 'orphan' }, restartable: true }, NOW);
    expect([gone.word, gone.why, gone.restartable]).toEqual(['dead', 'orphan', true]);
    expect(overlordReadiness({ ...BEST, body: { kind: 'asleep' }, restartable: true }, NOW).why).toBe('asleep');
    expect(overlordReadiness({ ...BEST, restarts: m(3), restartable: true }, NOW).restartable).toBe(true);
    expect(overlordReadiness({ ...BEST, wedged: m(true), restartable: true }, NOW).restartable).toBe(false);
  });
  it('the restartable fact comes from designation B\'s door: a gone body is restartable, an up body is not', () => {
    expect(readinessFactsOf(readings({ body: { kind: 'gone', cause: 'orphan' } }), NOW).restartable).toBe(true);
    expect(readinessFactsOf(readings({ body: { kind: 'up' } }), NOW).restartable).toBe(false);
    expect(readinessFactsOf(readings({ body: { kind: 'down', since: NOW } }), NOW).restartable).toBe(false);
  });
});

describe('a pending subject', () => {
  it('with no generation yet reads renewing, through the pending attempt\'s deadline', () => {
    const r = readings({ generation: { ok: true, value: null } }, { designation: pendingRead(NOW + 60_000) });
    const f = readinessFactsOf(r, NOW);
    expect(f.subject).toEqual(m({ sessionId: 'cc-overlord-b', bound: false }));
    const a = overlordReadiness(f, NOW);
    expect([a.word, a.until]).toEqual(['renewing', NOW + 60_000]);
  });
  it('a bound subject with no generation is unmeasured, never renewing', () => {
    expect(wordOf(readings({ generation: { ok: true, value: null } }))).toBe('unmeasured');
  });
  it('a not-designated read with no pending row is absent, and an unreadable designation is unmeasured', () => {
    expect(wordOf(readings({}, { designation: { kind: 'not-designated', row: null } }))).toBe('absent');
    expect(wordOf(readings({}, { designation: { kind: 'unmeasured', why: 'db' } }))).toBe('unmeasured');
  });
});

describe('proof', () => {
  it('proof equal to leftReadyAt is not proof; one ms after is ready', () => {
    expect(overlordReadiness({ ...BEST, proofAt: m(5000), leftReadyAt: 5000 }, NOW).word).toBe('unproved');
    expect(overlordReadiness({ ...BEST, proofAt: m(5001), leftReadyAt: 5000 }, NOW).word).toBe('ready');
    expect(overlordReadiness({ ...BEST, proofAt: m(4999), leftReadyAt: 5000 }, NOW).word).toBe('unproved');
  });
  it('a word that never left ready (leftReadyAt null) needs only some proof', () => {
    expect(overlordReadiness({ ...BEST, proofAt: m(1), leftReadyAt: null }, NOW).word).toBe('ready');
    expect(overlordReadiness({ ...BEST, proofAt: m(null), leftReadyAt: null }, NOW).word).toBe('unproved');
  });
  it('through the gatherer: a served read newer than the generation\'s start counts, an older one does not', () => {
    const g = { ok: true, value: gen({ startReportedAt: 5_000 }) } as const;
    expect(readinessFactsOf(readings({ generation: g, servedReadAt: { kind: 'measured', value: 5_001 } }), NOW).proofAt).toEqual(m(5_001));
    expect(readinessFactsOf(readings({ generation: g, servedReadAt: { kind: 'measured', value: 5_000 } }), NOW).proofAt).toEqual(m(null));
  });
  it('through the gatherer: a done turn with a stop over an idle session is proof; over a busy one it is not', () => {
    const t = markOf({ state: 'done', stopAt: 7_000 });
    expect(readinessFactsOf(readings({ turnMark: t, sessionStatus: 'idle' }), NOW).proofAt).toEqual(m(7_000));
    expect(readinessFactsOf(readings({ turnMark: t, sessionStatus: 'busy' }), NOW).proofAt).toEqual(m(null));
  });
  it('through the gatherer: all three sources unread is unmeasured, and one read source with none is no proof', () => {
    const none = readinessFactsOf(readings({
      servedReadAt: { kind: 'unmeasured', why: 'db' }, continuityReadAt: { ok: false, detail: 'db' }, turnMark: { ok: false, reason: 'malformed' },
    }), NOW);
    expect(none.proofAt.kind).toBe('unmeasured');
    const one = readinessFactsOf(readings({ servedReadAt: { kind: 'unmeasured', why: 'db' }, continuityReadAt: { ok: false, detail: 'db' } }), NOW);
    expect(one.proofAt).toEqual(m(null));
  });
});

describe('the deaf clock (F18)', () => {
  const msg = (at: number, state: MessageFacts['state']): MessageFacts => ({ id: 1, at, term: 1, state, cut: false });
  const deafAt = (msgAt: number, readySince: number | null, now: number, state: MessageFacts['state'] = 'recorded'): Buildable<boolean> =>
    readinessFactsOf(readings({ unsettled: { kind: 'measured', value: [msg(msgAt, state)] } },
      { stored: { ok: true, value: readySince === null ? 'none' : row({ readySince }) } }), now).deaf;
  it('runs from readySince when that is later than the message\'s arrival: not deaf at 119999 ms, deaf at 120000', () => {
    expect(deafAt(500, 10_000, 10_000 + READINESS_DEAF_MS - 1)).toEqual(m(false));
    expect(deafAt(500, 10_000, 10_000 + READINESS_DEAF_MS)).toEqual(m(true));
  });
  it('runs from the message\'s arrival when that is later than readySince', () => {
    expect(deafAt(50_000, 10_000, 50_000 + READINESS_DEAF_MS - 1)).toEqual(m(false));
    expect(deafAt(50_000, 10_000, 50_000 + READINESS_DEAF_MS)).toEqual(m(true));
  });
  it('readySince null (never ready, or no stored row) reads no message deaf', () => {
    expect(deafAt(1, null, NOW)).toEqual(m(false));
  });
  it('a ready row of another session starts no clock for the current subject (F10): a never-ready new Overlord is not deaf on its predecessor\'s clock', () => {
    const waiting = { unsettled: { kind: 'measured' as const, value: [msg(500, 'recorded')] } };
    const at = (readySessionId: string | null): Buildable<boolean> =>
      readinessFactsOf(readings(waiting, { stored: { ok: true, value: row({ readySince: 10_000, readySessionId }) } }), 10_000 + READINESS_DEAF_MS).deaf;
    expect(at(ME)).toEqual(m(true));
    expect(at('cc-overlord-b')).toEqual(m(false));
    expect(at(null)).toEqual(m(false));
  });
  it('a picked-up or settled message is not waiting', () => {
    expect(deafAt(1, 1, NOW, 'picked-up')).toEqual(m(false));
    expect(deafAt(1, 1, NOW, 'settled')).toEqual(m(false));
    expect(deafAt(1, 1, NOW, 'delivered')).toEqual(m(true));
    expect(deafAt(1, 1, NOW, 'queued')).toEqual(m(true));
  });
  it('a message state this build does not know reads unmeasured, and so does an unreadable inbox or stored row', () => {
    expect(deafAt(1, 1, NOW, 'unknown').kind).toBe('unmeasured');
    expect(readinessFactsOf(readings({ unsettled: { kind: 'unmeasured', why: 'db' } }), NOW).deaf.kind).toBe('unmeasured');
    expect(readinessFactsOf(readings({}, { stored: { ok: false, detail: 'db' } }), NOW).deaf.kind).toBe('unmeasured');
  });
  it('W1 passes not-built for exactly the held-rows half and the saturation fact', () => {
    const f = readinessFactsOf(readings({}), NOW);
    expect([f.heldDeaf, f.saturated]).toEqual([NB, NB]);
  });
  it('leftReadyAt comes from the stored row', () => {
    expect(readinessFactsOf(readings({}, { stored: { ok: true, value: row({ leftReadyAt: 3_333 }) } }), NOW).leftReadyAt).toBe(3_333);
    expect(readinessFactsOf(readings({}), NOW).leftReadyAt).toBeNull();
  });
});

describe('wedged and the dialog, through readinessFactsOf', () => {
  const wedged = (s: Partial<SubjectReadings>): Fact<boolean> => readinessFactsOf(readings(s), NOW).wedged;
  it('an absent turn marker is not wedged', () => {
    expect(wedged({ turnMark: ABSENT_MARK })).toEqual(m(false));
  });
  it('a working turn is wedged only when over ten minutes old', () => {
    expect(wedged({ turnMark: markOf({ state: 'working', turnAt: NOW - READINESS_LONG_TURN_MS }) })).toEqual(m(false));
    expect(wedged({ turnMark: markOf({ state: 'working', turnAt: NOW - READINESS_LONG_TURN_MS - 1 }) })).toEqual(m(true));
  });
  it('working with no hook event for over five minutes is wedged', () => {
    expect(wedged({ hookState: hookOf('working', NOW - READINESS_HOOK_QUIET_MS) })).toEqual(m(false));
    expect(wedged({ hookState: hookOf('working', NOW - READINESS_HOOK_QUIET_MS - 1) })).toEqual(m(true));
    expect(wedged({ hookState: hookOf('waiting', 1) })).toEqual(m(false));
  });
  it('an unreadable marker is unmeasured, but no hook state is not', () => {
    expect(wedged({ turnMark: { ok: false, reason: 'malformed' } }).kind).toBe('unmeasured');
    expect(wedged({ hookState: { ok: false, reason: 'unmeasured' } }).kind).toBe('unmeasured');
    expect(wedged({ hookState: NO_HOOK })).toEqual(m(false));
  });
  it('a dialog stands open from 30 s: the lane\'s first sighting is carried, and the decider counts the 30 s', () => {
    expect(readinessFactsOf(readings({ dialogSince: NOW - 5 }), NOW).dialogSince).toBe(NOW - 5);
    const open = (ago: number): ReadinessWord => wordOf(readings({ dialogSince: NOW - ago }, {}));
    expect(open(READINESS_DIALOG_MS - 1)).not.toBe('dialog-open');
    expect(open(READINESS_DIALOG_MS)).toBe('dialog-open');
  });
});

describe('the strand cause (C57, F7)', () => {
  const stranded = (s: Partial<SubjectReadings>): Fact<StrandCause | null> => readinessFactsOf(readings(s), NOW).stranded;
  const cand = (id: string, serves: 'yes' | 'at-ceiling' | 'unmeasured') => ({ id, limits: undefined, serves });
  const list = (...c: ReturnType<typeof cand>[]): SubjectReadings['candidates'] => ({ kind: 'candidates', list: c });
  it('an empty candidate list strands set-admits-none', () => {
    expect(stranded({ candidates: list() })).toEqual(m('set-admits-none'));
  });
  it('every candidate at its ceiling strands limited', () => {
    expect(stranded({ candidates: list(cand('lane-a', 'at-ceiling'), cand('lane-b', 'at-ceiling')) })).toEqual(m('limited'));
  });
  it('none yes and every one exhausted (resets kind at) strands limited', () => {
    const at = { kind: 'at', atS: 100 } as const;
    expect(stranded({ candidates: list(cand('lane-a', 'unmeasured'), cand('lane-b', 'at-ceiling')), resets: { ok: true, value: { 'lane-a': at, 'lane-b': at } } }))
      .toEqual(m('limited'));
  });
  it('one candidate yes strands nothing, whatever the others', () => {
    const at = { kind: 'at', atS: 100 } as const;
    expect(stranded({ candidates: list(cand('lane-a', 'yes'), cand('lane-b', 'at-ceiling')), resets: { ok: true, value: { 'lane-a': at, 'lane-b': at } } }))
      .toEqual(m(null));
  });
  it('none yes, one not exhausted, one unmeasured: unmeasured, never limited', () => {
    const f = stranded({ candidates: list(cand('lane-a', 'unmeasured'), cand('lane-b', 'at-ceiling')),
      resets: { ok: true, value: { 'lane-a': { kind: 'none-exhausted' }, 'lane-b': { kind: 'at', atS: 1 } } } });
    expect(f.kind).toBe('unmeasured');
  });
  it('a failed resets read with none yes is unmeasured', () => {
    expect(stranded({ candidates: list(cand('lane-a', 'unmeasured')), resets: { ok: false, detail: 'x' } }).kind).toBe('unmeasured');
  });
  it('unmeasured candidates, with no other cause, are unmeasured', () => {
    expect(stranded({ candidates: { kind: 'unmeasured', why: 'designation-unreadable' } }).kind).toBe('unmeasured');
  });
  it('a blocked swap strands swap-blocked', () => {
    expect(stranded({ swapBlocked: { at: 1, reason: 'x' } })).toEqual(m('swap-blocked'));
  });
  it('a failed turn strands turn-failed exactly for the owner\'s account class, whatever tokens that class holds (call 1319)', () => {
    const classes = STOP_FAILURE_ERRORS as Readonly<Record<string, string>>;
    const account = Object.keys(classes).filter((e) => classes[e] === 'account');
    expect(account.length, 'CONTROL: the owner has account tokens').toBeGreaterThan(0);
    for (const err of Object.keys(classes)) {
      expect([err, stranded({ turnMark: markOf({ state: 'failed', err }) })]).toEqual([err, m(classes[err] === 'account' ? 'turn-failed' : null)]);
    }
    expect(stranded({ turnMark: markOf({ state: 'done', err: 'rate_limit' }) })).toEqual(m(null));
  });
  it('a failed turn whose token the classifier cannot name is neither a failure nor a pass: unmeasured at the stranded row', () => {
    for (const err of ['a_token_from_a_later_build', null]) {
      const got = stranded({ turnMark: markOf({ state: 'failed', err }) });
      expect(got.kind).toBe('unmeasured');
    }
    // It never raises the word: through the decider, an otherwise-ready Overlord reads unmeasured, at the stranded row.
    const word = overlordReadiness(readinessFactsOf(readings({ turnMark: markOf({ state: 'failed', err: 'a_token_from_a_later_build' }) }), NOW), NOW);
    expect([word.word, word.why]).toEqual(['unmeasured', 'stranded: turn-failed token unclassified unread']);
    // A measured cause still wins over the unclassified token.
    expect(stranded({ swapBlocked: { at: 1, reason: 'x' }, turnMark: markOf({ state: 'failed', err: 'a_token_from_a_later_build' }) })).toEqual(m('swap-blocked'));
  });
  it('a marked strand with no other cause strands unread; an unreadable strand marker is unmeasured', () => {
    expect(stranded({ strand: { kind: 'marked', reason: 'ccd words' } })).toEqual(m('unread'));
    expect(stranded({ strand: { kind: 'unreadable' } }).kind).toBe('unmeasured');
    expect(stranded({ strand: { kind: 'no-record' } }).kind).toBe('unmeasured');
  });
  it('the order of causes is set-admits-none, limited, swap-blocked, turn-failed, unread', () => {
    const all = {
      candidates: list(), swapBlocked: { at: 1, reason: 'x' }, turnMark: markOf({ state: 'failed', err: 'rate_limit' }),
      strand: { kind: 'marked', reason: 'r' } as const,
    };
    expect(stranded(all)).toEqual(m('set-admits-none'));
    expect(stranded({ ...all, candidates: list(cand('lane-a', 'at-ceiling')) })).toEqual(m('limited'));
    expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')) })).toEqual(m('swap-blocked'));
    expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')), swapBlocked: null })).toEqual(m('turn-failed'));
    expect(stranded({ ...all, candidates: list(cand('lane-a', 'yes')), swapBlocked: null, turnMark: ABSENT_MARK })).toEqual(m('unread'));
  });
  it('a stranded Overlord reads stranded with its cause through the decider', () => {
    const a = overlordReadiness(readinessFactsOf(readings({ candidates: list() }), NOW), NOW);
    expect([a.word, a.strandCause]).toEqual(['stranded', 'set-admits-none']);
  });
});

describe('the brakes and the registry, through readinessFactsOf', () => {
  it('mail-disabled reads off without a subject, and the rung off reads off for a subject', () => {
    expect(wordOf(readings(null, { mailDisabled: 'set', designation: { kind: 'not-designated', row: null } }))).toBe('absent');
    expect(wordOf(readings({}, { mailDisabled: 'set' }))).toBe('off');
    expect(wordOf(readings({ ladder: { kind: 'read', operatorRung: 'off' } }))).toBe('off');
  });
  it('an unreadable ladder, an unreadable listing and a boot or failed registry are unmeasured, and each is named', () => {
    const named = (r: ReadinessReadings): [ReadinessWord, string | null] => {
      const a = overlordReadiness(readinessFactsOf(r, NOW), NOW);
      return [a.word, a.why];
    };
    expect(named(readings({ ladder: { kind: 'unmeasured', why: 'db' } }))[0]).toBe('unmeasured');
    expect(named(readings({}, { mailDisabled: 'unmeasurable' }))[0]).toBe('unmeasured');
    expect(named(readings({}, { registry: 'boot' }))).toEqual(['unmeasured', 'boot']);
    expect(named(readings({}, { registry: 'failed' }))).toEqual(['unmeasured', 'registry']);
  });
});

describe('servedReadiness (F2)', () => {
  const stored = row({ word: 'ready', why: 'w', until: 9, strandCause: null, at: 1_234, restartable: true });
  const served = (lastPassMono: number | null, nowMono = 100_000, nowWall = 5_000_000): ReadinessWire =>
    servedReadiness(stored, { lastPassMono, nowMono, nowWall });
  it('before this process\'s first pass: unmeasured, boot, since now', () => {
    const w = served(null);
    expect([w.word, w.why, w.since, w.until, w.restartable, w.strandCause, w.questionsGo]).toEqual(['unmeasured', 'boot', 5_000_000, null, false, null, 'operator']);
  });
  it('a pass 30000 ms ago serves the stored word', () => {
    const w = served(100_000 - READINESS_FRESH_MS);
    expect([w.word, w.since, w.why, w.until]).toEqual(['ready', 1_234, 'w', 9]);
  });
  it('a pass 30001 ms ago is unmeasured, stale, since the moment the limit passed', () => {
    const w = served(100_000 - READINESS_FRESH_MS - 1);
    expect([w.word, w.why, w.since]).toEqual(['unmeasured', 'stale', 5_000_000 - 1]);
  });
  it('a fresh pass over no stored row is unmeasured, boot', () => {
    const w = servedReadiness('none', { lastPassMono: 99_999, nowMono: 100_000, nowWall: 7 });
    expect([w.word, w.why, w.since]).toEqual(['unmeasured', 'boot', 7]);
  });
  it('restartable is served only for dead', () => {
    const at = (word: ReadinessWord): boolean =>
      servedReadiness(row({ word, restartable: true }), { lastPassMono: 1, nowMono: 2, nowWall: 3 }).restartable;
    for (const w of READINESS_WORDS) expect([w, at(w)]).toEqual([w, w === 'dead']);
    expect(servedReadiness(row({ word: 'dead', restartable: false }), { lastPassMono: 1, nowMono: 2, nowWall: 3 }).restartable).toBe(false);
  });
  it('the strand cause and the until ride through', () => {
    const w = servedReadiness(row({ word: 'stranded', strandCause: 'limited', why: 'limited' }), { lastPassMono: 1, nowMono: 2, nowWall: 3 });
    expect([w.word, w.strandCause]).toEqual(['stranded', 'limited']);
  });
});

// ── What the operator is told ───────────────────────────────────────────────────────────────────────────────────────────

describe('readinessNotices', () => {
  const ans = (word: ReadinessWord, over: Partial<ReadinessAnswer> = {}): ReadinessAnswer =>
    ({ word, why: null, until: null, strandCause: null, restartable: false, ...over });
  const stranded = (cause: StrandCause): ReadinessAnswer => ans('stranded', { why: cause, strandCause: cause });
  const rec = (id: number, item: ReadinessItemRecord['item'], key: string, itemState: ReadinessItemRecord['itemState'] = 'open'): ReadinessItemRecord =>
    ({ id, item, key, itemId: 100 + id, raisedAt: 1, itemState });
  const notices = (word: ReadinessAnswer, over: Partial<NoticeInputs> = {}, written: Partial<NoticeInputs['written']> = {}): readonly ReadinessNotice[] =>
    readinessNotices({
      written: { answer: word, episodeFirst: false, rowId: 7, ...written }, records: [], count: m(2), holds: { kind: 'not-wired' }, ...over,
    });

  it('dead pushes only on the episode\'s first write, with the Restart control when the answer is restartable', () => {
    expect(notices(ans('dead', { restartable: true }), {}, { episodeFirst: true })).toEqual([{ kind: 'dead-push', rowId: 7, withRestart: true }]);
    expect(notices(ans('dead', { restartable: false }), {}, { episodeFirst: true })).toEqual([{ kind: 'dead-push', rowId: 7, withRestart: false }]);
    expect(notices(ans('dead', { restartable: true }), {}, { episodeFirst: false })).toEqual([]);
    expect(notices(ans('wedged'), {}, { episodeFirst: true })).toEqual([]);
  });
  it('absent settles every live record with the note retired and raises nothing', () => {
    const records = [rec(1, 'stranded', 'limited'), rec(2, 'count', 'count', 'checking'), rec(3, 'hold', 'lane-a')];
    const out = notices(ans('absent'), { records, count: m(1), holds: { kind: 'read', lanes: ['lane-b'] } });
    expect(out).toEqual([{ kind: 'settle', recordId: 1, note: 'retired' }, { kind: 'settle', recordId: 2, note: 'retired' },
      { kind: 'settle', recordId: 3, note: 'retired' }]);
  });
  it('a record whose item was dismissed, done or withdrawn is closed, never settled, and a missing item too', () => {
    for (const itemState of ['dismissed', 'done', 'withdrawn', 'missing'] as const) {
      const out = notices(ans('ready'), { records: [rec(1, 'stranded', 'limited', itemState)] });
      expect([itemState, out]).toEqual([itemState, [{ kind: 'close', recordId: 1 }]]);
    }
    expect(notices(ans('absent'), { records: [rec(1, 'count', 'count', 'done')] })).toEqual([{ kind: 'close', recordId: 1 }]);
  });
  it('a closed record\'s cause recurring raises a new item', () => {
    const out = notices(stranded('limited'), { records: [rec(1, 'stranded', 'limited', 'dismissed')] });
    expect(out).toEqual([{ kind: 'close', recordId: 1 }, { kind: 'raise', item: 'stranded', key: 'limited' }]);
  });
  it('stranded raises once per cause', () => {
    expect(notices(stranded('limited'))).toEqual([{ kind: 'raise', item: 'stranded', key: 'limited' }]);
    expect(notices(stranded('limited'), { records: [rec(1, 'stranded', 'limited')] })).toEqual([]);
  });
  it('stranded settles a record whose cause no longer holds, and raises the new cause', () => {
    const out = notices(stranded('turn-failed'), { records: [rec(1, 'stranded', 'limited')] });
    expect(out).toEqual([{ kind: 'settle', recordId: 1, note: 'cleared' }, { kind: 'raise', item: 'stranded', key: 'turn-failed' }]);
  });
  it('a word after stranded in the order settles every stranded record', () => {
    for (const w of ['dialog-open', 'wedged', 'deaf', 'saturated', 'unproved', 'ready'] as const) {
      expect([w, notices(ans(w), { records: [rec(1, 'stranded', 'limited')] })]).toEqual([w, [{ kind: 'settle', recordId: 1, note: 'cleared' }]]);
    }
  });
  it('an unmeasured word, and a word before stranded, settle nothing', () => {
    for (const w of ['unmeasured', 'off', 'dead', 'restarting', 'renewing', 'degraded'] as const) {
      expect([w, notices(ans(w), { records: [rec(1, 'stranded', 'limited')] })]).toEqual([w, []]);
    }
  });
  it('the count item is raised when the count is measured below two, and once', () => {
    expect(notices(ans('ready'), { count: m(1) })).toEqual([{ kind: 'raise', item: 'count', key: 'count' }]);
    expect(notices(ans('ready'), { count: m(0) })).toEqual([{ kind: 'raise', item: 'count', key: 'count' }]);
    expect(notices(ans('ready'), { count: m(1), records: [rec(1, 'count', 'count')] })).toEqual([]);
  });
  it('the count item is settled when the count reads two or more', () => {
    expect(notices(ans('ready'), { count: m(2), records: [rec(1, 'count', 'count')] })).toEqual([{ kind: 'settle', recordId: 1, note: 'cleared' }]);
  });
  it('under a set-admits-none strand the count item is not raised, and a standing one is settled', () => {
    expect(notices(stranded('set-admits-none'), { count: m(0) })).toEqual([{ kind: 'raise', item: 'stranded', key: 'set-admits-none' }]);
    expect(notices(stranded('set-admits-none'), { count: m(0), records: [rec(1, 'stranded', 'set-admits-none'), rec(2, 'count', 'count')] }))
      .toEqual([{ kind: 'settle', recordId: 2, note: 'cleared' }]);
  });
  it('the count item stands beside any other strand cause', () => {
    expect(notices(stranded('limited'), { count: m(1) })).toEqual([{ kind: 'raise', item: 'stranded', key: 'limited' }, { kind: 'raise', item: 'count', key: 'count' }]);
    expect(notices(stranded('limited'), { count: m(1), records: [rec(1, 'stranded', 'limited'), rec(2, 'count', 'count')] })).toEqual([]);
  });
  it('an unmeasured count raises nothing and settles nothing', () => {
    expect(notices(ans('ready'), { count: u('count: x'), records: [rec(1, 'count', 'count')] })).toEqual([]);
    expect(notices(ans('ready'), { count: u('count: x') })).toEqual([]);
  });
  it('holds not-wired and unmeasured raise and settle nothing', () => {
    const records = [rec(1, 'hold', 'lane-a')];
    expect(notices(ans('ready'), { records, holds: { kind: 'not-wired' } })).toEqual([]);
    expect(notices(ans('ready'), { records, holds: { kind: 'unmeasured' } })).toEqual([]);
  });
  it('holds read raises one item per held lane without a record, and settles a cleared lane\'s', () => {
    const out = notices(ans('ready'), { records: [rec(1, 'hold', 'lane-b'), rec(2, 'hold', 'lane-c')], holds: { kind: 'read', lanes: ['lane-a', 'lane-b'] } });
    expect(out).toEqual([{ kind: 'settle', recordId: 2, note: 'cleared' }, { kind: 'raise', item: 'hold', key: 'lane-a' }]);
  });
  it('the dead push and the items are independent: a dead word with a low count raises the count item too', () => {
    expect(notices(ans('dead'), { count: m(1) }, { episodeFirst: true })).toEqual([
      { kind: 'dead-push', rowId: 7, withRestart: false }, { kind: 'raise', item: 'count', key: 'count' }]);
  });
});

// ── The vocabulary ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('the vocabulary', () => {
  it('READINESS_WORDS are the plan\'s fourteen words, in its order', () => {
    expect([...READINESS_WORDS]).toEqual(['absent', 'off', 'unmeasured', 'dead', 'restarting', 'renewing', 'degraded', 'stranded', 'dialog-open',
      'wedged', 'deaf', 'saturated', 'unproved', 'ready']);
  });
  it('admitRank: ready 2, unproved 1, every other word 0', () => {
    expect(READINESS_WORDS.map((w) => [w, admitRank(w)])).toEqual(READINESS_WORDS.map((w) => [w, w === 'ready' ? 2 : w === 'unproved' ? 1 : 0]));
  });
  it('RESTART_OUTCOME_MAP covers every generation outcome, and its classification is pinned', () => {
    expect(Object.keys(RESTART_OUTCOME_MAP).sort()).toEqual([...GENERATION_OUTCOMES].sort());
    expect(RESTART_OUTCOME_MAP).toEqual({
      renewed: 'renewal', crashed: 'restart', swapped: 'restart', woken: 'restart', 'woken-elsewhere': 'restart', unmeasured: 'restart',
      cleared: 'clear', retired: 'retire',
    });
    expect([...RESTART_OUTCOMES].sort()).toEqual(['crashed', 'swapped', 'unmeasured', 'woken', 'woken-elsewhere']);
  });
  it('READINESS_RESTART_BOUND_MS is the unit\'s RestartSec in ms plus the measured 6.1 s', () => {
    const unit = readFileSync(path.join(ROOT, 'ccd/claude-session@.service'), 'utf8');
    const sec = /^RestartSec=(\d+)\s*$/m.exec(unit);
    expect(sec, 'the unit has no RestartSec= line').not.toBeNull();
    expect(READINESS_RESTART_BOUND_MS).toBe(Number(sec?.[1]) * 1000 + 6_100);
  });
  it('every strand cause is spelled, and the thresholds are the spec\'s', () => {
    expect([...STRAND_CAUSES].sort()).toEqual(['limited', 'projection', 'set-admits-none', 'set-unreadable', 'swap-blocked', 'turn-failed', 'unread']);
    expect([READINESS_RESTARTS_PER_HOUR, READINESS_DIALOG_MS, READINESS_LONG_TURN_MS, READINESS_HOOK_QUIET_MS, READINESS_DEAF_MS, READINESS_FRESH_MS])
      .toEqual([2, 30_000, 600_000, 300_000, 120_000, 30_000]);
  });
});
