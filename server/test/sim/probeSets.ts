// The probes' oracles and mutant sets (Overlord W1a probes, PR A: w1a-probes.md, Tasks 1 to 3). Each decider's cases are
// written ONCE here, as suite cases over a module: `continuity-probes.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors).
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

const AT = Date.UTC(2026, 10, 14, 12, 0, 0);
const MIN = 60_000;
const SEEDS = Array.from({ length: 48 }, (_, i) => i + 1);
const entropy = (seed: number) => fakeTime({ seed }).ports.entropy;
const read = <T>(value: T): Fact<T> => ({ kind: 'read', value });
const unmeasured = (what: string): Fact<never> => ({ kind: 'unmeasured', what });
const item = (id: number, over: Partial<CardItem> = {}): CardItem => ({
  id, programme: 'prog-a', kind: 'decide', state: 'open', neededBy: 'soon', at: AT - 30 * MIN, text: `item ${id}`, ...over,
});

/** A coordinator that holds nothing, every read answered. */
function empty(over: Partial<CardFacts> = {}): CardFacts {
  return {
    sessionId: 'lane-a-project-a', role: 'coordinator', roleWhy: 'it claims a run', at: AT,
    runs: read([]), ledger: read([]), claims: read([]), intent: read(true), itemsRaised: read([]),
    mailOutstanding: read([]), notes: read([]), checkpoint: read(null),
    history: read({ verb: 'ccrc history describe', node: null }), ...over,
  };
}

const run = (id: number, programme: string, state: string, planPath: string | null = null) =>
  ({ id, programme, wave: 1, waveOf: 3, state, planPath, kind: 'work' });

/** Two open runs of two programmes and a closed one, two claimed paths, items open and done (two: too few to order),
 *  three deliveries. */
const RICH = empty({
  runs: read([run(41, 'prog-a', 'working', 'docs/superpowers/plans/prog-a.md'), run(42, 'prog-b', 'dispatched'),
    run(30, 'prog-a', 'done')]),
  claims: read([{ id: 1, paths: ['server/src/a.ts', 'shared/b.ts'], runId: 41 }]),
  itemsRaised: read([item(7, { at: AT - 30 * MIN }), item(8, { state: 'done', at: AT - 10 * MIN })]),
  mailOutstanding: read([{ deliveryId: 501, fromId: 'lane-a-project-a', at: AT - 5 * MIN, subject: 'a' },
    { deliveryId: 502, fromId: 'lane-a-project-a', at: AT - 2 * MIN, subject: 'b' },
    { deliveryId: 503, fromId: 'lane-a-project-a', at: AT - 8 * MIN, subject: 'c' }]),
  ledger: read([{ slug: 'prog-a', goals: [], openItems: [item(9)], decisions: [] }]),
});
const NOTES: readonly CardNote[] = [
  { id: 61, at: AT - 40 * MIN, text: 'merge wave 2, then open wave 3' },
  { id: 62, at: AT - 20 * MIN, text: 'ask the operator about the floor' },
  { id: 63, at: AT - 9 * MIN, text: 'dispatch the review run' },
];
/** Fact and abstention only: two open runs, no claims, no timed rows, no notes. */
const THIN = empty({ runs: read([run(41, 'prog-a', 'working'), run(42, 'prog-b', 'working')]) });

const COORD_SET: readonly string[] = FLEET_ROLES.coordinator.probeSet;
const idOf = (q: Question): number => Number(/item (\d+)\?$/.exec(q.text)![1]);
const one = (qs: readonly Question[], cls: string): Question => {
  const hits = qs.filter((q) => q.cls === cls);
  expect(hits.length, cls).toBe(1);
  return hits[0]!;
};

export function probeRoundCases(m: ProbesModule): Record<string, SuiteCase> {
  const round = (s: CardFacts, seed: number, notes: readonly CardNote[] = NOTES, kind: 'start' | 'compaction' | 'spot' = 'start') =>
    m.probeRound('coordinator', s, notes, entropy(seed), kind);
  return {
    "every seed: a coordinator's round asks three to five, from its own classes, each expected among its choices or none": () => {
      for (const seed of SEEDS) {
        const r = round(RICH, seed);
        expect(r.questions.length, String(seed)).toBeGreaterThanOrEqual(3);
        expect(r.questions.length, String(seed)).toBeLessThanOrEqual(5);
        expect(r.short).toBe(false);
        expect(r.questions.map((q) => q.id)).toEqual(r.questions.map((_, i) => `p${i + 1}`));
        expect(new Set(r.questions.map((q) => `${q.cls} ${q.text}`)).size).toBe(r.questions.length);
        for (const q of r.questions) {
          expect(COORD_SET).toContain(q.cls);
          if (q.choices === null) expect([q.cls, q.expected]).toEqual(['abstention', 'none']);
          else {
            expect(q.choices, q.text).toContain(q.expected);
            expect(new Set(q.choices).size, q.text).toBe(q.choices.length);
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
          if (q.text.startsWith('Which of these deliveries')) expect(q.expected).toBe('502');
          if (q.text.startsWith('Which of these items did you raise')) expect(q.expected).toBe('8');
          if (q.text.startsWith('Which of these notes')) expect(q.expected).toBe('63');
          if (q.cls === 'continuation') {
            const n = NOTES.find((x) => q.text === `What does your note ${x.id} say comes next?`)!;
            expect(q.expected).toBe(n.text);
          }
        }
      }
    },
    'the claim question: one choice is held, the two decoys are not': () => {
      let asked = 0;
      for (const seed of SEEDS) {
        for (const q of round(RICH, seed).questions.filter((x) => x.text.includes('hold a claim'))) {
          asked++;
          expect(['server/src/a.ts', 'shared/b.ts']).toContain(q.expected);
          expect(q.choices!.filter((c) => c === 'server/src/a.ts' || c === 'shared/b.ts')).toEqual([q.expected]);
        }
      }
      expect(asked).toBeGreaterThan(0);
    },
    'a snapshot that supports only fact and abstention is topped up from fact to three': () => {
      for (const seed of SEEDS) {
        const r = round(THIN, seed, []);
        expect(r.questions.map((q) => q.cls).sort()).toEqual(['abstention', 'fact', 'fact']);
        expect(r.short).toBe(false);
        expect(r.skipped.map((s) => s.cls).sort()).toEqual(['continuation', 'temporal']);
      }
    },
    'an abstention question names an item with no ruling in the snapshot': () => {
      const ruled = [8];
      const known = [7, 8, 9];
      for (const seed of SEEDS) {
        expect([7, 9]).toContain(idOf(one(round(RICH, seed).questions, 'abstention')));
        const unknown = idOf(one(round(empty({ itemsRaised: read([item(8, { state: 'done' })]) }), seed, []).questions, 'abstention'));
        expect(known.includes(unknown) || ruled.includes(unknown)).toBe(false);
      }
    },
    'a snapshot with no runs yields the abstention question and says the round is short': () => {
      const r = round(empty(), 3, []);
      expect(r.questions.map((q) => [q.cls, q.choices, q.expected])).toEqual([['abstention', null, 'none']]);
      expect(r.short).toBe(true);
      expect(r.skipped.map((s) => s.cls).sort()).toEqual(['continuation', 'fact', 'temporal']);
      for (const s of r.skipped) expect(s.why.length).toBeGreaterThan(0);
    },
    'unmeasured reads are skipped, never guessed: no abstention without both item reads': () => {
      const all = empty({ runs: unmeasured('the runs'), ledger: unmeasured('the ledger'), claims: unmeasured('the claims'),
        itemsRaised: unmeasured('the items raised'), mailOutstanding: unmeasured('the mail') });
      const r = round(all, 5, []);
      expect([r.questions, r.short, r.skipped.length]).toEqual([[], true, 4]);
      expect(round(empty({ ledger: unmeasured('the ledger') }), 5, []).questions).toEqual([]);
    },
    'temporal is skipped when the newest time is tied': () => {
      const tied = empty({ mailOutstanding: read([{ deliveryId: 501, fromId: 'lane-a-project-a', at: AT, subject: 'a' },
        { deliveryId: 502, fromId: 'lane-a-project-a', at: AT, subject: 'b' }, { deliveryId: 503, fromId: 'lane-a-project-a', at: AT - MIN, subject: 'c' }]) });
      for (const seed of SEEDS) expect(round(tied, seed, []).questions.filter((q) => q.cls === 'temporal')).toEqual([]);
    },
    'continuation is skipped with fewer than three notes of distinct text': () => {
      const twoTexts = [NOTES[0]!, NOTES[1]!, { ...NOTES[2]!, text: ` ${NOTES[0]!.text.toUpperCase()} ` }];
      for (const seed of SEEDS) {
        expect(round(RICH, seed, twoTexts).questions.filter((q) => q.cls === 'continuation')).toEqual([]);
      }
    },
    'a spot round asks one question and is not short': () => {
      for (const seed of SEEDS) {
        const r = round(RICH, seed, NOTES, 'spot');
        expect([r.kind, r.questions.length, r.short]).toEqual(['spot', 1, false]);
        expect(r.skipped.filter((s) => s.why === 'the round was full').length).toBe(3);
      }
    },
    'a role draws only from its own set: a role that is not long-lived gets nothing': () => {
      for (const role of ['worker', 'reviewer', 'auditor', 'replay', 'plain'] as const) {
        const r = m.probeRound(role, RICH, NOTES, entropy(1), 'start');
        expect([r.questions, r.skipped, r.short], role).toEqual([[], [], true]);
      }
      const o = m.probeRound('overlord', RICH, NOTES, entropy(1), 'start');
      expect(o.questions.length).toBe(4);
      expect(o.skipped.map((s) => s.cls).sort()).toEqual(['application', 'contradiction', 'decision', 'thread', 'update']);
    },
    'the same seed gives the same round; the seed decides the order': () => {
      for (const seed of SEEDS) expect(round(RICH, seed)).toStrictEqual(round(RICH, seed));
      expect(new Set(SEEDS.map((s) => round(RICH, s).questions[0]!.cls)).size).toBeGreaterThan(1);
      expect(new Set(SEEDS.map((s) => JSON.stringify(round(THIN, s, []).questions))).size).toBeGreaterThan(1);
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
    'a round passes only when every answer passed, and asked something': () => {
      expect(m.roundVerdict(['pass', 'pass', 'pass'])).toBe('passed');
      expect(m.roundVerdict(['pass', 'fail', 'pass', 'pass'])).toBe('failed');
      expect(m.roundVerdict(['fail'])).toBe('failed');
      expect(m.roundVerdict([])).toBe('failed');
    },
    'monotonic: turning a pass into a fail never makes a round pass': () => {
      for (let bits = 0; bits < 32; bits++) {
        const grades = Array.from({ length: 5 }, (_, i) => ((bits >> i) & 1 ? 'pass' : 'fail') as 'pass' | 'fail');
        for (let i = 0; i < 5; i++) {
          if (grades[i] !== 'pass') continue;
          const worse = grades.map((g, j) => (j === i ? 'fail' : g));
          if (m.roundVerdict(worse) === 'passed') expect(m.roundVerdict(grades)).toBe('passed');
          expect(m.roundVerdict(worse)).toBe('failed');
        }
      }
    },
  };
}

const CAP = 250_000;
/** `n` closed-book spot probes at `depth`, the first `fails` of them failed. */
const spots = (depth: number, n: number, fails = 0, over: Partial<Spot> = {}): Spot[] =>
  Array.from({ length: n }, (_, i) => ({ depthTokens: depth, grade: i < fails ? 'fail' : 'pass', closed: true, modelClass: 'opus', ...over }));
/** Every step up to `steps` holds twenty passes. */
const goodTo = (steps: number, over: Partial<Spot> = {}): Spot[] =>
  Array.from({ length: steps }, (_, k) => spots((k + 1) * 50_000 + 1_234, 20, 0, over)).flat();

export function fittedCeilingCases(m: ProbesModule): Record<string, SuiteCase> {
  const fit = (s: readonly Spot[], cap = CAP, cls = 'opus') => m.fittedCeiling(s, cls, cap);
  return {
    'no probes: the hard cap, not fitted': () => {
      expect(fit([])).toStrictEqual({ tokens: CAP, fitted: false });
    },
    "the plan's example: 20 passes at 50k and 100k, 18 of 20 at 150k fits 100k": () => {
      expect(fit([...goodTo(2), ...spots(150_000, 20, 2)])).toStrictEqual({ tokens: 100_000, fitted: true });
    },
    'exactly the pass rate is good: 19 of 20 at every step fits the hard cap': () => {
      const all = Array.from({ length: 5 }, (_, k) => spots((k + 1) * 50_000, 20, 1)).flat();
      expect(fit(all)).toStrictEqual({ tokens: CAP, fitted: true });
    },
    'a bad first step fits zero; a short step below a bad one leaves the hard cap': () => {
      expect(fit(spots(50_000, 20, 5))).toStrictEqual({ tokens: 0, fitted: true });
      expect(fit([...goodTo(1), ...spots(100_000, 19), ...spots(150_000, 20, 10)])).toStrictEqual({ tokens: CAP, fitted: false });
      expect(fit(goodTo(4))).toStrictEqual({ tokens: CAP, fitted: false });
    },
    'the window is the last twenty: old fails age out': () => {
      expect(fit([...spots(50_000, 10, 10), ...goodTo(5)])).toStrictEqual({ tokens: CAP, fitted: true });
      expect(fit([...goodTo(5), ...spots(50_000, 2, 2)])).toStrictEqual({ tokens: 0, fitted: true });
    },
    'another model class: the hard cap, even when this one is fitted': () => {
      const s = [...goodTo(2), ...spots(150_000, 20, 2)];
      expect(fit(s, CAP, 'sonnet')).toStrictEqual({ tokens: CAP, fitted: false });
      expect(fit([...goodTo(5), ...spots(150_000, 20, 20, { modelClass: 'sonnet' })])).toStrictEqual({ tokens: CAP, fitted: true });
    },
    'open-book probes do not count': () => {
      expect(fit([...goodTo(5), ...spots(150_000, 20, 20, { closed: false })])).toStrictEqual({ tokens: CAP, fitted: true });
      expect(fit(goodTo(5, { closed: false }))).toStrictEqual({ tokens: CAP, fitted: false });
    },
    'never above the hard cap: a lower cap stops the walk there': () => {
      expect(fit([...goodTo(4), ...spots(250_000, 20, 20)], 120_000)).toStrictEqual({ tokens: 120_000, fitted: true });
      expect(fit([...goodTo(2), ...spots(150_000, 20, 20)], 120_000)).toStrictEqual({ tokens: 120_000, fitted: true });
    },
    'depths below the first step are not a bucket': () => {
      expect(fit([...spots(10_000, 20, 20), ...goodTo(5)])).toStrictEqual({ tokens: CAP, fitted: true });
    },
    'monotonic: adding a closed-book fail never raises the ceiling, and it never exceeds the hard cap': () => {
      for (const seed of SEEDS) {
        const e = entropy(seed);
        const s: Spot[] = Array.from({ length: 120 + e.below(80) }, () => ({
          depthTokens: (1 + e.below(6)) * 50_000 + e.below(50_000), grade: e.below(100) < 97 ? 'pass' : 'fail',
          closed: e.below(10) > 0, modelClass: e.below(5) > 0 ? 'opus' : 'sonnet',
        }));
        const before = fit(s);
        expect(before.tokens).toBeLessThanOrEqual(CAP);
        const at = e.below(s.length + 1);
        const worse = [...s.slice(0, at), { depthTokens: (1 + e.below(5)) * 50_000, grade: 'fail' as const, closed: true, modelClass: 'opus' }, ...s.slice(at)];
        expect(fit(worse).tokens, String(seed)).toBeLessThanOrEqual(before.tokens);
      }
    },
  };
}

const MODULE = path.join(ROOT, 'server/src/continuity/probes.ts');

/** `probeRound`'s mutants (the plan's four, and three more). */
const PROBE_ROUND_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'R1 skip the top-up', old: 'while (drafts.length < least && factRest.length > 0)', new: 'while (false && factRest.length > 0)' },
    { id: 'R2 expected outside choices', old: 'expected: String(r.id),', new: 'expected: String(r.id + 1000),' },
    { id: 'R3 a class the role lacks', old: 'shuffle(FLEET_ROLES[role].probeSet, entropy)', new: 'shuffle(FLEET_ROLES.overlord.probeSet, entropy)' },
    { id: 'R4 ignore the seed', old: 'const j = entropy.below(i + 1);', new: 'const j = i;' },
    { id: 'R5 abstention on a ruled item', old: "const open = items.filter((i) => i.state === 'open').map((i) => i.id);", new: 'const open = items.map((i) => i.id);' },
    { id: 'R6 abstention on unmeasured items', old: "if (s.ledger.kind !== 'read' || s.itemsRaised.kind !== 'read') return { drafts: [], why };", new: "if (s.ledger.kind !== 'read' && s.itemsRaised.kind !== 'read') return { drafts: [], why };" },
    { id: 'R7 a spot round of three', old: "kind === 'spot' ? [1, 1]", new: "kind === 'spot' ? [3, 5]" },
    { id: 'R8 a held decoy', old: '.filter((p) => !held.some((h) => under(p, h)))', new: '' },
    { id: 'R9 continuation with two texts', old: 'if (distinct.length < 2) continue;', new: 'if (distinct.length < 1) continue;' },
    { id: 'R10 temporal with a tied newest', old: 'if (top.length !== 1) continue;', new: '' },
    { id: 'R11 temporal with two rows', old: 'if (f.rows.length < 3 ||', new: 'if (f.rows.length < 2 ||' },
  ],
  suite: probeRoundCases,
};

/** `gradeProbe`'s and `roundVerdict`'s mutants (the plan's three, and two more). */
const GRADE_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'G1 drop the case-fold', old: 'const fold = (t: string): string => t.trim().toLowerCase();\n  if (q.choices', new: 'const fold = (t: string): string => t.trim();\n  if (q.choices' },
    { id: 'G2 none passes any question', old: 'if (q.choices !== null && !q.choices', new: "if (fold(answer) === 'none') return 'pass';\n  if (q.choices !== null && !q.choices" },
    { id: 'G3 a round on most passes', old: "grades.every((g) => g === 'pass')", new: "grades.filter((g) => g === 'pass').length * 2 > grades.length" },
    { id: 'G4 the choices unchecked', old: "if (q.choices !== null && !q.choices.some((c) => fold(c) === fold(answer))) return 'fail';", new: '' },
    { id: 'G5 an empty round passes', old: 'return grades.length > 0 && grades.every', new: 'return grades.every' },
  ],
  suite: gradeCases,
};

/** `fittedCeiling`'s mutants (the plan's four, and three more). */
const FITTED_CEILING_SET: MutantSet<ProbesModule> = {
  modulePath: MODULE,
  mutants: [
    { id: 'F1 >= to >', old: '/ FIT_WINDOW < FIT_PASS_RATE)', new: '/ FIT_WINDOW <= FIT_PASS_RATE)' },
    { id: 'F2 count open-book', old: 'if (!s.closed || s.modelClass !== modelClass) continue;', new: 'if (s.modelClass !== modelClass) continue;' },
    { id: 'F3 ignore the model class', old: 'if (!s.closed || s.modelClass !== modelClass) continue;', new: 'if (!s.closed) continue;' },
    { id: 'F4 past the hard cap', old: 'k * SPOT_PROBE_EVERY_TOKENS <= hardCap; k++', new: '; k++' },
    { id: 'F5 every probe, not the window', old: 'const window = grades.slice(-FIT_WINDOW);', new: 'const window = grades.slice(0, FIT_WINDOW);' },
    { id: 'F6 a short bucket fits', old: 'if (grades.length < FIT_WINDOW) return', new: 'if (grades.length < 1) return' },
    { id: 'F7 a bad first step fits the step', old: 'return { tokens: (k - 1) * SPOT_PROBE_EVERY_TOKENS, fitted: true };', new: 'return { tokens: Math.max(1, k - 1) * SPOT_PROBE_EVERY_TOKENS, fitted: true };' },
  ],
  suite: fittedCeilingCases,
};

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const PROBE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/continuity/probes.ts#probeRound': PROBE_ROUND_SET as MutantSet<never>,
  'server/src/continuity/probes.ts#gradeProbe': GRADE_SET as MutantSet<never>,
  'server/src/continuity/probes.ts#fittedCeiling': FITTED_CEILING_SET as MutantSet<never>,
};
