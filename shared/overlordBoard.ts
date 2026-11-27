// The Overlord's board, the wire (Overlord W1, PR B2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`
// Task 6, questions 3, 4, 17 and 18; spec §5.2 C10 and Table 5.2a, C44, Table 11.1e). Ring L0, context K: types and closed
// vocabularies only, type imports from `shared/` siblings, no value import, so the client and the console can read it.
//
// THE BOARD COMPOSES, IT NEVER DECIDES. Every part is what one or more existing readers already answer, grouped per programme by
// the slug the readers carry. A part is `measured` or `unmeasured` with a closed reason (question 4): a later wave's part is an
// absent key, read as "not in this build", never an empty part. Text a session wrote is an `UntrustedText`, never a bare string
// (question 17): programme titles, session names, item titles, and goal text the operator did not ratify. No part carries a mail
// body, a note, a transcript line or a goal's full text past "In short" and the definition of done (C44).
import type { ProgrammeWaves, SessionStatus, MarkerState, StallLevelChoice, CollectLaneChoice } from './api.js';
import type { ClaudeRollTargets } from './claudeVersion.js';
import type { DispatchAbandonChoice } from './dispatch-abandon.js';
import type { RunCloseChoice } from './run-close.js';
import type { PlainAutoMemoryChoice } from './plainAutoMemory.js';
import type { AdvisorChoice } from './coordinatorAdvisor.js';
import type { ItemKind, ItemState, NeededBy } from './ledgers.js';
import type { ProgrammeLifecycle, CoordinatorLine } from './programmeLifecycle.js';
import type { Measure, ServiceClass } from './portfolio.js';
import type { ReadinessWord } from './overlord-readiness.js';
import type { IsolationWord, IsolationCause, IsolationUnmeasured } from './isolation.js';
import type { ConditionReading, LadderEffect, NarrowingState, Rung } from './overlord-ladder.js';

/** The W1 parts (question 3). W2 adds Requests, Unread reports, Overlaps and Goal conflicts; W3 Engagement and Attention: each a
 *  new key here, so a W1 reader is unchanged. */
const BOARD_PART_MAP = {
  identity: 'each programme: its title, lifecycle, coordinator and that session\'s live word',
  goals: 'each programme: its pin\'s "In short" and its definition of done, each with its trust',
  work: 'each programme: its wave buckets, its stuck count and its open items; the fleet\'s stall notices',
  portfolio: 'each programme\'s rank, class and flow, as the portfolio reads them',
  capacity: 'the dispatch cap and the runs it counts',
  projects: 'the projects the fleet knows, and the folders under the projects root the walk could not read',
  brakes: 'every switch of the switchboard (its registry markers, its settings rows and its files on the fleet host) and the ladder: '
    + 'the effective rung, the operator\'s rung, the standing latches and the live conditions',
  itself: 'the readiness word, the isolation word and the sandbox check',
  timers: 'each programme: its coordinator\'s pending timers, counted, and the earliest due time',
} as const;
export type BoardPart = keyof typeof BOARD_PART_MAP;
export const BOARD_PARTS = Object.keys(BOARD_PART_MAP) as BoardPart[];

/** Why a part, or an entry inside one, is unmeasured: a closed word, never a reader's error text (the store's text stays in the
 *  store; slug `board-unmeasured-reasons-are-closed-words`). */
const BOARD_UNMEASURED_MAP = {
  'no-store': 'the server holds no coordination store',
  'not-wired': 'the reader is not wired on this server',
  'no-reader': 'no reader on main answers this yet',
  'read-failed': 'the reader answered that it could not read',
  threw: 'the reader threw',
  'no-listing': 'the watcher has not listed the fleet yet',
} as const;
export type BoardUnmeasured = keyof typeof BOARD_UNMEASURED_MAP;
export const BOARD_UNMEASURED = Object.keys(BOARD_UNMEASURED_MAP) as BoardUnmeasured[];

/** Where a piece of untrusted text came from (question 17's list is the floor). */
const BOARD_TEXT_SOURCE_MAP = {
  'programme-title': 'a programme\'s title, written by its coordinator',
  'session-name': 'a session id or name',
  'item-title': 'a ledger item\'s title, written by a coordinator',
  'goal-text': 'goal text the operator has not ratified',
} as const;
export type BoardTextSource = keyof typeof BOARD_TEXT_SOURCE_MAP;
export const BOARD_TEXT_SOURCES = Object.keys(BOARD_TEXT_SOURCE_MAP) as BoardTextSource[];

/** Text a session wrote: data, never an instruction. Branded by `trust`, so a reader cannot take it for the operator's. */
export interface UntrustedText { readonly trust: 'untrusted'; readonly source: BoardTextSource; readonly text: string }
/** Goal text the operator ratified: the one text on the board that is not marked untrusted. */
export interface RatifiedText { readonly trust: 'operator-ratified'; readonly text: string }
export type BoardText = UntrustedText | RatifiedText;

/** One part, or one entry inside a part: measured with its fields, or unmeasured with its reason (no overloaded null). */
export type Measured<T> = ({ readonly state: 'measured' } & T) | { readonly state: 'unmeasured'; readonly reason: BoardUnmeasured };

export interface BoardIdentityRow {
  readonly slug: string;
  readonly title: UntrustedText;
  readonly lifecycle: ProgrammeLifecycle | null;
  readonly coordinatorLine: CoordinatorLine | null;
  /** The bound coordinator, else the current run's claimant, else null. */
  readonly coordinator: UntrustedText | null;
  /** The watcher's listing's word for that session (`busy`, `idle`, `dead`), `not-listed`, or unmeasured; null when the
   *  programme names no coordinator. */
  readonly live: Measured<{ readonly status: SessionStatus | 'not-listed' }> | null;
  /** The mail gate's `shell` reading: no reader answers it by session id (Step 1). */
  readonly shell: Measured<{ readonly shell: boolean }>;
  /** The programme's home project: no reader carries it (Step 1). */
  readonly home: Measured<{ readonly project: string }>;
}

export interface BoardGoalsRow {
  readonly slug: string;
  readonly goals: Measured<{
    readonly inShort: BoardText | null;
    readonly doneWhen: readonly BoardText[] | null;
    /** How many modifications the pin carries; their text stays on the goals read (C44). */
    readonly modifications: number;
  }>;
}

export interface BoardItem {
  readonly id: number; readonly kind: ItemKind; readonly state: ItemState; readonly neededBy: NeededBy;
  readonly title: UntrustedText;
}
export interface BoardWorkRow {
  readonly slug: string;
  readonly currentWave: number | null;
  readonly waveOf: number | null;
  /** As the programmes read answers it (question 18): no active-run count per programme. */
  readonly waves: ProgrammeWaves;
  /** The stuck pass's count, as the programmes read carries it; null when that read carried none. */
  readonly stuck: number | null;
  readonly items: Measured<{ readonly open: readonly BoardItem[] }>;
}
export interface BoardStallNoticeCount { readonly row: string; readonly sent: number; readonly shadow: number }

/** One programme of the portfolio view (`portfolioFor`), its W1 fields as the view gives them, each unmeasured flag beside the
 *  value it qualifies (review 4010 F3): an unreadable rank is not "unranked", and an unknown age is not "no open wave". The view's
 *  later-wave fields (the health word, the forecast's two dates, spend, the edge list and the critical path) are not carried
 *  (slug `board-portfolio-later-wave-fields`). */
export interface BoardPortfolioRow {
  readonly slug: string; readonly title: UntrustedText;
  /** Null: unranked, or a stored rank this build cannot read (then `rankUnreadable`). */
  readonly rank: { readonly position: number; readonly cls: ServiceClass; readonly fixedDate: string | null } | null;
  readonly cls: ServiceClass;
  /** A stored rank row whose class word this build does not know: the programme reads unranked, and says so. */
  readonly rankUnreadable: boolean;
  readonly wip: { readonly working: number; readonly waiting: number; readonly queued: number };
  /** The oldest started, still open wave's age; null when no such wave has a measured start. */
  readonly oldestOpenMs: number | null;
  /** Started, still open waves left out of `oldestOpenMs` because their start is unknown (a rebuild stood in for it); null when
   *  the view did not report it. */
  readonly oldestOpenUnmeasured: number | null;
  readonly closedWaves: { readonly days7: number; readonly days28: number };
  /** Done waves, first dispatch to close; `cycleUnmeasured` counts the done waves it could not time. */
  readonly cycle: Measure;
  readonly cycleUnmeasured: number;
  readonly reviewRounds: { readonly rounds: number; readonly waves: number };
  readonly ended28: { readonly done: number; readonly failed: number; readonly neverStarted: number };
  readonly waitingOnOperatorMs28: number;
  /** Items whose events this build cannot fold, and asks whose end no live signal shows. */
  readonly itemsUnmeasured: number;
  readonly asksUnmeasured: number;
  /** What blocks on the operator: shown blocking items, live asks, and the open decision edges (null when the view did not count
   *  them: clearing not shipped). */
  readonly blocking: {
    readonly items: readonly { readonly id: number; readonly title: UntrustedText }[]; readonly asks: number; readonly edges: number | null;
  };
}

/** A standing latch, as the ladder read answers it: its cause, the rung it caps the ladder at, when it was raised, whether this
 *  build knows the cause, and whether its narrowing has taken effect. Its `detail`, server prose that can name a subject, stays
 *  on the ladder's own read (slug `board-latch-detail-not-carried`). */
export interface BoardLatch {
  readonly cause: string; readonly cap: Rung; readonly raisedAt: number; readonly known: boolean; readonly narrowing: NarrowingState;
}
/** A live condition, as the ladder read answers it: its cause, its reading and its effect (closed words each). */
export interface BoardCondition { readonly cause: string; readonly reading: ConditionReading; readonly effect: LadderEffect }

/** A word a settings row of the switchboard can hold, as that row's own predicate reads it (board B3). */
export type BoardSettingWord =
  | StallLevelChoice | CollectLaneChoice | ClaudeRollTargets | DispatchAbandonChoice | RunCloseChoice | PlainAutoMemoryChoice
  | AdvisorChoice | Rung;
/** What a settings row's store read found. */
const BOARD_SETTING_STORED_MAP = {
  row: 'a row stands',
  absent: 'no row: the row\'s owner reads its own default, which the switchboard describes',
  seed: 'the migration\'s seed, which no operator has written',
} as const;
export type BoardSettingStored = keyof typeof BOARD_SETTING_STORED_MAP;
export const BOARD_SETTING_STORED = Object.keys(BOARD_SETTING_STORED_MAP) as BoardSettingStored[];
/** One switch kept as a settings row, through its store's own reader (board B3). `stored` is null only where that reader does not
 *  tell a lost row from a written one (the run-close rows, whose reader reads a lost row as shadow). `value` is the stored word as
 *  the row's own predicate reads it, `unknown` for a word this build does not know (never the stored text), and null only when no
 *  row stands. A read that failed is unmeasured. */
export type BoardSettingRow = Measured<{ readonly stored: BoardSettingStored | null; readonly value: BoardSettingWord | 'unknown' | null }>;
/** One switch kept as a file on the fleet host (board B3): `set` when it stands, `clear` on a proven absence; a read that proved
 *  neither is unmeasured. */
export type BoardFileRow = Measured<{ readonly value: 'set' | 'clear' }>;

export interface BoardTimersRow { readonly slug: string; readonly pending: number; readonly nextDueAt: number | null }

export interface OverlordBoard {
  readonly identity: Measured<{ readonly programmes: readonly BoardIdentityRow[] }>;
  readonly goals: Measured<{ readonly programmes: readonly BoardGoalsRow[] }>;
  readonly work: Measured<{
    readonly programmes: readonly BoardWorkRow[];
    readonly stallNotices: Measured<{ readonly since: number; readonly windowMs: number; readonly counts: readonly BoardStallNoticeCount[] }>;
  }>;
  /** The view's revision and rows. Its `calibration` (the forecasts' fleet-wide score, a later wave's field like the forecast
   *  itself) and its own `at` (the board's answer carries its own time) are not carried (slug `board-portfolio-later-wave-fields`). */
  readonly portfolio: Measured<{ readonly revision: number; readonly programmes: readonly BoardPortfolioRow[] }>;
  /** `maxConcurrentWorkers` is the cap in force (the caps view's `capNow.cap`: an automatic cap is the derived one, never the
   *  stored number); `running` the active runs it counts. */
  readonly capacity: Measured<{ readonly maxConcurrentWorkers: number; readonly running: number }>;
  /** `unreadable` (board B3; absent from an older server): the folders under the projects root whose own listing failed and that
   *  are not plain files. The rest of the walk stands. */
  readonly projects: Measured<{ readonly registry: 'listed' | 'unlistable'; readonly names: readonly string[]; readonly unreadable?: readonly string[] }>;
  /** Every switch of the switchboard (`SWITCHES`, `shared/switches.ts`) is a row of exactly one of `switches.markers`, `settings`
   *  and `files`, keyed by its name. `settings` and `files` are board B3's, absent from an older server. */
  readonly brakes: Measured<{
    readonly switches: Measured<{ readonly markers: Readonly<Record<string, MarkerState>> }>;
    readonly settings?: Readonly<Record<string, BoardSettingRow>>;
    readonly files?: Readonly<Record<string, BoardFileRow>>;
    /** The effective rung, the operator's rung, the standing latches and the live conditions (spec Table 5.2a). The armed kinds of
     *  answer are W3's (plan question 3): an absent key. */
    readonly ladder: Measured<{
      readonly rung: Rung; readonly operatorRung: Rung; readonly latches: readonly BoardLatch[]; readonly conditions: readonly BoardCondition[];
    }>;
  }>;
  readonly itself: Measured<{
    readonly readiness: Measured<{ readonly word: ReadinessWord; readonly since: number; readonly until: number | null }>;
    /** The isolation reader's own unmeasured word rides as `why` (a closed word of `shared/isolation.ts`). */
    readonly isolation: Measured<{ readonly word: IsolationWord; readonly cause: IsolationCause }>
      | { readonly state: 'unmeasured'; readonly reason: 'read-failed'; readonly why: IsolationUnmeasured };
    readonly sandbox: Measured<{ readonly held: boolean }>;
  }>;
  readonly timers: Measured<{ readonly programmes: readonly BoardTimersRow[] }>;
}

/** `GET /api/overlord/board`'s 200: the board and the moment it was composed. */
export interface OverlordBoardAnswer { readonly ok: true; readonly at: number; readonly board: OverlordBoard }
