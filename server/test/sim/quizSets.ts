// The replay quiz's mutant sets (Overlord W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 1; the floors rule is
// D-8217's): `quizBaseline` and `validQuizReport`, run against suite cases that load the mutated copy of
// server/src/continuity/quiz.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { LaneArmRead } from '../../src/coord/laneArm.js';
import type * as QuizModule from '../../src/continuity/quiz.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Quiz = typeof QuizModule;
const QUIZ_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/quiz.ts');
export const QUIZ_BASELINE_KEY = 'server/src/continuity/quiz.ts#quizBaseline';
export const QUIZ_REPORT_KEY = 'server/src/continuity/quiz.ts#validQuizReport';

const row = (choice: unknown): LaneArmRead => ({ kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null });
const SHADOW = { continuity: row('shadow'), 'launch-profile': row('shadow'), 'anchor-slot': row('shadow') } as const;
const ROWS = ['continuity', 'launch-profile', 'anchor-slot'] as const;

const QUIZ_BASELINE_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    // Q1, the plan's: a second run made a baseline too.
    { id: 'Q1', old: 'if (runs.some((r) => r.baseline)) return false;', new: '' },
    // Q2: a live row read as shadow.
    { id: 'Q2', old: "return read.kind === 'row' && read.choice === 'shadow';", new: "return read.kind === 'row' && read.choice !== 'live';" },
    // Q3: an unreadable or absent row read as shadow (doubt makes a baseline).
    { id: 'Q3', old: "return read.kind === 'row' && read.choice === 'shadow';", new: "return read.kind !== 'row' || read.choice === 'shadow';" },
    // Q4: one row enough.
    { id: 'Q4', old: 'return W1A_ARM_ROWS.every((lane) => {', new: 'return W1A_ARM_ROWS.some((lane) => {' },
    // Q5: a row left out of the guarded list.
    { id: 'Q5', old: 'export const W1A_ARM_ROWS = [CONTINUITY_LANE, LAUNCH_PROFILE_LANE, ANCHOR_SLOT_LANE]', new: 'export const W1A_ARM_ROWS = [CONTINUITY_LANE, LAUNCH_PROFILE_LANE]' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'the first all-shadow run is the baseline': () => { expect(m.quizBaseline([], SHADOW)).toBe(true); },
      'a run after a baseline is not one': () => { expect(m.quizBaseline([{ baseline: true }], SHADOW)).toBe(false); },
      'any live row makes none': () => {
        for (const lane of ROWS) expect(m.quizBaseline([], { ...SHADOW, [lane]: row('live') }), lane).toBe(false);
      },
      'a token this build does not know makes none': () => {
        for (const lane of ROWS) expect(m.quizBaseline([], { ...SHADOW, [lane]: row('later') }), lane).toBe(false);
      },
      'an unreadable or absent row makes none': () => {
        for (const lane of ROWS) {
          expect(m.quizBaseline([], { ...SHADOW, [lane]: { kind: 'unreadable', detail: 'x' } }), lane).toBe(false);
          expect(m.quizBaseline([], { ...SHADOW, [lane]: { kind: 'absent' } }), lane).toBe(false);
        }
      },
      'the guarded rows are the three W1a rows': () => { expect([...m.W1A_ARM_ROWS]).toEqual([...ROWS]); },
    };
  },
};

const SHA = (c: string): string => c.repeat(64);
const report = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  measuredAt: 1, reportSha: SHA('a'), questionsSha: SHA('b'), questions: 40, families: 6, score: 0.7, lo: 0.6, hi: 0.8,
  judgeModel: 'judge-a', ccrcRelease: 'v1', claudeBuilds: ['2.1.0'], steerArmed: 'no', agentsOnArmed: 'unmeasured', ...over,
});

const QUIZ_REPORT_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    { id: 'R1', old: 'if (extra !== undefined) return', new: 'if (false) return' },
    { id: 'R2', old: "if (!(field in b)) return { ok: false, field, detail: `${field} is missing` };", new: '' },
    { id: 'R3', old: "if (r.lo > r.score) return { ok: false, field: 'lo', detail: 'lo is above the score' };", new: '' },
    { id: 'R4', old: "if (r.hi < r.score) return { ok: false, field: 'hi', detail: 'hi is below the score' };", new: '' },
    { id: 'R5', old: "const isSha = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);", new: "const isSha = (v: unknown): v is string => typeof v === 'string' && v.length > 0;" },
    { id: 'R6', old: '&& Number.isSafeInteger(v) && v > 0;', new: '&& v > 0;' },
    { id: 'R7', old: 'claudeBuilds: (v) => Array.isArray(v) && v.length > 0 && v.every(isWord),', new: 'claudeBuilds: (v) => Array.isArray(v),' },
    { id: 'R8', old: "if (json === null || typeof json !== 'object' || Array.isArray(json)) {", new: "if (json === null || typeof json !== 'object') {" },
    { id: 'R9', old: "steerArmed: isQuizArmed,", new: "steerArmed: (v) => typeof v === 'string'," },
    { id: 'R10', old: 'v.length <= QUIZ_WORD_MAX && ', new: '' },
  ],
  suite(m): Record<string, SuiteCase> {
    const refuses = (r: unknown, field: string): void => { expect(m.validQuizReport(r)).toMatchObject({ ok: false, field }); };
    return {
      'a full report is accepted': () => { expect(m.validQuizReport(report())).toEqual({ ok: true, report: report() }); },
      'an unknown field is refused': () => { refuses({ ...report(), pass: true }, 'pass'); },
      'each missing field is refused, named': () => {
        for (const f of m.QUIZ_REPORT_FIELDS) {
          const r = report(); delete r[f];
          expect(m.validQuizReport(r)).toEqual({ ok: false, field: f, detail: `${f} is missing` });
        }
      },
      'the interval must hold the score': () => { refuses(report({ lo: 0.75 }), 'lo'); refuses(report({ hi: 0.65 }), 'hi'); },
      'a sha is 64 lowercase hex': () => { refuses(report({ reportSha: 'abc' }), 'reportSha'); refuses(report({ questionsSha: SHA('A') }), 'questionsSha'); },
      'a count is a positive integer': () => { refuses(report({ questions: 2.5 }), 'questions'); refuses(report({ families: 0 }), 'families'); },
      'the builds are a non-empty list of words': () => {
        refuses(report({ claudeBuilds: [] }), 'claudeBuilds'); refuses(report({ claudeBuilds: [''] }), 'claudeBuilds');
      },
      'an array is no report': () => { refuses([], '(body)'); },
      'an armed word is one of the four': () => { refuses(report({ steerArmed: 'maybe' }), 'steerArmed'); },
      'a word is bounded': () => { refuses(report({ judgeModel: 'x'.repeat(201) }), 'judgeModel'); },
    };
  },
};

export const QUIZ_LANE_KEY = 'server/src/continuity/quiz.ts#quizLaneVerdict';
export const QUIZ_WEEK_KEY = 'server/src/continuity/quiz.ts#quizWeek';
const MON = Date.UTC(2026, 10, 16);
const DAY = 86_400_000;
type Facts = Parameters<Quiz['quizLaneVerdict']>[0];

const QUIZ_LANE_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    // L1, the ruling's (ask 434): the record path's gate dropped.
    { id: 'L1', old: "if (!f.recordReady) return { kind: 'hold', why: 'record-path-absent' };", new: '' },
    { id: 'L2', old: "if (!f.recordedAts.ok || !f.baseline.ok || !f.itemRaised.ok) return", new: "if (!f.recordedAts.ok || !f.baseline.ok) return" },
    { id: 'L3', old: "if (!f.recordedAts.ok || !f.baseline.ok || !f.itemRaised.ok) return", new: "if (!f.recordedAts.ok || !f.itemRaised.ok) return" },
    { id: 'L4', old: 'f.recordedAts.value.some((at) => at >= f.week.start)', new: 'f.recordedAts.value.some((at) => at > f.week.start)' },
    { id: 'L5', old: "if (f.itemRaised.value) return { kind: 'hold', why: 'raised' };", new: '' },
    { id: 'L6', old: "return { kind: 'raise', item: quizItemText(f.week.key, f.baseline.exists) };", new: "return { kind: 'raise', item: quizItemText(f.week.key, true) };" },
    { id: 'L7', old: 'f.recordedAts.value.some((at) => at >= f.week.start)', new: 'f.recordedAts.value.length > 0' },
  ],
  suite(m): Record<string, SuiteCase> {
    const facts = (over: Partial<Facts> = {}): Facts => ({
      recordReady: true, week: { key: '2026-W47', start: MON }, recordedAts: { ok: true, value: [] }, baseline: { ok: true, exists: false },
      itemRaised: { ok: true, value: false }, ...over,
    });
    return {
      'held while the record path is absent': () => { expect(m.quizLaneVerdict(facts({ recordReady: false }))).toEqual({ kind: 'hold', why: 'record-path-absent' }); },
      'each failed read holds': () => {
        expect(m.quizLaneVerdict(facts({ itemRaised: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
        expect(m.quizLaneVerdict(facts({ baseline: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
        expect(m.quizLaneVerdict(facts({ recordedAts: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
      },
      'a run recorded at the week\'s first ms counts': () => { expect(m.quizLaneVerdict(facts({ recordedAts: { ok: true, value: [MON] } }))).toEqual({ kind: 'hold', why: 'recorded' }); },
      'a run of last week does not': () => { expect(m.quizLaneVerdict(facts({ recordedAts: { ok: true, value: [MON - 1] } })).kind).toBe('raise'); },
      'raised once': () => { expect(m.quizLaneVerdict(facts({ itemRaised: { ok: true, value: true } }))).toEqual({ kind: 'hold', why: 'raised' }); },
      'the baseline title before one exists': () => { expect(m.quizLaneVerdict(facts())).toEqual({ kind: 'raise', item: m.quizItemText('2026-W47', false) }); },
    };
  },
};

const QUIZ_WEEK_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    { id: 'W1', old: 'const dow = (d.getUTCDay() + 6) % 7;', new: 'const dow = d.getUTCDay();' },
    { id: 'W2', old: 'const thursday = new Date(start + 3 * 86_400_000);', new: 'const thursday = new Date(start);' },
    { id: 'W3', old: 'const week = 1 + Math.floor(', new: 'const week = Math.floor(' },
    { id: 'W4', old: "String(week).padStart(2, '0')", new: 'String(week)' },
    { id: 'W5', old: 'const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());', new: 'const midnight = now;' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'a Monday starts its week': () => { expect(m.quizWeek(MON)).toEqual({ key: '2026-W47', start: MON }); },
      'a Sunday ends it': () => { expect(m.quizWeek(MON + 7 * DAY - 1)).toEqual({ key: '2026-W47', start: MON }); },
      'the year turns by the ISO rule': () => {
        expect(m.quizWeek(Date.UTC(2027, 0, 1, 12)).key).toBe('2026-W53');
        expect(m.quizWeek(Date.UTC(2027, 0, 4)).key).toBe('2027-W01');
        expect(m.quizWeek(Date.UTC(2026, 0, 1)).key).toBe('2026-W01');
      },
    };
  },
};

export const QUIZ_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [QUIZ_BASELINE_KEY]: QUIZ_BASELINE_SET as MutantSet<never>,
  [QUIZ_REPORT_KEY]: QUIZ_REPORT_SET as MutantSet<never>,
  [QUIZ_LANE_KEY]: QUIZ_LANE_SET as MutantSet<never>,
  [QUIZ_WEEK_KEY]: QUIZ_WEEK_SET as MutantSet<never>,
};
