// The replay quiz's mutant sets (Overlord W1a, the replay quiz piece, plan `w1a-replay-quiz.md` Task 1, and the record path,
// plan `2026-11-17-overlord-quiz-record.md` Tasks 7 and 8; the floors rule is D-8217's): `quizBaseline`, `validQuizReport`,
// `quizRuleVerdict` and `quizRecordVerdict`, run against suite cases that load the mutated copy of
// server/src/continuity/quiz.ts. Registered in mutation-floors.test.ts's MUTANT_SETS, with a floor each in
// mutation-floors.json.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { LaneArmRead } from '../../src/coord/laneArm.js';
import type * as QuizModule from '../../src/continuity/quiz.js';
import type * as LaneArmModule from '../../src/coord/laneArm.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Quiz = typeof QuizModule;
const QUIZ_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/continuity/quiz.ts');
export const QUIZ_BASELINE_KEY = 'server/src/continuity/quiz.ts#quizBaseline';
export const QUIZ_REPORT_KEY = 'server/src/continuity/quiz.ts#validQuizReport';
export const QUIZ_RULE_KEY = 'server/src/continuity/quiz.ts#quizRuleVerdict';
export const QUIZ_RECORD_KEY = 'server/src/continuity/quiz.ts#quizRecordVerdict';
export const LANE_ARM_QUIZ_KEY = 'server/src/coord/laneArm.ts#laneArmQuizViewOf';
const LANE_ARM_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/coord/laneArm.ts');

const row = (choice: unknown): LaneArmRead => ({ kind: 'row', choice, updatedAt: 0, importedAt: null, imported: null });
const SHADOW = { continuity: row('shadow'), 'launch-profile': row('shadow'), 'anchor-slot': row('shadow') } as const;
const ROWS = ['continuity', 'launch-profile', 'anchor-slot'] as const;
const CONFIRMED = (baseline: boolean) => ({ state: 'confirmed' as const, baseline });

const QUIZ_BASELINE_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    // Q1, the plan's: a second run made a baseline too.
    { id: 'Q1', old: "if (runs.some((r) => r.state === 'confirmed' && r.baseline)) return false;", new: '' },
    // Q2: a live row read as shadow.
    { id: 'Q2', old: "return read.kind === 'row' && read.choice === 'shadow';", new: "return read.kind === 'row' && read.choice !== 'live';" },
    // Q3: an unreadable or absent row read as shadow (doubt makes a baseline).
    { id: 'Q3', old: "return read.kind === 'row' && read.choice === 'shadow';", new: "return read.kind !== 'row' || read.choice === 'shadow';" },
    // Q4: one row enough.
    { id: 'Q4', old: 'return W1A_ARM_ROWS.every((lane) => {', new: 'return W1A_ARM_ROWS.some((lane) => {' },
    // Q6, the record path's: a pending or discarded row read as an earlier baseline (the confirmed-only read).
    { id: 'Q6', old: "if (runs.some((r) => r.state === 'confirmed' && r.baseline)) return false;", new: 'if (runs.some((r) => r.baseline)) return false;' },
    // Q5: a row left out of the guarded list.
    { id: 'Q5', old: 'export const W1A_ARM_ROWS = [CONTINUITY_LANE, LAUNCH_PROFILE_LANE, ANCHOR_SLOT_LANE]', new: 'export const W1A_ARM_ROWS = [CONTINUITY_LANE, LAUNCH_PROFILE_LANE]' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'the first all-shadow run is the baseline': () => { expect(m.quizBaseline([], SHADOW)).toBe(true); },
      'a run after a baseline is not one': () => { expect(m.quizBaseline([CONFIRMED(true)], SHADOW)).toBe(false); },
      'a pending or discarded row is never an earlier baseline': () => {
        expect(m.quizBaseline([{ state: 'pending', baseline: true }], SHADOW)).toBe(true);
        expect(m.quizBaseline([{ state: 'discarded', baseline: true }], SHADOW)).toBe(true);
      },
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

const QUIZ_RULE_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    { id: 'V1', old: "if (i.state === null) return { kind: 'refuse', detail: `no quiz run ${i.id}` };", new: '' },
    { id: 'V2', old: "if (i.state !== 'pending') return { kind: 'refuse', detail: `already ${i.state}` };", new: '' },
    { id: 'V3', old: "return { kind: 'write', state: 'discarded', baseline: false };", new: "return { kind: 'write', state: 'discarded', baseline: true };" },
    { id: 'V4', old: "baseline: quizBaseline(i.runs, i.w1aChoices) };", new: 'baseline: true };' },
    { id: 'V5', old: "if (i.action === 'discard') return", new: "if (i.action !== 'discard') return" },
  ],
  suite(m): Record<string, SuiteCase> {
    const base = { id: 7, action: 'confirm' as const, runs: [], w1aChoices: SHADOW };
    return {
      'a pending confirm is the baseline by the rule': () => {
        expect(m.quizRuleVerdict({ ...base, state: 'pending' })).toEqual({ kind: 'write', state: 'confirmed', baseline: true });
        expect(m.quizRuleVerdict({ ...base, state: 'pending', runs: [CONFIRMED(true)] })).toEqual({ kind: 'write', state: 'confirmed', baseline: false });
      },
      'a discard is never a baseline': () => {
        expect(m.quizRuleVerdict({ ...base, state: 'pending', action: 'discard' })).toEqual({ kind: 'write', state: 'discarded', baseline: false });
      },
      'a run that is not pending refuses': () => {
        expect(m.quizRuleVerdict({ ...base, state: 'confirmed' })).toEqual({ kind: 'refuse', detail: 'already confirmed' });
      },
      'an unknown id refuses': () => { expect(m.quizRuleVerdict({ ...base, state: null })).toEqual({ kind: 'refuse', detail: 'no quiz run 7' }); },
    };
  },
};

const NOW = Date.UTC(2026, 10, 24, 12);
/** A single-arm report as history's module writes it (plan §4): 100 questions, 96 answered, 3 failed to run, 1 absent. */
export const singleReport = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'ccrc-history-quiz-single-report', v: 1, measured_ms: NOW - DAY, arm: 'treatment', pilot: 'skipped-by-ruling',
  settings_mode: 'restricted', frozen_sha256: SHA('b'), n_questions: 100, n_families: 34,
  counts: { questions: 100, answered: 96, correct: 79, run_failed: 3, absent: 1 }, share: { num: 79, den: 96 },
  interval: { lower: { num: 73, den: 96 }, upper: { num: 84, den: 96 }, ci: 95, method: 'percentile', B: 10000 },
  judge_model: 'judge-a', ccrc_release: 'v1', claude_code_versions: ['2.1.0'], steer_armed: 'no', agents_on_armed: 'no',
  inputs: { setup_sha256: SHA('1'), frozen_sha256: SHA('b'), arms_summary_sha256: SHA('3'), judged_sha256: SHA('4') }, ...over,
});
const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

const QUIZ_RECORD_SET: MutantSet<Quiz> = {
  modulePath: QUIZ_TS,
  mutants: [
    // The plan's three (Task 8 step 5): the sha comparison, the answered floor and the freshness bound.
    { id: 'D1', old: '|| i.claimedSha !== i.measuredSha)', new: ')' },
    { id: 'D2', old: 'if (n.answered * QUIZ_ANSWERED_FLOOR.den < n.questions * QUIZ_ANSWERED_FLOOR.num) {', new: 'if (false) {' },
    { id: 'D3', old: '|| at < i.now - QUIZ_RECORD_MAX_AGE_DAYS * QUIZ_DAY_MS)', new: ')' },
    { id: 'D4', old: 'if (!isNat(at) || at > i.now + QUIZ_RECORD_FUTURE_SLACK_MS ||', new: 'if (!isNat(at) ||' },
    { id: 'D5', old: "|| b['v'] !== QUIZ_SINGLE_REPORT_V)", new: ')' },
    { id: 'D6', old: 'if (stray !== undefined) return', new: 'if (false) return' },
    { id: 'D7', old: "if (b['arm'] !== QUIZ_TREATMENT_ARM) return", new: 'if (false) return' },
    { id: 'D8', old: "if (b['pilot'] !== QUIZ_PILOT_SKIPPED) return", new: 'if (false) return' },
    { id: 'D9', old: "if (typeof mode !== 'string' || !(QUIZ_SETTINGS_MODES as readonly string[]).includes(mode)) return", new: 'if (false) return' },
    { id: 'D10', old: "|| iv['method'] !== QUIZ_BOOTSTRAP.method", new: '' },
    { id: 'D11', old: 'if (n.questions !== n.answered + n.runFailed + n.absent || ', new: 'if (' },
    { id: 'D12', old: "|| n.questions !== b['n_questions']", new: '' },
    { id: 'D13', old: "|| share['den'] !== n.answered)", new: ')' },
    { id: 'D14', old: 'return f.den > 0 && f.num <= f.den ? f : null;', new: 'return f.den > 0 ? f : null;' },
    { id: 'D15', old: 'if (!mapped.ok) return mapped;', new: '' },
    { id: 'D16', old: '!QUIZ_INPUT_KEYS.every((k) => isSha(inputs[k]))', new: 'false' },
    { id: 'D17', old: "|| n.correct > n.answered", new: '' },
    { id: 'D18', old: "|| iv['B'] !== QUIZ_BOOTSTRAP.B", new: '' },
    // Review 2442 F4: the inputs' frozen sha is the top level's.
    { id: 'D19', old: "|| inputs['frozen_sha256'] !== b['frozen_sha256']", new: '' },
    // Review 2442 F5: the four sub-conditions that had no case: the interval's ci, the kind, the share's numerator alone, and
    // an extra key in the inputs.
    { id: 'D20', old: "|| iv['ci'] !== QUIZ_BOOTSTRAP.ci", new: '' },
    { id: 'D21', old: "if (b['kind'] !== QUIZ_SINGLE_REPORT_KIND || b['v']", new: "if (b['v']" },
    { id: 'D22', old: "|| share['num'] !== n.correct", new: '' },
    { id: 'D23', old: 'Object.keys(inputs).length !== QUIZ_INPUT_KEYS.length || ', new: '' },
    // Review 2442 F3: the pending cap, and its bound.
    { id: 'D24', old: 'if (i.pending >= QUIZ_PENDING_CAP) {', new: 'if (false) {' },
    { id: 'D25', old: 'if (i.pending >= QUIZ_PENDING_CAP) {', new: 'if (i.pending > QUIZ_PENDING_CAP) {' },
  ],
  suite(m): Record<string, SuiteCase> {
    const verdict = (r: Record<string, unknown>, claimed?: string, pending = 0) => {
      const text = JSON.stringify(r);
      return m.quizRecordVerdict({ text, claimedSha: claimed ?? sha256(text), measuredSha: sha256(text), now: NOW, pending });
    };
    const inputs = (over: Record<string, unknown>) => singleReport({ inputs: { ...(singleReport()['inputs'] as object), ...over } });
    const refuses = (r: Record<string, unknown>, field: string): void => { expect(verdict(r)).toMatchObject({ ok: false, field }); };
    const counts = (c: Record<string, number>, share = { num: c['correct']!, den: c['answered']! }) => singleReport({ counts: c, share, n_questions: c['questions'] });
    return {
      'a good report maps': () => { expect(verdict(singleReport())).toMatchObject({ ok: true, report: { score: 79 / 96, questions: 100 }, extra: { answered: 96 } }); },
      'a sha that is not the text\'s refuses': () => { expect(verdict(singleReport(), SHA('9'))).toMatchObject({ ok: false, field: 'sha256' }); },
      'the answered floor refuses': () => { refuses(counts({ questions: 100, answered: 89, correct: 50, run_failed: 10, absent: 1 }), 'counts'); },
      'nine days old refuses, and so does the future': () => {
        refuses(singleReport({ measured_ms: NOW - 9 * DAY }), 'measured_ms');
        refuses(singleReport({ measured_ms: NOW + 6 * 60_000 }), 'measured_ms');
      },
      'a foreign version refuses': () => { refuses(singleReport({ v: 2 }), 'kind'); },
      'a comparison key refuses': () => { refuses(singleReport({ lift: 0.1 }), 'lift'); },
      'a wrong arm refuses': () => { refuses(singleReport({ arm: 'control' }), 'arm'); },
      'a missing pilot refuses': () => { const r = singleReport(); delete r['pilot']; refuses(r, 'pilot'); },
      'a foreign settings mode refuses': () => { refuses(singleReport({ settings_mode: 'open' }), 'settings_mode'); },
      'a foreign method or B refuses': () => {
        refuses(singleReport({ interval: { ...(singleReport()['interval'] as object), method: 'bca' } }), 'interval');
        refuses(singleReport({ interval: { ...(singleReport()['interval'] as object), B: 100 } }), 'interval');
      },
      'counts that do not add up refuse': () => {
        refuses(counts({ questions: 100, answered: 96, correct: 79, run_failed: 3, absent: 2 }), 'counts');
        refuses(singleReport({ n_questions: 99 }), 'counts');
        refuses(counts({ questions: 100, answered: 96, correct: 97, run_failed: 3, absent: 1 }, { num: 97, den: 96 }), 'counts');
        refuses(counts({ questions: 100, answered: 96, correct: 79, run_failed: 3, absent: 1 }, { num: 79, den: 100 }), 'counts');
      },
      'an interval end above one refuses': () => {
        refuses(singleReport({ interval: { ...(singleReport()['interval'] as object), upper: { num: 97, den: 96 } } }), 'interval');
      },
      'an interval missing its score refuses, never clamped': () => {
        refuses(singleReport({ interval: { ...(singleReport()['interval'] as object), lower: { num: 80, den: 96 } } }), 'lo');
      },
      'malformed inputs refuse': () => { refuses(singleReport({ inputs: { setup_sha256: 'x', frozen_sha256: SHA('b'), arms_summary_sha256: SHA('3'), judged_sha256: SHA('4') } }), 'inputs'); },
      'inputs whose frozen sha is not the report\'s refuse': () => { refuses(inputs({ frozen_sha256: SHA('c') }), 'inputs'); },
      'an extra key in the inputs refuses': () => { refuses(inputs({ extra_sha256: SHA('5') }), 'inputs'); },
      'a foreign ci refuses': () => { refuses(singleReport({ interval: { ...(singleReport()['interval'] as object), ci: 90 } }), 'interval'); },
      'a foreign kind refuses': () => { refuses(singleReport({ kind: 'ccrc-history-quiz-report' }), 'kind'); },
      'a share whose numerator alone is not the correct count refuses': () => {
        refuses(counts({ questions: 100, answered: 96, correct: 79, run_failed: 3, absent: 1 }, { num: 78, den: 96 }), 'counts');
      },
      'five pending runs refuse a sixth with its own word, and four leave room': () => {
        expect(verdict(singleReport(), undefined, 5)).toMatchObject({ ok: false, field: 'pending', word: 'quiz-pending-full' });
        expect(verdict(singleReport(), undefined, 4)).toMatchObject({ ok: true });
      },
    };
  },
};

// The Shadow lanes card's quiz block (plan Task 12): the baseline is never folded into "not yet", nor a failed pending read
// into no runs, and the view carries the block when its reads are given.
const LANE_ARM_QUIZ_SET: MutantSet<typeof LaneArmModule> = {
  modulePath: LANE_ARM_TS,
  mutants: [
    { id: 'A1', old: "? { state: 'unreadable', detail: q.baseline.detail }", new: "? { state: 'not-yet' }" },
    { id: 'A2', old: ": q.baseline.exists ? { state: 'recorded', at: q.baseline.at } : { state: 'not-yet' };", new: ": { state: 'recorded', at: q.baseline.at };" },
    { id: 'A3', old: "q.pending.ok ? { ok: true, runs: [...q.pending.runs] } : { ok: false, detail: q.pending.detail };", new: '{ ok: true, runs: q.pending.ok ? [...q.pending.runs] : [] };' },
    { id: 'A4', old: '{ lanes, quizBaseline: laneArmQuizViewOf(quiz) }', new: '{ lanes }' },
  ],
  suite(m): Record<string, SuiteCase> {
    const run = { id: 1, measuredAt: 5, score: 0.8, lo: 0.7, hi: 0.9, questions: 10, families: 3, answered: 10, runFailed: 0, absent: 0 };
    const ok = { ok: true, runs: [run] } as const;
    return {
      'a recorded baseline carries its date': () => {
        expect(m.laneArmQuizViewOf({ baseline: { ok: true, exists: true, at: 9 }, pending: ok })).toEqual({ baseline: { state: 'recorded', at: 9 }, pending: ok });
      },
      'no baseline is not yet': () => {
        expect(m.laneArmQuizViewOf({ baseline: { ok: true, exists: false, at: null }, pending: ok }).baseline).toEqual({ state: 'not-yet' });
      },
      'a failed baseline read is unreadable': () => {
        expect(m.laneArmQuizViewOf({ baseline: { ok: false, detail: 'x' }, pending: ok }).baseline).toEqual({ state: 'unreadable', detail: 'x' });
      },
      'a failed pending read stays a failure': () => {
        expect(m.laneArmQuizViewOf({ baseline: { ok: true, exists: false, at: null }, pending: { ok: false, detail: 'y' } }).pending)
          .toEqual({ ok: false, detail: 'y' });
      },
      'the view carries the block when given its reads': () => {
        const v = m.laneArmViewOf(() => ({ kind: 'absent' }), { baseline: { ok: true, exists: false, at: null }, pending: ok });
        expect(v.quizBaseline).toEqual({ baseline: { state: 'not-yet' }, pending: ok });
        expect('quizBaseline' in m.laneArmViewOf(() => ({ kind: 'absent' }))).toBe(false);
      },
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
    { id: 'L2', old: '!f.baseline.ok || !f.itemRaised.ok ||', new: '!f.baseline.ok ||' },
    { id: 'L3', old: '|| !f.baseline.ok || !f.itemRaised.ok', new: '|| !f.itemRaised.ok' },
    { id: 'L4', old: 'f.recordedAts.value.some((at) => at >= f.week.start)', new: 'f.recordedAts.value.some((at) => at > f.week.start)' },
    { id: 'L5', old: "if (f.itemRaised.value) return { kind: 'hold', why: 'raised' };", new: '' },
    { id: 'L6', old: 'quizItemText(f.week.key, f.baseline.exists, f.pendingWaits.value)', new: 'quizItemText(f.week.key, true, f.pendingWaits.value)' },
    { id: 'L7', old: 'f.recordedAts.value.some((at) => at >= f.week.start)', new: 'f.recordedAts.value.length > 0' },
    // Review 2442 F2: the pending read's failure holds, and a waiting run is said in the item.
    { id: 'L8', old: '|| !f.pendingWaits.ok)', new: ')' },
    { id: 'L9', old: 'quizItemText(f.week.key, f.baseline.exists, f.pendingWaits.value)', new: 'quizItemText(f.week.key, f.baseline.exists)' },
    { id: 'L10', old: 'const waiting = pendingWaits', new: 'const waiting = false' },
  ],
  suite(m): Record<string, SuiteCase> {
    const facts = (over: Partial<Facts> = {}): Facts => ({
      recordReady: true, week: { key: '2026-W47', start: MON }, recordedAts: { ok: true, value: [] }, pendingWaits: { ok: true, value: false },
      baseline: { ok: true, exists: false },
      itemRaised: { ok: true, value: false }, ...over,
    });
    return {
      'held while the record path is absent': () => { expect(m.quizLaneVerdict(facts({ recordReady: false }))).toEqual({ kind: 'hold', why: 'record-path-absent' }); },
      'each failed read holds': () => {
        expect(m.quizLaneVerdict(facts({ itemRaised: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
        expect(m.quizLaneVerdict(facts({ baseline: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
        expect(m.quizLaneVerdict(facts({ recordedAts: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
        expect(m.quizLaneVerdict(facts({ pendingWaits: { ok: false, detail: 'x' } }))).toEqual({ kind: 'hold', why: 'unmeasured' });
      },
      'a run waiting for a ruling is said in the item': () => {
        const v = m.quizLaneVerdict(facts({ pendingWaits: { ok: true, value: true } }));
        expect(v).toEqual({ kind: 'raise', item: m.quizItemText('2026-W47', false, true) });
        expect(v.kind === 'raise' && v.item.how[0]).toMatch(/^A recorded run is waiting for your Confirm or Discard on the Shadow lanes card/);
        expect(m.quizItemText('2026-W47', false, false).how[0]).not.toMatch(/waiting/);
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
  [QUIZ_RULE_KEY]: QUIZ_RULE_SET as MutantSet<never>,
  [QUIZ_RECORD_KEY]: QUIZ_RECORD_SET as MutantSet<never>,
  [LANE_ARM_QUIZ_KEY]: LANE_ARM_QUIZ_SET as MutantSet<never>,
  [QUIZ_LANE_KEY]: QUIZ_LANE_SET as MutantSet<never>,
  [QUIZ_WEEK_KEY]: QUIZ_WEEK_SET as MutantSet<never>,
};
