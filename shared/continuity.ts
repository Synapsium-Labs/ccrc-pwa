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
  unmeasured: 'a start replaced it, and what that start was cannot be told from what the lane read',
  cleared: 'a /clear on the same row and account replaced it: asked for, but not by a renewal (review 2006)',
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
/** The continuity notes (Overlord spec §3.3.2, C37; the notes piece of W1a). What a note keys to: a programme (by slug), an
 *  item or a run (by id), each a row the server can look up. `request` joins in W2 and `message` (a `miss`) in W1, as their
 *  rows appear (slug note-keys-in-w1a). */
export type NoteKey =
  | { readonly kind: 'programme'; readonly slug: string }
  | { readonly kind: 'item'; readonly id: number }
  | { readonly kind: 'run'; readonly id: number };
const NOTE_KEY_KIND_MAP = { programme: 'a programme, by slug', item: 'an item, by id', run: 'a run, by id' } as const;
export type NoteKeyKind = keyof typeof NOTE_KEY_KIND_MAP;
export const NOTE_KEY_KINDS = Object.keys(NOTE_KEY_KIND_MAP) as NoteKeyKind[];
export function isNoteKeyKind(v: unknown): v is NoteKeyKind {
  return typeof v === 'string' && (NOTE_KEY_KINDS as readonly string[]).includes(v);
}
const NOTE_KIND_MAP = {
  thread: 'an open thread: what it waits on and what comes next',
  caution: 'something the next generation should watch for',
} as const;
export type NoteKind = keyof typeof NOTE_KIND_MAP;
export const NOTE_KINDS = Object.keys(NOTE_KIND_MAP) as NoteKind[];
export function isNoteKind(v: unknown): v is NoteKind {
  return typeof v === 'string' && (NOTE_KINDS as readonly string[]).includes(v);
}
/** What the door measured of a key: a row of the caller's that is live, a row that is gone (absent, closed, or no longer
 *  open), a row that is not the caller's, or a read that failed. `unmeasured` is never folded into `gone`. */
const KEY_FACT_MAP = {
  live: "a live row of the caller's",
  gone: 'no such row, or it is closed',
  'not-yours': "a row that is not the caller's",
  unmeasured: 'the row could not be read',
} as const;
export type KeyFact = keyof typeof KEY_FACT_MAP;
export const KEY_FACTS = Object.keys(KEY_FACT_MAP) as KeyFact[];
export function isKeyFact(v: unknown): v is KeyFact {
  return typeof v === 'string' && (KEY_FACTS as readonly string[]).includes(v);
}
/** C37: the handover note's tone line, at most this many characters. */
export const HANDOVER_TONE_MAX_CHARS = 300;
/** The handover note's whole size as it is stored (its JSON, in UTF-8 bytes), at most: one over it is refused `note-too-long`
 *  at write, so the row the renewal act reads later stays inside one tool result (review 2039, F3; slug handover-body-cap).
 *  The field caps alone allowed a note of megabytes. */
export const HANDOVER_MAX_BYTES = 16_384;
/** One thread of a handover note: a reference that must exist, what it waits on and what comes next. */
export interface HandoverThread { readonly ref: NoteKey; readonly waitsOn: string; readonly next: string }
/** C37: the handover note the ending generation writes in `checkpointed`. Its claims of done, its ids, its promises, its
 *  authority and its preferences are never read as rows. */
export interface HandoverNote {
  readonly threads: readonly HandoverThread[];
  readonly cautions: readonly string[];
  readonly tone: string;
}
/** A note's key as one short phrase (`run 12`, `programme prog-a`), for the card and the door's details. */
export function noteKeyText(k: NoteKey): string {
  return k.kind === 'programme' ? `programme ${k.slug}` : `${k.kind} ${k.id}`;
}

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

/** The probe classes (Overlord design spec §3.3.5, C41 and Table 3.3.5a, in its order; C52 for a coordinator's). A role's
 *  set is its `FLEET_ROLES` row's `probeSet` column; `probeRound` (`server/src/continuity/probes.ts`) draws a round across
 *  it. `thread` is not a row of Table 3.3.5a: it is C41's probe after every renewal (R19), the Overlord's in W1a, and a
 *  coordinator's if the operator's item rules so (the probes plan, Task 7), so it sits in this one list rather than a
 *  second one. */
const PROBE_CLASS_MAP = {
  fact: 'an extracted fact, graded by the id or choice in the snapshot',
  update: 'a preference that was superseded, graded by the entry that stands now',
  temporal: 'an order in time, graded by the rows\' times',
  abstention: 'a question with no answer on record, graded by `none`',
  continuation: 'what a thread does next, graded by the note\'s next act',
  decision: 'which entries decided an act, graded by the ids its act row cites',
  contradiction: 'a superseded entry crossed with a scope, graded by the entry that applies there',
  application: 'a case that uses an entry, graded by the option the entry implies',
  thread: 'the current thread after a renewal, graded against the checkpoint\'s thread (R19)',
} as const;
export type ProbeClass = keyof typeof PROBE_CLASS_MAP;
export const PROBE_CLASSES = Object.keys(PROBE_CLASS_MAP) as ProbeClass[];
export function isProbeClass(v: unknown): v is ProbeClass {
  return typeof v === 'string' && (PROBE_CLASSES as readonly string[]).includes(v);
}
/** §3.3.5, C41: a round asks three to five. A spot probe at depth is a round of one (the probes plan, Task 6). */
export const PROBE_ROUND_MIN = 3;
export const PROBE_ROUND_MAX = 5;
/** §3.3.5, C41: while idle, one spot probe each time the context grows by another this many tokens. Also the width of
 *  one depth bucket of the fitted ceiling. */
export const SPOT_PROBE_EVERY_TOKENS = 50_000;
/** §3.3.5, C41: the fitted ceiling is the deepest depth whose rolling pass rate is at least this. */
export const FIT_PASS_RATE = 0.95;
/** §3.3.5, C41, "the plan fixes the rolling window as a count" (slug fit-window-twenty): the last this many closed-book
 *  spot probes of one depth and model class. */
export const FIT_WINDOW = 20;
/** The one answer an abstention question expects (C41: "an answer is an id, a choice from a list, or `none`"). */
export const PROBE_NONE = 'none';
