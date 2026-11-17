// L1 policy, context C3 (Session Conversation): the replay quiz's rules (Overlord spec §3.3.9 C52, §3.3.10 C53, §12 M13;
// W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 1; W0-28 ruled B, programme item 168). Pure and clock-free: the
// store (`quizStore.ts`) asks `quizBaseline` inside its own transaction, and the lane-arm door's decider
// (`coord/laneArm.ts#decideLaneArmPost`) reads `W1A_ARM_ROWS`.
//
// THE QUIZ IS HISTORY'S OWN (C53). Nothing here runs it, reads the history store, or touches a history marker: a row records
// what the operator ran by hand. A row holds the score and its interval, never a PASS, a verdict or a benefit of recall (the
// ruling's condition 4).
//
// THE BASELINE (slug baseline-rule-from-current-choices; quiz-run-pending-until-confirmed): a recorded run is `pending` until the
// operator confirms or discards it (`quizRuleVerdict`); a run is the baseline when it is confirmed, no earlier confirmed row is
// one, and every W1a lane-arm row's stored choice reads exactly `shadow` when it is confirmed. `lane_arm_settings` keeps only each row's current
// choice; the lane-arm door's refusal (`baseline-missing`) stops any of these rows going live before a baseline exists, so
// "has never been live" and "is shadow now" agree. A read that is not an exact `shadow` (live, a token this build does not
// know, a lost row, a read that failed) makes no baseline: doubt never makes one.
import { ANCHOR_SLOT_LANE, CONTINUITY_LANE, LAUNCH_PROFILE_LANE, QUIZ_BOOTSTRAP, type LaneArmLane } from '../../../shared/lane-arm.js';
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
 *  (F3). Only a confirmed run can be the baseline; a discarded row stays and never counts. */
export const QUIZ_RUN_STATES = ['pending', 'confirmed', 'discarded'] as const;
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

export type QuizRuleVerdict =
  | { readonly kind: 'refuse'; readonly detail: string }
  | { readonly kind: 'write'; readonly state: Exclude<QuizRunState, 'pending'>; readonly baseline: boolean };

/** THE RULING (F3), asked inside `quizStore.ts#ruleQuizRun`'s transaction: only a `pending` run is ruled on (an unknown id or
 *  any other state refuses, naming it); a confirm is the baseline by `quizBaseline` over the rows already recorded and the
 *  W1a rows read now; a discard is never one. */
export function quizRuleVerdict(i: {
  readonly id: number; readonly state: QuizRunState | 'unknown' | null; readonly action: QuizRuleAction;
  readonly runs: readonly { readonly state: QuizRunState; readonly baseline: boolean }[];
  readonly w1aChoices: Readonly<Record<W1aArmRow, LaneArmRead>>;
}): QuizRuleVerdict {
  if (i.state === null) return { kind: 'refuse', detail: `no quiz run ${i.id}` };
  if (i.state !== 'pending') return { kind: 'refuse', detail: `already ${i.state}` };
  if (i.action === 'discard') return { kind: 'write', state: 'discarded', baseline: false };
  return { kind: 'write', state: 'confirmed', baseline: quizBaseline(i.runs, i.w1aChoices) };
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
const QUIZ_INPUT_KEYS = ['setup_sha256', 'frozen_sha256', 'arms_summary_sha256', 'judged_sha256'] as const;

/** THE ANSWERED FLOOR: a run where more than one question in ten failed to run or came back absent measures the instrument
 *  rather than recall, so it can never be recorded (and never become a baseline that a working run later beats). */
export const QUIZ_ANSWERED_FLOOR = { num: 9, den: 10 } as const;
/** THE FRESHNESS BOUND: a week plus a day of slack, so re-reporting an old week's files cannot make a fresh row; and no more
 *  than five minutes in the future. Days times the day length, never a week's literal. */
export const QUIZ_RECORD_MAX_AGE_DAYS = 8;
const QUIZ_DAY_MS = 24 * 60 * 60 * 1000;
export const QUIZ_RECORD_FUTURE_SLACK_MS = 5 * 60 * 1000;

/** What a single-arm report carries beside the thirteen record fields: the counts, the run's mode and the interval's method,
 *  kept as new columns (the migration that adds them) and never folded into `QuizReport`. */
export interface QuizRunExtra {
  answered: number;
  correct: number;
  runFailed: number;
  absent: number;
  arm: 'treatment';
  settingsMode: QuizSettingsMode;
  pilot: 'skipped-by-ruling';
  ci: number;
  method: string;
  bootstrapB: number;
  inputs: { setup_sha256: string; frozen_sha256: string; arms_summary_sha256: string; judged_sha256: string };
}

export type QuizRecordVerdict =
  | { readonly ok: true; readonly report: QuizReport; readonly extra: QuizRunExtra }
  | { readonly ok: false; readonly field: string; readonly detail: string };

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
 *  11. the mapped record goes to `validQuizReport`, whose refusal passes on unchanged (its `lo <= score <= hi` is OQ4's
 *      refusal: an interval that misses its score is refused, never clamped), and the inputs are four hex64 values (`inputs`). */
export function quizRecordVerdict(i: {
  readonly text: string; readonly claimedSha: unknown; readonly measuredSha: string; readonly now: number;
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
  if (b['arm'] !== 'treatment') return no('arm', 'the single-arm run is the treatment arm, recall on');
  if (b['pilot'] !== 'skipped-by-ruling') return no('pilot', 'pilot is skipped-by-ruling');
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
  if (inputs === null || Object.keys(inputs).length !== QUIZ_INPUT_KEYS.length || !QUIZ_INPUT_KEYS.every((k) => isSha(inputs[k]))) {
    return no('inputs', `inputs are ${QUIZ_INPUT_KEYS.join(', ')}, each a sha256`);
  }
  const mapped = validQuizReport({
    measuredAt: at, reportSha: i.measuredSha, questionsSha: b['frozen_sha256'], questions: b['n_questions'], families: b['n_families'],
    score: sh.num / sh.den, lo: lower.num / lower.den, hi: upper.num / upper.den, judgeModel: b['judge_model'],
    ccrcRelease: b['ccrc_release'], claudeBuilds: b['claude_code_versions'], steerArmed: b['steer_armed'], agentsOnArmed: b['agents_on_armed'],
  });
  if (!mapped.ok) return mapped;
  return { ok: true, report: mapped.report, extra: {
    answered: n.answered, correct: n.correct, runFailed: n.runFailed, absent: n.absent, arm: 'treatment', settingsMode: mode as QuizSettingsMode,
    pilot: 'skipped-by-ruling', ci: QUIZ_BOOTSTRAP.ci, method: QUIZ_BOOTSTRAP.method, bootstrapB: QUIZ_BOOTSTRAP.B,
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

/** The item's words: what, how and why, the four conditions of the W0-28 ruling among them. Before a baseline exists the
 *  title says this run is the baseline. */
export function quizItemText(weekKey: string, baselineExists: boolean): { readonly title: string; readonly why: string; readonly how: readonly string[] } {
  // The lane keys "once a week" on this exact title (`ledgersStore.ts#itemRaisedWithTitle`; `operator_items` has no other key
  // for a plain item), so rewording it mid-week raises that week's item a second time (review 2121 F6).
  const title = baselineExists
    ? `Run this week's replay quiz (${weekKey})`
    : `Run this week's replay quiz: the baseline (${weekKey})`;
  const why = 'What: one run of the history programme\'s replay quiz over live coordinator families, recall on, no A/B window, '
    + 'with the same questions, judge, judge model and scoring every week. Why: the scores show whether recall holds or drifts '
    + 'over weeks (Overlord C52), and M13 compares later runs with the baseline. '
    + (baselineExists
      ? 'The baseline is recorded; this run is one more point beside it.'
      : 'No baseline is recorded yet: this run becomes it if every W1a shadow lane is still in shadow when you record it, and '
        + 'no W1a lane can go live until it exists.')
    + ' Nothing waits on this week\'s run but the record itself.';
  const how = [
    'On the fleet box, in your own shell, never in a session\'s pane and never while a W2 window is open, run history\'s '
      + 'single-arm quiz by hand as its runbook says (docs/superpowers/programs/overlord/quiz-record-runbook.md): once, its '
      + 'setup, source, freeze and marker steps; each week, arms (it runs step 0b\'s probes first and stops if one fails), judge '
      + 'and report, with node --no-warnings ~/ccrc/deploy/history-quiz-single.mjs. ccrc never runs it.',
    `Record the run from the same shell, within ${QUIZ_RECORD_MAX_AGE_DAYS} days of the arms run: ccrc quiz-record --report <file> --sha <hex>, with `
      + 'the week\'s single-report.json and the sha report printed. It refuses inside a session and a pane, and records the run '
      + 'as pending.',
    'Then open Settings, Automation, Shadow lanes and press Confirm on the pending run, or Discard if it should not count. Only '
      + 'a confirmed run counts: the first one confirmed while every W1a lane is in shadow becomes the baseline.',
    'The conditions this record keeps (the W0-28 ruling): the history store is opened read-only, and no session runs a writing '
      + 'form of `ccrc history`; no history marker is written (steer, agents-on and the rest stay yours); the driver runs by '
      + 'your hand; and the baseline is never a W2 result, a PASS or a measured benefit of recall: a row holds the score and '
      + 'its interval only.',
  ];
  return { title, why, how };
}

/** A read the lane made: its value, or why it failed (never folded into a value). */
export type QuizRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

/** What the lane read before it decides: whether the record path ships, this week, when each recorded run was recorded,
 *  whether a baseline exists, and whether this week's item was ever raised (in any state). */
export interface QuizLaneFacts {
  readonly recordReady: boolean;
  readonly week: { readonly key: string; readonly start: number };
  readonly recordedAts: QuizRead<readonly number[]>;
  readonly baseline: LaneArmBaseline;
  readonly itemRaised: QuizRead<boolean>;
}

/** Why a pass raised nothing: the record path is absent, a read failed, a run is already recorded this week, or this week's
 *  item was already raised. */
export type QuizLaneHold = 'record-path-absent' | 'unmeasured' | 'recorded' | 'raised';
export type QuizLaneVerdict =
  | { readonly kind: 'hold'; readonly why: QuizLaneHold }
  | { readonly kind: 'raise'; readonly item: ReturnType<typeof quizItemText> };

/** THE LANE'S RULE: one item a week, only while the record path ships, only when no run was recorded this week and no item
 *  for this week was ever raised; any failed read raises nothing. */
export function quizLaneVerdict(f: QuizLaneFacts): QuizLaneVerdict {
  if (!f.recordReady) return { kind: 'hold', why: 'record-path-absent' };
  if (!f.recordedAts.ok || !f.baseline.ok || !f.itemRaised.ok) return { kind: 'hold', why: 'unmeasured' };
  if (f.recordedAts.value.some((at) => at >= f.week.start)) return { kind: 'hold', why: 'recorded' };
  if (f.itemRaised.value) return { kind: 'hold', why: 'raised' };
  return { kind: 'raise', item: quizItemText(f.week.key, f.baseline.exists) };
}
