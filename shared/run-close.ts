// D-8077 (spec 2026-11-04 §12.3, A15, o7, o12; the runs rebuild, Task 26): ARMING THE RUN-CLOSE LANES FROM THE UI. L0: the PWA
// bundles `shared/`, so this file takes no value import and no `node:` module. It holds the vocabulary of the switch behind
// `GET`/`POST /api/coord/run-close`, its wire view, and the words the Advanced screen reads.
//
// Each lane GROUP has a three-state control: off, shadow, on. The default is shadow. Storage is the D-7319 shape, a settings row
// (`run_close_settings`), and a hand-made marker stays only as an emergency override: a standing marker arms its group whatever
// the row says. Only an exact `on` arms and only an exact `off` stops; any other token a newer build writes reads as shadow.
import type { MarkerState } from './api.js';

/** The lane groups the control covers: E1 and E1r arm together (the never-started group), and the kept crash row is its own. */
export const RUN_CLOSE_GROUPS = ['never-started', 'claimant-crashed'] as const;
export type RunCloseGroup = (typeof RUN_CLOSE_GROUPS)[number];
export const isRunCloseGroup = (v: unknown): v is RunCloseGroup => typeof v === 'string' && (RUN_CLOSE_GROUPS as readonly string[]).includes(v);

/** The three stored choices. */
export const RUN_CLOSE_CHOICES = ['off', 'shadow', 'on'] as const;
export type RunCloseChoice = (typeof RUN_CLOSE_CHOICES)[number];
export const RUN_CLOSE_DEFAULT_CHOICE: RunCloseChoice = 'shadow';
export const isRunCloseChoice = (v: unknown): v is RunCloseChoice => typeof v === 'string' && (RUN_CLOSE_CHOICES as readonly string[]).includes(v);
/** What a stored token means: an exact `on` or `off`, and shadow for everything else (a lost row, a token a newer build wrote). */
export const runCloseChoiceOf = (raw: unknown): RunCloseChoice => (raw === 'on' || raw === 'off' ? raw : RUN_CLOSE_DEFAULT_CHOICE);

/** Is a group armed? A standing marker (the emergency override) or an exact `on` in the row. */
export const runCloseGroupArmed = (markerSet: boolean, choice: RunCloseChoice): boolean => markerSet || choice === 'on';

/** Why a row reads held (o12). */
export const RUN_CLOSE_HELD = {
  coordination: 'coordination-paused',
  reclaim: 'cleanup-paused',
  registry: 'registry-unread',
} as const;
export type RunCloseHeld = (typeof RUN_CLOSE_HELD)[keyof typeof RUN_CLOSE_HELD];

/** The state word a row shows. `held` is a pause or a registry that would not list: nothing can be armed. */
export type RunCloseState = RunCloseChoice | 'held';

/** Why a run the lane reads would close once the group is on (the spec's reasons, one per row of the lane). */
export const RUN_CLOSE_WHY = {
  neverStarted: 'never-started',
  reviewOfClosed: 'review-of-closed',
  laterReview: 'later-review',
  /** The crash row: an open run of a coordinator measured crashed, closed once the hour and the two passes are spent. */
  claimantCrashed: 'claimant-crashed',
} as const;
export type RunCloseWhy = (typeof RUN_CLOSE_WHY)[keyof typeof RUN_CLOSE_WHY];

/** A run the group would close, and when: `at` is the moment its time runs out (epoch ms). */
export interface RunCloseWould { readonly runId: number; readonly program: string; readonly why: RunCloseWhy; readonly at: number }
/** A run the row fits that the lane would not close (the lane holds it, or its warning cannot be delivered), and the lane's word. */
export interface RunCloseNamed { readonly runId: number; readonly program: string; readonly why: string }

/** What the lane read on its last pass, per group. Absent group: the lane did not read it. */
export interface RunCloseReading {
  readonly at: number;
  readonly groups: Partial<Record<RunCloseGroup, { readonly would: readonly RunCloseWould[]; readonly named: readonly RunCloseNamed[] }>>;
}

/** The would-close list as a sheet and a row read it. `now` and `later` count `would` only: `now` is every run whose time has
 *  already run out, `later` the rest. */
export interface RunCloseList {
  readonly would: readonly RunCloseWould[];
  readonly named: readonly RunCloseNamed[];
  readonly now: number;
  readonly later: number;
}

export interface RunCloseGroupView {
  readonly group: RunCloseGroup;
  readonly choice: RunCloseChoice;
  /** The group's marker in the registry (the emergency override). */
  readonly marker: MarkerState;
  readonly state: RunCloseState;
  readonly held: RunCloseHeld | null;
  /** Null while held, while off, and before the group's lane has read it: no list is drawn. */
  readonly list: RunCloseList | null;
  /** Runs the group closed, and refusals it met, over the last 7 days. */
  readonly closed7d: number;
  readonly refused7d: number;
  readonly updatedAt: number | null;
}

/** `GET /api/coord/run-close`. */
export interface RunCloseView { readonly groups: readonly RunCloseGroupView[] }

/** `POST /api/coord/run-close`'s body. */
export interface RunCloseRequest { readonly group: RunCloseGroup; readonly choice: RunCloseChoice }

/** The codes the POST refuses with, spelled once. */
export const RUN_CLOSE_REFUSALS = ['bad-request', 'not-configured', 'state-unreadable', 'coordination-paused', 'registry-unread'] as const;
export type RunCloseRefusal = (typeof RUN_CLOSE_REFUSALS)[number];
export const isRunCloseRefusal = (v: unknown): v is RunCloseRefusal => typeof v === 'string' && (RUN_CLOSE_REFUSALS as readonly string[]).includes(v);

/** Counts a list into `now` and `later`, with the clock an argument. */
export function runCloseListOf(would: readonly RunCloseWould[], named: readonly RunCloseNamed[], nowMs: number): RunCloseList {
  const now = would.filter((w) => w.at <= nowMs).length;
  return { would, named, now, later: would.length - now };
}
