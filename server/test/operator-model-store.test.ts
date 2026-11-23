// Overlord W1, the private store (plan w1-private-store.md, Task 2): `operator-model.db`, opened by the shared opener, and
// `OperatorModelStore`, the one owner of its SQL. Fixture files only: every path is under a `mkTmp` directory. The privacy
// journal is a double here (an issuer that counts its records); `privacy-journal.test.ts` binds the real one.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { OPERATOR_MODEL_SCHEMA_VERSION } from '../src/operatorModel/schema.js';
import { PrivateStoreUnmigratable, defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { openOperatorModelStore, OperatorModelStore, type PrivacyIssuer } from '../src/operatorModel/store.js';
import type { MessageActor, MessageEvent, MessageState, ReadLine } from '../../shared/operatorMessages.js';
import { EVENT_ACTORS, TABLE_1 } from './sim/operatorModelSets.js';
import { mkTmp } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** A journal double: issues one above the larger of the store's highest and its own, and counts its records. */
function issuerDouble(): PrivacyIssuer & { records: number[] } {
  const records: number[] = [];
  return {
    kind: 'ready',
    records,
    issue(storeHighest) {
      const id = Math.max(storeHighest ?? 0, records.at(-1) ?? 0) + 1;
      records.push(id);
      return { ok: true, id };
    },
  };
}

interface Fixture { p: string; db: DatabaseSync; store: OperatorModelStore; journal: ReturnType<typeof issuerDouble> }
const opened: DatabaseSync[] = [];
function fixture(): Fixture {
  const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
  const db = openOperatorModelDb(p);
  opened.push(db);
  const journal = issuerDouble();
  return { p, db, store: new OperatorModelStore(db, journal), journal };
}
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen) db.close(); });

const record = (f: Fixture, over: Partial<Parameters<OperatorModelStore['recordMessage']>[0]> = {}) => f.store.recordMessage({
  at: 1_000, sessionId: 'lane-a-project-a', term: 1, actor: ACTOR, text: 'hello', mark: false, composedKey: null, ...over,
});
const idOf = (r: ReturnType<OperatorModelStore['recordMessage']>): number => {
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
};
const rawRow = (f: Fixture, id: number): Record<string, unknown> =>
  ({ ...(f.db.prepare('SELECT * FROM operator_messages WHERE id = ?').get(id) as Record<string, unknown>) });
const rowCount = (f: Fixture): number => (f.db.prepare('SELECT count(*) AS c FROM operator_messages').get() as { c: number }).c;

describe('operator-model.db: the shared opener at 0600', () => {
  it('a fresh open migrates to schema 2 (private names B: the name list) and creates the file at 0600 under a 0o022 umask, and its -wal and -shm too', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    const old = process.umask(0o022);
    let db: DatabaseSync;
    try { db = openOperatorModelDb(p); } finally { process.umask(old); }
    opened.push(db);
    expect(OPERATOR_MODEL_SCHEMA_VERSION).toBe(2);
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    db.prepare("INSERT INTO read_ledger (at, door, caller, scope, count, outcome, generationRead) VALUES (1, 'board', 'operator', 's', 0, 'ok', 'not-a-session')").run();
    for (const f of [p, `${p}-wal`, `${p}-shm`]) expect(statSync(f).mode & 0o777, f).toBe(0o600);
    expect(path.basename(p)).toBe('operator-model.db');
  });

  it('a 0-byte file refuses PrivateStoreUnmigratable and is left 0 bytes', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, '');
    expect(() => openOperatorModelDb(p)).toThrow(PrivateStoreUnmigratable);
    expect(statSync(p).size).toBe(0);
  });

  it('a higher user_version opens with no migration and one warning', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    const a = openOperatorModelDb(p);
    a.exec('PRAGMA user_version = 4');
    a.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const b = openOperatorModelDb(p);
      opened.push(b);
      expect((b.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/^ccrc-server: operator-model\.db is at schema 4, this build knows 2/);
    } finally { warn.mockRestore(); }
  });
});

describe('recordMessage', () => {
  it('issues above a witnessed id even when the two local copies agree on an older id', () => {
    const dir = mkTmp('ccrc-opmodel-');
    let witnessed: number | null = null;
    const f = openOperatorModelStore(defaultOperatorModelDbPath(dir), dir, 1000,
      { witnessHighestIds: () => ({ message: witnessed }) });
    opened.push(f.db);
    const input = { at: 1001, sessionId: 'lane-a-project-a', term: 1, actor: ACTOR, text: 'fixture', mark: false, composedKey: null };
    expect(idOf(f.store.recordMessage(input))).toBe(1);
    witnessed = 40;
    expect(idOf(f.store.recordMessage({ ...input, at: 1002 }))).toBe(41);
    witnessed = 2;
    expect(idOf(f.store.recordMessage({ ...input, at: 1003 }))).toBe(42);
  });
  it('records a row, recorded, with its hash and its actor, after one journal record', () => {
    const f = fixture();
    const r = record(f);
    expect(r).toEqual({ ok: true, value: { id: 1, cut: false, state: 'recorded', replay: false } });
    expect(f.journal.records).toEqual([1]);
    expect(rawRow(f, 1)).toMatchObject({
      id: 1, at: 1_000, sessionId: 'lane-a-project-a', term: 1, actor: 'Fixture browser abcdef01', sha256: sha('hello'),
      sendKey: null, text: 'hello', cut: 0, state: 'recorded', queuedAt: null, deliveredAt: null, pickedUpAt: null,
      settledAt: null, settledBy: null, spentAt: null,
    });
  });

  it('the mark records the row settled by mark, stamped at its record', () => {
    const f = fixture();
    expect(record(f, { mark: true, at: 5 })).toEqual({ ok: true, value: { id: 1, cut: false, state: 'settled', replay: false } });
    expect(rawRow(f, 1)).toMatchObject({ state: 'settled', settledAt: 5, settledBy: 'mark' });
  });

  it('a text over the cap is stored cut, and its hash is of the stored text', () => {
    const f = fixture();
    const r = record(f, { text: 'y'.repeat(20_000) });
    expect(r.ok && r.value.cut).toBe(true);
    const row = rawRow(f, 1);
    expect(row.cut).toBe(1);
    expect(row.sha256).toBe(sha(row.text as string));
    expect(Buffer.byteLength(row.text as string)).toBeLessThanOrEqual(16_384);
  });

  it('a send key recorded twice for one session answers one row: the second call replays the first id, with no second journal record', () => {
    const f = fixture();
    const first = record(f, { composedKey: 'key-0123456789abcdef' });
    const again = record(f, { composedKey: 'key-0123456789abcdef', at: 9_999 });
    expect(again).toEqual({ ok: true, value: { id: idOf(first), cut: false, state: 'recorded', replay: true } });
    expect(rowCount(f)).toBe(1);
    expect(f.journal.records).toEqual([1]);
  });

  it('a replay answers the first record\'s current state', () => {
    const f = fixture();
    const id = idOf(record(f, { composedKey: 'key-0123456789abcdef' }));
    expect(f.store.moveMessage(id, 'queue', 'route', 2_000).ok).toBe(true);
    const again = record(f, { composedKey: 'key-0123456789abcdef' });
    expect(again.ok && again.value).toEqual({ id, cut: false, state: 'queued', replay: true });
  });

  it('the same key for another session records a second row', () => {
    const f = fixture();
    record(f, { composedKey: 'key-0123456789abcdef' });
    const other = record(f, { composedKey: 'key-0123456789abcdef', sessionId: 'lane-b-project-a' });
    expect(other).toEqual({ ok: true, value: { id: 2, cut: false, state: 'recorded', replay: false } });
    expect(rowCount(f)).toBe(2);
  });

  it('the same key with other text refuses send-key-reused and writes nothing', () => {
    const f = fixture();
    record(f, { composedKey: 'key-0123456789abcdef' });
    expect(record(f, { composedKey: 'key-0123456789abcdef', text: 'something else' }))
      .toEqual({ ok: false, error: 'refused', detail: 'send-key-reused' });
    expect(rowCount(f)).toBe(1);
    expect(f.journal.records).toEqual([1]);
  });

  it('a null key never dedupes', () => {
    const f = fixture();
    record(f);
    record(f);
    expect(rowCount(f)).toBe(2);
  });

  it('refuses an actor the identity port did not mint, and writes nothing (slug record-message-takes-a-recorded-actor)', () => {
    const f = fixture();
    const forged = { kind: 'operator', subject: 'Fixture browser abcdef01', issuer: 'account-gate', strength: 'operator' };
    // A look-alike literal, a copy of a minted actor and the account gate's own actor (not yet through the port) all refuse.
    for (const actor of [forged, { ...ACTOR }, gateActorOf('Fixture browser', 'abcdef0123456789')]) {
      const r = record(f, { actor: actor as never });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe('refused');
    }
    expect(rowCount(f)).toBe(0);
    expect(f.journal.records).toEqual([]);
  });

  it('refuses an empty session id, and writes nothing', () => {
    const f = fixture();
    expect(record(f, { sessionId: '' })).toEqual({ ok: false, error: 'refused', detail: 'sessionId: empty' });
    expect(rowCount(f)).toBe(0);
    expect(f.journal.records).toEqual([]);
  });

  it('a journal that refused at the open answers journal-unreadable and records nothing', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    const db = openOperatorModelDb(p);
    opened.push(db);
    const store = new OperatorModelStore(db, { kind: 'refused', code: 'bad-digest', detail: 'record 3' });
    const r = store.recordMessage({ at: 1, sessionId: 's', term: 1, actor: ACTOR, text: 't', mark: false, composedKey: null });
    expect(r).toEqual({ ok: false, error: 'journal-unreadable', detail: 'bad-digest: record 3' });
    expect((db.prepare('SELECT count(*) AS c FROM operator_messages').get() as { c: number }).c).toBe(0);
  });

  it('a journal append that fails rolls the row back and answers the journal\'s word', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    const db = openOperatorModelDb(p);
    opened.push(db);
    const store = new OperatorModelStore(db, { kind: 'ready', issue: () => ({ ok: false, error: 'journal-unwritable', detail: 'EROFS' }) });
    const r = store.recordMessage({ at: 1, sessionId: 's', term: 1, actor: ACTOR, text: 't', mark: false, composedKey: null });
    expect(r).toEqual({ ok: false, error: 'journal-unwritable', detail: 'EROFS' });
    expect((db.prepare('SELECT count(*) AS c FROM operator_messages').get() as { c: number }).c).toBe(0);
  });

  it('the issuer is asked inside the insert\'s transaction', () => {
    const p = defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-'));
    const db = openOperatorModelDb(p);
    opened.push(db);
    const seen: boolean[] = [];
    const store = new OperatorModelStore(db, { kind: 'ready', issue: () => { seen.push(db.isTransaction); return { ok: true, id: 1 }; } });
    store.recordMessage({ at: 1, sessionId: 's', term: 1, actor: ACTOR, text: 't', mark: false, composedKey: null });
    expect(seen).toEqual([true]);
  });
});

describe('moveMessage: the one writer, by Table 1', () => {
  const STAMP_COLS = ['queuedAt', 'deliveredAt', 'pickedUpAt', 'settledAt', 'spentAt'] as const;
  const STAMP_OF: Record<MessageEvent, (typeof STAMP_COLS)[number] | null> = {
    queue: 'queuedAt', deliver: 'deliveredAt', 'pick-up': 'pickedUpAt', settle: 'settledAt', spend: 'spentAt', unsettle: null,
  };
  /** A row put in `state` straight through SQL, as a fixture: the store's own writer is what is under test. */
  const rowIn = (f: Fixture, state: MessageState): number => {
    const id = idOf(record(f));
    const settled = state === 'settled' ? { settledAt: 50, settledBy: 'acknowledge' } : { settledAt: null, settledBy: null };
    f.db.prepare('UPDATE operator_messages SET state = ?, settledAt = ?, settledBy = ? WHERE id = ?')
      .run(state, settled.settledAt, settled.settledBy, id);
    return id;
  };

  it('every accepted move writes the state and the event\'s stamp and nothing else; unsettle also clears the settlement pair', () => {
    for (const state of Object.keys(TABLE_1) as MessageState[]) {
      for (const [event, target] of Object.entries(TABLE_1[state]) as [MessageEvent, MessageState | 'stage'][]) {
        const f = fixture();
        const id = rowIn(f, state);
        const before = rawRow(f, id);
        const actor = EVENT_ACTORS[event][0]! as MessageActor;
        const r = f.store.moveMessage(id, event, actor, 777);
        const label = `${state} × ${event}`;
        expect(r.ok, label).toBe(true);
        const after = rawRow(f, id);
        const expected: Record<string, unknown> = { ...before, state: target === 'stage' ? 'recorded' : target };
        const stamp = STAMP_OF[event];
        if (stamp !== null && before[stamp] === null) expected[stamp] = 777;
        if (event === 'settle') expected.settledBy = actor === 'route' ? 'mark' : actor;
        if (event === 'unsettle') { expected.settledAt = null; expected.settledBy = null; }
        expect(after, label).toEqual(expected);
      }
    }
  });

  it('refuses a time that is not a non-negative safe integer, as recordMessage does, and writes nothing (F9)', () => {
    const f = fixture();
    const id = idOf(record(f));
    const before = rawRow(f, id);
    for (const at of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(f.store.moveMessage(id, 'queue', 'route', at), String(at))
        .toEqual({ ok: false, error: 'refused', detail: 'at: not a non-negative safe integer' });
    }
    expect(rawRow(f, id)).toEqual(before);
  });

  it('settle after unsettle stamps both settlement columns again', () => {
    const f = fixture();
    const id = rowIn(f, 'settled');
    expect(f.store.moveMessage(id, 'unsettle', 'boot-pass', 60).ok).toBe(true);
    expect(rawRow(f, id)).toMatchObject({ state: 'recorded', settledAt: null, settledBy: null });
    expect(f.store.moveMessage(id, 'settle', 'acknowledge', 70)).toEqual({ ok: true, value: { changed: true, state: 'settled' } });
    expect(rawRow(f, id)).toMatchObject({ state: 'settled', settledAt: 70, settledBy: 'acknowledge' });
  });

  it('unsettle returns the row to the furthest stage its stamps prove', () => {
    const f = fixture();
    const id = idOf(record(f));
    f.store.moveMessage(id, 'deliver', 'mail-lane', 10);
    f.store.moveMessage(id, 'settle', 'acknowledge', 20);
    expect(f.store.moveMessage(id, 'unsettle', 'boot-pass', 30)).toEqual({ ok: true, value: { changed: true, state: 'delivered' } });
  });

  it('deliver on picked-up stamps deliveredAt and keeps the state', () => {
    const f = fixture();
    const id = idOf(record(f));
    f.store.moveMessage(id, 'pick-up', 'hook', 10);
    expect(f.store.moveMessage(id, 'deliver', 'mail-lane', 20)).toEqual({ ok: true, value: { changed: true, state: 'picked-up' } });
    expect(rawRow(f, id)).toMatchObject({ state: 'picked-up', pickedUpAt: 10, deliveredAt: 20 });
    expect(f.store.moveMessage(id, 'deliver', 'mail-lane', 30)).toEqual({ ok: true, value: { changed: false, state: 'picked-up' } });
    expect(rawRow(f, id)).toMatchObject({ deliveredAt: 20 });
  });

  it('a refused move changes no byte and says why; a move of an absent id is refused', () => {
    const f = fixture();
    const id = idOf(record(f));
    f.store.moveMessage(id, 'deliver', 'mail-lane', 10);
    const before = rawRow(f, id);
    const refused = f.store.moveMessage(id, 'queue', 'route', 20);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toBe('refused');
    expect(!refused.ok && refused.detail).toMatch(/^move: queue by route on delivered$/);
    expect(rawRow(f, id)).toEqual(before);
    const wrongActor = f.store.moveMessage(id, 'settle', 'hook', 20);
    expect(!wrongActor.ok && wrongActor.detail).toMatch(/^actor:/);
    expect(f.store.moveMessage(999, 'queue', 'route', 1)).toEqual({ ok: false, error: 'refused', detail: 'absent: no message 999' });
  });

  it('a row whose state this build does not know reads as unknown and is never moved', () => {
    const f = fixture();
    const id = idOf(record(f));
    f.db.prepare("UPDATE operator_messages SET state = 'archived', settledBy = NULL WHERE id = ?").run(id);
    expect(f.store.messageById(id)).toMatchObject({ kind: 'measured', value: { state: 'unknown' } });
    const r = f.store.moveMessage(id, 'settle', 'acknowledge', 5);
    expect(!r.ok && r.detail).toMatch(/^unknown-state:/);
  });
});

describe('the readers', () => {
  it('unnudged answers a recorded row and a mark-settled row with no stamps, and no row with any of the three stamps', () => {
    const f = fixture();
    const plain = idOf(record(f));
    const marked = idOf(record(f, { mark: true }));
    const queued = idOf(record(f));
    f.store.moveMessage(queued, 'queue', 'route', 1);
    const delivered = idOf(record(f));
    f.store.moveMessage(delivered, 'deliver', 'mail-lane', 1);
    const picked = idOf(record(f));
    f.store.moveMessage(picked, 'pick-up', 'hook', 1);
    const acked = idOf(record(f));
    f.store.moveMessage(acked, 'settle', 'acknowledge', 1);
    // A mark-settled row the lane delivered (or the hook picked up) with no queue stamp: `deliver` may skip `queue`.
    const markedDelivered = idOf(record(f, { mark: true }));
    f.store.moveMessage(markedDelivered, 'deliver', 'mail-lane', 1);
    const markedPicked = idOf(record(f, { mark: true }));
    f.store.moveMessage(markedPicked, 'pick-up', 'hook', 1);
    expect(rawRow(f, markedDelivered)).toMatchObject({ state: 'settled', queuedAt: null, deliveredAt: 1 });
    const r = f.store.unnudged();
    expect(r.kind === 'measured' && r.value.map((x) => x.id)).toEqual([plain, marked]);
  });

  it('unsettledMessages: every row before settled, in id order', () => {
    const f = fixture();
    const a = idOf(record(f));
    idOf(record(f, { mark: true }));
    const c = idOf(record(f));
    f.store.moveMessage(c, 'deliver', 'mail-lane', 1);
    const r = f.store.unsettledMessages();
    expect(r.kind === 'measured' && r.value.map((x) => [x.id, x.state])).toEqual([[a, 'recorded'], [c, 'delivered']]);
  });

  it('messageSessionOf answers the session and no text', () => {
    const f = fixture();
    const id = idOf(record(f, { text: 'a private sentence' }));
    expect(f.store.messageSessionOf(id)).toEqual({ kind: 'measured', value: { sessionId: 'lane-a-project-a' } });
    expect(f.store.messageSessionOf(id + 1)).toEqual({ kind: 'measured', value: 'absent' });
  });

  it('messageById, messagesSince, lastOperatorMessage, highestMessageId and settledRows', () => {
    const f = fixture();
    expect(f.store.lastOperatorMessage()).toEqual({ kind: 'measured', value: 'none' });
    expect(f.store.highestMessageId()).toEqual({ kind: 'measured', value: 'none' });
    record(f, { at: 100 });
    record(f, { at: 200, mark: true });
    record(f, { at: 300 });
    expect(f.store.messagesSince(200)).toEqual({ kind: 'measured', value: 2 });
    expect(f.store.lastOperatorMessage()).toEqual({ kind: 'measured', value: { id: 3, at: 300 } });
    expect(f.store.highestMessageId()).toEqual({ kind: 'measured', value: 3 });
    const s = f.store.settledRows();
    expect(s.kind === 'measured' && s.value.map((x) => x.id)).toEqual([2]);
    expect(f.store.messageById(1)).toMatchObject({ kind: 'measured', value: { id: 1, text: 'hello', state: 'recorded', cut: false } });
    expect(f.store.messageById(9)).toEqual({ kind: 'measured', value: 'absent' });
  });

  it('every reader answers unmeasured, and every writer not-open, on a closed handle', () => {
    const f = fixture();
    record(f);
    f.db.close();
    for (const r of [f.store.messageById(1), f.store.messageSessionOf(1), f.store.unsettledMessages(), f.store.messagesSince(0),
      f.store.lastOperatorMessage(), f.store.highestMessageId(), f.store.settledRows(), f.store.unnudged()]) {
      expect(r.kind).toBe('unmeasured');
    }
    expect(record(f)).toMatchObject({ ok: false, error: 'not-open' });
    expect(f.store.moveMessage(1, 'queue', 'route', 1)).toMatchObject({ ok: false, error: 'not-open' });
    expect(f.store.recordRead(LINE)).toMatchObject({ ok: false, error: 'not-open' });
  });
});

const LINE: ReadLine = {
  at: 1, door: 'board', caller: 'overlord', scope: 'board', count: 3, outcome: 'ok', generation: 2, generationRead: 'measured',
  turnState: 'working',
};

describe('recordRead: the one writer of the read ledger', () => {
  it('writes a session\'s line and a console\'s line', () => {
    const f = fixture();
    expect(f.store.recordRead(LINE)).toEqual({ ok: true, value: { id: 1 } });
    expect(f.store.recordRead({ ...LINE, caller: 'operator', generation: null, generationRead: 'not-a-session', turnState: null }))
      .toEqual({ ok: true, value: { id: 2 } });
    expect(f.store.recordRead({ ...LINE, caller: 'reader', generation: null, generationRead: 'unmeasured', turnState: 'stale' }))
      .toEqual({ ok: true, value: { id: 3 } });
  });

  it('refuses each CHECK violation, and an unknown door, caller or turn word, before SQLite does', () => {
    const f = fixture();
    const bad: [string, Partial<Record<keyof ReadLine, unknown>>][] = [
      ['generation without measured', { generationRead: 'unmeasured' }],
      ['measured without generation', { generation: null }],
      ['operator with a turn', { caller: 'operator', generation: null, generationRead: 'not-a-session' }],
      ['session without a turn', { turnState: null }],
      ['operator not not-a-session', { caller: 'operator', turnState: null }],
      ['not-a-session for a session', { generation: null, generationRead: 'not-a-session' }],
      ['unknown door', { door: 'model' }],
      ['unknown caller', { caller: 'coordinator' }],
      ['unknown turn word', { turnState: 'idle' }],
      ['unknown generation word', { generationRead: 'guessed' }],
      ['negative count', { count: -1 }],
      ['empty scope', { scope: '' }],
      ['long scope', { scope: 's'.repeat(201) }],
      ['outcome not kebab', { outcome: 'Not Kebab' }],
      ['long outcome', { outcome: 'a'.repeat(41) }],
    ];
    const prepare = vi.spyOn(f.db, 'prepare');
    for (const [name, over] of bad) {
      const r = f.store.recordRead({ ...LINE, ...over } as ReadLine);
      expect(r.ok, name).toBe(false);
      expect(!r.ok && r.error, name).toBe('refused');
    }
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    expect((f.db.prepare('SELECT count(*) AS c FROM read_ledger').get() as { c: number }).c).toBe(0);
  });
});

describe('readsBetween: the count closed-book reads (Overlord W1 door process B1)', () => {
  it('counts the named callers\' lines in the closed span, never the operator\'s or an outside line', () => {
    const f = fixture();
    const reader = { ...LINE, caller: 'reader' as const, generation: null, generationRead: 'unmeasured' as const, turnState: 'stale' as const };
    const operator = { ...LINE, caller: 'operator' as const, generation: null, generationRead: 'not-a-session' as const, turnState: null };
    f.store.recordRead({ ...LINE, at: 99 });
    f.store.recordRead({ ...LINE, at: 100 });
    f.store.recordRead({ ...reader, at: 150 });
    f.store.recordRead({ ...operator, at: 150 });
    f.store.recordRead({ ...LINE, at: 200 });
    f.store.recordRead({ ...LINE, at: 201 });
    expect(f.store.readsBetween(['overlord', 'reader'], 100, 200)).toEqual({ kind: 'measured', value: 3 });
    expect(f.store.readsBetween(['overlord'], 100, 200)).toEqual({ kind: 'measured', value: 2 });
    expect(f.store.readsBetween(['overlord', 'reader'], 202, 300)).toEqual({ kind: 'measured', value: 0 });
  });
  it('is unmeasured, never zero, for a closed store, an empty or unknown caller list and a bad bound', () => {
    const f = fixture();
    expect(f.store.readsBetween([], 0, 1).kind).toBe('unmeasured');
    expect(f.store.readsBetween(['nobody' as never], 0, 1).kind).toBe('unmeasured');
    expect(f.store.readsBetween(['overlord'], -1, 1).kind).toBe('unmeasured');
    expect(f.store.readsBetween(['overlord'], 0, 1.5).kind).toBe('unmeasured');
    f.db.close();
    expect(f.store.readsBetween(['overlord'], 0, 1).kind).toBe('unmeasured');
  });
});
