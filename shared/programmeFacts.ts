// Programme facts (Overlord W2, spec §5.6 H38): the L0 vocabulary and wire of what the server keeps about a programme as a
// whole. Ring L0, context Coordination (C5): it imports nothing, and each literal union carries its `Record<X, true>` map
// (`rings/wire-totality.test.ts`). Each W2 piece keeps its own headed block below; one piece never edits another's.

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

// ── Remaining work and edges (plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md`, PR A) ─────────
// A coordinator states the waves left as a range with a reason, and what its programme waits on as typed edges, through
// `POST /api/coord/programmes/:slug/remaining`. The server keeps every statement and clears an edge only when it measures
// the edge's target (remaining work B's edge arm).

/** A range bound above this is refused. */
export const REMAINING_WAVES_MAX = 99;
/** A statement's reason, in characters, one line. */
export const REMAINING_REASON_MAX = 300;
export const EDGES_PER_STATEMENT_MAX = 10;
/** The writer refuses a statement that would take a programme past this many open edges (review 2265, F14). */
export const OPEN_EDGES_PER_PROGRAMME_MAX = 20;
/** An edge's why, in characters, one line. */
export const EDGE_WHY_MAX = 200;
/** Remaining work B's measured end of an edge, in characters, cut whole and masked. */
export const EDGE_EVIDENCE_MAX = 300;
/** An edge whose target has read unmeasured this long moves to `target-unmeasurable` and stops blocking (question 3). This
 *  block's one millisecond count, not the overlaps block's: `token-shared.test.ts` holds it as a ruled-separate week. */
export const EDGE_UNMEASURABLE_AFTER_MS = 7 * 86_400_000;
/** Whether the edge arm that clears edges has shipped. Remaining work B sets it true; until then the forecast counts no
 *  edge in `blocking` or health, and lists edges as "clearing not shipped" (review 2265, F1). */
export const EDGE_CLEARING_SHIPPED = false as boolean;

export type EdgeKind = 'needs-landed' | 'needs-decision';
const EDGE_KIND_MAP: Record<EdgeKind, true> = { 'needs-landed': true, 'needs-decision': true };
export const EDGE_KINDS = Object.keys(EDGE_KIND_MAP) as readonly EdgeKind[];

/** Table 5.5a's words an edge can name (question 2). Done tests' vocabulary owns them; remaining work B derives this
 *  list from it, in a move commit. */
export type EdgePredicate = 'run-closed' | 'pr-merged' | 'operator-confirms';
const EDGE_PREDICATE_MAP: Record<EdgePredicate, true> = { 'run-closed': true, 'pr-merged': true, 'operator-confirms': true };
export const EDGE_PREDICATES = Object.keys(EDGE_PREDICATE_MAP) as readonly EdgePredicate[];
export const isEdgePredicate = (w: string): w is EdgePredicate => (EDGE_PREDICATES as readonly string[]).includes(w);

/** What an edge waits on, each shape tied to a row of this tree: a run of another programme; a pull request that run's
 *  recorded lineage lists (the lineage records no repository, so the run's project names it); an item of this
 *  programme that still waits. */
export type EdgeTarget =
  | { readonly predicate: 'run-closed'; readonly runId: number }
  | { readonly predicate: 'pr-merged'; readonly runId: number; readonly pr: number }
  | { readonly predicate: 'operator-confirms'; readonly itemId: number };

/** The kind of edge each target takes. */
export const EDGE_KIND_OF_PREDICATE: Readonly<Record<EdgePredicate, EdgeKind>> = {
  'run-closed': 'needs-landed', 'pr-merged': 'needs-landed', 'operator-confirms': 'needs-decision',
};

export type EdgeState = 'open' | 'met' | 'target-ended' | 'target-unmeasurable';
const EDGE_STATE_MAP: Record<EdgeState, true> = { open: true, met: true, 'target-ended': true, 'target-unmeasurable': true };
export const EDGE_STATES = Object.keys(EDGE_STATE_MAP) as readonly EdgeState[];

/** Why the store refused a statement whose body was good: it would take the programme past `OPEN_EDGES_PER_PROGRAMME_MAX`
 *  open edges. It rides the door's 400 `detail`, never a `refused` or `reject.code`. */
export type RemainingRefusal = 'too-many-open-edges';
const REMAINING_REFUSAL_MAP: Record<RemainingRefusal, true> = { 'too-many-open-edges': true };
export const REMAINING_REFUSALS = Object.keys(REMAINING_REFUSAL_MAP) as readonly RemainingRefusal[];
export const isRemainingRefusal = (w: string): w is RemainingRefusal => (REMAINING_REFUSALS as readonly string[]).includes(w);

/** A target in its ONE canonical form, keys in a fixed order: what `programme_edges.target` stores, so the open-edge
 *  index and the body's duplicate check see two equal targets as equal whatever order their keys were sent in. */
export function edgeTargetKey(t: EdgeTarget): string {
  switch (t.predicate) {
    case 'run-closed': return JSON.stringify({ predicate: t.predicate, runId: t.runId });
    case 'pr-merged': return JSON.stringify({ predicate: t.predicate, runId: t.runId, pr: t.pr });
    case 'operator-confirms': return JSON.stringify({ predicate: t.predicate, itemId: t.itemId });
  }
}

const isPositiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

/** A stored target read back: the shape when the text is one of the three, else null (a newer build's shape, or a text
 *  that is not JSON). Never throws. */
export function parseEdgeTarget(text: string): EdgeTarget | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const n = Object.keys(o).length;
  if (o.predicate === 'run-closed' && n === 2 && isPositiveId(o.runId)) return { predicate: 'run-closed', runId: o.runId };
  if (o.predicate === 'pr-merged' && n === 3 && isPositiveId(o.runId) && isPositiveId(o.pr)) {
    return { predicate: 'pr-merged', runId: o.runId, pr: o.pr };
  }
  if (o.predicate === 'operator-confirms' && n === 2 && isPositiveId(o.itemId)) return { predicate: 'operator-confirms', itemId: o.itemId };
  return null;
}

/** One statement of the waves left, as read. `runId` is the run whose wave boundary it was stated at, null at the plan.
 *  `reason` is session-written: render it as untrusted data. */
export interface RemainingStatement {
  id: number; program: string; at: number; byId: string; runId: number | null; lo: number; hi: number; reason: string;
}

/** One edge, as read. `kind` and `target` are null only for a stored word or shape this build cannot read, and then
 *  `kindUnreadable` or `targetUnreadable` says so: the row is carried, never dropped. A state word this build does not
 *  know reads as `open` with `stateUnreadable`, so a block is never hidden. `unmeasured` marks an open edge whose
 *  target the edge arm last read unmeasured, since `unmeasuredSince`. `why` and `evidence` are session- and
 *  server-written: render them as untrusted data. */
export interface ProgrammeEdge {
  id: number; program: string; kind: EdgeKind | null; target: EdgeTarget | null; why: string; state: EdgeState;
  openedAt: number; openedBy: string; endedAt: number | null; evidence: string | null; unmeasuredSince: number | null;
  kindUnreadable?: true; targetUnreadable?: true; stateUnreadable?: true; unmeasured?: true;
}

/** The door's answer: the statement's id, and the edges it opened (`added`) or found already open (`kept`). */
export interface RemainingAnswer { ok: true; id: number; added: number[]; kept: number[] }
