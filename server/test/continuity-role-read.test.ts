// Overlord W1a, the timers piece, PR B (plan `w1a-timers.md` Task 4): one role read for the card and the timer doors. A
// CHARACTERIZATION, green on `main` against card PR B's `gatherCardFacts` before the move: the role, its `roleWhy`, the
// renderer and the `intent` fact the card answers for a coordinator, a child worker, a child reviewer, a plain session and a
// registry that could not say. The move (slug one-role-read) keeps every pinned output. Fixture stores only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { gatherCardFacts, sessionRoleRead, type CardFactsDeps } from '../src/continuity/cardFacts.js';
import { CARD_REGISTRY_UNREAD } from '../src/continuity/card.js';
import type { ChildMark, ChildReclaimGeneration } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ME = 'lane-a-project-a';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-role-read-'), '.ccrc', 'coord.db')));
const deps = (coord: CoordStore, over: Partial<CardFactsDeps> = {}): CardFactsDeps => ({
  coord, childMark: async (): Promise<ChildMark | typeof CARD_REGISTRY_UNREAD> => ({ kind: 'none' }),
  incarnation: async (): Promise<ChildReclaimGeneration> => ({ kind: 'value', v: INC }), declaredIntent: () => false, ...over,
});
const openRun = (c: CoordStore, claimedBy: string, kind: 'work' | 'review' = 'work'): number =>
  (c.openRun({ program: `prog-${kind}`, title: 'P', project: 'project-a', wave: 1, waveOf: 2, claimedBy, kind }) as { id: number }).id;

/** What the card answers for the role: the four outputs the move must keep. The role read answers the same four, once. */
const cardRole = async (c: CoordStore, over: Partial<CardFactsDeps> = {}) => {
  const { facts, renderer } = await gatherCardFacts(deps(c, over), ME, NOW);
  const card = { role: facts.role, roleWhy: facts.roleWhy, renderer, intent: facts.intent };
  expect(await sessionRoleRead(deps(c, over), ME)).toEqual(card);
  return card;
};

describe('the role the card answers (characterization of card PR B, before and after the move)', () => {
  it('a coordinator: it claims an open run', async () => {
    const c = store();
    openRun(c, ME);
    expect(await cardRole(c)).toEqual({
      role: 'coordinator', roleWhy: 'it claims an open run', renderer: 'coordinator', intent: { kind: 'read', value: false },
    });
  });

  it('a child worker: a child of a work run', async () => {
    const c = store();
    const run = openRun(c, 'lane-c-project-a');
    expect(await cardRole(c, { childMark: async () => ({ kind: 'child', runId: run }) })).toEqual({
      role: 'worker', roleWhy: `a child of run ${run}, a work run`, renderer: 'worker', intent: { kind: 'read', value: false },
    });
  });

  it('a child reviewer: a child of a review run', async () => {
    const c = store();
    const run = openRun(c, 'lane-c-project-a', 'review');
    expect(await cardRole(c, { childMark: async () => ({ kind: 'child', runId: run }) })).toEqual({
      role: 'reviewer', roleWhy: `a child of run ${run}, a review run`, renderer: 'reviewer', intent: { kind: 'read', value: false },
    });
  });

  it('a plain session: no child mark, no open run, no intent', async () => {
    expect(await cardRole(store())).toEqual({
      role: 'plain', roleWhy: 'it claims no open run and declared no coordinator intent', renderer: 'plain',
      intent: { kind: 'read', value: false },
    });
  });

  it('a plain session with declared intent reads as a coordinator', async () => {
    expect(await cardRole(store(), { declaredIntent: () => true })).toEqual({
      role: 'coordinator', roleWhy: 'it declared coordinator intent', renderer: 'coordinator', intent: { kind: 'read', value: true },
    });
  });

  it('an unreadable registry: undecided across all four, the widest card, and its intent unmeasured when the incarnation is too', async () => {
    const r = await cardRole(store(), {
      childMark: async () => CARD_REGISTRY_UNREAD, incarnation: async () => ({ kind: 'unreadable' }),
    });
    expect(r).toEqual({
      role: 'undecided', roleWhy: 'the registry could not say whether it is a child: worker, reviewer, coordinator or plain',
      renderer: 'coordinator', intent: { kind: 'unmeasured', what: 'declared coordinator intent (the registry incarnation)' },
    });
  });

  it('no `.generation` file: intent reads false, and declared intent is never asked', async () => {
    let asked = 0;
    const r = await cardRole(store(), { incarnation: async () => ({ kind: 'absent' }), declaredIntent: () => { asked += 1; return true; } });
    expect(r.intent).toEqual({ kind: 'read', value: false });
    expect(asked).toBe(0);
  });

  it('the card reads the registry once for its role: one child-mark read and one incarnation read a card', async () => {
    const n = { child: 0, inc: 0 };
    await gatherCardFacts(deps(store(), {
      childMark: async () => { n.child += 1; return { kind: 'none' }; },
      incarnation: async () => { n.inc += 1; return { kind: 'value', v: INC }; },
    }), ME, NOW);
    expect(n).toEqual({ child: 1, inc: 1 });
  });
});
