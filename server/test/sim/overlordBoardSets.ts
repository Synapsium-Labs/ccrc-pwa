// The Overlord's board composer's cases and mutant sets (Overlord W1, PR B2; plan `w1-board-history.md` Task 6). The cases are
// written ONCE here, as functions of the composer: `overlord-board.test.ts` runs them against the real functions, and the
// mutation floors can run them against each textual mutant. Every case builds its inputs from literal reader answers, so the
// composer is judged on what it maps, groups, marks untrusted and leaves out, never on what a store holds.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MarkerState } from '../../../shared/api.js';
import type { GoalsView, Ratification } from '../../../shared/ledgers.js';
import type { PortfolioView } from '../../../shared/portfolio.js';
import {
  BOARD_PARTS, BOARD_UNMEASURED, type BoardCondition, type BoardLatch, type BoardPart, type BoardUnmeasured, type OverlordBoard,
} from '../../../shared/overlordBoard.js';
import type { BoardInputs, BoardItemIn, BoardProgrammeIn, BoardRead, BoardSettingIn, BoardTimerIn } from '../../src/coord/overlordBoard.js';
import { SWITCHES, ccrcFileSwitchNames, readSwitches, settingSwitchNames } from '../../../shared/switches.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/overlordBoard.ts');
const KEY = 'server/src/coord/overlordBoard.ts';

export type BoardModule = typeof import('../../src/coord/overlordBoard.js');
export type Compose = (i: BoardInputs) => OverlordBoard;
export type TimersBy = BoardModule['timersByProgramme'];

/** Text that must never reach the board: a note, a modification's text, an item's why/how/answer, a spec path. */
export const SENTINEL = 'SENTINEL';
const NOTE = 'SENTINEL-NOTE-7';

// ------------------------------------------------------------------------------------------------------------ fixtures

const A = 'lane-a-project-a';
const B = 'lane-b-project-a';
const OP: Ratification = { ratified: true, source: { kind: 'operator' } };
const COORD: Ratification = { ratified: true, source: { kind: 'coordinator' } };

const ok = <T>(value: T): BoardRead<T> => ({ ok: true, value });
const bad = (reason: BoardUnmeasured): BoardRead<never> => ({ ok: false, reason });
const un = (reason: BoardUnmeasured) => ({ state: 'unmeasured', reason }) as const;
const keysOf = (o: object): string[] => Object.keys(o).sort();

const WAVES_A = { working: 1, waiting: 0, queued: 1, done: 1, failed: 0 };
const WAVES_B = { working: 0, waiting: 2, queued: 0, done: 5, failed: 1 };
const WAVES_C = { working: 0, waiting: 0, queued: 0, done: 0, failed: 0 };

/** prog-a: a bound coordinator that differs from the run's claimant, and every lifecycle field. */
const progA: BoardProgrammeIn = {
  slug: 'prog-a', title: 'Programme A title', lifecycle: 'active', coordinatorLine: 'led', coordinator: A, claimedBy: B,
  currentWave: 2, waveOf: 4, waves: WAVES_A, stuck: 2,
};
/** prog-b: no bound coordinator and no lifecycle fields (an older read), so the claimant stands in. */
const progB: BoardProgrammeIn = { slug: 'prog-b', title: 'Programme B title', claimedBy: B, currentWave: null, waveOf: null, waves: WAVES_B };
/** prog-c: no coordinator and no claimant. */
const progC: BoardProgrammeIn = {
  slug: 'prog-c', title: 'Programme C title', lifecycle: 'idle', coordinatorLine: 'no-coordinator', coordinator: null, claimedBy: null,
  currentWave: null, waveOf: null, waves: WAVES_C, stuck: 0,
};

const mod = (id: number): GoalsView['modifications'][number] =>
  ({ id, at: 1000 * id, text: `SENTINEL-MOD-${id}`, ruling: 'SENTINEL-RULING-7', itemId: null, pr: null, merged: false, ratification: OP });
type GoalsIn = Pick<GoalsView, 'inShort' | 'doneWhen' | 'pinRatification' | 'doneWhenRatification' | 'modifications'>;
const goalsWith = (over: Partial<GoalsIn> = {}): GoalsIn =>
  ({ inShort: null, doneWhen: null, pinRatification: undefined, doneWhenRatification: undefined, modifications: [], ...over });
/** prog-a: the pin is the operator's, its definition of done a coordinator's. */
const goalsA = goalsWith({
  inShort: 'A in short', doneWhen: ['a done 1', 'a done 2'], pinRatification: OP, doneWhenRatification: COORD,
  modifications: [mod(1), mod(2)],
});
/** prog-b: the pin is a coordinator's ratification, the definition of done the operator's. */
const goalsB = goalsWith({
  inShort: 'B in short', doneWhen: ['b done 1'], pinRatification: COORD, doneWhenRatification: OP,
});

const item = (id: number, over: Partial<BoardItemIn> = {}): BoardItemIn =>
  ({ id, kind: 'decide', state: 'open', neededBy: 'blocking', title: `Item ${id}`, ...over });
/** An item as a reader could hand it over with fields the board must never carry. */
const itemWithExtras = (id: number): BoardItemIn =>
  Object.assign(item(id), { why: 'SENTINEL-WHY-7', how: 'SENTINEL-HOW-7', answer: 'SENTINEL-ANSWER-7', note: 'SENTINEL-ITEMNOTE-7' });

/** A portfolio entry with every W1 field of the view, each value distinct, so a field moved or dropped shows. */
const entry = (slug: string, title: string, over: Record<string, unknown> = {}) => ({
  slug, title, rank: null, cls: 'standard', wip: { working: 1, waiting: 2, queued: 3 }, closedWaves: { days7: 9, days28: 19 },
  cycle: { n: 3, medianMs: 77, p85Ms: 88 }, cycleUnmeasured: 1, oldestOpenMs: null, oldestOpenUnmeasured: 0,
  reviewRounds: { rounds: 4, waves: 2 }, ended28: { done: 5, failed: 1, neverStarted: 2 }, waitingOnOperatorMs28: 3600,
  itemsUnmeasured: 6, asksUnmeasured: 7, blocking: { items: [{ id: 31, title: 'Blocking item 31' }], asks: 8 }, ...over,
});
/** The view's later-wave fields, which the board does not carry (slug `board-portfolio-later-wave-fields`). */
const laterWave = {
  health: { word: 'SENTINEL-HEALTH-7', evidence: 'unreadable', at: 1 },
  forecast: { kind: 'forecast', medianAt: 4_000_001, p85At: 4_000_002, n: 3, source: 'own', sealedAt: 1, outcome: 'pending' },
  edges: { list: [{ from: 'SENTINEL-EDGE-7' }], clearingShipped: false },
  spend: { total: 4_000_003, byClass: {}, perWaveMedian: null, wavesMeasured: 0, wavesUnmeasured: 0, runsUnmeasured: 0, attributed: true, coordinatorExcluded: true, classAtClose: true },
  criticalPath: { chain: ['SENTINEL-PATH-7'], latestP85At: 4_000_004, unmeasured: [], cut: false },
};
/** prog-a: ranked, a measured oldest wave, the later-wave fields and decision edges; prog-b: a stored rank this build cannot read,
 *  and two started waves whose age is unknown, so neither null means what it means on a plain unranked, idle row. */
const portfolioView = (): PortfolioView => ({
  at: 5000, revision: 4,
  programmes: [
    entry('prog-a', 'Programme A title', {
      rank: { position: 1, cls: 'expedite', fixedDate: null }, cls: 'expedite', oldestOpenMs: 1234, ...laterWave,
      blocking: { items: [{ id: 31, title: 'Blocking item 31' }], asks: 8, edges: 3 },
    }),
    entry('prog-b', 'Programme B title', { rankUnreadable: true, oldestOpenUnmeasured: 2, blocking: { items: [], asks: 0 } }),
  ],
}) as unknown as PortfolioView;

/** One standing latch and one live condition, as the ladder read's projection hands them over. */
const LATCH: BoardLatch = { cause: 'invariant-violation', cap: 'advise', raisedAt: 4242, known: true, narrowing: { state: 'taking-effect', why: 'no-witness-yet' } };
const CONDITION: BoardCondition = { cause: 'no-witness-since-boot', reading: 'standing', effect: { kind: 'cap', cap: 'advise' } };

/** Every settings row of the switchboard answering (board B3), each with another stored word and stored state, so a row read for
 *  another, or a field dropped, shows. Its keys are the table's settings rows: a row added to the table reds the census case. */
export const SETTING_FIXTURE: Readonly<Record<string, BoardSettingIn>> = {
  'stall-watch-level': { stored: 'row', value: 'follow' },
  'collect-lane-choice': { stored: 'absent', value: null },
  'roll-idle-targets': { stored: 'seed', value: 'coordinators' },
  'dispatch-abandon-choice': { stored: 'row', value: 'unknown' },
  'run-close-never-started-choice': { stored: null, value: 'shadow' },
  'run-close-claimant-crashed-choice': { stored: null, value: 'on' },
  'run-close-claimant-gone-choice': { stored: null, value: 'off' },
  'plain-auto-memory': { stored: 'row', value: 'on' },
  'coordinator-advisor': { stored: 'row', value: 'fable' },
  'overlord-rung': { stored: 'row', value: 'advise' },
};
const settingsInput = (): Map<string, BoardRead<BoardSettingIn>> =>
  new Map(Object.entries(SETTING_FIXTURE).map(([k, v]) => [k, ok(v)] as const));
/** The fleet host's three switch files: one standing, one proven absent, one the reading could not measure. */
const FILES_READ: Record<string, MarkerState> = { 'graph-gate-off': 'set', 'ccrc-card-off': 'clear', 'compact-card-off': 'unmeasurable' };
const FILES_OUT = {
  'graph-gate-off': { state: 'measured', value: 'set' }, 'ccrc-card-off': { state: 'measured', value: 'clear' }, 'compact-card-off': un('read-failed'),
};

const timerRows = (): BoardTimerIn[] => [
  { setter: A, dueAt: 5000, note: NOTE }, { setter: A, dueAt: 2000, note: NOTE }, { setter: B, dueAt: 9000, note: NOTE },
  { setter: 'lane-z-project-a', dueAt: 1, note: NOTE },
];

/** Every reader answering, over prog-a, prog-b and prog-c. */
export function healthyInputs(over: Partial<BoardInputs> = {}): BoardInputs {
  return {
    programmes: ok([progA, progB, progC]),
    listing: ok([{ id: A, status: 'busy' }, { id: B, status: 'idle' }]),
    goals: new Map([['prog-a', ok(goalsA)], ['prog-b', ok(goalsB)], ['prog-c', ok(goalsWith())]]),
    items: new Map([['prog-a', ok([item(11), item(12, { kind: 'do', state: 'checking', neededBy: 'later' })])], ['prog-b', ok([])], ['prog-c', ok([])]]),
    stallNotices: ok({ since: 100, windowMs: 200, counts: [{ row: 'checks', sent: 1, shadow: 2 }] }),
    portfolio: ok(portfolioView()),
    capacity: ok({ maxConcurrentWorkers: 6, running: 2 }),
    projects: ok({ registry: 'listed', names: ['project-a', 'project-b'], unreadable: ['project-z'] }),
    switches: ok({ 'mail-disabled': 'set', 'coordinator-paused': 'clear' } as Record<string, MarkerState>),
    settings: settingsInput(),
    files: ok(FILES_READ),
    ladder: ok({ rung: 'chat', operatorRung: 'advise', latches: [LATCH], conditions: [CONDITION] }),
    readiness: ok({ word: 'ready', since: 300, until: null }),
    isolation: ok({ kind: 'measured', word: 'separate-user', cause: 'other-user' }),
    sandbox: ok({ held: true }),
    timers: ok(timerRows()),
    ...over,
  };
}

const rowsOf = <T>(part: { readonly state: string; readonly programmes?: readonly T[] }): readonly T[] => {
  if (part.state !== 'measured' || part.programmes === undefined) throw new Error('the part is not measured');
  return part.programmes;
};

/** A fixture of `n` programmes, each with 3 open items, 2 doneWhen lines, 2 timers and a portfolio entry. */
export function bigInputs(n: number): BoardInputs {
  const slugs = Array.from({ length: n }, (_, k) => `prog-${k}`);
  const lane = (k: number): string => `lane-${k}-project-a`;
  const programmes = slugs.map((slug, k): BoardProgrammeIn => ({
    slug, title: `Programme number ${k} with a title of a usual length`, lifecycle: 'active', coordinatorLine: 'led', coordinator: lane(k),
    claimedBy: lane(k), currentWave: 3, waveOf: 6, waves: { working: 1, waiting: 1, queued: 2, done: 3, failed: 0 }, stuck: 0,
  }));
  return healthyInputs({
    programmes: ok(programmes),
    listing: ok(slugs.map((_, k) => ({ id: lane(k), status: 'busy' as const }))),
    goals: new Map(slugs.map((s, k) => [s, ok(goalsWith({
      inShort: `Programme ${k} in short, one plain sentence about what it is for`,
      doneWhen: [`done line one of programme ${k}`, `done line two of programme ${k}`], pinRatification: OP, doneWhenRatification: OP,
      modifications: [mod(k + 1)],
    }))] as const)),
    items: new Map(slugs.map((s, k) => [s, ok([item(3 * k + 1), item(3 * k + 2), item(3 * k + 3)])] as const)),
    portfolio: ok({
      at: 1, revision: 9,
      programmes: slugs.map((s, k) => entry(s, `Programme number ${k} with a title of a usual length`,
        { rank: { position: k + 1, cls: 'standard', fixedDate: null }, oldestOpenMs: 100000 + k,
          blocking: { items: [{ id: 3 * k + 1, title: `Item ${3 * k + 1}` }], asks: 1, edges: 0 } })),
    } as unknown as PortfolioView),
    timers: ok(slugs.flatMap((_, k) => [{ setter: lane(k), dueAt: 1000 + k, note: NOTE }, { setter: lane(k), dueAt: 2000 + k, note: NOTE }])),
  });
}

/** The measured size of `JSON.stringify(composeBoard(bigInputs(50)))`, asserted exactly, so a change that moves it re-measures
 *  here, and the bound pinned over it (about 15 percent headroom).
 *  It catches a part that grows by a whole new list per programme; a leaked body or note adds too little to cross it at this
 *  scale. What catches those is the sentinel cases (`SENTINEL` above and the board door suite's C44 case). First measured at
 *  81,988 bytes (bound 95,000); re-measured in review 4010's round with the portfolio's measures and what blocks, and the
 *  ladder's latches and conditions: 103,424 bytes, the bound moved to 120,000 (the same 16 percent). Re-measured in board B3 with
 *  the brakes' settings rows and files and the projects walk's unreadable folders: 104,414 bytes, under the same bound (15 percent),
 *  so the bound did not move. */
export const BOARD_50_MEASURED_BYTES = 104_414;
export const BOARD_50_BOUND_BYTES = 120_000;

// ------------------------------------------------------------------------------------------------------------ composeBoard

export function composeBoardCases(compose: Compose): Record<string, SuiteCase> {
  const board = (over: Partial<BoardInputs> = {}): OverlordBoard => compose(healthyInputs(over));
  const identity = (b: OverlordBoard) => rowsOf(b.identity);
  const goals = (b: OverlordBoard) => rowsOf(b.goals);
  const work = (b: OverlordBoard) => rowsOf(b.work);
  const goalsOf = (b: OverlordBoard, slug: string) => {
    const g = goals(b).find((r) => r.slug === slug)?.goals;
    if (g === undefined) throw new Error(`no goals row for ${slug}`);
    return g;
  };
  const measuredGoals = (b: OverlordBoard, slug: string) => {
    const g = goalsOf(b, slug);
    if (g.state !== 'measured') throw new Error(`goals of ${slug} are unmeasured`);
    return g;
  };

  /** One reader failing, which parts change, and what the changed ones read. Every other part equals the healthy board's. */
  const FAILURES: readonly {
    name: string; over: (r: BoardUnmeasured) => Partial<BoardInputs>; affected: readonly BoardPart[]; check: (b: OverlordBoard, r: BoardUnmeasured) => void;
  }[] = [
    { name: 'programmes', over: (r) => ({ programmes: bad(r) }), affected: ['identity', 'goals', 'work', 'timers'],
      check: (b, r) => { for (const part of [b.identity, b.goals, b.work, b.timers]) expect(part).toEqual(un(r)); } },
    { name: 'listing', over: (r) => ({ listing: bad(r) }), affected: ['identity'],
      check: (b, r) => {
        const rows = identity(b);
        expect(rows.find((x) => x.slug === 'prog-a')?.live).toEqual(un(r));
        expect(rows.find((x) => x.slug === 'prog-b')?.live).toEqual(un(r));
        expect(rows.find((x) => x.slug === 'prog-c')?.live).toBeNull();
      } },
    { name: 'goals of prog-a', over: (r) => ({ goals: new Map([...healthyInputs().goals, ['prog-a', bad(r)]]) }), affected: ['goals'],
      check: (b, r) => {
        expect(goalsOf(b, 'prog-a')).toEqual(un(r));
        expect(goalsOf(b, 'prog-b').state).toBe('measured');
        expect(goalsOf(b, 'prog-c').state).toBe('measured');
      } },
    { name: 'items of prog-b', over: (r) => ({ items: new Map([...healthyInputs().items, ['prog-b', bad(r)]]) }), affected: ['work'],
      check: (b, r) => {
        expect(work(b).find((x) => x.slug === 'prog-b')?.items).toEqual(un(r));
        expect(work(b).find((x) => x.slug === 'prog-a')?.items.state).toBe('measured');
        expect(work(b).find((x) => x.slug === 'prog-c')?.items).toEqual({ state: 'measured', open: [] });
      } },
    { name: 'stall notices', over: (r) => ({ stallNotices: bad(r) }), affected: ['work'],
      check: (b, r) => {
        if (b.work.state !== 'measured') throw new Error('work is not measured');
        expect(b.work.stallNotices).toEqual(un(r));
        expect(b.work.programmes).toEqual(rowsOf(board().work));
      } },
    { name: 'portfolio', over: (r) => ({ portfolio: bad(r) }), affected: ['portfolio'], check: (b, r) => expect(b.portfolio).toEqual(un(r)) },
    { name: 'capacity', over: (r) => ({ capacity: bad(r) }), affected: ['capacity'], check: (b, r) => expect(b.capacity).toEqual(un(r)) },
    { name: 'projects', over: (r) => ({ projects: bad(r) }), affected: ['projects'], check: (b, r) => expect(b.projects).toEqual(un(r)) },
    { name: 'switches', over: (r) => ({ switches: bad(r) }), affected: ['brakes'],
      check: (b, r) => {
        if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
        expect(b.brakes.switches).toEqual(un(r));
        expect(b.brakes.ladder.state).toBe('measured');
      } },
    { name: 'ladder', over: (r) => ({ ladder: bad(r) }), affected: ['brakes'],
      check: (b, r) => {
        if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
        expect(b.brakes.ladder).toEqual(un(r));
        expect(b.brakes.switches.state).toBe('measured');
      } },
    { name: 'files', over: (r) => ({ files: bad(r) }), affected: ['brakes'],
      check: (b, r) => {
        if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
        expect(b.brakes.files).toEqual(Object.fromEntries(ccrcFileSwitchNames.map((k) => [k, un(r)])));
        expect(b.brakes.settings).toEqual((board().brakes as { settings?: unknown }).settings);
        expect(b.brakes.switches.state).toBe('measured');
      } },
    { name: 'one settings row', over: (r) => ({ settings: new Map([...settingsInput(), ['coordinator-advisor', bad(r)]]) }), affected: ['brakes'],
      check: (b, r) => {
        if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
        const rows = b.brakes.settings ?? {};
        expect(rows['coordinator-advisor']).toEqual(un(r));
        for (const k of settingSwitchNames) if (k !== 'coordinator-advisor') expect(rows[k], k).toEqual({ state: 'measured', ...SETTING_FIXTURE[k] });
        expect(b.brakes.files).toEqual(FILES_OUT);
      } },
    { name: 'readiness', over: (r) => ({ readiness: bad(r) }), affected: ['itself'],
      check: (b, r) => {
        if (b.itself.state !== 'measured') throw new Error('itself is not measured');
        expect(b.itself.readiness).toEqual(un(r));
        expect(b.itself.isolation.state).toBe('measured');
        expect(b.itself.sandbox.state).toBe('measured');
      } },
    { name: 'isolation', over: (r) => ({ isolation: bad(r) }), affected: ['itself'],
      check: (b, r) => {
        if (b.itself.state !== 'measured') throw new Error('itself is not measured');
        expect(b.itself.isolation).toEqual(un(r));
        expect(b.itself.readiness.state).toBe('measured');
      } },
    { name: 'sandbox', over: (r) => ({ sandbox: bad(r) }), affected: ['itself'],
      check: (b, r) => {
        if (b.itself.state !== 'measured') throw new Error('itself is not measured');
        expect(b.itself.sandbox).toEqual(un(r));
        expect(b.itself.readiness.state).toBe('measured');
      } },
    { name: 'timers', over: (r) => ({ timers: bad(r) }), affected: ['timers'], check: (b, r) => expect(b.timers).toEqual(un(r)) },
  ];

  return {
    'every W1 part is present and measured, and the keys are exactly BOARD_PARTS (no later-wave key)': () => {
      const b = board();
      expect(Object.keys(b).sort()).toEqual([...BOARD_PARTS].sort());
      for (const part of BOARD_PARTS) expect(b[part].state, part).toBe('measured');
      expect(BOARD_PARTS).not.toContain('requests');
      expect(BOARD_PARTS).not.toContain('engagement');
    },

    'two programmes\' buckets, items, goals, timers and portfolio rows land under their own slugs': () => {
      const b = board();
      expect(identity(b).map((r) => r.slug)).toEqual(['prog-a', 'prog-b', 'prog-c']);
      expect(goals(b).map((r) => r.slug)).toEqual(['prog-a', 'prog-b', 'prog-c']);
      expect(work(b).map((r) => r.slug)).toEqual(['prog-a', 'prog-b', 'prog-c']);
      expect(rowsOf(b.timers).map((r) => r.slug)).toEqual(['prog-a', 'prog-b', 'prog-c']);
      // work: each slug's buckets and its own items.
      expect(work(b)[0]).toMatchObject({ slug: 'prog-a', currentWave: 2, waveOf: 4, waves: WAVES_A, stuck: 2 });
      expect(work(b)[1]).toMatchObject({ slug: 'prog-b', currentWave: null, waveOf: null, waves: WAVES_B });
      expect(work(b)[0]?.items).toEqual({
        state: 'measured',
        open: [
          { id: 11, kind: 'decide', state: 'open', neededBy: 'blocking', title: { trust: 'untrusted', source: 'item-title', text: 'Item 11' } },
          { id: 12, kind: 'do', state: 'checking', neededBy: 'later', title: { trust: 'untrusted', source: 'item-title', text: 'Item 12' } },
        ],
      });
      expect(work(b)[1]?.items).toEqual({ state: 'measured', open: [] });
      // goals: prog-a's and prog-b's texts stay with their own slug, and the modification count is the pin's.
      expect(measuredGoals(b, 'prog-a')).toMatchObject({ inShort: { text: 'A in short' }, modifications: 2 });
      expect(measuredGoals(b, 'prog-b')).toMatchObject({ inShort: { text: 'B in short' }, modifications: 0 });
      // timers: prog-a's coordinator holds two, prog-b's claimant one, prog-c none.
      expect(rowsOf(b.timers)).toEqual([
        { slug: 'prog-a', pending: 2, nextDueAt: 2000 }, { slug: 'prog-b', pending: 1, nextDueAt: 9000 }, { slug: 'prog-c', pending: 0, nextDueAt: null },
      ]);
      // portfolio: each row keeps its own rank.
      const pf = rowsOf(b.portfolio);
      expect(pf.map((r) => [r.slug, r.cls, r.rank?.position ?? null, r.oldestOpenMs])).toEqual([['prog-a', 'expedite', 1, 1234], ['prog-b', 'standard', null, null]]);
      expect(pf[0]?.wip).toEqual({ working: 1, waiting: 2, queued: 3 });
    },

    'work carries waves exactly as the programmes read answers it, and adds no active count': () => {
      const b = board();
      expect(work(b).map((r) => r.waves)).toEqual([WAVES_A, WAVES_B, WAVES_C]);
      for (const r of work(b)) {
        expect(Object.keys(r)).not.toContain('active');
        expect(Object.keys(r.waves).sort()).toEqual(['done', 'failed', 'queued', 'waiting', 'working']);
      }
      // A read that carries no stuck count is null, never zero; one that carries a count (zero included) keeps it.
      expect(work(b).map((r) => r.stuck)).toEqual([2, null, 0]);
    },

    'a programme\'s lifecycle fields pass through, and an older read without them reads null': () => {
      const rows = identity(board());
      expect(rows.map((r) => [r.lifecycle, r.coordinatorLine])).toEqual([['active', 'led'], [null, null], ['idle', 'no-coordinator']]);
      for (const r of rows) {
        expect(r.shell).toEqual(un('no-reader'));
        expect(r.home).toEqual(un('no-reader'));
      }
    },

    'goal text: an absent verdict is untrusted, a coordinator\'s ratification is untrusted, the operator\'s ratification is not': () => {
      const b = board({
        goals: new Map([
          ['prog-a', ok(goalsA)], ['prog-b', ok(goalsB)],
          // No verdict at all (an older server): both unratified.
          ['prog-c', ok(goalsWith({ inShort: 'C in short', doneWhen: ['c done 1'] }))],
        ]),
      });
      const untrusted = (text: string) => ({ trust: 'untrusted', source: 'goal-text', text });
      const ratified = (text: string) => ({ trust: 'operator-ratified', text });
      // prog-a: operator pin, coordinator definition of done.
      expect(measuredGoals(b, 'prog-a').inShort).toEqual(ratified('A in short'));
      expect(measuredGoals(b, 'prog-a').doneWhen).toEqual([untrusted('a done 1'), untrusted('a done 2')]);
      // prog-b: coordinator pin, operator definition of done (doneWhen follows doneWhenRatification, not the pin's).
      expect(measuredGoals(b, 'prog-b').inShort).toEqual(untrusted('B in short'));
      expect(measuredGoals(b, 'prog-b').doneWhen).toEqual([ratified('b done 1')]);
      // prog-c: absent verdicts.
      expect(measuredGoals(b, 'prog-c').inShort).toEqual(untrusted('C in short'));
      expect(measuredGoals(b, 'prog-c').doneWhen).toEqual([untrusted('c done 1')]);
    },

    'goal text: a verdict that is not ratified is untrusted whatever its source, and an item\'s or a recorded-nothing source never ratifies': () => {
      const verdicts: readonly Ratification[] = [
        { ratified: false, why: 'source-does-not-ratify', source: { kind: 'operator' } },
        { ratified: false, why: 'unrecorded', source: null },
        { ratified: false, why: 'effect-unmeasured', source: { kind: 'item' } },
        { ratified: true, source: { kind: 'item' } },
        COORD,
      ];
      for (const v of verdicts) {
        const b = board({ goals: new Map([['prog-a', ok(goalsWith({ inShort: 'x', doneWhen: ['y'], pinRatification: v, doneWhenRatification: v }))]]) });
        const g = measuredGoals(b, 'prog-a');
        expect(g.inShort, JSON.stringify(v)).toEqual({ trust: 'untrusted', source: 'goal-text', text: 'x' });
        expect(g.doneWhen, JSON.stringify(v)).toEqual([{ trust: 'untrusted', source: 'goal-text', text: 'y' }]);
      }
    },

    'goals with no pin text or no stored definition of done read null, never an empty text': () => {
      const b = board({ goals: new Map([
        ['prog-a', ok(goalsWith({ inShort: null, doneWhen: null }))],
        ['prog-b', ok(goalsWith({ inShort: 'b', doneWhen: [], pinRatification: OP, doneWhenRatification: OP }))],
        ['prog-c', ok({ ...goalsWith(), doneWhen: undefined })],
      ]) });
      expect(measuredGoals(b, 'prog-a')).toEqual({ state: 'measured', inShort: null, doneWhen: null, modifications: 0 });
      expect(measuredGoals(b, 'prog-b').doneWhen).toEqual([]);
      expect(measuredGoals(b, 'prog-c').doneWhen).toBeNull();
    },

    'item titles, programme titles (identity and portfolio) and coordinator session ids are always UntrustedText with their sources': () => {
      const b = board();
      const ids = identity(b);
      expect(ids.map((r) => r.title)).toEqual([
        { trust: 'untrusted', source: 'programme-title', text: 'Programme A title' },
        { trust: 'untrusted', source: 'programme-title', text: 'Programme B title' },
        { trust: 'untrusted', source: 'programme-title', text: 'Programme C title' },
      ]);
      expect(ids.map((r) => r.coordinator)).toEqual([
        { trust: 'untrusted', source: 'session-name', text: A }, { trust: 'untrusted', source: 'session-name', text: B }, null,
      ]);
      for (const r of rowsOf(b.portfolio)) {
        expect(r.title).toEqual({ trust: 'untrusted', source: 'programme-title', text: r.slug === 'prog-a' ? 'Programme A title' : 'Programme B title' });
      }
      // A blocking item's title is an item title too.
      expect(rowsOf(b.portfolio)[0]?.blocking.items).toEqual([{ id: 31, title: { trust: 'untrusted', source: 'item-title', text: 'Blocking item 31' } }]);
      for (const w of work(b)) {
        if (w.items.state !== 'measured') throw new Error('items are unmeasured');
        for (const it of w.items.open) expect(it.title).toEqual({ trust: 'untrusted', source: 'item-title', text: `Item ${it.id}` });
      }
    },

    'a failed reader: each input in turn failing leaves its part unmeasured with the reader\'s reason, and every other part as it was': () => {
      const healthy = board();
      FAILURES.forEach((f, idx) => {
        const reason = BOARD_UNMEASURED[idx % BOARD_UNMEASURED.length]!;
        const b = board(f.over(reason));
        f.check(b, reason);
        for (const part of BOARD_PARTS) {
          if (!f.affected.includes(part)) expect(b[part], `${f.name} failing changed ${part}`).toEqual(healthy[part]);
        }
      });
    },

    'every closed reason is carried as the reader gave it, for each failing reader': () => {
      for (const reason of BOARD_UNMEASURED) {
        const b = board({ programmes: bad(reason), portfolio: bad(reason), capacity: bad(reason), timers: bad(reason) });
        expect(b.identity).toEqual(un(reason));
        expect(b.timers).toEqual(un(reason));
        expect(b.portfolio).toEqual(un(reason));
        expect(b.capacity).toEqual(un(reason));
      }
    },

    'a slug the gatherer did not read is a read that failed, never an empty goals or items part': () => {
      const b = board({ goals: new Map(), items: new Map() });
      for (const slug of ['prog-a', 'prog-b', 'prog-c']) {
        expect(goalsOf(b, slug)).toEqual(un('read-failed'));
        expect(work(b).find((r) => r.slug === slug)?.items).toEqual(un('read-failed'));
      }
    },

    'each part\'s fields are exactly the wire\'s: a composer that adds a field is red': () => {
      const b = board();
      expect(keysOf(b.identity)).toEqual(['programmes', 'state']);
      for (const r of identity(b)) {
        expect(keysOf(r)).toEqual(['coordinator', 'coordinatorLine', 'home', 'lifecycle', 'live', 'shell', 'slug', 'title']);
        expect(keysOf(r.title)).toEqual(['source', 'text', 'trust']);
        if (r.coordinator !== null) expect(keysOf(r.coordinator)).toEqual(['source', 'text', 'trust']);
        if (r.live !== null) expect(keysOf(r.live)).toEqual(['state', 'status']);
        expect(keysOf(r.shell)).toEqual(['reason', 'state']);
        expect(keysOf(r.home)).toEqual(['reason', 'state']);
      }
      expect(keysOf(b.goals)).toEqual(['programmes', 'state']);
      for (const r of goals(b)) {
        expect(keysOf(r)).toEqual(['goals', 'slug']);
        const g = measuredGoals(b, r.slug);
        expect(keysOf(g)).toEqual(['doneWhen', 'inShort', 'modifications', 'state']);
        for (const t of [g.inShort, ...(g.doneWhen ?? [])]) {
          if (t === null) continue;
          expect(keysOf(t)).toEqual(t.trust === 'untrusted' ? ['source', 'text', 'trust'] : ['text', 'trust']);
        }
      }
      expect(keysOf(b.work)).toEqual(['programmes', 'stallNotices', 'state']);
      if (b.work.state === 'measured') expect(keysOf(b.work.stallNotices)).toEqual(['counts', 'since', 'state', 'windowMs']);
      for (const r of work(b)) {
        expect(keysOf(r)).toEqual(['currentWave', 'items', 'slug', 'stuck', 'waveOf', 'waves']);
        expect(keysOf(r.items)).toEqual(['open', 'state']);
        if (r.items.state === 'measured') for (const it of r.items.open) expect(keysOf(it)).toEqual(['id', 'kind', 'neededBy', 'state', 'title']);
      }
      expect(keysOf(b.portfolio)).toEqual(['programmes', 'revision', 'state']);
      for (const r of rowsOf(b.portfolio)) {
        expect(keysOf(r)).toEqual([
          'asksUnmeasured', 'blocking', 'closedWaves', 'cls', 'cycle', 'cycleUnmeasured', 'ended28', 'itemsUnmeasured', 'oldestOpenMs',
          'oldestOpenUnmeasured', 'rank', 'rankUnreadable', 'reviewRounds', 'slug', 'title', 'waitingOnOperatorMs28', 'wip',
        ]);
        expect(keysOf(r.blocking)).toEqual(['asks', 'edges', 'items']);
        for (const it of r.blocking.items) expect(keysOf(it)).toEqual(['id', 'title']);
      }
      expect(keysOf(b.capacity)).toEqual(['maxConcurrentWorkers', 'running', 'state']);
      expect(keysOf(b.projects)).toEqual(['names', 'registry', 'state', 'unreadable']);
      expect(keysOf(b.brakes)).toEqual(['files', 'ladder', 'settings', 'state', 'switches']);
      if (b.brakes.state === 'measured') {
        expect(keysOf(b.brakes.switches)).toEqual(['markers', 'state']);
        // Neither group may be absent or empty, so the loops below cannot pass on nothing.
        expect(keysOf(b.brakes.settings ?? {})).toEqual([...settingSwitchNames].sort());
        expect(keysOf(b.brakes.files ?? {})).toEqual([...ccrcFileSwitchNames].sort());
        expect(settingSwitchNames.length * ccrcFileSwitchNames.length).toBeGreaterThan(0);
        for (const row of [...Object.values(b.brakes.settings ?? {}), ...Object.values(b.brakes.files ?? {})]) {
          if (row.state !== 'measured') expect(keysOf(row)).toEqual(['reason', 'state']);
        }
        for (const row of Object.values(b.brakes.settings ?? {})) if (row.state === 'measured') expect(keysOf(row)).toEqual(['state', 'stored', 'value']);
        for (const row of Object.values(b.brakes.files ?? {})) if (row.state === 'measured') expect(keysOf(row)).toEqual(['state', 'value']);
        expect(keysOf(b.brakes.ladder)).toEqual(['conditions', 'latches', 'operatorRung', 'rung', 'state']);
        if (b.brakes.ladder.state === 'measured') {
          for (const l of b.brakes.ladder.latches) expect(keysOf(l)).toEqual(['cap', 'cause', 'known', 'narrowing', 'raisedAt']);
          for (const c of b.brakes.ladder.conditions) expect(keysOf(c)).toEqual(['cause', 'effect', 'reading']);
        }
      }
      expect(keysOf(b.itself)).toEqual(['isolation', 'readiness', 'sandbox', 'state']);
      if (b.itself.state === 'measured') {
        expect(keysOf(b.itself.readiness)).toEqual(['since', 'state', 'until', 'word']);
        expect(keysOf(b.itself.isolation)).toEqual(['cause', 'state', 'word']);
        expect(keysOf(b.itself.sandbox)).toEqual(['held', 'state']);
      }
      expect(keysOf(b.timers)).toEqual(['programmes', 'state']);
      for (const r of rowsOf(b.timers)) expect(keysOf(r)).toEqual(['nextDueAt', 'pending', 'slug']);
    },

    'no part carries a mail body, a note, a goal modification\'s text or an item\'s why and how (C44)': () => {
      const base = healthyInputs();
      const withSpec = (g: GoalsIn): GoalsIn => Object.assign({ ...g }, { specPath: 'SENTINEL-SPEC-7', specText: 'SENTINEL-SPECTEXT-7' });
      const b = compose({
        ...base,
        goals: new Map([['prog-a', ok(withSpec(goalsA))], ['prog-b', ok(withSpec(goalsB))], ['prog-c', ok(goalsWith())]]),
        items: new Map([['prog-a', ok([itemWithExtras(11), itemWithExtras(12)])], ['prog-b', ok([itemWithExtras(21)])], ['prog-c', ok([])]]),
        timers: ok([{ setter: A, dueAt: 1, note: NOTE }, { setter: B, dueAt: 2, note: 'SENTINEL-NOTE-8' }]),
      });
      const text = JSON.stringify(b);
      expect(text).not.toContain(SENTINEL);
      // The text a part may carry is still there: the pin's "In short" and the definition of done.
      expect(text).toContain('A in short');
      expect(text).toContain('a done 1');
    },

    'size: 50 programmes with 3 open items, 2 doneWhen lines, 2 timers and a portfolio entry each stay under the pinned bound': () => {
      const b = compose(bigInputs(50));
      expect(rowsOf(b.identity)).toHaveLength(50);
      expect(rowsOf(b.timers).every((r) => r.pending === 2)).toBe(true);
      // The measured size, exactly, and the bound with headroom over it.
      expect(JSON.stringify(b).length).toBe(BOARD_50_MEASURED_BYTES);
      expect(JSON.stringify(b).length).toBeLessThan(BOARD_50_BOUND_BYTES);
    },

    'isolation: a measured read maps to measured, an unmeasured one to unmeasured read-failed with the reader\'s own word': () => {
      const measured = board({ isolation: ok({ kind: 'measured', word: 'shared-user', cause: 'same-user' }) });
      if (measured.itself.state !== 'measured') throw new Error('itself is not measured');
      expect(measured.itself.isolation).toEqual({ state: 'measured', word: 'shared-user', cause: 'same-user' });
      for (const why of ['link-down', 'not-wired', 'report-disagrees'] as const) {
        const b = board({ isolation: ok({ kind: 'unmeasured', why }) });
        if (b.itself.state !== 'measured') throw new Error('itself is not measured');
        expect(b.itself.isolation).toEqual({ state: 'unmeasured', reason: 'read-failed', why });
      }
    },

    'a programme with no coordinator has coordinator null and live null; one not in the listing reads not-listed; a failed listing reads unmeasured': () => {
      const noOne = identity(board()).find((r) => r.slug === 'prog-c');
      expect(noOne?.coordinator).toBeNull();
      expect(noOne?.live).toBeNull();
      // prog-a's coordinator is not in this listing; prog-b's claimant is.
      const partial = board({ listing: ok([{ id: B, status: 'dead' }]) });
      expect(identity(partial).map((r) => r.live)).toEqual([
        { state: 'measured', status: 'not-listed' }, { state: 'measured', status: 'dead' }, null,
      ]);
      const full = board();
      expect(identity(full).map((r) => r.live)).toEqual([
        { state: 'measured', status: 'busy' }, { state: 'measured', status: 'idle' }, null,
      ]);
      const none = board({ listing: bad('no-listing') });
      expect(identity(none).map((r) => r.live)).toEqual([un('no-listing'), un('no-listing'), null]);
      // An empty listing is a listing: everyone named is not-listed, never unmeasured.
      expect(identity(board({ listing: ok([]) })).map((r) => r.live)).toEqual([
        { state: 'measured', status: 'not-listed' }, { state: 'measured', status: 'not-listed' }, null,
      ]);
    },

    'the bound coordinator is the programme\'s coordinator, and the run\'s claimant stands in when the read carries no bound one': () => {
      const rows = identity(board());
      // prog-a binds A and its run is claimed by B: the bound session is the coordinator, its status is A's.
      expect(rows[0]?.coordinator?.text).toBe(A);
      expect(rows[0]?.live).toEqual({ state: 'measured', status: 'busy' });
      expect(rows[1]?.coordinator?.text).toBe(B);
      // prog-a's timers are A's (two), never B's.
      expect(rowsOf(board().timers)[0]).toEqual({ slug: 'prog-a', pending: 2, nextDueAt: 2000 });
    },

    'brakes, projects, capacity and readiness are the readers\' own answers': () => {
      const b = board();
      expect(b.capacity).toEqual({ state: 'measured', maxConcurrentWorkers: 6, running: 2 });
      expect(b.projects).toEqual({ state: 'measured', registry: 'listed', names: ['project-a', 'project-b'], unreadable: ['project-z'] });
      expect(b.brakes).toEqual({
        state: 'measured',
        switches: { state: 'measured', markers: { 'mail-disabled': 'set', 'coordinator-paused': 'clear' } },
        settings: Object.fromEntries(Object.entries(SETTING_FIXTURE).map(([k, v]) => [k, { state: 'measured', ...v }])),
        files: FILES_OUT,
        ladder: { state: 'measured', rung: 'chat', operatorRung: 'advise', latches: [LATCH], conditions: [CONDITION] },
      });
      expect(b.itself).toEqual({
        state: 'measured',
        readiness: { state: 'measured', word: 'ready', since: 300, until: null },
        isolation: { state: 'measured', word: 'separate-user', cause: 'other-user' },
        sandbox: { state: 'measured', held: true },
      });
      if (b.work.state !== 'measured') throw new Error('work is not measured');
      expect(b.work.stallNotices).toEqual({ state: 'measured', since: 100, windowMs: 200, counts: [{ row: 'checks', sent: 1, shadow: 2 }] });
      expect(b.portfolio).toMatchObject({ state: 'measured', revision: 4 });
    },

    'every switch of the switchboard is a row of exactly one brakes group, the expectation derived from the table both ways (board B3)': () => {
      const b = board({ switches: ok(readSwitches([])) });
      if (b.brakes.state !== 'measured' || b.brakes.switches.state !== 'measured') throw new Error('brakes are not measured');
      const groups = [Object.keys(b.brakes.switches.markers), Object.keys(b.brakes.settings ?? {}), Object.keys(b.brakes.files ?? {})];
      const all = groups.flat();
      expect([...all].sort()).toEqual(Object.keys(SWITCHES).sort());
      expect(new Set(all).size, 'no switch is a row of two groups').toBe(all.length);
      // Each group is its storage kind's rows, from the table: the settings rows and the fleet host's files.
      expect(groups[1]).toEqual([...settingSwitchNames]);
      expect(groups[2]).toEqual([...ccrcFileSwitchNames]);
      for (const k of groups[1]!) expect('setting' in SWITCHES[k as keyof typeof SWITCHES].storage, k).toBe(true);
      for (const k of groups[2]!) expect('ccrcFile' in SWITCHES[k as keyof typeof SWITCHES].storage, k).toBe(true);
      // The fixture answers every settings row the table has, so a row added to the table reds here until it is read.
      expect(Object.keys(SETTING_FIXTURE).sort()).toEqual([...settingSwitchNames].sort());
    },

    'a settings row the gatherer did not hand over reads read-failed, never a missing row; a row carries its stored word and value only (board B3)': () => {
      const settings = settingsInput();
      settings.delete('overlord-rung');
      settings.set('stall-watch-level', ok(Object.assign({ stored: 'row', value: 'follow' } as BoardSettingIn, { detail: SENTINEL, text: SENTINEL })));
      const b = board({ settings });
      if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
      expect(b.brakes.settings?.['overlord-rung']).toEqual(un('read-failed'));
      expect(b.brakes.settings?.['stall-watch-level']).toEqual({ state: 'measured', stored: 'row', value: 'follow' });
      expect(JSON.stringify(b.brakes)).not.toContain(SENTINEL);
      expect(keysOf(b.brakes.settings ?? {})).toEqual([...settingSwitchNames].sort());
      // A gatherer that hands over no settings rows at all still gives every row, each read-failed.
      const none = board({ settings: new Map() });
      if (none.brakes.state !== 'measured') throw new Error('brakes are not measured');
      expect(none.brakes.settings).toEqual(Object.fromEntries(settingSwitchNames.map((k) => [k, un('read-failed')])));
    },

    'each file row is the reading\'s own: set and clear measured, unmeasurable read-failed, a file it does not name read-failed (board B3)': () => {
      const b = board();
      if (b.brakes.state !== 'measured') throw new Error('brakes are not measured');
      expect(b.brakes.files).toEqual(FILES_OUT);
      const partial = board({ files: ok({ 'graph-gate-off': 'clear' }) });
      if (partial.brakes.state !== 'measured') throw new Error('brakes are not measured');
      expect(partial.brakes.files).toEqual({ 'graph-gate-off': { state: 'measured', value: 'clear' }, 'ccrc-card-off': un('read-failed'), 'compact-card-off': un('read-failed') });
      for (const reason of BOARD_UNMEASURED) {
        const failed = board({ files: bad(reason) });
        if (failed.brakes.state !== 'measured') throw new Error('brakes are not measured');
        expect(failed.brakes.files).toEqual(Object.fromEntries(ccrcFileSwitchNames.map((k) => [k, un(reason)])));
      }
    },

    'the projects part carries the folders the walk could not read as the lister handed them over, in its order (board B3)': () => {
      expect(board({ projects: ok({ registry: 'unlistable', names: ['project-a'], unreadable: ['project-y', 'project-x'] }) }).projects)
        .toEqual({ state: 'measured', registry: 'unlistable', names: ['project-a'], unreadable: ['project-y', 'project-x'] });
      expect(board({ projects: ok({ registry: 'listed', names: [], unreadable: [] }) }).projects)
        .toEqual({ state: 'measured', registry: 'listed', names: [], unreadable: [] });
    },

    'portfolio rows carry the view\'s W1 fields as it gives them: the measures, what blocks, and each unmeasured flag (review 4010 F3)': () => {
      const pf = rowsOf(board().portfolio);
      const title = (text: string) => ({ trust: 'untrusted', source: 'programme-title', text });
      const measures = {
        wip: { working: 1, waiting: 2, queued: 3 }, closedWaves: { days7: 9, days28: 19 }, cycle: { n: 3, medianMs: 77, p85Ms: 88 }, cycleUnmeasured: 1,
        reviewRounds: { rounds: 4, waves: 2 }, ended28: { done: 5, failed: 1, neverStarted: 2 }, waitingOnOperatorMs28: 3600, itemsUnmeasured: 6, asksUnmeasured: 7,
      };
      expect(pf).toEqual([
        { slug: 'prog-a', title: title('Programme A title'), rank: { position: 1, cls: 'expedite', fixedDate: null }, cls: 'expedite', rankUnreadable: false,
          oldestOpenMs: 1234, oldestOpenUnmeasured: 0, ...measures,
          blocking: { items: [{ id: 31, title: { trust: 'untrusted', source: 'item-title', text: 'Blocking item 31' } }], asks: 8, edges: 3 } },
        { slug: 'prog-b', title: title('Programme B title'), rank: null, cls: 'standard', rankUnreadable: true,
          oldestOpenMs: null, oldestOpenUnmeasured: 2, ...measures, blocking: { items: [], asks: 0, edges: null } },
      ]);
    },

    'an unreadable rank is not "unranked" and an unknown age is not "no open wave": the flags keep the two nulls apart': () => {
      const view = portfolioView();
      const plain = { ...view.programmes[1]!, rankUnreadable: undefined, oldestOpenUnmeasured: 0 };
      const b = board({ portfolio: ok({ ...view, programmes: [view.programmes[1]!, plain] } as PortfolioView) });
      const [unreadable, unranked] = rowsOf(b.portfolio);
      // Both read rank null and oldestOpenMs null; only the flags tell them apart.
      expect([unreadable?.rank, unranked?.rank, unreadable?.oldestOpenMs, unranked?.oldestOpenMs]).toEqual([null, null, null, null]);
      expect([unreadable?.rankUnreadable, unranked?.rankUnreadable]).toEqual([true, false]);
      expect([unreadable?.oldestOpenUnmeasured, unranked?.oldestOpenUnmeasured]).toEqual([2, 0]);
    },

    'the view\'s later-wave fields (health, forecast dates, spend, edges, critical path) are not carried': () => {
      const text = JSON.stringify(board().portfolio);
      for (const s of ['SENTINEL-HEALTH-7', 'SENTINEL-EDGE-7', 'SENTINEL-PATH-7', '4000001', '4000002', '4000003', '4000004']) expect(text).not.toContain(s);
    },

    'the brakes carry each standing latch with its cause and cap, and each live condition, as the ladder read hands them over (review 4010 F2)': () => {
      const second: BoardLatch = { cause: 'restore-detected', cap: 'chat', raisedAt: 99, known: false, narrowing: { state: 'done' } };
      const lifted: BoardCondition = { cause: 'no-witness-since-boot', reading: 'lifted', effect: { kind: 'cap', cap: 'advise' } };
      const withDetail = Object.assign({ ...LATCH }, { detail: 'SENTINEL-DETAIL-7' });
      const b = board({ ladder: ok({ rung: 'chat', operatorRung: 'full', latches: [withDetail, second], conditions: [lifted, CONDITION] }) });
      if (b.brakes.state !== 'measured') throw new Error('brakes are unmeasured');
      expect(b.brakes.ladder).toEqual({ state: 'measured', rung: 'chat', operatorRung: 'full', latches: [LATCH, second], conditions: [lifted, CONDITION] });
      expect(JSON.stringify(b)).not.toContain('SENTINEL-DETAIL-7');
      // No latch and no condition is a measured empty list, never unmeasured.
      const none = board({ ladder: ok({ rung: 'full', operatorRung: 'full', latches: [], conditions: [] }) });
      if (none.brakes.state !== 'measured') throw new Error('brakes are unmeasured');
      expect(none.brakes.ladder).toEqual({ state: 'measured', rung: 'full', operatorRung: 'full', latches: [], conditions: [] });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ timersByProgramme

export function timersByProgrammeCases(f: TimersBy): Record<string, SuiteCase> {
  const t = (setter: string, dueAt: number): BoardTimerIn => ({ setter, dueAt, note: NOTE });
  return {
    'three pending timers of one coordinator give pending 3 and the earliest due time, another coordinator\'s timer counted in none of them': () => {
      const rows = [t(A, 3000), t(A, 1000), t(B, 500), t(A, 2000)];
      expect(f(rows, [{ slug: 'prog-a', coordinator: A }])).toEqual([{ slug: 'prog-a', pending: 3, nextDueAt: 1000 }]);
      expect(f(rows, [{ slug: 'prog-b', coordinator: B }])).toEqual([{ slug: 'prog-b', pending: 1, nextDueAt: 500 }]);
    },

    'the earliest due time does not depend on the order the rows come in': () => {
      const due = [5, 1, 9, 3];
      for (const order of [due, [...due].reverse(), [1, 5, 3, 9]]) {
        expect(f(order.map((d) => t(A, d)), [{ slug: 'prog-a', coordinator: A }])[0]).toEqual({ slug: 'prog-a', pending: 4, nextDueAt: 1 });
      }
      // A due time of zero is a due time, not an absence.
      expect(f([t(A, 0), t(A, 7)], [{ slug: 'prog-a', coordinator: A }])[0]).toEqual({ slug: 'prog-a', pending: 2, nextDueAt: 0 });
    },

    'a timer whose setter coordinates no programme is in no programme': () => {
      const rows = [t('lane-z-project-a', 10), t(A, 20)];
      const out = f(rows, [{ slug: 'prog-a', coordinator: A }, { slug: 'prog-b', coordinator: B }]);
      expect(out).toEqual([{ slug: 'prog-a', pending: 1, nextDueAt: 20 }, { slug: 'prog-b', pending: 0, nextDueAt: null }]);
      expect(out.reduce((n, r) => n + r.pending, 0)).toBe(1);
    },

    'a timer\'s note never appears in the output, and a row has exactly its three fields': () => {
      const out = f([t(A, 1), t(A, 2), t(B, 3)], [{ slug: 'prog-a', coordinator: A }, { slug: 'prog-b', coordinator: B }]);
      expect(JSON.stringify(out)).not.toContain(SENTINEL);
      for (const r of out) expect(keysOf(r)).toEqual(['nextDueAt', 'pending', 'slug']);
    },

    'a programme whose coordinator is null counts 0 and has no due time, and no rows give the same': () => {
      expect(f([t(A, 1), t(B, 2)], [{ slug: 'prog-c', coordinator: null }])).toEqual([{ slug: 'prog-c', pending: 0, nextDueAt: null }]);
      expect(f([], [{ slug: 'prog-a', coordinator: A }])).toEqual([{ slug: 'prog-a', pending: 0, nextDueAt: null }]);
      expect(f([t(A, 1)], [])).toEqual([]);
    },

    'two programmes with one coordinator each count the same timers, in the programmes\' order': () => {
      const out = f([t(A, 4), t(A, 6)], [{ slug: 'prog-b', coordinator: A }, { slug: 'prog-a', coordinator: A }]);
      expect(out).toEqual([{ slug: 'prog-b', pending: 2, nextDueAt: 4 }, { slug: 'prog-a', pending: 2, nextDueAt: 4 }]);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------ the mutant sets

const COMPOSE_SET: MutantSet<BoardModule> = {
  modulePath: MODULE,
  suite: (m) => composeBoardCases(m.composeBoard),
  mutants: [
    // C1: the untrusted mark dropped on an unratified goal.
    { id: 'C1a an absent verdict reads ratified', old: "r !== undefined && r.ratified && r.source.kind === 'operator' ?", new: "r === undefined || (r.ratified && r.source.kind === 'operator') ?" },
    { id: 'C1b goal text is operator-ratified whatever its verdict', old: ": untrusted('goal-text', text);", new: ": { trust: 'operator-ratified', text };" },
    { id: 'C1c a verdict that is not ratified reads ratified when its source is the operator', old: 'r !== undefined && r.ratified && r.source.kind', new: 'r !== undefined && r.source?.kind' },
    // C2: a coordinator's ratification trusted.
    { id: 'C2 a coordinator-ratified goal is trusted', old: " && r.source.kind === 'operator' ?", new: ' ?' },
    { id: 'C2b the definition of done follows the pin\'s verdict', old: 'goalText(d, g.doneWhenRatification)', new: 'goalText(d, g.pinRatification)' },
    { id: 'C2c the pin follows the definition of done\'s verdict', old: 'goalText(g.inShort, g.pinRatification)', new: 'goalText(g.inShort, g.doneWhenRatification)' },
    // C3: a failed reader read as an empty part.
    { id: 'C3a the items read failing is an empty open list', old: 'items: partOf(readFor(i.items, p.slug), (open) => ({ open: open.map(item) })),',
      new: "items: ((r) => (r.ok ? { state: 'measured' as const, open: r.value.map(item) } : { state: 'measured' as const, open: [] }))(readFor(i.items, p.slug))," },
    { id: 'C3b a failed read is a measured part', old: "return read.ok ? { state: 'measured', ...f(read.value) } : unmeasured(read.reason);",
      new: "return read.ok ? { state: 'measured', ...f(read.value) } : ({ state: 'measured', capacity: 0, running: 0 } as never);" },
    { id: 'C3c a slug the gatherer did not read is an empty read', old: "m.get(slug) ?? { ok: false, reason: 'read-failed' }", new: "m.get(slug) ?? { ok: true, value: [] as never }" },
    { id: 'C3d a failed programmes read leaves the timers measured and empty', old: 'timers: !programmes.ok ? unmeasured(programmes.reason)', new: "timers: !programmes.ok ? { state: 'measured', programmes: [] }" },
    { id: 'C3e a failed capacity read is zero', old: 'capacity: partOf(i.capacity, (c) => ({ maxConcurrentWorkers: c.maxConcurrentWorkers, running: c.running })),',
      new: "capacity: i.capacity.ok ? { state: 'measured', maxConcurrentWorkers: i.capacity.value.maxConcurrentWorkers, running: i.capacity.value.running } : { state: 'measured', maxConcurrentWorkers: 0, running: 0 }," },
    { id: 'C3f a failed listing reads not-listed', old: ': unmeasured(i.listing.reason);', new: ": { state: 'measured', status: 'not-listed' };" },
    { id: 'C3g a failed isolation read is shared-user', old: 'const iso = i.isolation;', new: "const iso: typeof i.isolation = i.isolation.ok ? i.isolation : { ok: true, value: { kind: 'measured', word: 'shared-user', cause: 'same-user' } };" },
    { id: 'C3h the stall notices read failing is an empty count', old: "partOf(i.stallNotices, (s) => ({ since: s.since, windowMs: s.windowMs, counts: s.counts }))",
      new: "(i.stallNotices.ok ? { state: 'measured' as const, since: i.stallNotices.value.since, windowMs: i.stallNotices.value.windowMs, counts: i.stallNotices.value.counts } : { state: 'measured' as const, since: 0, windowMs: 0, counts: [] })" },
    // C4: session-written text loses its mark.
    { id: 'C4a an item title loses its untrusted mark', old: "title: untrusted('item-title', t.title)", new: 'title: t.title as never' },
    { id: 'C4b a programme title loses its untrusted mark', old: "title: untrusted('programme-title', p.title)", new: 'title: p.title as never' },
    { id: 'C4c a portfolio title loses its untrusted mark', old: "title: untrusted('programme-title', e.title)", new: 'title: e.title as never' },
    { id: 'C4d a coordinator id loses its untrusted mark', old: "untrusted('session-name', who)", new: 'who as never' },
    // C5: the composer decides or adds something.
    { id: 'C5a the claimant outranks the bound coordinator', old: 'p.coordinator ?? p.claimedBy', new: 'p.claimedBy ?? p.coordinator' },
    { id: 'C5b a missing stuck count reads zero', old: 'stuck: p.stuck ?? null', new: 'stuck: p.stuck ?? 0' },
    { id: 'C5c an active count is added to the waves', old: 'waves: p.waves, stuck', new: 'waves: { ...p.waves, active: p.waves.working + p.waves.waiting } as never, stuck' },
    { id: 'C5d the modifications are carried, not counted', old: 'modifications: g.modifications.length,', new: 'modifications: g.modifications as never,' },
    { id: 'C5e a programme with no coordinator reads not-listed', old: 'const live: BoardIdentityRow[\'live\'] = who === null ? null : i.listing.ok', new: "const live: BoardIdentityRow['live'] = i.listing.ok" },
    { id: 'C5f a missing listing entry reads idle', old: "?.status ?? 'not-listed'", new: "?.status ?? 'idle'" },
    { id: 'C5g an item\'s state is dropped', old: 'state: t.state, neededBy: t.neededBy,', new: 'neededBy: t.neededBy,' },
    { id: 'C5h the programme read\'s lifecycle is invented when absent', old: 'lifecycle: p.lifecycle ?? null', new: "lifecycle: p.lifecycle ?? 'unknown'" },
    { id: 'C5i an unmeasured isolation read drops the reader\'s word', old: 'why: iso.value.why }', new: "why: 'not-wired' }" },
    { id: 'C5j a goals row is composed from another slug', old: 'goals: partOf(readFor(i.goals, p.slug), (g) => ({', new: "goals: partOf(readFor(i.goals, 'prog-a'), (g) => ({" },
    { id: 'C5k an item note rides the output', old: 'title: untrusted(\'item-title\', t.title) });', new: "title: untrusted('item-title', t.title), why: (t as { why?: string }).why } as never);" },
    { id: 'C5l the timers carry the programmes read\'s claimant only', old: 'coordinator: coordinatorOf(p) }))', new: 'coordinator: p.claimedBy }))' },
    // Review 4010 F3: the portfolio row's flags, measures and what blocks, each field.
    { id: 'P1 an unreadable rank reads unranked', old: 'rankUnreadable: e.rankUnreadable === true,', new: 'rankUnreadable: false,' },
    { id: 'P2 an unknown age reads no open wave', old: 'oldestOpenUnmeasured: e.oldestOpenUnmeasured ?? null,', new: 'oldestOpenUnmeasured: null,' },
    { id: 'P3 the 7-day closed count is the 28-day one', old: 'closedWaves: e.closedWaves, ', new: 'closedWaves: { days7: e.closedWaves.days28, days28: e.closedWaves.days28 }, ' },
    { id: 'P4 the cycle median is its 85th percentile', old: 'cycle: e.cycle, ', new: 'cycle: { ...e.cycle, medianMs: e.cycle.p85Ms }, ' },
    { id: 'P5 waves the cycle could not time are dropped', old: 'cycleUnmeasured: e.cycleUnmeasured,', new: 'cycleUnmeasured: 0,' },
    { id: 'P6 review rounds are counted per wave', old: 'reviewRounds: e.reviewRounds,', new: 'reviewRounds: { rounds: e.reviewRounds.waves, waves: e.reviewRounds.waves },' },
    { id: 'P7 failed endings are dropped', old: 'ended28: e.ended28,', new: 'ended28: { ...e.ended28, failed: 0 },' },
    { id: 'P8 the time waiting on the operator is zero', old: 'waitingOnOperatorMs28: e.waitingOnOperatorMs28,', new: 'waitingOnOperatorMs28: 0,' },
    { id: 'P9 items the build cannot fold are dropped', old: 'itemsUnmeasured: e.itemsUnmeasured,', new: 'itemsUnmeasured: 0,' },
    { id: 'P10 asks with no live end are dropped', old: 'asksUnmeasured: e.asksUnmeasured,', new: 'asksUnmeasured: 0,' },
    { id: 'P11 a blocking item title loses its untrusted mark', old: "title: untrusted('item-title', b.title)", new: 'title: b.title as never' },
    { id: 'P12 live asks are dropped', old: 'asks: e.blocking.asks,', new: 'asks: 0,' },
    { id: 'P13 uncounted decision edges read zero', old: 'edges: e.blocking.edges ?? null', new: 'edges: e.blocking.edges ?? 0' },
    { id: 'P14 the blocking items are dropped', old: 'items: e.blocking.items.map(', new: 'items: ([] as typeof e.blocking.items).map(' },
    { id: 'P15 a later-wave forecast rides the row', old: 'wip: e.wip, oldestOpenMs', new: 'wip: e.wip, forecast: e.forecast, oldestOpenMs' },
    // Review 4010 F2: the ladder's latches and conditions, each field.
    { id: 'L1 a latch caps at full', old: 'cap: x.cap,', new: "cap: 'full'," },
    { id: 'L2 the latches are dropped', old: 'latches: l.latches.map(latch)', new: 'latches: []' },
    { id: 'L3 every latch cause reads known', old: 'known: x.known,', new: 'known: true,' },
    { id: 'L4 every narrowing reads done', old: 'narrowing: x.narrowing });', new: "narrowing: { state: 'done' } as never });" },
    { id: 'L5 a latch loses when it was raised', old: 'raisedAt: x.raisedAt,', new: 'raisedAt: 0,' },
    { id: 'L6 every condition reads standing', old: 'reading: c.reading,', new: "reading: 'standing' as never," },
    { id: 'L7 a condition loses its effect', old: 'effect: c.effect });', new: "effect: { kind: 'cap', cap: 'off' } as never });" },
    { id: 'L8 the conditions are dropped', old: 'conditions: l.conditions.map(condition)', new: 'conditions: []' },
    { id: 'L9 a latch carries what its reader handed over, detail included', old: 'const latch = (x: BoardLatch): BoardLatch => ({', new: 'const latch = (x: BoardLatch): BoardLatch => ({ ...x,' },
    // Board B3: the brakes' settings rows and files, and the projects walk's unreadable folders.
    { id: 'S1 a settings row the gatherer did not hand over reads no row', old: 'partOf(readFor(i.settings, name), (s) =>',
      new: "partOf(i.settings.get(name) ?? { ok: true, value: { stored: 'absent', value: null } }, (s) =>" },
    { id: 'S2 every settings row reads stored row', old: '({ stored: s.stored, value: s.value })', new: "({ stored: 'row', value: s.value })" },
    { id: 'S3 a settings row loses its value', old: '({ stored: s.stored, value: s.value })', new: '({ stored: s.stored, value: null })' },
    { id: 'S4 a settings row carries what the gatherer handed over, extra fields included', old: '({ stored: s.stored, value: s.value })', new: '({ ...s })' },
    { id: 'S5 the settings rows are the ones handed over, not the table\'s', old: 'Object.fromEntries(settingSwitchNames.map((k) => [k, settingRow(k)]))',
      new: 'Object.fromEntries([...i.settings.keys()].map((k) => [k, settingRow(k)]))' },
    { id: 'S6 the settings rows are dropped from the brakes', old: 'settings: Object.fromEntries(settingSwitchNames.map((k) => [k, settingRow(k)])),', new: '' },
    { id: 'S7 one settings row is read for another', old: '[k, settingRow(k)]', new: "[k, settingRow(k === 'coordinator-advisor' ? 'plain-auto-memory' : k)]" },
    { id: 'F1 an unmeasurable file reads clear', old: "v === 'set' || v === 'clear' ? { state: 'measured', value: v } : unmeasured('read-failed')",
      new: "v === 'set' ? { state: 'measured', value: v } : { state: 'measured', value: 'clear' }" },
    { id: 'F2 a failed file reading is every file clear', old: 'if (!i.files.ok) return unmeasured(i.files.reason);', new: "if (!i.files.ok) return { state: 'measured', value: 'clear' };" },
    { id: 'F3 a failed file reading loses its reason', old: 'if (!i.files.ok) return unmeasured(i.files.reason);', new: "if (!i.files.ok) return unmeasured('read-failed');" },
    { id: 'F4 the file rows are the ones the reading names, not the table\'s', old: 'Object.fromEntries(ccrcFileSwitchNames.map((k) => [k, fileRow(k)]))',
      new: 'Object.fromEntries(Object.keys(i.files.ok ? i.files.value : {}).map((k) => [k, fileRow(k)]))' },
    { id: 'F5 a file the reading does not name reads clear', old: "v === 'set' || v === 'clear' ? { state: 'measured', value: v } : unmeasured('read-failed')",
      new: "v === undefined ? { state: 'measured', value: 'clear' } : v === 'set' || v === 'clear' ? { state: 'measured', value: v } : unmeasured('read-failed')" },
    { id: 'F6 the file rows are dropped from the brakes', old: 'files: Object.fromEntries(ccrcFileSwitchNames.map((k) => [k, fileRow(k)])),', new: '' },
    { id: 'W1 the walk\'s unreadable folders are dropped', old: 'unreadable: p.unreadable }', new: 'unreadable: [] }' },
    { id: 'W2 the walk\'s unreadable folders are left off the part', old: 'names: p.names, unreadable: p.unreadable }', new: 'names: p.names }' },
  ],
};

const TIMERS_SET: MutantSet<BoardModule> = {
  modulePath: MODULE,
  suite: (m) => timersByProgrammeCases(m.timersByProgramme),
  mutants: [
    { id: 'T1 the latest due time instead of the earliest', old: 't.dueAt < nextDueAt', new: 't.dueAt > nextDueAt' },
    { id: 'T2 another coordinator\'s timer is counted', old: 'if (t.setter !== coordinator) continue;', new: '' },
    { id: 'T3 a timer\'s note rides the output row', old: 'return { slug, pending, nextDueAt };', new: 'return { slug, pending, nextDueAt, note: rows[0]?.note } as never;' },
    { id: 'T4 the first timer is not taken as the earliest', old: 'nextDueAt === null || t.dueAt < nextDueAt', new: 't.dueAt < (nextDueAt as number)' },
    { id: 'T6 a pending count steps by two', old: 'pending += 1;', new: 'pending += 2;' },
    { id: 'T7 a due time of zero is no due time', old: 'nextDueAt === null || t.dueAt < nextDueAt', new: '!nextDueAt || t.dueAt < nextDueAt' },
  ],
};

export const BOARD_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#composeBoard`]: COMPOSE_SET as MutantSet<never>,
  [`${KEY}#timersByProgramme`]: TIMERS_SET as MutantSet<never>,
};
