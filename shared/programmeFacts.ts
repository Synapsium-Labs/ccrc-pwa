// Overlord W2, overlaps (spec 2026-11-09 §5.5-5.6; plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlaps.md, Task 1):
// the pair vocabulary, the goal-conflict choice table and the wire a standing pair travels on. Ring: L0, context
// Coordination. The server's deciders (`server/src/coord/overlaps.ts`), its store and the console read this one file, so it
// imports only types from `./api.js` (none today), never `node:*` and nothing outside `shared/`.
//
// Durations are counts of days or hours: the server multiplies them by its own millisecond constants where it uses them,
// so no literal millisecond count is written here (token-shared.test.ts's seven-day census).

/** `overlap`: two programmes' work meets (a refused claim, a radar conflict). `goal-conflict`: two programmes keep
 *  undoing each other (§5.6, question 5). */
export const PAIR_KIND_MAP = { overlap: true, 'goal-conflict': true } as const satisfies Record<string, true>;
export type PairKind = keyof typeof PAIR_KIND_MAP;
export const PAIR_KINDS = Object.keys(PAIR_KIND_MAP) as readonly PairKind[];
export const isPairKind = (v: unknown): v is PairKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAIR_KIND_MAP, v);

/** `<kind>:<a>:<b>` with a < b by code unit. Slugs pass `shapeProgramSlug`, so they hold no `:`. */
export function pairKeyOf(kind: PairKind, x: string, y: string): string {
  return x < y ? `${kind}:${x}:${y}` : `${kind}:${y}:${x}`;
}
/** null: not the grammar, or a >= b. */
export function parsePairKey(key: string): { kind: PairKind; a: string; b: string } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const [kind, a, b] = parts as [string, string, string];
  if (!isPairKind(kind) || a === '' || b === '' || !(a < b)) return null;
  return { kind, a, b };
}

export const GOAL_CONFLICT_WINDOW_DAYS = 14;  // §5.6
export const OVERLAP_LAPSE_HOURS = 24;        // question 8
export const COLLISION_KEEP_HOURS = 48;       // question 4
export const PAIR_PATHS_MAX = 20;             // evidence paths kept on a row
export const PAIR_MAILS_PER_PASS = 5;         // question 10
export const CLAIM_HISTORY_ROWS_MAX = 5000;   // one pass's history read, newest first
export const GOAL_CONFLICT_TRIPLES_MIN = 2;   // question 5: two A, B, A triples (the coordinator's F3 ruling)
export const HOT_PATH_PROGRAMMES = 3;         // question 5: a path this many programmes claimed is set aside
export const GOAL_CONFLICT_STEPS_MAX = 2_000_000; // path comparisons one pass may make before it answers cut
export const PAIR_RATE_WEEKS = 4;             // question 12: the firing rate's weeks

export const PAIR_SOURCE_MAP = { 'claim-collision': true, radar: true, 'claim-history': true } as const satisfies Record<string, true>;
export type PairSource = keyof typeof PAIR_SOURCE_MAP;
export const PAIR_SOURCES = Object.keys(PAIR_SOURCE_MAP) as readonly PairSource[];
export const isPairSource = (v: unknown): v is PairSource =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAIR_SOURCE_MAP, v);
export interface PairEvidence {
  readonly sources: readonly PairSource[];   // sorted, distinct
  readonly paths: readonly string[];         // sorted, distinct, at most PAIR_PATHS_MAX
  readonly pathsCut: boolean;                // more paths were seen, or a radar path was cut
  readonly claimIds: readonly number[];      // sorted, distinct, at most PAIR_PATHS_MAX
  readonly prs: readonly number[];           // sorted, distinct
  readonly triples: number;                  // goal-conflict: disjoint-in-time triples found (2 when it sights); 0 for overlap
  readonly hotPaths: readonly string[];      // goal-conflict: the hot paths set aside, sorted, at most PAIR_PATHS_MAX
}

export const PAIR_CLOSED_MAP = { lapsed: true, 'programme-ended': true, 'goals-changed': true } as const satisfies Record<string, true>;
export type PairClosedWhy = keyof typeof PAIR_CLOSED_MAP;
export const PAIR_CLOSED_WHYS = Object.keys(PAIR_CLOSED_MAP) as readonly PairClosedWhy[];
export const isPairClosedWhy = (v: unknown): v is PairClosedWhy =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PAIR_CLOSED_MAP, v);

/** Question 12: episodes opened per kind in each of the last PAIR_RATE_WEEKS weeks, newest week first. */
export interface PairRateWire { readonly weekEndsAt: number; readonly opened: Readonly<Record<PairKind, number>> }

/** Question 1, answered by item 357: these three rows. `waits`: whose deepening relays wait for the other's landing. */
export const GOAL_CONFLICT_WAITS_MAP = { none: true, a: true, b: true } as const satisfies Record<string, true>;
export type GoalConflictWaits = keyof typeof GOAL_CONFLICT_WAITS_MAP;
export interface GoalConflictChoiceRow {
  readonly label: string;          // `{a}` and `{b}` stand for the pair's slugs
  readonly sentence: string;       // what relays do, one line
  readonly waits: GoalConflictWaits;
  readonly conflict: boolean | null; // the goals.conflict label this ruling gives; null gives none
}
export const GOAL_CONFLICT_CHOICES = {
  'both-stand': { label: 'Both stand', sentence: 'Not a real conflict: relays to either programme proceed.',
    waits: 'none', conflict: false },
  'a-first': { label: '{a} goes first', sentence: 'Relays that deepen the conflict on {b}\'s side wait for {a} to land.',
    waits: 'b', conflict: true },
  'b-first': { label: '{b} goes first', sentence: 'Relays that deepen the conflict on {a}\'s side wait for {b} to land.',
    waits: 'a', conflict: true },
} as const satisfies Record<string, GoalConflictChoiceRow>;
export type GoalConflictChoice = keyof typeof GOAL_CONFLICT_CHOICES;
export const isGoalConflictChoice = (v: unknown): v is GoalConflictChoice =>
  typeof v === 'string' && Object.hasOwn(GOAL_CONFLICT_CHOICES, v);

/** One standing episode, as the portfolio read and the board serve it. */
export interface StandingPairWire {
  readonly key: string; readonly kind: PairKind; readonly a: string; readonly b: string;
  readonly episode: number; readonly firstSeenAt: number; readonly lastSeenAt: number;
  readonly evidence: PairEvidence | 'unreadable';
  readonly ruled: { readonly choice: GoalConflictChoice; readonly at: number; readonly by: string } | 'unreadable' | null;
}
