// The probes' oracles and mutant sets (Overlord W1a probes, PR A: w1a-probes.md, Tasks 1 to 3; fix round 1 from review
// 1999). Each decider's cases are written ONCE here, as suite cases over a module: `continuity-probes.test.ts` runs them
// against the real module, and `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run
// floors).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { CardFacts, CardItem, CardNote, Fact } from '../../../shared/continuity-card.js';
import { FLEET_ROLES } from '../../../shared/fleetRoles.js';
import { fakeTime } from '../fakeTime.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type ProbesModule = typeof import('../../src/continuity/probes.js');
type Question = ReturnType<ProbesModule['probeRound']>['questions'][number];
type Spot = Parameters<ProbesModule['fittedCeiling']>[0][number];
type Ceiling = ReturnType<ProbesModule['fittedCeiling']>;

const AT = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60_000;
const SEEDS = Array.from({ length: 48 }, (_, i) => i + 1);
const entropy = (seed: number) => fakeTime({ seed }).ports.entropy;
const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
const item = (id: number, over: Partial<CardItem> = {}): CardItem => ({
  id, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: AT - 30 * MIN, text: `item ${id}`,
  everTicked: false, held: false, ...over,
});

/** A coordinator that holds nothing, every read answered. */
function empty(over: Partial<CardFacts> = {}): CardFacts {
  return {
    sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'it claims a run', at: AT,
    runs: read([]), ledger: read([]), claims: read([]), intent: read(true), itemsRaised: read([]),
    mailOutstanding: read([]), mailMore: false, notes: read([]), checkpoint: read(null),
    history: read({ verb: 'ccrc history describe', node: null }), ...over,
  };
}

const run = (id: number, programme: string, state: string, planPath: string | null = null) =>
  ({ id, programme, wave: 1, waveOf: 3, state, planPath, kind: 'work' });
const mail = (deliveryId: number, at: number) => ({ deliveryId, fromId: 'lane-a-project-a', at, subject: `m${deliveryId}`, parked: false });

const note = (id: number, at: number, next: string): CardNote =>
  ({ id, at, kind: 'thread', key: 'run 41', keyFact: 'live', waitsOn: 'the review of wave 2', next });
const NOTES: readonly CardNote[] = [
  note(61, AT - 40 * MIN, 'merge wave 2, then open wave 3'),
  note(62, AT - 20 * MIN, 'ask the operator about the floor'),
  note(63, AT - 9 * MIN, 'dispatch the review run'),
];
/** Two open runs of two programmes and a closed one, two claimed paths, three deliveries, three notes. Items: 7 and 9
 *  open and never ticked; 10 open but ticked and returned (it carries a ruling); 8 done; 12 withdrawn, never ticked. */
const RICH = empty({
  runs: read([run(41, 'prog-a', 'working', 'docs/superpowers/plans/prog-a.md'), run(42, 'prog-b', 'dispatched'),
    run(30, 'prog-a', 'done')]),
  claims: read([{ id: 1, paths: ['server/src/a.ts', 'shared/b.ts'], runId: 41 }]),
  itemsRaised: read([item(7, { at: AT - 30 * MIN }), item(8, { state: 'done', everTicked: true, at: AT - 10 * MIN }),
    item(12, { state: 'withdrawn', at: AT - 50 * MIN })]),
  mailOutstanding: read([mail(501, AT - 5 * MIN), mail(502, AT - 2 * MIN), mail(503, AT - 8 * MIN)]),
  ledger: read([{ slug: 'prog-a', goals: [], openItems: [item(9), item(10, { everTicked: true })], decisions: [] }]),
  notes: read(NOTES),
});
/** Fact and abstention only: two open runs, one open item, no claims, no notes. */
const THIN = empty({ runs: read([run(41, 'prog-a', 'working'), run(42, 'prog-b', 'working')]), itemsRaised: read([item(7)]) });
const HELD = ['server/src/a.ts', 'shared/b.ts'];

const COORD_SET: readonly string[] = FLEET_ROLES.coordinator.probeSet;
const idOf = (q: Question): number => Number(/item (\d+)\?$/.exec(q.text)![1]);
const one = (qs: readonly Question[], cls: string): Question => {
  const hits = qs.filter((q) => q.cls === cls);
  expect(hits.length, cls).toBe(1);
  return hits[0]!;
};

export function probeRoundCases(m: ProbesModule): Record<string, SuiteCase> {
  const round = (s: CardFacts, seed: number, kind: 'start' | 'compaction' | 'spot' = 'start') =>
    m.probeRound('coordinator', s, entropy(seed), kind);
  return {
    "every seed: a coordinator's round asks three to five, from its own classes, each expected among its choices or none": () => {
      for (const seed of SEEDS) {
        const r = round(RICH, seed);
        expect(r.questions.length, String(seed)).toBeGreaterThanOrEqual(3);
        expect(r.questions.length, String(seed)).toBeLessThanOrEqual(5);
        expect([r.short, r.unmeasured]).toEqual([false, false]);
        expect(r.questions.map((q) => q.id)).toEqual(r.questions.map((_, i) => `p${i + 1}`));
        expect(new Set(r.questions.map((q) => `${q.cls} ${q.text}`)).size).toBe(r.questions.length);
        for (const q of r.questions) {
          expect(COORD_SET).toContain(q.cls);
          if (q.choices === null) expect([q.cls, q.expected]).toEqual(['abstention', 'none']);
          else {
            expect(q.choices, q.text).toContain(q.expected);
            expect(new Set(q.choices.map((c) => c.trim().toLowerCase())).size, q.text).toBe(q.choices.length);
            expect(q.choices.length, q.text).toBeGreaterThanOrEqual(3);
          }
        }
      }
    },
    'one question per class the snapshot supports; the run question expects the open run, the temporal the newest row': () => {
      for (const seed of SEEDS) {
        const qs = round(RICH, seed).questions;
        for (const cls of ['temporal', 'abstention', 'continuation']) one(qs, cls);
        expect(qs.filter((q) => q.cls === 'fact').length).toBeGreaterThanOrEqual(1);
        for (const q of qs) {
          if (q.text.endsWith('programme `prog-a`?')) expect([q.expected, q.choices!.includes('30')]).toEqual(['41', false]);
          if (q.text.endsWith('programme `prog-b`?')) expect(q.expected).toBe('42');
          if (q.text.startsWith('Which of these deliveries')) expect([q.text, q.expected]).toEqual(['Which of these deliveries was sent last?', '502']);
          if (q.text.startsWith('Which of these items did you raise')) expect(q.expected).toBe('8');
          if (q.text.startsWith('Which of these notes')) expect(q.expected).toBe('63');
          if (q.cls === 'continuation') {
            const n = NOTES.find((x) => q.text === `What does your note ${x.id} say comes next?`)!;
            expect(q.expected).toBe(n.next);
          }
        }
      }
    },
    'the claim question: one choice is held, and no decoy folds equal to or under a held path (review 1999, F5)': () => {
      const caseOnly = empty({ claims: read([{ id: 1, paths: ['a/x.ts', 'b/X.ts', 'c/y.ts'], runId: null }]) });
      const folded = ['a/x.ts', 'b/x.ts', 'c/y.ts'];
      let asked = 0;
      let lookAlike = 0;
      for (const seed of SEEDS) {
        for (const q of round(RICH, seed).questions.filter((x) => x.text.includes('hold a claim'))) {
          asked++;
          expect(HELD).toContain(q.expected);
          expect(q.choices!.filter((c) => HELD.includes(c))).toEqual([q.expected]);
        }
        for (const q of round(caseOnly, seed).questions.filter((x) => x.text.includes('hold a claim'))) {
          asked++;
          expect(new Set(q.choices!.map((c) => c.trim().toLowerCase())).size, q.choices!.join(' ')).toBe(q.choices!.length);
          if (q.choices!.some((c) => c.toLowerCase() === 'c/x.ts')) lookAlike++;
          for (const c of q.choices!.filter((x) => x !== q.expected)) {
            expect(folded.some((h) => c.toLowerCase() === h || c.toLowerCase().startsWith(`${h}/`)), c).toBe(false);
            expect(m.gradeProbe(q, c), c).toBe('fail');
          }
        }
      }
      expect(asked).toBeGreaterThan(SEEDS.length);
      // `c/x.ts` and `c/X.ts` are both decoys that pass the held-path filter; only the fold dedupe keeps them apart.
      expect(lookAlike).toBeGreaterThan(SEEDS.length / 4);
    },
    'a snapshot that supports only fact and abstention is topped up from fact to three': () => {
      for (const seed of SEEDS) {
        const r = round(THIN, seed);
        expect(r.questions.map((q) => q.cls).sort()).toEqual(['abstention', 'fact', 'fact']);
        expect(r.short).toBe(false);
        expect(r.skipped.map((s) => s.cls).sort()).toEqual(['continuation', 'temporal']);
      }
    },
    'an abstention question names an open, never-ticked item of the record, and never an id the snapshot lacks (F2)': () => {
      for (const seed of SEEDS) expect([7, 9]).toContain(idOf(one(round(RICH, seed).questions, 'abstention')));
      const noneOpen = round(empty({ itemsRaised: read([item(8, { state: 'done', everTicked: true }), item(10, { everTicked: true })]) }), 1);
      expect(noneOpen.questions.filter((q) => q.cls === 'abstention')).toEqual([]);
      expect(noneOpen.skipped.find((s) => s.cls === 'abstention'))
        .toEqual({ cls: 'abstention', why: 'no open item on your record that was never ticked', unmeasured: false });
      // review 2001, F-D: the ledger still shows item 9 open, the items raised show it ticked; the items raised win, as on the card.
      const race = empty({ ledger: read([{ slug: 'prog-a', goals: [], openItems: [item(9)], decisions: [] }]),
        itemsRaised: read([item(9, { state: 'checking', everTicked: true })]) });
      for (const seed of SEEDS) expect(round(race, seed).questions.filter((q) => q.cls === 'abstention')).toEqual([]);
    },
    'a snapshot with no runs yields the abstention question and says the round is short': () => {
      const r = round(empty({ itemsRaised: read([item(7)]) }), 3);
      expect(r.questions.map((q) => [q.cls, q.choices, q.expected])).toEqual([['abstention', null, 'none']]);
      expect([r.short, r.unmeasured]).toEqual([true, false]);
      expect(r.skipped.map((s) => s.cls).sort()).toEqual(['continuation', 'fact', 'temporal']);
      for (const s of r.skipped) expect([s.why.length > 0, s.unmeasured]).toEqual([true, false]);
    },
    'a failed read is named, never taken for an empty one, and the round it made short is unmeasured (F4)': () => {
      const all = empty({ runs: unmeasured('the runs'), ledger: unmeasured('the ledger'), claims: unmeasured('the claims'),
        itemsRaised: unmeasured('the items raised'), mailOutstanding: unmeasured('the mail'), notes: unmeasured('the notes') });
      const r = round(all, 5);
      expect([r.questions, r.short, r.unmeasured]).toEqual([[], true, true]);
      expect(Object.fromEntries(r.skipped.map((s) => [s.cls, [s.unmeasured, s.why]]))).toEqual({
        fact: [true, 'not read: the runs, the claims'],
        temporal: [true, 'not read: the mail, the items raised, the notes'],
        abstention: [true, 'not read: the ledger, the items raised'],
        continuation: [true, 'not read: the notes'],
      });
      const ledgerOnly = round(empty({ ledger: unmeasured('the ledger') }), 5);
      expect([ledgerOnly.questions, ledgerOnly.unmeasured]).toEqual([[], true]);
      expect(round(empty({ ledger: unmeasured('the ledger'), itemsRaised: read([item(7)]) }), 5).questions.map((q) => q.cls))
        .toEqual(['abstention']);
      // review 2001, F-A: a failed read that only cost the round its top-up still makes the short round unmeasured.
      const lessened = round(empty({ runs: read([run(41, 'prog-a', 'working')]), claims: unmeasured('the claims') }), 5);
      expect([lessened.questions.map((q) => q.cls), lessened.short, lessened.unmeasured]).toEqual([['fact'], true, true]);
      const measured = round(empty(), 5);
      expect([measured.questions, measured.short, measured.unmeasured]).toEqual([[], true, false]);
      expect(measured.skipped.every((s) => !s.unmeasured)).toBe(true);
    },
    'a full round is never unmeasured, though a class it skipped had a failed read (review 2001, F-B)': () => {
      for (const seed of SEEDS) {
        const r = round({ ...RICH, notes: unmeasured('the notes') }, seed);
        expect([r.short, r.unmeasured]).toEqual([false, false]);
        expect(r.skipped.find((x) => x.cls === 'continuation')).toEqual({ cls: 'continuation', why: 'not read: the notes', unmeasured: true });
      }
    },
    'continuation reads the snapshot\'s notes and is skipped with fewer than three of distinct text': () => {
      const twoTexts = [NOTES[0]!, NOTES[1]!, { ...NOTES[2]!, next: ` ${NOTES[0]!.next.toUpperCase()} ` }];
      for (const seed of SEEDS) {
        expect(round({ ...RICH, notes: read(twoTexts) }, seed).questions.filter((q) => q.cls === 'continuation')).toEqual([]);
      }
    },
    'continuation takes only threads with a next act, as subjects and as decoys: a blank answer never passes (review 2039, F1)': () => {
      const caution = { ...note(64, AT - 5 * MIN, ''), kind: 'caution' as const };
      const cautionWithNext = { ...note(65, AT - 4 * MIN, 'escalate to the operator'), kind: 'caution' as const };
      const blank = note(66, AT - 3 * MIN, ' \t ');
      // Only invisible characters: blank too (review 2046, F3).
      const invisible = note(68, AT - 2 * MIN, '\u200b\u2800\u3164');
      const mixed = [...NOTES, caution, cautionWithNext, blank, invisible];
      let asked = 0;
      for (const seed of SEEDS) {
        for (const q of round({ ...RICH, notes: read(mixed) }, seed).questions.filter((x) => x.cls === 'continuation')) {
          asked++;
          expect(NOTES.map((n) => n.next)).toContain(q.expected);
          expect([...q.choices!].sort()).toEqual(NOTES.map((n) => n.next).sort());
          for (const blankAnswer of ['', '   ']) expect(m.gradeProbe(q, blankAnswer)).toBe('fail');
        }
      }
      expect(asked).toBe(SEEDS.length);
      // Two threads with a next act and the rest cautions or blank: no question.
      const thin = [NOTES[0]!, NOTES[1]!, caution, cautionWithNext, blank, { ...blank, id: 67, next: '' }];
      for (const seed of SEEDS) expect(round({ ...RICH, notes: read(thin) }, seed).questions.filter((q) => q.cls === 'continuation')).toEqual([]);
    },
    'temporal is skipped for a family of two rows, which would offer a coin flip': () => {
      const two = empty({ mailOutstanding: read([mail(501, AT - MIN), mail(502, AT)]), itemsRaised: read([item(7), item(8, { at: AT })]) });
      for (const seed of SEEDS) expect(round(two, seed).questions.filter((q) => q.cls === 'temporal')).toEqual([]);
    },
    'temporal is skipped when the newest time is tied': () => {
      const tied = empty({ mailOutstanding: read([mail(501, AT), mail(502, AT), mail(503, AT - MIN)]) });
      for (const seed of SEEDS) expect(round(tied, seed).questions.filter((q) => q.cls === 'temporal')).toEqual([]);
    },
    'a spot round asks one question and is not short': () => {
      for (const seed of SEEDS) {
        const r = round(RICH, seed, 'spot');
        expect([r.kind, r.questions.length, r.short]).toEqual(['spot', 1, false]);
        expect(r.skipped.filter((s) => s.why === 'the round was full').length).toBe(3);
      }
    },
    'a role draws only from its own set: a role that is not long-lived gets nothing': () => {
      for (const role of ['worker', 'reviewer', 'auditor', 'replay', 'plain'] as const) {
        const r = m.probeRound(role, RICH, entropy(1), 'start');
        expect([r.questions, r.skipped, r.short, r.unmeasured], role).toEqual([[], [], true, false]);
      }
      const o = m.probeRound('overlord', RICH, entropy(1), 'start');
      expect(o.questions.length).toBe(4);
      expect(o.skipped.map((s) => s.cls).sort()).toEqual(['application', 'contradiction', 'decision', 'thread', 'update']);
    },
    'the same seed gives the same round; the seed decides the order': () => {
      for (const seed of SEEDS) expect(round(RICH, seed)).toStrictEqual(round(RICH, seed));
      expect(new Set(SEEDS.map((s) => round(RICH, s).questions[0]!.cls)).size).toBeGreaterThan(1);
      expect(new Set(SEEDS.map((s) => JSON.stringify(round(THIN, s).questions))).size).toBeGreaterThan(1);
    },
  };
}

const Q = (over: Partial<Question>): Question => ({ id: 'p1', cls: 'fact', text: 'Which run?', choices: ['41', '42', '43'], expected: '41', ...over });
const ABSTAIN = Q({ cls: 'abstention', text: 'What did the operator rule on item 9?', choices: null, expected: 'none' });
const PATH = Q({ text: 'Which path?', choices: ['server/src/a.ts', 'shared/c.ts', 'server/src/b.ts'], expected: 'server/src/a.ts' });

export function gradeCases(m: ProbesModule): Record<string, SuiteCase> {
  return {
    'the exact id passes, trimmed; a near id fails': () => {
      expect(['41', ' 41 ', '41\n'].map((a) => m.gradeProbe(Q({}), a))).toEqual(['pass', 'pass', 'pass']);
      expect(['4', '411', '42', '', 'run 41'].map((a) => m.gradeProbe(Q({}), a))).toEqual(['fail', 'fail', 'fail', 'fail', 'fail']);
    },
    'ids and choices are case-folded': () => {
      expect(m.gradeProbe(ABSTAIN, ' None ')).toBe('pass');
      expect(m.gradeProbe(ABSTAIN, 'NONE')).toBe('pass');
      expect(m.gradeProbe(PATH, 'Server/Src/A.ts')).toBe('pass');
    },
    'none passes only an abstention question, and a confident wrong id fails one': () => {
      expect(m.gradeProbe(ABSTAIN, 'none')).toBe('pass');
      expect(m.gradeProbe(Q({}), 'none')).toBe('fail');
      expect(m.gradeProbe(PATH, 'none')).toBe('fail');
      expect(m.gradeProbe(ABSTAIN, '9')).toBe('fail');
      expect(m.gradeProbe(ABSTAIN, 'the operator approved it')).toBe('fail');
    },
    'an answer outside the choices fails, even when it is the expected one': () => {
      expect(m.gradeProbe(PATH, 'shared/b.ts')).toBe('fail');
      expect(m.gradeProbe(Q({ choices: ['42', '43', '44'] }), '41')).toBe('fail');
    },
    'a measured round passes only when every answer passed, and asked something': () => {
      expect(m.roundVerdict(['pass', 'pass', 'pass'], false)).toBe('passed');
      expect(m.roundVerdict(['pass', 'fail', 'pass', 'pass'], false)).toBe('failed');
      expect(m.roundVerdict(['fail'], false)).toBe('failed');
      expect(m.roundVerdict([], false)).toBe('failed');
    },
    'a round the failed reads made short is unmeasured, unless an answer it did ask failed (F4b)': () => {
      expect(m.roundVerdict([], true)).toBe('unmeasured');
      expect(m.roundVerdict(['pass', 'pass'], true)).toBe('unmeasured');
      expect(m.roundVerdict(['pass', 'fail'], true)).toBe('failed');
      expect(m.roundVerdict(['fail'], true)).toBe('failed');
    },
    'monotonic: turning a pass into a fail never makes a round pass': () => {
      for (const unm of [false, true]) {
        for (let bits = 0; bits < 32; bits++) {
          const grades = Array.from({ length: 5 }, (_, i) => ((bits >> i) & 1 ? 'pass' : 'fail') as 'pass' | 'fail');
          for (let i = 0; i < 5; i++) {
            if (grades[i] !== 'pass') continue;
            const worse = grades.map((g, j) => (j === i ? 'fail' : g));
            if (m.roundVerdict(worse, unm) === 'passed') expect(m.roundVerdict(grades, unm)).toBe('passed');
            expect(m.roundVerdict(worse, unm)).toBe('failed');
          }
        }
      }
    },
  };
}

const CAP = 250_000;
/** Spot rows carry a time; each new row is later than the one before it. */
let clock = 0;
/** `n` closed-book spot probes at `depth`, the first `fails` of them failed, in time order. */
const spots = (depth: number, n: number, fails = 0, over: Partial<Spot> = {}): Spot[] =>
  Array.from({ length: n }, (_, i) => ({ depthTokens: depth, grade: i < fails ? 'fail' : 'pass', closed: true, modelClass: 'opus',
    at: AT + ++clock, ...over }));
/** Every step up to `steps` holds twenty passes. */
const goodTo = (steps: number, over: Partial<Spot> = {}): Spot[] =>
  Array.from({ length: steps }, (_, k) => spots((k + 1) * 50_000 + 1_234, 20, 0, over)).flat();
const ceiling = (tokens: number, fitted: boolean): Ceiling => ({ kind: 'ceiling', tokens, fitted });
const NO_DEPTH: Ceiling = { kind: 'no-depth-holds' };
/** A ceiling as a number for ordering: no depth holds sits below every ceiling. */
const rank = (c: Ceiling): number => (c.kind === 'ceiling' ? c.tokens : -1);

export function fittedCeilingCases(m: ProbesModule): Record<string, SuiteCase> {
  const fit = (s: readonly Spot[], cap = CAP, cls = 'opus') => m.fittedCeiling(s, cls, cap);
  return {
    'no probes: the hard cap, not fitted': () => {
      expect(fit([])).toStrictEqual(ceiling(CAP, false));
    },
    "the plan's example: 20 passes at 50k and 100k, 18 of 20 at 150k fits 100k": () => {
      expect(fit([...goodTo(2), ...spots(150_000, 20, 2)])).toStrictEqual(ceiling(100_000, true));
    },
    'exactly the pass rate is good: 19 of 20 at every step below the cap fits the hard cap (F6)': () => {
      const all = Array.from({ length: 4 }, (_, k) => spots((k + 1) * 50_000, 20, 1)).flat();
      expect(fit(all)).toStrictEqual(ceiling(CAP, true));
      expect(fit(goodTo(4))).toStrictEqual(ceiling(CAP, true));
      expect(fit(goodTo(3))).toStrictEqual(ceiling(CAP, false));
    },
    'a bad first step: no depth holds, never a number (F3)': () => {
      expect(fit(spots(50_000, 20, 5))).toStrictEqual(NO_DEPTH);
      expect(fit([...spots(50_000, 20, 2), ...goodTo(4).slice(20)])).toStrictEqual(NO_DEPTH);
    },
    'a bad depth caps the ceiling at any depth; a short one below it only unfits it (F7)': () => {
      const below = [...goodTo(1), ...spots(100_000, 19), ...spots(150_000, 20, 20)];
      expect(fit(below)).toStrictEqual(ceiling(100_000, false));
      expect(fit([...below, ...spots(100_000, 1)])).toStrictEqual(ceiling(100_000, true));
      expect(fit([...spots(100_000, 20, 20)])).toStrictEqual(ceiling(50_000, false));
    },
    'the window is the last twenty by time: old fails age out': () => {
      expect(fit([...spots(50_000, 10, 10), ...goodTo(4)])).toStrictEqual(ceiling(CAP, true));
      expect(fit([...goodTo(4), ...spots(50_000, 2, 2)])).toStrictEqual(NO_DEPTH);
    },
    'the rows may come in any order: newest first gives the same ceiling (F8)': () => {
      const s = [...spots(50_000, 10, 10), ...goodTo(4)];
      expect(fit([...s].reverse())).toStrictEqual(ceiling(CAP, true));
      const t = [...goodTo(4), ...spots(50_000, 2, 2)];
      expect(fit([...t].reverse())).toStrictEqual(NO_DEPTH);
    },
    'another model class: the hard cap, even when this one is fitted': () => {
      const s = [...goodTo(2), ...spots(150_000, 20, 2)];
      expect(fit(s, CAP, 'sonnet')).toStrictEqual(ceiling(CAP, false));
      expect(fit([...goodTo(4), ...spots(150_000, 20, 20, { modelClass: 'sonnet' })])).toStrictEqual(ceiling(CAP, true));
    },
    'open-book probes do not count': () => {
      expect(fit([...goodTo(4), ...spots(150_000, 20, 20, { closed: false })])).toStrictEqual(ceiling(CAP, true));
      expect(fit(goodTo(4, { closed: false }))).toStrictEqual(ceiling(CAP, false));
    },
    'never above the hard cap: a lower cap stops the walk there': () => {
      expect(fit([...goodTo(4), ...spots(250_000, 20, 20)], 120_000)).toStrictEqual(ceiling(120_000, true));
      expect(fit([...goodTo(2), ...spots(150_000, 20, 20)], 120_000)).toStrictEqual(ceiling(120_000, true));
    },
    'a cap at or below the first step examines no bucket and is not fitted (F6)': () => {
      expect(fit([], 40_000)).toStrictEqual(ceiling(40_000, false));
      expect(fit(goodTo(4), 50_000)).toStrictEqual(ceiling(50_000, false));
    },
    'depths below the first step are not a bucket': () => {
      expect(fit([...spots(10_000, 20, 20), ...goodTo(4)])).toStrictEqual(ceiling(CAP, true));
    },
    'monotonic: adding a closed-book fail never raises the ceiling, and it never exceeds the hard cap': () => {
      for (const seed of SEEDS) {
        const e = entropy(seed);
        const s: Spot[] = Array.from({ length: 120 + e.below(80) }, (_, i) => ({
          depthTokens: (1 + e.below(6)) * 50_000 + e.below(50_000), grade: e.below(100) < 97 ? 'pass' : 'fail',
          closed: e.below(10) > 0, modelClass: e.below(5) > 0 ? 'opus' : 'sonnet', at: i * 10,
        }));
        const before = fit(s);
        expect(rank(before)).toBeLessThanOrEqual(CAP);
        const fail: Spot = { depthTokens: (1 + e.below(5)) * 50_000, grade: 'fail', closed: true, modelClass: 'opus', at: e.below(s.length * 10 + 10) };
        expect(rank(fit([...s, fail])), String(seed)).toBeLessThanOrEqual(rank(before));
      }
    },
  };
}

const MODULE = path.join(ROOT, 'server/src/continuity/probes.ts');

/** `probeRound`'s mutants (the plan's four, and the rest from review 1999's findings). */
const PROBE_ROUND_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'R1 skip the top-up', old: 'while (drafts.length < least && factRest.length > 0)', new: 'while (false && factRest.length > 0)' },
    { id: 'R2 expected outside choices', old: 'expected: String(r.id),', new: 'expected: String(r.id + 1000),' },
    { id: 'R3 a class the role lacks', old: 'shuffle(FLEET_ROLES[role].probeSet, entropy)', new: 'shuffle(FLEET_ROLES.overlord.probeSet, entropy)' },
    { id: 'R4 ignore the seed', old: 'const j = entropy.below(i + 1);', new: 'const j = i;' },
    { id: 'R5 abstention on a closed item', old: "[...byId.values()].filter((i) => i.state === 'open' && !i.everTicked)", new: '[...byId.values()].filter((i) => !i.everTicked)' },
    { id: 'R6 abstention on a ticked item', old: "[...byId.values()].filter((i) => i.state === 'open' && !i.everTicked)", new: "[...byId.values()].filter((i) => i.state === 'open')" },
    { id: 'R7 a spot round of three', old: "kind === 'spot' ? [1, 1]", new: "kind === 'spot' ? [3, 5]" },
    { id: 'R8 a held decoy', old: '.filter((p) => !heldFolded.some((h) => under(fold(p), h)))', new: '' },
    { id: 'R9 a decoy unfolded', old: '.filter((p) => !heldFolded.some((h) => under(fold(p), h)))', new: '.filter((p) => !held.some((h) => under(p, h)))' },
    { id: 'R10 continuation with two texts', old: 'if (distinct.length < 2) continue;', new: 'if (distinct.length < 1) continue;' },
    { id: 'R21 continuation over cautions', old: ".filter((n) => n.kind === 'thread' && !isBlankText(n.next))", new: '.filter((n) => !isBlankText(n.next))' },
    { id: 'R22 continuation over a blank next', old: ".filter((n) => n.kind === 'thread' && !isBlankText(n.next))", new: ".filter((n) => n.kind === 'thread')" },
    { id: 'R23 continuation over an invisible next', old: ".filter((n) => n.kind === 'thread' && !isBlankText(n.next))", new: ".filter((n) => n.kind === 'thread' && fold(n.next) !== '')" },
    { id: 'R11 temporal with a tied newest', old: 'if (top.length !== 1) continue;', new: '' },
    { id: 'R12 temporal with two rows', old: 'f.rows.length < 3 ||', new: 'f.rows.length < 2 ||' },
    { id: 'R13 a failed read taken for empty', old: 'unreadOf(s.runs, s.claims))', new: '[])' },
    { id: 'R17 a failed read hidden once the class drafted', old: 'unreadOf(s.runs, s.claims))', new: 'drafts.length > 0 ? [] : unreadOf(s.runs, s.claims))' },
    { id: 'R14 the skip unmarked', old: 'unmeasured: p.unread.length > 0 }', new: 'unmeasured: false }' },
    { id: 'R15 every short round unmeasured', old: 'unmeasured: short && unread.size > 0', new: 'unmeasured: short' },
    { id: 'R18 a full round unmeasured', old: 'unmeasured: short && unread.size > 0', new: 'unmeasured: unread.size > 0' },
    { id: 'R19 look-alike decoys kept', old: '.filter((p, i, all) => all.findIndex((x) => fold(x) === fold(p)) === i)', new: '' },
    { id: 'R20 the ledger row wins', old: 'for (const p of valueOf(s.ledger) ?? []) for (const i of p.openItems) byId.set(i.id, i);\n  for (const i of valueOf(s.itemsRaised) ?? []) byId.set(i.id, i);', new: 'for (const i of valueOf(s.itemsRaised) ?? []) byId.set(i.id, i);\n  for (const p of valueOf(s.ledger) ?? []) for (const i of p.openItems) byId.set(i.id, i);' },
    { id: 'R16 the mail word', old: "'Which of these deliveries was sent last?'", new: "'Which of these deliveries reached you last?'" },
  ],
  suite: probeRoundCases,
};

/** `gradeProbe`'s and `roundVerdict`'s mutants (the plan's three, and the rest). */
const GRADE_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'G1 drop the case-fold', old: 'const fold = (t: string): string => t.trim().toLowerCase();', new: 'const fold = (t: string): string => t.trim();' },
    { id: 'G2 none passes any question', old: 'if (q.choices !== null && !q.choices', new: "if (fold(answer) === 'none') return 'pass';\n  if (q.choices !== null && !q.choices" },
    { id: 'G3 a round on most passes', old: "if (grades.some((g) => g === 'fail')) return 'failed';", new: "if (grades.filter((g) => g === 'fail').length * 2 > grades.length) return 'failed';" },
    { id: 'G4 the choices unchecked', old: "if (q.choices !== null && !q.choices.some((c) => fold(c) === fold(answer))) return 'fail';", new: '' },
    { id: 'G5 an empty round passes', old: "return grades.length > 0 ? 'passed' : 'failed';", new: "return 'passed';" },
    { id: 'G6 unmeasured ignored', old: "if (unmeasured) return 'unmeasured';", new: '' },
    { id: 'G7 unmeasured hides a fail', old: "if (grades.some((g) => g === 'fail')) return 'failed';\n  if (unmeasured) return 'unmeasured';", new: "if (unmeasured) return 'unmeasured';\n  if (grades.some((g) => g === 'fail')) return 'failed';" },
  ],
  suite: gradeCases,
};

/** `fittedCeiling`'s mutants (the plan's four, and the rest from review 1999's findings). */
const FITTED_CEILING_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'F1 >= to >', old: '/ FIT_WINDOW < FIT_PASS_RATE)', new: '/ FIT_WINDOW <= FIT_PASS_RATE)' },
    { id: 'F2 count open-book', old: 's.closed && s.modelClass === modelClass', new: 's.modelClass === modelClass' },
    { id: 'F3 ignore the model class', old: 's.closed && s.modelClass === modelClass', new: 's.closed' },
    { id: 'F4 past the hard cap', old: 'k * SPOT_PROBE_EVERY_TOKENS < hardCap; k++', new: 'k * SPOT_PROBE_EVERY_TOKENS < hardCap + 3 * SPOT_PROBE_EVERY_TOKENS; k++' },
    { id: 'F5 the first twenty, not the last', old: 'grades.slice(-FIT_WINDOW)', new: 'grades.slice(0, FIT_WINDOW)' },
    { id: 'F6 a short bucket judged', old: 'if (grades.length < FIT_WINDOW) {', new: 'if (grades.length < 1) {' },
    { id: 'F7 no depth holds as zero', old: "k === 1 ? { kind: 'no-depth-holds' } : ", new: '' },
    { id: "F8 the caller's order", old: '.sort((a, b) => a.at - b.at)', new: '' },
    { id: 'F9 the bucket at the cap required', old: 'k * SPOT_PROBE_EVERY_TOKENS < hardCap; k++', new: 'k * SPOT_PROBE_EVERY_TOKENS <= hardCap; k++' },
    { id: 'F10 fitted with nothing examined', old: 'fitted: fitted && examined > 0', new: 'fitted: fitted' },
    { id: 'F11 a short bucket below stays fitted', old: 'fitted = false;\n      continue;', new: 'continue;' },
  ],
  suite: fittedCeilingCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const PROBE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/probes.ts#probeRound': PROBE_ROUND_SET as MutantSet<never>,
  'server/src/continuity/probes.ts#gradeProbe': GRADE_SET as MutantSet<never>,
  'server/src/continuity/probes.ts#fittedCeiling': FITTED_CEILING_SET as MutantSet<never>,
};
