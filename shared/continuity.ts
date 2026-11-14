// L0, context K: the PWA may bundle this file; it imports nothing.
//
// The generation machine's vocabulary and its starting values (Overlord design spec §3.3.11, H12 and H13, Tables
// 3.3.11a and 3.3.11b; §11.5 and Table 11.5b; the spec is `docs/superpowers/specs/2026-11-09-overlord-design.md`).
// Every list is derived from one map, as `PR_REASONS` is, and every union has one guard (D-8235's rule). Every figure
// is a starting value: the shadow period and W0's measures may move it, here and nowhere else.

const GENERATION_STATE_MAP = {
  active: 'it works; a renewal may be due',
  draining: 'no new hold; deliveries held; waits until no reader runs',
  checkpointed: 'the server assembles the checkpoint and asks for the handover note',
  clearing: "the session's host ends the conversation and starts a fresh one",
  carded: 'the anchor is injected, the card is read, and the served hash comes back',
  probing: 'the probes run',
  degraded: 'no soft renewal; one operator item',
  ended: 'a later generation replaced it (terminal)',
} as const;
export type GenerationState = keyof typeof GENERATION_STATE_MAP;
export const GENERATION_STATES = Object.keys(GENERATION_STATE_MAP) as GenerationState[];
export function isGenerationState(v: unknown): v is GenerationState {
  return typeof v === 'string' && (GENERATION_STATES as readonly string[]).includes(v);
}

const GENERATION_OUTCOME_MAP = {
  renewed: 'a planned renewal replaced it',
  crashed: 'an unplanned start replaced it',
  swapped: 'a swap landing replaced it',
  woken: 'a wake on the same host replaced it',
  'woken-elsewhere': 'a wake on another host replaced it',
} as const;
export type GenerationOutcome = keyof typeof GENERATION_OUTCOME_MAP;
export const GENERATION_OUTCOMES = Object.keys(GENERATION_OUTCOME_MAP) as GenerationOutcome[];
export function isGenerationOutcome(v: unknown): v is GenerationOutcome {
  return typeof v === 'string' && (GENERATION_OUTCOMES as readonly string[]).includes(v);
}

const TRIGGER_CLASS_MAP = {
  hard: 'drains at the next turn end; ignores the soft budget and the preconditions',
  soft: 'waits for the preconditions, a break and the soft budget',
} as const;
export type TriggerClass = keyof typeof TRIGGER_CLASS_MAP;
export const TRIGGER_CLASSES = Object.keys(TRIGGER_CLASS_MAP) as TriggerClass[];
export function isTriggerClass(v: unknown): v is TriggerClass {
  return typeof v === 'string' && (TRIGGER_CLASSES as readonly string[]).includes(v);
}

/** Table 3.3.11b's rows, in its order, and the operator's Renew now. Which rows a role takes, and in what order, is
 *  `RENEWAL_ROWS` (L1, `server/src/continuity/renewalDue.ts`). */
const RENEWAL_TRIGGER_MAP = {
  'hard-cap': 'context at the hard cap',
  'soft-ceiling': 'past 60% of the fitted ceiling',
  turns: 'more than 40 operator messages and answered holds',
  'two-compactions': 'two compactions in one generation',
  idle: 'idle for 45 minutes, with context above a quarter of the hard cap',
  'daily-backstop': 'the daily backstop hour',
  'new-install': 'a new ccrc install',
  'probe-failed': 'a probe failed mid-generation, and a re-read did not fix it',
  'model-drift': 'the running model is not the one the generation records',
  'resumed-other-class': 'a start that resumed the conversation on another model class',
  'entry-retired': 'an entry it was served was retired, edited, superseded or wiped',
  'term-raised': 'the operator confirmed a restore, which raised the term',
  'account-outside-set': "the generation's account is outside its set",
  'class-unservable': "the generation's class is no longer servable on its account",
  'account-load': "the account's load is past the harder line",
  'compaction-refused': 'a proactive compaction the PreCompact arm refused',
  'class-changed': 'the operator changed the designated class',
  'evaluation-due': 'the skill, card template or model id is not the one minted with',
  'not-local': 'the conversation is absent on the host that wakes the session',
  'resumed-long': 'a resumed long conversation',
  'wave-boundary': "wave N+1's run is open and wave N's is closed",
  operator: "the operator's Renew now",
} as const;
export type RenewalTrigger = keyof typeof RENEWAL_TRIGGER_MAP;
export const RENEWAL_TRIGGERS = Object.keys(RENEWAL_TRIGGER_MAP) as RenewalTrigger[];
export function isRenewalTrigger(v: unknown): v is RenewalTrigger {
  return typeof v === 'string' && (RENEWAL_TRIGGERS as readonly string[]).includes(v);
}

/** Table 3.3.11a: each timed state's seconds. */
export const STATE_DEADLINE_S = { draining: 120, checkpointed: 60, clearing: 90, carded: 45, probing: 165 } as const;
/** §3.3.11: the budget of one renewal, `checkpointed` to `active`. */
export const RENEWAL_BUDGET_S = 360;
/** Table 11.5b, observed time: the hold-off after a renewal that went back to `active`. */
export const HOLD_OFF_MS = 600_000;
/** Table 11.5b, observed time: a generation's least age before a soft trigger may end it. */
export const LEAST_AGE_MS = 1_800_000;
/** Table 11.5b, observed time: the soft renewal budget. */
export const SOFT_BUDGET = { count: 3, windowMs: 21_600_000 } as const;
/** Table 11.5b, observed time: a break (R19), no operator message for this long, or no visible place for this long. */
export const BREAK_NO_MESSAGE_MS = 1_200_000;
export const BREAK_PLACE_HIDDEN_MS = 300_000;
/** Table 3.3.11b: the hard cap, or half the window, whichever is lower. */
export const HARD_CAP_TOKENS = 250_000;
/** Table 3.3.11b: the soft ceiling, as a fraction of the fitted ceiling. */
export const SOFT_CEILING_FRACTION = 0.6;
/** Table 3.3.11b: more than this many operator messages and answered holds. */
export const TURNS_SOFT = 40;
/** Table 3.3.11b: idle for this long. */
export const IDLE_SOFT_MS = 2_700_000;
/** Table 3.3.11b: the harder line of an account's load. */
export const ACCOUNT_LOAD_HARD = 0.85;
/** Table 11.5b: past this fraction of a soft row's threshold, a break renews a generation early (R19). */
export const EARLY_WHILE_AWAY_FRACTION = 0.5;
/** Table 11.5b: the checkpoint's thread since the last break (R19). */
export const CHECKPOINT_THREAD = { messages: 60, tokens: 6_000 } as const;
/** Table 11.5b: the caps on `continuity_notes` for one identity. */
export const NOTES_CAP = { count: 200, chars: 500 } as const;
/** Table 11.5b and Table 3.3.11b: the context floor of the idle trigger and of the wave boundary, as a fraction of the
 *  hard cap ("a quarter of the hard cap"). */
export const IDLE_FLOOR_FRACTION = 0.25;
export const WAVE_BOUNDARY_FLOOR_FRACTION = 0.25;
/** Table 3.3.11b: a resumed conversation is long above this fraction of the hard cap ("half the hard cap"). */
export const RESUMED_LONG_FRACTION = 0.5;
/** R19, "Renew on schedule": a soft trigger waits at most this long for a break. */
export const ON_SCHEDULE_WAIT_MS = 1_800_000;
/** The renewal lane's period, the one the lane that advances the generations' observed time runs at. Its LANE_SCHEDULE
 *  row (the generations piece) reads it from here. A starting value. */
export const RENEWAL_LANE_PERIOD_MS = 30_000;
/** One observed-time step advances by at most this many periods of the lane that advances it (slug
 *  observed-time-caps-one-step; Table 11.5b): a longer monotonic delta is a freeze, advances by the cap only and counts
 *  as a gap. `observedStepCapMs` (`server/src/time/observed.ts`) is the one place the cap is computed from it. */
export const OBSERVED_STEP_PERIODS = 2;
/** Table 3.3.11a, `carded` "45, with one re-nudge": the re-nudge comes at this point after entry (slug
 *  deadline-set-once-rounds-fit-inside). One lane period before the deadline, derived rather than written: the lane's
 *  first pass at or after the nudge point always comes before the pass that sees the deadline, so the re-nudge can be
 *  answered (review 1912, F4). 15 s with today's values. */
export const CARDED_NUDGE_AT_MS = STATE_DEADLINE_S.carded * 1_000 - RENEWAL_LANE_PERIOD_MS;

/** The start report (Overlord W1a, spec §3.3.11; reviews 1911 F10 and 1949 G8): the SessionStart sources a
 *  `continuity_starts` row may carry, beside the generation vocabulary its reader decides with. A word outside them is
 *  read as `other` by `startSourceOf`, the one rule the table's writer and its read both go through: the payload is
 *  Claude Code's, and a new source word there must not lose the start. */
const START_SOURCE_MAP = {
  startup: 'a new conversation in a new process',
  resume: 'a stored conversation taken up again',
  clear: 'a /clear: a fresh conversation in the same process',
  compact: 'a compaction: the same conversation, summarised',
  fork: 'a fork: a new conversation sharing the pane (never reported)',
  other: 'any word outside these, so a new one never loses the start',
} as const;
export type StartSource = keyof typeof START_SOURCE_MAP;
export const START_SOURCES = Object.keys(START_SOURCE_MAP) as StartSource[];
export function isStartSource(v: unknown): v is StartSource {
  return typeof v === 'string' && (START_SOURCES as readonly string[]).includes(v);
}
export function startSourceOf(w: string): StartSource {
  return isStartSource(w) ? w : 'other';
}
/** A recorded start, as `continuity_starts` holds it and `startsSince` answers it. `uuid` is the reported conversation's
 *  (the body's `startedUuid`, else its `fromUuid`); `rowIncarnation` is the registry row's generation, or null.
 *  ORDER: id order is receipt order; a session's start order is `reportedAt`. A start kept and resent lands after a
 *  newer one, so a reader orders one session's starts by `reportedAt`, never by `id` or `receivedAt` (review 1949, G3). */
export interface StartRow {
  id: number;
  sessionId: string;
  reportId: string;
  uuid: string;
  source: StartSource;
  model: string | null;
  rowIncarnation: string | null;
  reportedAt: number;
  receivedAt: number;
}
