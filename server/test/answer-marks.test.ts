// Overlord W1, answer marks (plan w1-delegation-marks.md Task 1): the vocabulary, the door's body parser, `itemMarkable` and
// the mark's view. The cases live in `sim/answerMarkSets.ts`, so `mutation-floors.test.ts` judges each mutant by the same
// list; the agreement between `itemMarkable` and the list (`itemsFor`) is here, over a real coord.db.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import * as deciders from '../src/coord/answerMarks.js';
import * as vocab from '../../shared/answerMarks.js';
import { CLEARED_WINDOW_MS, ITEM_KINDS, ITEM_STATES } from '../../shared/ledgers.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { HOUR, NOW, WINDOW, itemMarkableCases, markViewCases, parseWriteCases } from './sim/answerMarkSets.js';
import type { SuiteCase } from './sim/mutate.js';

const suite = (name: string, cases: Record<string, SuiteCase>): void => {
  describe(name, () => { for (const [n, c] of Object.entries(cases)) it(n, () => c()); });
};

suite('parseAnswerMarkWrite: exactly { kind, id, mark, value }', parseWriteCases(vocab));
suite('itemMarkable: the boxes follow the list', itemMarkableCases(deciders));
suite('markViewOf and itemMarksView: four answers, none of them null', markViewCases(deciders));

describe('the vocabulary', () => {
  it('names two kinds of row and two marks, and reads nothing else as either', () => {
    expect(vocab.ANSWER_MARK_KINDS).toEqual(['item', 'ask']);
    expect(vocab.ANSWER_MARK_NAMES).toEqual(['could-answer', 'unsure']);
    for (const v of ['approval', '', 'toString', null, 1]) {
      expect(vocab.isAnswerMarkKind(v)).toBe(false);
      expect(vocab.isAnswerMarkName(v)).toBe(false);
    }
    expect(Object.keys(vocab.ANSWER_MARK_STATE_MAP)).toEqual(['never', 'marked', 'withdrawn', 'unmeasured']);
  });
  it('the window the cases write out is the one the list reads', () => {
    expect(WINDOW).toBe(CLEARED_WINDOW_MS);
  });
});

describe('the agreement: the decide and value items itemsFor lists are exactly the items itemMarkable calls markable', () => {
  let coord: CoordStore;
  beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-answer-marks-'), '.ccrc', 'coord.db'))); });

  it('over every kind and state, held and not, settled inside the hold or not, inside and outside the window', () => {
    const closings = [NOW - HOUR, NOW - CLEARED_WINDOW_MS, NOW - CLEARED_WINDOW_MS - 1, NOW - CLEARED_WINDOW_MS - 3 * HOUR];
    const holds: (number | null)[] = [null, NOW + HOUR, NOW, NOW - 2 * HOUR, NOW - CLEARED_WINDOW_MS - 2 * HOUR];
    const ids: number[] = [];
    for (const kind of ITEM_KINDS) {
      for (const state of ITEM_STATES) {
        for (const heldUntil of holds) {
          for (const closedAt of state === 'open' || state === 'checking' ? [null] : closings) {
            const id = coord.raiseItem({
              program: 'prog-a', runId: null, raisedBy: 'lane-a-project-a', kind, title: `${kind} ${state}`, why: 'w', how: [],
              options: kind === 'decide' ? ['a', 'b'] : null, recommended: kind === 'decide' ? 0 : null,
              recommendedWhy: kind === 'decide' ? 'a is cheaper' : null, neededBy: 'soon', soonLabel: null, secretSlot: null,
            }, NOW - CLEARED_WINDOW_MS - 10 * HOUR);
            coord.db.prepare('UPDATE operator_items SET state = ?, heldUntil = ?, closedAt = ? WHERE id = ?').run(state, heldUntil, closedAt, id);
            ids.push(id);
          }
        }
      }
    }
    const { open, cleared } = coord.itemsFor(null, NOW);
    const listed = [...open, ...cleared].filter((r) => r.kind === 'decide' || r.kind === 'value').map((r) => r.id).sort((a, b) => a - b);
    const markable = ids.filter((id) => deciders.itemMarkable(coord.itemById(id)!, NOW).markable).sort((a, b) => a - b);
    expect(listed.length).toBeGreaterThan(10);
    expect(markable).toEqual(listed);
  });
});
