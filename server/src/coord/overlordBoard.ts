// The Overlord's board, composed (Overlord W1, PR B2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`
// Task 6, questions 3, 4, 17 and 18; spec §5.2 C10, C44). Ring L1, context C5: pure, importing `shared/` types only; no store,
// no `fs`, no fastify, no clock.
//
// IT DECIDES NOTHING. `composeBoard` maps each reader's answer, as the gatherer (`overlordBoardRead.ts`, L3) hands it over, to
// its part: it groups per programme by the slug the readers carry, marks session-written text untrusted (question 17), and turns
// a failed reader into that part's `unmeasured` with the gatherer's closed reason. It ranks nothing, filters nothing beyond the
// grouping, computes no verdict a reader did not already compute, and adds no field its inputs do not carry.
// `timersByProgramme` counts each programme's coordinator's pending timers and finds the earliest due time; it reads no note.
import type { MarkerState, ProgrammeWaves, SessionStatus } from '../../../shared/api.js';
import type { GoalsView, ItemKind, ItemState, NeededBy, Ratification } from '../../../shared/ledgers.js';
import type { CoordinatorLine, ProgrammeLifecycle } from '../../../shared/programmeLifecycle.js';
import type { PortfolioView } from '../../../shared/portfolio.js';
import type { IsolationRead } from '../../../shared/isolation.js';
import type { ReadinessWord } from '../../../shared/overlord-readiness.js';
import type { Rung } from '../../../shared/overlord-ladder.js';
import type {
  BoardGoalsRow, BoardIdentityRow, BoardItem, BoardPortfolioRow, BoardStallNoticeCount, BoardText, BoardTextSource,
  BoardTimersRow, BoardUnmeasured, BoardWorkRow, Measured, OverlordBoard, UntrustedText,
} from '../../../shared/overlordBoard.js';

/** One reader's answer, as the gatherer hands it over: its value, or why it could not be read (a closed word). */
export type BoardRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: BoardUnmeasured };

/** The programmes read's fields the board carries (`ProgrammeRow`, with its lifecycle fields). */
export interface BoardProgrammeIn {
  readonly slug: string; readonly title: string;
  readonly lifecycle?: ProgrammeLifecycle | null; readonly coordinatorLine?: CoordinatorLine; readonly coordinator?: string | null;
  readonly claimedBy: string | null; readonly currentWave: number | null; readonly waveOf: number | null;
  readonly waves: ProgrammeWaves; readonly stuck?: number;
}
/** An open item's fields the board carries; its `why`, `how`, `answer` and `note` never reach the composer's output. */
export interface BoardItemIn { readonly id: number; readonly kind: ItemKind; readonly state: ItemState; readonly neededBy: NeededBy; readonly title: string }
/** A pending timer as the store holds it: who set it, when it is due, and its note, which comes in and never goes out (§3.3.12):
 *  `timersByProgramme` reads `setter` and `dueAt` only. */
export interface BoardTimerIn { readonly setter: string; readonly dueAt: number; readonly note?: string }

export interface BoardInputs {
  readonly programmes: BoardRead<readonly BoardProgrammeIn[]>;
  /** The watcher's listing, each session's id and status. */
  readonly listing: BoardRead<readonly { readonly id: string; readonly status: SessionStatus }[]>;
  /** One goals read per programme, keyed by slug. */
  readonly goals: ReadonlyMap<string, BoardRead<Pick<GoalsView, 'inShort' | 'doneWhen' | 'pinRatification' | 'doneWhenRatification' | 'modifications'>>>;
  /** One open-items read per programme, keyed by slug. */
  readonly items: ReadonlyMap<string, BoardRead<readonly BoardItemIn[]>>;
  readonly stallNotices: BoardRead<{ readonly since: number; readonly windowMs: number; readonly counts: readonly BoardStallNoticeCount[] }>;
  readonly portfolio: BoardRead<PortfolioView>;
  readonly capacity: BoardRead<{ readonly maxConcurrentWorkers: number; readonly running: number }>;
  readonly projects: BoardRead<{ readonly registry: 'listed' | 'unlistable'; readonly names: readonly string[] }>;
  readonly switches: BoardRead<Readonly<Record<string, MarkerState>>>;
  readonly ladder: BoardRead<{ readonly rung: Rung; readonly operatorRung: Rung }>;
  readonly readiness: BoardRead<{ readonly word: ReadinessWord; readonly since: number; readonly until: number | null }>;
  readonly isolation: BoardRead<IsolationRead>;
  readonly sandbox: BoardRead<{ readonly held: boolean }>;
  readonly timers: BoardRead<readonly BoardTimerIn[]>;
}

const untrusted = (source: BoardTextSource, text: string): UntrustedText => ({ trust: 'untrusted', source, text });
const unmeasured = (reason: BoardUnmeasured): { readonly state: 'unmeasured'; readonly reason: BoardUnmeasured } => ({ state: 'unmeasured', reason });
/** A part from one read: its fields when measured, the read's reason otherwise. */
function partOf<T, P extends object>(read: BoardRead<T>, f: (v: T) => P): Measured<P> {
  return read.ok ? { state: 'measured', ...f(read.value) } : unmeasured(read.reason);
}
/** The read a map holds for a slug; a slug the gatherer did not read is a read that failed, never an empty one. */
const readFor = <T>(m: ReadonlyMap<string, BoardRead<T>>, slug: string): BoardRead<T> => m.get(slug) ?? { ok: false, reason: 'read-failed' };

/** Goal text keeps no mark only when the operator ratified its version (question 17, whatever item 328 rules of a coordinator's
 *  ratification). An absent verdict reads unratified. */
function goalText(text: string, r: Ratification | undefined): BoardText {
  return r !== undefined && r.ratified && r.source.kind === 'operator' ? { trust: 'operator-ratified', text } : untrusted('goal-text', text);
}

/** Who a programme's timers belong to: its bound coordinator, else its current run's claimant, else no one. */
const coordinatorOf = (p: BoardProgrammeIn): string | null => p.coordinator ?? p.claimedBy;

/** Each programme's coordinator's pending timers, counted, with the earliest due time; a timer whose setter coordinates no
 *  programme is in none. Reads `setter` and `dueAt` only. */
export function timersByProgramme(rows: readonly BoardTimerIn[], coordinators: readonly { readonly slug: string; readonly coordinator: string | null }[]): BoardTimersRow[] {
  return coordinators.map(({ slug, coordinator }) => {
    let pending = 0;
    let nextDueAt: number | null = null;
    if (coordinator !== null) {
      for (const t of rows) {
        if (t.setter !== coordinator) continue;
        pending += 1;
        if (nextDueAt === null || t.dueAt < nextDueAt) nextDueAt = t.dueAt;
      }
    }
    return { slug, pending, nextDueAt };
  });
}

export function composeBoard(i: BoardInputs): OverlordBoard {
  const programmes = i.programmes;
  const identityRow = (p: BoardProgrammeIn): BoardIdentityRow => {
    const who = coordinatorOf(p);
    const live: BoardIdentityRow['live'] = who === null ? null : i.listing.ok
      ? { state: 'measured', status: i.listing.value.find((s) => s.id === who)?.status ?? 'not-listed' }
      : unmeasured(i.listing.reason);
    return {
      slug: p.slug, title: untrusted('programme-title', p.title), lifecycle: p.lifecycle ?? null, coordinatorLine: p.coordinatorLine ?? null,
      coordinator: who === null ? null : untrusted('session-name', who), live, shell: unmeasured('no-reader'), home: unmeasured('no-reader'),
    };
  };
  const goalsRow = (p: BoardProgrammeIn): BoardGoalsRow => ({
    slug: p.slug,
    goals: partOf(readFor(i.goals, p.slug), (g) => ({
      inShort: g.inShort === null ? null : goalText(g.inShort, g.pinRatification),
      doneWhen: g.doneWhen === undefined || g.doneWhen === null ? null : g.doneWhen.map((d) => goalText(d, g.doneWhenRatification)),
      modifications: g.modifications.length,
    })),
  });
  const item = (t: BoardItemIn): BoardItem => ({ id: t.id, kind: t.kind, state: t.state, neededBy: t.neededBy, title: untrusted('item-title', t.title) });
  const workRow = (p: BoardProgrammeIn): BoardWorkRow => ({
    slug: p.slug, currentWave: p.currentWave, waveOf: p.waveOf, waves: p.waves, stuck: p.stuck ?? null,
    items: partOf(readFor(i.items, p.slug), (open) => ({ open: open.map(item) })),
  });
  const portfolioRow = (e: PortfolioView['programmes'][number]): BoardPortfolioRow => ({
    slug: e.slug, title: untrusted('programme-title', e.title), rank: e.rank, cls: e.cls, wip: e.wip, oldestOpenMs: e.oldestOpenMs,
  });
  const iso = i.isolation;
  return {
    identity: partOf(programmes, (ps) => ({ programmes: ps.map(identityRow) })),
    goals: partOf(programmes, (ps) => ({ programmes: ps.map(goalsRow) })),
    work: partOf(programmes, (ps) => ({ programmes: ps.map(workRow), stallNotices: partOf(i.stallNotices, (s) => ({ since: s.since, windowMs: s.windowMs, counts: s.counts })) })),
    portfolio: partOf(i.portfolio, (v) => ({ revision: v.revision, programmes: v.programmes.map(portfolioRow) })),
    capacity: partOf(i.capacity, (c) => ({ maxConcurrentWorkers: c.maxConcurrentWorkers, running: c.running })),
    projects: partOf(i.projects, (p) => ({ registry: p.registry, names: p.names })),
    brakes: {
      state: 'measured',
      switches: partOf(i.switches, (m) => ({ markers: m })),
      ladder: partOf(i.ladder, (l) => ({ rung: l.rung, operatorRung: l.operatorRung })),
    },
    itself: {
      state: 'measured',
      readiness: partOf(i.readiness, (r) => ({ word: r.word, since: r.since, until: r.until })),
      isolation: !iso.ok ? unmeasured(iso.reason)
        : iso.value.kind === 'measured' ? { state: 'measured', word: iso.value.word, cause: iso.value.cause }
          : { state: 'unmeasured', reason: 'read-failed', why: iso.value.why },
      sandbox: partOf(i.sandbox, (s) => ({ held: s.held })),
    },
    timers: !programmes.ok ? unmeasured(programmes.reason)
      : partOf(i.timers, (rows) => ({ programmes: timersByProgramme(rows, programmes.value.map((p) => ({ slug: p.slug, coordinator: coordinatorOf(p) }))) })),
  };
}

/** The ledger line's count: the programmes the board names, or 0 when the programmes read failed. */
export const boardProgrammeCount = (b: OverlordBoard): number => (b.identity.state === 'measured' ? b.identity.programmes.length : 0);
