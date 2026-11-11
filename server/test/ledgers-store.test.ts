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
    const id = raise(s, { runId, kind: 'decide', options: ['yes', 'no'], how: ['Pick one'], neededBy: 'blocking', soonLabel: null,
      recommended: 0, recommendedWhy: 'Yes keeps the wave moving.' });
    expect(s.itemById(id)).toEqual({
      id, program: 'prog-a', runId, raisedBy: 'lane-a', kind: 'decide', title: 'Turn on the setting',
      why: 'The wave needs it.', how: ['Pick one'], options: ['yes', 'no'], neededBy: 'blocking', soonLabel: null,
      secretSlot: null, state: 'open', answer: null, note: null, raisedAt: NOW, tickedAt: null, closedAt: null,
      recommended: 0, recommendedWhy: 'Yes keeps the wave moving.', action: null, heldUntil: null,
    } satisfies ItemRow);
    expect(s.itemById(id + 1)).toBeNull();
  });

  it('a decide item keeps the option its raiser recommends and why (plan PL9), and another kind raised without one reads null', () => {
    const s = mk();
    const id = raise(s, { kind: 'decide', options: ['yes', 'no'], recommended: 1, recommendedWhy: 'No costs nothing now.' });
    expect(s.itemById(id)).toMatchObject({ recommended: 1, recommendedWhy: 'No costs nothing now.' });
    expect(s.itemsFor('prog-a', NOW).open[0]).toMatchObject({ recommended: 1, recommendedWhy: 'No costs nothing now.' });
    const other = raise(s, { kind: 'do' });
    expect(s.itemById(other)).toMatchObject({ recommended: null, recommendedWhy: null });
  });

  it('raiseItem refuses a decide row without a recommendation it can read, with a RangeError, and writes nothing (plan PL9)', () => {
    const s = mk();
    const cases: readonly Partial<Parameters<CoordStore['raiseItem']>[0]>[] = [
      {}, { recommended: null, recommendedWhy: null }, { recommended: 0 }, { recommendedWhy: 'Because.' },
      { recommended: 2, recommendedWhy: 'Because.' }, { recommended: 0, recommendedWhy: '  ' },
    ];
    for (const over of cases) {
      expect(() => raise(s, { kind: 'decide', options: ['yes', 'no'], ...over }), JSON.stringify(over)).toThrow(RangeError);
    }
    expect(s.itemsFor(null, NOW).open).toEqual([]);
    expect(s.db.prepare('SELECT COUNT(*) AS n FROM operator_item_events').get()).toEqual({ n: 0 });
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
  it('itemsFor keeps done items for CLEARED_WINDOW_MS (48 hours, D-8194) in cleared and drops them after', () => {
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
    expect(s.setBlocking(id, true, NOW + 1)).toEqual({ ok: true, changed: true });
    expect(s.itemById(id)).toMatchObject({ neededBy: 'blocking', soonLabel: 'before wave 6' });
    expect(s.setBlocking(id, false, NOW + 2)).toEqual({ ok: true, changed: true });
    expect(s.setBlocking(id, false, NOW + 3)).toEqual({ ok: true, changed: false });
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

  it('a soon item with NO label is restored to soon from the history, not guessed later from the missing label', () => {
    const s = mk();
    const id = raise(s, { neededBy: 'soon', soonLabel: null });
    s.setBlocking(id, true, NOW + 1);
    expect(s.itemById(id)?.neededBy).toBe('blocking');
    s.setBlocking(id, false, NOW + 2);
    expect(s.itemById(id)).toMatchObject({ neededBy: 'soon', soonLabel: null });
  });

  it('answers unknown-item and not-open, and a repeat of the same level writes no second event', () => {
    const s = mk();
    expect(s.setBlocking(77, true, NOW)).toEqual({ ok: false, why: 'unknown-item' });
    const id = raise(s);
    expect(s.setBlocking(id, true, NOW + 1)).toEqual({ ok: true, changed: true });
    expect(s.setBlocking(id, true, NOW + 2)).toEqual({ ok: true, changed: false });
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

  it('an unclaimed lowest-id open run is skipped: the coordinator is the claimed run’s session', () => {
    const s = mk();
    const r1 = openRunFor(s, 'prog-a', 'lane-a', 1);
    s.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(r1);
    const r2 = openRunFor(s, 'prog-a', 'lane-b', 2);
    expect(r1).toBeLessThan(r2);
    expect(s.programmeCoordinator('prog-a')).toBe('lane-b');
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

  it('claimsProgramme THROWS on a series it cannot represent, never answers false (all-or-failure, D-2545)', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a', 1);
    expect(s.claimsProgramme('lane-a', 'prog-a')).toBe(true);
    // A second open run the caller claims, whose wave this process cannot represent (as archive-store.test.ts writes one).
    s.db.prepare(
      'INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(4242, 'prog-a', BigInt(Number.MAX_SAFE_INTEGER) + 1n, 3, 'project-a', 'planned', 'lane-a', NOW);
    expect(() => s.claimsProgramme('lane-a', 'prog-a')).toThrow(/claimsProgramme/);
    // Another session's answer is unaffected: the unreadable run is not its.
    expect(s.claimsProgramme('lane-z', 'prog-a')).toBe(false);
  });
});

describe('the spec pin and the modifications (plan PL2)', () => {
  it('goalsFor on a programme with no pin reads nulls and an empty list', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a');
    expect(s.goalsFor('prog-a')).toEqual({ program: 'prog-a', specPath: null, inShort: null, inShortAt: null, doneWhen: null, modifications: [] });
    expect(s.goalsFor('prog-z')).toEqual({ program: 'prog-z', specPath: null, inShort: null, inShortAt: null, doneWhen: null, modifications: [] });
  });

  it('setSpecPin replaces the pin and its In short copy, and stamps the time', () => {
    const s = mk();
    openRunFor(s, 'prog-a', 'lane-a');
    s.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'First summary.', NOW, null);
    s.setSpecPin('prog-a', 'docs/superpowers/specs/2026-11-01-x-design.md', 'Second summary.', NOW + 5, null);
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

const END_RUN = { verb: 'end-run', runId: 7, stuckReason: 'never-started' } as const;
const raiseHeld = (s: CoordStore, heldUntil: number | null, now = NOW, actor: 'coordinator' | 'ccrc' = 'ccrc'): number =>
  s.raiseItem({
    program: 'prog-a', runId: null, raisedBy: 'lane-b', kind: 'do', title: 'End run: 7', why: 'It can never finish.',
    how: ['Read why it asked.', 'Abandon the run, or keep it.'], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null,
    action: END_RUN, heldUntil,
  }, now, actor);

describe('the item\u2019s action, hold and new moves (D-8076, spec 10)', () => {
  it('act: the operator moves an open item to done, and it takes no programme context', () => {
    const s = mk();
    const id = raiseHeld(s, null);
    const r = s.moveItem(id, 'act', 'operator', { note: 'abandon:requested' }, NOW + 1, { programmeHasOpenRun: true });
    expect(r).toMatchObject({ ok: true, item: { state: 'done', closedAt: NOW + 1 } });
    expect(eventsOf(s, id)).toEqual(['raise:ccrc', 'act:operator']);
  });

  it('decline: the operator moves an open item to dismissed, even while the programme has an open run', () => {
    const s = mk();
    const id = raiseHeld(s, null);
    expect(s.moveItem(id, 'decline', 'operator', {}, NOW + 1, { programmeHasOpenRun: true }))
      .toMatchObject({ ok: true, item: { state: 'dismissed', closedAt: NOW + 1 } });
    expect(eventsOf(s, id)).toEqual(['raise:ccrc', 'decline:operator']);
  });

  it('settle: ccrc moves an open or a checking item to done, and takes no programme context', () => {
    const s = mk();
    const a = raiseHeld(s, null);
    const b = raiseHeld(s, null);
    s.moveItem(b, 'tick', 'operator', {}, NOW + 1, live);
    expect(s.moveItem(a, 'settle', 'ccrc', { note: 'Handled by its coordinator.' }, NOW + 2, { programmeHasOpenRun: true }))
      .toMatchObject({ ok: true, item: { state: 'done' } });
    expect(s.moveItem(b, 'settle', 'ccrc', {}, NOW + 2, { programmeHasOpenRun: true })).toMatchObject({ ok: true, item: { state: 'done' } });
    expect(s.itemHistory(a).at(-1)).toMatchObject({ act: 'settle', actor: 'ccrc', note: 'Handled by its coordinator.' });
  });

  it('the three moves refuse the wrong actor and a closed item', () => {
    const s = mk();
    const id = raiseHeld(s, null);
    expect(s.moveItem(id, 'act', 'coordinator', {}, NOW + 1, live)).toEqual({ ok: false, why: 'wrong-actor' });
    expect(s.moveItem(id, 'decline', 'ccrc', {}, NOW + 1, live)).toEqual({ ok: false, why: 'wrong-actor' });
    expect(s.moveItem(id, 'settle', 'operator', {}, NOW + 1, live)).toEqual({ ok: false, why: 'wrong-actor' });
    s.moveItem(id, 'settle', 'ccrc', {}, NOW + 2, live);
    for (const [act, actor] of [['act', 'operator'], ['decline', 'operator'], ['settle', 'ccrc']] as const) {
      expect(s.moveItem(id, act, actor, {}, NOW + 3, live), act).toEqual({ ok: false, why: 'not-open' });
    }
  });

  it('raiseItem stores the action and the hold, and names its actor on the raise event', () => {
    const s = mk();
    const id = raiseHeld(s, NOW + 180_000, NOW, 'ccrc');
    expect(s.itemById(id)).toMatchObject({ action: END_RUN, heldUntil: NOW + 180_000 });
    const own = raiseHeld(s, null, NOW, 'coordinator');
    expect(eventsOf(s, id)).toEqual(['raise:ccrc']);
    expect(eventsOf(s, own)).toEqual(['raise:coordinator']);
    const plain = raise(s);
    expect(eventsOf(s, plain)).toEqual(['raise:coordinator']);
    expect(s.itemById(plain)).toMatchObject({ action: null, heldUntil: null });
  });

  it('itemsFor leaves out an item whose heldUntil is in the future, and shows it once the hold ends', () => {
    const s = mk();
    const held = raiseHeld(s, NOW + 1000);
    const free = raise(s);
    expect(s.itemsFor('prog-a', NOW).open.map((i) => i.id)).toEqual([free]);
    expect(s.itemsFor(null, NOW + 999).open.map((i) => i.id)).toEqual([free]);
    expect(s.itemsFor('prog-a', NOW + 1000).open.map((i) => i.id)).toEqual([held, free]);
  });

  it('itemById stays raw: it reads a held item', () => {
    const s = mk();
    const id = raiseHeld(s, NOW + 1000);
    expect(s.itemById(id)).toMatchObject({ id, state: 'open', heldUntil: NOW + 1000 });
    expect(s.moveItem(id, 'withdraw', 'coordinator', {}, NOW + 1, live)).toMatchObject({ ok: true, item: { state: 'withdrawn' } });
  });

  it('the last ended end request is the asker\u2019s own, so two parties taking turns cannot hide it', () => {
    const s = mk();
    const ask = (by: string, at: number): number => s.raiseItem({
      program: 'prog-a', runId: 1, raisedBy: by, kind: 'do', title: 'End run: 1', why: 'It can never finish.',
      how: ['Read why it asked.', 'Abandon the run, or keep it.'], options: null, neededBy: 'soon', soonLabel: null, secretSlot: null,
      action: END_RUN, heldUntil: null,
    }, at, 'ccrc');
    const w = ask('lane-w', NOW);
    s.moveItem(w, 'withdraw', 'coordinator', {}, NOW + 1, live);
    const r = ask('lane-r', NOW + 2);
    s.moveItem(r, 'withdraw', 'coordinator', {}, NOW + 3, live);
    expect(s.lastEndedEndRequest(1, 'lane-w')).toMatchObject({ askerId: 'lane-w', at: NOW + 1 });
    expect(s.lastEndedEndRequest(1, 'lane-r')).toMatchObject({ askerId: 'lane-r', at: NOW + 3 });
    expect(s.lastEndedEndRequest(1, 'lane-x')).toBeNull();
  });

  it('a stored action this build does not understand reads as no action and takes no reader down', () => {
    const s = mk();
    const id = raise(s);
    s.db.prepare('UPDATE operator_items SET action = ? WHERE id = ?').run('{"verb":"close-refused"}', id);
    expect(s.itemById(id)).toMatchObject({ id, action: null });
    expect(() => s.openEndRequestOf(1)).not.toThrow();
  });
});

describe('the stored definition of done (D-8126)', () => {
  const SPEC = 'docs/superpowers/specs/2026-11-01-x-design.md';
  it('setSpecPin stores a list, goalsFor reads it, a re-pin with null keeps it', () => {
    const s = mk();
    s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'Prog A', 1, 'active')").run();
    s.setSpecPin('prog-a', SPEC, 'First.', NOW, ['x']);
    expect(s.goalsFor('prog-a').doneWhen).toEqual(['x']);
    s.setSpecPin('prog-a', SPEC, 'Second.', NOW + 1, null);
    expect(s.goalsFor('prog-a')).toMatchObject({ inShort: 'Second.', doneWhen: ['x'] });
    s.setSpecPin('prog-a', SPEC, 'Third.', NOW + 2, ['y', 'z']);
    expect(s.goalsFor('prog-a').doneWhen).toEqual(['y', 'z']);
  });

  it('setDoneWhen replaces the list and touches nothing else', () => {
    const s = mk();
    s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'Prog A', 1, 'active')").run();
    s.setSpecPin('prog-a', SPEC, 'Summary.', NOW, ['x']);
    s.setDoneWhen('prog-a', ['a', 'b'], NOW + 9);
    expect(s.goalsFor('prog-a')).toMatchObject({ specPath: SPEC, inShort: 'Summary.', inShortAt: NOW, doneWhen: ['a', 'b'] });
  });

  it('a programme with no list, no row, or a corrupted value reads null, never a throw', () => {
    const s = mk();
    s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES ('prog-a', 'Prog A', 1, 'active')").run();
    expect(s.goalsFor('prog-a').doneWhen).toBeNull();
    expect(s.goalsFor('prog-z').doneWhen).toBeNull();
    for (const bad of ['not json', '"one"', '[]', '[1]', '[""]', JSON.stringify(Array(13).fill('a'))]) {
      s.db.prepare('UPDATE programs SET doneWhen = ? WHERE slug = ?').run(bad, 'prog-a');
      expect(s.goalsFor('prog-a').doneWhen, bad).toBeNull();
    }
  });
});
