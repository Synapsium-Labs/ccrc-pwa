// Overlord W2, forecasts B (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md, Task 6): the cases
// over `programmeHealth`, `healthFactsOf`, `criticalPath`, `healthChangeVerdict` (programmeHealth.ts) and `waveSpend`
// (programmeMeasures.ts), written once as functions of the module. `programme-health.test.ts` and
// `programme-measures.test.ts` run them against the real modules with 200 runs per property; the mutant sets below run
// them against each mutant with 20. Registered in mutation-floors.test.ts's MUTANT_SETS, a floor each in
// mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import {
  HEALTH_BURN_FACTOR, HEALTH_BURN_MIN_WAVES, HEALTH_CHURN_REOPENS, HEALTH_CHURN_ROUNDS, HEALTH_OWN_CYCLE_MIN,
  HEALTH_SCOPE_GROWTH_WAVES, HEALTH_SLIP_DAYS, HEALTH_STALLED_HOURS, HEALTH_WINDOW_DAYS, PROGRAMME_HEALTH_WORDS,
  type Forecast, type HealthRow, type ProgrammeEdge, type ProgrammeHealthWord, type RemainingStatement, type RunSpendRow,
  type SealOutcome, type SealedForecast,
} from '../../../shared/programmeFacts.js';
import type { PortfolioEntry, PortfolioRun } from '../../../shared/portfolio.js';
import type * as Health from '../../src/coord/programmeHealth.js';
import type { HealthExtras, HealthFacts } from '../../src/coord/programmeHealth.js';
import type * as Measures from '../../src/coord/programmeMeasures.js';
import type * as Lane from '../../src/coord/forecastLane.js';
import type { TurnMarkRead } from '../../src/coord/stall.js';
import type * as Usage from '../../src/usage.js';
import { mulberry32 } from '../fakeTime.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const HEALTH_TS = path.resolve(here, '../../src/coord/programmeHealth.ts');
const MEASURES_TS = path.resolve(here, '../../src/coord/programmeMeasures.ts');
const USAGE_TS = path.resolve(here, '../../src/usage.ts');
const FORECAST_LANE_TS = path.resolve(here, '../../src/coord/forecastLane.ts');
export const PROGRAMME_HEALTH_KEY = 'server/src/coord/programmeHealth.ts#programmeHealth';
export const HEALTH_FACTS_KEY = 'server/src/coord/programmeHealth.ts#healthFactsOf';
export const CRITICAL_PATH_KEY = 'server/src/coord/programmeHealth.ts#criticalPath';
export const HEALTH_CHANGE_KEY = 'server/src/coord/programmeHealth.ts#healthChangeVerdict';
export const WAVE_SPEND_KEY = 'server/src/coord/programmeMeasures.ts#waveSpend';
export const WAVES_KEY = 'server/src/coord/programmeMeasures.ts#wavesOf';
export const RUN_SPEND_VERDICT_KEY = 'server/src/coord/programmeMeasures.ts#runSpendVerdict';
export const SPEND_TURNS_KEY = 'server/src/usage.ts#readSpendTurns';
export const SPEND_READING_KEY = 'server/src/coord/forecastLane.ts#spendReadingOf';

export type HealthModule = Pick<typeof Health, 'programmeHealth' | 'healthFactsOf' | 'criticalPath' | 'healthChangeVerdict'>;
export type MeasuresModule = Pick<typeof Measures, 'waveSpend' | 'wavesOf' | 'bucketOf' | 'isOpenRun' | 'closedIn' | 'doneCycles' | 'runSpendVerdict'>;
export type UsageModule = Pick<typeof Usage, 'readSpendTurns'>;
export type SpendReadingModule = Pick<typeof Lane, 'spendReadingOf'>;
export interface Case<M> { name: string; run: (m: M) => void }

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const NOW = 1_790_000_000_000;
const WINDOW = HEALTH_WINDOW_DAYS * DAY;
const rank = (w: ProgrammeHealthWord): number => PROGRAMME_HEALTH_WORDS.indexOf(w);

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const STEADY: HealthFacts = {
  blockingItems: 0, blockingAsks: 0, asksUnmeasured: 0, blockingEdges: null, cls: 'standard', fixedDate: null,
  newestP85At: null, previousP85At: null, newestScoredMissed: null, wip: 0, lastMoveAt: null, oldestOpenMs: null,
  oldestOpenUnmeasured: 0, referenceCycleP85Ms: null, roundsPerWave: null, reworkedWaves: 0, scope: null,
  spendRecent: null, spendEarlier: null,
};
const facts = (o: Partial<HealthFacts>): HealthFacts => ({ ...STEADY, ...o });

const entry = (o: Partial<PortfolioEntry> = {}): PortfolioEntry => ({
  slug: 'prog-a', title: 'A', rank: null, cls: 'standard', wip: { working: 0, waiting: 0, queued: 0 },
  closedWaves: { days7: 0, days28: 0 }, cycle: { n: 0, medianMs: null, p85Ms: null }, cycleUnmeasured: 0, oldestOpenMs: null,
  oldestOpenUnmeasured: 0, reviewRounds: { rounds: 0, waves: 0 }, ended28: { done: 0, failed: 0, neverStarted: 0 },
  waitingOnOperatorMs28: 0, itemsUnmeasured: 0, asksUnmeasured: 0, blocking: { items: [], asks: 0 }, ...o,
});
const extras = (o: Partial<HealthExtras> = {}): HealthExtras => ({
  runs: [], seals: [], statements: [], lastMoveAt: null, fleetCycleP85Ms: null, spend: new Map(), edges: [],
  shownItemIds: new Set(), clearingShipped: false, ...o,
});
const run = (o: Partial<PortfolioRun> & { id: number }): PortfolioRun => ({
  program: 'prog-a', wave: o.id, kind: 'work', reviews: null, state: 'done', openedAt: NOW - 90 * DAY, dispatchedAt: NOW - 90 * DAY,
  closedAt: NOW - DAY, closeDetail: null, ...o,
});
const forecast = (p85At: number): Forecast => ({ kind: 'forecast', medianAt: p85At - DAY, p85At, n: 20, source: 'own', seed: 1 });
const seal = (id: number, f: Forecast | 'unreadable', outcome: SealOutcome | 'unreadable' = 'open'): SealedForecast => ({
  id, program: 'prog-a', closingRunId: id, sealedAt: NOW - 30 * DAY + id, asOf: NOW - 30 * DAY + id, statementId: null, lo: null, hi: null,
  forecast: f, outcome, scoredAt: outcome === 'open' ? null : NOW - DAY,
});
const stmt = (id: number, at: number, lo: number, hi: number): RemainingStatement =>
  ({ id, program: 'prog-a', at, byId: 'lane-a-project-a', runId: null, lo, hi, reason: 'r' });
const edge = (o: Partial<ProgrammeEdge> & { id: number }): ProgrammeEdge => ({
  program: 'prog-a', kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: 7 }, why: 'w', state: 'open',
  openedAt: NOW - DAY, openedBy: 'lane-a-project-a', endedAt: null, evidence: null, unmeasuredSince: null, ...o,
});
const spendRow = (runId: number, cost: number | null, state: RunSpendRow['state'] = 'measured'): RunSpendRow =>
  ({ runId, at: NOW, state, cost, class: null, readAt: NOW });
const healthRow = (word: HealthRow['word']): HealthRow => ({ id: 1, program: 'prog-a', at: NOW - DAY, word, evidence: 'unreadable' });

const word = (m: HealthModule, f: HealthFacts): ProgrammeHealthWord => m.programmeHealth(f, NOW).word;

// ── programmeHealth ─────────────────────────────────────────────────────────────────────────────────────────────────

/** One fault per row, each matching that row alone on a steady base. */
const FAULTS: readonly { word: ProgrammeHealthWord; arm: string; apply: (f: HealthFacts) => HealthFacts }[] = [
  { word: 'blocked-on-you', arm: 'items', apply: (f) => ({ ...f, blockingItems: 1 }) },
  { word: 'slipping', arm: 'missed', apply: (f) => ({ ...f, newestScoredMissed: true }) },
  { word: 'stalled', arm: 'quiet', apply: (f) => ({ ...f, wip: 1, lastMoveAt: NOW - HEALTH_STALLED_HOURS * HOUR }) },
  { word: 'aging', arm: 'oldest', apply: (f) => ({ ...f, oldestOpenMs: 11, referenceCycleP85Ms: 10 }) },
  { word: 'churning', arm: 'reworked', apply: (f) => ({ ...f, reworkedWaves: HEALTH_CHURN_REOPENS + 1 }) },
  { word: 'scope-growing', arm: 'grew', apply: (f) => ({ ...f, scope: { oldestHi: 3, newestHi: 3 + HEALTH_SCOPE_GROWTH_WAVES, doneSince: 0 } }) },
  { word: 'burning', arm: 'spend', apply: (f) => ({ ...f, spendRecent: 20, spendEarlier: 10 }) },
];

const MEASURED_FIELDS = ['newestP85At', 'previousP85At', 'newestScoredMissed', 'lastMoveAt', 'spendRecent', 'spendEarlier'] as const;

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
/** A facts value over each input's range with its boundary values, each Measured one also 'unmeasured'. */
function genFacts(r: () => number): HealthFacts {
  const cls = pick(r, ['standard', 'fixed-date', 'expedite', 'background'] as const);
  const lastMoveAt = pick(r, [null, 'unmeasured' as const, NOW - HEALTH_STALLED_HOURS * HOUR, NOW - HEALTH_STALLED_HOURS * HOUR + 1, NOW - HOUR, NOW - 90 * DAY]);
  const p85 = (): number | null | 'unmeasured' => pick(r, [null, 'unmeasured' as const, NOW, NOW + 3 * DAY, NOW + 20 * DAY, Date.UTC(2026, 10, 20, 23, 59, 59, 999), Date.UTC(2026, 10, 21)]);
  const spend = (): number | null | 'unmeasured' => pick(r, [null, 'unmeasured' as const, 0, 5, 10, 20, 21]);
  return {
    blockingItems: pick(r, [0, 0, 0, 1, 2]), blockingAsks: pick(r, [0, 0, 0, 1]), asksUnmeasured: pick(r, [0, 0, 1]),
    blockingEdges: pick(r, [null, null, 0, 1]), cls, fixedDate: cls === 'fixed-date' ? pick(r, ['2026-11-20', null]) : null,
    newestP85At: p85(), previousP85At: p85(), newestScoredMissed: pick(r, [null, false, false, true, 'unmeasured' as const]),
    wip: pick(r, [0, 1, 3]), lastMoveAt, oldestOpenMs: pick(r, [null, 5, 10, 11]), oldestOpenUnmeasured: pick(r, [0, 0, 1]),
    referenceCycleP85Ms: pick(r, [null, 10]), roundsPerWave: pick(r, [null, 1, HEALTH_CHURN_ROUNDS, HEALTH_CHURN_ROUNDS + 0.01]),
    reworkedWaves: pick(r, [0, 1, HEALTH_CHURN_REOPENS, HEALTH_CHURN_REOPENS + 1]),
    scope: pick(r, [null, { oldestHi: 3, newestHi: 4, doneSince: 0 }, { oldestHi: 3, newestHi: 3 + HEALTH_SCOPE_GROWTH_WAVES, doneSince: 0 },
      { oldestHi: 3, newestHi: 2, doneSince: HEALTH_SCOPE_GROWTH_WAVES }]),
    spendRecent: spend(), spendEarlier: spend(),
  };
}

export function healthCases(runs: number): Case<HealthModule>[] {
  const cases: Case<HealthModule>[] = [];
  const add = (name: string, fn: (m: HealthModule) => void): void => { cases.push({ name, run: fn }); };

  add('programmeHealth: a steady fact answers steady, with no arm and nothing unmeasured', (m) => {
    expect(m.programmeHealth(STEADY, NOW)).toEqual({ word: 'steady', evidence: { matched: null, values: {}, unmeasured: [] } });
  });
  for (const f of FAULTS) {
    add(`programmeHealth: ${f.word} matches on its fault alone, naming the ${f.arm} arm`, (m) => {
      const v = m.programmeHealth(f.apply(STEADY), NOW);
      expect(v.word).toBe(f.word);
      expect(v.evidence.matched).toBe(`${f.word}:${f.arm}`);
      expect(v.evidence.unmeasured).toEqual([]);
    });
  }
  add('programmeHealth: blocked-on-you has three arms, and an unmeasured count of asks joins unmeasured only when none matched', (m) => {
    expect(m.programmeHealth(facts({ blockingAsks: 1 }), NOW).evidence.matched).toBe('blocked-on-you:asks');
    expect(m.programmeHealth(facts({ blockingEdges: 2 }), NOW).evidence.matched).toBe('blocked-on-you:edges');
    expect(m.programmeHealth(facts({ blockingEdges: 0 }), NOW).word).toBe('steady');
    expect(m.programmeHealth(facts({ asksUnmeasured: 2 }), NOW)).toEqual({ word: 'steady', evidence: { matched: null, values: {}, unmeasured: ['asks'] } });
    expect(m.programmeHealth(facts({ asksUnmeasured: 2, blockingItems: 1 }), NOW).evidence.unmeasured).toEqual([]);
  });
  add('programmeHealth: aging with an unmeasured oldest open wave names oldestOpen, unless it matched', (m) => {
    const v = m.programmeHealth(facts({ oldestOpenUnmeasured: 1 }), NOW);
    expect(v.evidence.unmeasured).toEqual(['oldestOpen']);
    expect(m.programmeHealth(facts({ oldestOpenUnmeasured: 1, oldestOpenMs: 11, referenceCycleP85Ms: 10 }), NOW).evidence.unmeasured).toEqual([]);
    expect(word(m, facts({ oldestOpenMs: 11, referenceCycleP85Ms: null }))).toBe('steady');
    expect(word(m, facts({ oldestOpenMs: 10, referenceCycleP85Ms: 10 }))).toBe('steady');
  });
  add('programmeHealth: row order, slipping before stalled and every row before a later one', (m) => {
    const both = facts({ newestScoredMissed: true, wip: 1, lastMoveAt: NOW - 100 * DAY });
    expect(word(m, both)).toBe('slipping');
    expect(word(m, facts({ blockingItems: 1, newestScoredMissed: true }))).toBe('blocked-on-you');
    expect(word(m, facts({ wip: 1, lastMoveAt: NOW - 100 * DAY, oldestOpenMs: 11, referenceCycleP85Ms: 10 }))).toBe('stalled');
  });
  add('programmeHealth: stalled at its limit, both sides, and with no work in progress or no move', (m) => {
    const at = (age: number, wip = 1) => word(m, facts({ wip, lastMoveAt: NOW - age }));
    expect(at(HEALTH_STALLED_HOURS * HOUR)).toBe('stalled');
    expect(at(HEALTH_STALLED_HOURS * HOUR - 1)).toBe('steady');
    expect(at(HEALTH_STALLED_HOURS * HOUR, 0)).toBe('steady');
    expect(word(m, facts({ wip: 1, lastMoveAt: null }))).toBe('steady');
  });
  add('programmeHealth: churn at exactly the rounds limit is not churning; above is', (m) => {
    expect(word(m, facts({ roundsPerWave: HEALTH_CHURN_ROUNDS }))).toBe('steady');
    expect(word(m, facts({ roundsPerWave: HEALTH_CHURN_ROUNDS + 0.01 }))).toBe('churning');
    expect(m.programmeHealth(facts({ roundsPerWave: 3 }), NOW).evidence.matched).toBe('churning:rounds');
    expect(word(m, facts({ reworkedWaves: HEALTH_CHURN_REOPENS }))).toBe('steady');
    expect(word(m, facts({ reworkedWaves: HEALTH_CHURN_REOPENS + 1 }))).toBe('churning');
  });
  add('programmeHealth: scope-growing at its limit, both sides, counting waves done since', (m) => {
    const sc = (newestHi: number, doneSince: number) => word(m, facts({ scope: { oldestHi: 3, newestHi, doneSince } }));
    expect(sc(3 + HEALTH_SCOPE_GROWTH_WAVES, 0)).toBe('scope-growing');
    expect(sc(3 + HEALTH_SCOPE_GROWTH_WAVES - 1, 0)).toBe('steady');
    expect(sc(1, HEALTH_SCOPE_GROWTH_WAVES + 2)).toBe('scope-growing');
    expect(sc(1, HEALTH_SCOPE_GROWTH_WAVES + 1)).toBe('steady');
  });
  add('programmeHealth: burning at its factor, both sides, and never from a zero recent spend', (m) => {
    expect(word(m, facts({ spendRecent: HEALTH_BURN_FACTOR * 10, spendEarlier: 10 }))).toBe('burning');
    expect(word(m, facts({ spendRecent: HEALTH_BURN_FACTOR * 10 - 1, spendEarlier: 10 }))).toBe('steady');
    expect(word(m, facts({ spendRecent: 0, spendEarlier: 0 }))).toBe('steady');
    expect(word(m, facts({ spendRecent: 5, spendEarlier: null }))).toBe('steady');
  });
  add('programmeHealth: slipping by the moved arm at its limit, both sides', (m) => {
    const mv = (d: number) => word(m, facts({ previousP85At: NOW, newestP85At: NOW + d }));
    expect(mv(HEALTH_SLIP_DAYS * DAY)).toBe('slipping');
    expect(mv(HEALTH_SLIP_DAYS * DAY - 1)).toBe('steady');
    expect(m.programmeHealth(facts({ previousP85At: NOW, newestP85At: NOW + 8 * DAY }), NOW).evidence.matched).toBe('slipping:moved');
  });
  add('programmeHealth: an unmeasured previous 85% date is not read as zero, and is named', (m) => {
    const v = m.programmeHealth(facts({ previousP85At: 'unmeasured', newestP85At: NOW }), NOW);
    expect(v.word).toBe('steady');
    expect(v.evidence.unmeasured).toEqual(['previousP85At']);
    // No previous seal at all is measured and nothing: null, which is no move either.
    expect(m.programmeHealth(facts({ previousP85At: null, newestP85At: NOW }), NOW)).toMatchObject({ word: 'steady', evidence: { unmeasured: [] } });
  });
  add('programmeHealth: the fixed-date arm, an 85% date at 23:00 UTC of the fixed day is not slipping, one ms after its end is', (m) => {
    const endOfDay = Date.UTC(2026, 10, 20, 23, 59, 59, 999);
    const fd = (p: number, over: Partial<HealthFacts> = {}) => m.programmeHealth(facts({ cls: 'fixed-date', fixedDate: '2026-11-20', newestP85At: p, ...over }), NOW);
    expect(fd(Date.UTC(2026, 10, 20, 23)).word).toBe('steady');
    expect(fd(endOfDay).word).toBe('steady');
    expect(fd(endOfDay + 1).word).toBe('slipping');
    expect(fd(endOfDay + 1).evidence.matched).toBe('slipping:fixed-date');
    expect(fd(endOfDay + 1, { cls: 'standard' }).word).toBe('steady');
    expect(fd(endOfDay + 1, { fixedDate: null }).word).toBe('steady');
    expect(fd(endOfDay + 1, { newestP85At: 'unmeasured' }).evidence.unmeasured).toEqual(['newestP85At']);
  });
  add('programmeHealth: an unmeasured input never matches its arm and every unmeasured input is named, sorted', (m) => {
    const v = m.programmeHealth(facts({ blockingItems: 1, newestScoredMissed: 'unmeasured', lastMoveAt: 'unmeasured', wip: 1, spendRecent: 'unmeasured', spendEarlier: 4 }), NOW);
    expect(v.word).toBe('blocked-on-you');
    expect(v.evidence.unmeasured).toEqual(['lastMoveAt', 'newestScoredMissed', 'spendRecent']);
  });

  add(`properties: total and ordered, over ${runs} generated facts and every subset of the seven faults`, (m) => {
    const r = mulberry32(8101);
    for (let i = 0; i < runs; i++) {
      const g = genFacts(r);
      const v = m.programmeHealth(g, NOW);
      expect(PROGRAMME_HEALTH_WORDS).toContain(v.word);
      expect(v.evidence.matched === null).toBe(v.word === 'steady');
      if (v.evidence.matched !== null) expect(v.evidence.matched.startsWith(`${v.word}:`)).toBe(true);
      expect([...v.evidence.unmeasured]).toEqual([...new Set(v.evidence.unmeasured)].sort());
      // Every unmeasured Measured input is named, whatever the word.
      for (const k of MEASURED_FIELDS) if (g[k] === 'unmeasured') expect(v.evidence.unmeasured).toContain(k);
    }
    for (let mask = 1; mask < 1 << FAULTS.length; mask++) {
      let f = STEADY;
      let first = FAULTS.length;
      FAULTS.forEach((x, k) => { if (mask & (1 << k)) { f = x.apply(f); first = Math.min(first, k); } });
      expect(word(m, f)).toBe(FAULTS[first]!.word);
    }
  });
  add(`properties: adding a fault never yields a better word, over ${runs} generated facts`, (m) => {
    const r = mulberry32(8102);
    const faults: ((f: HealthFacts) => HealthFacts)[] = [
      (f) => ({ ...f, blockingItems: f.blockingItems + 1 }),
      (f) => ({ ...f, blockingAsks: f.blockingAsks + 1 }),
      (f) => ({ ...f, newestP85At: typeof f.newestP85At === 'number' ? f.newestP85At + 3 * DAY : f.newestP85At }),
      (f) => ({ ...f, lastMoveAt: typeof f.lastMoveAt === 'number' ? f.lastMoveAt - 3 * DAY : f.lastMoveAt }),
      (f) => ({ ...f, newestScoredMissed: f.newestScoredMissed === 'unmeasured' ? f.newestScoredMissed : true }),
      (f) => ({ ...f, reworkedWaves: f.reworkedWaves + 1 }),
      (f) => ({ ...f, spendRecent: typeof f.spendRecent === 'number' ? f.spendRecent * 2 + 1 : f.spendRecent }),
      // Review 2458 N3: the other inputs too.
      (f) => ({ ...f, blockingEdges: f.blockingEdges === null ? null : f.blockingEdges + 1 }),
      (f) => ({ ...f, wip: f.wip + 1 }),
      (f) => ({ ...f, oldestOpenMs: f.oldestOpenMs === null ? null : f.oldestOpenMs + 5 }),
      (f) => ({ ...f, roundsPerWave: f.roundsPerWave === null ? null : f.roundsPerWave + 1 }),
      (f) => ({ ...f, scope: f.scope === null ? null : { ...f.scope, newestHi: f.scope.newestHi + 1 } }),
    ];
    for (let i = 0; i < runs; i++) {
      const g = genFacts(r);
      const worse = pick(r, faults)(g);
      expect(rank(word(m, worse)), JSON.stringify(g)).toBeLessThanOrEqual(rank(word(m, g)));
    }
  });
  add(`properties: an unmeasured input never yields a worse word and is named, over ${runs} generated facts`, (m) => {
    const r = mulberry32(8103);
    for (let i = 0; i < runs; i++) {
      const g = genFacts(r);
      const k = pick(r, MEASURED_FIELDS);
      if (g[k] === 'unmeasured') continue;
      const u = { ...g, [k]: 'unmeasured' } as HealthFacts;
      expect(rank(word(m, u)), `${k} ${JSON.stringify(g)}`).toBeGreaterThanOrEqual(rank(word(m, g)));
      expect(m.programmeHealth(u, NOW).evidence.unmeasured).toContain(k);
    }
  });
  add(`properties: an unmeasured count of asks or of open waves never yields a worse word, over ${runs} generated facts (N3)`, (m) => {
    const r = mulberry32(8104);
    for (let i = 0; i < runs; i++) {
      const g = genFacts(r);
      const u = pick(r, [{ ...g, asksUnmeasured: g.asksUnmeasured + 1 }, { ...g, oldestOpenUnmeasured: g.oldestOpenUnmeasured + 1 }]);
      expect(rank(word(m, u)), JSON.stringify(g)).toBeGreaterThanOrEqual(rank(word(m, g)));
    }
  });

  // ── healthFactsOf ─────────────────────────────────────────────────────────────────────────────────────────────────
  add('healthFactsOf: the entry carries over, and an empty programme measures nothing', (m) => {
    const f = m.healthFactsOf(entry({
      blocking: { items: [{ id: 1, title: 't' }, { id: 2, title: 'u' }], asks: 3 }, asksUnmeasured: 1, cls: 'fixed-date',
      rank: { position: 1, cls: 'fixed-date', fixedDate: '2026-12-01' }, wip: { working: 2, waiting: 1, queued: 4 },
      oldestOpenMs: 9, oldestOpenUnmeasured: 2,
    }), extras({ fleetCycleP85Ms: 77 }), NOW);
    expect(f).toEqual({
      blockingItems: 2, blockingAsks: 3, asksUnmeasured: 1, blockingEdges: null, cls: 'fixed-date', fixedDate: '2026-12-01',
      newestP85At: null, previousP85At: null, newestScoredMissed: null, wip: 3, lastMoveAt: null, oldestOpenMs: 9,
      oldestOpenUnmeasured: 2, referenceCycleP85Ms: 77, roundsPerWave: null, reworkedWaves: 0, scope: null,
      spendRecent: null, spendEarlier: null,
    });
  });
  add('healthFactsOf: blockingEdges is null while clearing is not shipped, and counts only open shown needs-decision edges after', (m) => {
    const edges = [
      edge({ id: 1 }),
      edge({ id: 2, target: { predicate: 'operator-confirms', itemId: 8 } }),
      edge({ id: 3, state: 'met' }),
      edge({ id: 4, kind: 'needs-landed', target: { predicate: 'run-closed', runId: 5 } }),
      edge({ id: 5, target: null, targetUnreadable: true }),
    ];
    const shown = new Set([7]);
    expect(m.healthFactsOf(entry(), extras({ edges, shownItemIds: shown, clearingShipped: false }), NOW).blockingEdges).toBeNull();
    expect(m.healthFactsOf(entry(), extras({ edges, shownItemIds: shown, clearingShipped: true }), NOW).blockingEdges).toBe(1);
    expect(m.healthFactsOf(entry(), extras({ edges, shownItemIds: new Set(), clearingShipped: true }), NOW).blockingEdges).toBe(0);
  });
  add('healthFactsOf: with clearing not shipped an open shown needs-decision edge does not block, and with it shipped it does', (m) => {
    const ex = (clearingShipped: boolean) => extras({ edges: [edge({ id: 1 })], shownItemIds: new Set([7]), clearingShipped });
    expect(word(m, m.healthFactsOf(entry(), ex(false), NOW))).toBe('steady');
    expect(word(m, m.healthFactsOf(entry(), ex(true), NOW))).toBe('blocked-on-you');
  });
  add('healthFactsOf: the newest and previous 85% dates; an unreadable seal, or one unforecastable for want of a remaining statement or history, unmeasured; nothing-left null (F9)', (m) => {
    const p = (seals: SealedForecast[]) => m.healthFactsOf(entry(), extras({ seals }), NOW);
    expect(p([seal(1, forecast(NOW + DAY)), seal(2, forecast(NOW + 5 * DAY))])).toMatchObject({ newestP85At: NOW + 5 * DAY, previousP85At: NOW + DAY });
    expect(p([seal(1, forecast(NOW + DAY))])).toMatchObject({ newestP85At: NOW + DAY, previousP85At: null });
    expect(p([seal(1, forecast(NOW + DAY)), seal(2, { kind: 'unforecastable', reason: 'no-remaining' })])).toMatchObject({ newestP85At: 'unmeasured', previousP85At: NOW + DAY });
    expect(p([seal(1, forecast(NOW + DAY)), seal(2, { kind: 'unforecastable', reason: 'too-little-history' })])).toMatchObject({ newestP85At: 'unmeasured', previousP85At: NOW + DAY });
    expect(p([seal(1, forecast(NOW + DAY)), seal(2, { kind: 'unforecastable', reason: 'nothing-left' })])).toMatchObject({ newestP85At: null, previousP85At: NOW + DAY });
    expect(p([seal(1, 'unreadable'), seal(2, forecast(NOW + DAY))])).toMatchObject({ newestP85At: NOW + DAY, previousP85At: 'unmeasured' });
    expect(p([seal(1, forecast(NOW + DAY)), seal(2, 'unreadable')])).toMatchObject({ newestP85At: 'unmeasured', previousP85At: NOW + DAY });
  });
  add('healthFactsOf: the moved arm compares with the last DATED seal, skipping unforecastable ones between (F9)', (m) => {
    const p = (seals: SealedForecast[]) => m.healthFactsOf(entry(), extras({ seals }), NOW);
    const between: Forecast = { kind: 'unforecastable', reason: 'too-little-history' };
    const f = p([seal(1, forecast(NOW + DAY)), seal(2, between), seal(3, forecast(NOW + 21 * DAY))]);
    expect(f).toMatchObject({ newestP85At: NOW + 21 * DAY, previousP85At: NOW + DAY });
    expect(m.programmeHealth(f, NOW).evidence.matched).toBe('slipping:moved');
    expect(p([seal(1, between), seal(2, forecast(NOW + DAY))])).toMatchObject({ previousP85At: null });
    expect(p([seal(1, 'unreadable'), seal(2, between), seal(3, forecast(NOW + DAY))])).toMatchObject({ previousP85At: 'unmeasured' });
  });
  add('healthFactsOf: a fixed-date programme whose newest seal could not be dated is never steady with nothing unmeasured (F9)', (m) => {
    const f = m.healthFactsOf(entry({ cls: 'fixed-date', rank: { position: 1, cls: 'fixed-date', fixedDate: '2026-12-01' } }),
      extras({ seals: [seal(1, { kind: 'unforecastable', reason: 'too-little-history' })] }), NOW);
    const v = m.programmeHealth(f, NOW);
    expect(v.evidence.unmeasured).toContain('newestP85At');
  });
  add('healthFactsOf: newestScoredMissed skips every open seal, an unforecastable one included, and reads the first scored', (m) => {
    const miss = (seals: SealedForecast[]) => m.healthFactsOf(entry(), extras({ seals }), NOW).newestScoredMissed;
    const unforecastable: Forecast = { kind: 'unforecastable', reason: 'too-little-history' };
    expect(miss([seal(1, forecast(NOW), 'missed'), seal(2, unforecastable), seal(3, forecast(NOW + DAY))])).toBe(true);
    expect(miss([seal(1, forecast(NOW), 'met'), seal(2, unforecastable)])).toBe(false);
    expect(miss([seal(1, forecast(NOW), 'missed'), seal(2, forecast(NOW), 'met')])).toBe(false);
    expect(miss([seal(1, forecast(NOW), 'met'), seal(2, forecast(NOW), 'missed')])).toBe(true);
    expect(miss([seal(1, forecast(NOW), 'met'), seal(2, forecast(NOW), 'unreadable')])).toBe('unmeasured');
    expect(miss([seal(1, forecast(NOW))])).toBeNull();
    expect(miss([])).toBeNull();
  });
  add('healthFactsOf: an open unforecastable newest seal gives newestP85At unmeasured (F9) and is skipped by newestScoredMissed', (m) => {
    const f = m.healthFactsOf(entry(), extras({ seals: [seal(1, forecast(NOW), 'missed'), seal(2, { kind: 'unforecastable', reason: 'no-remaining' })] }), NOW);
    expect(f.newestP85At).toBe('unmeasured');
    expect(f.newestScoredMissed).toBe(true);
  });
  add('healthFactsOf: the reference cycle is the programme\'s own from HEALTH_OWN_CYCLE_MIN done waves, else the fleet\'s', (m) => {
    const ref = (n: number) => m.healthFactsOf(entry({ cycle: { n, medianMs: 1, p85Ms: 5 } }), extras({ fleetCycleP85Ms: 99 }), NOW).referenceCycleP85Ms;
    expect(ref(HEALTH_OWN_CYCLE_MIN)).toBe(5);
    expect(ref(HEALTH_OWN_CYCLE_MIN - 1)).toBe(99);
    expect(m.healthFactsOf(entry(), extras({ fleetCycleP85Ms: null }), NOW).referenceCycleP85Ms).toBeNull();
  });
  add('healthFactsOf: a statement written after the last state change does not clear stalled; lastMoveAt is the extras\'', (m) => {
    const ex = extras({ lastMoveAt: NOW - 3 * DAY, statements: [stmt(1, NOW - HOUR, 1, 2)] });
    const f = m.healthFactsOf(entry({ wip: { working: 1, waiting: 0, queued: 0 } }), ex, NOW);
    expect(f.lastMoveAt).toBe(NOW - 3 * DAY);
    expect(word(m, f)).toBe('stalled');
  });
  add('healthFactsOf: review rounds per closed wave and reworked waves, over the window only', (m) => {
    const runs = [
      run({ id: 1, wave: 1, closedAt: NOW - DAY }), run({ id: 2, wave: 2, closedAt: NOW - 2 * DAY }),
      run({ id: 3, wave: 2, closedAt: NOW - DAY, state: 'done' }),
      run({ id: 4, wave: 3, closedAt: NOW - 40 * DAY }),
      run({ id: 11, kind: 'review', reviews: 1, wave: 1 }), run({ id: 12, kind: 'review', reviews: 2, wave: 2 }), run({ id: 13, kind: 'review', reviews: 2, wave: 2 }),
      run({ id: 14, kind: 'review', reviews: 4, wave: 3 }),
    ];
    const f = m.healthFactsOf(entry(), extras({ runs }), NOW);
    expect(f.roundsPerWave).toBe(1.5);
    expect(f.reworkedWaves).toBe(1);
    expect(m.healthFactsOf(entry(), extras({ runs: [run({ id: 4, closedAt: NOW - 40 * DAY })] }), NOW)).toMatchObject({ roundsPerWave: null, reworkedWaves: 0 });
  });
  add('healthFactsOf: exactly 2.0 rounds per wave reads as 2, and the window\'s edge is inclusive', (m) => {
    const runs = [run({ id: 1, closedAt: NOW - WINDOW }), run({ id: 11, kind: 'review', reviews: 1 }), run({ id: 12, kind: 'review', reviews: 1 })];
    expect(m.healthFactsOf(entry(), extras({ runs }), NOW).roundsPerWave).toBe(2);
    expect(word(m, m.healthFactsOf(entry(), extras({ runs }), NOW))).toBe('steady');
    expect(m.healthFactsOf(entry(), extras({ runs: [run({ id: 1, closedAt: NOW - WINDOW - 1 })] }), NOW).roundsPerWave).toBeNull();
  });
  add('healthFactsOf: the scope is the oldest and newest statements in the window, and the done waves between them', (m) => {
    const runs = [
      run({ id: 1, closedAt: NOW - 20 * DAY }), run({ id: 2, closedAt: NOW - 10 * DAY }), run({ id: 3, closedAt: NOW - 5 * DAY }),
      run({ id: 4, closedAt: NOW - 8 * DAY, state: 'failed' }), run({ id: 5, closedAt: NOW - 2 * DAY }),
      // One closed at the oldest statement's time is not since it; one at the newest's time is.
      run({ id: 6, closedAt: NOW - 12 * DAY }), run({ id: 7, closedAt: NOW - 6 * DAY }),
    ];
    const statements = [stmt(3, NOW - 6 * DAY, 2, 6), stmt(1, NOW - 12 * DAY, 3, 5), stmt(2, NOW - 29 * DAY, 9, 9), stmt(4, NOW - 6 * DAY, 4, 7)];
    // In the window: 12d (3,5), 6d (id 3: 2,6), 6d (id 4: 4,7): the newest by at, then id, is id 4.
    expect(m.healthFactsOf(entry(), extras({ runs, statements }), NOW).scope).toEqual({ oldestHi: 5, newestHi: 7, doneSince: 2 });
    expect(m.healthFactsOf(entry(), extras({ runs, statements: [] }), NOW).scope).toBeNull();
    expect(m.healthFactsOf(entry(), extras({ runs, statements: [stmt(1, NOW - 9 * DAY, 1, 4)] }), NOW).scope).toEqual({ oldestHi: 4, newestHi: 4, doneSince: 0 });
  });
  add('healthFactsOf: spend is the median per wave over each window from HEALTH_BURN_MIN_WAVES measured waves', (m) => {
    const wave = (id: number, ago: number) => run({ id, closedAt: NOW - ago });
    const recent = [wave(1, 2 * DAY), wave(2, 3 * DAY), wave(3, 4 * DAY)];
    const earlier = [wave(4, 30 * DAY), wave(5, 31 * DAY), wave(6, 32 * DAY)];
    const spend = new Map([1, 2, 3].map((id) => [id, spendRow(id, id * 10)] as const).concat([4, 5, 6].map((id) => [id, spendRow(id, 5)] as const)));
    const f = m.healthFactsOf(entry(), extras({ runs: [...recent, ...earlier], spend }), NOW);
    expect(f.spendRecent).toBe(20);
    expect(f.spendEarlier).toBe(5);
    expect(word(m, f)).toBe('burning');
    // Two measured waves are too few: null, unless one is unmeasured, which says so.
    const two = [...recent.slice(0, 2), ...earlier];
    expect(m.healthFactsOf(entry(), extras({ runs: two, spend }), NOW).spendRecent).toBeNull();
    const withGap = [...recent.slice(0, 2), wave(7, 5 * DAY), ...earlier];
    expect(m.healthFactsOf(entry(), extras({ runs: withGap, spend }), NOW).spendRecent).toBe('unmeasured');
    // The earlier window ends one ms before the recent one starts.
    const edgeRuns = [wave(1, WINDOW), wave(2, WINDOW), wave(3, WINDOW)];
    const edgeSpend = new Map([1, 2, 3].map((id) => [id, spendRow(id, 7)] as const));
    const e = m.healthFactsOf(entry(), extras({ runs: edgeRuns, spend: edgeSpend }), NOW);
    expect([e.spendRecent, e.spendEarlier]).toEqual([7, null]);
    expect(HEALTH_BURN_MIN_WAVES).toBe(3);
  });

  return cases;
}

// ── criticalPath, healthChangeVerdict ───────────────────────────────────────────────────────────────────────────────

const landed = (id: number, runId: number, o: Partial<ProgrammeEdge> = {}): ProgrammeEdge =>
  edge({ id, kind: 'needs-landed', target: { predicate: 'run-closed', runId }, ...o });
/** A graph of programme -> programmes it waits on, as run-closed edges; the run of programme `p` is its index + 1. */
function graph(g: Record<string, readonly string[]>) {
  const names = Object.keys(g);
  const runOf = (p: string): number => names.indexOf(p) + 1;
  return {
    edgesOf: (slug: string): readonly ProgrammeEdge[] => (g[slug] ?? []).map((t, i) => landed(i + 1, runOf(t))),
    programOfRun: (id: number): string | null => names[id - 1] ?? null,
  };
}

export function pathCases(): Case<HealthModule>[] {
  const cases: Case<HealthModule>[] = [];
  const add = (name: string, fn: (m: HealthModule) => void): void => { cases.push({ name, run: fn }); };
  const seals = (o: Record<string, number | null>) => (s: string): number | null => o[s] ?? null;

  add('criticalPath: a chain of three, its latest 85% date, and the link with no seal in unmeasured', (m) => {
    const g = graph({ a: ['b'], b: ['c'], c: [] });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 5, b: 9, c: 7 }), true))
      .toEqual({ chain: ['a', 'b', 'c'], latestP85At: 9, unmeasured: [], cut: false });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 5, c: 7 }), true))
      .toEqual({ chain: ['a', 'b', 'c'], latestP85At: 7, unmeasured: ['b'], cut: false });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({}), true))
      .toEqual({ chain: ['a', 'b', 'c'], latestP85At: null, unmeasured: ['a', 'b', 'c'], cut: false });
  });
  add('criticalPath: an unsealed branch is named in unmeasured even when another chain is chosen (F8)', (m) => {
    const g = graph({ a: ['b', 'c'], b: [], c: ['d'], d: [] });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 1, b: 9, d: 3 }), true))
      .toEqual({ chain: ['a', 'b'], latestP85At: 9, unmeasured: ['c'], cut: false });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 1, b: 9 }), true))
      .toEqual({ chain: ['a', 'b'], latestP85At: 9, unmeasured: ['c', 'd'], cut: false });
  });
  add('criticalPath: a cycle a -> b -> a answers [a, b] and stops', (m) => {
    const g = graph({ a: ['b'], b: ['a'] });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 1, b: 2 }), true))
      .toEqual({ chain: ['a', 'b'], latestP85At: 2, unmeasured: [], cut: false });
  });
  add('criticalPath: a depth of 11 answers 11 programmes with cut true; a depth of 10 links is not cut', (m) => {
    const chain = (n: number) => {
      const g: Record<string, string[]> = {};
      for (let i = 0; i <= n; i++) g[`p${i}`] = i < n ? [`p${i + 1}`] : [];
      return graph(g);
    };
    const long = chain(12);
    const r = m.criticalPath('p0', long.edgesOf, long.programOfRun, seals({}), true);
    expect(r.chain).toHaveLength(11);
    expect(r.chain[10]).toBe('p10');
    expect(r.cut).toBe(true);
    const exact = chain(10);
    const e = m.criticalPath('p0', exact.edgesOf, exact.programOfRun, seals({}), true);
    expect(e.chain).toHaveLength(11);
    expect(e.cut).toBe(false);
  });
  add('criticalPath: a pr-merged edge is a leaf, an ended edge and a needs-decision edge are not followed', (m) => {
    const pr = (id: number): ProgrammeEdge => edge({ id, kind: 'needs-landed', target: { predicate: 'pr-merged', runId: 2, pr: 9 } });
    const programOfRun = (id: number): string | null => (id === 2 ? 'b' : null);
    expect(m.criticalPath('a', () => [pr(1)], programOfRun, seals({}), true).chain).toEqual(['a']);
    expect(m.criticalPath('a', () => [landed(1, 2, { state: 'met' })], programOfRun, seals({}), true).chain).toEqual(['a']);
    expect(m.criticalPath('a', () => [edge({ id: 1 })], programOfRun, seals({}), true).chain).toEqual(['a']);
    expect(m.criticalPath('a', (s) => (s === 'a' ? [landed(1, 2)] : []), programOfRun, seals({}), true).chain).toEqual(['a', 'b']);
    expect(m.criticalPath('a', () => [landed(1, 99)], programOfRun, seals({}), true).chain).toEqual(['a']);
  });
  add('criticalPath: a wide graph stops at the visit budget and answers cut, never a walk of every branch', (m) => {
    // Ten programmes, each waiting on every other: about 9^10 chains unbounded.
    const names = Array.from({ length: 10 }, (_, i) => `w${i}`);
    const g = graph(Object.fromEntries(names.map((n) => [n, names.filter((o) => o !== n)])));
    let calls = 0;
    const edgesOf = (slug: string) => { calls += 1; return g.edgesOf(slug); };
    const r = m.criticalPath('w0', edgesOf, g.programOfRun, seals({}), true);
    expect(r.cut).toBe(true);
    expect(calls).toBeLessThanOrEqual(501);
    expect(new Set(r.chain).size).toBe(r.chain.length);
  });
  add('criticalPath: with clearing not shipped it follows nothing, even with edges', (m) => {
    const g = graph({ a: ['b'], b: [] });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 1, b: 2 }), false))
      .toEqual({ chain: ['a'], latestP85At: 1, unmeasured: [], cut: false });
  });
  add('criticalPath: among branches the chain with the latest 85% date, ties to the first branch in edge order', (m) => {
    const g = graph({ a: ['b', 'c', 'd'], b: [], c: [], d: [] });
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ a: 1, b: 5, c: 9, d: 3 }), true).chain).toEqual(['a', 'c']);
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ b: 5, c: 5 }), true).chain).toEqual(['a', 'b']);
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({ b: 5, c: 9 }), true).chain).toEqual(['a', 'c']);
    expect(m.criticalPath('a', g.edgesOf, g.programOfRun, seals({}), true).chain).toEqual(['a', 'b']);
  });

  add('healthChangeVerdict: a first row appends and never notices; the same word appends nothing', (m) => {
    expect(m.healthChangeVerdict(null, 'blocked-on-you', false)).toEqual({ append: true, notice: false });
    expect(m.healthChangeVerdict(healthRow('stalled'), 'stalled', false)).toEqual({ append: false, notice: false });
  });
  add('healthChangeVerdict: a worse word notices unless one was noticed in the last 24 hours; a better or unreadable one never does', (m) => {
    expect(m.healthChangeVerdict(healthRow('steady'), 'stalled', false)).toEqual({ append: true, notice: true });
    expect(m.healthChangeVerdict(healthRow('steady'), 'stalled', true)).toEqual({ append: true, notice: false });
    expect(m.healthChangeVerdict(healthRow('stalled'), 'steady', false)).toEqual({ append: true, notice: false });
    expect(m.healthChangeVerdict(healthRow('blocked-on-you'), 'steady', false)).toEqual({ append: true, notice: false });
    expect(m.healthChangeVerdict(healthRow('unreadable'), 'blocked-on-you', false)).toEqual({ append: true, notice: false });
    expect(m.healthChangeVerdict(healthRow('slipping'), 'blocked-on-you', false).notice).toBe(true);
  });
  return cases;
}

// ── waveSpend ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function measuresCases(): Case<MeasuresModule>[] {
  const cases: Case<MeasuresModule>[] = [];
  const add = (name: string, fn: (m: MeasuresModule) => void): void => { cases.push({ name, run: fn }); };
  const FROM = NOW - 10 * DAY;
  const w = (id: number, over: Partial<PortfolioRun> = {}) => run({ id, closedAt: NOW - 5 * DAY, ...over });
  const spendOf = (rows: RunSpendRow[]): ReadonlyMap<number, RunSpendRow> => new Map(rows.map((r) => [r.runId, r]));
  const measure = (m: MeasuresModule, runs: PortfolioRun[], rows: RunSpendRow[], from = FROM, to = NOW) =>
    m.waveSpend(m.wavesOf(runs), runs, spendOf(rows), from, to);

  add('doneCycles: first dispatch to close; a wave with no dispatch or a rebuilt run is unmeasured; skew clamps to 0', (m) => {
    const cyc = (runs: PortfolioRun[]) => m.doneCycles(m.wavesOf(runs).filter((x) => x.bucket === 'done'));
    expect(cyc([w(1, { state: 'done', dispatchedAt: NOW - 7 * DAY })])).toEqual({ cycles: [2 * DAY], unmeasured: 0 });
    expect(cyc([w(1, { state: 'done', dispatchedAt: null })])).toEqual({ cycles: [], unmeasured: 1 });
    expect(cyc([w(1, { state: 'done', dispatchedAt: NOW - 7 * DAY, rebuilt: true })])).toEqual({ cycles: [], unmeasured: 1 });
    // The rebuilt run is not the wave's representative, and still makes the wave unmeasured.
    expect(cyc([w(1, { state: 'failed', dispatchedAt: NOW - 9 * DAY, rebuilt: true, closedAt: NOW - 8 * DAY }),
      w(2, { state: 'done', dispatchedAt: NOW - 7 * DAY, wave: 1 })])).toEqual({ cycles: [], unmeasured: 1 });
    expect(cyc([w(1, { state: 'done', dispatchedAt: NOW - 4 * DAY })])).toEqual({ cycles: [0], unmeasured: 0 });
  });
  add('waveSpend: no wave closed in the range measures nothing, null and never 0', (m) => {
    expect(measure(m, [], [])).toEqual({ medianPerWave: null, measured: 0, unmeasured: 0 });
    expect(measure(m, [w(1, { closedAt: NOW - 20 * DAY })], [spendRow(1, 9)])).toEqual({ medianPerWave: null, measured: 0, unmeasured: 0 });
  });
  add('waveSpend: a wave is the sum of its work runs and the review runs over them; the median is over the measured waves', (m) => {
    const runs = [w(1), w(2, { wave: 2 }), w(3, { wave: 3 }), w(4, { wave: 1 }), w(11, { kind: 'review', reviews: 1, wave: 1 }), w(12, { kind: 'review', reviews: 3, wave: 3 })];
    const rows = [spendRow(1, 1), spendRow(4, 2), spendRow(11, 4), spendRow(2, 10), spendRow(3, 20), spendRow(12, 100)];
    // wave 1 = 1 + 2 + 4 = 7; wave 2 = 10; wave 3 = 20 + 100 = 120: the median of 7, 10, 120.
    expect(measure(m, runs, rows)).toEqual({ medianPerWave: 10, measured: 3, unmeasured: 0 });
  });
  add('waveSpend: a review run\'s spend is part of its wave, and a review of another wave is not', (m) => {
    const runs = [w(1), w(11, { kind: 'review', reviews: 1, wave: 1 }), w(12, { kind: 'review', reviews: 99, wave: 1 })];
    expect(measure(m, runs, [spendRow(1, 5), spendRow(11, 7), spendRow(12, 1000)])).toEqual({ medianPerWave: 12, measured: 1, unmeasured: 0 });
    expect(measure(m, runs, [spendRow(1, 5), spendRow(11, null)])).toEqual({ medianPerWave: null, measured: 0, unmeasured: 1 });
  });
  add('waveSpend: a missing row, an absent, outside or unreadable row and a null cost leave the wave out, counted', (m) => {
    const runs = [w(1), w(2, { wave: 2 }), w(3, { wave: 3 }), w(4, { wave: 4 }), w(5, { wave: 5 }), w(6, { wave: 6 })];
    const rows = [spendRow(1, 4), spendRow(2, 0, 'absent'), spendRow(3, 9, 'outside'), spendRow(4, 9, 'unreadable'), spendRow(5, null)];
    expect(measure(m, runs, rows)).toEqual({ medianPerWave: 4, measured: 1, unmeasured: 5 });
    // A wave of two runs, one of them with no row, is unmeasured whole.
    expect(measure(m, [w(1), w(2, { wave: 1 })], [spendRow(1, 4)])).toEqual({ medianPerWave: null, measured: 0, unmeasured: 1 });
  });
  add('waveSpend: a wave counts when its representative closed done or failed inside [from, to], edges included', (m) => {
    const rows = [1, 2, 3, 4].map((id) => spendRow(id, id));
    const runs = [w(1, { closedAt: FROM }), w(2, { closedAt: NOW }), w(3, { closedAt: FROM - 1 }), w(4, { closedAt: NOW + 1 })];
    expect(measure(m, runs, rows)).toEqual({ medianPerWave: 1, measured: 2, unmeasured: 0 });
    expect(measure(m, [w(1, { state: 'failed' })], [spendRow(1, 3)]).measured).toBe(1);
    expect(measure(m, [w(1, { state: 'working', closedAt: null })], [spendRow(1, 3)]).measured).toBe(0);
  });

  // The moved wave rule (a pure move out of portfolio.ts): the portfolio's own suite still holds its behaviour through
  // `portfolioFor`; these pin the moved functions directly, so a mutant set can judge them in their new home.
  add('wavesOf groups work runs by wave, leaves review runs out, and stands each wave as its representative', (m) => {
    const waves = m.wavesOf([run({ id: 1, wave: 1 }), run({ id: 2, wave: 1, state: 'working', closedAt: null }), run({ id: 3, kind: 'review', reviews: 1, wave: 1 }), run({ id: 4, wave: 2, state: 'failed' })]);
    expect(waves.map((x) => [x.wave, x.runs.length, x.rep.id, x.bucket])).toEqual([[1, 2, 2, 'working'], [2, 1, 4, 'failed']]);
    expect(m.wavesOf([run({ id: 1, kind: 'unknown' }), run({ id: 2, wave: 2, kind: 'review', reviews: 1 })])).toEqual([]);
    // The newest open run stands for a wave, else its highest id.
    expect(m.wavesOf([run({ id: 5, wave: 1, state: 'working', closedAt: null }), run({ id: 9, wave: 1 })])[0]!.rep.id).toBe(5);
    expect(m.wavesOf([run({ id: 5, wave: 1 }), run({ id: 9, wave: 1 })])[0]!.rep.id).toBe(9);
  });
  add('bucketOf reads a state this build does not know as working, and isOpenRun is false for a terminal state', (m) => {
    expect(m.bucketOf('not-a-state')).toBe('working');
    expect(m.bucketOf('done')).toBe('done');
    expect(m.isOpenRun(run({ id: 1, state: 'done' }))).toBe(false);
    expect(m.isOpenRun(run({ id: 1, state: 'working' }))).toBe(true);
  });
  add('closedIn is true for a done or failed representative closed inside [from, to], edges included', (m) => {
    const [w1] = m.wavesOf([run({ id: 1, closedAt: 5 * DAY })]);
    expect(m.closedIn(w1!, 5 * DAY, 6 * DAY)).toBe(true);
    expect(m.closedIn(w1!, 4 * DAY, 5 * DAY)).toBe(true);
    expect(m.closedIn(w1!, 5 * DAY + 1, 6 * DAY)).toBe(false);
    expect(m.closedIn(w1!, 4 * DAY, 5 * DAY - 1)).toBe(false);
    const [open] = m.wavesOf([run({ id: 2, state: 'working', closedAt: null })]);
    expect(m.closedIn(open!, 0, 99 * DAY)).toBe(false);
    expect(m.closedIn(m.wavesOf([run({ id: 3, state: 'failed', closedAt: 5 * DAY })])[0]!, 0, 99 * DAY)).toBe(true);
  });

  // ── runSpendVerdict (forecasts B, Task 7; question 10, ruled): what one closed run cost ─────────────────────────────
  const GRACE = 10 * 60_000;
  const DISPATCHED = NOW - 3 * HOUR;
  const CLOSED = NOW - HOUR;
  type SpendRunIn = Parameters<MeasuresModule['runSpendVerdict']>[0];
  type SpendReadingIn = NonNullable<Parameters<MeasuresModule['runSpendVerdict']>[1]>;
  const spendRun = (o: Partial<SpendRunIn> = {}): SpendRunIn =>
    ({ sessionId: 'sess-a', dispatchedAt: DISPATCHED, closedAt: CLOSED, redispatched: false, resumed: false, clearedAt: null,
      conversation: 'conv-1', ...o });
  const reading = (o: Partial<SpendReadingIn> = {}): SpendReadingIn =>
    ({ readAt: CLOSED - 5 * 60_000, cost: 4.25, class: 'opus', sidecarUuid: 'conv-1', conversationUuid: 'conv-1',
      turn: { kind: 'read', turnAt: CLOSED - 30 * 60_000, background: 0 }, ...o });
  const OUTSIDE = (r: { class: string | null; readAt: number }) => ({ state: 'outside', cost: null, class: r.class, readAt: r.readAt });

  add('runSpendVerdict: an in-window, fresh, same-conversation reading is measured, with its cost, class and time', (m) => {
    const r = reading();
    expect(m.runSpendVerdict(spendRun(), r)).toEqual({ state: 'measured', cost: 4.25, class: 'opus', readAt: r.readAt });
    expect(m.runSpendVerdict(spendRun(), reading({ readAt: DISPATCHED, turn: { kind: 'read', turnAt: DISPATCHED - 1, background: 0 } })))
      .toMatchObject({ state: 'measured', readAt: DISPATCHED });
  });
  add('runSpendVerdict: a reading older than the run\'s dispatch is outside, with no cost (the earlier wave\'s conversation)', (m) => {
    const r = reading({ readAt: DISPATCHED - 1 });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: a reading later than the close plus 10 minutes is outside; at exactly +10 minutes it is measured', (m) => {
    const late = reading({ readAt: CLOSED + GRACE + 1 });
    expect(m.runSpendVerdict(spendRun(), late)).toEqual(OUTSIDE(late));
    expect(m.runSpendVerdict(spendRun(), reading({ readAt: CLOSED + GRACE }))).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: a turn that started after the render makes the reading outside; one at the render or before does not (F2)', (m) => {
    const r = reading();
    const after = reading({ turn: { kind: 'read', turnAt: r.readAt + 1, background: 0 } });
    expect(m.runSpendVerdict(spendRun(), after)).toEqual(OUTSIDE(after));
    expect(m.runSpendVerdict(spendRun(), reading({ turn: { kind: 'read', turnAt: r.readAt, background: 0 } }))).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: no turn recorded and no background work live is fresh; a reading idle for hours in the queue is still measured (F2)', (m) => {
    expect(m.runSpendVerdict(spendRun(), reading({ turn: { kind: 'read', turnAt: null, background: 0 } }))).toMatchObject({ state: 'measured', cost: 4.25 });
    const idle = reading({ readAt: DISPATCHED + 1, turn: { kind: 'read', turnAt: DISPATCHED, background: 0 } });
    expect(m.runSpendVerdict(spendRun({ closedAt: DISPATCHED + 9 * HOUR }), idle)).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: a marker that could not vouch is outside (F2)', (m) => {
    const r = reading({ turn: { kind: 'unread' } });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: background work the newest Stop left live, or could not count, makes the reading outside (F2-b)', (m) => {
    const turnAt = CLOSED - 30 * 60_000;
    for (const background of [1, 3, -1]) {
      const r = reading({ turn: { kind: 'read', turnAt, background } });
      expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
    }
    // Straight after a `/clear` no Stop has counted anything yet: −1, so outside, never a guess.
    const cleared = reading({ turn: { kind: 'read', turnAt: null, background: -1 } });
    expect(m.runSpendVerdict(spendRun(), cleared)).toEqual(OUTSIDE(cleared));
    expect(m.runSpendVerdict(spendRun(), reading({ turn: { kind: 'read', turnAt, background: 0 } }))).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: a reading in another conversation than the one the run was dispatched into is outside (F3, a mid-run /clear)', (m) => {
    const r = reading({ sidecarUuid: 'conv-2', conversationUuid: 'conv-2' });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
    expect(m.runSpendVerdict(spendRun({ conversation: 'conv-2' }), r)).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: a run whose dispatch conversation was not measured is outside (F3)', (m) => {
    const r = reading();
    expect(m.runSpendVerdict(spendRun({ conversation: null }), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: a resumed run whose /clear was refused is outside; once it committed, measured (F10\')', (m) => {
    const r = reading();
    expect(m.runSpendVerdict(spendRun({ resumed: true, clearedAt: null }), r)).toEqual(OUTSIDE(r));
    expect(m.runSpendVerdict(spendRun({ resumed: true, clearedAt: DISPATCHED }), r)).toMatchObject({ state: 'measured', cost: 4.25 });
    expect(m.runSpendVerdict(spendRun({ resumed: false, clearedAt: null }), r)).toMatchObject({ state: 'measured', cost: 4.25 });
  });
  add('runSpendVerdict: a run whose session was dispatched to a later run is outside', (m) => {
    const r = reading();
    expect(m.runSpendVerdict(spendRun({ redispatched: true }), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: a reading taken in another conversation than the session\'s current one is outside', (m) => {
    const r = reading({ sidecarUuid: 'conv-0', conversationUuid: 'conv-1' });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: a reading with no session id of its own is outside, even when the registry has none either', (m) => {
    const r = reading({ sidecarUuid: null, conversationUuid: null });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual(OUTSIDE(r));
    const r2 = reading({ sidecarUuid: null, conversationUuid: 'conv-1' });
    expect(m.runSpendVerdict(spendRun(), r2)).toEqual(OUTSIDE(r2));
    // Even when the dispatch recorded none either: three nulls are no conversation, never a match.
    expect(m.runSpendVerdict(spendRun({ conversation: null }), r)).toEqual(OUTSIDE(r));
  });
  add('runSpendVerdict: no session or no reading is absent, with no cost, class or time', (m) => {
    const absent = { state: 'absent', cost: null, class: null, readAt: null };
    expect(m.runSpendVerdict(spendRun({ sessionId: null }), reading())).toEqual(absent);
    expect(m.runSpendVerdict(spendRun(), null)).toEqual(absent);
    expect(m.runSpendVerdict(spendRun({ sessionId: null }), null)).toEqual(absent);
  });
  add('runSpendVerdict: a reading with no cost figure is absent, never 0; its class and time stay as evidence', (m) => {
    const r = reading({ cost: null });
    expect(m.runSpendVerdict(spendRun(), r)).toEqual({ state: 'absent', cost: null, class: 'opus', readAt: r.readAt });
  });
  add('runSpendVerdict: a run with no dispatch time is outside, never measured', (m) => {
    const r = reading();
    expect(m.runSpendVerdict(spendRun({ dispatchedAt: null }), r)).toEqual(OUTSIDE(r));
  });
  return cases;
}

// ── Mutant sets ─────────────────────────────────────────────────────────────────────────────────────────────────────

const PROPERTY_RUNS = 20;
const suiteOf = <M>(cases: readonly Case<M>[]) => (m: M): Record<string, SuiteCase> =>
  Object.fromEntries(cases.map((c) => [c.name, () => c.run(m)]));
const healthSet = (cases: readonly Case<HealthModule>[], mutants: MutantSet<HealthModule>['mutants']): MutantSet<HealthModule> =>
  ({ modulePath: HEALTH_TS, mutants, suite: suiteOf(cases) });
const only = (prefix: string, cases: readonly Case<HealthModule>[]): Case<HealthModule>[] => cases.filter((c) => c.name.startsWith(prefix));

export const PROGRAMME_HEALTH_SET = healthSet(only('programmeHealth', healthCases(PROPERTY_RUNS)).concat(only('properties', healthCases(PROPERTY_RUNS))), [
  // The plan's red checks: rows 2 and 3 swapped; an unmeasured input read as 0; `>` for `>=` at the stalled limit; `>=` for
  // `>` at the churn rounds limit; the fixed-date arm dropped; only the rows up to the match evaluated.
  { id: 'PH-1', old: 'for (const row of rowsOf(facts, now)) {', new: 'for (const row of [...rowsOf(facts, now)].map((r, i, a) => (i === 1 ? a[2]! : i === 2 ? a[1]! : r))) {' },
  { id: 'PH-2', old: "{ name: 'moved', inputs: { newestP85At: f.newestP85At, previousP85At: f.previousP85At },\n        test: () => isNum(f.newestP85At) && isNum(f.previousP85At) && (f.newestP85At - f.previousP85At) / DAY_MS >=",
    new: "{ name: 'moved', inputs: { newestP85At: f.newestP85At, previousP85At: f.previousP85At === UNMEASURED ? 0 : f.previousP85At },\n        test: () => isNum(f.newestP85At) && (f.newestP85At - (isNum(f.previousP85At) ? f.previousP85At : 0)) / DAY_MS >=" },
  { id: 'PH-3', old: 'now - f.lastMoveAt >= HEALTH_STALLED_HOURS', new: 'now - f.lastMoveAt > HEALTH_STALLED_HOURS' },
  { id: 'PH-4', old: 'f.roundsPerWave > HEALTH_CHURN_ROUNDS', new: 'f.roundsPerWave >= HEALTH_CHURN_ROUNDS' },
  { id: 'PH-5', old: "test: () => f.cls === 'fixed-date' && fixedEnd !== null && isNum(f.newestP85At) && f.newestP85At > fixedEnd },", new: 'test: () => false },' },
  { id: 'PH-6', old: 'for (const row of rowsOf(facts, now)) {', new: 'for (const row of rowsOf(facts, now)) {\n    if (found !== null) break;' },
  { id: 'PH-7', old: 'Date.UTC(y!, m! - 1, d!, 23, 59, 59, 999)', new: 'Date.UTC(y!, m! - 1, d!, 23, 59, 59, 0)' },
  { id: 'PH-8', old: 'f.newestP85At > fixedEnd', new: 'f.newestP85At >= fixedEnd' },
  { id: 'PH-9', old: "if (matched === null) for (const k of row.unmatchedUnmeasured?.() ?? []) unmeasured.add(k);", new: '' },
  { id: 'PH-10', old: 'f.reworkedWaves > HEALTH_CHURN_REOPENS', new: 'f.reworkedWaves >= HEALTH_CHURN_REOPENS' },
]);

export const HEALTH_FACTS_SET = healthSet(only('healthFactsOf', healthCases(PROPERTY_RUNS)), [
  // The plan's red checks: edges counted while clearing is not shipped; `open` seals not skipped; the own cycle reference
  // read from 4 done waves.
  { id: 'HF-1', old: 'return !clearingShipped ? null : edges.filter((e) =>', new: 'return edges.filter((e) =>' },
  { id: 'HF-2', old: "if (s.outcome === 'open') continue;\n", new: '' },
  { id: 'HF-3', old: 'entry.cycle.n >= HEALTH_OWN_CYCLE_MIN', new: 'entry.cycle.n >= 4' },
  { id: 'HF-4', old: 'w.rep.closedAt > oldest.at && w.rep.closedAt <= newest.at', new: 'w.rep.closedAt >= oldest.at && w.rep.closedAt <= newest.at' },
  { id: 'HF-5', old: 'closedIn(w, now - window, now))', new: 'closedIn(w, now - window + 1, now))' },
  { id: 'HF-6', old: 'spendIn(waves, x, now - 2 * window, now - window - 1)', new: 'spendIn(waves, x, now - 2 * window, now - window)' },
  { id: 'HF-7', old: 'return s.unmeasured > 0 ? UNMEASURED : null;', new: 'return null;' },
  { id: 'HF-8', old: 'closed.filter((w) => w.runs.length >= 2).length', new: 'closed.filter((w) => w.runs.length >= 3).length' },
  { id: 'HF-9', old: "if (s.forecast === 'unreadable') return UNMEASURED;", new: "if (s.forecast === 'unreadable') return null;" },
  // F9 (ruled): an unforecastable seal read as null again ("measured, nothing to compare") is the pre-ruling reading.
  { id: 'HF-10', old: "return s.forecast.reason === 'nothing-left' ? null : UNMEASURED;", new: 'return null;' },
  { id: 'HF-11', old: "return s.forecast.reason === 'nothing-left' ? null : UNMEASURED;", new: 'return UNMEASURED;' },
  { id: 'HF-12', old: 'previousP85At: previousDated(x.seals),', new: 'previousP85At: x.seals.length < 2 ? null : p85Of(x.seals[x.seals.length - 2]!),' },
  { id: 'HF-13', old: "    if (f === 'unreadable') return UNMEASURED;\n    if (f.kind === 'forecast') return f.p85At;", new: "    if (f === 'unreadable') continue;\n    if (f.kind === 'forecast') return f.p85At;" },
]);

export const CRITICAL_PATH_SET = healthSet(only('criticalPath', pathCases()), [
  // The plan's red checks: no visited set; a depth of 11 for 10; a pr-merged target followed.
  { id: 'CP-1', old: 'if (p !== null && !chain.includes(p)) next.push(p);', new: 'if (p !== null) next.push(p);' },
  { id: 'CP-2', old: 'export const CRITICAL_PATH_DEPTH_MAX = 10;', new: 'export const CRITICAL_PATH_DEPTH_MAX = 11;' },
  { id: 'CP-3', old: "e.target?.predicate !== 'run-closed') continue;", new: 'e.target === null) continue;' },
  { id: 'CP-4', old: 'latest > best.latest', new: 'latest >= best.latest' },
  { id: 'CP-5', old: 'if (clearingShipped) {', new: 'if (true) {' },
  { id: 'CP-6', old: 'export const CRITICAL_PATH_VISITS_MAX = 500;', new: 'export const CRITICAL_PATH_VISITS_MAX = 5000;' },
  { id: 'CP-7', old: 'for (const p of visited) if', new: 'for (const p of [] as string[]) if' },
]);

export const HEALTH_CHANGE_SET = healthSet(only('healthChangeVerdict', pathCases()), [
  // The plan's red checks: a notice on a better word; a notice on a first row; no 24-hour check.
  { id: 'HC-1', old: 'PROGRAMME_HEALTH_WORDS.indexOf(next) < PROGRAMME_HEALTH_WORDS.indexOf(prev.word)', new: 'PROGRAMME_HEALTH_WORDS.indexOf(next) !== PROGRAMME_HEALTH_WORDS.indexOf(prev.word)' },
  { id: 'HC-2', old: 'const worse = prev !== null && prev.word', new: 'const worse = prev === null || prev.word' },
  { id: 'HC-3', old: 'notice: worse && !noticedSince', new: 'notice: worse' },
]);

export const WAVE_SPEND_SET: MutantSet<MeasuresModule> = {
  modulePath: MEASURES_TS, suite: suiteOf(measuresCases().filter((c) => c.name.startsWith('waveSpend'))),
  mutants: [
    // The plan's red checks: a missing row read as cost 0; a review run's spend left out.
    { id: 'WS-1', old: "if (row === undefined || row.state !== 'measured' || row.cost === null) { known = false; break; }",
      new: "if (row === undefined) continue;\n      if (row.state !== 'measured' || row.cost === null) { known = false; break; }" },
    { id: 'WS-2', old: "const own = [...w.runs, ...runs.filter((r) => r.kind === 'review' && r.reviews !== null && ids.has(r.reviews))];", new: 'const own = [...w.runs];' },
    { id: 'WS-3', old: 'at >= from && at <= to;', new: 'at > from && at <= to;' },
    { id: 'WS-4', old: "row.state !== 'measured' ||", new: '' },
    { id: 'WS-5', old: 'percentile(totals, 50)', new: 'percentile(totals, 85)' },
  ],
};

/** Done waves' cycle times, moved out of portfolio.ts' entry: P-FOR-9, -28, -31 and -33 named them there. */
export const DONE_CYCLES_KEY = 'server/src/coord/programmeMeasures.ts#doneCycles';
export const DONE_CYCLES_SET: MutantSet<MeasuresModule> = {
  modulePath: MEASURES_TS, suite: suiteOf(measuresCases().filter((c) => c.name.startsWith('doneCycles'))),
  mutants: [
    { id: 'DC-1', old: 'if (d === null || w.rep.closedAt === null || rebuiltWave(w)) unmeasured += 1;', new: 'if (d === null || w.rep.closedAt === null || rebuiltWave(w)) {}' },
    { id: 'DC-2', old: 'cycles.push(Math.max(0, w.rep.closedAt - d));', new: 'cycles.push(w.rep.closedAt - d);' },
    { id: 'DC-3', old: 'w.rep.closedAt === null || rebuiltWave(w)) unmeasured', new: 'w.rep.closedAt === null) unmeasured' },
    { id: 'DC-4', old: 'export const rebuiltWave = (w: Wave): boolean => w.runs.some((r) => r.rebuilt === true);', new: 'export const rebuiltWave = (w: Wave): boolean => w.rep.rebuilt === true && w.runs.length > 99;' },
  ],
};

/** The wave rule moved out of portfolio.ts, with the three mutants (P-FOR-2, -12, -19) that named it there. */
export const WAVES_SET: MutantSet<MeasuresModule> = {
  modulePath: MEASURES_TS, suite: suiteOf(measuresCases().filter((c) => !c.name.startsWith('waveSpend') && !c.name.startsWith('runSpendVerdict'))),
  mutants: [
    { id: 'WV-1', old: 'if (!countsAsWave(r.kind)) continue;', new: "if (r.kind === 'unknown') continue;" },
    { id: 'WV-2', old: 'open: isOpenRun(r), r', new: 'open: false, r' },
    { id: 'WV-3', old: "isRunState(state) ? WAVE_BUCKET[state] : 'working'", new: "isRunState(state) ? WAVE_BUCKET[state] : 'queued'" },
    { id: 'WV-4', old: "(w.bucket === 'done' || w.bucket === 'failed') &&", new: "w.bucket === 'done' &&" },
    { id: 'WV-5', old: 'at !== null && at >= from && at <= to;', new: 'at !== null && at >= from && at < to;' },
  ],
};

/** What one closed run cost (forecasts B, Task 7): the plan's red checks (`absent` recorded as cost 0; the window test
 *  dropped), and one mutant for each other clause of the `measured` test. */
export const RUN_SPEND_VERDICT_SET: MutantSet<MeasuresModule> = {
  modulePath: MEASURES_TS, suite: suiteOf(measuresCases().filter((c) => c.name.startsWith('runSpendVerdict'))),
  mutants: [
    { id: 'RS-1', old: 'if (inWindow && fresh', new: 'if (fresh' },
    { id: 'RS-2', old: '&& fresh &&', new: '&&' },
    { id: 'RS-3', old: '&& !run.redispatched &&', new: '&&' },
    { id: 'RS-4', old: '!run.redispatched && sameConversation', new: '!run.redispatched' },
    { id: 'RS-5', old: 'reading.readAt <= run.closedAt + GRACE_MS', new: 'reading.readAt < run.closedAt + GRACE_MS' },
    { id: 'RS-6', old: "if (reading.cost === null) return { state: 'absent', cost: null, ...evidence };", new: "if (reading.cost === null) return { state: 'absent', cost: 0, ...evidence };" },
    { id: 'RS-7', old: "return { state: 'absent', cost: null, class: null, readAt: null };", new: "return { state: 'absent', cost: 0, class: null, readAt: null };" },
    { id: 'RS-8', old: 'reading.sidecarUuid !== null && reading.sidecarUuid === reading.conversationUuid', new: 'reading.sidecarUuid === reading.conversationUuid' },
    { id: 'RS-9', old: 'reading.readAt >= run.dispatchedAt', new: 'reading.readAt > run.dispatchedAt' },
    { id: 'RS-10', old: 'run.dispatchedAt !== null && reading.readAt >= run.dispatchedAt', new: 'reading.readAt >= (run.dispatchedAt ?? 0)' },
    { id: 'RS-11', old: "return { state: 'measured', cost: reading.cost, ...evidence };", new: "return { state: 'measured', cost: null, ...evidence };" },
    { id: 'RS-12', old: 'reading.turn.turnAt <= reading.readAt', new: 'reading.turn.turnAt <= reading.readAt + 60_000' },
    { id: 'RS-13', old: "&& reading.turn.background === 0\n    : false;", new: "&& reading.turn.background === 0\n    : true;" },
    { id: 'RS-14', old: '\n    && reading.sidecarUuid === run.conversation;', new: ';' },
    { id: 'RS-15', old: '&& sameConversation && cleared)', new: '&& sameConversation)' },
    { id: 'RS-16', old: 'const cleared = !run.resumed || run.clearedAt !== null;', new: 'const cleared = true;' },
    // Fix round 2, F2-b: background work live after the render is not fresh.
    { id: 'RS-17', old: ' && reading.turn.background === 0', new: '' },
    { id: 'RS-18', old: 'reading.turn.background === 0', new: 'reading.turn.background <= 0' },
  ],
};

// ── The spend arm's turn guard (fix round 2, F2-a): the adapter side, where a marker that cannot vouch becomes `unread` ──

export interface AsyncCase<M> { name: string; run: (m: M) => Promise<void> | void }
const asyncSuiteOf = <M>(cases: readonly AsyncCase<M>[]) => (m: M): Record<string, SuiteCase> =>
  Object.fromEntries(cases.map((c) => [c.name, () => c.run(m)]));

const MARK: Extract<TurnMarkRead, { ok: true }> = {
  ok: true, sessionId: 'conv-1', state: 'done', event: 'Stop', at: NOW - HOUR, turnAt: NOW - 2 * HOUR, stopAt: NOW - HOUR,
  bg: 0, bgKinds: [], bgIds: [], err: null, restartAt: null, lostBg: 0, lostKinds: [], lostIds: [], crons: null, graceUntil: null,
};

/** `usage.ts#readSpendTurns` over a stub marker reader: each answer that cannot vouch, and a throw, reads `unread`; one
 *  that vouches carries its newest turn and its newest Stop's background count. */
export function spendTurnsCases(): AsyncCase<UsageModule>[] {
  const conv = (ids: readonly string[]) => new Map(ids.map((id) => [id, { registry: `reg-${id}` }]));
  return [
    { name: 'readSpendTurns: absent, unmeasured, malformed, foreign and stale markers, and a reader that throws, each read unread (F2-a)', run: async (m) => {
      const reasons = ['absent', 'unmeasured', 'malformed', 'foreign', 'stale'] as const;
      const got = await m.readSpendTurns(async (id) => {
        if (id === 'throws') throw new Error('read failed');
        return { ok: false, reason: reasons.find((r) => r === id) ?? 'unmeasured' };
      }, conv([...reasons, 'throws']));
      expect(Object.fromEntries(got)).toEqual(Object.fromEntries([...reasons, 'throws'].map((id) => [id, { kind: 'unread' }])));
    } },
    { name: 'readSpendTurns: a marker that vouches reads its newest turn and its newest Stop\'s live background count, asked with the registry id (F2-a, F2-b)', run: async (m) => {
      const asked: string[] = [];
      const got = await m.readSpendTurns(async (id, registry) => {
        asked.push(`${id}:${registry}`);
        return id === 'busy' ? { ...MARK, bg: 2 } : id === 'cleared' ? { ...MARK, turnAt: null, bg: -1 } : MARK;
      }, conv(['idle', 'busy', 'cleared']));
      expect(Object.fromEntries(got)).toEqual({
        idle: { kind: 'read', turnAt: MARK.turnAt, background: 0 },
        busy: { kind: 'read', turnAt: MARK.turnAt, background: 2 },
        cleared: { kind: 'read', turnAt: null, background: -1 },
      });
      expect(asked.sort()).toEqual(['busy:reg-busy', 'cleared:reg-cleared', 'idle:reg-idle']);
    } },
  ];
}

/** `forecastLane.ts#spendReadingOf`: a session whose marker the lane has not read yet reads `unread`, never fresh. */
export function spendReadingCases(): AsyncCase<SpendReadingModule>[] {
  const usage = { ts: 1_790_000_000, cost: 2.5, class: 'opus' };
  const conversation = { sidecar: 'conv-1', registry: 'conv-1' };
  return [
    { name: 'spendReadingOf: no turn read yet for the session reads unread (F2-a)', run: (m) => {
      expect(m.spendReadingOf(usage, conversation, undefined)?.turn).toEqual({ kind: 'unread' });
    } },
    { name: 'spendReadingOf: a turn read is carried as read; no usage is no reading', run: (m) => {
      const turn = { kind: 'read', turnAt: 5, background: 0 } as const;
      expect(m.spendReadingOf(usage, conversation, turn)).toEqual({ readAt: usage.ts * 1000, cost: 2.5, class: 'opus',
        sidecarUuid: 'conv-1', conversationUuid: 'conv-1', turn });
      expect(m.spendReadingOf(undefined, conversation, turn)).toBeNull();
    } },
  ];
}

export const SPEND_TURNS_SET: MutantSet<UsageModule> = {
  modulePath: USAGE_TS, suite: asyncSuiteOf(spendTurnsCases()),
  mutants: [
    // The review's mutant (a): a marker that cannot vouch read as fresh.
    { id: 'ST-1', old: "mark.ok ? { kind: 'read', turnAt: mark.turnAt, background: mark.bg } : { kind: 'unread' }",
      new: "{ kind: 'read', turnAt: mark.ok ? mark.turnAt : null, background: mark.ok ? mark.bg : 0 }" },
    // The review's mutant (c): a throw no longer caught.
    { id: 'ST-2', old: ".catch((): TurnMarkRead => ({ ok: false, reason: 'unmeasured' }))", new: '' },
    { id: 'ST-3', old: 'background: mark.bg }', new: 'background: 0 }' },
  ],
};

export const SPEND_READING_SET: MutantSet<SpendReadingModule> = {
  modulePath: FORECAST_LANE_TS, suite: asyncSuiteOf(spendReadingCases()),
  mutants: [
    // The review's mutant (b): a session with no turn read yet read as fresh.
    { id: 'SR-1', old: "turn: turn ?? { kind: 'unread' }", new: "turn: turn ?? { kind: 'read', turnAt: null, background: 0 }" },
  ],
};

export const PROGRAMME_HEALTH_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [PROGRAMME_HEALTH_KEY]: PROGRAMME_HEALTH_SET as MutantSet<never>,
  [HEALTH_FACTS_KEY]: HEALTH_FACTS_SET as MutantSet<never>,
  [CRITICAL_PATH_KEY]: CRITICAL_PATH_SET as MutantSet<never>,
  [HEALTH_CHANGE_KEY]: HEALTH_CHANGE_SET as MutantSet<never>,
  [WAVE_SPEND_KEY]: WAVE_SPEND_SET as MutantSet<never>,
  [WAVES_KEY]: WAVES_SET as MutantSet<never>,
  [DONE_CYCLES_KEY]: DONE_CYCLES_SET as MutantSet<never>,
  [RUN_SPEND_VERDICT_KEY]: RUN_SPEND_VERDICT_SET as MutantSet<never>,
  [SPEND_TURNS_KEY]: SPEND_TURNS_SET as MutantSet<never>,
  [SPEND_READING_KEY]: SPEND_READING_SET as MutantSet<never>,
};
