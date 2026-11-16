// Overlord W2, row revisions (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-revisions.md, Task 1): every writer of
// `asks` and `operator_items`, characterized. Table R1's thirteen UPDATE statements and the two inserts each get a case
// that pins what the writer returns and the row's columns after it, and every guarded writer a second case whose guard
// misses and leaves the row as it was. The columns are named, never `SELECT *`, so a later column changes no pin here.
// Task 2 adds the revision to each case: 0 at an insert, one more after each effective write the census
// (`single-definition/row-revisions.test.ts`) classes `raises`, and unchanged after a missed guard, a bookkeeping write, a
// take then an untake (ruled F14) and a re-stamp to the same `askAt` (question 2).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { tx } from '../src/coord/tx.js';
import { stampReach } from '../src/coord/pushOutboxStore.js';
import { APPROVAL_INPUT_RETENTION_DAYS } from '../../shared/api.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const OLD = NOW - APPROVAL_INPUT_RETENTION_DAYS * 86_400_000 - 1;
const mk = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-row-revisions-'), '.ccrc', 'coord.db')));

type Table = 'asks' | 'operator_items';
type Row = Record<string, unknown>;
const FIELDS: Record<Table, readonly string[]> = {
  asks: ['id', 'at', 'childId', 'parentId', 'runId', 'askKey', 'askAt', 'dialogId', 'question', 'options', 'state', 'answeredBy',
    'answer', 'answeredAt', 'releasedAt', 'releaseReason', 'corrected', 'reachedOperatorAt'],
  operator_items: ['id', 'program', 'runId', 'raisedBy', 'kind', 'title', 'why', 'how', 'options', 'neededBy', 'soonLabel',
    'secretSlot', 'state', 'answer', 'note', 'raisedAt', 'tickedAt', 'closedAt', 'recommended', 'recommendedWhy', 'action',
    'heldUntil', 'reachedOperatorAt'],
};
const revisionsOf = (s: CoordStore, table: Table, ids: readonly number[]): number[] =>
  ids.map((id) => (s.db.prepare(`SELECT revision FROM ${table} WHERE id = ?`).get(id) as { revision: number }).revision);
const rowsOf = (s: CoordStore, table: Table, ids: readonly number[]): Row[] =>
  ids.map((id) => ({ ...(s.db.prepare(`SELECT ${FIELDS[table].join(', ')} FROM ${table} WHERE id = ?`).get(id) as Row) }));

const ask = (s: CoordStore, over: { at?: number; askAt?: number; dialogId?: string; childId?: string } = {}): number =>
  s.insertAsk({ childId: over.childId ?? 'lane-a', parentId: 'lane-b', runId: null, askKey: 'k-1', askAt: over.askAt ?? 1000,
    dialogId: over.dialogId ?? 'd-1', question: 'Which one?', options: ['a', 'b'], now: over.at ?? NOW });
const taken = (s: CoordStore): number => { const id = ask(s); expect(s.takeAskForAnswer(id, 1000).ok).toBe(true); return id; };
const item = (s: CoordStore, now = NOW): number => s.raiseItem({
  program: 'project-a', runId: null, raisedBy: 'lane-a', kind: 'do', title: 'Turn on the setting', why: 'The wave needs it.',
  how: ['Open Settings', 'Switch it on'], options: null, neededBy: 'soon', soonLabel: 'before wave 6', secretSlot: null,
}, now);
const live = { programmeHasOpenRun: false };

/** One effective or refused write: `seed` makes the rows (its ids, in order), `act` is the writer, `returns` what it
 *  answers (matched as an object when it is one), and `after` the rows the write leaves, from the rows before it. */
interface WriteCase {
  name: string;
  table: Table;
  seed: (s: CoordStore) => number[];
  act: (s: CoordStore, ids: number[]) => unknown;
  returns: unknown;
  after: (before: Row[]) => Row[];
  /** `raise`: every row this case changes is one revision on; `same`: no row's revision moves. */
  revision: 'raise' | 'same';
}
const same = (before: Row[]): Row[] => before;
const set = (fields: Row) => (before: Row[]): Row[] => before.map((r) => ({ ...r, ...fields }));

const CASES: readonly WriteCase[] = [
  // CoordStore.takeAskForAnswer: the in-flight hold.
  { name: 'takeAskForAnswer takes a held ask', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.takeAskForAnswer(id!, 1000), returns: { ok: true, from: 'held' }, after: set({ state: 'answering' }), revision: 'same' },
  { name: 'takeAskForAnswer refuses a moved askAt', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.takeAskForAnswer(id!, 999), returns: { ok: false, why: 'ask-moved' }, after: same, revision: 'same' },
  { name: 'takeAskForAnswer refuses a declined ask', table: 'asks', seed: (s) => { const id = ask(s); s.declineAsk(id, NOW + 1); return [id]; },
    act: (s, [id]) => s.takeAskForAnswer(id!, 1000), returns: { ok: false, why: 'declined' }, after: same, revision: 'same' },
  // CoordStore.untakeAsk: the hold's rollback.
  { name: 'untakeAsk puts an answering ask back', table: 'asks', seed: (s) => [taken(s)],
    act: (s, [id]) => s.untakeAsk(id!, 'held'), returns: true, after: set({ state: 'held' }), revision: 'same' },
  { name: 'untakeAsk refuses an ask that is not answering', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.untakeAsk(id!, 'released'), returns: false, after: same, revision: 'same' },
  { name: 'a take then an untake leaves the row as it was', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => { expect(s.takeAskForAnswer(id!, 1000).ok).toBe(true); return s.untakeAsk(id!, 'held'); },
    returns: true, after: same, revision: 'same' },
  // CoordStore.settleAsk: the answer.
  { name: 'settleAsk settles an answering ask', table: 'asks', seed: (s) => [taken(s)],
    act: (s, [id]) => s.settleAsk(id!, 'lane-b', 'a', NOW + 2), returns: undefined,
    after: set({ state: 'answered', answeredBy: 'lane-b', answer: 'a', answeredAt: NOW + 2 }), revision: 'raise' },
  { name: 'settleAsk leaves a held ask', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.settleAsk(id!, 'lane-b', 'a', NOW + 2), returns: undefined, after: same, revision: 'same' },
  // CoordStore.releaseAsk: the lapse.
  { name: 'releaseAsk releases a held ask', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.releaseAsk(id!, NOW + 3), returns: true, after: set({ state: 'released', releasedAt: NOW + 3 }), revision: 'raise' },
  { name: 'releaseAsk refuses a declined ask', table: 'asks', seed: (s) => { const id = ask(s); s.declineAsk(id, NOW + 1); return [id]; },
    act: (s, [id]) => s.releaseAsk(id!, NOW + 3), returns: false, after: same, revision: 'same' },
  // CoordStore.declineAsk: the parent's release.
  { name: 'declineAsk declines a held ask', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.declineAsk(id!, NOW + 4), returns: true, after: set({ state: 'declined', releasedAt: NOW + 4 }), revision: 'raise' },
  { name: 'declineAsk refuses a released ask', table: 'asks', seed: (s) => { const id = ask(s); s.releaseAsk(id, NOW + 1); return [id]; },
    act: (s, [id]) => s.declineAsk(id!, NOW + 4), returns: false, after: same, revision: 'same' },
  // CoordStore.staleAsk: the dialog went.
  { name: 'staleAsk stales a held ask', table: 'asks', seed: (s) => [ask(s)],
    act: (s) => s.staleAsk('d-1', 'lane-a', NOW + 5), returns: true, after: set({ state: 'stale', releasedAt: NOW + 5 }), revision: 'raise' },
  { name: 'staleAsk stales an answering ask', table: 'asks', seed: (s) => [taken(s)],
    act: (s) => s.staleAsk('d-1', 'lane-a', NOW + 5), returns: true, after: set({ state: 'stale', releasedAt: NOW + 5 }), revision: 'raise' },
  { name: 'staleAsk leaves an ask of another dialog', table: 'asks', seed: (s) => [ask(s)],
    act: (s) => s.staleAsk('d-2', 'lane-a', NOW + 5), returns: false, after: same, revision: 'same' },
  // CoordStore.restampAsk: askAt advanced.
  { name: 'restampAsk to the same askAt changes nothing on the row', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.restampAsk({ id: id!, dialogId: 'd-1', askKey: 'k-1', askAt: 1000 }), returns: true, after: same, revision: 'same' },
  { name: 'restampAsk moves askAt', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.restampAsk({ id: id!, dialogId: 'd-1', askKey: 'k-1', askAt: 1500 }), returns: true, after: set({ askAt: 1500 }), revision: 'raise' },
  { name: 'restampAsk refuses another question', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.restampAsk({ id: id!, dialogId: 'd-1', askKey: 'k-2', askAt: 1500 }), returns: false, after: same, revision: 'same' },
  { name: 'restampAsk refuses an answering ask', table: 'asks', seed: (s) => [taken(s)],
    act: (s, [id]) => s.restampAsk({ id: id!, dialogId: 'd-1', askKey: 'k-1', askAt: 1500 }), returns: false, after: same, revision: 'same' },
  // CoordStore.pruneAskQuestions: the retention wipe, two old rows and one new.
  { name: 'pruneAskQuestions wipes the question of old rows only', table: 'asks',
    seed: (s) => [ask(s, { at: OLD, childId: 'lane-a' }), ask(s, { at: OLD, childId: 'lane-c' }), ask(s, { childId: 'lane-d' })],
    act: (s) => s.pruneAskQuestions(NOW), returns: 2,
    after: ([a, b, c]) => [{ ...a, question: '', options: '[]' }, { ...b, question: '', options: '[]' }, c!], revision: 'same' },
  { name: 'pruneAskQuestions leaves a wiped row', table: 'asks', seed: (s) => { const id = ask(s, { at: OLD }); s.pruneAskQuestions(NOW); return [id]; },
    act: (s) => s.pruneAskQuestions(NOW), returns: 0, after: same, revision: 'same' },
  // CoordStore.correctWithMail: the correction flag.
  { name: 'correctWithMail marks an ask corrected, with its mail', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => s.correctWithMail('ask', id!, () => 'queued'), returns: 'queued', after: set({ corrected: 1 }), revision: 'same' },
  // pushOutboxStore.ts#stampReach, ask arm.
  { name: 'stampReach stamps an ask once', table: 'asks', seed: (s) => [ask(s)],
    act: (s, [id]) => tx(s.db, () => stampReach(s.db, 'ask', id!, NOW + 6)), returns: { changed: true },
    after: set({ reachedOperatorAt: NOW + 6 }), revision: 'same' },
  { name: 'stampReach leaves a stamped ask', table: 'asks', seed: (s) => { const id = ask(s); tx(s.db, () => stampReach(s.db, 'ask', id, NOW + 6)); return [id]; },
    act: (s, [id]) => tx(s.db, () => stampReach(s.db, 'ask', id!, NOW + 7)), returns: { changed: false }, after: same, revision: 'same' },
  // ledgersStore.ts#moveItemInTx: an item's move.
  { name: 'moveItem ticks an open item', table: 'operator_items', seed: (s) => [item(s)],
    act: (s, [id]) => s.moveItem(id!, 'tick', 'operator', { answer: 'blue' }, NOW + 1, live), returns: { ok: true, item: { state: 'checking' } },
    after: set({ state: 'checking', tickedAt: NOW + 1, answer: 'blue' }), revision: 'raise' },
  { name: 'moveItem refuses a move the decider refuses', table: 'operator_items', seed: (s) => [item(s)],
    act: (s, [id]) => s.moveItem(id!, 'confirm', 'coordinator', {}, NOW + 1, live), returns: { ok: false, why: 'not-open' }, after: same, revision: 'same' },
  // ledgersStore.ts#setBlocking: neededBy.
  { name: 'setBlocking moves an open item to blocking', table: 'operator_items', seed: (s) => [item(s)],
    act: (s, [id]) => s.setBlocking(id!, true, NOW + 1), returns: { ok: true, changed: true }, after: set({ neededBy: 'blocking' }), revision: 'same' },
  { name: 'setBlocking leaves a blocking item', table: 'operator_items', seed: (s) => { const id = item(s); s.setBlocking(id, true, NOW + 1); return [id]; },
    act: (s, [id]) => s.setBlocking(id!, true, NOW + 2), returns: { ok: true, changed: false }, after: same, revision: 'same' },
  { name: 'setBlocking refuses a closed item', table: 'operator_items',
    seed: (s) => { const id = item(s); expect(s.moveItem(id, 'dismiss', 'operator', {}, NOW + 1, live).ok).toBe(true); return [id]; },
    act: (s, [id]) => s.setBlocking(id!, true, NOW + 2), returns: { ok: false, why: 'not-open' }, after: same, revision: 'same' },
  // pushOutboxStore.ts#stampReach, item arm.
  { name: 'stampReach stamps an item once', table: 'operator_items', seed: (s) => [item(s)],
    act: (s, [id]) => tx(s.db, () => stampReach(s.db, 'item', id!, NOW + 6)), returns: { changed: true },
    after: set({ reachedOperatorAt: NOW + 6 }), revision: 'same' },
  { name: 'stampReach leaves a stamped item', table: 'operator_items',
    seed: (s) => { const id = item(s); tx(s.db, () => stampReach(s.db, 'item', id, NOW + 6)); return [id]; },
    act: (s, [id]) => tx(s.db, () => stampReach(s.db, 'item', id!, NOW + 7)), returns: { changed: false }, after: same, revision: 'same' },
];

describe('every writer of asks and operator_items, characterized (Overlord W2 row revisions, Task 1)', () => {
  it('insertAsk mints a held ask', () => {
    const s = mk();
    const id = ask(s);
    expect(rowsOf(s, 'asks', [id])).toEqual([{ id, at: NOW, childId: 'lane-a', parentId: 'lane-b', runId: null, askKey: 'k-1',
      askAt: 1000, dialogId: 'd-1', question: 'Which one?', options: '["a","b"]', state: 'held', answeredBy: null, answer: null,
      answeredAt: null, releasedAt: null, releaseReason: null, corrected: 0, reachedOperatorAt: null }]);
  });

  it('insertAsk mints a released ask with its reason', () => {
    const s = mk();
    const id = s.insertAsk({ childId: 'lane-a', parentId: 'lane-b', runId: null, askKey: 'k-1', askAt: 1000, dialogId: 'd-1',
      question: 'Which one?', options: ['a'], now: NOW, releaseReason: 'parent-not-live' });
    expect(rowsOf(s, 'asks', [id])).toEqual([expect.objectContaining({ state: 'released', releasedAt: NOW, releaseReason: 'parent-not-live' })]);
  });

  it('raiseItem raises an open item', () => {
    const s = mk();
    const id = item(s);
    expect(rowsOf(s, 'operator_items', [id])).toEqual([{ id, program: 'project-a', runId: null, raisedBy: 'lane-a', kind: 'do',
      title: 'Turn on the setting', why: 'The wave needs it.', how: '["Open Settings","Switch it on"]', options: null,
      neededBy: 'soon', soonLabel: 'before wave 6', secretSlot: null, state: 'open', answer: null, note: null, raisedAt: NOW,
      tickedAt: null, closedAt: null, recommended: null, recommendedWhy: null, action: null, heldUntil: null,
      reachedOperatorAt: null }]);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const s = mk();
    const ids = c.seed(s);
    const before = rowsOf(s, c.table, ids);
    const got = c.act(s, ids);
    if (typeof c.returns === 'object' && c.returns !== null) expect(got).toMatchObject(c.returns);
    else expect(got).toBe(c.returns);
    expect(rowsOf(s, c.table, ids)).toEqual(c.after(before));
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s: the revision', (_name, c) => {
    const s = mk();
    const ids = c.seed(s);
    const before = revisionsOf(s, c.table, ids);
    const rows = rowsOf(s, c.table, ids);
    c.act(s, ids);
    const changed = c.after(rows).map((r, i) => JSON.stringify(r) !== JSON.stringify(rows[i]));
    expect(revisionsOf(s, c.table, ids)).toEqual(before.map((r, i) => (c.revision === 'raise' && changed[i] ? r + 1 : r)));
  });

  it('an insert starts at revision 0, and no insert names the column', () => {
    const s = mk();
    const a = ask(s);
    const r = s.insertAsk({ childId: 'lane-c', parentId: 'lane-b', runId: null, askKey: 'k-1', askAt: 1000, dialogId: 'd-1',
      question: 'Which one?', options: ['a'], now: NOW, releaseReason: 'parent-not-live' });
    expect([...revisionsOf(s, 'asks', [a, r]), ...revisionsOf(s, 'operator_items', [item(s)])]).toEqual([0, 0, 0]);
  });
});
