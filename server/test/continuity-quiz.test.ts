// Overlord W1a, the replay quiz piece (plan `w1a-replay-quiz.md` Task 1; spec §3.3.9 C52, W0-28 ruled B): the record of a
// replay quiz run (`continuity_quiz_runs`), its one writer (`quizStore.ts#insertQuizRun`), and the baseline rule
// (`quiz.ts#quizBaseline`): the first run recorded while every W1a lane-arm row reads `shadow` is M13's baseline.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LaneArmRead } from '../src/coord/laneArm.js';
import {
  QUIZ_ARMED_WORDS, QUIZ_REPORT_FIELDS, QUIZ_RUN_STATES, W1A_ARM_ROWS, isW1aArmRow, quizBaseline, quizRuleVerdict, validQuizReport,
  type QuizReport, type QuizRunExtra, type W1aArmRow,
} from '../src/continuity/quiz.js';
import {
  insertQuizRun, quizBaselineRead, quizPendingCount, quizPendingRead, quizPendingWaits, quizRecordedAts, quizReportRecorded, quizRuns,
  ruleQuizRun,
} from '../src/continuity/quizStore.js';
import { LANE_ARM_LANES } from '../../shared/lane-arm.js';
import { mkTmp } from './tmpHelpers.js';

const SHA = (c: string): string => c.repeat(64);
const report = (over: Partial<Record<keyof QuizReport, unknown>> = {}): Record<string, unknown> => ({
  measuredAt: Date.UTC(2026, 10, 16, 9), reportSha: SHA('a'), questionsSha: SHA('b'), questions: 40, families: 6,
  score: 0.71, lo: 0.62, hi: 0.79, judgeModel: 'judge-model-a', ccrcRelease: 'v0.0.1', claudeBuilds: ['2.1.0'],
  steerArmed: 'no', agentsOnArmed: 'unmeasured', ...over,
});
const good = (over: Partial<Record<keyof QuizReport, unknown>> = {}): QuizReport => {
  const v = validQuizReport(report(over));
  if (!v.ok) throw new Error(`fixture report refused: ${v.field}`);
  return v.report;
};
const row = (choice: unknown): LaneArmRead => ({ kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null });
const allShadow = (): Record<W1aArmRow, LaneArmRead> =>
  ({ continuity: row('shadow'), 'launch-profile': row('shadow'), 'anchor-slot': row('shadow') });

const EXTRA: QuizRunExtra = {
  answered: 38, correct: 27, runFailed: 1, absent: 1, arm: 'treatment', settingsMode: 'restricted', pilot: 'skipped-by-ruling',
  ci: 95, method: 'percentile', bootstrapB: 10000,
  inputs: { setup_sha256: SHA('1'), frozen_sha256: SHA('2'), arms_summary_sha256: SHA('3'), judged_sha256: SHA('4') },
};
const C = (baseline: boolean) => ({ state: 'confirmed' as const, baseline });

const setup = () => {
  const home = mkTmp('ccrc-quiz-');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const read = (lane: W1aArmRow): LaneArmRead => coord.laneArmSetting(lane);
  return { coord, read };
};

describe('the W1a rows the baseline guards', () => {
  it('are the three lane-arm rows W1a adds, each a lane the card has, and nothing else', () => {
    expect([...W1A_ARM_ROWS]).toEqual(['continuity', 'launch-profile', 'anchor-slot']);
    for (const lane of W1A_ARM_ROWS) expect(LANE_ARM_LANES).toContain(lane);
    expect(isW1aArmRow('roster-card')).toBe(false);
    for (const lane of W1A_ARM_ROWS) expect(isW1aArmRow(lane)).toBe(true);
  });
});

describe('quizBaseline (the rule, L1)', () => {
  it('the first run with every W1a row shadow is the baseline', () => {
    expect(quizBaseline([], allShadow())).toBe(true);
  });

  it('a run after a baseline is not one', () => {
    expect(quizBaseline([C(false), C(true)], allShadow())).toBe(false);
  });

  it('a run after runs that were not baselines can be one (none of them was taken with every row shadow)', () => {
    expect(quizBaseline([C(false)], allShadow())).toBe(true);
  });

  it('reads confirmed rows only: a pending or discarded row is never an earlier baseline, whatever its flag says', () => {
    expect(quizBaseline([{ state: 'pending', baseline: true }], allShadow())).toBe(true);
    expect(quizBaseline([{ state: 'discarded', baseline: true }], allShadow())).toBe(true);
    expect([...QUIZ_RUN_STATES]).toEqual(['pending', 'confirmed', 'discarded']);
  });

  it('a first run recorded while any W1a row is live is not the baseline', () => {
    for (const lane of W1A_ARM_ROWS) {
      expect(quizBaseline([], { ...allShadow(), [lane]: row('live') }), lane).toBe(false);
    }
  });

  it('an unreadable, absent or unknown row makes no baseline: doubt never makes one', () => {
    for (const lane of W1A_ARM_ROWS) {
      expect(quizBaseline([], { ...allShadow(), [lane]: { kind: 'unreadable', detail: 'x' } }), lane).toBe(false);
      expect(quizBaseline([], { ...allShadow(), [lane]: { kind: 'absent' } }), lane).toBe(false);
      expect(quizBaseline([], { ...allShadow(), [lane]: row('later-word') }), lane).toBe(false);
    }
  });
});

describe('validQuizReport (the record\'s shape, L1)', () => {
  it('accepts a full report and keeps every field', () => {
    const v = validQuizReport(report());
    expect(v).toEqual({ ok: true, report: report() });
  });

  it('refuses a report missing any field the record needs, naming the field', () => {
    for (const field of QUIZ_REPORT_FIELDS) {
      const r = report();
      delete r[field];
      expect(validQuizReport(r), field).toEqual({ ok: false, field, detail: `${field} is missing` });
    }
  });

  it('refuses a malformed field, naming it', () => {
    const cases: [keyof QuizReport, unknown][] = [
      ['measuredAt', 0], ['measuredAt', 1.5], ['measuredAt', '2026'],
      ['reportSha', 'abc'], ['reportSha', SHA('A')], ['questionsSha', SHA('g')],
      ['questions', 0], ['questions', 2.5], ['families', -1], ['families', '6'],
      ['score', Number.NaN], ['score', 'high'], ['lo', 0.8], ['hi', 0.5], ['lo', Number.POSITIVE_INFINITY],
      ['judgeModel', ''], ['judgeModel', 3], ['judgeModel', 'x'.repeat(201)],
      ['ccrcRelease', ''], ['claudeBuilds', []], ['claudeBuilds', ['']], ['claudeBuilds', 'v1'], ['claudeBuilds', [1]],
      ['steerArmed', 'maybe'], ['agentsOnArmed', true],
    ];
    for (const [field, value] of cases) {
      expect(validQuizReport(report({ [field]: value })), `${field}=${String(value)}`).toMatchObject({ ok: false, field });
    }
  });

  it('refuses a field it does not know, naming it, and anything that is not an object', () => {
    expect(validQuizReport({ ...report(), pass: true })).toMatchObject({ ok: false, field: 'pass' });
    for (const v of [null, [], 'report', 3]) expect(validQuizReport(v)).toMatchObject({ ok: false, field: '(body)' });
  });

  it('the armed words are the four the record names', () => {
    expect([...QUIZ_ARMED_WORDS]).toEqual(['yes', 'no', 'partial', 'unmeasured']);
  });
});

describe('quizRuleVerdict (the operator\'s ruling, L1)', () => {
  const base = { id: 7, action: 'confirm' as const, runs: [], w1aChoices: allShadow() };
  it('confirms a pending run, the baseline by the rule, and discards one, never a baseline', () => {
    expect(quizRuleVerdict({ ...base, state: 'pending' })).toEqual({ kind: 'write', state: 'confirmed', baseline: true });
    expect(quizRuleVerdict({ ...base, state: 'pending', runs: [C(true)] })).toEqual({ kind: 'write', state: 'confirmed', baseline: false });
    expect(quizRuleVerdict({ ...base, state: 'pending', w1aChoices: { ...allShadow(), continuity: row('live') } }))
      .toEqual({ kind: 'write', state: 'confirmed', baseline: false });
    expect(quizRuleVerdict({ ...base, state: 'pending', action: 'discard' })).toEqual({ kind: 'write', state: 'discarded', baseline: false });
  });
  it('refuses a run that is not pending, and an unknown id, naming why', () => {
    expect(quizRuleVerdict({ ...base, state: 'confirmed' })).toEqual({ kind: 'refuse', detail: 'already confirmed' });
    expect(quizRuleVerdict({ ...base, state: 'discarded', action: 'discard' })).toEqual({ kind: 'refuse', detail: 'already discarded' });
    expect(quizRuleVerdict({ ...base, state: 'unknown' })).toEqual({ kind: 'refuse', detail: 'already unknown' });
    expect(quizRuleVerdict({ ...base, state: null })).toEqual({ kind: 'refuse', detail: 'no quiz run 7' });
  });
});

describe('continuity_quiz_runs (the record: one inserter, one ruler)', () => {
  const ins = (coord: CoordStore, over: Partial<Record<keyof QuizReport, unknown>> = {}, recordedAt = 1000) =>
    insertQuizRun(coord.db, { report: good(over), extra: EXTRA, recordedBy: 'quiz-record op both 2026-11-17T00:00:00Z', recordedAt });
  const rule = (coord: CoordStore, id: number, action: 'confirm' | 'discard', read: (l: W1aArmRow) => LaneArmRead) =>
    ruleQuizRun(coord.db, { id, action, at: 5000, by: 'device-a' }, read);
  const idOf = (r: ReturnType<typeof insertQuizRun>): number => { if (!r.ok) throw new Error('insert failed'); return r.id; };

  it('the inserter writes a pending run with no baseline, and the extra columns', () => {
    const { coord } = setup();
    expect(ins(coord)).toEqual({ ok: true, id: expect.any(Number), fresh: true, state: 'pending' });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: false, at: null });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows[0]).toMatchObject({ ...report(), state: 'pending', baseline: false, ruledAt: null, ruledBy: null,
      answered: 38, runFailed: 1, absent: 1 });
    expect(coord.db.prepare('SELECT correct, arm, settingsMode, pilot, ci, method, bootstrapB, inputs FROM continuity_quiz_runs').get())
      .toEqual({ correct: 27, arm: 'treatment', settingsMode: 'restricted', pilot: 'skipped-by-ruling', ci: 95, method: 'percentile',
        bootstrapB: 10000, inputs: JSON.stringify(EXTRA.inputs) });
  });

  it('the first confirmation with every W1a row shadow is the baseline, a second confirmation is not', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord, {}, 1000));
    const b = idOf(ins(coord, { reportSha: SHA('c') }, 2000));
    expect(rule(coord, a, 'confirm', read)).toEqual({ ok: true, id: a, state: 'confirmed', baseline: true, changed: true, reportSha: SHA('a') });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: true, at: 1000 });
    expect(rule(coord, b, 'confirm', read)).toEqual({ ok: true, id: b, state: 'confirmed', baseline: false, changed: true, reportSha: SHA('c') });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.map((r) => [r.state, r.baseline, r.ruledAt, r.ruledBy])).toEqual([
      ['confirmed', true, 5000, 'device-a'], ['confirmed', false, 5000, 'device-a'],
    ]);
  });

  it('a confirmation while a W1a row is live is not the baseline, and the next one taken all-shadow is', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord, {}, 1000));
    const b = idOf(ins(coord, { reportSha: SHA('c') }, 2000));
    coord.setLaneArm('launch-profile', 'live', 5);
    expect(rule(coord, a, 'confirm', read)).toMatchObject({ ok: true, baseline: false });
    coord.setLaneArm('launch-profile', 'shadow', 6);
    expect(rule(coord, b, 'confirm', read)).toMatchObject({ ok: true, baseline: true });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: true, at: 2000 });
  });

  it('an unreadable W1a row makes no baseline', () => {
    const { coord } = setup();
    const read = (lane: W1aArmRow): LaneArmRead => (lane === 'anchor-slot' ? { kind: 'unreadable', detail: 'x' } : coord.laneArmSetting(lane));
    expect(rule(coord, idOf(ins(coord)), 'confirm', read)).toMatchObject({ ok: true, baseline: false });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: false, at: null });
  });

  it('a discard leaves the row and never counts: not the baseline, not a recorded week, not pending', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord, {}, 1000));
    expect(rule(coord, a, 'discard', read)).toEqual({ ok: true, id: a, state: 'discarded', baseline: false, changed: true, reportSha: SHA('a') });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: false, at: null });
    expect(quizRecordedAts(coord.db)).toEqual({ ok: true, value: [] });
    expect(quizPendingRead(coord.db)).toEqual({ ok: true, runs: [] });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.map((r) => r.state)).toEqual(['discarded']);
    expect(rule(coord, idOf(ins(coord, { reportSha: SHA('c') }, 2000)), 'confirm', read)).toMatchObject({ baseline: true });
  });

  it('ruling a run that is not pending refuses and writes nothing; so does an unknown id', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord));
    rule(coord, a, 'confirm', read);
    expect(rule(coord, a, 'discard', read)).toEqual({ ok: false, kind: 'bad-request', detail: 'already confirmed' });
    expect(rule(coord, 99, 'confirm', read)).toEqual({ ok: false, kind: 'bad-request', detail: 'no quiz run 99' });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.map((r) => r.state)).toEqual(['confirmed']);
  });

  it('a duplicate reportSha is one row: the resend answers the first row\'s id and state, unchanged', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord, {}, 1000));
    expect(ins(coord, { score: 0.1, lo: 0.0, hi: 0.2 }, 2000)).toEqual({ ok: true, id: a, fresh: false, state: 'pending' });
    rule(coord, a, 'discard', read);
    expect(ins(coord, {}, 3000)).toEqual({ ok: true, id: a, fresh: false, state: 'discarded' });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.length).toBe(1);
    expect(runs.ok && runs.rows[0]).toMatchObject({ score: 0.71, recordedAt: 1000 });
  });

  // Review 2442 F2: the lane's recorded weeks are confirmed rows only (a pending run never silences the week; review 2121 F2
  // read pending rows too), and its pending read says whether any run waits. F1: the card's read names each run.
  it('the lane\'s recorded weeks are confirmed rows only; the card\'s pending read lists pending runs in id order, each named', () => {
    const { coord, read } = setup();
    const a = idOf(ins(coord, {}, 1000));
    const b = idOf(ins(coord, { reportSha: SHA('c') }, 2000));
    const c = idOf(ins(coord, { reportSha: SHA('d') }, 3000));
    const d = idOf(ins(coord, { reportSha: SHA('e') }, 4000));
    rule(coord, b, 'discard', read);
    expect(quizRecordedAts(coord.db)).toEqual({ ok: true, value: [] });
    expect(quizPendingWaits(coord.db)).toEqual({ ok: true, value: true });
    rule(coord, d, 'confirm', read);
    expect(quizRecordedAts(coord.db)).toEqual({ ok: true, value: [4000] });
    expect(quizPendingCount(coord.db)).toBe(2);
    // Review 2449 F3: a recorded report is recorded in any state; one never posted is not.
    expect([SHA('a'), SHA('c'), SHA('d'), SHA('e'), SHA('f')].map((x) => quizReportRecorded(coord.db, x))).toEqual([true, true, true, true, false]);
    expect(quizPendingRead(coord.db)).toEqual({ ok: true, runs: [[a, 1000, SHA('a')], [c, 3000, SHA('d')]].map(([id, recordedAt, sha]) => ({
      id, recordedAt, reportShaPrefix: String(sha).slice(0, 12), recordedBy: 'quiz-record op both 2026-11-17T00:00:00Z',
      measuredAt: Date.UTC(2026, 10, 16, 9), score: 0.71, lo: 0.62, hi: 0.79, questions: 40, families: 6, answered: 38, runFailed: 1, absent: 1,
    })) });
    rule(coord, a, 'discard', read);
    rule(coord, c, 'discard', read);
    expect(quizPendingWaits(coord.db)).toEqual({ ok: true, value: false });
  });

  it('every read tells a failed read apart, and both writers answer write-failed', () => {
    const { coord, read } = setup();
    coord.db.exec('DROP TABLE continuity_quiz_runs');
    expect(quizBaselineRead(coord.db)).toMatchObject({ ok: false });
    expect(quizRuns(coord.db)).toMatchObject({ ok: false });
    expect(quizRecordedAts(coord.db)).toMatchObject({ ok: false });
    expect(quizPendingRead(coord.db)).toMatchObject({ ok: false });
    expect(quizPendingWaits(coord.db)).toMatchObject({ ok: false });
    expect(() => quizPendingCount(coord.db)).toThrow();
    expect(() => quizReportRecorded(coord.db, SHA('a'))).toThrow();
    expect(ins(coord)).toEqual({ ok: false, kind: 'write-failed' });
    expect(rule(coord, 1, 'confirm', read)).toEqual({ ok: false, kind: 'write-failed' });
  });

  it('an existing row reads confirmed after the migration, its new counts NULL', () => {
    const { coord } = setup();
    coord.db.exec("INSERT INTO continuity_quiz_runs (measuredAt, recordedAt, recordedBy, reportSha, questionsSha, questions, families, "
      + "score, lo, hi, judgeModel, ccrcRelease, claudeBuilds, steerArmed, agentsOnArmed, baseline) VALUES (1, 2, 'op', '"
      + SHA('e') + "', '" + SHA('f') + "', 4, 2, 0.5, 0.4, 0.6, 'j', 'v', '[\"2\"]', 'no', 'no', 1)");
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows[0]).toMatchObject({ state: 'confirmed', baseline: true, answered: null, runFailed: null, absent: null });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: true, at: 2 });
  });

  it('the row holds the score, its interval and its counts only: no pass, verdict or benefit column', () => {
    const { coord } = setup();
    const cols = (coord.db.prepare('PRAGMA table_info(continuity_quiz_runs)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'measuredAt', 'recordedAt', 'recordedBy', 'reportSha', 'questionsSha', 'questions', 'families',
      'score', 'lo', 'hi', 'judgeModel', 'ccrcRelease', 'claudeBuilds', 'steerArmed', 'agentsOnArmed', 'baseline', 'state', 'ruledAt',
      'ruledBy', 'answered', 'correct', 'runFailed', 'absent', 'arm', 'settingsMode', 'pilot', 'ci', 'method', 'bootstrapB', 'inputs']);
    for (const c of cols) expect(c).not.toMatch(/pass|verdict|benefit|gain|lift|delta/i);
  });
});
