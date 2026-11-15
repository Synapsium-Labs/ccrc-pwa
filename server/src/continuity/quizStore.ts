// L3 adapter: the replay quiz's record, `continuity_quiz_runs` (Overlord spec §3.3.9 C52; W1a, the replay quiz piece, plan
// `w1a-replay-quiz.md` Task 1). Its own module, so the quiz lane shares no store file with the server spine. ONE writer,
// `insertQuizRun`, which asks the baseline rule (`quiz.ts#quizBaseline`) inside its own transaction, over the rows already
// recorded and the W1a lane-arm rows read through the reader its caller hands it (`CoordStore.laneArmSetting`, the one reader
// of `lane_arm_settings`). Two reads: `quizRuns` and `quizBaselineRead` (the lane-arm door's fact). Nothing here decides
// beyond asking that rule, and no read folds a failure into an answer: each tells a failed read apart.
import type { DatabaseSync } from 'node:sqlite';
import type { LaneArmRead } from '../coord/laneArm.js';
import { tx } from '../coord/tx.js';
import { W1A_ARM_ROWS, quizBaseline, type QuizArmed, type QuizReport, type W1aArmRow } from './quiz.js';

/** What the writer records: the report as `validQuizReport` read it, who recorded it, and when. */
export interface QuizRunInsert {
  report: QuizReport;
  recordedBy: string;
  recordedAt: number;
}

/** One recorded run. */
export interface QuizRunRow extends QuizReport {
  id: number;
  recordedAt: number;
  recordedBy: string;
  baseline: boolean;
}

/** `fresh: false` is a resend that met the unique `reportSha`: the first row stands, and its id and baseline are answered. A
 *  statement that fails answers `write-failed`, never a throw. */
export type QuizRunInsertResult =
  | { ok: true; id: number; fresh: boolean; baseline: boolean }
  | { ok: false; kind: 'write-failed' };
export type QuizRunsRead = { ok: true; rows: QuizRunRow[] } | { ok: false; detail: string };
/** Whether a baseline row exists, or the read failed: never folded into `exists: false`. */
export type QuizBaselineRead = { ok: true; exists: boolean } | { ok: false; detail: string };

const COLS = 'id, measuredAt, recordedAt, recordedBy, reportSha, questionsSha, questions, families, score, lo, hi, judgeModel, '
  + 'ccrcRelease, claudeBuilds, steerArmed, agentsOnArmed, baseline';

interface RawRow {
  id: number; measuredAt: number; recordedAt: number; recordedBy: string; reportSha: string; questionsSha: string;
  questions: number; families: number; score: number; lo: number; hi: number; judgeModel: string; ccrcRelease: string;
  claudeBuilds: string; steerArmed: string; agentsOnArmed: string; baseline: number;
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
  };
}

/** THE TABLE'S ONE WRITER. In one transaction: a resend (the same `reportSha`) writes nothing and answers the stored row;
 *  otherwise the W1a rows are read through `readLane`, the baseline rule decides over them and the rows already recorded,
 *  and the row is inserted with its answer. */
export function insertQuizRun(db: DatabaseSync, input: QuizRunInsert, readLane: (lane: W1aArmRow) => LaneArmRead): QuizRunInsertResult {
  try {
    return tx(db, () => {
      const dup = db.prepare('SELECT id, baseline FROM continuity_quiz_runs WHERE reportSha = ?').get(input.report.reportSha) as
        { id: number; baseline: number } | undefined;
      if (dup !== undefined) return { ok: true as const, id: dup.id, fresh: false, baseline: dup.baseline === 1 };
      const earlier = (db.prepare('SELECT baseline FROM continuity_quiz_runs').all() as { baseline: number }[])
        .map((r) => ({ baseline: r.baseline === 1 }));
      const choices = Object.fromEntries(W1A_ARM_ROWS.map((lane) => [lane, readLane(lane)])) as Record<W1aArmRow, LaneArmRead>;
      const baseline = quizBaseline(earlier, choices);
      const r = input.report;
      const res = db.prepare(
        'INSERT INTO continuity_quiz_runs (measuredAt, recordedAt, recordedBy, reportSha, questionsSha, questions, families, score, '
        + 'lo, hi, judgeModel, ccrcRelease, claudeBuilds, steerArmed, agentsOnArmed, baseline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(r.measuredAt, input.recordedAt, input.recordedBy, r.reportSha, r.questionsSha, r.questions, r.families, r.score, r.lo,
        r.hi, r.judgeModel, r.ccrcRelease, JSON.stringify(r.claudeBuilds), r.steerArmed, r.agentsOnArmed, baseline ? 1 : 0);
      return { ok: true as const, id: Number(res.lastInsertRowid), fresh: true, baseline };
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

/** Whether a baseline row exists: the lane-arm door's fact (`decideLaneArmPost`) and the quiz lane's title. */
export function quizBaselineRead(db: DatabaseSync): QuizBaselineRead {
  try {
    const hit = db.prepare('SELECT 1 AS one FROM continuity_quiz_runs WHERE baseline = 1 LIMIT 1').get();
    return { ok: true, exists: hit !== undefined };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
