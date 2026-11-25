// Overlord W1a, the card piece, PR B (plan `w1a-card.md` Task 3): `gatherCardFacts` reads one session's facts from the rows,
// keeps every failed read as an `unmeasured` fact naming it, fills `everTicked` from `tickedAt`, and takes the role from
// `roleOf(roleFactsOf(…))`, an undecided reading naming the fact it could not measure (C49).
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { DesignationRead, DesignationView } from '../../shared/overlord-designation.js';
import { CARD_HISTORY, gatherCardFacts, type CardFactsDeps } from '../src/continuity/cardFacts.js';
import { intentOfCheckpoint } from '../src/continuity/declaredIntent.js';
import { CARD_REGISTRY_UNREAD, cardRoleOf, snapshotFactsJson } from '../src/continuity/card.js';
import { timerPreview } from '../src/continuity/timers.js';
import { delegationIntentKey } from '../src/coord/delegation-model.js';
import { roleFactsOf } from '../src/roleOf.js';
import type { ChildMark, ChildReclaimGeneration } from '../../shared/api.js';
import { CARD_MAIL_MAX, type CardFacts, type Fact } from '../../shared/continuity-card.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ME = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const INC = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-card-facts-'), '.ccrc', 'coord.db')));
const deps = (coord: CoordStore, over: Partial<CardFactsDeps> = {}): CardFactsDeps => ({
  coord, childMark: async (): Promise<ChildMark | typeof CARD_REGISTRY_UNREAD> => ({ kind: 'none' }),
  incarnation: async (): Promise<ChildReclaimGeneration> => ({ kind: 'value', v: INC }), declaredIntent: () => false, ...over,
});
const value = <T>(f: Fact<T>): T => { if (f.kind !== 'read') throw new Error(`unmeasured: ${f.what}`); return f.value; };
const openRun = (c: CoordStore, program: string, claimedBy: string, wave = 1): number =>
  (c.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave, waveOf: 3, claimedBy }) as { id: number }).id;
const raise = (c: CoordStore, program: string, raisedBy: string, title: string, at = NOW - 5_000): number =>
  c.raiseItem({ program, runId: null, raisedBy, kind: 'do', title, why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null }, at);
const gather = (c: CoordStore, over: Partial<CardFactsDeps> = {}): Promise<{ facts: CardFacts; renderer: string }> =>
  gatherCardFacts(deps(c, over), ME, NOW);

describe('gatherCardFacts: each goal is ratified only when its version\'s verdict is (Overlord W1, portfolio B)', () => {
  it('a pin and a definition of done that rest on an unanswered item, or on nothing recorded, read not ratified; the operator\'s ratify flips them', async () => {
    const c = store();
    openRun(c, 'prog-a', ME, 2);
    c.setSpecPin('prog-a', 'docs/spec.md', 'Ship the card.', NOW - 1_000, null, { kind: 'coordinator' });
    c.db.prepare('UPDATE programs SET ratifiedBy = NULL WHERE slug = ?').run('prog-a');  // a pin from before the column
    const item = raise(c, 'prog-a', ME, 'which list?');
    const mod = c.addModification('prog-a', { text: 'new list', ruling: null, itemId: item, pr: null, doneWhen: ['it ships'] }, NOW - 900);
    const goalsOf = async (): Promise<unknown> => value((await gather(c)).facts.ledger)[0]!.goals;
    expect(await goalsOf()).toEqual([{ text: 'Ship the card.', ratified: false }, { text: 'it ships', ratified: false }]);
    expect(c.ratifyGoalsVersion('prog-a', { pin: { inShortAt: NOW - 1_000 } }, NOW, 'phone-a 0123abcd')).toEqual({ ok: true, changed: true });
    expect(c.ratifyGoalsVersion('prog-a', { modification: mod }, NOW, 'phone-a 0123abcd')).toEqual({ ok: true, changed: true });
    // Who ratified rides each ratified goal, for the card to say (review 2240 F8).
    expect(await goalsOf()).toEqual([{ text: 'Ship the card.', ratified: true, ratifiedBy: 'operator' }, { text: 'it ships', ratified: true, ratifiedBy: 'operator' }]);
  });
});

describe('gatherCardFacts: each fact is read from its rows', () => {
  it('a coordinator: its open runs, its programme ledger, its claims, its raised items, its outstanding mail', async () => {
    const c = store();
    const r1 = openRun(c, 'prog-a', ME, 2);
    openRun(c, 'prog-b', OTHER);
    c.setSpecPin('prog-a', 'docs/spec.md', 'Ship the card.', NOW - 1_000, ['the card door answers'], { kind: 'coordinator' });
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
    // (Question 1, operator item 328: yes.) A coordinator's own pin counts, so its goals read ratified, by the coordinator.
    expect(ledger[0]!.goals).toEqual([
      { text: 'Ship the card.', ratified: true, ratifiedBy: 'coordinator' }, { text: 'the card door answers', ratified: true, ratifiedBy: 'coordinator' }]);
    expect(ledger[0]!.decisions).toEqual([{ at: NOW - 900, text: 'drop the badge (ruling: agreed)' }]);
    expect(ledger[0]!.openItems.map((i) => i.id)).toEqual([mine, theirs]);
    expect(value(f.claims)).toEqual([{ id: (claim as { claims: { id: number }[] }).claims[0]!.id, paths: ['server/src/a.ts'], runId: r1 }]);
    expect(value(f.itemsRaised).map((i) => [i.id, i.text, i.at, i.everTicked])).toEqual([[mine, 'pick a name', NOW - 5_000, false]]);
    expect(value(f.mailOutstanding)).toEqual([{ deliveryId: d, fromId: 'coordinator', at: expect.any(Number), subject: 'wave-brief', parked: false }]);
    expect(f.mailMore).toBe(false);
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
    // Programme lifecycle W1 (R11): `openRun` no longer lets one claimant open runs in two programmes, so the older
    // programme's run is history from before it (a run claimed under the old rules): opened under a stand-in, then
    // claimed by ME and closed, as the migration finds such rows (an open one would be a conflict, and refuse ME prog-a).
    const old = openRun(c, 'prog-old', `${ME}-standin`);
    c.db.prepare("UPDATE runs SET claimedBy = ?, state = 'done' WHERE id = ?").run(ME, old);
    const run = openRun(c, 'prog-a', ME);
    c.db.prepare("UPDATE runs SET state = 'done' WHERE id IN (?, ?)").run(old, run);
    const { facts: f, renderer } = await gather(c, { declaredIntent: () => true });
    expect(value(f.runs)).toEqual([]);
    expect(value(f.intent)).toBe(true);
    expect(f.role).toBe('coordinator');
    expect(f.roleWhy).toBe('it declared coordinator intent');
    expect(renderer).toBe('coordinator');
    expect(value(f.ledger).map((p) => p.slug)).toEqual(['prog-a']);
  });

  it('intent is the delegation checkpoint\'s, on the current incarnation only (review 2023 F4)', async () => {
    const c = store();
    const cp = (...pairs: [string, string][]) => ({ coordinatorIntentByParent: Object.fromEntries(pairs.map(([id, inc]) => [delegationIntentKey(id, inc), '2026-11-14T00:00:00.000Z'])) });
    const asked: [string, string][] = [];
    const on = (checkpoint: ReturnType<typeof cp> | null) => ({
      declaredIntent: (id: string, inc: string) => { asked.push([id, inc]); return intentOfCheckpoint(checkpoint, id, inc); } });
    expect(value((await gather(c, on(cp([ME, 'another-incarnation'], [OTHER, INC])))).facts.intent)).toBe(false);
    expect(value((await gather(c, on(cp([ME, INC])))).facts.intent)).toBe(true);
    expect(asked).toEqual([[ME, INC], [ME, INC]]);
    // No `.generation` file: the intent door refuses to declare without one, so it reads as no intent, and nothing is asked.
    expect(value((await gather(c, { ...on(cp([ME, INC])), incarnation: async () => ({ kind: 'absent' }) })).facts.intent)).toBe(false);
    expect(asked).toHaveLength(2);
  });

  it('a checkpoint that is not ready is unmeasured, never "no intent", and a throw is unmeasured too (review 2023 F4)', async () => {
    const notReady = (await gather(store(), { declaredIntent: (id, inc) => intentOfCheckpoint(null, id, inc) })).facts;
    expect(notReady.intent).toEqual({ kind: 'unmeasured', what: 'declared coordinator intent (the delegation checkpoint is not ready)' });
    expect(notReady.role).toBe('undecided');
    const threw = (await gather(store(), { declaredIntent: () => { throw new Error('x'); } })).facts;
    expect(threw.intent).toEqual({ kind: 'unmeasured', what: 'declared coordinator intent' });
  });

  it('a plain session with nothing reads every fact, each empty, and its role is plain', async () => {
    const { facts: f, renderer } = await gather(store());
    expect(f.role).toBe('plain');
    expect(renderer).toBe('plain');
    for (const k of ['runs', 'ledger', 'claims', 'itemsRaised', 'mailOutstanding'] as const) expect(f[k]).toEqual({ kind: 'read', value: [] });
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

describe('gatherCardFacts: held items and the mail list (review 2023 F14, F15)', () => {
  it('a held item shows, marked held, on the card of the coordinator whose hold it is, and on no other card', async () => {
    const c = store();
    const mine = openRun(c, 'prog-a', ME);
    const theirs = openRun(c, 'prog-b', OTHER);
    const held = (program: string, runId: number, raisedBy: string, title: string): number => c.raiseItem({ program, runId, raisedBy,
      kind: 'do', title, why: 'w', how: [], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null, heldUntil: NOW + 60_000 }, NOW - 1_000);
    const forMe = held('prog-a', mine, 'lane-c-project-a', 'end my run');
    const forThem = held('prog-b', theirs, ME, 'end their run');
    const shown = raise(c, 'prog-a', 'lane-c-project-a', 'shown to all');
    const items = (f: CardFacts) => value(f.ledger).flatMap((p) => p.openItems).map((i) => [i.id, i.held]);
    expect(items((await gather(c)).facts)).toEqual([[shown, false], [forMe, true]]);
    // The session that raised a held item does not see it among the items it raised, and the other coordinator sees its own.
    expect(value((await gather(c)).facts.itemsRaised)).toEqual([]);
    const other = (await gatherCardFacts(deps(c), OTHER, NOW)).facts;
    expect(items(other)).toEqual([[forThem, true]]);
    // A third session that reads programme prog-a's ledger (it raised an item there) never sees prog-a's held item.
    const raiser = (await gatherCardFacts(deps(c), 'lane-c-project-a', NOW)).facts;
    expect(items(raiser)).toEqual([[shown, false]]);
    // Once the hold passes, the operator is shown it, so it is an ordinary item on every card of the programme.
    const later = (await gatherCardFacts(deps(c), ME, NOW + 60_000)).facts;
    expect(items(later)).toEqual([[shown, false], [forMe, false], [forThem, false]]);
  });

  it('more than CARD_MAIL_MAX outstanding deliveries: the newest listed, and mailMore says more exist', async () => {
    const c = store();
    let sent = 0;
    const send = (n: number) => { for (let i = 0; i < n; i += 1) {
      const m = c.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ME, runId: null, kind: 'status', subject: `s${sent++}`, body: 'b', artifacts: [] });
      c.queueDelivery(m.id, ME, '<mail/>');
    } };
    send(CARD_MAIL_MAX);
    const exactly = (await gather(c)).facts;
    expect([value(exactly.mailOutstanding).length, exactly.mailMore]).toEqual([CARD_MAIL_MAX, false]);
    send(1);
    const over = (await gather(c)).facts;
    expect([value(over.mailOutstanding).length, over.mailMore]).toEqual([CARD_MAIL_MAX, true]);
    expect(value(over.mailOutstanding).map((m) => m.subject)).not.toContain('s0');
  });

  it('a parked delivery the mailbox still shows is labelled parked, never "not answered"', async () => {
    const c = store();
    const m = c.insertMail({ fromId: 'lane-c-project-a', fromUuid: 'u', toId: ME, runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    c.queueDelivery(m.id, ME, '<mail/>');
    const real = c.outstandingMailFor.bind(c);
    c.outstandingMailFor = (id, n) => real(id, n).map((r) => ({ ...r, state: 'rejected' as const }));
    expect(value((await gather(c)).facts.mailOutstanding).map((r) => r.parked)).toEqual([true]);
  });
});

describe('gatherCardFacts: a read that fails is a fact naming what failed, never an empty list', () => {
  const throws = (): never => { throw new Error('disk I/O error'); };
  const cases: [string, (c: CoordStore) => void, keyof CardFacts, string][] = [
    ['runs', (c) => { c.openRunsForSession = throws; }, 'runs', 'the runs'],
    ['runs (a refusal)', (c) => { c.openRunsForSession = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' }); }, 'runs', 'the runs'],
    ['runs (a run row that does not read)', (c) => { c.run = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) as never; }, 'runs', 'the runs'],
    ['claims', (c) => { c.activeClaims = throws; }, 'claims', 'the claims'],
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

  it('between runs, a series read or a newest run read that throws is an unmeasured ledger, never a throw (review 2023 F10)', async () => {
    for (const breakIt of [(c: CoordStore) => { c.bindingRunsOf = throws; }, (c: CoordStore) => { c.run = throws; }]) {
      const c = store();
      const done = openRun(c, 'prog-a', ME);
      c.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(done);
      breakIt(c);
      const f = (await gather(c)).facts;
      expect(f.ledger).toEqual({ kind: 'unmeasured', what: 'the programme ledger' });
    }
  });

  it('an unreadable incarnation leaves intent unmeasured, naming the incarnation', async () => {
    const f = (await gather(store(), { incarnation: async () => ({ kind: 'unreadable' }) })).facts;
    expect(f.intent).toEqual({ kind: 'unmeasured', what: 'declared coordinator intent (the registry incarnation)' });
  });

  it('the runs unread: the ledger is unmeasured too, naming why, and the role is undecided between coordinator and plain', async () => {
    const c = store();
    c.openRunsForSession = throws;
    c.openCoordinatorIds = throws;
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

  it('the child marker exists but is unreadable: undecided between worker and reviewer, the worker card', async () => {
    const { facts: f, renderer } = await gather(store(), { childMark: async () => ({ kind: 'unreadable' }) });
    expect(f.role).toBe('undecided');
    expect(f.roleWhy).toBe('its child marker could not be read: worker or reviewer');
    expect(renderer).toBe('worker');
  });

  it('the registry could not say whether it is a child (or the read threw): undecided across all four, the widest card (review 2023 F7)', async () => {
    for (const childMark of [async (): Promise<typeof CARD_REGISTRY_UNREAD> => CARD_REGISTRY_UNREAD, async (): Promise<never> => { throw new Error('io'); }]) {
      const { facts: f, renderer } = await gather(store(), { childMark });
      expect(f.role).toBe('undecided');
      expect(f.roleWhy).toBe('the registry could not say whether it is a child: worker, reviewer, coordinator or plain');
      expect(renderer).toBe('coordinator');
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
      cardRoleOf(roleFactsOf(ME, { child, childRunKind: kind, openCoordinators: new Set(open ? [ME] : []), intentDeclared: intent, designation: { kind: 'none' } }));
    expect(at({ kind: 'child', runId: 7 }, 'review', false, false)).toEqual({ role: 'reviewer', roleWhy: 'a child of run 7, a review run', renderer: 'reviewer' });
    expect(at({ kind: 'none' }, 'unmeasured', true, true)).toEqual({ role: 'coordinator', roleWhy: 'it claims an open run', renderer: 'coordinator' });
    expect(at({ kind: 'none' }, 'unmeasured', false, false).renderer).toBe('plain');
  });
});

describe('gatherCardFacts: the designation (Overlord W1 designation A, Task 3, X5)', () => {
  const view = (over: Partial<DesignationView>): DesignationView => ({
    bound: null, pending: null, term: 5, designatedTerm: 1, model: 'opus', accountPools: { pools: ['pool-a'], untagged: false },
    pastIds: [], actor: 'op', lastAttempt: null, stopsOwed: [], ...over,
  });
  const pending = (kind: 'designate' | 'rebind'): DesignationRead => ({ kind: 'not-designated', row: view({
    pending: { sessionId: ME, kind, deadlineAt: 9, since: 1, actor: 'op', generation: null } }) });
  const live: DesignationRead = { kind: 'designated', sessionId: ME, term: 5, row: view({ bound: { sessionId: ME, generation: 'g1' } }) };
  let n = 0;
  /** An `overlord` generation of the bound session, minted the way the lane's restart does: against the live one. */
  const mintOverlord = (c: CoordStore): number => {
    n += 1;
    const s = c.insertStart({ sessionId: ME, reportId: `ro-${n}`, uuid: 'u', source: 'resume', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!s.ok) throw new Error('start');
    const gens = c.liveGenerations();
    if (!gens.ok) throw new Error(gens.detail);
    const prev = gens.rows.find((g) => g.identity === 'overlord') ?? null;
    const m = c.mintGeneration({ identity: 'overlord', sessionId: ME, role: 'overlord', term: 5, rowIncarnation: null, startId: s.id, startReportedAt: NOW,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW },
    prev === null ? null : { term: prev.term, n: prev.n, state: prev.state, shadowState: prev.shadowState, walk: prev.walk }, true);
    if (!m.ok) throw new Error(m.kind);
    return m.id;
  };

  it('a pending body (a designate or a rebind attempt) and a bound one read the Overlord, whatever else holds', async () => {
    for (const read of [pending('designate'), pending('rebind'), live]) {
      const c = store();
      openRun(c, 'prog-a', ME);   // it claims an open run: a coordinator, were it not the Overlord
      c.designationRead = () => read;
      const { facts } = await gather(c);
      expect(facts.role, read.kind).toBe('overlord');
    }
  });

  it('an unmeasured designation leaves the role unread (the registry-unread arm) and the checkpoint unmeasured', async () => {
    for (const bad of [(): DesignationRead => ({ kind: 'unmeasured', why: 'x' }), (): DesignationRead => { throw new Error('locked'); }]) {
      const c = store();
      c.designationRead = bad;
      const { facts } = await gather(c);
      expect(facts.role).toBe('undecided');
      expect(facts.checkpoint).toEqual({ kind: 'unmeasured', what: 'the checkpoint' });
    }
  });

  it('a restart of the Overlord: the card finds the live overlord generation, and the checkpoint of the one it replaced', async () => {
    const c = store();
    c.designationRead = () => live;
    const first = mintOverlord(c);
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
    expect(c.putCheckpoint({ generationId: first, notes: [], rulings: [], at: NOW - 9,
      handover: { n: 1, dropped: 0, note: { threads: [], cautions: ['c'], tone: 't' } } }).ok).toBe(true);
    mintOverlord(c);
    expect(value((await gather(c)).facts.checkpoint)).toMatchObject({ at: NOW - 9, handover: { generation: 1, cautions: ['c'] } });
  });

  it('a rebind: the old body is overlord, so the new (pending) body\'s card looks under its own id, not the old body\'s generation', async () => {
    const c = store();
    c.designationRead = () => live;
    mintOverlord(c);
    c.designationRead = () => ({ kind: 'designated', sessionId: 'overlord-old-owl', term: 5, row: view({
      bound: { sessionId: 'overlord-old-owl', generation: 'g1' }, pending: { sessionId: ME, kind: 'rebind', deadlineAt: 9, since: 1, actor: 'op', generation: null } }) });
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
  });
});

describe('gatherCardFacts: the notes and the checkpoint (the notes piece, Task 3)', () => {
  const note = (c: CoordStore, key: { kind: 'run'; id: number } | { kind: 'programme'; slug: string }, next: string, at: number, identity = ME): number => {
    const r = c.appendNote({ identity, sessionId: identity, generationId: null, key, kind: 'thread', waitsOn: 'w', next, revises: null, closes: false, at });
    if (!r.ok) throw new Error('note');
    return r.id;
  };
  let reports = 0;
  const mint = (c: CoordStore, live = true): number => {
    reports += 1;
    const s = c.insertStart({ sessionId: ME, reportId: `r-${reports}`, uuid: 'u', source: 'clear', model: null, rowIncarnation: null, reportedAt: NOW, receivedAt: NOW });
    if (!s.ok) throw new Error('start');
    const gens = c.liveGenerations();
    if (!gens.ok) throw new Error(gens.detail);
    const prev = gens.rows.find((g) => g.identity === ME) ?? null;
    const m = c.mintGeneration({ identity: ME, sessionId: ME, role: 'coordinator', term: 1, rowIncarnation: null, startId: s.id, startReportedAt: NOW,
      resumed: false, model: null, lane: 'lane-a', host: null, outcome: 'renewed', mono: 1, proc: 'p', now: NOW },
    prev === null ? null : { term: prev.term, n: prev.n, state: prev.state, shadowState: prev.shadowState, walk: prev.walk }, live);
    if (!m.ok) throw new Error(m.kind);
    return m.id;
  };

  it('the live notes, newest first, each with what its row is now; another identity\'s notes are not read', async () => {
    const c = store();
    const run = openRun(c, 'prog-a', ME);
    // Programme lifecycle W1 (R11): ME owns one programme, so its second run is prog-a's next wave.
    const closed = openRun(c, 'prog-a', ME, 2);
    const a = note(c, { kind: 'run', id: run }, 'one', NOW - 3_000);
    const b = note(c, { kind: 'run', id: closed }, 'two', NOW - 2_000);
    const d = note(c, { kind: 'programme', slug: 'prog-z' }, 'three', NOW - 1_000);
    note(c, { kind: 'run', id: run }, 'theirs', NOW, OTHER);
    c.db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(closed);
    const notes = value((await gather(c)).facts.notes);
    expect(notes.map((n) => [n.id, n.key, n.keyFact, n.next])).toEqual([
      [d, 'programme prog-z', 'not-yours', 'three'], [b, `run ${closed}`, 'gone', 'two'], [a, `run ${run}`, 'live', 'one']]);
  });

  it('a notes read that fails is unmeasured, naming the notes; a key read that fails is that note\'s fact, never a dropped note', async () => {
    const c = store();
    const run = openRun(c, 'prog-a', ME);
    note(c, { kind: 'run', id: run }, 'one', NOW);
    c.run = () => ({ ok: false, kind: 'run-unreadable', detail: 'x' }) as never;
    const f = (await gather(c)).facts;
    expect(value(f.notes).map((n) => n.keyFact)).toEqual(['unmeasured']);
    c.liveNotes = () => ({ ok: false, detail: 'x' });
    expect((await gather(c)).facts.notes).toEqual({ kind: 'unmeasured', what: 'the notes' });
  });

  it('the checkpoint is the stored checkpoint of the generation the live one replaced, at a renewal only, and null when it stored none', async () => {
    const c = store();
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
    const first = mint(c);
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
    // The notes piece's handover row is not the card's source any more: the lane copies it into the checkpoint row.
    expect(c.putHandover({ generationId: first, note: { threads: [], cautions: [], tone: 'notes row' }, dropped: 0, at: NOW - 9 }).ok).toBe(true);
    expect(c.putCheckpoint({ generationId: first, notes: [], rulings: [], at: NOW - 9,
      handover: { n: 1, dropped: 1, note: { threads: [{ ref: { kind: 'run', id: 4 }, waitsOn: 'w', next: 'n' }], cautions: ['c'], tone: 't' } } }).ok).toBe(true);
    // Still the first generation: no generation before it stored a checkpoint.
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
    mint(c);
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: {
      at: NOW - 9, handover: { generation: 1, dropped: 1, threads: [{ ref: 'run 4', waitsOn: 'w', next: 'n' }], cautions: ['c'], tone: 't' }, notes: [], rulings: [],
    } });
    // A third generation whose predecessor stored none: null, never the older checkpoint.
    mint(c);
    expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'read', value: null });
  });

  it('a generations or checkpoint read that fails is an unmeasured checkpoint, never null', async () => {
    for (const breakIt of [(c: CoordStore) => { c.liveGenerations = () => ({ ok: false, detail: 'x' }); },
      (c: CoordStore) => { c.checkpointBefore = () => ({ ok: false, detail: 'x' }); },
      (c: CoordStore) => { c.checkpointBefore = () => { throw new Error('disk'); }; }]) {
      const c = store();
      mint(c);
      breakIt(c);
      expect((await gather(c)).facts.checkpoint).toEqual({ kind: 'unmeasured', what: 'the checkpoint' });
    }
  });
});

describe('gatherCardFacts: the pending timers (the timers piece, plan w1a-timers.md Task 10)', () => {
  const set = (c: CoordStore, setter: string, dueAt: number, note: string, over: { runId?: number | null; programme?: string | null } = {}): number => {
    const r = c.insertTimer({ setter, setterIncarnation: INC, setById: setter, setByUuid: 'u', role: 'worker', note,
      runId: over.runId ?? null, programme: over.programme ?? null, setAt: NOW - 60_000, dueAt });
    if (!r.ok) throw new Error(r.kind);
    return r.id;
  };
  const LONG = `${'word '.repeat(30)}and the end of a long note`;

  it('the session\'s own pending timers, oldest due first, each with timerPreview\'s preview; others\' and moved ones are not read', async () => {
    const c = store();
    const late = set(c, ME, NOW + 7_200_000, LONG, { programme: 'prog-a' });
    const soon = set(c, ME, NOW + 600_000, 'check the checks', { runId: 7 });
    set(c, OTHER, NOW + 300_000, 'not mine');
    const fired = set(c, ME, NOW + 400_000, 'fired');
    expect(c.markTimersFired([fired], 1, NOW).changed).toBe(true);
    const cancelled = set(c, ME, NOW + 500_000, 'cancelled');
    expect(c.cancelTimer(cancelled, 'setter-cancel', 'setter', NOW).changed).toBe(true);
    const f = (await gather(c)).facts;
    expect(value(f.timers)).toEqual([
      { id: soon, dueAt: NOW + 600_000, preview: 'check the checks', runId: 7, programme: null },
      { id: late, dueAt: NOW + 7_200_000, preview: timerPreview(LONG), runId: null, programme: 'prog-a' },
    ]);
    expect(timerPreview(LONG)).not.toBe(LONG);
    // The note itself never rides the facts (nor the snapshot): only its preview.
    expect(snapshotFactsJson(f)).not.toContain('the end of a long note');
  });

  it('no pending timer is a read empty list', async () => {
    expect((await gather(store())).facts.timers).toEqual({ kind: 'read', value: [] });
  });

  it('a read that fails, or throws, is unmeasured, never an empty list', async () => {
    for (const breakIt of [(c: CoordStore) => { c.pendingTimersOf = () => ({ ok: false, detail: 'x' }); },
      (c: CoordStore) => { c.pendingTimersOf = () => { throw new Error('disk'); }; }]) {
      const c = store();
      set(c, ME, NOW + 600_000, 'n');
      breakIt(c);
      expect((await gather(c)).facts.timers).toEqual({ kind: 'unmeasured', what: 'your pending timers' });
    }
  });

  it('two gathers over unchanged timers keep one snapshot (absolute stamps only), and a new timer changes it', async () => {
    const c = store();
    set(c, ME, NOW + 600_000, 'check the checks', { runId: 7 });
    const a = snapshotFactsJson((await gatherCardFacts(deps(c), ME, NOW)).facts);
    const b = snapshotFactsJson((await gatherCardFacts(deps(c), ME, NOW + 3_600_000)).facts);
    expect(b).toBe(a);
    set(c, ME, NOW + 900_000, 'another');
    expect(snapshotFactsJson((await gatherCardFacts(deps(c), ME, NOW)).facts)).not.toBe(a);
  });
});
