// L1 policy, context C3 (Session Conversation): the replay quiz's rules (Overlord spec §3.3.9 C52, §3.3.10 C53, §12 M13;
// W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 1; W0-28 ruled B, programme item 168). Pure and clock-free: the
// store (`quizStore.ts`) asks `quizBaseline` inside its own transaction, and the lane-arm door's decider
// (`coord/laneArm.ts#decideLaneArmPost`) reads `W1A_ARM_ROWS`.
//
// THE QUIZ IS HISTORY'S OWN (C53). Nothing here runs it, reads the history store, or touches a history marker: a row records
// what the operator ran by hand. A row holds the score and its interval, never a PASS, a verdict or a benefit of recall (the
// ruling's condition 4).
//
// THE BASELINE (slug baseline-rule-from-current-choices): a run is the baseline when no earlier row is one and every W1a
// lane-arm row's stored choice reads exactly `shadow` when it is recorded. `lane_arm_settings` keeps only each row's current
// choice; the lane-arm door's refusal (`baseline-missing`) stops any of these rows going live before a baseline exists, so
// "has never been live" and "is shadow now" agree. A read that is not an exact `shadow` (live, a token this build does not
// know, a lost row, a read that failed) makes no baseline: doubt never makes one.
import { ANCHOR_SLOT_LANE, CONTINUITY_LANE, LAUNCH_PROFILE_LANE, type LaneArmLane } from '../../../shared/lane-arm.js';
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

/** THE BASELINE RULE: true when no earlier row is a baseline and every W1a row's stored choice reads exactly `shadow`. */
export function quizBaseline(runs: readonly { readonly baseline: boolean }[], w1aChoices: Readonly<Record<W1aArmRow, LaneArmRead>>): boolean {
  if (runs.some((r) => r.baseline)) return false;
  return W1A_ARM_ROWS.every((lane) => {
    const read = w1aChoices[lane];
    return read.kind === 'row' && read.choice === 'shadow';
  });
}

// ── The weekly item (plan Task 4; slugs quiz-lane-reminds-not-runs, quiz-week-is-utc, quiz-item-waits-for-the-record-path) ──

/** The programme the weekly item is raised on. */
export const QUIZ_ITEM_PROGRAMME = 'overlord';

/** THE RECORD PATH'S GATE (ask 434; slug quiz-item-waits-for-the-record-path). The weekly item asks the operator to run the
 *  quiz and record it with `ccrc quiz-record`; until the single-arm mode and that verb with its door ship (the plan's
 *  Task 3, a later pull request under its own plan), there is nothing the operator can do, so the lane raises nothing. That
 *  pull request sets this true beside the door, and `continuity-quiz-lane.test.ts` pins the two together. */
export const QUIZ_RECORD_READY: boolean = false;

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
    'On the fleet box, in your own shell and never in a session\'s pane, run history\'s replay quiz driver in its single-arm, '
      + 'recall-on mode, by hand, as its runbook says. ccrc never runs it.',
    'Record the run from the same shell: ccrc quiz-record --report <file> --sha <hex>, with the report file and the sha the '
      + 'driver printed. It refuses inside a session.',
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
