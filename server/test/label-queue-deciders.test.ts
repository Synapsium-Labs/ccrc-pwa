// Overlord W2, the label queue's deciders (plan w2-label-queue.md Task 2; LQ2 to LQ13, Table 3). Pure: no store, no clock.
import { describe, expect, it } from 'vitest';
import { upperBound95 } from '../../shared/binomialBound.js';
import { DECISION_QUESTIONS, type DecisionLabelSource, type DecisionQuestionRow, type DecisionRowId } from '../../shared/decisionModel.js';
import { LABEL_CARDS_PER_WEEK, LABEL_ROW_MAX_GAP_WEEKS, type CardView } from '../../shared/labelQueue.js';
import type { LabelledAnswer } from '../src/coord/decisionLines.js';
import { cardAllowedAnswers, cardAnswerVerdict, cardView } from '../src/coord/labelCards.js';
import {
  cardRowsOf, cardShown, labelFor, labelsNeeded, pickLabelCards, type LabelCardRow, type PickRowFacts,
} from '../src/coord/labelQueue.js';

const Q = DECISION_QUESTIONS;
const WEEK_MS = 7 * 86_400_000;
const yesNo = Q['relay.method'];   // advice, target 0.1
const gateRow = Q['scope.widens']; // gate, target 0.05
const choiceRow = Q['programme.pick'];

/** A small seeded PRNG (mulberry32): a sweep that reds is reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wc = (stateHash: string, recordId: number, at = 0, markedAtNext = false) => ({ stateHash, recordId, at, markedAtNext });
const facts = (row: DecisionQuestionRow, over: Partial<PickRowFacts> = {}): PickRowFacts => ({
  row, mode: 'shadow', needed: 29, lastCardWeekStart: 'never', waiting: [wc('a', 1), wc('b', 2), wc('c', 3)], ...over,
});
const WEEK = { key: '2026-W48', start: 100 * WEEK_MS };
const pick = (rows: readonly PickRowFacts[], over: { pickedThisWeek?: number; open?: number } = {}) =>
  pickLabelCards({ week: WEEK, pickedThisWeek: 0, open: 0, rows, ...over });
const hashes = (out: ReturnType<typeof pick>) => out.map((o) => `${o.row}:${o.stateHash}`);
/** A fixture row with its own id, direction and target, built from a catalogue row. */
const fixtureRow = (id: string, direction: 'gate' | 'advice', target: 0.1 | 0.05, base: DecisionQuestionRow = yesNo): DecisionQuestionRow =>
  ({ ...base, id: id as DecisionRowId, direction, target });

describe('cardRowsOf (LQ3)', () => {
  it('answers the four W2 rows whose sources name label-queue, in catalogue order', () => {
    expect(cardRowsOf(Q)).toEqual(['scope.widens', 'relay.method', 'readback.omits', 'readback.adds']);
  });
  it('leaves out a fixture row whose sources are all outcome', () => {
    const q = { ...Q, 'relay.method': { ...Q['relay.method'], labelSources: ['outcome'] as readonly DecisionLabelSource[] } };
    expect(cardRowsOf(q)).toEqual(['scope.widens', 'readback.omits', 'readback.adds']);
  });
});

describe('labelsNeeded (LQ5)', () => {
  const clean = (n: number, p = 0.99): LabelledAnswer[] => Array.from({ length: n }, () => ({ p, verdict: 'yes', label: 'yes' }));
  it('with no cases needs H6\'s own counts: 29 at a 10% target and 59 at 5%', () => {
    expect(labelsNeeded(yesNo, [])).toBe(29);
    expect(labelsNeeded(gateRow, [])).toBe(59);
  });
  it('counts the clean labels already held', () => {
    expect(labelsNeeded(yesNo, clean(10))).toBe(19);
    expect(labelsNeeded(gateRow, clean(59))).toBe('none');
  });
  it('one error raises it, to the least k whose bound is at the target', () => {
    const k = labelsNeeded(yesNo, [{ p: 0.97, verdict: 'yes', label: 'no' }]);
    expect(typeof k).toBe('number');
    expect(k as number).toBeGreaterThan(29);
    expect(upperBound95(1, 1 + (k as number))).toBeLessThanOrEqual(0.1);
    expect(upperBound95(1, (k as number))).toBeGreaterThan(0.1);
  });
  it('asks the strictest candidate that has not passed, so a case under it does not count there', () => {
    // p 0.6 is under 0.95 and 0.9 ... and counts only at 0.6 and 0.5: the first candidate still has n = 0.
    expect(labelsNeeded(yesNo, [{ p: 0.6, verdict: 'yes', label: 'yes' }])).toBe(29);
  });
  it('moves to the next candidate once the stricter one passes', () => {
    // 29 clean cases at p 0.92 pass 0.9 and below but not 0.95: the next candidate is 0.95 with n = 0.
    expect(labelsNeeded(yesNo, clean(29, 0.92))).toBe(29);
    // Clean at every line, so every candidate passes.
    expect(labelsNeeded(yesNo, clean(29))).toBe('none');
  });
  it('a candidate that passed is skipped: errors that fail only a later candidate name that one', () => {
    // 29 clean at 0.99 pass 0.95. Add 5 errors at p 0.6: only 0.6 and 0.5 see them, so 0.85 passes and 0.6 does not.
    const cases = [...clean(29), ...Array.from({ length: 5 }, (): LabelledAnswer => ({ p: 0.6, verdict: 'yes', label: 'no' }))];
    const k = labelsNeeded(yesNo, cases);
    expect(typeof k).toBe('number');
    expect(upperBound95(5, 34 + (k as number))).toBeLessThanOrEqual(0.1);
    expect(upperBound95(5, 34 + (k as number) - 1)).toBeGreaterThan(0.1);
  });
  it('the strictest candidate that fails is the one asked, not the loosest', () => {
    const wrong = (n: number, p: number): LabelledAnswer[] => Array.from({ length: n }, () => ({ p, verdict: 'yes', label: 'no' }));
    const leastTotal = (e: number): number => { let n = e; while (upperBound95(e, n) > 0.1) n++; return n; };
    // 0.8 and below see 29 clean + 5 errors; only 0.5 also sees two more errors.
    expect(labelsNeeded(yesNo, [...clean(29), ...wrong(5, 0.8), ...wrong(2, 0.55)])).toBe(leastTotal(5) - 34);
  });
  it('the cap is inclusive: needing exactly 1000 answers 1000, and 1001 is far', () => {
    const wrong = (n: number): LabelledAnswer[] => Array.from({ length: n }, () => ({ p: 0.99, verdict: 'yes', label: 'no' }));
    let total = 150;
    while (upperBound95(150, total) > 0.1) total++;
    const c = total - 1000 - 150;
    expect(c).toBeGreaterThan(0);
    expect(labelsNeeded(yesNo, [...wrong(150), ...clean(c)])).toBe(1000);
    expect(labelsNeeded(yesNo, [...wrong(150), ...clean(c - 1)])).toBe('far');
  });
  it('is far past the search cap', () => {
    const bad: LabelledAnswer[] = Array.from({ length: 200 }, () => ({ p: 0.99, verdict: 'yes', label: 'no' }));
    expect(labelsNeeded(gateRow, bad)).toBe('far');
  });
  it('counts a choice row by its own rule', () => {
    const ok: LabelledAnswer = { p: 0.99, verdict: { option: 'a' }, label: { option: 'a' } };
    expect(labelsNeeded(choiceRow, Array.from({ length: 29 }, () => ok))).toBe('none');
    expect(labelsNeeded(choiceRow, [])).toBe(29);
  });
});

describe('pickLabelCards, Table 3', () => {
  it('step 1: the budget at each edge of pickedThisWeek and open', () => {
    const rows = [facts(yesNo, { waiting: Array.from({ length: 30 }, (_, i) => wc(`h${i}`, i)) })];
    expect(pick(rows)).toHaveLength(10);
    expect(pick(rows, { pickedThisWeek: 9 })).toHaveLength(1);
    expect(pick(rows, { open: 9 })).toHaveLength(1);
    expect(pick(rows, { pickedThisWeek: 10 })).toEqual([]);
    expect(pick(rows, { open: 10 })).toEqual([]);
    expect(pick(rows, { pickedThisWeek: 4, open: 7 })).toHaveLength(3);
    expect(pick(rows, { pickedThisWeek: 7, open: 4 })).toHaveLength(3);
    expect(pick(rows, { pickedThisWeek: 15, open: 12 })).toEqual([]);
    expect(pick(rows, { pickedThisWeek: 11 })).toEqual([]);
    expect(pick(rows, { open: 11 })).toEqual([]);
  });
  it('step 2: an off row is never picked, and a row with no waiting case contributes nothing', () => {
    expect(pick([facts(yesNo, { mode: 'off' })])).toEqual([]);
    expect(pick([facts(yesNo, { waiting: [] })])).toEqual([]);
    const out = pick([facts(gateRow, { mode: 'off' }), facts(yesNo)]);
    expect(out.every((o) => o.row === 'relay.method')).toBe(true);
    expect(pick([facts(yesNo, { mode: 'armed' })]).length).toBeGreaterThan(0);
  });
  it('step 3: a row is due when it never had a card, or its last card is a full gap of weeks back', () => {
    const gap = LABEL_ROW_MAX_GAP_WEEKS * WEEK_MS;
    const a = fixtureRow('a', 'advice', 0.1);
    const b = fixtureRow('b', 'advice', 0.1);
    // One card of budget: the due row takes it though b is first by id and needs fewer.
    const dueOne = (last: number | 'never') => pick([
      facts(b, { needed: 1, lastCardWeekStart: WEEK.start - 1, waiting: [wc('x', 1)] }),
      facts(a, { needed: 50, lastCardWeekStart: last, waiting: [wc('y', 2)] }),
    ], { pickedThisWeek: 9 });
    expect(dueOne('never')[0]!.row).toBe('a');
    expect(dueOne(WEEK.start - gap)[0]!.row).toBe('a');
    expect(dueOne(WEEK.start - gap + 1)[0]!.row).toBe('b');
    expect(dueOne(WEEK.start - gap - 1)[0]!.row).toBe('a');
  });
  it('a row with no waiting case is never due', () => {
    expect(pick([facts(yesNo, { waiting: [] })])).toEqual([]);
  });
  it('step 4 and 5: due rows first, one card each, before any row takes its share', () => {
    const rows = ['a', 'b', 'c'].map((id) => fixtureRow(id, 'advice', 0.1));
    const out = pick([
      facts(rows[0]!, { needed: 1, lastCardWeekStart: WEEK.start, waiting: [wc('a1', 1), wc('a2', 2), wc('a3', 3)] }),
      facts(rows[1]!, { needed: 5, waiting: [wc('b1', 4), wc('b2', 5)] }),
      facts(rows[2]!, { needed: 5, waiting: [wc('c1', 6), wc('c2', 7)] }),
    ], { pickedThisWeek: 6 });
    // Budget 4: b and c are due, one each (the higher record id first); then b takes its next, then c; a (not due) is last.
    expect(hashes(out)).toEqual(['b:b2', 'c:c2', 'b:b1', 'c:c1']);
  });
  it('step 5 stops at the budget: with fewer cards than due rows, the order decides', () => {
    const rows = ['a', 'b', 'c'].map((id) => fixtureRow(id, 'advice', 0.1));
    const out = pick(rows.map((r) => facts(r, { needed: 5 })), { pickedThisWeek: 8 });
    expect(hashes(out)).toEqual(['a:c', 'b:c']);
  });
  it('step 4: a gate before an advice row, whatever their ids', () => {
    const adv = fixtureRow('a', 'advice', 0.1);
    const gate = fixtureRow('z', 'gate', 0.05);
    const out = pick([facts(adv, { needed: 1 }), facts(gate, { needed: 59 })], { pickedThisWeek: 9 });
    expect(out.map((o) => o.row)).toEqual(['z']);
  });
  it('step 4: fewer needed before more, a number before far before none, then the row id', () => {
    const r = (id: string) => fixtureRow(id, 'advice', 0.1);
    const order = (needs: readonly [string, PickRowFacts['needed']][]) =>
      pick(needs.map(([id, needed]) => facts(r(id), { needed, waiting: [wc('x', 1)] }))).map((o) => o.row as string);
    expect(order([['a', 40], ['b', 3], ['c', 'far'], ['d', 'none'], ['e', 9]])).toEqual(['b', 'e', 'a', 'c', 'd']);
    expect(order([['d', 'none'], ['c', 'far'], ['b', 7], ['a', 7]])).toEqual(['a', 'b', 'c', 'd']);
    expect(order([['b', 'far'], ['a', 'far'], ['d', 'none'], ['c', 'none']])).toEqual(['a', 'b', 'c', 'd']);
  });
  it('step 6: a row takes at most its needed before the next, far takes the cap, none takes nothing more', () => {
    const r = (id: string) => fixtureRow(id, 'advice', 0.1);
    const cases = (p: string, n: number) => Array.from({ length: n }, (_, i) => wc(`${p}${i}`, i));
    const out = pick([
      facts(r('a'), { needed: 3, lastCardWeekStart: WEEK.start, waiting: cases('a', 8) }),
      facts(r('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: cases('b', 8) }),
      facts(r('c'), { needed: 'none', lastCardWeekStart: WEEK.start, waiting: cases('c', 8) }),
    ]);
    expect(out.map((o) => o.row as string)).toEqual(['b', 'b', 'a', 'a', 'a']);
    const far = pick([
      facts(r('a'), { needed: 'far', lastCardWeekStart: WEEK.start, waiting: cases('a', 30) }),
      facts(r('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: cases('b', 30) }),
    ]);
    expect(far.map((o) => o.row as string)).toEqual(['b', 'b', ...Array(8).fill('a')]);
  });
  it('step 6: the card a due row got in step 5 counts toward its share', () => {
    const r = (id: string) => fixtureRow(id, 'advice', 0.1);
    const out = pick([
      facts(r('a'), { needed: 1, waiting: [wc('a1', 1), wc('a2', 2)] }),
      facts(r('b'), { needed: 2, lastCardWeekStart: WEEK.start, waiting: [wc('b1', 3), wc('b2', 4), wc('b3', 5)] }),
    ]);
    expect(hashes(out)).toEqual(['a:a2', 'b:b3', 'b:b2']);
  });
  it('a due row whose needed is none still gets its one card', () => {
    const out = pick([facts(yesNo, { needed: 'none' })]);
    expect(hashes(out)).toEqual(['relay.method:c']);
  });
  it('within a row: marked first, then newest at, then the higher record id', () => {
    const out = pick([facts(yesNo, {
      needed: 10,
      waiting: [wc('old', 1, 5), wc('new', 2, 9), wc('markOld', 3, 1, true), wc('tieLow', 4, 9), wc('tieHigh', 8, 9), wc('markNew', 5, 3, true)],
    })]);
    expect(out.map((o) => o.stateHash)).toEqual(['markNew', 'markOld', 'tieHigh', 'tieLow', 'new', 'old']);
    expect(out.find((o) => o.stateHash === 'tieHigh')!.recordId).toBe(8);
  });
  it('never carries a state twice, whether it repeats in a row\'s list or across rows', () => {
    const out = pick([facts(yesNo, { needed: 10, waiting: [wc('x', 1), wc('x', 2), wc('y', 3)] })]);
    expect(out.map((o) => o.stateHash)).toEqual(['y', 'x']);
    expect(out[1]!.recordId).toBe(2);
  });
  it('is input-order independent for rows: the order is the rule\'s, not the caller\'s', () => {
    const rows = ['a', 'b', 'c'].map((id, i) => facts(fixtureRow(id, 'advice', 0.1), { needed: 3 + i, waiting: [wc('x', 1)] }));
    expect(pick([...rows].reverse())).toEqual(pick(rows));
  });
});

describe('the properties, as seeded sweeps', () => {
  it('never over budget, never an off row, never a duplicate state, never a state not waiting', () => {
    const rnd = prng(0xc0ffee);
    const needs: PickRowFacts['needed'][] = [0, 1, 5, 29, 59, 'far', 'none'];
    for (let iter = 0; iter < 300; iter++) {
      const nRows = 1 + Math.floor(rnd() * 10);
      const rows = Array.from({ length: nRows }, (_, i): PickRowFacts => facts(
        fixtureRow(`r${i}`, rnd() < 0.5 ? 'gate' : 'advice', rnd() < 0.5 ? 0.1 : 0.05),
        {
          mode: (['off', 'shadow', 'armed'] as const)[Math.floor(rnd() * 3)]!,
          needed: needs[Math.floor(rnd() * needs.length)]!,
          lastCardWeekStart: rnd() < 0.3 ? 'never' : WEEK.start - Math.floor(rnd() * 8) * WEEK_MS,
          waiting: Array.from({ length: Math.floor(rnd() * 14) }, () => wc(`h${Math.floor(rnd() * 9)}`, Math.floor(rnd() * 50), Math.floor(rnd() * 5), rnd() < 0.4)),
        }));
      const pickedThisWeek = Math.floor(rnd() * 13);
      const open = Math.floor(rnd() * 13);
      const out = pick(rows, { pickedThisWeek, open });
      const budget = Math.max(0, Math.min(LABEL_CARDS_PER_WEEK - pickedThisWeek, LABEL_CARDS_PER_WEEK - open));
      expect(out.length).toBeLessThanOrEqual(budget);
      const seen = new Set<string>();
      for (const o of out) {
        const f = rows.find((x) => x.row.id === o.row)!;
        expect(f.mode).not.toBe('off');
        expect(f.waiting.some((w) => w.stateHash === o.stateHash && w.recordId === o.recordId)).toBe(true);
        const key = `${o.row}:${o.stateHash}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  /** Weeks of passes where the operator answers every open card before the next pass, so `open` is 0 and the week's count
   *  is the one pass's. Every row always has plenty waiting, and the rows' needs are fixed and unequal. */
  function answeredRun(nRows: number): Map<string, number[]> {
    const rnd = prng(nRows * 7919);
    const needs: PickRowFacts['needed'][] = [59, 'far', 29, 'none', 59, 12, 'far', 44, 'none', 3];
    const rowList = Array.from({ length: nRows }, (_, i) => fixtureRow(`row${String(i).padStart(2, '0')}`, i % 3 === 0 ? 'gate' : 'advice', 0.1));
    const last = new Map<string, number | 'never'>(rowList.map((r) => [r.id, 'never']));
    const picks = new Map<string, number[]>(rowList.map((r) => [r.id, []]));
    for (let w = 0; w < 52; w++) {
      const start = (200 + w) * WEEK_MS;
      const rows = rowList.map((r, i) => facts(r, {
        needed: needs[i % needs.length]!,
        lastCardWeekStart: last.get(r.id)!,
        waiting: Array.from({ length: 30 }, (_, j) => wc(`w${w}-${j}`, j, Math.floor(rnd() * 100), rnd() < 0.5)),
      }));
      for (const o of pickLabelCards({ week: { key: `wk${w}`, start }, pickedThisWeek: 0, open: 0, rows })) {
        picks.get(o.row)!.push(w);
        last.set(o.row, start);
      }
    }
    return picks;
  }
  for (const nRows of [4, 10]) {
    it(`a 52-week run with ${nRows} rows always waiting gives each a card in every window of ${LABEL_ROW_MAX_GAP_WEEKS} weeks`, () => {
      for (const [row, weeks] of answeredRun(nRows)) {
        for (let s = 0; s + LABEL_ROW_MAX_GAP_WEEKS <= 52; s++) {
          expect(weeks.some((w) => w >= s && w < s + LABEL_ROW_MAX_GAP_WEEKS), `${row} in weeks ${s}..${s + LABEL_ROW_MAX_GAP_WEEKS - 1}`).toBe(true);
        }
      }
    });
  }

  it('a run in which the operator answers nothing never holds more than ten open', () => {
    const rnd = prng(42);
    const rowList = Array.from({ length: 6 }, (_, i) => fixtureRow(`r${i}`, i % 2 ? 'gate' : 'advice', 0.1));
    let open = 0;
    let pickedThisWeek = 0;
    let week = -1;
    for (let day = 0; day < 52 * 7; day++) {
      if (Math.floor(day / 7) !== week) { week = Math.floor(day / 7); pickedThisWeek = 0; }
      const rows = rowList.map((r, i) => facts(r, {
        needed: ([29, 59, 'far', 'none', 4, 12] as PickRowFacts['needed'][])[i]!,
        lastCardWeekStart: 'never',
        waiting: Array.from({ length: 12 }, (_, j) => wc(`d${day}-${j}`, j, Math.floor(rnd() * 9))),
      }));
      const out = pickLabelCards({ week: { key: `wk${week}`, start: (200 + week) * WEEK_MS }, pickedThisWeek, open, rows });
      open += out.length;
      pickedThisWeek += out.length;
      expect(open).toBeLessThanOrEqual(LABEL_CARDS_PER_WEEK);
      expect(pickedThisWeek).toBeLessThanOrEqual(LABEL_CARDS_PER_WEEK);
    }
    expect(open).toBe(LABEL_CARDS_PER_WEEK);
  });
});

describe('cardShown (LQ13, F12)', () => {
  const card = { row: 'relay.method' as DecisionRowId, revision: 'rev1' };
  it('hides while the row is off, and when the revision is not the card\'s', () => {
    expect(cardShown(card, { mode: 'off', revision: 'rev1' })).toBe('hidden');
    expect(cardShown(card, { mode: 'shadow', revision: 'rev2' })).toBe('hidden');
    expect(cardShown(card, { mode: 'armed', revision: 'rev2' })).toBe('hidden');
    expect(cardShown(card, { mode: 'off', revision: 'rev2' })).toBe('hidden');
  });
  it('shows a shadow or armed row at the card\'s revision', () => {
    expect(cardShown(card, { mode: 'shadow', revision: 'rev1' })).toBe('shown');
    expect(cardShown(card, { mode: 'armed', revision: 'rev1' })).toBe('shown');
  });
});

describe('labelFor (LQ8)', () => {
  const l = (source: DecisionLabelSource, label: LabelledAnswer['label'], at: number) => ({ source, label, at });
  it('no labels answer none', () => { expect(labelFor([])).toBe('none'); });
  it('one label stands, with nothing retired', () => {
    expect(labelFor([l('label-queue', 'yes', 5)])).toEqual({ label: 'yes', source: 'label-queue', retired: [] });
  });
  it('two label-queue labels: the newest stands, whatever the order', () => {
    expect(labelFor([l('label-queue', 'yes', 5), l('label-queue', 'no', 9)])).toEqual({ label: 'no', source: 'label-queue', retired: [] });
    expect(labelFor([l('label-queue', 'no', 9), l('label-queue', 'yes', 5)])).toEqual({ label: 'no', source: 'label-queue', retired: [] });
  });
  it('a tie in at: the later in the input stands', () => {
    expect(labelFor([l('label-queue', 'yes', 5), l('routed-to', 'no', 5)])).toMatchObject({ label: 'no', source: 'routed-to' });
    expect(labelFor([l('routed-to', 'no', 5), l('label-queue', 'yes', 5)])).toMatchObject({ label: 'yes', source: 'label-queue' });
  });
  it('an outcome retires an operator answer, even a newer one', () => {
    expect(labelFor([l('outcome', 'no', 1), l('operator-answer', 'yes', 9)]))
      .toEqual({ label: 'no', source: 'outcome', retired: ['operator-answer'] });
  });
  it('an outcome retires an overturn', () => {
    expect(labelFor([l('overturn', 'yes', 9), l('outcome', 'no', 1)]))
      .toEqual({ label: 'no', source: 'outcome', retired: ['overturn'] });
  });
  it('both retired are listed once each, in the catalogue order of sources', () => {
    expect(labelFor([l('overturn', 'yes', 3), l('operator-answer', 'no', 4), l('overturn', 'no', 5), l('outcome', 'yes', 0)]))
      .toEqual({ label: 'yes', source: 'outcome', retired: ['operator-answer', 'overturn'] });
  });
  it('an outcome does not retire a label-queue or routed-to label: the newest of what remains stands', () => {
    expect(labelFor([l('outcome', 'yes', 2), l('label-queue', 'no', 7), l('operator-answer', 'no', 9)]))
      .toEqual({ label: 'no', source: 'label-queue', retired: ['operator-answer'] });
    expect(labelFor([l('outcome', 'yes', 8), l('routed-to', 'no', 7)])).toMatchObject({ label: 'yes', source: 'outcome', retired: [] });
  });
  it('without an outcome an operator answer and an overturn stand on their age', () => {
    expect(labelFor([l('operator-answer', 'yes', 3), l('overturn', 'no', 4)])).toEqual({ label: 'no', source: 'overturn', retired: [] });
  });
  it('carries an option label whole', () => {
    expect(labelFor([l('routed-to', { option: 'p1' }, 1)])).toEqual({ label: { option: 'p1' }, source: 'routed-to', retired: [] });
  });
});

describe('cardAnswerVerdict (LQ12, LQ13)', () => {
  const open = { closedAt: null, row: 'relay.method' as DecisionRowId, revision: 'rev1' };
  const nowYn = { mode: 'shadow' as const, revision: 'rev1', row: yesNo, options: [] as readonly string[] };
  const nowChoice = { mode: 'armed' as const, revision: 'rev1', row: choiceRow, options: ['p1', 'p2'] };
  it('a closed card is already, whatever the answer or the row now', () => {
    expect(cardAnswerVerdict({ ...open, closedAt: 5 }, nowYn, 'yes')).toEqual({ kind: 'already' });
    expect(cardAnswerVerdict({ ...open, closedAt: 0 }, { ...nowYn, mode: 'off' }, 'garbage')).toEqual({ kind: 'already' });
  });
  it('an off row, or a changed revision, refuses row-changed before the answer is read', () => {
    expect(cardAnswerVerdict(open, { ...nowYn, mode: 'off' }, 'yes')).toEqual({ kind: 'refuse', word: 'row-changed' });
    expect(cardAnswerVerdict(open, { ...nowYn, revision: 'rev2' }, 'yes')).toEqual({ kind: 'refuse', word: 'row-changed' });
    expect(cardAnswerVerdict(open, { ...nowYn, revision: 'rev2' }, 'junk')).toEqual({ kind: 'refuse', word: 'row-changed' });
    expect(cardAnswerVerdict(open, { ...nowYn, mode: 'off' }, 'not-sure')).toEqual({ kind: 'refuse', word: 'row-changed' });
  });
  it('not-sure closes with no label, on either kind of row', () => {
    expect(cardAnswerVerdict(open, nowYn, 'not-sure')).toEqual({ kind: 'not-sure' });
    expect(cardAnswerVerdict(open, nowChoice, 'not-sure')).toEqual({ kind: 'not-sure' });
  });
  it('a yes-no row labels yes and no, and refuses none', () => {
    expect(cardAnswerVerdict(open, nowYn, 'yes')).toEqual({ kind: 'label', label: 'yes' });
    expect(cardAnswerVerdict(open, nowYn, 'no')).toEqual({ kind: 'label', label: 'no' });
    expect(cardAnswerVerdict(open, nowYn, 'none')).toEqual({ kind: 'refuse', word: 'bad-request' });
  });
  it('a choice row labels a listed option or none, and refuses yes, no and an unknown option', () => {
    expect(cardAnswerVerdict(open, nowChoice, { option: 'p2' })).toEqual({ kind: 'label', label: { option: 'p2' } });
    expect(cardAnswerVerdict(open, nowChoice, 'none')).toEqual({ kind: 'label', label: 'none' });
    expect(cardAnswerVerdict(open, nowChoice, 'yes')).toEqual({ kind: 'refuse', word: 'bad-request' });
    expect(cardAnswerVerdict(open, nowChoice, 'no')).toEqual({ kind: 'refuse', word: 'bad-request' });
    expect(cardAnswerVerdict(open, nowChoice, { option: 'p9' })).toEqual({ kind: 'refuse', word: 'bad-request' });
  });
  it('a non-object, an extra key, a non-string option and a wrong word are bad-request', () => {
    for (const bad of [undefined, null, 7, true, [], ['yes'], {}, { option: 'p1', extra: 1 }, { option: 3 }, { opt: 'p1' }, 'Yes', '', 'maybe']) {
      expect(cardAnswerVerdict(open, nowChoice, bad), JSON.stringify(bad)).toEqual({ kind: 'refuse', word: 'bad-request' });
    }
    expect(cardAnswerVerdict(open, nowYn, { option: 'p1' })).toEqual({ kind: 'refuse', word: 'bad-request' });
    expect(cardAnswerVerdict(open, nowYn, null)).toEqual({ kind: 'refuse', word: 'bad-request' });
  });
  it('the allowed answers: yes, no, not-sure; or each option, none, not-sure', () => {
    expect(cardAllowedAnswers(yesNo, [])).toEqual(['yes', 'no', 'not-sure']);
    expect(cardAllowedAnswers(choiceRow, ['p1', 'p2'])).toEqual([{ option: 'p1' }, { option: 'p2' }, 'none', 'not-sure']);
  });
});

describe('cardView (LQ10)', () => {
  const card: LabelCardRow = {
    id: 7, week: '2026-W48', row: 'readback.omits', revision: Q['readback.omits'].revision, stateHash: 'hash', recordId: 3,
    pickedAt: 1234, closedAt: null, closedBy: null, outcome: null,
  };
  const row = Q['readback.omits'];
  it('answers the fixed question, the fields in catalogue order with quoted marked, and the allowed answers', () => {
    const v = cardView(card, row, { readback: 'what a session wrote', request: 'asked words', doneTest: ['a', 'b'] }, []);
    expect(v).toEqual({
      id: 7, row: 'readback.omits', question: row.instructions, pickedAt: 1234, week: '2026-W48',
      fields: [
        { name: 'request', quoted: false, text: 'asked words' },
        { name: 'readback', quoted: true, text: 'what a session wrote' },
        { name: 'doneTest', quoted: false, text: ['a', 'b'] },
      ],
      answers: ['yes', 'no', 'not-sure'],
    } satisfies CardView);
  });
  it('leaves out a catalogue field that is not present', () => {
    expect(cardView(card, row, { readback: 'x' }, []).fields).toEqual([{ name: 'readback', quoted: true, text: 'x' }]);
  });
  it('never carries a verdict, p, band or line, whatever extra keys the fields hold', () => {
    const v = cardView(card, row, { readback: 'x', request: 'y', verdict: 'yes', p: '0.9', band: 'likely', line: '0.95', probability: '1' }, []);
    expect(v.fields.map((f) => f.name)).toEqual(['request', 'readback']);
    const json = JSON.stringify(v);
    for (const word of ['verdict', '"p"', 'band', 'line', 'probability', 'likely']) expect(json).not.toContain(word);
    expect(Object.keys(v).sort()).toEqual(['answers', 'fields', 'id', 'pickedAt', 'question', 'row', 'week']);
  });
  it('a choice row shows its options', () => {
    const c: LabelCardRow = { ...card, row: 'programme.pick' };
    expect(cardView(c, choiceRow, { request: 'r' }, ['p1']).answers).toEqual([{ option: 'p1' }, 'none', 'not-sure']);
  });
});
