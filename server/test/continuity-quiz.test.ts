// Overlord W1a, the replay quiz piece (plan `w1a-replay-quiz.md` Task 1; spec §3.3.9 C52, W0-28 ruled B): the record of a
// replay quiz run (`continuity_quiz_runs`), its one writer (`quizStore.ts#insertQuizRun`), and the baseline rule
// (`quiz.ts#quizBaseline`): the first run recorded while every W1a lane-arm row reads `shadow` is M13's baseline.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { LaneArmRead } from '../src/coord/laneArm.js';
import {
  QUIZ_ARMED_WORDS, QUIZ_REPORT_FIELDS, W1A_ARM_ROWS, isW1aArmRow, quizBaseline, validQuizReport, type QuizReport, type W1aArmRow,
} from '../src/continuity/quiz.js';
import { insertQuizRun, quizBaselineRead, quizRuns } from '../src/continuity/quizStore.js';
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
    expect(quizBaseline([{ baseline: false }, { baseline: true }], allShadow())).toBe(false);
  });

  it('a run after runs that were not baselines can be one (none of them was taken with every row shadow)', () => {
    expect(quizBaseline([{ baseline: false }], allShadow())).toBe(true);
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

describe('continuity_quiz_runs (the record, one writer)', () => {
  it('the first run with every W1a row shadow is recorded as the baseline, a second is not', () => {
    const { coord, read } = setup();
    const a = insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read);
    expect(a).toEqual({ ok: true, id: expect.any(Number), fresh: true, baseline: true });
    const b = insertQuizRun(coord.db, { report: good({ reportSha: SHA('c') }), recordedBy: 'operator', recordedAt: 2000 }, read);
    expect(b).toEqual({ ok: true, id: expect.any(Number), fresh: true, baseline: false });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.map((r) => [r.reportSha, r.baseline, r.recordedAt, r.recordedBy])).toEqual([
      [SHA('a'), true, 1000, 'operator'], [SHA('c'), false, 2000, 'operator'],
    ]);
    expect(runs.ok && runs.rows[0]).toMatchObject({ ...report(), claudeBuilds: ['2.1.0'] });
  });

  it('a first run recorded while a W1a row is live is not the baseline, and the next one taken all-shadow is', () => {
    const { coord, read } = setup();
    coord.setLaneArm('launch-profile', 'live', 5);
    expect(insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read)).toMatchObject({ baseline: false });
    coord.setLaneArm('launch-profile', 'shadow', 6);
    expect(insertQuizRun(coord.db, { report: good({ reportSha: SHA('c') }), recordedBy: 'operator', recordedAt: 2000 }, read))
      .toMatchObject({ baseline: true });
  });

  it('an unreadable W1a row makes no baseline', () => {
    const { coord } = setup();
    const read = (lane: W1aArmRow): LaneArmRead => (lane === 'anchor-slot' ? { kind: 'unreadable', detail: 'x' } : coord.laneArmSetting(lane));
    expect(insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read)).toMatchObject({ baseline: false });
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: false });
  });

  it('a duplicate reportSha is one row: the resend answers the first row\'s id, unchanged', () => {
    const { coord, read } = setup();
    const a = insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read);
    const b = insertQuizRun(coord.db, { report: good({ score: 0.1, lo: 0.0, hi: 0.2 }), recordedBy: 'other', recordedAt: 2000 }, read);
    expect(a.ok && b.ok && b.id === a.id).toBe(true);
    expect(b).toMatchObject({ fresh: false, baseline: true });
    const runs = quizRuns(coord.db);
    expect(runs.ok && runs.rows.length).toBe(1);
    expect(runs.ok && runs.rows[0]).toMatchObject({ score: 0.71, recordedBy: 'operator', recordedAt: 1000 });
  });

  it('quizBaselineRead tells missing, present and unreadable apart', () => {
    const { coord, read } = setup();
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: false });
    insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read);
    expect(quizBaselineRead(coord.db)).toEqual({ ok: true, exists: true });
    coord.db.exec('DROP TABLE continuity_quiz_runs');
    expect(quizBaselineRead(coord.db)).toMatchObject({ ok: false });
    expect(quizRuns(coord.db)).toMatchObject({ ok: false });
    expect(insertQuizRun(coord.db, { report: good(), recordedBy: 'operator', recordedAt: 1000 }, read)).toEqual({ ok: false, kind: 'write-failed' });
  });

  it('the row holds the score and its interval only: no pass, verdict or benefit column', () => {
    const { coord } = setup();
    const cols = (coord.db.prepare('PRAGMA table_info(continuity_quiz_runs)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'measuredAt', 'recordedAt', 'recordedBy', 'reportSha', 'questionsSha', 'questions', 'families',
      'score', 'lo', 'hi', 'judgeModel', 'ccrcRelease', 'claudeBuilds', 'steerArmed', 'agentsOnArmed', 'baseline']);
    for (const c of cols) expect(c).not.toMatch(/pass|verdict|benefit|gain/i);
  });
});
