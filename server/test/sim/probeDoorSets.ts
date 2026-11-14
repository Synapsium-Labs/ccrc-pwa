// The probe door's, the probe schedule's and the snapshot reader's oracles and mutant sets (Overlord W1a probes, PR B:
// w1a-probes.md, Tasks 4 to 6). As in `probeSets.ts`, each decider's cases are written ONCE here, as suite cases over a
// module: `continuity-probe-door.test.ts` and `continuity-probe-schedule.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { CardFacts, CardItem, CardMail, CardNote } from '../../../shared/continuity-card.js';
import { BOOK_STATES, GENERATION_STATES, SPOT_PROBE_EVERY_TOKENS, type ProbeGrade, type ProbeRoundKind } from '../../../shared/continuity.js';
import { CARD_TEXT_PREFACE } from '../../src/coord/untrusted.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type ProbeDoorModule = typeof import('../../src/continuity/probeDoor.js');
export type ProbeScheduleModule = typeof import('../../src/continuity/probeSchedule.js');
export type CardModule = typeof import('../../src/continuity/card.js');
type Question = Parameters<ProbeDoorModule['probePages']>[2][number];
type Rows = Parameters<ProbeScheduleModule['roundsOf']>[0];
type Row = Rows[number];
type Round = Parameters<ProbeScheduleModule['compactionWindowStart']>[1][number];
type Input = Parameters<ProbeScheduleModule['probeSchedule']>[0];

const AT = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60_000;
const NOPE = { kind: 'unmeasured' as const, why: 'not read' };
const M = <T>(value: T) => ({ kind: 'measured' as const, value });

// ---------------------------------------------------------------------------------------------------------- probeDoor

const mask = (t: string): string => t.replaceAll('SECRET', '[masked]');
const stored = (over: Partial<Parameters<ProbeDoorModule['maskedQuestion']>[0]> = {}) => ({
  qid: 'p1', cls: 'fact' as const, question: 'Which path holds SECRET?', choices: ['a SECRET', 'b', 'c'] as readonly string[] | null,
  expected: 'a SECRET', ...over,
});

export function maskedQuestionCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  return {
    'every text field is masked once: text, each choice and the expected answer; id and class carry over': () => {
      expect(m.maskedQuestion(stored(), mask)).toEqual({
        id: 'p1', cls: 'fact', text: 'Which path holds [masked]?', choices: ['a [masked]', 'b', 'c'], expected: 'a [masked]',
      });
    },
    'an answer copied from a masked choice grades against the masked expected answer': () => {
      const q = m.maskedQuestion(stored(), mask);
      const a = q.choices![0]!;
      const graded = m.gradeAnswers([q], new Map([['p1', a]]));
      expect(graded).toEqual([{ qid: 'p1', answer: a, grade: 'pass' }]);
      expect(q.choices).toContain(q.expected);
    },
    'a question with no choices keeps choices null, never an empty list': () => {
      const q = m.maskedQuestion(stored({ choices: null, expected: 'none', cls: 'abstention' }), mask);
      expect([q.choices, q.expected, q.cls]).toEqual([null, 'none', 'abstention']);
    },
  };
}

const q = (id: string, choices: readonly string[] | null, expected: string): Question => ({ id, cls: 'fact', text: `question ${id}`, choices, expected });

export function gradeAnswersCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  const qs = [q('p1', ['41', '42', '43'], '41'), q('p2', ['x', 'y', 'z'], 'y'), q('p3', null, 'none')];
  return {
    'a missing answer fails; the answer is null, never an empty string': () => {
      expect(m.gradeAnswers(qs, new Map())).toEqual([
        { qid: 'p1', answer: null, grade: 'fail' }, { qid: 'p2', answer: null, grade: 'fail' }, { qid: 'p3', answer: null, grade: 'fail' },
      ]);
    },
    'each answer is graded by its own question id, in the question order': () => {
      const got = m.gradeAnswers(qs, new Map([['p3', 'NONE'], ['p2', 'x'], ['p1', ' 41 ']]));
      expect(got).toEqual([
        { qid: 'p1', answer: ' 41 ', grade: 'pass' }, { qid: 'p2', answer: 'x', grade: 'fail' }, { qid: 'p3', answer: 'NONE', grade: 'pass' },
      ]);
    },
    'a wrong answer fails, and an answer for an unknown id is not graded': () => {
      const got = m.gradeAnswers([qs[0]!], new Map([['p1', '42'], ['p9', '41']]));
      expect(got).toEqual([{ qid: 'p1', answer: '42', grade: 'fail' }]);
    },
    'an empty answer is an answer: it is given, and it fails': () => {
      expect(m.gradeAnswers([qs[0]!], new Map([['p1', '']]))).toEqual([{ qid: 'p1', answer: '', grade: 'fail' }]);
      const blank = q('p4', ['', 'x', 'y'], '');
      expect(m.gradeAnswers([blank], new Map([['p4', '']]))).toEqual([{ qid: 'p4', answer: '', grade: 'pass' }]);
    },
  };
}

export function bookOfCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  return {
    'a read at or after the ask is open, a read at exactly the ask included': () => {
      expect(m.bookOf({ kind: 'read', at: 1000 }, 1000)).toBe('open');
      expect(m.bookOf({ kind: 'read', at: 1001 }, 1000)).toBe('open');
    },
    'a read before the ask proves nothing: unmeasured, never closed': () => {
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000)).toBe('unmeasured');
    },
    'no read at all (null) is unmeasured, even for an ask at time zero': () => {
      expect(m.bookOf({ kind: 'read', at: null }, 0)).toBe('unmeasured');
      expect(m.bookOf({ kind: 'read', at: null }, 1000)).toBe('unmeasured');
    },
    'a read that could not be measured is unmeasured, not open': () => {
      expect(m.bookOf({ kind: 'unmeasured' }, 1000)).toBe('unmeasured');
      expect(m.bookOf({ kind: 'unmeasured' }, 0)).toBe('unmeasured');
    },
    'never closed in W1a: no answer is closed, and the recorded states leave it out': () => {
      for (const last of [{ kind: 'read' as const, at: 5 }, { kind: 'read' as const, at: null }, { kind: 'unmeasured' as const }]) {
        for (const asked of [0, 5, 10]) expect(m.bookOf(last, asked)).not.toBe('closed');
      }
      expect(BOOK_STATES).toContain('closed');
      expect(m.BOOK_STATES_RECORDED).not.toContain('closed');
      expect([...m.BOOK_STATES_RECORDED].sort()).toEqual(BOOK_STATES.filter((b) => b !== 'closed').sort());
    },
  };
}

export function probePagesCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  const choices = ['41', 'a, b', 'line1\nline2'];
  const qs = [q('p1', choices, '41'), { id: 'p2', cls: 'abstention' as const, text: 'Is any item open?', choices: null, expected: 'none' }];
  const whole = (kind: ProbeRoundKind = 'start', questions: readonly Question[] = qs): string => m.probePages('r1', kind, questions).join('');
  return {
    'the head names the round, its kind and the number of questions, and says to answer closed-book': () => {
      const t = whole('compaction');
      expect(t).toContain('Probe round r1 (compaction): 2 question(s), closed-book.');
      expect(t).toContain('without reading your card, your notes or any file first.');
      expect(t).toContain('exactly one of its choices');
      expect(t).toContain('`none`');
    },
    'choices are one JSON string each: a comma or a newline in a choice never reads as another choice': () => {
      const t = whole();
      expect(t).toContain(`choices: ${JSON.stringify(choices)}`);
      expect(t).toContain('choices: ["41","a, b","line1\\nline2"]');
      expect(t).not.toContain('line1\nline2');
    },
    'each question is its own untrusted block under the card preface, and a no-choice question lists none': () => {
      const t = whole();
      expect(t.split(CARD_TEXT_PREFACE).length - 1).toBe(2);
      expect(t).toContain('p1 (fact)\n' + CARD_TEXT_PREFACE);
      expect(t).toContain('p2 (abstention)\n' + CARD_TEXT_PREFACE);
      expect(t).toContain('Is any item open?');
      expect(t.split('choices:').length - 1).toBe(1);
    },
    'the answer command ends the text, with one entry per question id': () => {
      const t = whole();
      expect(t).toContain("ccrc-api probe answer --json - <<'JSON'");
      expect(t).toContain('{"roundId":"r1","answers":[{"id":"p1","answer":"<your answer>"},{"id":"p2","answer":"<your answer>"}]}');
      expect(t.endsWith('\nJSON')).toBe(true);
    },
    'a long choice is shown whole, never cut by the block cap': () => {
      const long = 'x'.repeat(3000);
      const t = whole('start', [q('p1', [long, 'b', 'c'], long)]);
      expect(t).toContain(long);
      expect(t).not.toContain('Cut at');
    },
    'pages join back to one text and no page is empty': () => {
      const pages = m.probePages('r1', 'spot', [q('p1', ['a'.repeat(9000), 'b', 'c'], 'b')]);
      expect(pages.length).toBeGreaterThan(1);
      expect(pages.every((p) => p.length > 0)).toBe(true);
      expect(pages.join('')).toContain('a'.repeat(9000));
    },
  };
}


// ------------------------------------------------------------------------------------------------------- probeSchedule

const row = (roundId: string, over: Partial<Row> = {}): Row => ({
  roundId, kind: 'start', askedAt: AT, answeredAt: AT + MIN, grade: 'pass', roundUnmeasured: false, depthTokens: null, ...over,
});
const round = (roundId: string, kind: ProbeRoundKind, over: Partial<Round> = {}): Round => ({
  roundId, kind, askedAt: AT, answeredAt: AT + MIN, verdict: 'passed', depthTokens: null, ...over,
});

export function roundsOfCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  return {
    'rows group into rounds in the order each round first appears; asked, kind and depth come from the first row': () => {
      const got = m.roundsOf([
        row('r1', { askedAt: 10, answeredAt: 20, depthTokens: 7 }), row('r2', { kind: 'spot', askedAt: 30, answeredAt: 40, depthTokens: 60_000 }),
        row('r1', { askedAt: 11, answeredAt: 25, depthTokens: 8 }),
      ]);
      expect(got).toEqual([
        { roundId: 'r1', kind: 'start', askedAt: 10, answeredAt: 25, verdict: 'passed', depthTokens: 7 },
        { roundId: 'r2', kind: 'spot', askedAt: 30, answeredAt: 40, verdict: 'passed', depthTokens: 60_000 },
      ]);
    },
    'a round answered and graded reads its latest answer time and the all-or-nothing verdict': () => {
      const [a] = m.roundsOf([row('r1', { answeredAt: 50 }), row('r1', { answeredAt: 20, grade: 'fail' })]);
      expect([a!.answeredAt, a!.verdict]).toEqual([50, 'failed']);
    },
    'a half-answered round is open: no answer time and no verdict, whatever the answered rows say': () => {
      const [a] = m.roundsOf([row('r1', { grade: 'fail' }), row('r1', { answeredAt: null, grade: null })]);
      expect([a!.answeredAt, a!.verdict]).toEqual([null, null]);
    },
    'a row answered but not graded, or graded but not answered, leaves the round open': () => {
      const [a] = m.roundsOf([row('r1'), row('r1', { grade: null })]);
      expect([a!.answeredAt, a!.verdict]).toEqual([null, null]);
      const [b] = m.roundsOf([row('r1'), row('r1', { answeredAt: null, grade: 'pass' })]);
      expect([b!.answeredAt, b!.verdict]).toEqual([null, null]);
    },
    'a round the snapshot made short is unmeasured when nothing failed, and failed when something did': () => {
      const [a] = m.roundsOf([row('r1', { roundUnmeasured: true }), row('r1', { roundUnmeasured: true })]);
      expect(a!.verdict).toBe('unmeasured');
      const [b] = m.roundsOf([row('r1', { roundUnmeasured: true }), row('r1', { roundUnmeasured: true, grade: 'fail' })]);
      expect(b!.verdict).toBe('failed');
    },
    'no rows, no rounds': () => { expect(m.roundsOf([])).toEqual([]); },
  };
}

export function compactionWindowStartCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  return {
    'with no round the window starts when the generation entered its state': () => {
      expect(m.compactionWindowStart(500, [])).toBe(500);
    },
    'the newest snapshot round counts when it is later than the entry: a start or a compaction round': () => {
      expect(m.compactionWindowStart(500, [round('r1', 'start', { askedAt: 900 })])).toBe(900);
      expect(m.compactionWindowStart(500, [round('r1', 'start', { askedAt: 700 }), round('r2', 'compaction', { askedAt: 900 })])).toBe(900);
      expect(m.compactionWindowStart(500, [round('r1', 'compaction', { askedAt: 900 }), round('r2', 'start', { askedAt: 700 })])).toBe(900);
    },
    'the entry counts when it is later than every snapshot round': () => {
      expect(m.compactionWindowStart(1000, [round('r1', 'start', { askedAt: 900 })])).toBe(1000);
    },
    'a spot round never moves the window': () => {
      expect(m.compactionWindowStart(500, [round('r1', 'start', { askedAt: 700 }), round('r2', 'spot', { askedAt: 5000 })])).toBe(700);
      expect(m.compactionWindowStart(500, [round('r2', 'spot', { askedAt: 5000 })])).toBe(500);
    },
  };
}

export function probeFailedUnfixedOfCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  const f = (id: string, kind: ProbeRoundKind = 'compaction', over: Partial<Round> = {}) => round(id, kind, { verdict: 'failed', ...over });
  const unfixed = (rs: readonly Round[]) => m.probeFailedUnfixedOf(rs);
  const no = { kind: 'measured', value: false };
  const yes = { kind: 'measured', value: true };
  return {
    'no compaction round at all reads false, measured': () => {
      expect(unfixed([])).toEqual(no);
      expect(unfixed([f('r1', 'start')])).toEqual(no);
    },
    'one failed compaction round alone is not unfixed: the re-read was never tried': () => {
      expect(unfixed([f('c1')])).toEqual(no);
    },
    'two failed compaction rounds in a row read unfixed': () => {
      expect(unfixed([f('c1'), f('c2')])).toEqual(yes);
    },
    'a pass between, or a pass last, is fixed; only the newest and the one before count': () => {
      expect(unfixed([f('c1'), round('c2', 'compaction')])).toEqual(no);
      expect(unfixed([f('c1'), round('c2', 'compaction'), f('c3')])).toEqual(no);
      expect(unfixed([round('c1', 'compaction'), f('c2'), f('c3')])).toEqual(yes);
    },
    'a spot round is not a compaction round: it neither fails one nor sits between': () => {
      expect(unfixed([f('c1'), f('s1', 'spot')])).toEqual(no);
      expect(unfixed([f('s0', 'spot'), f('s1', 'spot')])).toEqual(no);
      expect(unfixed([f('c1'), round('s1', 'spot'), f('c2')])).toEqual(yes);
    },
    'a start round is not a compaction round either': () => {
      expect(unfixed([f('r1', 'start'), f('c1')])).toEqual(no);
      expect(unfixed([f('c1'), f('c2'), round('r2', 'start')])).toEqual(yes);
    },
    'a round still open is not counted: the answered ones decide': () => {
      expect(unfixed([f('c1'), f('c2'), round('c3', 'compaction', { answeredAt: null, verdict: null })])).toEqual(yes);
      expect(unfixed([f('c1'), round('c3', 'compaction', { answeredAt: null, verdict: null })])).toEqual(no);
    },
    'a newest round that could not be graded leaves the answer unmeasured, even after a fail': () => {
      const got = unfixed([f('c1'), round('c2', 'compaction', { verdict: 'unmeasured' })]);
      expect(got.kind).toBe('unmeasured');
      expect(unfixed([round('c1', 'compaction', { verdict: 'unmeasured' })]).kind).toBe('unmeasured');
    },
    'an older unmeasured round does not hide a newer pair of fails': () => {
      expect(unfixed([round('c0', 'compaction', { verdict: 'unmeasured' }), f('c1'), f('c2')])).toEqual(yes);
      expect(unfixed([f('c1'), round('c2', 'compaction', { verdict: 'unmeasured' }), f('c3')])).toEqual(no);
    },
  };
}

const base = (over: Partial<Input> = {}): Input => ({
  state: 'active', probeRounds: 0, rounds: [], cardReadAt: M(null), compactionsSince: M(0), idle: M(false), ctxTokens: M(0), ...over,
});
const DONE = (id: string, kind: ProbeRoundKind, verdict: Round['verdict'], over: Partial<Round> = {}) =>
  round(id, kind, { verdict, ...over });
const OPENR = (id: string, kind: ProbeRoundKind) => round(id, kind, { answeredAt: null, verdict: null });
const K = SPOT_PROBE_EVERY_TOKENS;

export function probeScheduleCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  const go = (over: Partial<Input>) => m.probeSchedule(base(over));
  const opens = (over: Partial<Input>) => go(over).open;
  return {
    // ---- probing
    'probing, no round yet: the first start round opens at once, with no depth and nothing fed': () => {
      const s = go({ state: 'probing' });
      expect([s.feed, s.open]).toEqual([null, { kind: 'start', depthTokens: null }]);
    },
    'probing, the first round graded passed or failed is fed, and opens nothing': () => {
      expect(go({ state: 'probing', rounds: [DONE('r1', 'start', 'passed')] })).toMatchObject({ feed: { passed: true }, open: null });
      expect(go({ state: 'probing', rounds: [DONE('r1', 'start', 'failed')] })).toMatchObject({ feed: { passed: false }, open: null });
    },
    'probing, a round graded unmeasured feeds nothing and opens nothing: the generation waits': () => {
      const s = go({ state: 'probing', rounds: [DONE('r1', 'start', 'unmeasured')] });
      expect([s.feed, s.open]).toEqual([null, null]);
      const t = go({ state: 'probing', probeRounds: 1, rounds: [DONE('r1', 'start', 'failed'), DONE('r2', 'start', 'unmeasured')] });
      expect([t.feed, t.open]).toEqual([null, null]);
    },
    'probing, a round still open feeds nothing yet': () => {
      const s = go({ state: 'probing', rounds: [OPENR('r1', 'start')] });
      expect([s.feed, s.open]).toEqual([null, null]);
    },
    'probing, after one failed round the target is the second round, never the first': () => {
      const s = go({ state: 'probing', probeRounds: 1, rounds: [DONE('r1', 'start', 'failed'), DONE('r2', 'start', 'passed')] });
      expect(s.feed).toEqual({ passed: true });
      const t = go({ state: 'probing', probeRounds: 1, rounds: [DONE('r1', 'start', 'passed'), DONE('r2', 'start', 'failed')] });
      expect(t.feed).toEqual({ passed: false });
    },
    'probing, the second start round opens only after the card was read again after the first was answered': () => {
      const failed = DONE('r1', 'start', 'failed', { answeredAt: 5000 });
      const at = (cardReadAt: Input['cardReadAt']) => go({ state: 'probing', probeRounds: 1, rounds: [failed], cardReadAt }).open;
      expect(at(M(5001))).toEqual({ kind: 'start', depthTokens: null });
      expect(at(M(null))).toBeNull();
      expect(at(M(4999))).toBeNull();
      expect(at(NOPE)).toBeNull();
    },
    'probing, a re-read in the same millisecond as the answer is not a re-read': () => {
      const failed = DONE('r1', 'start', 'failed', { answeredAt: 5000 });
      expect(go({ state: 'probing', probeRounds: 1, rounds: [failed], cardReadAt: M(5000) }).open).toBeNull();
    },
    'probing, no second round opens off a first round that was never answered': () => {
      const odd = DONE('r1', 'start', 'failed', { answeredAt: null });
      expect(go({ state: 'probing', probeRounds: 1, rounds: [odd], cardReadAt: M(9_999_999) }).open).toBeNull();
    },
    'probing, no round opens while another round is open': () => {
      expect(opens({ state: 'probing', rounds: [OPENR('s1', 'compaction')] })).toBeNull();
      const failed = DONE('r1', 'start', 'failed', { answeredAt: 5000 });
      expect(opens({ state: 'probing', probeRounds: 1, rounds: [failed, OPENR('s1', 'spot')], cardReadAt: M(9000) })).toBeNull();
    },
    // ---- active
    'active, a compaction since the window opens a compaction round, with no depth': () => {
      expect(opens({ compactionsSince: M(1) })).toEqual({ kind: 'compaction', depthTokens: null });
      expect(opens({ compactionsSince: M(3), rounds: [DONE('r1', 'start', 'passed')] })).toEqual({ kind: 'compaction', depthTokens: null });
    },
    'active, no compaction since the window opens no compaction round; a count that could not be read opens none': () => {
      expect(opens({ compactionsSince: M(0) })).toBeNull();
      expect(opens({ compactionsSince: { kind: 'unmeasured', why: 'x' } })).toBeNull();
    },
    'active, a failed compaction round asks for a re-read: the next opens only once the card was read after it': () => {
      const failed = [DONE('c1', 'compaction', 'failed', { answeredAt: 5000 })];
      expect(opens({ rounds: failed, cardReadAt: M(5001) })).toEqual({ kind: 'compaction', depthTokens: null });
      expect(opens({ rounds: failed, cardReadAt: M(5000) })).toBeNull();
      expect(opens({ rounds: failed, cardReadAt: M(null) })).toBeNull();
      expect(opens({ rounds: failed, cardReadAt: NOPE })).toBeNull();
    },
    'active, awaiting a re-read, a new compaction alone does not open the round': () => {
      const failed = [DONE('c1', 'compaction', 'failed', { answeredAt: 5000 })];
      expect(opens({ rounds: failed, compactionsSince: M(2), cardReadAt: M(null) })).toBeNull();
    },
    'active, two failed compaction rounds are unfixed: no re-read asked, a new compaction opens the next': () => {
      const two = [DONE('c1', 'compaction', 'failed', { answeredAt: 5000 }), DONE('c2', 'compaction', 'failed', { answeredAt: 6000 })];
      const s = go({ rounds: two, cardReadAt: M(7000), compactionsSince: M(0) });
      expect([s.open, s.probeFailedUnfixed]).toEqual([null, { kind: 'measured', value: true }]);
      expect(opens({ rounds: two, cardReadAt: M(7000), compactionsSince: M(1) })).toEqual({ kind: 'compaction', depthTokens: null });
    },
    'active, a compaction round that passed asks for no re-read': () => {
      const passed = [DONE('c1', 'compaction', 'passed', { answeredAt: 5000 })];
      expect(opens({ rounds: passed, cardReadAt: M(9000), compactionsSince: M(0) })).toBeNull();
    },
    'active, no round opens while one is open': () => {
      expect(opens({ rounds: [OPENR('r1', 'start')], compactionsSince: M(2), idle: M(true), ctxTokens: M(3 * K) })).toBeNull();
      expect(opens({ rounds: [OPENR('s1', 'spot')], compactionsSince: M(2) })).toBeNull();
    },
    'no state but probing and active opens a round, however many compactions or tokens': () => {
      for (const state of GENERATION_STATES.filter((x) => x !== 'probing' && x !== 'active')) {
        const s = go({ state, compactionsSince: M(4), idle: M(true), ctxTokens: M(4 * K) });
        expect([state, s.feed, s.open]).toEqual([state, null, null]);
      }
    },
    // ---- spot
    'active, idle and past the first step: a spot round opens and records the depth it opened at': () => {
      expect(opens({ idle: M(true), ctxTokens: M(K) })).toEqual({ kind: 'spot', depthTokens: K });
      expect(opens({ idle: M(true), ctxTokens: M(2 * K + 17) })).toEqual({ kind: 'spot', depthTokens: 2 * K + 17 });
    },
    'active, below the first step no spot round opens': () => {
      expect(opens({ idle: M(true), ctxTokens: M(K - 1) })).toBeNull();
      expect(opens({ idle: M(true), ctxTokens: M(0) })).toBeNull();
    },
    'active, a busy session opens no spot round; an unread marker or a stale sidecar opens none': () => {
      expect(opens({ idle: M(false), ctxTokens: M(3 * K) })).toBeNull();
      expect(opens({ idle: { kind: 'unmeasured', why: 'x' }, ctxTokens: M(3 * K) })).toBeNull();
      expect(opens({ idle: M(true), ctxTokens: { kind: 'unmeasured', why: 'x' } })).toBeNull();
    },
    'active, the same 50k step opens no second spot round; the next step does': () => {
      const spot = (d: number) => DONE('s1', 'spot', 'passed', { depthTokens: d });
      expect(opens({ rounds: [spot(K + 5)], idle: M(true), ctxTokens: M(K + 9_000) })).toBeNull();
      expect(opens({ rounds: [spot(K + 5)], idle: M(true), ctxTokens: M(2 * K) })).toEqual({ kind: 'spot', depthTokens: 2 * K });
    },
    'active, the newest spot round sets the step, not the first': () => {
      const rs = [DONE('s1', 'spot', 'passed', { depthTokens: K }), DONE('s2', 'spot', 'passed', { depthTokens: 4 * K })];
      expect(opens({ rounds: rs, idle: M(true), ctxTokens: M(4 * K + 1) })).toBeNull();
      expect(opens({ rounds: rs, idle: M(true), ctxTokens: M(5 * K) })).toEqual({ kind: 'spot', depthTokens: 5 * K });
    },
    'active, a start round is not a spot round: the step counts from zero without one': () => {
      const rs = [DONE('r1', 'start', 'passed', { depthTokens: 9 * K })];
      expect(opens({ rounds: rs, idle: M(true), ctxTokens: M(K) })).toEqual({ kind: 'spot', depthTokens: K });
    },
    'active, a compaction round wins over a spot round the same pass': () => {
      expect(opens({ compactionsSince: M(1), idle: M(true), ctxTokens: M(3 * K) })).toEqual({ kind: 'compaction', depthTokens: null });
    },
    'the verdict of probeFailedUnfixed rides every answer, in every state': () => {
      const two = [DONE('c1', 'compaction', 'failed'), DONE('c2', 'compaction', 'failed')];
      for (const state of GENERATION_STATES) {
        expect(go({ state, rounds: two }).probeFailedUnfixed, state).toEqual({ kind: 'measured', value: true });
      }
    },
  };
}

const NOTE = (id: number, at: number): CardNote =>
  ({ id, at, kind: 'thread', key: 'run 41', keyFact: 'live', waitsOn: 'the review', next: `next ${id}` });
const MAIL = (deliveryId: number, at: number): CardMail => ({ deliveryId, fromId: 'lane-a-project-a', at, subject: `m${deliveryId}`, parked: false });

export function spotFactsOfCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  const since = AT - 10 * MIN;
  const notes = [NOTE(1, since - 1), NOTE(2, since), NOTE(3, since + 1)];
  const mail = [MAIL(1, since - 1), MAIL(2, since), MAIL(3, since + 1)];
  const facts = (): CardFacts => m.spotFactsOf('lane-a-project-a', 'coordinator', AT, notes, mail, since);
  return {
    'notes and mail before the window are left out; a row at exactly the window start stays': () => {
      const f = facts();
      expect(f.notes).toEqual({ kind: 'read', value: [notes[1], notes[2]] });
      expect(f.mailOutstanding).toEqual({ kind: 'read', value: [mail[1], mail[2]] });
    },
    'a window past every row leaves both lists empty, still read': () => {
      const f = m.spotFactsOf('lane-a-project-a', 'coordinator', AT, notes, mail, since + 100);
      expect([f.notes, f.mailOutstanding]).toEqual([{ kind: 'read', value: [] }, { kind: 'read', value: [] }]);
    },
    'every other fact reads as an empty list in this scope, and the identity and time carry over': () => {
      const f = facts();
      const empty = { kind: 'read', value: [] };
      expect([f.runs, f.ledger, f.claims, f.itemsRaised]).toEqual([empty, empty, empty, empty]);
      expect([f.intent, f.checkpoint]).toEqual([{ kind: 'read', value: false }, { kind: 'read', value: null }]);
      expect(f.history).toEqual({ kind: 'read', value: { verb: 'ccrc history describe', node: null } });
      expect([f.sessionId, f.role, f.at, f.mailMore]).toEqual(['lane-a-project-a', 'coordinator', AT, false]);
      expect(f.roleWhy).toContain('spot round');
    },
  };
}

// ---------------------------------------------------------------------------------------------------- snapshotFactsOf

const item = (id: number): CardItem => ({
  id, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: AT - 30 * MIN, text: `item ${id}`, everTicked: false, held: false,
});
const read = <T>(value: T) => ({ kind: 'read' as const, value });
const GOOD: CardFacts = {
  sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'it claims a run', at: AT,
  runs: read([{ id: 41, programme: 'prog-a', wave: 1, waveOf: 3, state: 'working', planPath: 'docs/p.md', kind: 'work' }]),
  ledger: read([{ slug: 'prog-a', goals: [], openItems: [item(9)], decisions: [] }]),
  claims: read([{ id: 1, paths: ['server/src/a.ts'], runId: 41 }]),
  intent: read(true), itemsRaised: read([item(7)]), mailOutstanding: read([MAIL(501, AT - MIN)]), mailMore: true,
  notes: read([NOTE(61, AT - MIN)]), checkpoint: read(null), history: read({ verb: 'ccrc history describe', node: null }),
};
const FACT_NAMES = ['runs', 'ledger', 'claims', 'intent', 'itemsRaised', 'mailOutstanding', 'notes', 'checkpoint', 'history'] as const;
type Json = Record<string, unknown>;
const without = (o: Json, key: string): Json => { const { [key]: _gone, ...rest } = o; return rest; };

export function snapshotFactsOfCases(m: CardModule): Record<string, SuiteCase> {
  const stamp = AT + 5 * MIN;
  const stored = (): Json => JSON.parse(m.snapshotFactsJson(GOOD)) as Json;
  const parse = (o: unknown): CardFacts | null => m.snapshotFactsOf(JSON.stringify(o), stamp);
  /** One fact replaced by `value`, read: that fact reads unmeasured as `the snapshot's <name>`, every other fact as stored. */
  const badFact = (name: (typeof FACT_NAMES)[number], value: unknown): void => {
    const f = parse({ ...stored(), [name]: { kind: 'read', value } })!;
    const want = { ...GOOD, at: stamp, [name]: { kind: 'unmeasured', what: `the snapshot's ${name}` } };
    expect(f, `${name} ${JSON.stringify(value)}`).toEqual(want);
  };
  const first = <T>(f: { value: readonly T[] }): T => f.value[0]!;
  const goodRow = (name: 'runs' | 'claims' | 'itemsRaised' | 'mailOutstanding' | 'notes'): Json =>
    first(GOOD[name] as { kind: 'read'; value: readonly unknown[] } as { value: readonly Json[] }) as Json;
  return {
    'a snapshot written by snapshotFactsJson reads back as the same facts, stamped with the row time': () => {
      expect(m.snapshotFactsOf(m.snapshotFactsJson(GOOD), stamp)).toEqual({ ...GOOD, at: stamp });
    },
    'text that is not a snapshot object is null: not JSON, JSON null, an array, a scalar, no session id': () => {
      for (const text of ['', 'not json', '{"sessionId":', 'null', '[]', '[{"sessionId":"x"}]', '"x"', '5', 'true', '{}', '{"sessionId":5}']) {
        expect(m.snapshotFactsOf(text, stamp), text).toBeNull();
      }
    },
    'an item stored without a boolean everTicked reads unmeasured: never a guess at never ticked': () => {
      badFact('itemsRaised', [without(item(7) as unknown as Json, 'everTicked')]);
      badFact('itemsRaised', [{ ...item(7), everTicked: 'false' }]);
      badFact('itemsRaised', [{ ...item(7), everTicked: 0 }]);
      badFact('ledger', [{ slug: 'prog-a', goals: [], openItems: [without(item(9) as unknown as Json, 'everTicked')], decisions: [] }]);
    },
    'a fact of the wrong shape reads unmeasured, named by its own name, not read': () => {
      badFact('intent', 'yes');
      badFact('checkpoint', 5);
      badFact('history', 'describe');
      badFact('runs', 'none');
      badFact('claims', { paths: [] });
      badFact('notes', null);
    },
    'a fact missing, or stored as a bare value, reads unmeasured': () => {
      for (const name of FACT_NAMES) {
        const f = parse(without(stored(), name))!;
        expect(f[name], name).toEqual({ kind: 'unmeasured', what: `the snapshot's ${name}` });
        const g = parse({ ...stored(), [name]: 5 })!;
        expect(g[name], name).toEqual({ kind: 'unmeasured', what: `the snapshot's ${name}` });
      }
      const f = parse({ sessionId: 's' })!;
      expect(f.sessionId).toBe('s');
      expect(f.mailMore).toBe(false);
    },
    'a fact that was unmeasured keeps its own reason; one without a text reason gets the default': () => {
      const f = parse({ ...stored(), runs: { kind: 'unmeasured', what: 'the registry could not be listed' } })!;
      expect(f.runs).toEqual({ kind: 'unmeasured', what: 'the registry could not be listed' });
      const g = parse({ ...stored(), runs: { kind: 'unmeasured', what: 7 }, claims: { kind: 'unmeasured' } })!;
      expect(g.runs).toEqual({ kind: 'unmeasured', what: "the snapshot's runs" });
      expect(g.claims).toEqual({ kind: 'unmeasured', what: "the snapshot's claims" });
      const h = parse({ ...stored(), runs: { kind: 'bogus', value: [] } })!;
      expect(h.runs).toEqual({ kind: 'unmeasured', what: "the snapshot's runs" });
    },
    'a row of a list with a field this build needs missing or mistyped reads the whole fact unmeasured': () => {
      for (const key of ['id', 'programme', 'state', 'planPath']) {
        badFact('runs', [{ ...goodRow('runs'), [key]: key === 'planPath' ? 5 : undefined }]);
      }
      badFact('runs', [{ ...goodRow('runs'), id: 'x' }]);
      badFact('runs', [{ ...goodRow('runs'), planPath: null }, { ...goodRow('runs'), programme: 5 }]);
      for (const key of ['id', 'programme', 'state', 'at']) badFact('itemsRaised', [without(goodRow('itemsRaised'), key)]);
      badFact('itemsRaised', [{ ...goodRow('itemsRaised'), at: 'x' }]);
      for (const key of ['deliveryId', 'at']) badFact('mailOutstanding', [without(goodRow('mailOutstanding'), key)]);
      for (const key of ['id', 'at', 'kind', 'next']) badFact('notes', [without(goodRow('notes'), key)]);
      badFact('claims', [{ id: 1, paths: [5], runId: 41 }]);
      badFact('claims', [5]);
      badFact('ledger', [{ goals: [], openItems: [], decisions: [] }]);
      badFact('ledger', [{ slug: 'prog-a', goals: [], decisions: [] }]);
      badFact('ledger', [{ slug: 'prog-a', goals: [], openItems: 'x', decisions: [] }]);
      badFact('ledger', [{ slug: 5, goals: [], openItems: [], decisions: [] }]);
    },
    'a null planPath, an object checkpoint and an empty list are well-formed': () => {
      const cp = { kind: 'read', value: { id: 3 } };
      const f = parse({ ...stored(), checkpoint: cp, runs: read([{ ...goodRow('runs'), planPath: null }]), notes: read([]) })!;
      expect(f.checkpoint).toEqual(cp);
      expect(f.runs).toEqual(read([{ ...goodRow('runs'), planPath: null }]));
      expect(f.notes).toEqual(read([]));
    },
    'the role is kept when it names a fleet role or undecided, and undecided otherwise; the reason defaults to empty': () => {
      expect(parse({ ...stored(), role: 'worker' })!.role).toBe('worker');
      expect(parse({ ...stored(), role: 'undecided' })!.role).toBe('undecided');
      expect(parse({ ...stored(), role: 'bogus' })!.role).toBe('undecided');
      expect(parse({ ...stored(), role: 7 })!.role).toBe('undecided');
      expect(parse(without(stored(), 'role'))!.role).toBe('undecided');
      expect(parse(without(stored(), 'roleWhy'))!.roleWhy).toBe('');
      expect(parse({ ...stored(), roleWhy: 7 })!.roleWhy).toBe('');
      expect(parse(stored())!.roleWhy).toBe('it claims a run');
    },
    'mailMore is true only for the boolean true': () => {
      expect(parse({ ...stored(), mailMore: true })!.mailMore).toBe(true);
      for (const v of [false, 'yes', 1, null]) expect(parse({ ...stored(), mailMore: v })!.mailMore, String(v)).toBe(false);
    },
  };
}

// --------------------------------------------------------------------------------------------------------------- sets

const DOOR = path.join(ROOT, 'server/src/continuity/probeDoor.ts');
const SCHEDULE = path.join(ROOT, 'server/src/continuity/probeSchedule.ts');
const CARD = path.join(ROOT, 'server/src/continuity/card.ts');

const MASKED_QUESTION_SET: MutantSet<ProbeDoorModule> = {
  modulePath: DOOR,
  mutants: [
    { id: 'D1 expected left unmasked', old: 'expected: mask(q.expected)', new: 'expected: q.expected' },
    { id: 'D2 choices left unmasked', old: 'q.choices.map(mask)', new: 'q.choices' },
    { id: 'D3 text left unmasked', old: 'text: mask(q.question)', new: 'text: q.question' },
    { id: 'D4 no choices read as an empty list', old: 'q.choices === null ? null : q.choices.map(mask)', new: 'q.choices === null ? [] : q.choices.map(mask)' },
  ],
  suite: maskedQuestionCases,
};

const GRADE_ANSWERS_SET: MutantSet<ProbeDoorModule> = {
  modulePath: DOOR,
  mutants: [
    { id: 'A1 a missing answer passes', old: "a === undefined ? 'fail' : gradeProbe(q, a)", new: "a === undefined ? 'pass' : gradeProbe(q, a)" },
    { id: 'A2 every given answer passes', old: "a === undefined ? 'fail' : gradeProbe(q, a)", new: "a === undefined ? 'fail' : 'pass'" },
    { id: 'A3 a missing answer as an empty string', old: 'answer: a ?? null', new: "answer: a ?? ''" },
    { id: 'A4 an empty answer taken for missing', old: 'a === undefined ?', new: "a === undefined || a === '' ?" },
    { id: 'A5 the answer read by the wrong id', old: 'answers.get(q.id)', new: 'answers.get(q.cls)' },
  ],
  suite: gradeAnswersCases,
};

const BOOK_OF_SET: MutantSet<ProbeDoorModule> = {
  modulePath: DOOR,
  mutants: [
    { id: 'B1 a read at the ask is not open', old: 'last.at >= askedAt', new: 'last.at > askedAt' },
    { id: 'B2 the fall-through is closed', old: "return 'unmeasured';", new: "return 'closed';" },
    { id: 'B3 an unmeasured read is open', old: "last.kind === 'read' && last.at !== null && last.at >= askedAt", new: "last.kind === 'unmeasured' || (last.at !== null && last.at >= askedAt)" },
    { id: 'B4 no read time counted as open', old: 'last.at !== null && ', new: '' },
    { id: 'B5 a read before the ask is open', old: 'last.at >= askedAt', new: 'last.at <= askedAt' },
    { id: 'B6 closed among the recorded states', old: "BOOK_STATES.filter((b) => b !== 'closed')", new: 'BOOK_STATES' },
  ],
  suite: bookOfCases,
};

const PROBE_PAGES_SET: MutantSet<ProbeDoorModule> = {
  modulePath: DOOR,
  mutants: [
    { id: 'P1 choices joined with a comma', old: 'JSON.stringify(q.choices)', new: "q.choices.join(', ')" },
    { id: 'P2 the untrusted preface dropped', old: ", 'not shown in full', CARD_TEXT_PREFACE)", new: ", 'not shown in full')" },
    { id: 'P3 the answer command dropped', old: "[...head, '', ...blocks, '', tail]", new: "[...head, '', ...blocks]" },
    { id: 'P4 no untrusted block', old: "untrustedBlock(body, PROBE_BLOCK_CAP_BYTES, 'not shown in full', CARD_TEXT_PREFACE)", new: 'body' },
    { id: 'P5 a block cut at a kilobyte', old: 'PROBE_BLOCK_CAP_BYTES, ', new: '1024, ' },
    { id: 'P6 a null choices list shown', old: 'q.choices === null ? q.text : ', new: '' },
    { id: 'P7 the example names no ids', old: "id: q.id, answer: '<your answer>'", new: "id: 'p', answer: '<your answer>'" },
    { id: 'P8 the question count dropped', old: '${questions.length} question(s)', new: '0 question(s)' },
    { id: 'P9 the kind dropped', old: '(${kind})', new: '(round)' },
    { id: 'P10 the closed-book instruction dropped', old: 'Answer from memory, without reading your card,', new: 'Answer,' },
  ],
  suite: probePagesCases,
};

const ROUNDS_OF_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'S1 a half-answered round graded', old: 'rs.every((r) =>', new: 'rs.some((r) =>' },
    { id: 'S2 roundUnmeasured ignored', old: 'first.roundUnmeasured', new: 'false' },
    { id: 'S3 answered or graded', old: 'r.answeredAt !== null && r.grade !== null', new: 'r.answeredAt !== null || r.grade !== null' },
    { id: 'S4 the earliest answer time', old: 'Math.max(...rs.map((r) => r.answeredAt!))', new: 'Math.min(...rs.map((r) => r.answeredAt!))' },
    { id: 'S5 the first answer time', old: 'Math.max(...rs.map((r) => r.answeredAt!))', new: 'rs[0]!.answeredAt!' },
    { id: 'S6 the depth of the last row', old: 'depthTokens: first.depthTokens', new: 'depthTokens: rs[rs.length - 1]!.depthTokens' },
    { id: 'S7 the ask of the last row', old: 'askedAt: first.askedAt', new: 'askedAt: rs[rs.length - 1]!.askedAt' },
    { id: 'S8 rounds sorted by id', old: '[...byId.values()].map(', new: '[...byId.values()].reverse().map(' },
  ],
  suite: roundsOfCases,
};

const COMPACTION_WINDOW_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'W1 spot rounds counted', old: ".filter((r) => r.kind !== 'spot')", new: '.filter(() => true)' },
    { id: 'W2 enteredAt ignored', old: 'Math.max(enteredAt, ...asked)', new: 'Math.max(...asked)' },
    { id: 'W3 start rounds not counted', old: ".filter((r) => r.kind !== 'spot')", new: ".filter((r) => r.kind === 'compaction')" },
    { id: 'W4 compaction rounds not counted', old: ".filter((r) => r.kind !== 'spot')", new: ".filter((r) => r.kind === 'start')" },
    { id: 'W5 the earliest', old: 'Math.max(enteredAt, ...asked)', new: 'Math.min(enteredAt, ...asked)' },
  ],
  suite: compactionWindowStartCases,
};

const FAILED_UNFIXED_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'U1 spot rounds counted as compaction rounds', old: "const done = answered(rounds.filter((r) => r.kind === 'compaction'));", new: "const done = answered(rounds.filter((r) => r.kind !== 'start'));" },
    { id: 'U2 start rounds counted as compaction rounds', old: "const done = answered(rounds.filter((r) => r.kind === 'compaction'));", new: "const done = answered(rounds.filter((r) => r.kind !== 'spot'));" },
    { id: 'U3 every round counted', old: "const done = answered(rounds.filter((r) => r.kind === 'compaction'));", new: 'const done = answered(rounds);' },
    { id: 'U4 one failure alone reads unfixed', old: " && done[done.length - 2]?.verdict === 'failed'", new: '' },
    { id: 'U5 an unmeasured newest round read as false', old: "last.verdict === 'unmeasured'", new: 'false' },
    { id: 'U6 the first round, not the one before', old: 'done[done.length - 2]', new: 'done[0]' },
    { id: 'U7 an open round counted', old: 'answered(rounds.filter', new: '(rounds.filter' },
    { id: 'U8 no round reads true', old: 'if (last === undefined) return measured(false);', new: 'if (last === undefined) return measured(true);' },
    { id: 'U9 the newest passing reads unfixed', old: "last.verdict === 'failed' &&", new: "last.verdict !== 'unmeasured' &&" },
  ],
  suite: probeFailedUnfixedOfCases,
};

const SCHEDULE_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'C1 an unmeasured verdict fed as a failure', old: "target.verdict === 'passed' || target.verdict === 'failed'", new: 'target.verdict !== null' },
    { id: 'C2 the second start round without a re-read', old: '(prev?.answeredAt != null && reReadAfter(i.cardReadAt, prev.answeredAt))', new: 'prev?.answeredAt != null' },
    { id: 'C3 a round opened while one is open (probing)', old: 'if (isOpen) return none;', new: '' },
    { id: 'C4 the first start round as target', old: 'starts[i.probeRounds]', new: 'starts[0]' },
    { id: 'C5 a re-read in the same millisecond', old: 'card.value > at', new: 'card.value >= at' },
    { id: 'C6 a spot round on a busy session', old: '|| !i.idle.value ||', new: '||' },
    { id: 'C7 the same step opens a second spot', old: 'step(i.ctxTokens.value) > step(lastDepth)', new: 'i.ctxTokens.value > lastDepth' },
    { id: 'C8 a spot below the first step', old: 'Math.floor(t / SPOT_PROBE_EVERY_TOKENS)', new: 'Math.ceil(t / SPOT_PROBE_EVERY_TOKENS)' },
    { id: 'C9 the compaction trigger on zero compactions', old: 'i.compactionsSince.value >= 1', new: 'i.compactionsSince.value >= 0' },
    { id: 'C10 a compaction follow-up without a re-read', old: 'if (reReadAfter(i.cardReadAt, lastComp.answeredAt!))', new: 'if (true)' },
    { id: 'C11 a round opened on active while one is open', old: "if (i.state !== 'active' || isOpen) return none;", new: "if (i.state !== 'active') return none;" },
    { id: 'C12 rounds opened in any state', old: "if (i.state !== 'active' || isOpen) return none;", new: 'if (isOpen) return none;' },
    { id: 'C13 a new compaction opens during a re-read wait', old: '} else if (i.compactionsSince.kind', new: '}\n  if (i.compactionsSince.kind' },
    { id: 'C14 an unfixed pair still waits for a re-read', old: '!(probeFailedUnfixed.kind === \'measured\' && probeFailedUnfixed.value)', new: 'true' },
    { id: 'C15 any compaction round asks for a re-read', old: "lastComp?.verdict === 'failed' &&", new: 'lastComp !== undefined &&' },
    { id: 'C16 the first spot round sets the step', old: 'spots[spots.length - 1]?.depthTokens', new: 'spots[0]?.depthTokens' },
    { id: 'C17 a spot round without its depth', old: 'depthTokens: i.ctxTokens.value }', new: 'depthTokens: null }' },
    { id: 'C18 the first round never opens at zero failures', old: 'i.probeRounds === 0 ||', new: 'false ||' },
    { id: 'C19 a fed failure reads as passed', old: "passed: target.verdict === 'passed'", new: 'passed: true' },
    { id: 'C20 spot rounds ignored among the open', old: "i.rounds.some((r) => r.answeredAt === null)", new: "i.rounds.filter((r) => r.kind !== 'spot').some((r) => r.answeredAt === null)" },
  ],
  suite: probeScheduleCases,
};

const SPOT_FACTS_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'T1 mail before the window kept', old: 'mail.filter((m) => m.at >= since)', new: 'mail' },
    { id: 'T2 notes before the window kept', old: 'notes.filter((n) => n.at >= since)', new: 'notes' },
    { id: 'T3 mail at the window start dropped', old: 'm.at >= since', new: 'm.at > since' },
    { id: 'T4 notes at the window start dropped', old: 'n.at >= since', new: 'n.at > since' },
    { id: 'T5 the card more flag set', old: 'mailMore: false', new: 'mailMore: true' },
    { id: 'T6 a stamp of zero', old: ' at, runs: read([])', new: ' at: 0, runs: read([])' },
  ],
  suite: spotFactsOfCases,
};

const SNAPSHOT_FACTS_SET: MutantSet<CardModule> = {
  modulePath: CARD,
  mutants: [
    { id: 'N1 an item without everTicked accepted', old: " && typeof x.everTicked === 'boolean'", new: '' },
    { id: 'N2 a malformed fact read as read', old: "f.kind === 'read' && ok(f.value) ?", new: "f.kind === 'read' ?" },
    { id: 'N3 an unmeasured fact loses its own what', old: "str(f.what) ? (f.what as string) : what", new: 'what' },
    { id: 'N4 a non-text what kept', old: "str(f.what) ? (f.what as string) : what", new: '(f.what as string)' },
    { id: 'N5 non-JSON accepted', old: 'try { o = JSON.parse(json); } catch { return null; }', new: "try { o = JSON.parse(json); } catch { o = { sessionId: 'x' }; }" },
    { id: 'N6 a JSON array or scalar accepted', old: "if (typeof o !== 'object' || o === null || Array.isArray(o)) return null;", new: '' },
    { id: 'N7 a snapshot without a session id accepted', old: "if (typeof v.sessionId !== 'string') return null;", new: '' },
    { id: 'N8 a missing fact throws or reads', old: 'if (!isObj(f)) return { kind: \'unmeasured\', what };', new: '' },
    { id: 'N9 an unknown role kept', old: "isFleetRole(role) ? role : 'undecided'", new: 'isFleetRole(role) ? role : role' },
    { id: 'N10 a fleet role dropped', old: "role === 'undecided' || isFleetRole(role) ? role", new: "role === 'undecided' ? role" },
    { id: 'N11 any mailMore taken as true', old: 'mailMore: v.mailMore === true', new: 'mailMore: !!v.mailMore' },
    { id: 'N12 a missing roleWhy not defaulted', old: "str(v.roleWhy) ? (v.roleWhy as string) : ''", new: '(v.roleWhy as string)' },
    { id: 'N13 a checkpoint of any shape', old: 'x === null || isObj(x)', new: 'true' },
    { id: 'N14 a planPath of any shape', old: '(x.planPath === null || str(x.planPath))', new: 'true' },
    { id: 'N15 a run without a programme', old: 'str(x.programme) && str(x.state) && (', new: 'str(x.state) && (' },
    { id: 'N16 an item without a state', old: 'str(x.state) && num(x.at)', new: 'num(x.at)' },
    { id: 'N17 an item without a time', old: 'num(x.at) && typeof x.everTicked', new: 'typeof x.everTicked' },
    { id: 'N18 an item without a programme', old: ' && str(x.programme);', new: ';' },
    { id: 'N19 a ledger row without a slug', old: 'str(x.slug) && listOf(item)(x.openItems)', new: 'listOf(item)(x.openItems)' },
    { id: 'N20 a ledger row with unread items', old: 'str(x.slug) && listOf(item)(x.openItems)', new: 'str(x.slug)' },
    { id: 'N21 a claim with unread paths', old: 'listOf(str)(x.paths)', new: 'true' },
    { id: 'N22 mail without a delivery id', old: 'num(x.deliveryId) && num(x.at)', new: 'num(x.at)' },
    { id: 'N23 mail without a time', old: 'num(x.deliveryId) && num(x.at)', new: 'num(x.deliveryId)' },
    { id: 'N24 a note without a kind', old: ' && str(x.kind) && str(x.next)', new: ' && str(x.next)' },
    { id: 'N25 a note without a next act', old: ' && str(x.kind) && str(x.next)', new: ' && str(x.kind)' },
    { id: 'N26 the stored time kept', old: 'roleWhy: str(v.roleWhy) ? (v.roleWhy as string) : \'\', at,', new: 'roleWhy: str(v.roleWhy) ? (v.roleWhy as string) : \'\', at: 0,' },
    { id: 'N27 a list that is not a list', old: 'Array.isArray(x) && x.every(ok)', new: 'x.every(ok)' },
    { id: 'N28 an item list not checked', old: "itemsRaised: fact('itemsRaised', listOf(item))", new: "itemsRaised: fact('itemsRaised', () => true)" },
  ],
  suite: snapshotFactsOfCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const PROBE_DOOR_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/probeDoor.ts#bookOf': BOOK_OF_SET as MutantSet<never>,
  'server/src/continuity/probeDoor.ts#gradeAnswers': GRADE_ANSWERS_SET as MutantSet<never>,
  'server/src/continuity/probeDoor.ts#maskedQuestion': MASKED_QUESTION_SET as MutantSet<never>,
  'server/src/continuity/probeDoor.ts#probePages': PROBE_PAGES_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#roundsOf': ROUNDS_OF_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#compactionWindowStart': COMPACTION_WINDOW_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#probeFailedUnfixedOf': FAILED_UNFIXED_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#probeSchedule': SCHEDULE_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#spotFactsOf': SPOT_FACTS_SET as MutantSet<never>,
  'server/src/continuity/card.ts#snapshotFactsOf': SNAPSHOT_FACTS_SET as MutantSet<never>,
};
