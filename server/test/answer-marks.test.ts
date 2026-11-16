// Overlord W1, answer marks (plan w1-delegation-marks.md Tasks 1 and 5): the vocabulary, the door's body parser, `itemMarkable`,
// `askMarkable` and the mark's view. The cases live in `sim/answerMarkSets.ts`, so `mutation-floors.test.ts` judges each mutant by the same
// list; the agreements between `itemMarkable` and the list (`itemsFor`), and between `askMarkable` and the asks the view
// lists (`askMarkTargets`), are here, over a real coord.db.
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import * as deciders from '../src/coord/answerMarks.js';
import * as vocab from '../../shared/answerMarks.js';
import { CLEARED_WINDOW_MS, ITEM_KINDS, ITEM_STATES } from '../../shared/ledgers.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { HOUR, NOW, WINDOW, askMarkableCases, itemMarkableCases, markViewCases, parseWriteCases } from './sim/answerMarkSets.js';
import type { LiveAskRead } from '../src/coord/ports.js';
import type { SuiteCase } from './sim/mutate.js';

const suite = (name: string, cases: Record<string, SuiteCase>): void => {
  describe(name, () => { for (const [n, c] of Object.entries(cases)) it(n, () => c()); });
};

suite('parseAnswerMarkWrite: exactly { kind, id, mark, value }', parseWriteCases(vocab));
suite('itemMarkable: the boxes follow the list', itemMarkableCases(deciders));
suite('markViewOf and itemMarksView: four answers, none of them null', markViewCases(deciders));
suite('askMarkable, askLiveOf and askListsView: the boxes follow today\'s ask states', askMarkableCases(deciders));

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

describe('the agreement: askMarkTargets lists exactly the asks askMarkable calls markable', () => {
  let coord: CoordStore;
  beforeEach(() => { coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-answer-marks-asks-'), '.ccrc', 'coord.db'))); });

  it('over every state, live or not, newest or not, reached or not, answered by the operator or its parent, inside and outside the window', () => {
    const runId = (coord.openRun({ program: 'prog-a', title: 'PROG-A', project: 'project-a', wave: 1, waveOf: null, claimedBy: 'lane-a' }) as { id: number }).id;
    const times = [NOW - HOUR, NOW - CLEARED_WINDOW_MS, NOW - CLEARED_WINDOW_MS - 1, NOW - CLEARED_WINDOW_MS - 3 * HOUR];
    const insert = coord.db.prepare(
      'INSERT INTO asks (at, childId, parentId, runId, askKey, askAt, dialogId, question, options, state, answeredBy, answeredAt, releasedAt, ' +
      "reachedOperatorAt) VALUES (?, ?, 'lane-a-parent', ?, ?, 1, 'd', 'q?', '[]', ?, ?, ?, ?, ?)",
    );
    const keys = new Map<string, string>();
    let n = 0;
    const states = ['held', 'answering', 'answered', 'released', 'declined', 'stale', 'unknown', 'archived'];
    for (const state of states) {
      for (const t of times) {
        for (const by of state === 'answered' ? ['operator', 'lane-a-parent'] : [null]) {
          // The reach stamp (review 2217 F1): none, or the release's, older than every window.
          for (const reached of [null, NOW - 5 * CLEARED_WINDOW_MS]) {
            // Two asks a child: an older one, then the newest, whose key the port reads for half the children.
            const child = `lane-a-child-${n++}`;
            for (const which of ['old', 'new']) {
              insert.run(NOW - 5 * CLEARED_WINDOW_MS, child, runId, `${child}-${which}`, state, by, state === 'answered' ? t : null,
                state === 'held' ? null : t, reached);
            }
            if (n % 2 === 0) keys.set(child, `${child}-new`);
            else if (n % 3 === 0) keys.set(child, `${child}-old`);
          }
        }
      }
    }
    const port: LiveAskRead = (c) => (c.endsWith('7') ? { kind: 'unmeasured' } : { kind: 'read', key: keys.get(c) ?? null });
    const read = coord.askMarkTargets(NOW, port);
    if (!read.ok) throw new Error(read.detail);
    const listed = read.rows.map((r) => r.id).sort((a, b) => a - b);
    const all = coord.db.prepare('SELECT id FROM asks ORDER BY id').all() as { id: number }[];
    const markable = all.map((r) => r.id).filter((id) => {
      const got = coord.askById(id);
      if (!got.ok || got.ask === null) throw new Error(`ask ${id}`);
      const ask = got.ask;
      const newest = coord.currentAskFor(ask.childId);
      const isNewest = newest.ok && newest.ask?.id === ask.id;
      const open = ask.state === 'released' || ask.state === 'declined' || ask.state === 'answering';
      const live = open && isNewest ? deciders.askLiveOf(port(ask.childId), ask.askKey) : false;
      const { reachedOperatorAt } = coord.db.prepare('SELECT reachedOperatorAt FROM asks WHERE id = ?').get(id) as { reachedOperatorAt: number | null };
      return deciders.askMarkable({ ...ask, reachedOperatorAt }, live, NOW).markable;
    });
    expect(listed.length).toBeGreaterThan(10);
    expect(markable).toEqual(listed);
    // The moves past released are among them (review 2217 F1): answering, stale and answered by the parent, each reached.
    const stateOf = coord.db.prepare('SELECT state, answeredBy, reachedOperatorAt FROM asks WHERE id = ?');
    const moved = new Set(listed.map((id) => {
      const r = stateOf.get(id) as { state: string; answeredBy: string | null; reachedOperatorAt: number | null };
      return r.reachedOperatorAt === null ? '' : `${r.state}:${r.answeredBy ?? ''}`;
    }));
    for (const s of ['answering:', 'stale:', 'answered:lane-a-parent']) expect(moved.has(s), s).toBe(true);
    // A live ask past the window is among them, and an older ask of a live child is not live.
    expect(read.rows.some((r) => r.live === true && r.at < NOW - CLEARED_WINDOW_MS)).toBe(true);
    expect(read.rows.filter((r) => r.live === true).every((r) => keys.get(r.childId) === `${r.childId}-new`)).toBe(true);
  });
});
