// D-7708 (programme ledgers, PL1): the item vocabulary, the transition table and the
// deciders in shared/ledgers.ts. Pure: no fs, no store. The table is DATA and
// `nextItemState` reads only it, so the first group walks the whole
// (state x act x actor) space against the five rows the spec names.
import { describe, it, expect } from 'vitest';
import {
  ITEM_KINDS, ITEM_STATES, OPEN_ITEM_STATES, ITEM_TRANSITIONS, nextItemState,
  orderItems, waitingCount, programmeWaitsOn, WAITS_ON_WORDS, isSlotSlug, isSpecPath,
  CLEARED_WINDOW_MS, SOON_LABEL_MAX, ITEM_TITLE_MAX, ITEM_TEXT_MAX, ITEM_STEPS_MAX,
  ITEM_OPTIONS_MAX, ANSWER_MAX,
  type ItemAct, type ItemActor, type ItemState, type ItemView, type NeededBy, type WaitsOn,
} from '../../shared/ledgers.js';
import type { RunKind, RunState } from '../../shared/api.js';

const ACTORS: readonly ItemActor[] = ['operator', 'coordinator'];
const ACTS = Object.keys(ITEM_TRANSITIONS) as ItemAct[];

// The five rows of the spec's Figure 2, spelled out independently of the table.
const EXPECTED: Record<ItemAct, { actor: ItemActor; from: readonly ItemState[]; to: ItemState }> = {
  tick: { actor: 'operator', from: ['open'], to: 'checking' },
  confirm: { actor: 'coordinator', from: ['checking'], to: 'done' },
  return: { actor: 'coordinator', from: ['checking'], to: 'open' },
  withdraw: { actor: 'coordinator', from: ['open', 'checking'], to: 'withdrawn' },
  dismiss: { actor: 'operator', from: ['open', 'checking'], to: 'dismissed' },
};

describe('vocabulary', () => {
  it('lists the kinds, the states and the open pair', () => {
    expect([...ITEM_KINDS]).toEqual(['decide', 'do', 'value', 'secret']);
    expect([...ITEM_STATES]).toEqual(['open', 'checking', 'done', 'withdrawn', 'dismissed']);
    expect([...OPEN_ITEM_STATES]).toEqual(['open', 'checking']);
  });

  it('exports the bounds with the plan\'s values', () => {
    expect(CLEARED_WINDOW_MS).toBe(7 * 24 * 3600 * 1000);
    expect(SOON_LABEL_MAX).toBe(40);
    expect(ITEM_TITLE_MAX).toBe(140);
    expect(ITEM_TEXT_MAX).toBe(2000);
    expect(ITEM_STEPS_MAX).toBe(12);
    expect(ITEM_OPTIONS_MAX).toBe(6);
    expect(ANSWER_MAX).toBe(2000);
  });
});

describe('the transition table', () => {
  it('has exactly the five rows of the spec', () => {
    expect(ACTS.sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const act of ACTS) expect(ITEM_TRANSITIONS[act], act).toEqual(EXPECTED[act]);
  });

  it("every act's row is honoured and every other (state, act, actor) is refused", () => {
    for (const state of ITEM_STATES) {
      for (const act of ACTS) {
        for (const actor of ACTORS) {
          const row = EXPECTED[act];
          const got = nextItemState(state, act, actor, { programmeHasOpenRun: false });
          const label = `${state} ${act} ${actor}`;
          if (!row.from.includes(state)) {
            expect(got, label).toEqual({ ok: false, why: 'not-open' });
          } else if (row.actor !== actor) {
            expect(got, label).toEqual({ ok: false, why: 'wrong-actor' });
          } else {
            expect(got, label).toEqual({ ok: true, to: row.to });
          }
        }
      }
    }
  });

  it('every act but dismiss ignores the programme context', () => {
    for (const state of ITEM_STATES) {
      for (const act of ACTS.filter((a) => a !== 'dismiss')) {
        for (const actor of ACTORS) {
          expect(nextItemState(state, act, actor, { programmeHasOpenRun: true }), `${state} ${act} ${actor}`)
            .toEqual(nextItemState(state, act, actor, { programmeHasOpenRun: false }));
        }
      }
    }
  });

  it('dismiss is refused while the programme has an open run', () => {
    expect(nextItemState('open', 'dismiss', 'operator', { programmeHasOpenRun: true }))
      .toEqual({ ok: false, why: 'programme-live' });
    expect(nextItemState('checking', 'dismiss', 'operator', { programmeHasOpenRun: true }))
      .toEqual({ ok: false, why: 'programme-live' });
    expect(nextItemState('open', 'dismiss', 'operator', { programmeHasOpenRun: false }))
      .toEqual({ ok: true, to: 'dismissed' });
  });

  it('a dismiss by the wrong actor or from a closed state is refused for that reason, not programme-live', () => {
    expect(nextItemState('open', 'dismiss', 'coordinator', { programmeHasOpenRun: true }))
      .toEqual({ ok: false, why: 'wrong-actor' });
    expect(nextItemState('done', 'dismiss', 'operator', { programmeHasOpenRun: true }))
      .toEqual({ ok: false, why: 'not-open' });
  });
});

function item(id: number, state: ItemState, neededBy: NeededBy, raisedAt: number): ItemView {
  return {
    id, program: 'prog-a', runId: null, kind: 'do', title: `t${id}`, why: 'w', how: [], options: null,
    neededBy, soonLabel: null, state, stale: false, raisedAt, tickedAt: null, closedAt: null,
    answer: null, note: null, secretSlot: null, secretSet: null, history: [],
  };
}

describe('orderItems', () => {
  it('puts blocking first and checking after open, oldest first within each', () => {
    const items = [
      item(1, 'open', 'later', 10),
      item(2, 'checking', 'blocking', 20),
      item(3, 'open', 'soon', 30),
      item(4, 'open', 'blocking', 40),
      item(5, 'open', 'blocking', 5),
    ];
    const before = items.map((i) => i.id);
    expect(orderItems(items).map((i) => i.id)).toEqual([5, 4, 2, 3, 1]);
    expect(items.map((i) => i.id), 'does not mutate its input').toEqual(before);
  });
});

describe('waitingCount', () => {
  it('counts open only', () => {
    const items = [item(1, 'open', 'soon', 1), item(2, 'open', 'later', 2), item(3, 'checking', 'blocking', 3),
      item(4, 'done', 'soon', 4)];
    expect(waitingCount(items)).toBe(2);
    expect(waitingCount([])).toBe(0);
  });
});

describe('programmeWaitsOn', () => {
  const r = (state: RunState, kind: RunKind) => ({ state, kind });
  const cases: [string, { state: RunState; kind: RunKind }[], WaitsOn][] = [
    ['no runs', [], 'ended'],
    ['planned work', [r('planned', 'work')], 'next-wave'],
    ['merging beats planned', [r('merging', 'work'), r('planned', 'work')], 'merge-queue'],
    ['work awaiting review', [r('awaiting-review', 'work')], 'review'],
    ['an active review run', [r('working', 'review')], 'review'],
    ['active work beats merging', [r('working', 'work'), r('merging', 'work')], 'work'],
    ['dispatched work is active', [r('dispatched', 'work')], 'work'],
    ['only terminal runs', [r('done', 'work'), r('failed', 'review')], 'ended'],
  ];
  for (const [name, runs, want] of cases) {
    it(`${name} -> ${want}`, () => { expect(programmeWaitsOn(runs)).toBe(want); });
  }

  it('words every WaitsOn exactly', () => {
    expect(WAITS_ON_WORDS).toEqual({
      work: 'work in progress',
      review: 'a review',
      'merge-queue': 'the merge queue',
      'next-wave': 'the next wave to start',
      ended: 'nothing: the programme has no open run',
    });
  });
});

describe('isSpecPath', () => {
  it('accepts a spec path', () => {
    expect(isSpecPath('docs/superpowers/specs/2026-10-31-x-design.md')).toBe(true);
  });
  it('refuses plans, parent hops, a leading slash, a double slash, a non-md file and a long path', () => {
    for (const p of [
      'docs/superpowers/plans/x.md', 'docs/superpowers/specs/../x.md', '/docs/superpowers/specs/x.md',
      'docs/superpowers/specs/x.html', 'docs/superpowers/specs//x.md', 'docs/superpowers/specs/',
      `docs/superpowers/specs/${'a'.repeat(200)}.md`,
    ]) expect(isSpecPath(p), p).toBe(false);
  });
  it('accepts a path of exactly 200 characters', () => {
    const p = `docs/superpowers/specs/${'a'.repeat(200 - 'docs/superpowers/specs/.md'.length)}.md`;
    expect(p).toHaveLength(200);
    expect(isSpecPath(p)).toBe(true);
  });
});

describe('isSlotSlug', () => {
  it('accepts a slug', () => {
    expect(isSlotSlug('npm-token')).toBe(true);
    expect(isSlotSlug('a')).toBe(true);
    expect(isSlotSlug('a'.repeat(40))).toBe(true);
  });
  it('refuses parent hops, capitals, slashes, a leading dash and 41 characters', () => {
    for (const s of ['../a', 'A', 'a/b', '-a', '', 'a'.repeat(41), 'a b', 'a.b']) {
      expect(isSlotSlug(s), JSON.stringify(s)).toBe(false);
    }
  });
});
