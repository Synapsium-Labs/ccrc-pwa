// The probe door's, the probe schedule's and the snapshot reader's oracles and mutant sets (Overlord W1a probes, PR B:
// w1a-probes.md, Tasks 4 to 6). As in `probeSets.ts`, each decider's cases are written ONCE here, as suite cases over a
// module: `continuity-probe-door.test.ts` and `continuity-probe-schedule.test.ts` run them against the real modules, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { SECRET_MASK, SECRET_MASK_TOO_LARGE } from '../../../shared/api.js';
import type { CardFacts, CardItem, CardMail, CardNote } from '../../../shared/continuity-card.js';
import { BOOK_STATES, GENERATION_STATES, SPOT_PROBE_EVERY_TOKENS, type ProbeGrade, type ProbeRoundKind } from '../../../shared/continuity.js';
import { CARD_TEXT_PREFACE } from '../../src/coord/untrusted.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type ProbeDoorModule = typeof import('../../src/continuity/probeDoor.js');
/** Every `.ts` file under `dir`, for the ledger writer pin (`READ_LEDGER_WRITTEN`). */
function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts'))
    .map((e) => path.join(e.parentPath, e.name));
}
export type ProbeScheduleModule = typeof import('../../src/continuity/probeSchedule.js');
export type CardModule = typeof import('../../src/continuity/card.js');
export type CompactionsModule = typeof import('../../src/continuity/compactions.js');
type Line = Parameters<CompactionsModule['compactionsBegunSince']>[0][number];
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
      const q = m.maskedQuestion(stored(), SEAL);
      const a = q.choices![0]!;
      const graded = m.gradeAnswers([stored()], new Map([['p1', a]]), SEAL);
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

/** A stored question (what the door grades from), and the two maskers the cases use: none, and one that masks a `SECRET…`
 *  word with the real placeholder. */
const sq = (qid: string, choices: readonly string[] | null, expected: string, cls: Question['cls'] = 'fact') =>
  ({ qid, cls, question: `question ${qid}`, choices, expected });
const SAME = (t: string): string => t;
const SEAL = (t: string): string => t.replace(/SECRET\w*/g, SECRET_MASK);

export function gradeAnswersCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  const qs = [sq('p1', ['41', '42', '43'], '41'), sq('p2', ['x', 'y', 'z'], 'y'), sq('p3', null, 'none')];
  return {
    'a missing answer fails; the answer is null, never an empty string': () => {
      expect(m.gradeAnswers(qs, new Map(), SAME)).toEqual([
        { qid: 'p1', answer: null, grade: 'fail' }, { qid: 'p2', answer: null, grade: 'fail' }, { qid: 'p3', answer: null, grade: 'fail' },
      ]);
    },
    'each answer is graded by its own question id, in the question order': () => {
      const got = m.gradeAnswers(qs, new Map([['p3', 'NONE'], ['p2', 'x'], ['p1', ' 41 ']]), SAME);
      expect(got).toEqual([
        { qid: 'p1', answer: ' 41 ', grade: 'pass' }, { qid: 'p2', answer: 'x', grade: 'fail' }, { qid: 'p3', answer: 'NONE', grade: 'pass' },
      ]);
    },
    'a wrong answer fails, and an answer for an unknown id is not graded': () => {
      const got = m.gradeAnswers([qs[0]!], new Map([['p1', '42'], ['p9', '41']]), SAME);
      expect(got).toEqual([{ qid: 'p1', answer: '42', grade: 'fail' }]);
    },
    'choices that collide once masked, or fold equal, grade unmeasured whatever the answer, a missing one too (review 2063 F1)': () => {
      const twins = sq('p5', ['rotate SECRET_A', 'rotate SECRET_B', 'run'], 'rotate SECRET_A');
      for (const a of [`rotate ${SECRET_MASK}`, 'rotate SECRET_A', 'run', 'other']) {
        expect(m.gradeAnswers([twins], new Map([['p5', a]]), SEAL)[0]!.grade, a).toBe('unmeasured');
      }
      expect(m.gradeAnswers([twins], new Map(), SEAL)[0]).toEqual({ qid: 'p5', answer: null, grade: 'unmeasured' });
      const folded = sq('p6', ['Run', 'run ', 'stop'], 'stop');
      expect(m.gradeAnswers([folded], new Map([['p6', 'stop']]), SAME)[0]!.grade).toBe('unmeasured');
    },
    'a masked expected answer that is none of the masked choices grades unmeasured (review 2063 F1)': () => {
      const lost = sq('p7', ['a', 'b', 'c'], 'd');
      expect(m.gradeAnswers([lost], new Map([['p7', 'd']]), SAME)[0]!.grade).toBe('unmeasured');
      expect(m.gradableAsServed(q('p7', ['a', 'b', 'c'], 'd'))).toBe(false);
      expect(m.gradableAsServed(q('p8', ['a', 'b'], 'B '))).toBe(true);
      expect(m.gradableAsServed(q('p9', null, 'none'))).toBe(true);
    },
    'an answer with a mask placeholder that matches no choice grades unmeasured; one that matches a choice is graded (review 2063 F6)': () => {
      const qq = sq('p1', ['rotate key-1', 'b', 'c'], 'rotate key-1');
      expect(m.gradeAnswers([qq], new Map([['p1', `rotate ${SECRET_MASK}`]]), SAME)[0]!.grade).toBe('unmeasured');
      expect(m.gradeAnswers([qq], new Map([['p1', `rotate ${SECRET_MASK_TOO_LARGE}`]]), SAME)[0]!.grade).toBe('unmeasured');
      const served = sq('p2', ['rotate SECRET_A', 'b', 'c'], 'rotate SECRET_A');
      expect(m.gradeAnswers([served], new Map([['p2', ` ROTATE ${SECRET_MASK} `]]), SEAL)[0]!.grade).toBe('pass');
      expect(m.gradeAnswers([served], new Map([['p2', 'b']]), SEAL)[0]!.grade).toBe('fail');
    },
    'a placeholder answer that is no stored choice even with the placeholder read as a wildcard fails, never unmeasured (review 2103 F3)': () => {
      const qq = sq('p1', ['rotate key-1 then deploy', 'run the migration', 'stop'], 'rotate key-1 then deploy');
      expect(m.gradeAnswers([qq], new Map([['p1', `deploy ${SECRET_MASK}`]]), SAME)[0]!.grade).toBe('fail');
      expect(m.gradeAnswers([qq], new Map([['p1', `${SECRET_MASK_TOO_LARGE} the migration twice`]]), SAME)[0]!.grade).toBe('fail');
      // Read as a wildcard it must match a whole stored choice, not a part of one.
      expect(m.gradeAnswers([qq], new Map([['p1', `key-1 ${SECRET_MASK}`]]), SAME)[0]!.grade).toBe('fail');
      expect(m.gradeAnswers([qq], new Map([['p1', `rotate ${SECRET_MASK} then`]]), SAME)[0]!.grade).toBe('fail');
      // Either placeholder is a wildcard, and one that still matches a stored choice is masked away.
      expect(m.gradeAnswers([qq], new Map([['p1', `${SECRET_MASK_TOO_LARGE} then deploy`]]), SAME)[0]!.grade).toBe('unmeasured');
      expect(m.gradeAnswers([qq], new Map([['p1', ` ROTATE ${SECRET_MASK} THEN DEPLOY `]]), SAME)[0]!.grade).toBe('unmeasured');
      // A wildcard matches any text, a regular expression's own characters in the answer only themselves.
      const dotted = sq('p2', ['a.b (c) ok', 'x', 'y'], 'a.b (c) ok');
      expect(m.gradeAnswers([dotted], new Map([['p2', `a.b (${SECRET_MASK}) ok`]]), SAME)[0]!.grade).toBe('unmeasured');
      expect(m.gradeAnswers([dotted], new Map([['p2', `a?b (${SECRET_MASK}) ok`]]), SAME)[0]!.grade).toBe('fail');
      const plain = sq('p3', ['axb (c) ok', 'x', 'y'], 'axb (c) ok');
      expect(m.gradeAnswers([plain], new Map([['p3', `a.b (${SECRET_MASK}) ok`]]), SAME)[0]!.grade).toBe('fail');
    },
    'a question with no choices masks nothing away: an answer with a placeholder is graded, and fails unless it is the expected one (review 2068 F2)': () => {
      const byId = sq('p3', null, 'x SECRET_A');
      expect(m.gradeAnswers([byId], new Map([['p3', `x ${SECRET_MASK}`]]), SEAL)[0]!.grade).toBe('pass');
      expect(m.gradeAnswers([byId], new Map([['p3', `y ${SECRET_MASK}`]]), SEAL)[0]!.grade).toBe('fail');
      const abstain = sq('p4', null, 'none', 'abstention');
      for (const a of [`${SECRET_MASK}`, 'SECRET_Z', `rule ${SECRET_MASK_TOO_LARGE}`]) {
        expect(m.gradeAnswers([abstain], new Map([['p4', a]]), SEAL)[0], a).toEqual({ qid: 'p4', answer: SEAL(a), grade: 'fail' });
      }
    },
    'an answer with no placeholder is graded as stored: a wrong secret inside a masked span fails, the right one passes (review 2068 F6)': () => {
      const qq = sq('p1', ['rotate SECRET_A then deploy', 'run', 'stop'], 'rotate SECRET_A then deploy');
      expect(m.gradeAnswers([qq], new Map([['p1', 'rotate SECRET_B then deploy']]), SEAL)[0])
        .toEqual({ qid: 'p1', answer: `rotate ${SECRET_MASK} then deploy`, grade: 'fail' });
      expect(m.gradeAnswers([qq], new Map([['p1', ' Rotate SECRET_A then deploy ']]), SEAL)[0]!.grade).toBe('pass');
      // The copy of the served choice carries the placeholder: graded masked, it passes.
      expect(m.gradeAnswers([qq], new Map([['p1', `rotate ${SECRET_MASK} then deploy`]]), SEAL)[0]!.grade).toBe('pass');
      // Graded as stored, a wrong answer is still a choice-or-fail: a decoy fails, and the answer is recorded masked.
      expect(m.gradeAnswers([qq], new Map([['p1', 'run']]), SEAL)[0]).toEqual({ qid: 'p1', answer: 'run', grade: 'fail' });
      // Graded as stored, the stored choices still bound it: an answer that is no stored choice fails, even the expected text.
      const odd = sq('p2', ['rotate SECRET_A', 'run', 'stop'], 'rotate SECRET_B');
      expect(m.gradeAnswers([odd], new Map([['p2', 'rotate SECRET_B']]), SEAL)[0]!.grade).toBe('fail');
    },
    'an empty answer is an answer: it is given, and it fails': () => {
      expect(m.gradeAnswers([qs[0]!], new Map([['p1', '']]), SAME)).toEqual([{ qid: 'p1', answer: '', grade: 'fail' }]);
      const blank = sq('p4', ['', 'x', 'y'], '');
      expect(m.gradeAnswers([blank], new Map([['p4', '']]), SAME)).toEqual([{ qid: 'p4', answer: '', grade: 'pass' }]);
    },
  };
}

export function bookOfCases(m: ProbeDoorModule): Record<string, SuiteCase> {
  // The ledger as the door reads it for the designated session (`covered`), with no lines, unless a case says otherwise.
  const led = (covered: boolean, reads: number) => ({ ok: true as const, value: { covered, reads } });
  const none = led(true, 0);
  const noRead = { kind: 'read' as const, at: null };
  return {
    'a read at or after the ask is open, a read at exactly the ask included': () => {
      expect(m.bookOf({ kind: 'read', at: 1000 }, 1000, none)).toBe('open');
      expect(m.bookOf({ kind: 'read', at: 1001 }, 1000, none)).toBe('open');
      expect(m.bookOf({ kind: 'read', at: 1001 }, 1000, led(false, 0))).toBe('open');
      expect(m.bookOf({ kind: 'read', at: 1001 }, 1000, { ok: false, detail: 'x' })).toBe('open');
    },
    'a read before the ask or none at all, for a session the ledger covers and measures at no reads: closed': () => {
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000, none)).toBe('closed');
      expect(m.bookOf(noRead, 0, none)).toBe('closed');
      expect(m.bookOf(noRead, 1000, none)).toBe('closed');
    },
    'one ledger line between ask and answer is open, covered or not': () => {
      expect(m.bookOf(noRead, 1000, led(true, 1))).toBe('open');
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000, led(true, 3))).toBe('open');
      expect(m.bookOf(noRead, 1000, led(false, 1))).toBe('open');
      expect(m.bookOf({ kind: 'unmeasured' }, 1000, led(true, 1))).toBe('open');
    },
    'a session the ledger does not cover (a coordinator) stays unmeasured, never closed': () => {
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000, led(false, 0))).toBe('unmeasured');
      expect(m.bookOf(noRead, 1000, led(false, 0))).toBe('unmeasured');
    },
    'an unreadable ledger is unmeasured, never closed and never zero reads': () => {
      const bad = { ok: false as const, detail: 'read_ledger could not be read' };
      expect(m.bookOf(noRead, 1000, bad)).toBe('unmeasured');
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000, bad)).toBe('unmeasured');
    },
    'a card or notes read that could not be measured is unmeasured, not closed': () => {
      expect(m.bookOf({ kind: 'unmeasured' }, 1000, none)).toBe('unmeasured');
      expect(m.bookOf({ kind: 'unmeasured' }, 0, none)).toBe('unmeasured');
    },
    'closed is among the recorded states now, and every state is': () => {
      expect(BOOK_STATES).toContain('closed');
      expect(m.BOOK_STATES_RECORDED).toContain('closed');
      expect([...m.BOOK_STATES_RECORDED].sort()).toEqual([...BOOK_STATES].sort());
    },
    'ledgerFactsOf, once a read door writes the ledger: covered only for the designated session, its reads as the port counted them': () => {
      const live = { kind: 'row' as const, live: 'lane-a', pending: null, pendingKind: null, term: 1 };
      const counted = (n: number) => ({ kind: 'measured' as const, value: n });
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: true, reads: counted(2) })).toEqual(led(true, 2));
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: true, reads: counted(0) })).toEqual(led(true, 0));
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-b', ledgerWritten: true, reads: counted(2) })).toEqual(led(false, 0));
      expect(m.ledgerFactsOf({ designation: { kind: 'none' }, callerId: 'lane-a', ledgerWritten: true, reads: counted(0) })).toEqual(led(false, 0));
      expect(m.ledgerFactsOf({ designation: 'unmeasured', callerId: 'lane-a', ledgerWritten: true, reads: counted(0) }).ok).toBe(false);
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: true, reads: { kind: 'unmeasured', why: 'x' } }).ok).toBe(false);
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: true, reads: null }).ok).toBe(false);
    },
    'ledgerFactsOf with no ledger writer (review 2870 F1): the designated session is not covered, so its probe with no card or notes read is unmeasured, never closed': () => {
      const live = { kind: 'row' as const, live: 'lane-a', pending: null, pendingKind: null, term: 1 };
      const facts = m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: false, reads: { kind: 'measured', value: 0 } });
      expect(facts).toEqual(led(false, 0));
      expect(m.bookOf(noRead, 1000, facts)).toBe('unmeasured');
      expect(m.bookOf({ kind: 'read', at: 999 }, 1000, facts)).toBe('unmeasured');
      expect(m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: false, reads: null })).toEqual(led(false, 0));
      expect(m.ledgerFactsOf({ designation: 'unmeasured', callerId: 'lane-a', ledgerWritten: false, reads: null }).ok).toBe(false);
      expect(m.bookOf(noRead, 1000, m.ledgerFactsOf({ designation: live, callerId: 'lane-a', ledgerWritten: m.READ_LEDGER_WRITTEN, reads: { kind: 'measured', value: 0 } })))
        .toBe(m.READ_LEDGER_WRITTEN ? 'closed' : 'unmeasured');
    },
    'READ_LEDGER_WRITTEN is true exactly when server/src calls recordRead, the read ledger\'s one writer': () => {
      const callers = srcFiles(path.join(ROOT, 'server/src'))
        .filter((f) => !f.endsWith(path.join('operatorModel', 'store.ts')))
        .filter((f) => /\.recordRead\(/.test(readFileSync(f, 'utf8')));
      expect(m.READ_LEDGER_WRITTEN, `recordRead callers: ${callers.join(', ') || 'none'}`).toBe(callers.length > 0);
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
    'the door phrasing (door process A2): the tail names the probe_answer door and its input, and no shell command; the default tail is unchanged': () => {
      const d = m.probePages('r1', 'start', qs, true).join('');
      expect(d.endsWith('Answer them all in one call with the probe_answer door, its input:\n'
        + '{"roundId":"r1","answers":[{"id":"p1","answer":"<your answer>"},{"id":"p2","answer":"<your answer>"}]}')).toBe(true);
      expect(d).not.toContain('ccrc-api');
      expect(d).not.toContain('<<');
      expect(m.probePages('r1', 'start', qs, false).join('')).toBe(whole());
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
  state: 'active', probeRounds: 0, rounds: [], cardReadAt: M(null), compactionsSince: M(0), idle: M(false), ctx: C(0),
  compactedAt: M(null), compactionInFlight: M(false), compactionStalled: false, ...over,
});
/** A usage reading of `tokens`, written by the statusline at `at` (by default after every compaction line a case writes). */
function C(tokens: number, at = AT): Input['ctx'] { return M({ tokens, at }); }
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
      expect([s.feed, s.open]).toEqual([null, { kind: 'start', depthTokens: null, supersedes: null }]);
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
      expect(at(M(5001))).toEqual({ kind: 'start', depthTokens: null, supersedes: null });
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
    'active, a compaction since the window opens a compaction round at the depth it reads': () => {
      expect(opens({ compactionsSince: M(1) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
      expect(opens({ compactionsSince: M(3), rounds: [DONE('r1', 'start', 'passed')] })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
    },
    'active, no compaction since the window opens no compaction round; a count that could not be read opens none': () => {
      expect(opens({ compactionsSince: M(0) })).toBeNull();
      expect(opens({ compactionsSince: { kind: 'unmeasured', why: 'x' } })).toBeNull();
    },
    'active, a failed compaction round asks for a re-read: the next opens only once the card was read after it': () => {
      const failed = [DONE('c1', 'compaction', 'failed', { answeredAt: 5000 })];
      expect(opens({ rounds: failed, cardReadAt: M(5001) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
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
      expect(opens({ rounds: two, cardReadAt: M(7000), compactionsSince: M(1) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
    },
    'active, a compaction round that passed asks for no re-read': () => {
      const passed = [DONE('c1', 'compaction', 'passed', { answeredAt: 5000 })];
      expect(opens({ rounds: passed, cardReadAt: M(9000), compactionsSince: M(0) })).toBeNull();
    },
    'active, an open start or compaction round blocks every round; an open spot round blocks only spot rounds': () => {
      expect(opens({ rounds: [OPENR('r1', 'start')], compactionsSince: M(2), idle: M(true), ctx: C(3 * K) })).toBeNull();
      expect(opens({ rounds: [OPENR('c1', 'compaction')], compactionsSince: M(2), idle: M(true), ctx: C(3 * K) })).toBeNull();
      expect(opens({ rounds: [{ ...OPENR('s1', 'spot'), depthTokens: K }], idle: M(true), ctx: C(9 * K) })).toBeNull();
    },
    'active, a compaction round supersedes an unanswered spot round (review 2063 F3)': () => {
      expect(opens({ rounds: [OPENR('s1', 'spot')], compactionsSince: M(1), ctx: C(K) }))
        .toEqual({ kind: 'compaction', depthTokens: K, supersedes: 's1' });
      const failed = DONE('c1', 'compaction', 'failed', { answeredAt: 5000 });
      expect(opens({ rounds: [failed, OPENR('s1', 'spot')], cardReadAt: M(5001), ctx: C(K) }))
        .toEqual({ kind: 'compaction', depthTokens: K, supersedes: 's1' });
    },
    'active, a compaction round records the depth it opened at, the spot baseline; 0 when the context was not read (review 2068 F1)': () => {
      expect(opens({ compactionsSince: M(1), ctx: C(31_000) })).toEqual({ kind: 'compaction', depthTokens: 31_000, supersedes: null });
      expect(opens({ compactionsSince: M(1), ctx: NOPE })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
    },
    'active, a compaction round records the context only from a reading newer than the compaction, else 0, never the old depth (review 2068 F1)': () => {
      const line = AT - 2 * MIN;
      expect(opens({ compactionsSince: M(1), compactedAt: M(line), ctx: C(171_000, line - 1_000) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
      expect(opens({ compactionsSince: M(1), compactedAt: M(line), ctx: C(171_000, line) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
      expect(opens({ compactionsSince: M(1), compactedAt: M(line), ctx: C(45_000, line + 1) })).toEqual({ kind: 'compaction', depthTokens: 45_000, supersedes: null });
      expect(opens({ compactionsSince: M(1), compactedAt: NOPE, ctx: C(171_000) })).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
    },
    'active, after a compaction the next spot round opens about 50k into the new context, not 50k past the old depth (review 2068 F1)': () => {
      // The measured case: the baseline stood at 170k, the compaction left about 45k, and the sidecar still read 171k for a while.
      const line = AT - 20 * MIN;
      const before = DONE('s1', 'spot', 'passed', { depthTokens: 170_000 });
      const comp = opens({ rounds: [before], compactionsSince: M(1), compactedAt: M(line), ctx: C(171_000, line - 3 * MIN) });
      expect(comp).toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
      const rs = [before, DONE('c1', 'compaction', 'passed', { depthTokens: comp!.depthTokens })];
      // The old reading opens nothing: it is from before the compaction.
      expect(opens({ rounds: rs, compactedAt: M(line), idle: M(true), ctx: C(171_000, line - 3 * MIN) })).toBeNull();
      expect(opens({ rounds: rs, compactedAt: M(line), idle: M(true), ctx: C(45_000, line + MIN) })).toBeNull();
      expect(opens({ rounds: rs, compactedAt: M(line), idle: M(true), ctx: C(50_000, line + 9 * MIN) }))
        .toEqual({ kind: 'spot', depthTokens: 50_000, supersedes: null });
      expect(opens({ rounds: rs, compactedAt: M(line), idle: M(true), ctx: C(221_000, line + 9 * MIN) })).toMatchObject({ kind: 'spot' });
    },
    'active, a spot round reads the context only from a reading newer than the newest compaction; lines not read open none (review 2068 F1)': () => {
      const line = AT - MIN;
      expect(opens({ compactedAt: M(line), idle: M(true), ctx: C(3 * K, line - 1) })).toBeNull();
      expect(opens({ compactedAt: M(line), idle: M(true), ctx: C(3 * K, line) })).toBeNull();
      expect(opens({ compactedAt: M(line), idle: M(true), ctx: C(3 * K, line + 1) })).toEqual({ kind: 'spot', depthTokens: 3 * K, supersedes: null });
      expect(opens({ compactedAt: NOPE, idle: M(true), ctx: C(3 * K) })).toBeNull();
      expect(opens({ compactedAt: M(null), idle: M(true), ctx: C(3 * K, 0) })).toEqual({ kind: 'spot', depthTokens: 3 * K, supersedes: null });
    },
    'active, a compaction round that composed empty over the same snapshot does not hold the spot branch (review 2068 F4)': () => {
      expect(opens({ compactionsSince: M(1), compactionStalled: true })).toBeNull();
      expect(opens({ compactionsSince: M(1), compactionStalled: true, idle: M(true), ctx: C(3 * K) })).toEqual({ kind: 'spot', depthTokens: 3 * K, supersedes: null });
      const failed = DONE('c1', 'compaction', 'failed', { answeredAt: 5000, depthTokens: 0 });
      expect(opens({ rounds: [failed], cardReadAt: M(5001), compactionStalled: true, idle: M(true), ctx: C(K) }))
        .toEqual({ kind: 'spot', depthTokens: K, supersedes: null });
      // A stalled compaction round supersedes nothing: an open spot round stays open, and no other spot round opens.
      expect(opens({ rounds: [OPENR('s1', 'spot')], compactionsSince: M(1), compactionStalled: true, idle: M(true), ctx: C(9 * K) })).toBeNull();
      // Stalled only blocks a compaction round that is due: nothing else changes.
      expect(opens({ compactionStalled: true, idle: M(true), ctx: C(K - 1) })).toBeNull();
    },
    'active, while a stalled compaction is due the spot baseline counts only marks asked since it, else 0 (review 2103 F1)': () => {
      const line = AT + MIN;
      const before = DONE('s1', 'spot', 'passed', { depthTokens: 150_000, askedAt: AT });
      const stalled = (rounds: Input['rounds'], tokens: number) =>
        opens({ rounds, compactionsSince: M(1), compactionStalled: true, compactedAt: M(line), idle: M(true), ctx: C(tokens, line + 2 * MIN) });
      // The reviewer's case: an earlier spot round at 150k, a stalled compaction, a 60k reading after it.
      expect(stalled([before], 60_000)).toEqual({ kind: 'spot', depthTokens: 60_000, supersedes: null });
      expect(stalled([before], K - 1)).toBeNull();
      // A spot round asked since the compaction is the baseline: no spot round every pass while the stall lasts.
      const since = DONE('s2', 'spot', 'passed', { depthTokens: 60_000, askedAt: line + MIN });
      expect(stalled([before, since], 60_000 + K - 1)).toBeNull();
      expect(stalled([before, since], 60_000 + K)).toEqual({ kind: 'spot', depthTokens: 60_000 + K, supersedes: null });
      // With no compaction due the baseline is the newest mark, as before.
      expect(opens({ rounds: [before], compactedAt: M(line), idle: M(true), ctx: C(60_000, line + 2 * MIN) })).toBeNull();
    },
    'active, a compaction in flight opens its round at depth 0 and no spot round (review 2103 F2)': () => {
      const line = AT - MIN;
      expect(opens({ compactionsSince: M(1), compactedAt: M(line), compactionInFlight: M(true), ctx: C(171_000, line + 5_000) }))
        .toEqual({ kind: 'compaction', depthTokens: 0, supersedes: null });
      expect(opens({ compactedAt: M(line), compactionInFlight: M(true), idle: M(true), ctx: C(171_000, line + 5_000) })).toBeNull();
    },
    'no state but probing and active opens a round, however many compactions or tokens': () => {
      for (const state of GENERATION_STATES.filter((x) => x !== 'probing' && x !== 'active')) {
        const s = go({ state, compactionsSince: M(4), idle: M(true), ctx: C(4 * K) });
        expect([state, s.feed, s.open]).toEqual([state, null, null]);
      }
    },
    // ---- spot
    'active, idle and 50k past a zero baseline: a spot round opens and records the depth it opened at': () => {
      expect(opens({ idle: M(true), ctx: C(K) })).toEqual({ kind: 'spot', depthTokens: K, supersedes: null });
      expect(opens({ idle: M(true), ctx: C(2 * K + 17) })).toEqual({ kind: 'spot', depthTokens: 2 * K + 17, supersedes: null });
    },
    'active, less than 50k past the baseline no spot round opens': () => {
      expect(opens({ idle: M(true), ctx: C(K - 1) })).toBeNull();
      expect(opens({ idle: M(true), ctx: C(0) })).toBeNull();
    },
    'active, a busy session opens no spot round; an unread marker or a stale sidecar opens none': () => {
      expect(opens({ idle: M(false), ctx: C(3 * K) })).toBeNull();
      expect(opens({ idle: { kind: 'unmeasured', why: 'x' }, ctx: C(3 * K) })).toBeNull();
      expect(opens({ idle: M(true), ctx: { kind: 'unmeasured', why: 'x' } })).toBeNull();
    },
    'active, the next spot round opens at the last spot depth plus 50k, not at the next 50k bucket (review 2063 F5)': () => {
      const spot = (d: number) => DONE('s1', 'spot', 'passed', { depthTokens: d });
      expect(opens({ rounds: [spot(2 * K - 1_000)], idle: M(true), ctx: C(2 * K) })).toBeNull();
      expect(opens({ rounds: [spot(2 * K - 1_000)], idle: M(true), ctx: C(3 * K - 1_001) })).toBeNull();
      expect(opens({ rounds: [spot(2 * K - 1_000)], idle: M(true), ctx: C(3 * K - 1_000) }))
        .toEqual({ kind: 'spot', depthTokens: 3 * K - 1_000, supersedes: null });
    },
    'active, the newest spot round sets the baseline, not the first': () => {
      const rs = [DONE('s1', 'spot', 'passed', { depthTokens: K }), DONE('s2', 'spot', 'passed', { depthTokens: 4 * K })];
      expect(opens({ rounds: rs, idle: M(true), ctx: C(5 * K - 1) })).toBeNull();
      expect(opens({ rounds: rs, idle: M(true), ctx: C(5 * K) })).toEqual({ kind: 'spot', depthTokens: 5 * K, supersedes: null });
    },
    'active, a compaction resets the baseline to the depth after it (review 2063 F5)': () => {
      const rs = [DONE('s1', 'spot', 'passed', { depthTokens: 3 * K }), DONE('c1', 'compaction', 'passed', { depthTokens: 30_000 })];
      expect(opens({ rounds: rs, idle: M(true), ctx: C(30_000 + K - 1) })).toBeNull();
      expect(opens({ rounds: rs, idle: M(true), ctx: C(30_000 + K) })).toEqual({ kind: 'spot', depthTokens: 30_000 + K, supersedes: null });
    },
    'active, a newest compaction round whose depth was not measured leaves the baseline unmeasured: no spot round': () => {
      const rs = [DONE('s1', 'spot', 'passed', { depthTokens: K }), DONE('c1', 'compaction', 'passed', { depthTokens: null })];
      expect(opens({ rounds: rs, idle: M(true), ctx: C(9 * K) })).toBeNull();
    },
    'active, a start round is not a mark: the baseline counts from zero without a spot or compaction round': () => {
      const rs = [DONE('r1', 'start', 'passed', { depthTokens: 9 * K })];
      expect(opens({ rounds: rs, idle: M(true), ctx: C(K) })).toEqual({ kind: 'spot', depthTokens: K, supersedes: null });
    },
    'active, a compaction round wins over a spot round the same pass': () => {
      expect(opens({ compactionsSince: M(1), idle: M(true), ctx: C(3 * K) })).toEqual({ kind: 'compaction', depthTokens: 3 * K, supersedes: null });
    },
    'the verdict of probeFailedUnfixed rides every answer, in every state': () => {
      const two = [DONE('c1', 'compaction', 'failed'), DONE('c2', 'compaction', 'failed')];
      for (const state of GENERATION_STATES) {
        expect(go({ state, rounds: two }).probeFailedUnfixed, state).toEqual({ kind: 'measured', value: true });
      }
    },
  };
}

export function ctxSinceCompactionCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  const line = AT - 5 * MIN;
  const SETTLED = M(false);
  return {
    'a reading newer than the newest compaction line is the context; one at or before it is none (review 2068 F1)': () => {
      expect(m.ctxSinceCompaction(C(45_000, line + 1), M(line), SETTLED)).toBe(45_000);
      expect(m.ctxSinceCompaction(C(171_000, line), M(line), SETTLED)).toBeNull();
      expect(m.ctxSinceCompaction(C(171_000, line - 1), M(line), SETTLED)).toBeNull();
    },
    'with no compaction on record any fresh reading is the context': () => {
      expect(m.ctxSinceCompaction(C(171_000, 0), M(null), SETTLED)).toBe(171_000);
    },
    'a reading not measured, or compaction lines not read, is none, never zero and never a guess': () => {
      expect(m.ctxSinceCompaction(NOPE, M(line), SETTLED)).toBeNull();
      expect(m.ctxSinceCompaction(NOPE, M(null), SETTLED)).toBeNull();
      expect(m.ctxSinceCompaction(C(45_000, line + 1), NOPE, SETTLED)).toBeNull();
    },
    'a compaction in flight, or one that could not be told settled, has no context since it, however new the reading (review 2103 F2)': () => {
      expect(m.ctxSinceCompaction(C(171_000, line + 5_000), M(line), M(true))).toBeNull();
      expect(m.ctxSinceCompaction(C(171_000, line + 5_000), M(line), NOPE)).toBeNull();
      expect(m.ctxSinceCompaction(C(45_000, line + 5_000), M(line), SETTLED)).toBe(45_000);
    },
  };
}

const T0 = AT;
const L = (at: number, phase: Line['phase'], over: Partial<Line> = {}): Line => ({ at, trigger: 'auto', phase, transcript: null, scope: 'main', ...over });
const PAIR = 10 * MIN;

export function compactionsBegunSinceCases(m: CompactionsModule): Record<string, SuiteCase> {
  return {
    'a pre before the start and its post after it are one compaction, begun before: none since (review 2068 F7)': () => {
      expect(m.compactionsBegunSince([L(T0 - MIN, 'pre'), L(T0 + MIN, 'post')], T0)).toBe(0);
      expect(m.compactionsBegunSince([L(T0 - PAIR + 1, 'pre'), L(T0 + 1, 'post')], T0)).toBe(0);
    },
    'a compaction begun at or after the start counts once, a pre with its post or either alone': () => {
      expect(m.compactionsBegunSince([L(T0, 'pre'), L(T0 + MIN, 'post')], T0)).toBe(1);
      expect(m.compactionsBegunSince([L(T0 + MIN, 'pre')], T0)).toBe(1);
      expect(m.compactionsBegunSince([L(T0 + MIN, 'post')], T0)).toBe(1);
      expect(m.compactionsBegunSince([L(T0 - MIN, 'pre'), L(T0 + MIN, 'post'), L(T0 + 30 * MIN, 'pre'), L(T0 + 31 * MIN, 'post')], T0)).toBe(1);
    },
    'a post too long after a pre before the start settles nothing: it is a compaction of its own': () => {
      expect(m.compactionsBegunSince([L(T0 - PAIR - MIN, 'pre'), L(T0 + 1, 'post')], T0)).toBe(1);
      expect(m.compactionsBegunSince([L(T0 - MIN, 'pre', { trigger: 'manual' }), L(T0 + MIN, 'post')], T0)).toBe(1);
    },
    'lines only before the start count nothing, however many': () => {
      expect(m.compactionsBegunSince([L(T0 - 3 * PAIR, 'pre'), L(T0 - 2 * PAIR, 'post'), L(T0 - MIN, 'pre')], T0)).toBe(0);
      expect(m.compactionsBegunSince([L(T0 - 40 * PAIR, 'pre'), L(T0 - 20 * PAIR, 'pre'), L(T0 + MIN, 'pre')], T0)).toBe(1);
      expect(m.compactionsBegunSince([], T0)).toBe(0);
    },
    'two pres before the start and one post after: the post settles one of them, nothing begins since': () => {
      expect(m.compactionsBegunSince([L(T0 - 5 * MIN, 'pre'), L(T0 - 3 * MIN, 'pre'), L(T0 + MIN, 'post')], T0)).toBe(0);
    },
    'appending a line at or after the start never lowers the count': () => {
      const base = [L(T0 - 5 * MIN, 'pre'), L(T0 - 4 * MIN, 'post'), L(T0 + MIN, 'pre')];
      for (const extra of [L(T0, 'pre'), L(T0 + 2 * MIN, 'post'), L(T0 + 50 * MIN, 'post'), L(T0 + 3 * MIN, 'pre', { scope: 'subagent' })]) {
        expect(m.compactionsBegunSince([...base, extra], T0)).toBeGreaterThanOrEqual(m.compactionsBegunSince(base, T0));
      }
    },
  };
}

export function compactionInFlightCases(m: CompactionsModule): Record<string, SuiteCase> {
  return {
    'a main pre younger than the pairing window with no post that settles it is in flight (review 2103 F2)': () => {
      expect(m.compactionInFlight([L(T0, 'pre')], T0 + MIN)).toBe(true);
      expect(m.compactionInFlight([L(T0, 'pre')], T0 + PAIR - 1)).toBe(true);
    },
    'a post that settles it ends it; one of another trigger, or before the pre, does not': () => {
      expect(m.compactionInFlight([L(T0, 'pre'), L(T0 + MIN, 'post')], T0 + 2 * MIN)).toBe(false);
      expect(m.compactionInFlight([L(T0, 'pre'), L(T0 + MIN, 'post', { trigger: 'manual' })], T0 + 2 * MIN)).toBe(true);
      expect(m.compactionInFlight([L(T0 - MIN, 'post'), L(T0, 'pre')], T0 + 2 * MIN)).toBe(true);
    },
    'a pre as old as the pairing window is no longer in flight: a compaction may fire no PostCompact': () => {
      expect(m.compactionInFlight([L(T0, 'pre')], T0 + PAIR)).toBe(false);
      expect(m.compactionInFlight([L(T0, 'pre')], T0 + 3 * PAIR)).toBe(false);
    },
    'only a main pre counts: another scope, a refused line or no line is not in flight': () => {
      expect(m.compactionInFlight([L(T0, 'pre', { scope: 'subagent' })], T0 + MIN)).toBe(false);
      expect(m.compactionInFlight([L(T0, 'pre', { scope: null })], T0 + MIN)).toBe(false);
      expect(m.compactionInFlight([L(T0, 'refused')], T0 + MIN)).toBe(false);
      expect(m.compactionInFlight([], T0)).toBe(false);
    },
    'a settled compaction does not hide a newer one in flight': () => {
      expect(m.compactionInFlight([L(T0 - 30 * MIN, 'pre'), L(T0 - 29 * MIN, 'post'), L(T0, 'pre')], T0 + MIN)).toBe(true);
    },
  };
}

export function newestCompactionAtCases(m: CompactionsModule): Record<string, SuiteCase> {
  return {
    'the newest main pre or post line, whichever is later': () => {
      expect(m.newestCompactionAt([L(T0, 'pre'), L(T0 + MIN, 'post'), L(T0 - MIN, 'pre')])).toBe(T0 + MIN);
      expect(m.newestCompactionAt([L(T0 + 2 * MIN, 'pre'), L(T0 + MIN, 'post')])).toBe(T0 + 2 * MIN);
    },
    'a refused line and a line of another scope are no compaction': () => {
      expect(m.newestCompactionAt([L(T0, 'pre'), L(T0 + MIN, 'refused')])).toBe(T0);
      expect(m.newestCompactionAt([L(T0, 'post'), L(T0 + MIN, 'pre', { scope: 'subagent' }), L(T0 + 2 * MIN, 'pre', { scope: 'ambiguous' }), L(T0 + 3 * MIN, 'pre', { scope: null })])).toBe(T0);
    },
    'no compaction on record is null, never zero': () => {
      expect(m.newestCompactionAt([])).toBeNull();
      expect(m.newestCompactionAt([L(T0, 'refused'), L(T0, 'pre', { scope: 'subagent' })])).toBeNull();
    },
  };
}

export function roundSnapshotOfCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  return {
    'a spot round is drawn from no snapshot, a start round from the carded one whatever was read since': () => {
      expect(m.roundSnapshotOf('spot', 'snap-1', M('snap-2'))).toEqual(M(null));
      expect(m.roundSnapshotOf('start', 'snap-1', M('snap-2'))).toEqual(M('snap-1'));
      expect(m.roundSnapshotOf('start', 'snap-1', NOPE)).toEqual(M('snap-1'));
    },
    'a compaction round is drawn from the newest snapshot the conversation read (review 2063 F2)': () => {
      expect(m.roundSnapshotOf('compaction', 'snap-1', M('snap-2'))).toEqual(M('snap-2'));
    },
    'a compaction round with no read since falls back to the carded snapshot; a read that failed leaves it unmeasured': () => {
      expect(m.roundSnapshotOf('compaction', 'snap-1', M(null))).toEqual(M('snap-1'));
      expect(m.roundSnapshotOf('compaction', 'snap-1', NOPE)).toEqual(NOPE);
    },
  };
}

export function emptyTryKeyCases(m: ProbeScheduleModule): Record<string, SuiteCase> {
  const since = AT - 10 * MIN;
  const drawn = (notes: number, mail: number): CardFacts => m.spotFactsOf('lane-a-project-a', 'coordinator', AT,
    Array.from({ length: notes }, (_, i) => NOTE(i + 1, since + i)), Array.from({ length: mail }, (_, i) => MAIL(i + 1, since + i)), since);
  return {
    'a start or compaction try is keyed by its kind and its snapshot, whatever the depth': () => {
      expect(m.emptyTryKey('start', 'snap-1', null, null)).toBe('start:snap-1');
      expect(m.emptyTryKey('compaction', 'snap-1', 40_000, null)).toBe('compaction:snap-1');
      expect(m.emptyTryKey('compaction', 'snap-2', null, null)).not.toBe(m.emptyTryKey('compaction', 'snap-1', null, null));
      expect(m.emptyTryKey('compaction', 'snap-1', null, drawn(2, 1))).toBe('compaction:snap-1');
    },
    'a spot try is keyed by its 50k step, not its exact depth, nor any snapshot': () => {
      expect(m.emptyTryKey('spot', null, K + 5, drawn(0, 0))).toBe(m.emptyTryKey('spot', null, 2 * K - 1, drawn(0, 0)));
      expect(m.emptyTryKey('spot', null, 2 * K, drawn(0, 0))).not.toBe(m.emptyTryKey('spot', null, 2 * K - 1, drawn(0, 0)));
      expect(m.emptyTryKey('spot', 'snap-1', 2 * K, drawn(0, 0))).toBe('spot:2:0');
    },
    'a spot try is keyed by the count of the rows it was drawn from, so a new note or mail ends the skip (review 2068 F5)': () => {
      expect(m.emptyTryKey('spot', null, K, drawn(1, 0))).not.toBe(m.emptyTryKey('spot', null, K, drawn(0, 0)));
      expect(m.emptyTryKey('spot', null, K, drawn(0, 1))).not.toBe(m.emptyTryKey('spot', null, K, drawn(0, 0)));
      expect(m.emptyTryKey('spot', null, K, drawn(2, 1))).toBe('spot:1:3');
      expect(m.emptyTryKey('spot', null, K, drawn(1, 2))).toBe('spot:1:3');
      expect(m.emptyTryKey('spot', null, K, null)).toBe('spot:1:0');
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
      expect(f.timers).toEqual(empty);
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
  timers: read([{ id: 3, dueAt: AT + MIN, preview: 'check the checks', runId: 41, programme: null }]),
};
const FACT_NAMES = ['runs', 'ledger', 'claims', 'intent', 'itemsRaised', 'mailOutstanding', 'notes', 'checkpoint', 'history', 'timers'] as const;
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
    'a timer row with a field this build needs missing or mistyped reads the timers unmeasured; a snapshot from before timers reads them unmeasured': () => {
      const t = { id: 3, dueAt: AT + MIN, preview: 'check the checks', runId: 41, programme: null };
      for (const [key, bad] of [['id', 'x'], ['dueAt', null], ['preview', 5], ['runId', '41'], ['programme', 7]] as const) badFact('timers', [{ ...t, [key]: bad }]);
      expect(parse({ ...stored(), timers: { kind: 'read', value: [{ ...t, runId: null, programme: 'prog-a' }] } })!.timers)
        .toEqual({ kind: 'read', value: [{ ...t, runId: null, programme: 'prog-a' }] });
      expect(parse(without(stored(), 'timers'))!.timers).toEqual({ kind: 'unmeasured', what: "the snapshot's timers" });
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
const COMPACTIONS = path.join(ROOT, 'server/src/continuity/compactions.ts');

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
    { id: 'A1 a missing answer passes', old: "a === undefined ? 'fail'", new: "a === undefined ? 'pass'" },
    { id: 'A2 every given answer passes', old: "'unmeasured' : gradeProbe(q, mask(a))", new: "'unmeasured' : 'pass'" },
    { id: 'A3 a missing answer as an empty string', old: 'answer: a === undefined ? null : mask(a)', new: "answer: a === undefined ? '' : mask(a)" },
    { id: 'A4 an empty answer taken for missing', old: "a === undefined ? 'fail'", new: "a === undefined || a === '' ? 'fail'" },
    { id: 'A5 the answer read by the wrong id', old: 'answers.get(row.qid)', new: 'answers.get(row.cls)' },
    { id: 'A6 a question that cannot be graded is graded', old: "!gradableAsServed(q) ? 'unmeasured' : ", new: '' },
    { id: 'A7 an answer masked away is graded', old: "maskedAway(q, mask(a), row.choices) ? 'unmeasured' : ", new: '' },
    { id: 'A8 colliding choices accepted', old: 'new Set(folded).size === folded.length && ', new: '' },
    { id: 'A9 an expected answer outside the choices accepted', old: ' && folded.filter((c) => c === fold(q.expected)).length === 1', new: '' },
    { id: 'A10 choices compared unfolded', old: 'q.choices.map(fold)', new: 'q.choices' },
    { id: 'A11 the too-large placeholder not read', old: ' || answer.includes(SECRET_MASK_TOO_LARGE)', new: '' },
    { id: 'A12 a placeholder answer that matches a choice masked away', old: ' && !q.choices.some((c) => fold(c) === fold(answer))', new: '' },
    { id: 'A13 an answer to a question with no choices masked away (review 2068 F2)', old: 'q.choices !== null && hasPlaceholder(answer)', new: 'hasPlaceholder(answer)' },
    { id: 'A14 a placeholder answer matched unfolded', old: '.some((c) => fold(c) === fold(answer))', new: '.some((c) => c === answer)' },
    { id: 'A15 an answer with no placeholder graded masked (review 2068 F6)', old: '!hasPlaceholder(a) ? gradeProbe(rawQuestion(row), a)', new: '!hasPlaceholder(a) ? gradeProbe(q, mask(a))' },
    { id: 'A16 a placeholder answer graded as stored', old: ": maskedAway(q, mask(a), row.choices) ? 'unmeasured' : gradeProbe(q, mask(a))", new: ": maskedAway(q, mask(a), row.choices) ? 'unmeasured' : gradeProbe(rawQuestion(row), a)" },
    { id: 'A17 the answer recorded unmasked', old: 'answer: a === undefined ? null : mask(a)', new: 'answer: a ?? null' },
    { id: 'A19 any placeholder answer masked away (review 2103 F3)', old: '\n  && (stored ?? []).some((c) => wildcardMatches(answer, c))', new: '' },
    { id: 'A20 a placeholder matches nothing', old: ".join('[\\\\s\\\\S]*')", new: ".join('')" },
    { id: 'A21 a wildcard match need not start the choice', old: 'new RegExp(`^${', new: 'new RegExp(`${' },
    { id: 'A22 a wildcard match need not end the choice', old: "join('[\\\\s\\\\S]*')}$`)", new: "join('[\\\\s\\\\S]*')}`)" },
    { id: 'A23 the answer read unescaped', old: '.split(PLACEHOLDERS).map(literal)', new: '.split(PLACEHOLDERS)' },
    { id: 'A24 the too-large placeholder not a wildcard', old: '|${literal(fold(SECRET_MASK_TOO_LARGE))}', new: '' },
    { id: 'A25 the stored choices not passed', old: 'maskedAway(q, mask(a), row.choices)', new: 'maskedAway(q, mask(a), null)' },
    { id: 'A18 the stored question read without its choices', old: 'text: q.question, choices: q.choices,', new: 'text: q.question, choices: null,' },
  ],
  suite: gradeAnswersCases,
};

const BOOK_OF_SET: MutantSet<ProbeDoorModule> = {
  modulePath: DOOR,
  mutants: [
    { id: 'B1 a read at the ask is not open', old: 'last.at >= askedAt', new: 'last.at > askedAt' },
    { id: 'B2 the fall-through is closed', old: "if (ledger.value.covered && last.kind === 'read') return 'closed';\n  return 'unmeasured';", new: "if (ledger.value.covered && last.kind === 'read') return 'closed';\n  return 'closed';" },
    { id: 'B3 an unmeasured read is open', old: "last.kind === 'read' && last.at !== null && last.at >= askedAt", new: "last.kind === 'unmeasured' || (last.at !== null && last.at >= askedAt)" },
    { id: 'B4 no read time counted as open', old: 'last.at !== null && ', new: '' },
    { id: 'B5 a read before the ask is open', old: 'last.at >= askedAt', new: 'last.at <= askedAt' },
    { id: 'B6 closed left out of the recorded states', old: 'export const BOOK_STATES_RECORDED: readonly BookState[] = BOOK_STATES;', new: "export const BOOK_STATES_RECORDED: readonly BookState[] = BOOK_STATES.filter((b) => b !== 'closed');" },
    { id: 'B7 the ledger\'s reads ignored', old: "  if (ledger.value.reads > 0) return 'open';\n", new: '' },
    { id: 'B8 covered ignored', old: "if (ledger.value.covered && last.kind === 'read') return 'closed';", new: "if (last.kind === 'read') return 'closed';" },
    { id: 'B9 an unreadable ledger read as no reads', old: "  if (!ledger.ok) return 'unmeasured';\n  if (ledger.value.reads > 0) return 'open';\n  if (ledger.value.covered && last.kind === 'read') return 'closed';",
      new: "  const v = ledger.ok ? ledger.value : { covered: true, reads: 0 };\n  if (v.reads > 0) return 'open';\n  if (v.covered && last.kind === 'read') return 'closed';" },
    { id: 'B10 a card or notes read that could not be measured read as none', old: "if (ledger.value.covered && last.kind === 'read') return 'closed';", new: "if (ledger.value.covered) return 'closed';" },
    { id: 'L1 an unreadable designation read as uncovered', old: "  if (i.designation === 'unmeasured') return { ok: false, detail: 'the designation could not be read' };\n", new: '' },
    { id: 'L2 every session covered', old: "  if (identityOf(i.callerId, i.designation) !== 'overlord') return { ok: true, value: { covered: false, reads: 0 } };\n", new: '' },
    { id: 'L5 no ledger writer still covers', old: "  if (!i.ledgerWritten) return { ok: true, value: { covered: false, reads: 0 } };\n", new: '' },
    { id: 'L6 the build denies its ledger writer', old: 'export const READ_LEDGER_WRITTEN = true;', new: 'export const READ_LEDGER_WRITTEN = false;' },
    { id: 'L3 a count never asked read as zero', old: "if (i.reads === null) return { ok: false, detail: 'the read ledger was not asked' };", new: "if (i.reads === null) return { ok: true, value: { covered: true, reads: 0 } };" },
    { id: 'L4 an unreadable count read as zero', old: "return i.reads.kind === 'measured' ? { ok: true, value: { covered: true, reads: i.reads.value } } : { ok: false, detail: i.reads.why };", new: "return { ok: true, value: { covered: true, reads: i.reads.kind === 'measured' ? i.reads.value : 0 } };" },
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
    { id: 'P11 the door tail never chosen', old: 'const tail = door ?', new: 'const tail = false ?' },
    { id: 'P12 the door tail always chosen', old: 'const tail = door ?', new: 'const tail = true ?' },
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
    { id: 'C7 the delta read as a 50k bucket', old: 'depth - baseline >= SPOT_PROBE_EVERY_TOKENS', new: 'Math.floor(depth / SPOT_PROBE_EVERY_TOKENS) > Math.floor(baseline / SPOT_PROBE_EVERY_TOKENS)' },
    { id: 'C8 a spot at exactly 50k past waits', old: 'baseline >= SPOT_PROBE_EVERY_TOKENS', new: 'baseline > SPOT_PROBE_EVERY_TOKENS' },
    { id: 'C9 the compaction trigger on zero compactions', old: 'i.compactionsSince.value >= 1', new: 'i.compactionsSince.value >= 0' },
    { id: 'C10 a compaction follow-up without a re-read', old: 'awaitingReRead ? reReadAfter(i.cardReadAt, lastComp.answeredAt!)', new: 'awaitingReRead ? true' },
    { id: 'C11 a round opened on active while a start or compaction round is open', old: "if (openRound !== undefined && openRound.kind !== 'spot') return none;", new: '' },
    { id: 'C12 rounds opened in any state', old: "  if (i.state !== 'active') return none;", new: '' },
    { id: 'C13 a new compaction opens during a re-read wait', old: 'awaitingReRead ? reReadAfter(i.cardReadAt, lastComp.answeredAt!)', new: "awaitingReRead ? reReadAfter(i.cardReadAt, lastComp.answeredAt!) || (i.compactionsSince.kind === 'measured' && i.compactionsSince.value >= 1)" },
    { id: 'C14 an unfixed pair still waits for a re-read', old: '!(probeFailedUnfixed.kind === \'measured\' && probeFailedUnfixed.value)', new: 'true' },
    { id: 'C15 any compaction round asks for a re-read', old: "lastComp?.verdict === 'failed' &&", new: 'lastComp !== undefined &&' },
    { id: 'C16 the first mark sets the baseline', old: 'marks[marks.length - 1]!.depthTokens', new: 'marks[0]!.depthTokens' },
    { id: 'C17 a spot round without its depth', old: "open: { kind: 'spot', depthTokens: depth,", new: "open: { kind: 'spot', depthTokens: null," },
    { id: 'C18 the first round never opens at zero failures', old: 'i.probeRounds === 0 ||', new: 'false ||' },
    { id: 'C19 a fed failure reads as passed', old: "passed: target.verdict === 'passed'", new: 'passed: true' },
    { id: 'C20 an open spot round opens another spot round', old: 'if (openRound !== undefined || i.idle', new: 'if (i.idle' },
    { id: 'C21 a compaction does not reset the baseline', old: "r.kind === 'spot' || r.kind === 'compaction'", new: "r.kind === 'spot'" },
    { id: 'C22 an unmeasured baseline read as zero', old: 'baseline !== null && depth - baseline', new: 'depth - (baseline ?? 0)' },
    { id: 'C23 an open spot round not superseded', old: 'supersedes: openRound?.roundId ?? null', new: 'supersedes: null' },
    { id: 'C24 a compaction round without its depth', old: "kind: 'compaction' as const, depthTokens: depth ?? 0", new: "kind: 'compaction' as const, depthTokens: null" },
    { id: 'C27 a compaction round with no newer reading leaves the baseline unmeasured (review 2068 F1)', old: 'depthTokens: depth ?? 0', new: 'depthTokens: depth' },
    { id: 'C28 a stalled compaction round asked again (review 2068 F4)', old: 'if (compactionDue && !i.compactionStalled) return compaction;', new: 'if (compactionDue) return compaction;' },
    { id: 'C29 a stalled compaction round holds the spot branch (review 2068 F4)', old: 'if (compactionDue && !i.compactionStalled) return compaction;', new: 'if (compactionDue) return i.compactionStalled ? none : compaction;' },
    { id: 'C30 the spot depth read from any fresh reading (review 2068 F1)', old: 'const depth = ctxSinceCompaction(i.ctx, i.compactedAt, i.compactionInFlight);', new: "const depth = i.ctx.kind === 'measured' ? i.ctx.value.tokens : null;" },
    { id: 'C32 a stalled compaction keeps the old baseline (review 2103 F1)', old: ' && (after === null || r.askedAt > after)', new: '' },
    { id: 'C33 marks before the stalled compaction kept', old: 'r.askedAt > after', new: 'r.askedAt < after' },
    { id: 'C34 the baseline narrowed with no compaction due', old: 'const after = compactionDue && ', new: 'const after = ' },
    { id: 'C35 in flight not passed on (review 2103 F2)', old: 'ctxSinceCompaction(i.ctx, i.compactedAt, i.compactionInFlight)', new: "ctxSinceCompaction(i.ctx, i.compactedAt, { kind: 'measured', value: false })" },
    { id: 'C31 a stalled flag stalls any round', old: 'if (compactionDue && !i.compactionStalled) return compaction;', new: 'if (i.compactionStalled) return none;\n  if (compactionDue) return compaction;' },
    { id: 'C25 a start round counts as a mark', old: "r.kind === 'spot' || r.kind === 'compaction'", new: 'true' },
    { id: 'C26 spot rounds opened in probing', old: "    if (isOpen) return none;\n", new: "    if (isOpen && i.rounds.some((r) => r.answeredAt === null && r.kind !== 'spot')) return none;\n" },
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
    { id: 'T7 the timers unmeasured', old: 'timers: read([]),', new: "timers: { kind: 'unmeasured', what: 'x' }," },
  ],
  suite: spotFactsOfCases,
};

const ROUND_SNAPSHOT_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'R1 a spot round drawn from a snapshot', old: "if (kind === 'spot') return measured(null);", new: '' },
    { id: 'R2 a start round drawn from the newest read', old: "if (kind === 'start') return measured(carded);", new: '' },
    { id: 'R3 a failed read taken as the carded snapshot', old: 'if (newestRead.kind !== \'measured\') return newestRead;', new: 'if (newestRead.kind !== \'measured\') return measured(carded);' },
    { id: 'R4 no read since leaves no snapshot', old: 'newestRead.value ?? carded', new: 'newestRead.value' },
    { id: 'R5 a compaction round drawn from the carded snapshot', old: 'measured(newestRead.value ?? carded)', new: 'measured(carded)' },
  ],
  suite: roundSnapshotOfCases,
};

const EMPTY_TRY_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'E1 a spot try keyed by its exact depth', old: 'Math.floor((depthTokens ?? 0) / SPOT_PROBE_EVERY_TOKENS)', new: '(depthTokens ?? 0)' },
    { id: 'E2 a try keyed without its kind', old: "`${kind}:${snapshotId ?? ''}`", new: "`${snapshotId ?? ''}`" },
    { id: 'E3 a try keyed without its snapshot', old: "`${kind}:${snapshotId ?? ''}`", new: '`${kind}:`' },
    { id: 'E4 a spot try keyed like a snapshot try', old: "if (kind !== 'spot') return", new: 'if (true) return' },
    { id: 'E5 the notes not counted (review 2068 F5)', old: 'rows(drawn?.notes) + ', new: '' },
    { id: 'E6 the mail not counted (review 2068 F5)', old: ' + rows(drawn?.mailOutstanding)', new: '' },
    { id: 'E7 a spot try keyed without its rows (review 2068 F5)', old: ':${rows(drawn?.notes) + rows(drawn?.mailOutstanding)}`', new: '`' },
    { id: 'E8 a spot try keyed without its step', old: '`spot:${Math.floor((depthTokens ?? 0) / SPOT_PROBE_EVERY_TOKENS)}:', new: '`spot:' },
  ],
  suite: emptyTryKeyCases,
};

const CTX_SINCE_SET: MutantSet<ProbeScheduleModule> = {
  modulePath: SCHEDULE,
  mutants: [
    { id: 'X1 a reading at the compaction line counts', old: 'ctx.value.at > compactedAt.value', new: 'ctx.value.at >= compactedAt.value' },
    { id: 'X2 an older reading counts', old: 'compactedAt.value === null || ctx.value.at > compactedAt.value ? ctx.value.tokens : null', new: 'ctx.value.tokens' },
    { id: 'X3 unread lines read as no compaction', old: "if (ctx.kind !== 'measured' || compactedAt.kind !== 'measured') return null;", new: "if (ctx.kind !== 'measured') return null;\n  if (compactedAt.kind !== 'measured') return ctx.value.tokens;" },
    { id: 'X4 no compaction on record reads nothing', old: 'compactedAt.value === null || ', new: '' },
    { id: 'X6 a compaction in flight ignored (review 2103 F2)', old: "if (inFlight.kind !== 'measured' || inFlight.value) return null;", new: '' },
    { id: 'X7 an unmeasured in-flight read as settled', old: "inFlight.kind !== 'measured' || inFlight.value", new: "inFlight.kind === 'measured' && inFlight.value" },
    { id: 'X5 an unmeasured reading read as zero', old: "if (ctx.kind !== 'measured' || compactedAt.kind !== 'measured') return null;", new: "if (ctx.kind !== 'measured' || compactedAt.kind !== 'measured') return 0;" },
  ],
  suite: ctxSinceCompactionCases,
};

const BEGUN_SINCE_SET: MutantSet<CompactionsModule> = {
  modulePath: COMPACTIONS,
  mutants: [
    { id: 'B1 every post since counted', old: 'return compactionsSince(lines, from) - compactionsSince(lines.filter((l) => l.at < sinceMs), from);', new: 'return compactionsSince(lines, sinceMs);' },
    { id: 'B2 no lookback window', old: 'const from = sinceMs - COMPACTION_PAIR_MS;', new: 'const from = sinceMs;' },
    { id: 'B3 the line at the start taken as before', old: 'lines.filter((l) => l.at < sinceMs)', new: 'lines.filter((l) => l.at <= sinceMs)' },
    { id: 'B4 everything before the window kept', old: 'return compactionsSince(lines, from) - ', new: 'return compactionsSince(lines, 0) - ' },
  ],
  suite: compactionsBegunSinceCases,
};

const IN_FLIGHT_SET: MutantSet<CompactionsModule> = {
  modulePath: COMPACTIONS,
  mutants: [
    { id: 'I1 a settling post ignored', old: ' && !posts.some((q) => pairs(p, q))', new: '' },
    { id: 'I2 a pre at the window edge in flight', old: 'nowMs - p.at < COMPACTION_PAIR_MS', new: 'nowMs - p.at <= COMPACTION_PAIR_MS' },
    { id: 'I3 any scope counted', old: "const main = lines.filter((l) => l.scope === 'main');", new: 'const main = lines;' },
    { id: 'I4 an old pre in flight', old: 'nowMs - p.at < COMPACTION_PAIR_MS && ', new: '' },
    { id: 'I5 a refused line read as a pre', old: "p.phase === 'pre' && nowMs", new: "p.phase !== 'post' && nowMs" },
  ],
  suite: compactionInFlightCases,
};

const NEWEST_COMPACTION_SET: MutantSet<CompactionsModule> = {
  modulePath: COMPACTIONS,
  mutants: [
    { id: 'N1 a subagent line counted', old: "l.scope === 'main' && l.phase !== 'refused'", new: "l.phase !== 'refused'" },
    { id: 'N2 a refused line counted', old: "l.scope === 'main' && l.phase !== 'refused'", new: "l.scope === 'main'" },
    { id: 'N3 the oldest line', old: 'Math.max(...ats)', new: 'Math.min(...ats)' },
    { id: 'N4 no line reads as zero', old: 'ats.length === 0 ? null', new: 'ats.length === 0 ? 0' },
  ],
  suite: newestCompactionAtCases,
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
    { id: 'N29 a timer without an id', old: 'isObj(x) && num(x.id) && num(x.dueAt)', new: 'isObj(x) && num(x.dueAt)' },
    { id: 'N30 a timer without a due time', old: 'num(x.id) && num(x.dueAt) && str(x.preview)', new: 'num(x.id) && str(x.preview)' },
    { id: 'N31 a timer without a preview', old: 'num(x.dueAt) && str(x.preview)', new: 'num(x.dueAt)' },
    { id: 'N32 a timer run of any shape', old: '(x.runId === null || num(x.runId))', new: 'true' },
    { id: 'N33 a timer programme of any shape', old: '(x.programme === null || str(x.programme))', new: 'true' },
    { id: 'N34 timer rows not checked', old: "    timers: fact('timers', listOf(", new: "    timers: fact('timers', (x: unknown) => Array.isArray(x) || listOf(" },
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
  'server/src/continuity/probeSchedule.ts#roundSnapshotOf': ROUND_SNAPSHOT_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#emptyTryKey': EMPTY_TRY_SET as MutantSet<never>,
  'server/src/continuity/card.ts#snapshotFactsOf': SNAPSHOT_FACTS_SET as MutantSet<never>,
  'server/src/continuity/probeSchedule.ts#ctxSinceCompaction': CTX_SINCE_SET as MutantSet<never>,
  'server/src/continuity/compactions.ts#compactionsBegunSince': BEGUN_SINCE_SET as MutantSet<never>,
  'server/src/continuity/compactions.ts#newestCompactionAt': NEWEST_COMPACTION_SET as MutantSet<never>,
  'server/src/continuity/compactions.ts#compactionInFlight': IN_FLIGHT_SET as MutantSet<never>,
};
