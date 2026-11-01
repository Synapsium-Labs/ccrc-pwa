// Programme ledgers (plan PL2): the CoordStore methods for the operator's items, their history, the spec
// modifications and the spec pin. The decisions are PL1's (`nextItemState`); these tests pin that the store asks it,
// writes in one transaction and answers in words. Fixture coord.db files only; neutral names (prog-a, lane-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, type ItemRow } from '../src/coord/store.js';
import { CLEARED_WINDOW_MS, ITEM_MOVE_REFUSALS, ITEM_STATES, type ItemState } from '../../shared/ledgers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const dbPathIn = (home: string): string => path.join(home, '.ccrc', 'coord.db');
const mk = (): CoordStore => new CoordStore(openCoordDb(dbPathIn(mkTmp('ccrc-ledgers-store-'))));
const DAY = 24 * 3600 * 1000;
const NOW = 1_800_000_000_000;

const openRunFor = (s: CoordStore, program: string, claimedBy: string, wave = 1): number =>
  (s.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave, waveOf: null, claimedBy }) as { id: number }).id;
const setRunState = (s: CoordStore, runId: number, state: string): void => {
  s.db.prepare('UPDATE runs SET state = ? WHERE id = ?').run(state, runId);
};
const raise = (s: CoordStore, over: Partial<Parameters<CoordStore['raiseItem']>[0]> = {}, now = NOW): number =>
  s.raiseItem({
    program: 'prog-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.',
    how: ['Open Settings', 'Switch it on'], options: null, neededBy: 'soon', soonLabel: 'before wave 6', secretSlot: null,
    ...over,
  }, now);
const eventsOf = (s: CoordStore, id: number): string[] => s.itemHistory(id).map((e) => `${e.act}:${e.actor}`);
const live = { programmeHasOpenRun: false };

describe('raising and reading an item (plan PL2)', () => {
  it('raiseItem stores every field the coordinator gave, open, and itemById reads it back', () => {
    const s = mk();
    const runId = openRunFor(s, 'prog-a', 'lane-a');
    const id = raise(s, { runId, kind: 'decide', options: ['yes', 'no'], how: ['Pick one'], neededBy: 'blocking', soonLabel: null });
    expect(s.itemById(id)).toEqual({
      id, program: 'prog-a', runId, raisedBy: 'lane-a', kind: 'decide', title: 'Turn on the setting',
      why: 'The wave needs it.', how: ['Pick one'], options: ['yes', 'no'], neededBy: 'blocking', soonLabel: null,
      secretSlot: null, state: 'open', answer: null, note: null, raisedAt: NOW, tickedAt: null, closedAt: null,
    } satisfies ItemRow);
    expect(s.itemById(id + 1)).toBeNull();
  });

  it('a secret item keeps its slot and no options', () => {
    const s = mk();
    const id = raise(s, { kind: 'secret', secretSlot: 'npm-token' });
    expect(s.itemById(id)).toMatchObject({ kind: 'secret', secretSlot: 'npm-token', options: null });
  });

  it('refuses a kind or needed-by outside the vocabulary before any write', () => {
    const s = mk();
    expect(() => raise(s, { kind: 'ask' as never })).toThrow(/kind/);
    expect(() => raise(s, { neededBy: 'someday' as never })).toThrow(/neededBy/);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM operator_items').get()).toEqual({ n: 0 });
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM operator_item_events').get()).toEqual({ n: 0 });
  });
});

describe('moving an item (plan PL2)', () => {
  it('raise then tick then confirm writes three events in order', () => {
    const s = mk();
    const id = raise(s);
    const ticked = s.moveItem(id, 'tick', 'operator', { answer: null }, NOW + 1, live);
    expect(ticked).toMatchObject({ ok: true, item: { state: 'checking', tickedAt: NOW + 1, closedAt: null } });
    const confirmed = s.moveItem(id, 'confirm', 'coordinator', {}, NOW + 2, live);
    expect(confirmed).toMatchObject({ ok: true, item: { state: 'done', closedAt: NOW + 2, tickedAt: NOW + 1 } });
    expect(eventsOf(s, id)).toEqual(['raise:coordinator', 'tick:operator', 'confirm:coordinator']);
    expect(s.itemHistory(id).map((e) => e.at)).toEqual([NOW, NOW + 1, NOW + 2]);
  });

  it('a tick records the answer, and a return records the coordinator’s note and reopens', () => {
    const s = mk();
    const id = raise(s, { kind: 'value' });
    s.moveItem(id, 'tick', 'operator', { answer: 'blue' }, NOW + 1, live);
    expect(s.itemById(id)).toMatchObject({ state: 'checking', answer: 'blue', note: null });
    const back = s.moveItem(id, 'return', 'coordinator', { note: 'The setting still reads off.' }, NOW + 2, live);
    expect(back).toMatchObject({ ok: true, item: { state: 'open', note: 'The setting still reads off.', answer: 'blue', closedAt: null } });
    expect(s.itemHistory(id).at(-1)).toMatchObject({ act: 'return', actor: 'coordinator', note: 'The setting still reads off.' });
  });

  it('withdraw and dismiss close an item and stamp closedAt', () => {
    const s = mk();
    const w = raise(s);
    expect(s.moveItem(w, 'withdraw', 'coordinator', {}, NOW + 1, live)).toMatchObject({ ok: true, item: { state: 'withdrawn', closedAt: NOW + 1 } });
    const d = raise(s);
    expect(s.moveItem(d, 'dismiss', 'operator', {}, NOW + 2, live)).toMatchObject({ ok: true, item: { state: 'dismissed', closedAt: NOW + 2 } });
  });

  it('every refusal is the decider’s word and writes nothing (state, row, events)', () => {
    const s = mk();
    const id = raise(s);
    const before = JSON.stringify([s.itemById(id), s.itemHistory(id)]);
    expect(s.moveItem(id, 'confirm', 'coordinator', {}, NOW + 1, live)).toEqual({ ok: false, why: 'not-open' });
    expect(s.moveItem(id, 'tick', 'coordinator', {}, NOW + 1, live)).toEqual({ ok: false, why: 'wrong-actor' });
    expect(s.moveItem(id, 'dismiss', 'operator', {}, NOW + 1, { programmeHasOpenRun: true })).toEqual({ ok: false, why: 'programme-live' });
    expect(s.moveItem(9999, 'tick', 'operator', {}, NOW + 1, live)).toEqual({ ok: false, why: 'unknown-item' });
    expect(JSON.stringify([s.itemById(id), s.itemHistory(id)])).toBe(before);
  });

  it('a closed item moves no further: every act from done, withdrawn and dismissed is refused not-open', () => {
    const s = mk();
    const closed: Record<string, number> = {};
    const a = raise(s); s.moveItem(a, 'tick', 'operator', {}, NOW + 1, live); s.moveItem(a, 'confirm', 'coordinator', {}, NOW + 2, live); closed.done = a;
    const b = raise(s); s.moveItem(b, 'withdraw', 'coordinator', {}, NOW + 1, live); closed.withdrawn = b;
    const c = raise(s); s.moveItem(c, 'dismiss', 'operator', {}, NOW + 1, live); closed.dismissed = c;
    for (const [state, id] of Object.entries(closed)) {
      expect(s.itemById(id)?.state).toBe(state as ItemState);
      for (const [act, actor] of [['tick', 'operator'], ['confirm', 'coordinator'], ['return', 'coordinator'],
        ['withdraw', 'coordinator'], ['dismiss', 'operator']] as const) {
        expect(s.moveItem(id, act, actor, {}, NOW + 9, live), `${state} ${act}`).toEqual({ ok: false, why: 'not-open' });
      }
    }
    expect(ITEM_STATES).toContain('done');
  });

  it('every refusal word the store answers is a declared ItemMoveRefusal', () => {
    const s = mk();
    const id = raise(s);
    const words = [
      s.moveItem(id, 'confirm', 'coordinator', {}, NOW, live), s.moveItem(id, 'tick', 'coordinator', {}, NOW, live),
      s.moveItem(id, 'dismiss', 'operator', {}, NOW, { programmeHasOpenRun: true }), s.moveItem(404, 'tick', 'operator', {}, NOW, live),
      s.setBlocking(404, true, NOW),
    ].map((r) => (r.ok ? null : r.why));
    expect(words).toEqual(['not-open', 'wrong-actor', 'programme-live', 'unknown-item', 'unknown-item']);
    for (const w of words) expect(ITEM_MOVE_REFUSALS).toContain(w);
    expect([...ITEM_MOVE_REFUSALS].sort()).toEqual(['not-open', 'programme-live', 'unknown-item', 'wrong-actor']);
  });

  it('the only writer of operator_items.state is moveItem (a source scan of the ledgers store, and of CoordStore)', async () => {
    const { readFileSync } = await import('node:fs');
    const stateWriter = (l: string): boolean => /UPDATE\s+operator_items\b[^`'"]*\bSET\b[^`'"]*\bstate\s*=/i.test(l);
    const ledgersSrc = readFileSync(new URL('../src/coord/ledgersStore.ts', import.meta.url), 'utf8');
    const storeSrc = readFileSync(new URL('../src/coord/store.ts', import.meta.url), 'utf8');
    expect(ledgersSrc.split('\n').filter(stateWriter).length).toBe(1);
    expect(storeSrc.split('\n').filter(stateWriter).length).toBe(0);
  });
});

describe('tickWithMail (plan PL2)', () => {
  it('moves the item and returns what the callback queued, in one transaction', () => {
    const s = mk();
    const id = raise(s, { kind: 'value' });
    const got = s.tickWithMail(id, 'blue', NOW + 1, (item) => {
      s.db.prepare("INSERT INTO operator_item_events (itemId, at, act, actor, note) VALUES (?, ?, 'probe', 'operator', NULL)")
        .run(item.id, NOW + 1);
      return `mail for ${item.id} in ${item.state}`;
    });
    expect(got).toMatchObject({ ok: true, mail: `mail for ${id} in checking`, item: { state: 'checking', answer: 'blue' } });
  });

  it('a tick whose queue throws leaves the item open and writes no event', () => {
    const s = mk();
    const id = raise(s, { kind: 'value' });
    const eventsBefore = s.itemHistory(id).length;
    expect(() => s.tickWithMail(id, 'blue', NOW + 1, () => { throw new Error('mail insert failed'); }))
      .toThrow('mail insert failed');
    expect(s.itemById(id)).toMatchObject({ state: 'open', answer: null, tickedAt: null });
    expect(s.itemHistory(id).length).toBe(eventsBefore);
    // The transaction is released: the next write works.
    expect(s.moveItem(id, 'tick', 'operator', {}, NOW + 2, live)).toMatchObject({ ok: true });
  });

  it('a refused tick never calls the queue', () => {
    const s = mk();
    const id = raise(s);
    s.tickWithMail(id, null, NOW + 1, () => 'first');
    let called = 0;
    const second = s.tickWithMail(id, null, NOW + 2, () => { called++; return 'second'; });
    expect(second).toEqual({ ok: false, why: 'not-open' });
    expect(called).toBe(0);
    expect(s.tickWithMail(4242, null, NOW + 2, () => { called++; return 'x'; })).toEqual({ ok: false, why: 'unknown-item' });
    expect(called).toBe(0);
  });
});

describe('listing items (plan PL2)', () => {
  it('itemsFor keeps done items 7 days in cleared and drops them after', () => {
    const s = mk();
    const done = (closedAt: number): number => {
      const id = raise(s, {}, closedAt - 10);
      s.moveItem(id, 'tick', 'operator', {}, closedAt - 5, live);
      s.moveItem(id, 'confirm', 'coordinator', {}, closedAt, live);
      return id;
    };
    const fresh = done(NOW - 1 * DAY);
    const edge = done(NOW - CLEARED_WINDOW_MS);
    const stale = done(NOW - CLEARED_WINDOW_MS - 1);
    const out = s.itemsFor('prog-a', NOW);
    expect(out.cleared.map((i) => i.id)).toEqual([fresh, edge]);
    expect(out.cleared.map((i) => i.id)).not.toContain(stale);
    expect(out.open).toEqual([]);
  });

  it('open holds open and checking, oldest first; withdrawn and dismissed appear nowhere', () => {
    const s = mk();
    const a = raise(s, {}, NOW - 30);
    const b = raise(s, {}, NOW - 20);
    const c = raise(s, {}, NOW - 10);
    const w = raise(s, {}, NOW - 5);
    s.moveItem(b, 'tick', 'operator', {}, NOW - 4, live);
    s.moveItem(w, 'withdraw', 'coordinator', {}, NOW - 3, live);
    const d = raise(s, {}, NOW - 2);
    s.moveItem(d, 'dismiss', 'operator', {}, NOW - 1, live);
    const out = s.itemsFor('prog-a', NOW);
    expect(out.open.map((i) => [i.id, i.state])).toEqual([[a, 'open'], [b, 'checking'], [c, 'open']]);
    expect(out.cleared).toEqual([]);
  });

  it('null means every programme, and a slug means that programme only', () => {
    const s = mk();
    const a = raise(s, { program: 'prog-a' });
    const b = raise(s, { program: 'prog-b' });
    expect(s.itemsFor(null, NOW).open.map((i) => i.id)).toEqual([a, b]);
    expect(s.itemsFor('prog-b', NOW).open.map((i) => i.id)).toEqual([b]);
    expect(s.itemsFor('prog-c', NOW)).toEqual({ open: [], cleared: [] });
  });
});

describe('blocking (plan PL2)', () => {
  it('setBlocking raises neededBy to blocking, and lowering restores the raised value, each with an event', () => {
    const s = mk();
    const id = raise(s, { neededBy: 'soon', soonLabel: 'before wave 6' });
    expect(s.setBlocking(id, true, NOW + 1)).toEqual({ ok: true });
    expect(s.itemById(id)).toMatchObject({ neededBy: 'blocking', soonLabel: 'before wave 6' });
    expect(s.setBlocking(id, false, NOW + 2)).toEqual({ ok: true });
    expect(s.itemById(id)).toMatchObject({ neededBy: 'soon', soonLabel: 'before wave 6' });
    expect(eventsOf(s, id)).toEqual(['raise:coordinator', 'block:coordinator', 'unblock:coordinator']);
  });

  it('an item raised blocking falls back to soon with a label and later without one', () => {
    const s = mk();
    const withLabel = raise(s, { neededBy: 'blocking', soonLabel: 'before wave 6' });
    const noLabel = raise(s, { neededBy: 'blocking', soonLabel: null });
    s.setBlocking(withLabel, false, NOW + 1);
    s.setBlocking(noLabel, false, NOW + 1);
    expect(s.itemById(withLabel)?.neededBy).toBe('soon');
    expect(s.itemById(noLabel)?.neededBy).toBe('later');
  });

  it('answers unknown-item and not-open, and a repeat of the same level writes no second event', () => {
    const s = mk();
    expect(s.setBlocking(77, true, NOW)).toEqual({ ok: false, why: 'unknown-item' });
    const id = raise(s);
    expect(s.setBlocking(id, true, NOW + 1)).toEqual({ ok: true });
    expect(s.setBlocking(id, true, NOW + 2)).toEqual({ ok: true });
    expect(eventsOf(s, id)).toEqual(['raise:coordinator', 'block:coordinator']);
    s.moveItem(id, 'withdraw', 'coordinator', {}, NOW + 3, live);
    expect(s.setBlocking(id, false, NOW + 4)).toEqual({ ok: false, why: 'not-open' });
  });

  it('setBlocking is not a state writer: the item stays in its state', () => {
    const s = mk();
    const id = raise(s);
    s.moveItem(id, 'tick', 'operator', {}, NOW + 1, live);
    s.setBlocking(id, true, NOW + 2);
    expect(s.itemById(id)?.state).toBe('checking');
  });
});

describe('the programme and its coordinator (plan PL2)', () => {
  it('programmeCoordinator returns the lowest open run’s claimedBy and null when all are terminal', () => {
    const s = mk();
    expect(s.programmeCoordinator('prog-a')).toBeNull();
    const r1 = openRunFor(s, 'prog-a', 'lane-a', 1);
    const r2 = openRunFor(s, 'prog-a', 'lane-a', 2);
    s.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run('lane-b', r2);
    expect(s.programmeCoordinator('prog-a')).toBe('lane-a');
    setRunState(s, r1, 'done');
    expect(s.programmeCoordinator('prog-a')).toBe('lane-b');
    setRunState(s, r2, 'failed');
    expect(s.programmeCoordinator('prog-a')).toBeNull();
  });

  it('a planned run counts as open for programmeHasOpenRun; done and failed do not', () => {
    const s = mk();
    expect(s.programmeHasOpenRun('prog-a')).toBe(false);
    const r = openRunFor(s, 'prog-a', 'lane-a');
    expect(s.db.prepare('SELECT state FROM runs WHERE id = ?').get(r)).toEqual({ state: 'planned' });
    expect(s.programmeHasOpenRun('prog-a')).toBe(true);
    expect(s.programmeHasOpenRun('prog-b')).toBe(false);
    setRunState(s, r, 'done');
    expect(s.programmeHasOpenRun('prog-a')).toBe(false);
    const r2 = openRunFor(s, 'prog-a', 'lane-a', 2);
    setRunState(s, r2, 'failed');
    expect(s.programmeHasOpenRun('prog-a')).toBe(false);
  });

  it('a run claimed by nobody is not a coordinator', () => {
    const s = mk();
    const r = openRunFor(s, 'prog-a', 'lane-a');
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(r);
    expect(s.programmeCoordinator('prog-a')).toBeNull();
    expect(s.programmeHasOpenRun('prog-a')).toBe(true);
  });

  it('claimsProgramme is false for a session that claims only a closed run', () => {
    const s = mk();
    const r1 = openRunFor(s, 'prog-a', 'lane-a', 1);
    const r2 = openRunFor(s, 'prog-a', 'lane-a', 2);
    s.db.prepare('UPDATE runs SET claimedBy = ? WHERE id = ?').run('lane-old', r1);
    setRunState(s, r1, 'done');
    expect(s.claimsProgramme('lane-old', 'prog-a')).toBe(false);
    expect(s.claimsProgramme('lane-a', 'prog-a')).toBe(true);
    expect(s.claimsProgramme('lane-a', 'prog-b')).toBe(false);
    setRunState(s, r2, 'planned');
    expect(s.claimsProgramme('lane-a', 'prog-a')).toBe(true);
    expect(s.claimsProgramme('', 'prog-a')).toBe(false);
  });
});

describe('the spec pin and the modifications (plan PL2)', () => {
  it('goalsFor on a programme with no pin reads nulls and an empty list', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a');
    expect(s.goalsFor('prog-a')).toEqual({ program: 'prog-a', specPath: null, inShort: null, inShortAt: null, modifications: [] });
    expect(s.goalsFor('prog-z')).toEqual({ program: 'prog-z', specPath: null, inShort: null, inShortAt: null, modifications: [] });
  });

  it('setSpecPin replaces the pin and its In short copy, and stamps the time', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a');
    s.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'First summary.', NOW);
    s.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'Second summary.', NOW + 5);
    expect(s.goalsFor('prog-a')).toMatchObject({
      specPath: 'docs/superpowers/specs/2026-11-01-x-design.md', inShort: 'Second summary.', inShortAt: NOW + 5 });
  });

  it('goalsFor lists modifications newest first with merged from mergedAt', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a');
    const m1 = s.addModification('prog-a', { text: 'First change.', ruling: 'ledger entry 4', itemId: null, pr: 10 }, NOW);
    const m2 = s.addModification('prog-a', { text: 'Second change.', ruling: null, itemId: 3, pr: 11 }, NOW + 10);
    const other = s.addModification('prog-b', { text: 'Not ours.', ruling: null, itemId: null, pr: 10 }, NOW + 20);
    expect(s.markModificationsMerged('prog-a', 10, NOW + 30)).toBe(1);
    const g = s.goalsFor('prog-a');
    expect(g.modifications).toEqual([
      { id: m2, at: NOW + 10, text: 'Second change.', ruling: null, itemId: 3, pr: 11, merged: false },
      { id: m1, at: NOW, text: 'First change.', ruling: 'ledger entry 4', itemId: null, pr: 10, merged: true },
    ]);
    expect(g.modifications.map((m) => m.id)).not.toContain(other);
    // The other programme's modification on the same PR number was not marked.
    expect(s.goalsFor('prog-b').modifications[0]).toMatchObject({ id: other, merged: false });
  });

  it('markModificationsMerged marks once: a second call changes nothing and keeps the first time', () => {
    const s = mk();
    s.addModification('prog-a', { text: 'Change.', ruling: null, itemId: null, pr: 10 }, NOW);
    s.addModification('prog-a', { text: 'No PR yet.', ruling: null, itemId: null, pr: null }, NOW + 1);
    expect(s.markModificationsMerged('prog-a', 10, NOW + 5)).toBe(1);
    expect(s.markModificationsMerged('prog-a', 10, NOW + 99)).toBe(0);
    expect(s.db.prepare('SELECT mergedAt FROM programme_modifications WHERE pr = 10').get()).toEqual({ mergedAt: NOW + 5 });
    expect(s.markModificationsMerged('prog-a', 77, NOW + 99)).toBe(0);
  });
});
