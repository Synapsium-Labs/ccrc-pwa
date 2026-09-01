// The automations screen's own small vocabulary — the L0 unions'
// presentation, following `runWords.ts`/`spawnWords.ts`'s own idiom (this
// repo has three of these now, one per surface, deliberately: a run state is
// not a spawn verdict is not an automation state, and folding them into one
// shared table would put one surface's colour/word on another surface's
// meaning).
//
// TWO TOTAL SENTENCE TABLES, not one (task-11-brief.md, spec §10 "two
// vocabulary boundaries"): `never-run-by-hand` is the refusal an operator
// meets on every automation they create, and it is a member of
// `AutomationRouteRefusal`, NOT `AutomationRefusal` — a route-level refusal
// is decided BEFORE any run row exists, so it can never be written to
// `automation_runs.refusal`, and `AutomationRefusal` is exactly the set of
// reasons a run that WAS OPENED did not produce a session. A single
// `Record<AutomationRefusal, string>` cannot hold a key outside its own
// union: under `noUncheckedIndexedAccess` that would be a TS2353 at the
// table's own definition if attempted, or — if entered through a bare index
// signature instead — an EMPTY CELL at render time, never a build error.
// Hence two tables, each `Record<Union, string>` TOTAL over its own union
// (the `Record<Union, true>` idiom `shared/api.ts` itself uses: a member
// added to a union and not to its table is TS2739; a key in a table but not
// the union is TS2353).
//
// THE `is*` GUARD DOOR (spec's fourth rule with teeth). Every field this
// screen reads off the wire is typed as one of these closed unions, but
// nothing between the socket/fetch boundary and this renderer actually
// PROVES that at runtime — `stores/fleet.ts`'s `asFleetMsg` shape-checks the
// `{type:'automations'}` frame only at the ARRAY level, exactly as it does
// for `runs`/`coord`, and `api.automations()` is a bare `getJson` cast. A
// state/outcome/refusal a NEWER server minted that this bundle was compiled
// without reaches here as a raw string wearing the union's type. Indexing
// `STATE_WORD[raw]` directly is `undefined` under `noUncheckedIndexedAccess`
// and JSX renders NOTHING for `undefined` — an empty cell, not a crash and
// not a build error (the exact `runWords.ts`/`spawnWords.ts` defect this file
// exists not to repeat). Every lookup below goes through the matching
// `is<Union>` guard FIRST, and only a token the guard accepts is used to
// index its table; a token the guard refuses renders `? <token>` instead —
// the RAW wire text, never the degraded `'unknown'` member's own generic
// word, so the operator still reads what the fleet actually said even
// though this build cannot translate it.
import {
  isAutomationOutcome, isAutomationRefusal, isAutomationRouteRefusal, isAutomationState,
  isScheduleError,
  type AutomationOutcome, type AutomationRefusal, type AutomationRouteRefusal,
  type AutomationState, type ScheduleError,
} from '../../../shared/api';

// ── state (armed | paused | retired | unknown) ──────────────────────────────

export const AUTOMATION_STATE_WORD: Record<AutomationState, string> = {
  armed: 'armed', paused: 'paused', retired: 'retired', unknown: 'unknown',
};

/** Two cues per state — word above, glyph here (spec's fifth rule with
 *  teeth). Plain shapes, not colour: this screen follows `.run-glyph`'s own
 *  convention (`--ink-tertiary`, no per-state hue) rather than minting a new
 *  token pair for a distinction the word already carries. */
export const AUTOMATION_STATE_GLYPH: Record<AutomationState, string> = {
  armed: '●', paused: '‖', retired: '✕', unknown: '?',
};

// ── outcome (running | ok | refused | failed | skipped | missed | lost | unknown) ──

export const AUTOMATION_OUTCOME_WORD: Record<AutomationOutcome, string> = {
  running: 'running', ok: 'ok', refused: 'refused', failed: 'failed',
  skipped: 'skipped', missed: 'missed', lost: 'lost', unknown: 'unknown',
};

export const AUTOMATION_OUTCOME_GLYPH: Record<AutomationOutcome, string> = {
  running: '■', ok: '✓', refused: '⚠', failed: '✕', skipped: '·', missed: '!', lost: '?', unknown: '·',
};

// ── the RUN-level refusal (`automation_runs.refusal`) ───────────────────────

/** Every declared `AutomationRefusal` member gets a SENTENCE, not a bare
 *  word — spec §10's own closing line: "the operator reads … not
 *  `registry-unmeasurable`." `unknown` is the reader degrade a producer
 *  never writes (shared/api.ts's own docstring); its sentence names that
 *  directly rather than pretending to know why. */
export const AUTOMATION_REFUSAL_SENTENCE: Record<AutomationRefusal, string> = {
  'registry-unmeasurable': 'the fleet box could not be listed, so the pause could not be ruled out',
  'coordinator-paused': 'the coordinator was paused when this run tried to fire',
  'automations-paused': 'the global automations switch was off when this run tried to fire',
  'unknown-project': "this automation's project is not one the fleet box knows",
  'no-placeable-account': 'no account had room to place this run',
  'account-pressed': "the account this would have used is under too much pressure to place another",
  'cap-concurrency': 'too many runs from this automation were already in flight',
  overlap: 'the previous occurrence was still running when this one came due',
  'failure-ceiling': 'this automation failed too many times in a row and was paused',
  'spawn-refused': 'the fleet refused to start a session for this run',
  'spawn-cut-short': 'starting the session was cut short before it could be confirmed',
  'spawn-unmeasured': 'whether the session actually started could not be measured',
  'spawn-ambiguous': 'the fleet gave an ambiguous answer about whether the session started',
  'prompt-refused': 'the session started but refused the prompt',
  unknown: 'refused for a reason this build does not recognise',
};

// ── the ROUTE-level refusal (a door, not a run row) ──────────────────────────

/** `AutomationRouteRefusal` is the SECOND table, deliberately separate from
 *  the one above — `never-run-by-hand` is the refusal every automation meets
 *  at its own arm door (spec §7), and it is not a member of
 *  `AutomationRefusal` at all: a route-level refusal is decided before any
 *  run row exists, so it can never be written to `automation_runs.refusal`,
 *  and a table over that union has no cell for it — under
 *  `noUncheckedIndexedAccess` that is an empty cell, not a compile error,
 *  which is exactly the silent failure this second table exists to close. */
export const AUTOMATION_ROUTE_REFUSAL_SENTENCE: Record<AutomationRouteRefusal, string> = {
  'never-run-by-hand': 'this automation has never completed a manual run — arm it after one succeeds',
  'bad-schedule': 'that cadence has no next occurrence this build can compute',
  'bad-transition': 'that state change is not allowed from here',
  oversize: 'that text is too long',
  // `auto/routes.ts` genuinely sends this in a 404 body beside
  // `never-run-by-hand`/`bad-transition` (server/src/auto/routes.ts's own
  // `sendArmOutcome`/`sendStateOutcome`/every `GET`/`POST .../:id` 404 arm) —
  // a sixth member the spec's own table names five of (fixed 2026-09-01,
  // `mail-routes.test.ts`'s totality scan).
  'unknown-automation': 'that automation no longer exists',
  unknown: 'refused for a reason this build does not recognise',
};

// ── the schedule error (why a stored cadence has no next instant) ───────────

export const SCHEDULE_ERROR_SENTENCE: Record<ScheduleError, string> = {
  'unknown-timezone': "this build's ICU does not recognise that timezone",
  'bad-cadence': 'the stored cadence is not well formed',
  'no-future-occurrence': 'that cadence names no day it can ever fire on',
  'failure-ceiling': 'this automation failed too many times in a row and was paused',
  unknown: 'this cadence cannot be scheduled, for a reason this build does not recognise',
};

/** How many characters of an unnameable token a chip will show — same bound
 *  and same reasoning as `spawnWords.ts`'s `UNNAMEABLE_MAX`: untrusted text
 *  off the socket that React escapes, so this is a layout bound, not an
 *  injection one. */
const UNNAMEABLE_MAX = 24;

/** `? <token>`, never blank — the fourth rule with teeth's own render shape.
 *  Never a member of any of these unions, and never nothing. */
function unnameable(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  return s === '' ? '? unnameable' : `? ${s.slice(0, UNNAMEABLE_MAX)}`;
}

export interface AutoChip { word: string; glyph: string; token: string }

/** The total door into `AUTOMATION_STATE_WORD`/`AUTOMATION_STATE_GLYPH`. A
 *  raw wire value that `isAutomationState` accepts (including the
 *  designated `'unknown'` member) reads its table entry; anything else — a
 *  token this build's vocabulary has never heard of — renders `? <token>`
 *  off the RAW text, never off the generic `'unknown'` word, so the operator
 *  still sees what the fleet actually said. */
export function automationStateChip(raw: unknown): AutoChip {
  if (typeof raw === 'string' && isAutomationState(raw)) {
    return { word: AUTOMATION_STATE_WORD[raw], glyph: AUTOMATION_STATE_GLYPH[raw], token: raw };
  }
  const token = typeof raw === 'string' ? raw : String(raw);
  return { word: unnameable(raw), glyph: '?', token };
}

/** Same shape as `automationStateChip`, over `AutomationOutcome`. */
export function automationOutcomeChip(raw: unknown): AutoChip {
  if (typeof raw === 'string' && isAutomationOutcome(raw)) {
    return { word: AUTOMATION_OUTCOME_WORD[raw], glyph: AUTOMATION_OUTCOME_GLYPH[raw], token: raw };
  }
  const token = typeof raw === 'string' ? raw : String(raw);
  return { word: unnameable(raw), glyph: '?', token };
}

/** The RUN-level refusal's sentence, through the `isAutomationRefusal` door.
 *  `null`/non-string reads as "no refusal recorded" — the caller's own
 *  business (a `null` `automation_runs.refusal` on a non-refused outcome is
 *  the ordinary case, not a degrade). */
export function refusalSentence(raw: unknown): string {
  if (typeof raw === 'string' && isAutomationRefusal(raw)) return AUTOMATION_REFUSAL_SENTENCE[raw];
  return unnameable(raw);
}

/** The ROUTE-level refusal's sentence, through the `isAutomationRouteRefusal`
 *  door — the second table, never the first. */
export function routeRefusalSentence(raw: unknown): string {
  if (typeof raw === 'string' && isAutomationRouteRefusal(raw)) return AUTOMATION_ROUTE_REFUSAL_SENTENCE[raw];
  return unnameable(raw);
}

/** The cadence's own unschedulable sentence, through the `isScheduleError`
 *  door — a THIRD small table, not one of the two the brief's rule names,
 *  because a schedule error is neither a run-level nor a route-level
 *  refusal: it is a fact about the STORED CADENCE (`AutomationSummary.
 *  scheduleError`), read the same way on the list row and on the create/
 *  edit sheet's 409 `bad-schedule` body. */
export function scheduleErrorSentence(raw: unknown): string {
  if (typeof raw === 'string' && isScheduleError(raw)) return SCHEDULE_ERROR_SENTENCE[raw];
  return unnameable(raw);
}

/** A generic non-refusal error code that still needs a sentence rather than
 *  a bare slug — `bad-request` (the create/edit route's 400) is the one
 *  shape the routes answer with that is not a member of EITHER refusal
 *  union, so `routeRefusalSentence` alone would render it as `? bad-request`
 *  — technically not blank, but a worse sentence than this build can do. */
const GENERIC_ERROR_TEXT: Record<string, string> = {
  'bad-request': 'that request was not well formed',
};

/**
 * The one door every 409/404/400 automations-route body goes through
 * (`{ok:false, refused}` from *Run now*'s claim ladder, `{ok:false,
 * refusal}` from its post-claim settle, `{ok:false, error}` from every other
 * route, `'unknown-automation'` included — it is now an
 * `AutomationRouteRefusal` member in its own right). Checked in order: a
 * RUN-level refusal (`refused`/`refusal`) before a ROUTE-level one
 * (`error`), because *Run now*'s claim-ladder body is the only shape that
 * carries `refused` at all, and it is a run-level code by construction
 * (`coord.claimAndOpenRun`'s own union). `error` bodies are checked against
 * the small generic table first — `bad-request` is NOT a member of
 * `AutomationRouteRefusal` and would otherwise render as an unnameable
 * token — then fall through to the route refusal table for everything that
 * union actually names (`never-run-by-hand`/`bad-schedule`/`bad-transition`/
 * `oversize`/`unknown-automation`).
 */
export function automationErrorSentence(body: unknown): string {
  if (typeof body !== 'object' || body === null) return unnameable(body);
  const o = body as Record<string, unknown>;
  if (typeof o.refused === 'string') return refusalSentence(o.refused);
  if (typeof o.refusal === 'string') return refusalSentence(o.refusal);
  if (typeof o.error === 'string') {
    const generic = GENERIC_ERROR_TEXT[o.error];
    if (generic !== undefined) return generic;
    return routeRefusalSentence(o.error);
  }
  return 'refused, for a reason this build does not recognise';
}
