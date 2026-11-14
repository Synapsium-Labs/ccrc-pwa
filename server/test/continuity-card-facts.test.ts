// Overlord W1a, the card piece, PR B (plan `w1a-card.md` Task 3): `gatherCardFacts` reads one session's facts from the rows,
// keeps every failed read as an `unmeasured` fact naming it, fills `everTicked` from `tickedAt`, and takes the role from
// `roleOf(roleFactsOf(…))`, an undecided reading naming the fact it could not measure (C49).
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { CARD_HISTORY, gatherCardFacts, type CardFactsDeps } from '../src/continuity/cardFacts.js';
import { cardRoleOf } from '../src/continuity/card.js';
import { roleFactsOf } from '../src/roleOf.js';
import type { ChildMark, ChildReclaimGeneration } from '../../shared/api.js';
import type { CardFacts, Fact } from '../../shared/continuity-card.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ME = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-card-facts-'), '.ccrc', 'coord.db')));
const deps = (coord: CoordStore, over: Partial<CardFactsDeps> = {}): CardFactsDeps => ({
  coord, childMark: async (): Promise<ChildMark | null> => ({ kind: 'none' }),
  incarnation: async (): Promise<ChildReclaimGeneration> => ({ kind: 'value', v: INC }), ...over,
});
const value = <T>(f: Fact<T>): T => { if (f.kind !== 'read') throw new Error(`unmeasured: ${f.what}`); return f.value; };
const openRun = (c: CoordStore, program: string, claimedBy: string, wave = 1): number =>
  (c.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave, waveOf: 3, claimedBy }) as { id: number }).id;
const raise = (c: CoordStore, program: string, raisedBy: string, title: string, at = NOW - 5_000): number =>
  c.raiseItem({ program, runId: null, raisedBy, kind: 'do', title, why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, at);
const declareIntent = (c: CoordStore, sessionId: string, incarnation: string, at: number | null): void => {
  c.db.prepare('INSERT INTO delegation_sessions (sessionId, parentIncarnation, explicitIntentAt, effective, effectiveBasisJson, '
    + 'claudeSessionIdsJson, firstObservedAt, lastObservedAt) VALUES (?, ?, ?, 0, ?, ?, ?, ?)')
    .run(sessionId, incarnation, at, '[]', '[]', NOW - 10, NOW - 10);
};
const gather = (c: CoordStore, over: Partial<CardFactsDeps> = {}): Promise<{ facts: CardFacts; renderer: string }> =>
  gatherCardFacts(deps(c, over), ME, NOW);

describe('gatherCardFacts: each fact is read from its rows', () => {
  it('a coordinator: its open runs, its programme ledger, its claims, its raised items, its outstanding mail', async () => {
    const c = store();
    const r1 = openRun(c, 'prog-a', ME, 2);
    openRun(c, 'prog-b', OTHER);
    c.setSpecPin('prog-a', 'docs/spec.md', 'Ship the card.', NOW - 1_000, ['the card door answers']);
    c.addModification('prog-a', { text: 'drop the badge', ruling: 'agreed', itemId: null, pr: null }, NOW - 900);
    const mine = raise(c, 'prog-a', ME, 'pick a name');
    const theirs = raise(c, 'prog-a', OTHER, 'pick a colour', NOW - 4_000);
    const claim = c.claimAttempt({ project: 'project-a', paths: ['server/src/a.ts'], sessionId: ME, uuid: 'u', runId: r1, intent: 'x', now: NOW });
    c.claimAttempt({ project: 'project-a', paths: ['server/src/b.ts'], sessionId: OTHER, uuid: 'u', runId: null, intent: 'y', now: NOW });
    const m = c.insertMail({ fromId: 'coordinator', fromUuid: 'u', toId: ME, runId: r1, kind: 'status', subject: 'wave-brief', body: 'b', artifacts: [] });
    const d = c.queueDelivery(m.id, ME, '<mail/>').id;
    const { facts: f, renderer } = await gather(c);

    expect(renderer).toBe('coordinator');
    expect(f.role).toBe('coordinator');
    expect(f.roleWhy).toBe('it claims an open run');
    expect(f.at).toBe(NOW);
    expect(value(f.runs)).toEqual([{ id: r1, programme: 'prog-a', wave: 2, waveOf: 3, state: 'planned', planPath: null, kind: 'work' }]);
    const ledger = value(f.ledger);
    expect(ledger.map((p) => p.slug)).toEqual(['prog-a']);
    expect(ledger[0]!.goals).toEqual([{ text: 'Ship the card.', ratified: false }, { text: 'the card door answers', ratified: false }]);
    expect(ledger[0]!.decisions).toEqual([{ at: NOW - 900, text: 'drop the badge (ruling: agreed)' }]);
    expect(ledger[0]!.openItems.map((i) => i.id)).toEqual([mine, theirs]);
    expect(value(f.claims)).toEqual([{ id: (claim as { claims: { id: number }[] }).claims[0]!.id, paths: ['server/src/a.ts'], runId: r1 }]);
    expect(value(f.itemsRaised).map((i) => [i.id, i.text, i.at, i.everTicked])).toEqual([[mine, 'pick a name', NOW - 5_000, false]]);
    expect(value(f.mailOutstanding)).toEqual([{ deliveryId: d, fromId: 'coordinator', at: expect.any(Number), subject: 'wave-brief' }]);
    expect(value(f.intent)).toBe(false);
    expect(value(f.notes)).toEqual([]);
    expect(value(f.checkpoint)).toBeNull();
    expect(value(f.history)).toEqual(CARD_HISTORY);
  });

  it('everTicked is true for an item the operator ticked, even after it was returned to open, for both item lists', async () => {
    const c = store();
    openRun(c, 'prog-a', ME);
    const ticked = raise(c, 'prog-a', ME, 'ticked');
    const fresh = raise(c, 'prog-a', ME, 'fresh', NOW - 4_000);
    c.moveItem(ticked, 'tick', 'operator', { answer: 'yes' }, NOW - 3_000, { programmeHasOpenRun: true });
    c.moveItem(ticked, 'return', 'coordinator', { note: 'again' }, NOW - 2_000, { programmeHasOpenRun: true });
    const { facts: f } = await gather(c);
    const byId = new Map(value(f.itemsRaised).map((i) => [i.id, i]));
    expect(byId.get(ticked)).toMatchObject({ state: 'open', everTicked: true });
    expect(byId.get(fresh)).toMatchObject({ everTicked: false });
    const ledgerItems = new Map(value(f.ledger)[0]!.openItems.map((i) => [i.id, i.everTicked]));
    expect([...ledgerItems]).toEqual([[ticked, true], [fresh, false]]);
  });

  it('a coordinator between runs, with declared intent, gets the programme of the newest run it claimed (C51)', async () => {
    const c = store();
    const old = openRun(c, 'prog-old', ME);
    const run = openRun(c, 'prog-a', ME);
    c.db.prepare("UPDATE runs SET state = 'done' WHERE id IN (?, ?)").run(old, run);
    declareIntent(c, ME, INC, NOW - 100);
    const { facts: f, renderer } = await gather(c);
    expect(value(f.runs)).toEqual([]);
    expect(value(f.intent)).toBe(true);
    expect(f.role).toBe('coordinator');
    expect(f.roleWhy).toBe('it declared coordinator intent');
    expect(renderer).toBe('coordinator');
    expect(value(f.ledger).map((p) => p.slug)).toEqual(['prog-a']);
  });

  it('intent is read on the current incarnation only; a row with no explicitIntentAt is not intent', async () => {
    const c = store();
    declareIntent(c, ME, 'another-incarnation', NOW - 100);
    expect(value((await gather(c)).facts.intent)).toBe(false);
    declareIntent(c, ME, INC, null);
    expect(value((await gather(c)).facts.intent)).toBe(false);
    expect(value((await gather(c, { incarnation: async () => ({ kind: 'absent' }) })).facts.intent)).toBe(false);
  });

  it('a plain session with nothing reads every fact, each empty, and its role is plain', async () => {
    const { facts: f, renderer } = await gather(store());
    expect(f.role).toBe('plain');
    expect(renderer).toBe('plain');
    for (const k of ['runs', 'ledger', 'claims', 'itemsRaised', 'mailOutstanding'] as const) expect(value(f[k])).toEqual([]);
  });

  it('a worker: the run it is bound to, by its child mark and the run kind', async () => {
    const c = store();
    const run = openRun(c, 'prog-a', OTHER);
    c.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(ME, run);
    const { facts: f, renderer } = await gather(c, { childMark: async () => ({ kind: 'child', runId: run }) });
    expect(f.role).toBe('worker');
    expect(f.roleWhy).toBe(`a child of run ${run}, a work run`);
    expect(renderer).toBe('worker');
    expect(value(f.runs).map((r) => r.id)).toEqual([run]);
  });
});

describe('gatherCardFacts: a read that fails is a fact naming what failed, never an empty list', () => {
  const throws = (): never => { throw new Error('disk I/O error'); };
  const cases: [string, (c: CoordStore) => void, keyof CardFacts, string][] = [
    ['runs', (c) => { c.runs = throws; }, 'runs', 'the runs'],
    ['runs (a refusal)', (c) => { c.runs = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' }); }, 'runs', 'the runs'],
    ['claims', (c) => { c.activeClaims = throws; }, 'claims', 'the claims'],
    ['intent', (c) => { c.coordinatorIntentDeclared = throws; }, 'intent', 'declared coordinator intent'],
    ['intent (a refusal)', (c) => { c.coordinatorIntentDeclared = () => ({ ok: false, detail: 'x' }); }, 'intent', 'declared coordinator intent'],
    ['items', (c) => { c.itemsFor = throws; }, 'itemsRaised', 'the items you raised'],
    ['goals', (c) => { c.goalsFor = throws; }, 'ledger', 'the programme ledger'],
    ['mail', (c) => { c.outstandingMailFor = throws; }, 'mailOutstanding', 'the outstanding mail'],
  ];
  for (const [name, breakIt, key, what] of cases) {
    it(`${name}: ${String(key)} is unmeasured, naming ${what}`, async () => {
      const c = store();
      openRun(c, 'prog-a', ME);
      breakIt(c);
      const f = (await gather(c)).facts;
      expect(f[key]).toEqual({ kind: 'unmeasured', what });
    });
  }

  it('an unreadable incarnation leaves intent unmeasured, naming the incarnation', async () => {
    const f = (await gather(store(), { incarnation: async () => ({ kind: 'unreadable' }) })).facts;
    expect(f.intent).toEqual({ kind: 'unmeasured', what: 'declared coordinator intent (the registry incarnation)' });
  });

  it('the runs unread: the ledger is unmeasured too, naming why, and the role is undecided between coordinator and plain', async () => {
    const c = store();
    c.runs = throws;
    const { facts: f, renderer } = await gather(c);
    expect(f.ledger).toEqual({ kind: 'unmeasured', what: 'the programme ledger (its programmes are read from the runs)' });
    expect(f.role).toBe('undecided');
    expect(f.roleWhy).toBe('its runs could not be read: coordinator or plain');
    expect(renderer).toBe('coordinator');
  });

  it('the intent unread on a session that claims no run: undecided, naming the intent (C49)', async () => {
    const f = (await gather(store(), { incarnation: async () => ({ kind: 'unreadable' }) })).facts;
    expect(f.role).toBe('undecided');
    expect(f.roleWhy).toBe('its declared coordinator intent could not be read: coordinator or plain');
  });

  it('the child mark unread (the registry could not say, or the read threw): undecided between worker and reviewer', async () => {
    for (const childMark of [async () => null, async (): Promise<never> => { throw new Error('io'); }]) {
      const { facts: f, renderer } = await gather(store(), { childMark });
      expect(f.role).toBe('undecided');
      expect(f.roleWhy).toBe('its child marker could not be read: worker or reviewer');
      expect(renderer).toBe('worker');
    }
  });

  it("a child whose run cannot be read: undecided, naming the run", async () => {
    const f = (await gather(store(), { childMark: async () => ({ kind: 'child', runId: 99 }) })).facts;
    expect(f.role).toBe('undecided');
    expect(f.roleWhy).toBe('a child of run 99, whose kind could not be read: worker or reviewer');
  });
});

describe('cardRoleOf: every role is drawn by its FLEET_ROLES renderer', () => {
  it('worker, reviewer, coordinator and plain, from the facts that decide them', () => {
    const at = (child: ChildMark, kind: 'work' | 'review' | 'unmeasured', open: boolean, intent: boolean) =>
      cardRoleOf(roleFactsOf(ME, { child, childRunKind: kind, openCoordinators: new Set(open ? [ME] : []), intentDeclared: intent }));
    expect(at({ kind: 'child', runId: 7 }, 'review', false, false)).toEqual({ role: 'reviewer', roleWhy: 'a child of run 7, a review run', renderer: 'reviewer' });
    expect(at({ kind: 'none' }, 'unmeasured', true, true)).toEqual({ role: 'coordinator', roleWhy: 'it claims an open run', renderer: 'coordinator' });
    expect(at({ kind: 'none' }, 'unmeasured', false, false).renderer).toBe('plain');
  });
});
