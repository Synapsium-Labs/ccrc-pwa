// The label queue's mutant sets (Overlord W2, plan w2-label-queue.md Task 2 Step 3; the floors rule is D-8217): `cardRowsOf`,
// `labelsNeeded`, `pickLabelCards`, `labelFor` and `cardShown` in server/src/coord/labelQueue.ts, and `cardAnswerVerdict` and
// `cardView` in server/src/coord/labelCards.ts, each run against suite cases that load the mutated copy; and the read's two
// deciders, `handOverOrder` and `readDraws` (review fix round 2). Each `old` text occurs once in its module.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { upperBound95 } from '../../../shared/binomialBound.js';
import { DECISION_QUESTIONS, type DecisionLabelSource, type DecisionQuestionRow, type DecisionRowId } from '../../../shared/decisionModel.js';
import type * as LabelCardsModule from '../../src/coord/labelCards.js';
import type { LabelledAnswer } from '../../src/coord/decisionLines.js';
import type * as LabelQueueModule from '../../src/coord/labelQueue.js';
import type { MutantSet, SuiteCase } from './mutate.js';

type Queue = typeof LabelQueueModule;
type Cards = typeof LabelCardsModule;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_TS = path.resolve(HERE, '../../src/coord/labelQueue.ts');
const CARDS_TS = path.resolve(HERE, '../../src/coord/labelCards.ts');
const KEY_Q = 'server/src/coord/labelQueue.ts#';
const KEY_C = 'server/src/coord/labelCards.ts#';

const Q = DECISION_QUESTIONS;
const WEEK_MS = 7 * 86_400_000;
const yesNo = Q['relay.method'];
const gateRow = Q['scope.widens'];
const choiceRow = Q['programme.pick'];
const fixture = (id: string, direction: 'gate' | 'advice', target: 0.1 | 0.05 = 0.1): DecisionQuestionRow =>
  ({ ...yesNo, id: id as DecisionRowId, direction, target });
const wc = (stateHash: string, recordId: number, at = 0, markedAtNext = false) => ({ stateHash, recordId, at, markedAtNext });
type Facts = Parameters<Queue['pickLabelCards']>[0]['rows'][number];
const facts = (row: DecisionQuestionRow, over: Partial<Facts> = {}): Facts =>
  ({ row, mode: 'shadow', needed: 29, lastCardWeekStart: 'never', waiting: [wc('a', 1), wc('b', 2), wc('c', 3)], ...over });
const WEEK = { key: 'w', start: 100 * WEEK_MS };
const pickOf = (m: Queue, rows: readonly Facts[], over: { pickedThisWeek?: number; open?: number } = {}) =>
  m.pickLabelCards({ week: WEEK, pickedThisWeek: 0, open: 0, rows, ...over });
const names = (out: ReturnType<Queue['pickLabelCards']>) => out.map((o) => `${o.row}:${o.stateHash}`);
const clean = (n: number, p = 0.99): LabelledAnswer[] => Array.from({ length: n }, () => ({ p, verdict: 'yes', label: 'yes' }));
const wrong = (n: number, p = 0.99): LabelledAnswer[] => Array.from({ length: n }, () => ({ p, verdict: 'yes', label: 'no' }));

const CARD_ROWS_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'CR1', old: "includes('label-queue')", new: 'length > 0' },
    { id: 'CR2', old: "includes('label-queue')", new: "every((s) => s === 'label-queue')" },
    { id: 'CR3', old: 'DECISION_ROW_IDS.filter(', new: 'Object.keys(q).reverse().filter(' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'the four W2 rows in catalogue order': () => {
        expect(m.cardRowsOf(Q)).toEqual(['scope.widens', 'relay.method', 'readback.omits', 'readback.adds']);
      },
      'a row with another source beside label-queue is in, one with only outcome is out': () => {
        const mixed = { ...Q, 'relay.method': { ...Q['relay.method'], labelSources: ['label-queue', 'outcome'] as readonly DecisionLabelSource[] } };
        expect(m.cardRowsOf(mixed)).toContain('relay.method');
        const out = { ...Q, 'relay.method': { ...Q['relay.method'], labelSources: ['outcome'] as readonly DecisionLabelSource[] } };
        expect(m.cardRowsOf(out)).toEqual(['scope.widens', 'readback.omits', 'readback.adds']);
      },
    };
  },
};

/** The least total n at which `errors` errors bring the 10% bound under target. */
const leastTotal = (errors: number): number => { let n = errors; while (upperBound95(errors, n) > 0.1) n++; return n; };

const LABELS_NEEDED_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'LN1', old: 'if (upperBound95(errors, n) <= row.target) continue;', new: 'if (upperBound95(errors, n) <= row.target) return null;' },
    { id: 'LN2', old: 'for (let k = 0; k <= LABELS_NEEDED_CAP; k++) {', new: 'for (let k = 0; k < LABELS_NEEDED_CAP; k++) {' },
    { id: 'LN3', old: "return 'far';", new: "return 'none';" },
    { id: 'LN4', old: 'for (const t of DECISION_LINE_CANDIDATES) {', new: 'for (const t of [...DECISION_LINE_CANDIDATES].reverse()) {' },
    { id: 'LN5', old: 'upperBound95(errors, n + k) <= row.target', new: 'upperBound95(errors, n + k + 1) <= row.target' },
    { id: 'LN6', old: "if (t === null) return 'none';", new: 'if (t === null) return 0;' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'no cases: 29 at 10%, 59 at 5%': () => {
        expect(m.labelsNeeded(yesNo, [])).toBe(29);
        expect(m.labelsNeeded(gateRow, [])).toBe(59);
      },
      'clean labels already held count': () => { expect(m.labelsNeeded(yesNo, clean(10))).toBe(19); },
      'every candidate passing answers none': () => {
        expect(m.labelsNeeded(yesNo, clean(29))).toBe('none');
        expect(m.labelsNeeded(gateRow, clean(59))).toBe('none');
      },
      'a stricter candidate that passed is skipped for the next': () => {
        expect(m.labelsNeeded(yesNo, clean(29, 0.92))).toBe(29);
      },
      'the strictest failing candidate is the one asked': () => {
        // 0.8 and below see 29 clean + 5 errors; 0.5 alone also sees 2 more errors.
        const cases = [...clean(29), ...wrong(5, 0.8), ...wrong(2, 0.55)];
        const want = (e: number, n: number): number => leastTotal(e) - n;
        expect(m.labelsNeeded(yesNo, cases)).toBe(want(5, 34));
        expect(want(5, 34)).not.toBe(want(7, 36));
      },
      'the search is inclusive of the cap: needing exactly 1000 is 1000, 1001 is far': () => {
        const errors = 150;
        const c = leastTotal(errors) - 1000 - errors;
        if (c < 1) throw new Error('fixture: the cap case needs a positive clean count');
        expect(m.labelsNeeded(yesNo, [...wrong(errors), ...clean(c)])).toBe(1000);
        expect(m.labelsNeeded(yesNo, [...wrong(errors), ...clean(c - 1)])).toBe('far');
      },
      'far past the search cap': () => { expect(m.labelsNeeded(gateRow, wrong(200))).toBe('far'); },
    };
  },
};

const PICK_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    // Budget: a `>` for the `>=` that stops step 5 at the budget.
    { id: 'PK1', old: 'if (out.length >= budget) break;', new: 'if (out.length > budget) break;' },
    // The due step dropped: no row's one card first.
    { id: 'PK2', old: 'if (e.due) take(e);', new: ';' },
    // Advice before gate.
    { id: 'PK3', old: "Number(b.r.row.direction === 'gate') - Number(a.r.row.direction === 'gate')", new: "Number(a.r.row.direction === 'gate') - Number(b.r.row.direction === 'gate')" },
    // Due at more than the gap, not at it.
    { id: 'PK4', old: 'f.week.start - r.lastCardWeekStart >= gapMs', new: 'f.week.start - r.lastCardWeekStart > gapMs' },
    // The open cap left out of the budget.
    { id: 'PK5', old: ', LABEL_CARDS_PER_WEEK - open)', new: ')' },
    // A row with nothing needed still takes a card in the second share.
    { id: 'PK6', old: "needed === 'none' ? 0 :", new: "needed === 'none' ? 1 :" },
  ],
  suite(m): Record<string, SuiteCase> {
    const adv = (id: string) => fixture(id, 'advice');
    const cases = (p: string, n: number) => Array.from({ length: n }, (_, i) => wc(`${p}${i}`, i));
    return {
      'the budget at each edge': () => {
        const rows = [facts(yesNo, { waiting: cases('h', 30) })];
        expect(pickOf(m, rows)).toHaveLength(10);
        expect(pickOf(m, rows, { pickedThisWeek: 9 })).toHaveLength(1);
        expect(pickOf(m, rows, { open: 9 })).toHaveLength(1);
        expect(pickOf(m, rows, { pickedThisWeek: 10 })).toEqual([]);
        expect(pickOf(m, rows, { open: 10 })).toEqual([]);
        expect(pickOf(m, rows, { pickedThisWeek: 3, open: 8 })).toHaveLength(2);
        expect(pickOf(m, rows, { pickedThisWeek: 8, open: 3 })).toHaveLength(2);
        expect(pickOf(m, rows, { open: 12 })).toEqual([]);
      },
      'fewer budget than due rows: the budget wins': () => {
        const out = pickOf(m, ['a', 'b', 'c'].map((id) => facts(adv(id), { needed: 5 })), { pickedThisWeek: 8 });
        expect(names(out)).toEqual(['a:c', 'b:c']);
      },
      'an off row and a row with nothing waiting contribute nothing': () => {
        expect(pickOf(m, [facts(yesNo, { mode: 'off' })])).toEqual([]);
        expect(pickOf(m, [facts(yesNo, { waiting: [] })])).toEqual([]);
      },
      'due rows get one card each before any row takes its share': () => {
        const out = pickOf(m, [
          facts(adv('a'), { needed: 1, lastCardWeekStart: WEEK.start }),
          facts(adv('b'), { needed: 5, waiting: [wc('b1', 4), wc('b2', 5)] }),
          facts(adv('c'), { needed: 5, waiting: [wc('c1', 6), wc('c2', 7)] }),
        ], { pickedThisWeek: 6 });
        expect(names(out)).toEqual(['b:b2', 'c:c2', 'b:b1', 'c:c1']);
      },
      'due at a full gap, not at one millisecond less': () => {
        const gap = 4 * WEEK_MS;
        const one = (last: number | 'never') => pickOf(m, [
          facts(adv('b'), { needed: 1, lastCardWeekStart: WEEK.start - 1, waiting: [wc('x', 1)] }),
          facts(adv('a'), { needed: 50, lastCardWeekStart: last, waiting: [wc('y', 2)] }),
        ], { pickedThisWeek: 9 })[0]!.row;
        expect(one('never')).toBe('a');
        expect(one(WEEK.start - gap)).toBe('a');
        expect(one(WEEK.start - gap + 1)).toBe('b');
      },
      'a gate before an advice row': () => {
        const out = pickOf(m, [facts(adv('a'), { needed: 1 }), facts(fixture('z', 'gate', 0.05), { needed: 59 })], { pickedThisWeek: 9 });
        expect(out.map((o) => o.row)).toEqual(['z']);
      },
      'fewer needed first, a number before far before none, then the id': () => {
        const order = (needs: readonly [string, Facts['needed']][]) =>
          pickOf(m, needs.map(([id, needed]) => facts(adv(id), { needed, waiting: [wc('x', 1)] }))).map((o) => o.row as string);
        expect(order([['a', 40], ['b', 3], ['c', 'far'], ['d', 'none'], ['e', 9]])).toEqual(['b', 'e', 'a', 'c', 'd']);
        expect(order([['b', 7], ['a', 7]])).toEqual(['a', 'b']);
      },
      'a row takes at most its needed, far the cap, none nothing more': () => {
        const out = pickOf(m, [
          facts(adv('a'), { needed: 3, lastCardWeekStart: WEEK.start, waiting: cases('a', 8) }),
          facts(adv('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: cases('b', 8) }),
          facts(adv('c'), { needed: 'none', lastCardWeekStart: WEEK.start, waiting: cases('c', 8) }),
        ]);
        expect(out.map((o) => o.row as string)).toEqual(['b', 'b', 'a', 'a', 'a']);
        const far = pickOf(m, [
          facts(adv('a'), { needed: 'far', lastCardWeekStart: WEEK.start, waiting: cases('a', 30) }),
          facts(adv('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: cases('b', 30) }),
        ]);
        expect(far.map((o) => o.row as string)).toEqual(['b', 'b', ...Array(8).fill('a')]);
      },
      'the card a due row got counts toward its share': () => {
        const out = pickOf(m, [
          facts(adv('a'), { needed: 1, waiting: [wc('a1', 1), wc('a2', 2)] }),
          facts(adv('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: [wc('b1', 3), wc('b2', 4), wc('b3', 5)] }),
        ]);
        expect(names(out)).toEqual(['a:a2', 'b:b3', 'b:b2']);
      },
      'within a row: marked, then newest, then the higher record; a state once': () => {
        const out = pickOf(m, [facts(yesNo, {
          needed: 10,
          waiting: [wc('old', 1, 5), wc('new', 2, 9), wc('markOld', 3, 1, true), wc('tieLow', 4, 9), wc('tieHigh', 8, 9), wc('markNew', 5, 3, true), wc('new', 9, 9)],
        })]);
        expect(out.map((o) => o.stateHash)).toEqual(['markNew', 'markOld', 'new', 'tieHigh', 'tieLow', 'old']);
      },
    };
  },
};

const lbl = (source: DecisionLabelSource, label: LabelledAnswer['label'], at: number) => ({ source, label, at });

const LABEL_FOR_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    // An outcome keeps the answer beside it.
    { id: 'LF1', old: 'const standing = hasOutcome ? labels.filter((l) => !retires(l.source)) : labels;', new: 'const standing = labels;' },
    // A tie goes to the earlier.
    { id: 'LF2', old: 'if (l.at >= best.at) best = l;', new: 'if (l.at > best.at) best = l;' },
    // An outcome does not retire an overturn.
    { id: 'LF3', old: "s === 'operator-answer' || s === 'overturn'", new: "s === 'operator-answer'" },
    // Retired listed without an outcome.
    { id: 'LF4', old: 'const retired = hasOutcome ? ', new: 'const retired = true ? ' },
    // Retired lists a source that no label carried.
    { id: 'LF5', old: 'retires(s) && labels.some((l) => l.source === s)', new: 'retires(s)' },
    { id: 'LF6', old: "if (labels.length === 0) return 'none';", new: '' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'no labels answer none': () => { expect(m.labelFor([])).toBe('none'); },
      'the newest stands, whatever the order, a tie to the later': () => {
        expect(m.labelFor([lbl('label-queue', 'yes', 5), lbl('label-queue', 'no', 9)])).toEqual({ label: 'no', source: 'label-queue', retired: [] });
        expect(m.labelFor([lbl('label-queue', 'no', 9), lbl('label-queue', 'yes', 5)])).toEqual({ label: 'no', source: 'label-queue', retired: [] });
        expect(m.labelFor([lbl('label-queue', 'yes', 5), lbl('routed-to', 'no', 5)])).toMatchObject({ label: 'no' });
        expect(m.labelFor([lbl('routed-to', 'no', 5), lbl('label-queue', 'yes', 5)])).toMatchObject({ label: 'yes' });
      },
      'an outcome retires an operator answer, even a newer one': () => {
        expect(m.labelFor([lbl('outcome', 'no', 1), lbl('operator-answer', 'yes', 9)])).toEqual({ label: 'no', source: 'outcome', retired: ['operator-answer'] });
      },
      'an outcome retires an overturn': () => {
        expect(m.labelFor([lbl('overturn', 'yes', 9), lbl('outcome', 'no', 1)])).toEqual({ label: 'no', source: 'outcome', retired: ['overturn'] });
      },
      'both retired are listed once each in catalogue order': () => {
        expect(m.labelFor([lbl('overturn', 'yes', 3), lbl('operator-answer', 'no', 4), lbl('overturn', 'no', 5), lbl('outcome', 'yes', 0)]))
          .toEqual({ label: 'yes', source: 'outcome', retired: ['operator-answer', 'overturn'] });
      },
      'an outcome beside only a label-queue label retires nothing and the newest stands': () => {
        expect(m.labelFor([lbl('outcome', 'yes', 8), lbl('label-queue', 'no', 7)])).toEqual({ label: 'yes', source: 'outcome', retired: [] });
        expect(m.labelFor([lbl('outcome', 'yes', 2), lbl('label-queue', 'no', 7)])).toEqual({ label: 'no', source: 'label-queue', retired: [] });
      },
      'without an outcome nothing is retired': () => {
        expect(m.labelFor([lbl('operator-answer', 'yes', 3), lbl('overturn', 'no', 4)])).toEqual({ label: 'no', source: 'overturn', retired: [] });
      },
    };
  },
};

const CARD_SHOWN_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    // An off row shown.
    { id: 'CS1', old: "rowNow.mode === 'off' || ", new: '' },
    // A changed revision shown.
    { id: 'CS2', old: '|| card.revision !== rowNow.revision', new: '' },
    // Hidden and shown swapped.
    { id: 'CS3', old: "? 'hidden' : 'shown'", new: "? 'shown' : 'hidden'" },
    // Only an armed row shown.
    { id: 'CS4', old: "rowNow.mode === 'off'", new: "rowNow.mode !== 'armed'" },
  ],
  suite(m): Record<string, SuiteCase> {
    const card = { row: 'relay.method' as DecisionRowId, revision: 'rev1' };
    return {
      'an off row hides': () => {
        expect(m.cardShown(card, { mode: 'off', revision: 'rev1' })).toBe('hidden');
        expect(m.cardShown(card, { mode: 'off', revision: 'rev2' })).toBe('hidden');
      },
      'a changed revision hides': () => {
        expect(m.cardShown(card, { mode: 'shadow', revision: 'rev2' })).toBe('hidden');
        expect(m.cardShown(card, { mode: 'armed', revision: 'rev2' })).toBe('hidden');
      },
      'shadow and armed at the card\'s revision show': () => {
        expect(m.cardShown(card, { mode: 'shadow', revision: 'rev1' })).toBe('shown');
        expect(m.cardShown(card, { mode: 'armed', revision: 'rev1' })).toBe('shown');
      },
    };
  },
};

const ANSWER_VERDICT_SET: MutantSet<Cards> = {
  modulePath: CARDS_TS,
  mutants: [
    { id: 'AV1', old: "if (card.closedAt !== null) return { kind: 'already' };", new: '' },
    { id: 'AV2', old: "if (now.mode === 'off' || now.revision !== card.revision) return { kind: 'refuse', word: 'row-changed' };", new: '' },
    { id: 'AV3', old: "if (answer === 'not-sure') return { kind: 'not-sure' };", new: '' },
    { id: 'AV4', old: "return allowed.includes(answer) ? { kind: 'label', label: answer }", new: "return true ? { kind: 'label', label: answer }" },
    { id: 'AV5', old: 'keys.length === 1 && ', new: '' },
    { id: 'AV6', old: 'a.option === option', new: 'true' },
  ],
  suite(m): Record<string, SuiteCase> {
    const open = { closedAt: null, row: 'relay.method', revision: 'rev1' };
    const nowYn = { mode: 'shadow' as const, revision: 'rev1', row: yesNo, options: [] as readonly string[] };
    const nowChoice = { mode: 'armed' as const, revision: 'rev1', row: choiceRow, options: ['p1', 'p2'] };
    const bad = { kind: 'refuse', word: 'bad-request' };
    return {
      'a closed card is already': () => {
        expect(m.cardAnswerVerdict({ ...open, closedAt: 5 }, nowYn, 'yes')).toEqual({ kind: 'already' });
        expect(m.cardAnswerVerdict({ ...open, closedAt: 0 }, { ...nowYn, mode: 'off' }, 'junk')).toEqual({ kind: 'already' });
      },
      'an off row or a changed revision is row-changed, before the answer is read': () => {
        const rc = { kind: 'refuse', word: 'row-changed' };
        expect(m.cardAnswerVerdict(open, { ...nowYn, mode: 'off' }, 'yes')).toEqual(rc);
        expect(m.cardAnswerVerdict(open, { ...nowYn, revision: 'rev2' }, 'yes')).toEqual(rc);
        expect(m.cardAnswerVerdict(open, { ...nowYn, revision: 'rev2' }, 'junk')).toEqual(rc);
        expect(m.cardAnswerVerdict(open, { ...nowYn, mode: 'off' }, 'not-sure')).toEqual(rc);
      },
      'not-sure closes with no label': () => {
        expect(m.cardAnswerVerdict(open, nowYn, 'not-sure')).toEqual({ kind: 'not-sure' });
        expect(m.cardAnswerVerdict(open, nowChoice, 'not-sure')).toEqual({ kind: 'not-sure' });
      },
      'a yes-no row labels yes and no and refuses none': () => {
        expect(m.cardAnswerVerdict(open, nowYn, 'yes')).toEqual({ kind: 'label', label: 'yes' });
        expect(m.cardAnswerVerdict(open, nowYn, 'no')).toEqual({ kind: 'label', label: 'no' });
        expect(m.cardAnswerVerdict(open, nowYn, 'none')).toEqual(bad);
      },
      'a choice row labels a listed option or none, and refuses yes, no and an unknown option': () => {
        expect(m.cardAnswerVerdict(open, nowChoice, { option: 'p2' })).toEqual({ kind: 'label', label: { option: 'p2' } });
        expect(m.cardAnswerVerdict(open, nowChoice, 'none')).toEqual({ kind: 'label', label: 'none' });
        expect(m.cardAnswerVerdict(open, nowChoice, 'yes')).toEqual(bad);
        expect(m.cardAnswerVerdict(open, nowChoice, 'no')).toEqual(bad);
        expect(m.cardAnswerVerdict(open, nowChoice, { option: 'p9' })).toEqual(bad);
      },
      'a non-object, an extra key and a wrong shape are bad-request': () => {
        for (const x of [undefined, null, 7, [], ['yes'], {}, { option: 'p1', extra: 1 }, { option: 3 }, { opt: 'p1' }, 'Yes', '']) {
          expect(m.cardAnswerVerdict(open, nowChoice, x), JSON.stringify(x)).toEqual(bad);
        }
        expect(m.cardAnswerVerdict(open, nowYn, { option: 'p1' })).toEqual(bad);
      },
    };
  },
};

const CARD_VIEW_SET: MutantSet<Cards> = {
  modulePath: CARDS_TS,
  mutants: [
    { id: 'CV1', old: "quoted: f.kind === 'quoted'", new: 'quoted: false' },
    { id: 'CV2', old: 'if (!Object.prototype.hasOwnProperty.call(fields, f.name)) continue;', new: '' },
    { id: 'CV3', old: 'for (const f of row.fields) {', new: 'for (const f of [...row.fields].reverse()) {' },
    { id: 'CV4', old: 'question: row.instructions', new: "question: ''" },
    { id: 'CV5', old: 'answers: cardAllowedAnswers(row, options)', new: 'answers: []' },
    { id: 'CV6', old: 'pickedAt: card.pickedAt', new: 'pickedAt: 0' },
  ],
  suite(m): Record<string, SuiteCase> {
    const row = Q['readback.omits'];
    const card = {
      id: 7, week: '2026-W48', row: 'readback.omits' as DecisionRowId, revision: row.revision, stateHash: 'h', recordId: 3,
      pickedAt: 1234, closedAt: null, closedBy: null, outcome: null,
    };
    return {
      'the fixed question, fields in catalogue order with quoted marked, answers, ids': () => {
        expect(m.cardView(card, row, { readback: 'w', request: 'q', doneTest: ['a'] }, [])).toEqual({
          id: 7, row: 'readback.omits', question: row.instructions, pickedAt: 1234, week: '2026-W48',
          fields: [
            { name: 'request', quoted: false, text: 'q' },
            { name: 'readback', quoted: true, text: 'w' },
            { name: 'doneTest', quoted: false, text: ['a'] },
          ],
          answers: ['yes', 'no', 'not-sure'],
        });
      },
      'a field not present is left out': () => {
        expect(m.cardView(card, row, { readback: 'x' }, []).fields).toEqual([{ name: 'readback', quoted: true, text: 'x' }]);
      },
      'no verdict, p, band or line, whatever extra keys the fields hold': () => {
        const v = m.cardView(card, row, { readback: 'x', verdict: 'yes', p: '0.9', band: 'likely', line: '0.95' }, []);
        expect(v.fields.map((f) => f.name)).toEqual(['readback']);
        expect(Object.keys(v).sort()).toEqual(['answers', 'fields', 'id', 'pickedAt', 'question', 'row', 'week']);
      },
      'a choice row shows its options': () => {
        expect(m.cardView({ ...card, row: 'programme.pick' }, choiceRow, { request: 'r' }, ['p1']).answers)
          .toEqual([{ option: 'p1' }, 'none', 'not-sure']);
      },
    };
  },
};

// ── a state's refs (the coordinator's ruling on the gap, call 1913) ─────────────────────────────────────────────────────

const REF_NEEDS_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'RN1', old: '{ noReader = true; continue; }', new: 'continue;' },
    { id: 'RN2', old: "if (refKind === undefined) return { kind: 'malformed' };", new: 'if (refKind === undefined) continue;' },
    { id: 'RN3', old: "if (ids.length === 0 || ids.some((i) => i === null)) return { kind: 'malformed' };", new: '' },
    { id: 'RN4', old: "/^[1-9][0-9]{0,15}$/.test(v)", new: "/^[0-9]+$/.test(v)" },
    { id: 'RN5', old: "if (refKind === 'programme') continue;", new: '' },
  ],
  suite(m): Record<string, SuiteCase> {
    const rb = Q['readback.omits'];
    return {
      'message and mail ids are read': () => {
        expect(m.cardRefNeeds(rb, { request: ['3', '41'], readback: '12' })).toEqual({ kind: 'reads', reads: [
          { name: 'request', refKind: 'message', ids: [3, 41] }, { name: 'readback', refKind: 'mail', ids: [12] }] });
      },
      'a programme ref needs no read': () => {
        expect(m.cardRefNeeds(choiceRow, { candidates: ['prog-a'] })).toEqual({ kind: 'reads', reads: [] });
      },
      'a goals-version ref is no-reader': () => { expect(m.cardRefNeeds(gateRow, { cited: '7', goals: 'g' })).toEqual({ kind: 'no-reader' }); },
      'a bad id or an uncited name is malformed': () => {
        for (const bad of ['0', '01', 'x', '']) expect(m.cardRefNeeds(rb, { request: bad, readback: '1' })).toEqual({ kind: 'malformed' });
        expect(m.cardRefNeeds(rb, { request: [], readback: '1' })).toEqual({ kind: 'malformed' });
        expect(m.cardRefNeeds(yesNo, { part: '1' })).toEqual({ kind: 'malformed' });
      },
    };
  },
};

const DRAWABILITY_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'SD1', old: "if (needs.kind === 'no-reader') return 'no-reader';", new: '' },
    { id: 'SD2', old: "if (needs.kind === 'malformed') return 'absent';", new: "if (needs.kind === 'malformed') return 'unmeasured';" },
    { id: 'SD3', old: "if (f === 'absent') return 'absent';", new: '' },
    { id: 'SD4', old: "if (f !== 'present') unmeasured = true;", new: "if (f === 'unmeasured') unmeasured = true;" },
    { id: 'SD5', old: "return unmeasured ? 'unmeasured' : 'drawable';", new: "return 'drawable';" },
  ],
  suite(m): Record<string, SuiteCase> {
    const needs = { kind: 'reads' as const, reads: [{ name: 'request', refKind: 'message' as const, ids: [3, 4] }] };
    const f = (o: Record<string, 'present' | 'absent' | 'unmeasured'>) => new Map(Object.entries(o));
    return {
      'present draws': () => { expect(m.stateDrawability(needs, f({ 'message:3': 'present', 'message:4': 'present' }))).toBe('drawable'); },
      'absent beats unmeasured': () => { expect(m.stateDrawability(needs, f({ 'message:3': 'unmeasured', 'message:4': 'absent' }))).toBe('absent'); },
      'an unmeasured or unread ref is unmeasured': () => {
        expect(m.stateDrawability(needs, f({ 'message:3': 'present', 'message:4': 'unmeasured' }))).toBe('unmeasured');
        expect(m.stateDrawability(needs, f({ 'message:3': 'present' }))).toBe('unmeasured');
      },
      'no-reader and malformed have their own words': () => {
        expect(m.stateDrawability({ kind: 'no-reader' }, f({}))).toBe('no-reader');
        expect(m.stateDrawability({ kind: 'malformed' }, f({}))).toBe('absent');
      },
    };
  },
};

const HOLDS_SLOT_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'HS1', old: "return shown === 'shown' && drawability !== 'absent' && drawability !== 'no-reader';", new: "return shown === 'shown';" },
    { id: 'HS2', old: "&& drawability !== 'absent' && drawability !== 'no-reader';", new: "&& drawability !== 'absent';" },
    { id: 'HS3', old: "return shown === 'shown' && drawability", new: 'return true && drawability' },
    { id: 'HS4', old: "drawability !== 'absent' && drawability !== 'no-reader'", new: "drawability !== 'no-reader' && drawability !== 'unmeasured'" },
    // openSlotsHeld, the loop over the open cards that asks the two above.
    { id: 'HS5', old: "if (c.mode === 'unreadable' || cardHoldsSlot(", new: 'if (cardHoldsSlot(' },
    { id: 'HS6', old: '{ mode: c.mode, revision: c.revision }), c.drawability)) n++;', new: "{ mode: c.mode, revision: c.card.revision }), c.drawability)) n++;" },
  ],
  suite(m): Record<string, SuiteCase> {
    const card = { row: 'relay.method' as DecisionRowId, revision: 'r1' };
    return {
      'openSlotsHeld counts shown holding cards, an unreadable row\'s card included': () => {
        expect(m.openSlotsHeld([
          { card, mode: 'shadow', revision: 'r1', drawability: 'drawable' },
          { card, mode: 'unreadable', revision: 'r1', drawability: 'absent' },
          { card, mode: 'shadow', revision: 'r2', drawability: 'drawable' },
          { card, mode: 'off', revision: 'r1', drawability: 'drawable' },
          { card, mode: 'armed', revision: 'r1', drawability: 'no-reader' },
        ])).toBe(2);
      },
      'a shown drawable or unmeasured card holds a slot': () => {
        expect(m.cardHoldsSlot('shown', 'drawable')).toBe(true);
        expect(m.cardHoldsSlot('shown', 'unmeasured')).toBe(true);
      },
      'an absent or no-reader card, or a hidden one, holds none': () => {
        expect(m.cardHoldsSlot('shown', 'absent')).toBe(false);
        expect(m.cardHoldsSlot('shown', 'no-reader')).toBe(false);
        expect(m.cardHoldsSlot('hidden', 'drawable')).toBe(false);
      },
    };
  },
};

const ROW_FACTS_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'RF1', old: "waiting: f.waiting.filter((w) => w.drawability === 'drawable')", new: 'waiting: f.waiting' },
    { id: 'RF2', old: 't !== null && verdict !== null && lineCounts(', new: 'verdict !== null && lineCounts(' },
    { id: 'RF3', old: '[{ p, verdict, label: \'none\' }], t).n === 1', new: '[{ p, verdict, label: \'none\' }], 0.5).n === 1' },
    { id: 'RF4', old: 'needed: labelsNeeded(f.row, f.answers)', new: 'needed: labelsNeeded(f.row, [])' },
    { id: 'RF5', old: 'markedAtNext: marked(w.verdict, w.p)', new: 'markedAtNext: false' },
  ],
  suite(m): Record<string, SuiteCase> {
    const w = (stateHash: string, verdict: 'yes' | 'no' | null, p: number, drawability: 'drawable' | 'absent' = 'drawable') =>
      ({ stateHash, recordId: 1, at: 1, verdict, p, drawability });
    return {
      'marks at the next candidate, keeps drawable states': () => {
        const r = m.pickRowFactsOf({ row: yesNo, mode: 'shadow', answers: [], lastCardWeekStart: 'never',
          waiting: [w('a', 'yes', 0.96), w('b', 'yes', 0.9), w('c', 'yes', 0.99, 'absent')] });
        expect(r.waiting.map((x) => [x.stateHash, x.markedAtNext])).toEqual([['a', true], ['b', false]]);
      },
      'no next candidate marks nothing, and the need is the answers\'': () => {
        const r = m.pickRowFactsOf({ row: yesNo, mode: 'shadow', answers: clean(29), lastCardWeekStart: 'never',
          waiting: [w('a', 'yes', 0.99)] });
        expect(r.needed).toBe('none');
        expect(r.waiting[0]!.markedAtNext).toBe(false);
      },
    };
  },
};

const CARD_FIELDS_SET: MutantSet<Cards> = {
  modulePath: CARDS_TS,
  mutants: [
    { id: 'CF1', old: "if (needs.kind === 'no-reader') return { kind: 'skip', word: 'no-reader' };", new: '' },
    { id: 'CF2', old: "if (t?.kind === 'absent') return { kind: 'skip', word: 'absent' };", new: '' },
    { id: 'CF3', old: "if (t?.kind === 'resolved') out.push(t.text); else unmeasured = true;", new: "if (t?.kind === 'resolved') out.push(t.text);" },
    { id: 'CF4', old: "fields[r.name] = typeof refs[r.name] === 'string' ? out[0] ?? '' : out;", new: 'fields[r.name] = out;' },
    { id: 'CF5', old: "if (needs.kind === 'malformed') return { kind: 'skip', word: 'absent' };", new: "if (needs.kind === 'malformed') return { kind: 'skip', word: 'unmeasured' };" },
  ],
  suite(m): Record<string, SuiteCase> {
    const rb = Q['readback.omits'];
    const t = (o: Record<string, { kind: 'resolved'; text: string } | { kind: 'absent' } | { kind: 'unmeasured'; why: string }>) => new Map(Object.entries(o));
    return {
      'texts fill the fields, one id a string and a list a list': () => {
        expect(m.cardFieldsOf(rb, { request: '3', readback: '12' }, null, t({ 'message:3': { kind: 'resolved', text: 'q' }, 'mail:12': { kind: 'resolved', text: 'w' } })))
          .toEqual({ kind: 'fields', fields: { request: 'q', readback: 'w' } });
        expect(m.cardFieldsOf(rb, { request: ['3'], readback: '12' }, null, t({ 'message:3': { kind: 'resolved', text: 'q' }, 'mail:12': { kind: 'resolved', text: 'w' } })))
          .toEqual({ kind: 'fields', fields: { request: ['q'], readback: 'w' } });
      },
      'each skip word': () => {
        expect(m.cardFieldsOf(gateRow, { cited: '1', goals: 'g' }, null, t({}))).toEqual({ kind: 'skip', word: 'no-reader' });
        expect(m.cardFieldsOf(rb, { request: '3', readback: '12' }, null, t({ 'message:3': { kind: 'absent' }, 'mail:12': { kind: 'resolved', text: 'w' } })))
          .toEqual({ kind: 'skip', word: 'absent' });
        expect(m.cardFieldsOf(rb, { request: '3', readback: '12' }, null, t({ 'mail:12': { kind: 'resolved', text: 'w' } }))).toEqual({ kind: 'skip', word: 'unmeasured' });
        expect(m.cardFieldsOf(rb, { request: 'x', readback: '12' }, null, t({}))).toEqual({ kind: 'skip', word: 'absent' });
      },
    };
  },
};

// The read's two deciders (the coordinator's ruling C1, call 1975; their sets and floors by review 4210's residual, call 2024).
const HAND_OVER_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'HO1', old: '|| a.id - b.id', new: '|| b.id - a.id' },
    { id: 'HO2', old: '|| a.id - b.id', new: '' },
    { id: 'HO3', old: '(a.week < b.week ? -1 : a.week > b.week ? 1 : 0)', new: '(a.week < b.week ? 1 : a.week > b.week ? -1 : 0)' },
    { id: 'HO4', old: '(a.week < b.week ? -1 : a.week > b.week ? 1 : 0)', new: '0' },
  ],
  suite(m): Record<string, SuiteCase> {
    const c = (id: number, week: string) => ({ id, week });
    return {
      'oldest pick week first, then by id, whatever the input order': () => {
        const cards = [c(4, '2026-W49'), c(9, '2026-W48'), c(2, '2026-W49'), c(7, '2026-W48'), c(1, '2027-W01')];
        expect(m.handOverOrder(cards).map((x) => x.id)).toEqual([7, 9, 2, 4, 1]);
        expect(m.handOverOrder([...cards].reverse()).map((x) => x.id)).toEqual([7, 9, 2, 4, 1]);
      },
      'the input is not reordered in place': () => {
        const cards = [c(2, '2026-W49'), c(1, '2026-W48')];
        m.handOverOrder(cards);
        expect(cards.map((x) => x.id)).toEqual([2, 1]);
      },
    };
  },
};

const READ_DRAWS_SET: MutantSet<Queue> = {
  modulePath: QUEUE_TS,
  mutants: [
    { id: 'RD1', old: 'return drawn < LABEL_CARDS_PER_WEEK;', new: 'return drawn <= LABEL_CARDS_PER_WEEK;' },
    { id: 'RD2', old: 'return drawn < LABEL_CARDS_PER_WEEK;', new: 'return true;' },
    { id: 'RD3', old: 'return drawn < LABEL_CARDS_PER_WEEK;', new: 'return drawn < LABEL_CARDS_PER_WEEK - 1;' },
    { id: 'RD4', old: 'return drawn < LABEL_CARDS_PER_WEEK;', new: 'return drawn > 0 && drawn < LABEL_CARDS_PER_WEEK;' },
  ],
  suite(m): Record<string, SuiteCase> {
    return {
      'draws while fewer than ten are drawn, and stops at ten': () => {
        expect([0, 1, 9, 10, 11].map((n) => m.readDraws(n))).toEqual([true, true, true, false, false]);
      },
    };
  },
};

/** One set per decider; registered in mutation-floors.test.ts with a floor each. */
export const LABEL_QUEUE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY_Q}handOverOrder`]: HAND_OVER_SET as MutantSet<never>,
  [`${KEY_Q}readDraws`]: READ_DRAWS_SET as MutantSet<never>,
  [`${KEY_Q}cardRefNeeds`]: REF_NEEDS_SET as MutantSet<never>,
  [`${KEY_Q}stateDrawability`]: DRAWABILITY_SET as MutantSet<never>,
  [`${KEY_Q}cardHoldsSlot`]: HOLDS_SLOT_SET as MutantSet<never>,
  [`${KEY_Q}pickRowFactsOf`]: ROW_FACTS_SET as MutantSet<never>,
  [`${KEY_C}cardFieldsOf`]: CARD_FIELDS_SET as MutantSet<never>,
  [`${KEY_Q}cardRowsOf`]: CARD_ROWS_SET as MutantSet<never>,
  [`${KEY_Q}labelsNeeded`]: LABELS_NEEDED_SET as MutantSet<never>,
  [`${KEY_Q}pickLabelCards`]: PICK_SET as MutantSet<never>,
  [`${KEY_Q}labelFor`]: LABEL_FOR_SET as MutantSet<never>,
  [`${KEY_Q}cardShown`]: CARD_SHOWN_SET as MutantSet<never>,
  [`${KEY_C}cardAnswerVerdict`]: ANSWER_VERDICT_SET as MutantSet<never>,
  [`${KEY_C}cardView`]: CARD_VIEW_SET as MutantSet<never>,
};
