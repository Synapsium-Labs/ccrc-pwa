// The one reader of the Waiting on you list's wire shape, and of one programme's Goals view (`waitingView.ts`; carry C,
// D-7951; review 1437 A2: `isGoalsFor` was covered through the programme screen only).
import { describe, expect, it } from 'vitest';
import { isGoalsFor, isWaitingView } from '../src/ledgers/waitingView';

const goals = { program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] };

describe('isGoalsFor', () => {
  it("is the Goals view of the programme it names, whose modifications are a list", () => {
    expect(isGoalsFor(goals, 'prog-a')).toBe(true);
    expect(isGoalsFor({ ...goals, modifications: [{ id: 1 }] }, 'prog-a')).toBe(true);
  });

  it("is not another programme's view, nor one whose modifications are not a list", () => {
    expect(isGoalsFor(goals, 'prog-b')).toBe(false);
    expect(isGoalsFor({ ...goals, modifications: null }, 'prog-a')).toBe(false);
    expect(isGoalsFor({ ...goals, modifications: {} }, 'prog-a')).toBe(false);
    const { modifications: _gone, ...without } = goals;
    expect(isGoalsFor(without, 'prog-a')).toBe(false);
  });

  it('is not a value that is no record', () => {
    for (const v of [null, undefined, 'prog-a', 1, [], [goals]]) expect(isGoalsFor(v, 'prog-a'), JSON.stringify(v)).toBe(false);
  });
});

describe('isWaitingView', () => {
  it('is three lists, an empty list included, and nothing short of that', () => {
    expect(isWaitingView({ items: [], cleared: [], goals: [] })).toBe(true);
    expect(isWaitingView({ items: [], cleared: [] })).toBe(false);
    expect(isWaitingView({ items: null, cleared: [], goals: [] })).toBe(false);
    expect(isWaitingView(null)).toBe(false);
  });
});
