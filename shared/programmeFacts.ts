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
/** How long an edge's target may keep answering unmeasured before the edge moves to `target-unmeasurable` and stops
 *  blocking; a measured answer before then resets the clock. Seven days is the plan's ruled exit (question 3, review
 *  2265): long enough that a reader down for a few days never releases a block it could still measure, short enough
 *  that a target nothing can read stops holding the forecast within a week. Its own fact, not any other week: it only
 *  shares the number (`token-shared.test.ts` names it in a row of its own). This block's one millisecond count. */
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

// ── Forecasts (plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md`, PR A) ─────────────────────
// The server forecasts when a programme will land: a seeded Monte Carlo over its past wave lead times
// (`server/src/coord/forecast.ts#forecastProgramme`), sealed at each wave boundary by the forecast lane into
// `programme_forecasts`, and scored at its 85% date against measured closes alone (`forecastOutcome`). No model and no
// session ever produces a date.

/** Trials per forecast. */
export const FORECAST_TRIALS = 10_000;
/** A programme forecasts from its own history once it has this many done leads, else from the fleet's. */
export const FORECAST_OWN_MIN = 20;
/** The fleet's history serves once it has this many done leads, else the programme is `unforecastable`. */
export const FORECAST_FLEET_MIN = 20;
/** The most abandoned leads one wave of a trial can lose before its done lead (question 3). */
export const ABANDON_REDRAWS_MAX = 3;
/** Question 4: a close no statement names waits this long for its boundary's statement, then seals with the newest
 *  statement standing at that time. */
export const SEAL_WAIT_MINUTES = 30;
/** The seal arm looks back this far for a close with no seal; one closed during a longer gap is never sealed. */
export const SEAL_LOOKBACK_DAYS = 7;

/** One source's samples (question 3): `done`, `abandoned` and `rework` lead times in ms, each finite and above zero;
 *  `waves`, `abandons` and `reworks` the counts the two shares are taken from. `leadsUnmeasured` counts the waves the
 *  store could not measure (a rebuilt run, a lead that is not a finite number above zero): never a sample. */
export interface LeadHistory {
  readonly done: readonly number[]; readonly abandoned: readonly number[]; readonly rework: readonly number[];
  readonly waves: number; readonly abandons: number; readonly reworks: number; readonly leadsUnmeasured: number;
}

export const FORECAST_SOURCE_MAP = { own: true, fleet: true } as const satisfies Record<string, true>;
export type ForecastSource = keyof typeof FORECAST_SOURCE_MAP;
export const FORECAST_SOURCES = Object.keys(FORECAST_SOURCE_MAP) as readonly ForecastSource[];
export const isForecastSource = (v: unknown): v is ForecastSource =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORECAST_SOURCE_MAP, v);

/** Why a programme has no forecast: no statement stood, the statement says nothing is left, or neither its own history
 *  nor the fleet's has enough done leads. */
export const UNFORECASTABLE_REASON_MAP = { 'no-remaining': true, 'nothing-left': true, 'too-little-history': true } as const satisfies Record<string, true>;
export type UnforecastableReason = keyof typeof UNFORECASTABLE_REASON_MAP;
export const UNFORECASTABLE_REASONS = Object.keys(UNFORECASTABLE_REASON_MAP) as readonly UnforecastableReason[];
export const isUnforecastableReason = (v: unknown): v is UnforecastableReason =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(UNFORECASTABLE_REASON_MAP, v);

export const FORECAST_KIND_MAP = { forecast: true, unforecastable: true } as const satisfies Record<string, true>;
export type ForecastKind = keyof typeof FORECAST_KIND_MAP;
export const FORECAST_KINDS = Object.keys(FORECAST_KIND_MAP) as readonly ForecastKind[];
export const isForecastKind = (v: unknown): v is ForecastKind =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORECAST_KIND_MAP, v);

/** A forecast: the median and 85% dates (epoch ms), the source's done leads `n`, and the seed that replays it. */
export type Forecast =
  | { readonly kind: 'forecast'; readonly medianAt: number; readonly p85At: number; readonly n: number;
      readonly source: ForecastSource; readonly seed: number }
  | { readonly kind: 'unforecastable'; readonly reason: UnforecastableReason };

/** A seal's stored outcome: `open` until the score arm reads it at its 85% date. */
export const SEAL_OUTCOME_MAP = { open: true, met: true, missed: true } as const satisfies Record<string, true>;
export type SealOutcome = keyof typeof SEAL_OUTCOME_MAP;
export const SEAL_OUTCOMES = Object.keys(SEAL_OUTCOME_MAP) as readonly SealOutcome[];
export const isSealOutcome = (v: unknown): v is SealOutcome =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(SEAL_OUTCOME_MAP, v);

/** `forecastOutcome`'s answer: `none` writes nothing (not yet due, nothing to score, or already scored). */
export const FORECAST_VERDICT_MAP = { none: true, met: true, missed: true } as const satisfies Record<string, true>;
export type ForecastVerdict = keyof typeof FORECAST_VERDICT_MAP;
export const FORECAST_VERDICTS = Object.keys(FORECAST_VERDICT_MAP) as readonly ForecastVerdict[];

/** One sealed forecast, as read. `closingRunId` is the work run whose close is its boundary; `asOf` the boundary it is
 *  computed as of; `statementId`, `lo` and `hi` the statement it used, null when none stood. A stored word this build
 *  cannot read makes the row `unreadable`, carried, never dropped and never scored. */
export interface SealedForecast {
  readonly id: number; readonly program: string; readonly closingRunId: number; readonly sealedAt: number; readonly asOf: number;
  readonly statementId: number | null; readonly lo: number | null; readonly hi: number | null;
  readonly forecast: Forecast | 'unreadable'; readonly outcome: SealOutcome | 'unreadable'; readonly scoredAt: number | null;
}

/** Calibration (question 6, M30): the share of scored seals met must stay inside this band, edges included. */
export const CALIBRATION_BAND: readonly [number, number] = [0.75, 0.9];
/** A cut with fewer scored seals than this is unmeasured. */
export const CALIBRATION_MIN_N = 8;
/** Four cuts, now and 7, 14 and 21 days before; each reads the seals scored in the 28 days before it. */
export const CALIBRATION_CUTS = 4;
export const CALIBRATION_CUT_STEP_DAYS = 7;
export const CALIBRATION_WINDOW_DAYS = 28;

export const CALIBRATION_STATE_MAP = { calibrated: true, uncalibrated: true, unmeasured: true } as const satisfies Record<string, true>;
export type CalibrationState = keyof typeof CALIBRATION_STATE_MAP;
export const CALIBRATION_STATES = Object.keys(CALIBRATION_STATE_MAP) as readonly CalibrationState[];

/** One cut: its time, the seals scored in the window before it, how many were met, and the share met (null under
 *  `CALIBRATION_MIN_N`, never 0). */
export interface CalibrationCut { readonly at: number; readonly n: number; readonly met: number; readonly share: number | null }
export interface Calibration { readonly state: CalibrationState; readonly cuts: readonly CalibrationCut[] }

// ── Health (plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-forecasts-health.md`, PR B) ──────────────────────────
// A programme's health is one word with its evidence, first match wins (spec §5.6 H38), decided by
// `server/src/coord/programmeHealth.ts#programmeHealth` in the forecast lane's health arm alone and recorded as a
// `programme_health` row on a change; the portfolio shows the newest row. Durations are counts of days or hours, as
// above: the server multiplies them by its own millisecond constants.

/** §5.6's words, worst first: a word's index is its rank, and a lower index is worse. */
export const PROGRAMME_HEALTH_WORD_MAP = {
  'blocked-on-you': true, slipping: true, stalled: true, aging: true, churning: true, 'scope-growing': true, burning: true,
  steady: true,
} as const satisfies Record<string, true>;
export type ProgrammeHealthWord = keyof typeof PROGRAMME_HEALTH_WORD_MAP;
export const PROGRAMME_HEALTH_WORDS = Object.keys(PROGRAMME_HEALTH_WORD_MAP) as readonly ProgrammeHealthWord[];
export const isProgrammeHealthWord = (v: unknown): v is ProgrammeHealthWord =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROGRAMME_HEALTH_WORD_MAP, v);

/** The health limits (question 8, ruled as starting values, revisited after a month of `programme_health` rows). */
/** `slipping`: the newest 85% date moved this many days later than the previous seal's. */
export const HEALTH_SLIP_DAYS = 7;
/** `stalled`: no state change of an open work run for this many hours while work is in progress. */
export const HEALTH_STALLED_HOURS = 48;
/** `aging`: the programme's own 85th percentile cycle is the reference from this many done waves, else the fleet's. */
export const HEALTH_OWN_CYCLE_MIN = 5;
/** `churning`: review rounds per closed wave above this (ruled `>`), over the window. */
export const HEALTH_CHURN_ROUNDS = 2;
/** `churning`: reworked waves above this (ruled `>`), over the window. */
export const HEALTH_CHURN_REOPENS = 2;
/** `scope-growing`: the range grew by at least this many waves since the window's oldest statement. */
export const HEALTH_SCOPE_GROWTH_WAVES = 2;
/** `burning`: the recent median spend per wave at least this many times the earlier one. */
export const HEALTH_BURN_FACTOR = 2;
/** `burning`: measured waves in each window. */
export const HEALTH_BURN_MIN_WAVES = 3;
/** The window churn, scope and spend read over; spend compares it with the window before it. */
export const HEALTH_WINDOW_DAYS = 28;

/** A `run_spend` row's state: `measured` (a cost was read), `absent` (the run left no spend record) or `outside` (the run's
 *  spend is not this fleet's to read). */
export const RUN_SPEND_STATE_MAP = { measured: true, absent: true, outside: true } as const satisfies Record<string, true>;
export type RunSpendState = keyof typeof RUN_SPEND_STATE_MAP;
export const RUN_SPEND_STATES = Object.keys(RUN_SPEND_STATE_MAP) as readonly RunSpendState[];
export const isRunSpendState = (v: unknown): v is RunSpendState =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(RUN_SPEND_STATE_MAP, v);

/** One run_spend row as read; a state word this build cannot read is 'unreadable', read as unmeasured, never 0. */
export interface RunSpendRow {
  readonly runId: number; readonly at: number; readonly state: RunSpendState | 'unreadable';
  readonly cost: number | null; readonly class: string | null; readonly readAt: number | null;
}

/** What a health word was decided from: the matched arm's name (`<word>:<arm>`, null for `steady`), its inputs by name,
 *  and every input the facts could not measure. */
export interface HealthEvidence {
  readonly matched: string | null;
  readonly values: Readonly<Record<string, number | string | boolean | null>>;
  readonly unmeasured: readonly string[];
}
export interface HealthVerdict { readonly word: ProgrammeHealthWord; readonly evidence: HealthEvidence }

/** One programme_health row as read: a word or evidence this build cannot read is 'unreadable', carried, never dropped. */
export interface HealthRow {
  readonly id: number; readonly program: string; readonly at: number;
  readonly word: ProgrammeHealthWord | 'unreadable'; readonly evidence: HealthEvidence | 'unreadable';
}
/** The spend arm counts a reading taken up to this many minutes after its run's close (the worker's last render). */
export const SPEND_READ_GRACE_MINUTES = 10;
