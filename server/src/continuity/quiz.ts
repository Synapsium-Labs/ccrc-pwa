// L1 policy, context C3 (Session Conversation): the replay quiz's rules (Overlord spec §3.3.9 C52, §3.3.10 C53, §12 M13;
// W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 1; W0-28 ruled B, programme item 168). Pure and clock-free: the
// store (`quizStore.ts`) asks `quizBaseline` inside its own transaction, and the lane-arm door's decider
// (`coord/laneArm.ts#decideLaneArmPost`) reads `W1A_ARM_ROWS`.
//
// THE QUIZ IS HISTORY'S OWN (C53). Nothing here runs it, reads the history store, or touches a history marker: a row records
// what the weekly unattended run ran (`deploy/history-quiz-unattended.mjs`, run 3212), or the operator by hand. A row holds the score and its interval, never a PASS, a verdict or a benefit of recall (the
// ruling's condition 4).
//
// THE BASELINE (slug baseline-rule-from-current-choices; quiz-run-pending-until-confirmed): a recorded run is `pending` until the
// operator confirms or discards it (`quizRuleVerdict`); a run is the baseline when it is confirmed, no earlier confirmed row is
// one, and every W1a lane-arm row's stored choice reads exactly `shadow` when it is confirmed. `lane_arm_settings` keeps only each row's current
// choice; the lane-arm door's refusal (`baseline-missing`) stops any of these rows going live before a baseline exists, so
// "has never been live" and "is shadow now" agree. A read that is not an exact `shadow` (live, a token this build does not
// know, a lost row, a read that failed) makes no baseline: doubt never makes one.
import { ANCHOR_SLOT_LANE, CONTINUITY_LANE, LAUNCH_PROFILE_LANE, QUIZ_BOOTSTRAP, QUIZ_SHA_PREFIX, isQuizTickOutcome, type LaneArmLane, type LaneArmQuizTick } from '../../../shared/lane-arm.js';
import { QUIZ_RECORD_REFUSALS, type QuizRecordRefusal } from '../../../shared/refusal.js';
import type { LaneArmBaseline, LaneArmRead } from '../coord/laneArm.js';

/** The W1a lane-arm rows the baseline guards, in the card's order: an arm of any of them changes what a session recalls,
 *  so none goes live before the baseline is taken. A later W1a row joins here. */
export const W1A_ARM_ROWS = [CONTINUITY_LANE, LAUNCH_PROFILE_LANE, ANCHOR_SLOT_LANE] as const satisfies readonly LaneArmLane[];
export type W1aArmRow = (typeof W1A_ARM_ROWS)[number];
export function isW1aArmRow(lane: LaneArmLane): lane is W1aArmRow {
  return (W1A_ARM_ROWS as readonly string[]).includes(lane);
}

/** Whether the history programme's W3 steering or W4 agents-on was armed on the families and node measured: every one
 *  (`yes`), none (`no`), some (`partial`), or not read (`unmeasured`, never folded into `no`). */
export const QUIZ_ARMED_WORDS = ['yes', 'no', 'partial', 'unmeasured'] as const;
export type QuizArmed = (typeof QUIZ_ARMED_WORDS)[number];
const isQuizArmed = (v: unknown): v is QuizArmed => typeof v === 'string' && (QUIZ_ARMED_WORDS as readonly string[]).includes(v);

/** What one run records (the minimum the history coordinator named for W0-28): when it was measured, the report's and the
 *  frozen question list's sha, how many questions and families, the score with its interval, the judge model, the ccrc
 *  release and Claude Code builds, and whether steering and agents-on were armed. */
export interface QuizReport {
  measuredAt: number;
  reportSha: string;
  questionsSha: string;
  questions: number;
  families: number;
  score: number;
  lo: number;
  hi: number;
  judgeModel: string;
  ccrcRelease: string;
  claudeBuilds: string[];
  steerArmed: QuizArmed;
  agentsOnArmed: QuizArmed;
}

/** The report's fields, in the record's order: the one list the validator walks. */
export const QUIZ_REPORT_FIELDS = [
  'measuredAt', 'reportSha', 'questionsSha', 'questions', 'families', 'score', 'lo', 'hi', 'judgeModel', 'ccrcRelease',
  'claudeBuilds', 'steerArmed', 'agentsOnArmed',
] as const satisfies readonly (keyof QuizReport)[];

/** A bounded one-line word: the judge model, the release, a build. */
const QUIZ_WORD_MAX = 200;
const isWord = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= QUIZ_WORD_MAX && !/[\r\n]/.test(v);
const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isReal = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const FIELD_OK: { readonly [K in keyof QuizReport]: (v: unknown) => boolean } = {
  measuredAt: isCount,
  reportSha: isSha,
  questionsSha: isSha,
  questions: isCount,
  families: isCount,
  score: isReal,
  lo: isReal,
  hi: isReal,
  judgeModel: isWord,
  ccrcRelease: isWord,
  claudeBuilds: (v) => Array.isArray(v) && v.length > 0 && v.every(isWord),
  steerArmed: isQuizArmed,
  agentsOnArmed: isQuizArmed,
};

export type QuizReportVerdict = { readonly ok: true; readonly report: QuizReport } | { readonly ok: false; readonly field: string; readonly detail: string };

/** A report, read: every field of `QUIZ_REPORT_FIELDS` present and well formed, the interval around the score
 *  (`lo <= score <= hi`), and nothing else. A refusal names the first field at fault (`(body)` for a value that is not an
 *  object). */
export function validQuizReport(json: unknown): QuizReportVerdict {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, field: '(body)', detail: 'the report is a JSON object' };
  }
  const b = json as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !(QUIZ_REPORT_FIELDS as readonly string[]).includes(k));
  if (extra !== undefined) return { ok: false, field: extra, detail: `${extra} is not a field of the record` };
  for (const field of QUIZ_REPORT_FIELDS) {
    if (!(field in b)) return { ok: false, field, detail: `${field} is missing` };
    if (!FIELD_OK[field](b[field])) return { ok: false, field, detail: `${field} is malformed` };
  }
  const r = b as unknown as QuizReport;
  if (r.lo > r.score) return { ok: false, field: 'lo', detail: 'lo is above the score' };
  if (r.hi < r.score) return { ok: false, field: 'hi', detail: 'hi is below the score' };
  return { ok: true, report: { ...r, claudeBuilds: [...r.claudeBuilds] } };
}

/** A recorded run's state: `pending` from the record door until the operator rules on it, then `confirmed` or `discarded`
 *  (F3). Only a confirmed run can be the baseline; a discarded row stays and never counts. `withdrawn` is a confirmed baseline
 *  the operator took back (review 3232 F1e): it stays, never counts and is never the baseline again. */
export const QUIZ_RUN_STATES = ['pending', 'confirmed', 'discarded', 'withdrawn'] as const;
export type QuizRunState = (typeof QUIZ_RUN_STATES)[number];

/** THE BASELINE RULE: true when no earlier CONFIRMED row is a baseline and every W1a row's stored choice reads exactly
 *  `shadow`. A pending or discarded row is never read as one, whatever its flag says. */
export function quizBaseline(
  runs: readonly { readonly state: QuizRunState; readonly baseline: boolean }[], w1aChoices: Readonly<Record<W1aArmRow, LaneArmRead>>,
): boolean {
  if (runs.some((r) => r.state === 'confirmed' && r.baseline)) return false;
  return W1A_ARM_ROWS.every((lane) => {
    const read = w1aChoices[lane];
    return read.kind === 'row' && read.choice === 'shadow';
  });
}

/** The operator's two rulings on a pending run (the rule door's body). */
export const QUIZ_RULE_ACTIONS = ['confirm', 'discard'] as const;
export type QuizRuleAction = (typeof QUIZ_RULE_ACTIONS)[number];
export const isQuizRuleAction = (v: unknown): v is QuizRuleAction => typeof v === 'string' && (QUIZ_RULE_ACTIONS as readonly string[]).includes(v);
/** The unattended run's ruling (run 3212, the operator's ruling of 2026-11-22; `quizRoutes.ts`'s confirm door): the operator's
 *  rule, applied by the server. The run the timer recorded is confirmed when the confirm key its record call was answered
 *  matches and its stored report sha is the sha the timer's report printed; otherwise it is refused and left pending (review
 *  3232 F1a, F1b). Never a wire word of the rule door. */
export const QUIZ_MATCH_RULING = 'match';
/** The operator's withdraw of a confirmed baseline (review 3232 F1e; `quizRoutes.ts`'s withdraw door). */
export const QUIZ_WITHDRAW_RULING = 'withdraw';
export type QuizRuling = QuizRuleAction | typeof QUIZ_MATCH_RULING | typeof QUIZ_WITHDRAW_RULING;
/** What the store measured of the confirm key a `match` carried against the run's stored hash: `matches`, `absent` (the run
 *  holds no key: recorded by hand, or the call carried none) or `wrong`. */
export type QuizConfirmKeyFact = 'matches' | 'absent' | 'wrong';
/** The fixed head the server puts on an unattended ruling's `ruledBy` (review 3232 F1c), so the audit never reads the caller's
 *  trace as an operator's device. */
export const QUIZ_UNATTENDED_BY_PREFIX = 'ccrc-unattended:';

export type QuizRuleVerdict =
  | { readonly kind: 'refuse'; readonly detail: string }
  | { readonly kind: 'write'; readonly state: Exclude<QuizRunState, 'pending'>; readonly baseline: boolean }
  | { readonly kind: 'same'; readonly state: Exclude<QuizRunState, 'pending'>; readonly baseline: boolean };

/** THE RULING (F3), asked inside `quizStore.ts#ruleQuizRun`'s transaction: only a `pending` run is ruled on (an unknown id or
 *  any other state refuses, naming it); a confirm is the baseline by `quizBaseline` over the rows already recorded and the
 *  W1a rows read now; a discard is never one. `match` (the unattended run's) carries the row's stored sha, the sha the timer
 *  measured and the confirm key's fact: on a pending run, a key that does not match refuses first, then a sha that differs
 *  refuses (review 3232 F1b: the run stays pending, never discarded), and both matching confirm it by the same rule; a run
 *  already ruled answers its own state and writes nothing when the sha matches (a resend, `same`) and refuses otherwise.
 *  `withdraw` (the operator's) takes back the confirmed baseline only: it becomes `withdrawn`, never the baseline again. */
export function quizRuleVerdict(i: {
  readonly id: number; readonly state: QuizRunState | 'unknown' | null; readonly action: QuizRuling;
  readonly runs: readonly { readonly state: QuizRunState; readonly baseline: boolean }[];
  readonly w1aChoices: Readonly<Record<W1aArmRow, LaneArmRead>>;
  /** `match` and `withdraw`: the row's stored report sha (null for no row), the sha the timer measured (`match`), and the row's
   *  own baseline flag. */
  readonly sha?: { readonly stored: string | null; readonly claimed: string; readonly baseline: boolean };
  /** `match` only: the confirm key, as the store measured it against the run's stored hash. */
  readonly key?: QuizConfirmKeyFact;
}): QuizRuleVerdict {
  if (i.state === null) return { kind: 'refuse', detail: `no quiz run ${i.id}` };
  if (i.action === QUIZ_WITHDRAW_RULING) {
    if (i.state !== 'confirmed') return { kind: 'refuse', detail: `run ${i.id} is ${i.state}, not a confirmed baseline` };
    if (i.sha?.baseline !== true) return { kind: 'refuse', detail: `run ${i.id} is not the baseline` };
    return { kind: 'write', state: 'withdrawn', baseline: false };
  }
  if (i.action === QUIZ_MATCH_RULING) {
    if (i.sha === undefined) return { kind: 'refuse', detail: 'a match ruling carries the sha the run measured' };
    const matched = i.sha.stored === i.sha.claimed;
    if (i.state === 'pending') {
      if (i.key !== 'matches') {
        return { kind: 'refuse', detail: i.key === 'wrong' ? `the confirm key is not run ${i.id}'s; nothing was written`
          : `run ${i.id} was not recorded for the unattended confirmation, or the call carried no confirm key; nothing was written` };
      }
      if (!matched) return { kind: 'refuse', detail: `run ${i.id}'s stored report sha is not ${i.sha.claimed.slice(0, QUIZ_SHA_PREFIX)}; it stays pending` };
      return { kind: 'write', state: 'confirmed', baseline: quizBaseline(i.runs, i.w1aChoices) };
    }
    if (matched && i.state !== 'unknown') return { kind: 'same', state: i.state, baseline: i.state === 'confirmed' && i.sha.baseline };
    return { kind: 'refuse', detail: `already ${i.state}` };
  }
  if (i.state !== 'pending') return { kind: 'refuse', detail: `already ${i.state}` };
  if (i.action === 'discard') return { kind: 'write', state: 'discarded', baseline: false };
  return { kind: 'write', state: 'confirmed', baseline: quizBaseline(i.runs, i.w1aChoices) };
}

/** The mail that wakes the programme's coordinator once a confirmed baseline exists (run 3212), keyed on its run (review 3232
 *  F4): null when there is no baseline, when the coordinator was already mailed for this one (`wokeAt`), or when there is
 *  nobody to tell. It goes to the programme's coordinator, or, with no overlord run open, to the designated Overlord session,
 *  with no run, so it reaches the next coordinator. The confirm door and every status tick ask it, and the door marks the run
 *  woken only once the mail was queued, so a lost wake is sent again on the next tick. */
export function quizBaselineMailOf(i: {
  readonly baseline: { readonly id: number; readonly reportSha: string; readonly wokeAt: number | null } | null;
  readonly coordinator: string | null; readonly designated: string | null;
}): { readonly toId: string; readonly subject: string; readonly body: string } | null {
  const to = i.coordinator ?? i.designated;
  if (i.baseline === null || i.baseline.wokeAt !== null || to === null) return null;
  return {
    toId: to, subject: `${QUIZ_BASELINE_MAIL_SUBJECT} run ${i.baseline.id}`,
    body: `The replay quiz's baseline is recorded: run ${i.baseline.id}, report sha ${i.baseline.reportSha.slice(0, QUIZ_SHA_PREFIX)}, confirmed `
      + 'by the unattended weekly run. Each W1a lane (' + W1A_ARM_ROWS.join(', ') + ') can now go live through '
      + '~/.local/bin/ccrc-api quiz live --json - with the body {"fromId","fromUuid","lane"}, one lane per call. The baseline is a '
      + 'score and its interval only: never a W2 result, a PASS or a measured benefit of recall.',
  };
}
/** The wake mail's subject. */
export const QUIZ_BASELINE_MAIL_SUBJECT = 'quiz-baseline-confirmed';

// ── The unattended run's status (run 3212; `quizRoutes.ts`'s `POST /api/continuity/quiz-status`) ──

/** A status field's bound: one line of at most this many characters (the runner cuts `detail` to 200). */
export const QUIZ_STATUS_FIELD_MAX = 200;
const QUIZ_WEEK_RE = /^[0-9]{4}-W[0-9]{2}$/;
const QUIZ_TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const QUIZ_ACCOUNT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const isLine = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= QUIZ_STATUS_FIELD_MAX && !/[\r\n]/.test(v);
/** The one-line trace an unattended caller sends (`quiz-unattended <user> <role> <ISO time>`): `by` on the confirm and status
 *  doors, `recordedBy` on the record door. Attribution, not authentication: the runner has no session. */
export const isQuizTrace = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= QUIZ_STATUS_FIELD_MAX && !/[\r\n]/.test(v);
/** The body's fields, and nothing else. */
export const QUIZ_STATUS_KEYS = ['week', 'act', 'outcome', 'word', 'detail', 'account', 'at', 'by'] as const;

/** The status body, read (pure): the ISO week or null, the act and the word as short lower-case tokens, the outcome one of
 *  `QUIZ_TICK_OUTCOMES`, the detail one line, empty or null (an empty one is stored as null), the account an id or null, the
 *  tick's wall ms, and the runner's trace (`by`, the sender check its sibling doors take). Any other key refuses. */
export function quizStatusOf(body: unknown):
  { readonly ok: true; readonly status: LaneArmQuizTick; readonly by: string } | { readonly ok: false; readonly field: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, field: '(body)' };
  const b = body as Record<string, unknown>;
  const unknownKey = Object.keys(b).find((k) => !(QUIZ_STATUS_KEYS as readonly string[]).includes(k));
  if (unknownKey !== undefined) return { ok: false, field: unknownKey };
  if (b['week'] !== null && (typeof b['week'] !== 'string' || !QUIZ_WEEK_RE.test(b['week']))) return { ok: false, field: 'week' };
  if (typeof b['act'] !== 'string' || !QUIZ_TOKEN_RE.test(b['act'])) return { ok: false, field: 'act' };
  if (!isQuizTickOutcome(b['outcome'])) return { ok: false, field: 'outcome' };
  if (b['word'] !== null && (typeof b['word'] !== 'string' || !QUIZ_TOKEN_RE.test(b['word']))) return { ok: false, field: 'word' };
  if (b['detail'] !== null && b['detail'] !== '' && !isLine(b['detail'])) return { ok: false, field: 'detail' };
  if (b['account'] !== null && (typeof b['account'] !== 'string' || !QUIZ_ACCOUNT_RE.test(b['account']))) return { ok: false, field: 'account' };
  if (typeof b['at'] !== 'number' || !Number.isSafeInteger(b['at']) || b['at'] <= 0) return { ok: false, field: 'at' };
  if (!isQuizTrace(b['by'])) return { ok: false, field: 'by' };
  return { ok: true, by: b['by'], status: { week: b['week'] as string | null, act: b['act'], outcome: b['outcome'], word: b['word'] as string | null,
    detail: b['detail'] === '' ? null : b['detail'] as string | null, account: b['account'] as string | null, at: b['at'] } };
}

/** The stop words the coordinator is told of even though the tick only waits: no account had weekly room (ask 695's ruling). */
export const QUIZ_STATUS_MAIL_WAITING_WORDS = ['no-room'] as const;
/** The stop mail's subject's head: the subject carries the week and word after it, so one stop's mail still outstanding never
 *  holds back another's (`rundefsTx.ts#queueSystemMail` drops a mail whose subject is outstanding already). */
export const QUIZ_STATUS_MAIL_SUBJECT = 'quiz-unattended-stopped';

/** Whether a tick's status wakes the programme's coordinator, once per week and word (asks 694 and 695's rulings): a stop
 *  that waits for attention (`refused`), an internal failure (`failed`), or a waiting word the ruling names. `key` is what the
 *  store keeps as the last mailed; a status that mails nothing keeps the stored key. */
export function quizStatusMailOf(i: { readonly status: LaneArmQuizTick; readonly mailedKey: string | null; readonly coordinator: string | null }):
  { readonly mail: { readonly toId: string; readonly subject: string; readonly body: string } | null; readonly key: string | null } {
  const t = i.status;
  const stops = t.word !== null
    && (t.outcome === 'refused' || t.outcome === 'failed' || (QUIZ_STATUS_MAIL_WAITING_WORDS as readonly string[]).includes(t.word));
  // A setup-phase stop has no week of its own: its key carries the week it happened in, so it mails once a week (review 3232).
  const key = stops ? `${t.week ?? `setup ${quizWeek(t.at).key}`} ${t.word}` : null;
  if (key === null || key === i.mailedKey || i.coordinator === null) return { mail: null, key: i.mailedKey };
  return { key, mail: { toId: i.coordinator, subject: `${QUIZ_STATUS_MAIL_SUBJECT} ${key}`,
    body: `The weekly unattended replay quiz stopped (${t.week ?? 'its setup'}): at ${t.act}, ${t.outcome}, word ${t.word}`
      + `${t.detail === null ? '' : `: ${t.detail}`}. It is retried at its next tick; the Shadow lanes card shows its last word, and `
      + 'doctor\'s quiz line on the fleet box says more. You are told once per week and word.' } };
}

/** The word of the mail that says the setup's account has waited two weeks running (review 3232 F9). */
export const QUIZ_SETUP_ACCOUNT_GONE = 'setup-account-gone';
/** The setup account's waiting streak (review 3232 F9). The setup's account is never re-picked, because a new account is a new
 *  setup and breaks comparability; so a run of `waiting` ticks (no room, a switched-off account, a missing record path) that
 *  spans two ISO weeks mails the coordinator once, with `QUIZ_SETUP_ACCOUNT_GONE`, for a fix to be dispatched. A tick with any
 *  other outcome ends the streak; a setup-phase tick (no week) leaves it as it stands. `goneKey` is the streak's first week once
 *  mailed; a mail that is not queued keeps the stored key, so a later tick mails again. */
export function quizWaitingStreakOf(i: {
  readonly status: LaneArmQuizTick; readonly waitingSince: string | null; readonly goneMailedKey: string | null; readonly coordinator: string | null;
}): { readonly waitingSince: string | null; readonly goneKey: string | null;
      readonly mail: { readonly toId: string; readonly subject: string; readonly body: string } | null } {
  const t = i.status;
  if (t.week === null) return { waitingSince: i.waitingSince, goneKey: i.goneMailedKey, mail: null };
  const since = t.outcome === 'waiting' ? (i.waitingSince ?? t.week) : null;
  if (since === null || since === t.week || i.goneMailedKey === since || i.coordinator === null) {
    return { waitingSince: since, goneKey: i.goneMailedKey, mail: null };
  }
  return { waitingSince: since, goneKey: since, mail: { toId: i.coordinator, subject: `${QUIZ_STATUS_MAIL_SUBJECT} ${t.week} ${QUIZ_SETUP_ACCOUNT_GONE}`,
    body: `The weekly unattended replay quiz has waited on its setup's account since ${since} (now ${t.week}: at ${t.act}, word `
      + `${t.word ?? 'none'}). The account is never re-picked, because a new account is a new setup and breaks comparability, so this `
      + 'needs a fix to be dispatched: the account\'s room, its lane switch, or a new setup. You are told once for this run of weeks.' } };
}

// ── The record door's decider (plan `2026-11-17-overlord-quiz-record.md` §5, F2; slugs the-door-checks-the-sha,
// single-arm-share-over-answered) ──

/** The single-arm report's kind and version (history's single-arm module, `deploy/history-quiz-single.mjs`). */
export const QUIZ_SINGLE_REPORT_KIND = 'ccrc-history-quiz-single-report';
export const QUIZ_SINGLE_REPORT_V = 1;
/** The report's fields, one by one (the plan's §4): the door refuses any other key, so a comparison figure (a lift, a delta, a
 *  verdict, a PASS) can never ride in. */
export const QUIZ_SINGLE_REPORT_KEYS = [
  'kind', 'v', 'measured_ms', 'arm', 'pilot', 'settings_mode', 'frozen_sha256', 'n_questions', 'n_families', 'counts', 'share',
  'interval', 'judge_model', 'ccrc_release', 'claude_code_versions', 'steer_armed', 'agents_on_armed', 'inputs',
] as const;
/** The settings modes the single-arm setup takes, explicitly (OQ1 as restated). */
export const QUIZ_SETTINGS_MODES = ['restricted', 'fallback'] as const;
export type QuizSettingsMode = (typeof QUIZ_SETTINGS_MODES)[number];
/** The one arm a single-arm run runs (recall on), and its pilot word: copies of history's own (the driver's `TREATMENT_ARM`
 *  and the single-arm module's `PILOT_SKIPPED`), which the contract test compares (review 2442 F6). */
export const QUIZ_TREATMENT_ARM = 'treatment';
export const QUIZ_PILOT_SKIPPED = 'skipped-by-ruling';
const QUIZ_INPUT_KEYS = ['setup_sha256', 'frozen_sha256', 'arms_summary_sha256', 'judged_sha256'] as const;

/** THE ANSWERED FLOOR: a run where more than one question in ten failed to run or came back absent measures the instrument
 *  rather than recall, so it can never be recorded (and never become a baseline that a working run later beats). */
export const QUIZ_ANSWERED_FLOOR = { num: 9, den: 10 } as const;
/** THE FRESHNESS BOUND: a week plus a day of slack, so re-reporting an old week's files cannot make a fresh row; and no more
 *  than five minutes in the future. Days times the day length, never a week's literal. */
export const QUIZ_RECORD_MAX_AGE_DAYS = 8;
const QUIZ_DAY_MS = 24 * 60 * 60 * 1000;
export const QUIZ_RECORD_FUTURE_SLACK_MS = 5 * 60 * 1000;
/** THE PENDING CAP (review 2442 F3): the record door refuses a new pending run while this many wait for the operator's
 *  ruling, so the card can never fill with lookalikes. */
export const QUIZ_PENDING_CAP = 5;

/** What a single-arm report carries beside the thirteen record fields: the counts, the run's mode and the interval's method,
 *  kept as new columns (the migration that adds them) and never folded into `QuizReport`. */
export interface QuizRunExtra {
  answered: number;
  correct: number;
  runFailed: number;
  absent: number;
  arm: typeof QUIZ_TREATMENT_ARM;
  settingsMode: QuizSettingsMode;
  pilot: typeof QUIZ_PILOT_SKIPPED;
  ci: number;
  method: string;
  bootstrapB: number;
  inputs: { setup_sha256: string; frozen_sha256: string; arms_summary_sha256: string; judged_sha256: string };
}

export type QuizRecordVerdict =
  | { readonly ok: true; readonly report: QuizReport; readonly extra: QuizRunExtra }
  | { readonly ok: false; readonly field: string; readonly detail: string; readonly word?: QuizRecordRefusal };

const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const asObject = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
type Frac = { num: number; den: number };
/** A fraction the share and both interval ends must be: whole numbers with `0 <= num <= den` and `den > 0`, so a zero
 *  denominator never divides. */
function fracOf(v: unknown): Frac | null {
  const o = asObject(v);
  if (o === null || !isNat(o['num']) || !isNat(o['den'])) return null;
  const f = { num: o['num'], den: o['den'] };
  return f.den > 0 && f.num <= f.den ? f : null;
}

/** THE RECORD DOOR'S RULE (F2), first match, each refusal naming its field:
 *   1. the claimed sha is 64 lower-case hex and equals the one the door measured over the text's bytes (`sha256`);
 *   2. the text is a JSON object (`report`);
 *   3. `kind` and `v` are the single-arm report's (`kind`), and no key outside its field list rides in (that key);
 *   4. `arm` is `treatment` (`arm`);
 *   5. `pilot` is `skipped-by-ruling` and `settings_mode` a known mode (`pilot`, `settings_mode`);
 *   6. the interval's `ci`, `method` and `B` are the bootstrap's (`interval`);
 *   7. the counts add up and the share is over the answered questions (`counts`);
 *   8. the share and both interval ends are fractions in [0, 1] with a denominator above zero (`share`, `interval`);
 *   9. the answered floor (`counts`);
 *  10. freshness: `measured_ms` neither in the future nor older than the bound (`measured_ms`);
 *  11. the inputs are the four hex64 values and nothing else, and `inputs.frozen_sha256` is the top level's (`inputs`); the
 *      mapped record goes to `validQuizReport`, whose refusal passes on unchanged (its `lo <= score <= hi` is OQ4's refusal:
 *      an interval that misses its score is refused, never clamped);
 *  12. unless this report is already recorded (`recorded`: a resend answers its own row and state, whatever its state; review
 *      2449 F3), fewer than `QUIZ_PENDING_CAP` runs are pending (`pending`, the word `quiz-pending-full`). */
export function quizRecordVerdict(i: {
  readonly text: string; readonly claimedSha: unknown; readonly measuredSha: string; readonly now: number; readonly pending: number;
  readonly recorded: boolean;
}): QuizRecordVerdict {
  const no = (field: string, detail: string): QuizRecordVerdict => ({ ok: false, field, detail });
  if (!isSha(i.claimedSha) || i.claimedSha !== i.measuredSha) return no('sha256', 'the sha256 is not the sha of the report\'s bytes');
  let parsed: unknown;
  try { parsed = JSON.parse(i.text); } catch { return no('report', 'the report is not JSON'); }
  const b = asObject(parsed);
  if (b === null) return no('report', 'the report is a JSON object');
  if (b['kind'] !== QUIZ_SINGLE_REPORT_KIND || b['v'] !== QUIZ_SINGLE_REPORT_V) {
    return no('kind', `the report is ${QUIZ_SINGLE_REPORT_KIND} version ${QUIZ_SINGLE_REPORT_V}`);
  }
  const stray = Object.keys(b).find((k) => !(QUIZ_SINGLE_REPORT_KEYS as readonly string[]).includes(k));
  if (stray !== undefined) return no(stray, `${stray} is not a field of the single-arm report`);
  if (b['arm'] !== QUIZ_TREATMENT_ARM) return no('arm', 'the single-arm run is the treatment arm, recall on');
  if (b['pilot'] !== QUIZ_PILOT_SKIPPED) return no('pilot', 'pilot is skipped-by-ruling');
  const mode = b['settings_mode'];
  if (typeof mode !== 'string' || !(QUIZ_SETTINGS_MODES as readonly string[]).includes(mode)) return no('settings_mode', 'settings_mode is restricted or fallback');
  const iv = asObject(b['interval']);
  if (iv === null || iv['ci'] !== QUIZ_BOOTSTRAP.ci || iv['method'] !== QUIZ_BOOTSTRAP.method || iv['B'] !== QUIZ_BOOTSTRAP.B) {
    return no('interval', `the interval is the bootstrap's (ci ${QUIZ_BOOTSTRAP.ci}, ${QUIZ_BOOTSTRAP.method}, B ${QUIZ_BOOTSTRAP.B})`);
  }
  const c = asObject(b['counts']);
  const share = asObject(b['share']);
  if (c === null || share === null || !(['questions', 'answered', 'correct', 'run_failed', 'absent'] as const).every((k) => isNat(c[k]))) {
    return no('counts', 'counts are {questions, answered, correct, run_failed, absent}, whole numbers');
  }
  const n = { questions: c['questions'] as number, answered: c['answered'] as number, correct: c['correct'] as number,
    runFailed: c['run_failed'] as number, absent: c['absent'] as number };
  if (n.questions !== n.answered + n.runFailed + n.absent || n.questions !== b['n_questions'] || n.correct > n.answered
    || share['num'] !== n.correct || share['den'] !== n.answered) {
    return no('counts', 'the counts do not add up: questions = answered + run_failed + absent = n_questions, correct <= answered, '
      + 'and the share is correct over answered');
  }
  const sh = fracOf(share);
  if (sh === null) return no('share', 'the share is a fraction with 0 <= num <= den and den > 0');
  const lower = fracOf(iv['lower']);
  const upper = fracOf(iv['upper']);
  if (lower === null || upper === null) return no('interval', 'each interval end is a fraction with 0 <= num <= den and den > 0');
  if (n.answered * QUIZ_ANSWERED_FLOOR.den < n.questions * QUIZ_ANSWERED_FLOOR.num) {
    return no('counts', `fewer than ${QUIZ_ANSWERED_FLOOR.num} in ${QUIZ_ANSWERED_FLOOR.den} questions were answered`);
  }
  const at = b['measured_ms'];
  if (!isNat(at) || at > i.now + QUIZ_RECORD_FUTURE_SLACK_MS || at < i.now - QUIZ_RECORD_MAX_AGE_DAYS * QUIZ_DAY_MS) {
    return no('measured_ms', `measured_ms is when the arms ran: not in the future and not more than ${QUIZ_RECORD_MAX_AGE_DAYS} days ago`);
  }
  const inputs = asObject(b['inputs']);
  if (inputs === null || Object.keys(inputs).length !== QUIZ_INPUT_KEYS.length || !QUIZ_INPUT_KEYS.every((k) => isSha(inputs[k]))
    || inputs['frozen_sha256'] !== b['frozen_sha256']) {
    return no('inputs', `inputs are ${QUIZ_INPUT_KEYS.join(', ')}, each a sha256, and frozen_sha256 is the report's own`);
  }
  const mapped = validQuizReport({
    measuredAt: at, reportSha: i.measuredSha, questionsSha: b['frozen_sha256'], questions: b['n_questions'], families: b['n_families'],
    score: sh.num / sh.den, lo: lower.num / lower.den, hi: upper.num / upper.den, judgeModel: b['judge_model'],
    ccrcRelease: b['ccrc_release'], claudeBuilds: b['claude_code_versions'], steerArmed: b['steer_armed'], agentsOnArmed: b['agents_on_armed'],
  });
  if (!mapped.ok) return mapped;
  if (!i.recorded && i.pending >= QUIZ_PENDING_CAP) {
    return { ok: false, field: 'pending', word: QUIZ_RECORD_REFUSALS.pendingFull,
      detail: `${i.pending} recorded runs already wait for your Confirm or Discard on the Shadow lanes card` };
  }
  return { ok: true, report: mapped.report, extra: {
    answered: n.answered, correct: n.correct, runFailed: n.runFailed, absent: n.absent, arm: QUIZ_TREATMENT_ARM, settingsMode: mode as QuizSettingsMode,
    pilot: QUIZ_PILOT_SKIPPED, ci: QUIZ_BOOTSTRAP.ci, method: QUIZ_BOOTSTRAP.method, bootstrapB: QUIZ_BOOTSTRAP.B,
    inputs: { setup_sha256: inputs['setup_sha256'] as string, frozen_sha256: inputs['frozen_sha256'] as string,
      arms_summary_sha256: inputs['arms_summary_sha256'] as string, judged_sha256: inputs['judged_sha256'] as string },
  } };
}

// ── The weekly item (plan Task 4; slugs quiz-lane-reminds-not-runs, quiz-week-is-utc, quiz-item-waits-for-the-record-path) ──

/** The programme the weekly item is raised on. */
export const QUIZ_ITEM_PROGRAMME = 'overlord';

/** THE RECORD PATH'S GATE (ask 434; slug quiz-item-waits-for-the-record-path). The weekly item asks the operator to run the
 *  quiz and record it with `ccrc quiz-record`; while that verb and its door were absent the lane raised nothing. They ship
 *  now (`quizRoutes.ts`, plan `2026-11-17-overlord-quiz-record.md` Task 8), so this is true, and
 *  `continuity-quiz-lane.test.ts` pins the two together. */
export const QUIZ_RECORD_READY: boolean = true;

/** The ISO week a wall time falls in, in UTC (slug quiz-week-is-utc: the Settings time zone ships in W1), as `YYYY-Www`, and
 *  the ms of its Monday 00:00 UTC. */
export function quizWeek(now: number): { readonly key: string; readonly start: number } {
  const d = new Date(now);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (d.getUTCDay() + 6) % 7;                      // Monday 0 .. Sunday 6
  const start = midnight - dow * 86_400_000;
  const thursday = new Date(start + 3 * 86_400_000);        // the ISO year is the year of the week's Thursday
  const year = thursday.getUTCFullYear();
  const dayOfYear = (thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000;   // whole days: both are UTC midnights
  const week = 1 + Math.floor(dayOfYear / 7);
  return { key: `${year}-W${String(week).padStart(2, '0')}`, start };
}

/** The days the weekly item waits into the week before it is raised (run 3212): the unattended run ticks every 6 hours from
 *  the week's start, so a week with no confirmed run by then is one it could not finish on its own. */
export const QUIZ_UNATTENDED_GRACE_DAYS = 3;

/** The item's words: what, how and why, the four conditions of the W0-28 ruling among them (its third superseded by the
 *  operator's ruling of 2026-11-22: ccrc's weekly timer runs the driver, and the operator may still run it by hand). Before a
 *  baseline exists the title says this run is the baseline. */
export function quizItemText(weekKey: string, baselineExists: boolean, pendingWaits = false): { readonly title: string; readonly why: string; readonly how: readonly string[] } {
  // The lane keys "once a week" on this exact title (`ledgersStore.ts#itemRaisedWithTitle`; `operator_items` has no other key
  // for a plain item), so rewording it mid-week raises that week's item a second time (review 2121 F6).
  const title = baselineExists
    ? `Run this week's replay quiz (${weekKey})`
    : `Run this week's replay quiz: the baseline (${weekKey})`;
  const why = 'What: one run of the history programme\'s replay quiz over live coordinator families, recall on, no A/B window, '
    + 'with the same questions, judge, judge model and scoring every week. Why: the scores show whether recall holds or drifts '
    + 'over weeks (Overlord C52), and M13 compares later runs with the baseline. ccrc\'s weekly unattended run '
    + '(ccd-quiz-weekly.timer on the fleet box) runs, records and confirms it on its own; this item is raised only when no run is '
    + `confirmed ${QUIZ_UNATTENDED_GRACE_DAYS} days into the week. `
    + (baselineExists
      ? 'The baseline is recorded; this run is one more point beside it.'
      : 'No baseline is recorded yet: this run becomes it if every W1a shadow lane is still in shadow when it is confirmed, and '
        + 'no W1a lane can go live until it exists.')
    + ' Nothing waits on this week\'s run but the record itself.';
  // The text is fixed when the lane raises the item (review 2449 F2, ruled: raise-time text is enough), so it always says what
  // to do with a run recorded later in the week, and says exactly that one waits when one does at raise time.
  const waiting = pendingWaits
    ? 'A recorded run is waiting for your Confirm or Discard on the Shadow lanes card (Settings, Automation, Shadow lanes): '
      + 'a pending run does not count, so this week stays open until you rule on it or record another.'
    : 'If you recorded a run this week, Confirm or Discard it on the Shadow lanes card (Settings, Automation, Shadow lanes): '
      + 'a pending run does not count, so this week stays open until you rule on it.';
  const how = [
    waiting,
    'See why the unattended run stopped on the same card, which shows its last word. Most stops cure themselves at its next '
      + 'tick (a usage limit, no account with weekly room); a word that needs you names what, and doctor\'s quiz line on the '
      + 'fleet box says more. Once the cause is gone, its next tick resumes the week.',
    'To run it by hand instead: on the fleet box, in your own shell, never in a session\'s pane and never while a W2 window is '
      + 'open, run history\'s single-arm quiz as its runbook says (quiz-record-runbook.md, in the Overlord programme\'s docs): '
      + 'each week, arms (it runs step 0b\'s probes first and stops if one fails), judge and report, with node --no-warnings '
      + '~/ccrc/deploy/history-quiz-single.mjs.',
    `Record a hand run from the same shell, within ${QUIZ_RECORD_MAX_AGE_DAYS} days of the arms run: ccrc quiz-record --report <file> --sha <hex>, with `
      + 'the week\'s single-report.json and the sha report printed. It refuses inside a session and a pane, and records the run '
      + 'as pending. Then, on the card, find the pending run whose report sha starts as report and ccrc quiz-record printed, '
      + 'and press Confirm, or Discard if it should not count; discard any run you did not record. Only a confirmed run counts: '
      + 'the first one confirmed while every W1a lane is in shadow becomes the baseline.',
    'The conditions this record keeps: the history store is opened read-only, and no session runs a writing form of `ccrc '
      + 'history`; no history marker is written but headless-on, once, by the unattended run, listing exactly the frozen '
      + 'families (steer, agents-on and the rest stay yours); the driver runs on ccrc\'s weekly timer, or by your hand; and the '
      + 'baseline is never a W2 result, a PASS or a measured benefit of recall: a row holds the score and its interval only.',
  ];
  return { title, why, how };
}

/** A read the lane made: its value, or why it failed (never folded into a value). */
export type QuizRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** What the lane read before it decides: whether the record path ships, this week, when each CONFIRMED run was recorded
 *  (review 2442 F2: a pending run never silences the week, a discarded one counts for nothing), whether any run waits for the
 *  operator's ruling, whether a baseline exists, and whether this week's item was ever raised (in any state). */
export interface QuizLaneFacts {
  readonly recordReady: boolean;
  /** The pass's wall ms, for the unattended run's grace (run 3212). */
  readonly now: number;
  readonly week: { readonly key: string; readonly start: number };
  readonly recordedAts: QuizRead<readonly number[]>;
  readonly pendingWaits: QuizRead<boolean>;
  readonly baseline: LaneArmBaseline;
  readonly itemRaised: QuizRead<boolean>;
}

/** Why a pass raised nothing: the record path is absent, a read failed, a run is already recorded this week, or this week's
 *  item was already raised. */
export type QuizLaneHold = 'record-path-absent' | 'unmeasured' | 'recorded' | 'unattended-grace' | 'raised';
export type QuizLaneVerdict =
  | { readonly kind: 'hold'; readonly why: QuizLaneHold }
  | { readonly kind: 'raise'; readonly item: ReturnType<typeof quizItemText> };

/** THE LANE'S RULE: one item a week, only while the record path ships, only when no run recorded this week was confirmed,
 *  the unattended run's grace has passed (`QUIZ_UNATTENDED_GRACE_DAYS` into the week, run 3212) and no item for this week was
 *  ever raised; the item says so when a recorded run waits for a ruling; any failed read raises
 *  nothing. */
export function quizLaneVerdict(f: QuizLaneFacts): QuizLaneVerdict {
  if (!f.recordReady) return { kind: 'hold', why: 'record-path-absent' };
  if (!f.recordedAts.ok || !f.baseline.ok || !f.itemRaised.ok || !f.pendingWaits.ok) return { kind: 'hold', why: 'unmeasured' };
  if (f.recordedAts.value.some((at) => at >= f.week.start)) return { kind: 'hold', why: 'recorded' };
  if (f.now < f.week.start + QUIZ_UNATTENDED_GRACE_DAYS * QUIZ_DAY_MS) return { kind: 'hold', why: 'unattended-grace' };
  if (f.itemRaised.value) return { kind: 'hold', why: 'raised' };
  return { kind: 'raise', item: quizItemText(f.week.key, f.baseline.exists, f.pendingWaits.value) };
}
