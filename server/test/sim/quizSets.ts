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

export const QUIZ_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [QUIZ_BASELINE_KEY]: QUIZ_BASELINE_SET as MutantSet<never>,
  [QUIZ_REPORT_KEY]: QUIZ_REPORT_SET as MutantSet<never>,
};
