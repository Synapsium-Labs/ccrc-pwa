// L3 adapter: the replay quiz's record, `continuity_quiz_runs` (Overlord spec §3.3.9 C52; W1a, the replay quiz piece, plan
// `w1a-replay-quiz.md` Task 1, and the record path, plan `2026-11-17-overlord-quiz-record.md` Task 7). Its own module, so the
// quiz lane shares no store file with the server spine. ONE inserter, `insertQuizRun`, which records a run as `pending` with
// no baseline (slug quiz-run-pending-until-confirmed); ONE ruler, `ruleQuizRun`, the one writer of `state`, `ruledAt`,
// `ruledBy` and `baseline`, which asks `quiz.ts#quizRuleVerdict` inside its own transaction over the rows already recorded and
// the W1a lane-arm rows read through the reader its caller hands it (`CoordStore.laneArmSetting`, the one reader of
// `lane_arm_settings`). Reads: `quizRuns`, `quizRecordedAts` (the lane's, discarded rows left out), `quizBaselineRead` (the
// lane-arm door's fact, confirmed rows only, with the baseline's date) and `quizPendingRead` (the card's). Nothing here decides
// beyond asking those rules, and no read folds a failure into an answer: each tells a failed read apart.
import type { DatabaseSync } from 'node:sqlite';
import type { LaneArmQuizReads, LaneArmRead } from '../coord/laneArm.js';
import { tx } from '../coord/tx.js';
import type { CoordStore } from '../coord/store.js';
import { itemRaisedWithTitle } from '../coord/ledgersStore.js';
import type { LaneArmQuizPending } from '../../../shared/lane-arm.js';
import {
  QUIZ_ITEM_PROGRAMME, QUIZ_RUN_STATES, W1A_ARM_ROWS, quizRuleVerdict, type QuizArmed, type QuizReport, type QuizRuleAction, type QuizRunExtra,
  type QuizRunState, type W1aArmRow,
} from './quiz.js';
import type { QuizLanePort } from './quizLane.js';

/** What the inserter records: the report and its extra columns as `quizRecordVerdict` read them, who recorded it, and when. */
export interface QuizRunInsert {
  report: QuizReport;
  extra: QuizRunExtra;
  recordedBy: string;
  recordedAt: number;
}

/** One recorded run. The extra columns are null on a row an older build wrote (none exist live: the record door never shipped
 *  before them). */
export interface QuizRunRow extends QuizReport {
  id: number;
  recordedAt: number;
  recordedBy: string;
  baseline: boolean;
  state: QuizRunState | 'unknown';
  ruledAt: number | null;
  ruledBy: string | null;
  answered: number | null;
  runFailed: number | null;
  absent: number | null;
}

/** `fresh: false` is a resend that met the unique `reportSha`: the first row stands, and its id and state are answered (a
 *  discarded report's bytes are never recorded again). A statement that fails answers `write-failed`, never a throw. */
export type QuizRunInsertResult =
  | { ok: true; id: number; fresh: boolean; state: QuizRunState | 'unknown' }
  | { ok: false; kind: 'write-failed' };
export type QuizRunsRead = { ok: true; rows: QuizRunRow[] } | { ok: false; detail: string };
/** Whether a confirmed baseline row exists, with its `recordedAt`, or the read failed: never folded into `exists: false`.
 *  Assignable to `LaneArmBaseline`, so the lane-arm door and the lane read it unchanged (slug baseline-read-carries-its-date). */
export type QuizBaselineRead =
  | { ok: true; exists: true; at: number } | { ok: true; exists: false; at: null } | { ok: false; detail: string };
export type QuizPendingRead = { ok: true; runs: LaneArmQuizPending[] } | { ok: false; detail: string };
export type QuizRuleResult =
  | { ok: true; id: number; state: Exclude<QuizRunState, 'pending'>; baseline: boolean }
  | { ok: false; kind: 'bad-request'; detail: string }
  | { ok: false; kind: 'write-failed' };

const stateOf = (v: unknown): QuizRunState | 'unknown' =>
  (typeof v === 'string' && (QUIZ_RUN_STATES as readonly string[]).includes(v) ? v as QuizRunState : 'unknown');

const COLS = 'id, measuredAt, recordedAt, recordedBy, reportSha, questionsSha, questions, families, score, lo, hi, judgeModel, '
  + 'ccrcRelease, claudeBuilds, steerArmed, agentsOnArmed, baseline, state, ruledAt, ruledBy, answered, runFailed, absent';

interface RawRow {
  id: number; measuredAt: number; recordedAt: number; recordedBy: string; reportSha: string; questionsSha: string;
  questions: number; families: number; score: number; lo: number; hi: number; judgeModel: string; ccrcRelease: string;
  claudeBuilds: string; steerArmed: string; agentsOnArmed: string; baseline: number; state: string; ruledAt: number | null;
  ruledBy: string | null; answered: number | null; runFailed: number | null; absent: number | null;
}

/** The row's JSON column is written by `insertQuizRun` alone, from a typed array, so a value that does not parse as one is a
 *  corrupt file: it throws, naming the row, and the read answers that failure. */
function rowOf(r: RawRow): QuizRunRow {
  const builds: unknown = JSON.parse(r.claudeBuilds);
  if (!Array.isArray(builds) || !builds.every((b) => typeof b === 'string')) throw new Error(`quiz run ${r.id}: claudeBuilds is not a string list`);
  return {
    id: r.id, measuredAt: r.measuredAt, recordedAt: r.recordedAt, recordedBy: r.recordedBy, reportSha: r.reportSha,
    questionsSha: r.questionsSha, questions: r.questions, families: r.families, score: r.score, lo: r.lo, hi: r.hi,
    judgeModel: r.judgeModel, ccrcRelease: r.ccrcRelease, claudeBuilds: builds as string[],
    steerArmed: r.steerArmed as QuizArmed, agentsOnArmed: r.agentsOnArmed as QuizArmed, baseline: r.baseline === 1,
    state: stateOf(r.state), ruledAt: r.ruledAt, ruledBy: r.ruledBy, answered: r.answered, runFailed: r.runFailed, absent: r.absent,
  };
}

/** THE TABLE'S ONE INSERTER. In one transaction: a resend (the same `reportSha`) writes nothing and answers the stored row;
 *  otherwise the row is inserted `pending`, with no baseline: only the operator's confirmation (`ruleQuizRun`) can make one. */
export function insertQuizRun(db: DatabaseSync, input: QuizRunInsert): QuizRunInsertResult {
  try {
    return tx(db, () => {
      const dup = db.prepare('SELECT id, state FROM continuity_quiz_runs WHERE reportSha = ?').get(input.report.reportSha) as
        { id: number; state: string } | undefined;
      if (dup !== undefined) return { ok: true as const, id: dup.id, fresh: false, state: stateOf(dup.state) };
      const r = input.report;
      const x = input.extra;
      const res = db.prepare(
        'INSERT INTO continuity_quiz_runs (measuredAt, recordedAt, recordedBy, reportSha, questionsSha, questions, families, score, '
        + 'lo, hi, judgeModel, ccrcRelease, claudeBuilds, steerArmed, agentsOnArmed, baseline, state, answered, correct, runFailed, '
        + 'absent, arm, settingsMode, pilot, ci, method, bootstrapB, inputs) '
        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(r.measuredAt, input.recordedAt, input.recordedBy, r.reportSha, r.questionsSha, r.questions, r.families, r.score, r.lo,
        r.hi, r.judgeModel, r.ccrcRelease, JSON.stringify(r.claudeBuilds), r.steerArmed, r.agentsOnArmed, x.answered, x.correct,
        x.runFailed, x.absent, x.arm, x.settingsMode, x.pilot, x.ci, x.method, x.bootstrapB, JSON.stringify(x.inputs));
      return { ok: true as const, id: Number(res.lastInsertRowid), fresh: true, state: 'pending' as const };
    });
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

/** THE TABLE'S ONE RULER (F3): the one writer of `state`, `ruledAt`, `ruledBy` and `baseline`. In one transaction it reads the
 *  run's state, every row's state and baseline, and the W1a rows through `readLane`, asks `quizRuleVerdict`, and writes its
 *  answer; a refusal writes nothing. */
export function ruleQuizRun(
  db: DatabaseSync, input: { id: number; action: QuizRuleAction; at: number; by: string }, readLane: (lane: W1aArmRow) => LaneArmRead,
): QuizRuleResult {
  try {
    return tx(db, (): QuizRuleResult => {
      const all = (db.prepare('SELECT id, state, baseline FROM continuity_quiz_runs ORDER BY id').all() as
        { id: number; state: string; baseline: number }[]);
      const self = all.find((r) => r.id === input.id);
      const runs = all.filter((r) => r.id !== input.id).flatMap((r) => {
        const state = stateOf(r.state);
        return state === 'unknown' ? [] : [{ state, baseline: r.baseline === 1 }];
      });
      const w1aChoices = Object.fromEntries(W1A_ARM_ROWS.map((lane) => [lane, readLane(lane)])) as Record<W1aArmRow, LaneArmRead>;
      const v = quizRuleVerdict({ id: input.id, state: self === undefined ? null : stateOf(self.state), action: input.action, runs, w1aChoices });
      if (v.kind === 'refuse') return { ok: false, kind: 'bad-request', detail: v.detail };
      db.prepare('UPDATE continuity_quiz_runs SET state = ?, baseline = ?, ruledAt = ?, ruledBy = ? WHERE id = ?')
        .run(v.state, v.baseline ? 1 : 0, input.at, input.by, input.id);
      return { ok: true, id: input.id, state: v.state, baseline: v.baseline };
    });
  } catch {
    return { ok: false, kind: 'write-failed' };
  }
}

/** Every recorded run, oldest first. */
export function quizRuns(db: DatabaseSync): QuizRunsRead {
  try {
    const rows = db.prepare(`SELECT ${COLS} FROM continuity_quiz_runs ORDER BY id`).all() as unknown as RawRow[];
    return { ok: true, rows: rows.map(rowOf) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** When each recorded run that was not discarded was recorded, oldest first: the quiz lane's read (review 2121 F2), so a
 *  pending or confirmed run holds this week's item and a discarded one does not. It selects that column alone, so a corrupt
 *  value in another column never makes the lane's read fail. */
export function quizRecordedAts(db: DatabaseSync): { ok: true; value: number[] } | { ok: false; detail: string } {
  try {
    const rows = db.prepare("SELECT recordedAt FROM continuity_quiz_runs WHERE state != 'discarded' ORDER BY id").all() as { recordedAt: number }[];
    return { ok: true, value: rows.map((r) => r.recordedAt) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether a confirmed baseline row exists, and when it was recorded: the lane-arm door's fact (`decideLaneArmPost`), the quiz
 *  lane's title and the card's line. */
export function quizBaselineRead(db: DatabaseSync): QuizBaselineRead {
  try {
    const hit = db.prepare("SELECT recordedAt FROM continuity_quiz_runs WHERE baseline = 1 AND state = 'confirmed' ORDER BY id LIMIT 1")
      .get() as { recordedAt: number } | undefined;
    return hit === undefined ? { ok: true, exists: false, at: null } : { ok: true, exists: true, at: hit.recordedAt };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** The runs waiting for the operator's ruling, oldest first: the card's read. */
export function quizPendingRead(db: DatabaseSync): QuizPendingRead {
  try {
    const rows = db.prepare('SELECT id, measuredAt, score, lo, hi, questions, families, answered, runFailed, absent '
      + "FROM continuity_quiz_runs WHERE state = 'pending' ORDER BY id").all() as unknown as (LaneArmQuizPending & Record<string, number | null>)[];
    return { ok: true, runs: rows.map((r) => ({
      id: r.id, measuredAt: r.measuredAt, score: r.score, lo: r.lo, hi: r.hi, questions: r.questions, families: r.families,
      answered: r.answered ?? 0, runFailed: r.runFailed ?? 0, absent: r.absent ?? 0,
    })) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** The Shadow lanes card's two quiz reads (`laneArm.ts#laneArmViewOf`), each its own failure. */
export function quizCardReads(db: DatabaseSync): LaneArmQuizReads {
  return { baseline: quizBaselineRead(db), pending: quizPendingRead(db) };
}

/** The quiz lane's port (`quizLane.ts#QuizLanePort`) over the store, built once in the composition root. */
export function quizLanePortOf(coord: Pick<CoordStore, 'db' | 'raiseItem'>, recordReady: boolean): QuizLanePort {
  return {
    recordReady,
    recordedAts: () => quizRecordedAts(coord.db),
    baseline: () => quizBaselineRead(coord.db),
    itemRaised: (titles) => {
      try {
        return { ok: true, value: titles.some((t) => itemRaisedWithTitle(coord.db, QUIZ_ITEM_PROGRAMME, 'ccrc', t)) };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
    raise: (input, now) => coord.raiseItem(input, now, 'ccrc'),
  };
}
