// Overlord W1, the private store (plan w1-private-store.md, Task 7): a `message` as a note key, for a `miss`. The key's fact
// is read through `noteKeyReader` (L3) over the store's text-free `messageSessionOf` and the designation read, and decided by
// `noteKeyFact` (L1). Fixture HOMEs only (`mkTmp`); neutral names.
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { CoordStore } from '../src/coord/store.js';
import { noteKeyReader, type NoteKeysMessages } from '../src/continuity/noteKeys.js';
import { noteKeyFact, noteVerdict, type NoteInput } from '../src/continuity/notes.js';
import { openOperatorModelDb, defaultOperatorModelDbPath } from '../src/operatorModel/db.js';
import { OperatorModelStore, type PrivacyIssuer, type StoreRead } from '../src/operatorModel/store.js';
import { noteKeyText } from '../../shared/continuity.js';
import type { DesignationRead } from '../../shared/overlord-designation.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const OVERLORD = 'lane-a-project-a';
const OTHER = 'lane-b-project-a';
const opened: DatabaseSync[] = [];
afterEach(() => { for (const d of opened.splice(0)) { try { d.close(); } catch { /* closed */ } } removeTmpFixtures(); });

function issuer(): PrivacyIssuer {
  let n = 0;
  return { kind: 'ready', issue: (high) => { n = Math.max(n, high ?? 0) + 1; return { ok: true, id: n }; } };
}
function store(): { store: OperatorModelStore; db: DatabaseSync } {
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-opmodel-note-')));
  opened.push(db);
  return { store: new OperatorModelStore(db, issuer()), db };
}
const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
function record(s: OperatorModelStore): number {
  const r = s.recordMessage({ at: 1_000, sessionId: OVERLORD, term: 1, actor: ACTOR, text: 'the radar is red', mark: false, composedKey: null });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
}
const designated = (sessionId: string): DesignationRead => ({ kind: 'designated', sessionId, term: 1, row: {} as never });
const none: DesignationRead = { kind: 'not-designated', row: null };

/** A coord double with the other reads unused: only `designationRead` matters to a `message` key. */
function coordWith(read: () => DesignationRead): CoordStore {
  return { designationRead: read } as unknown as CoordStore;
}
const input = (over: Partial<NoteInput> = {}): NoteInput => ({
  key: { kind: 'message', id: 1 }, kind: 'miss', waitsOn: 'the operator', next: '', revises: null, closes: false, ...over,
});

describe('a message as a note key', () => {
  it('is live for the designated session, not-yours for another, gone when absent', () => {
    const { store: s } = store();
    const id = record(s);
    const mine = noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD, s);
    const theirs = noteKeyReader(coordWith(() => designated(OVERLORD)), OTHER, s);
    expect(noteKeyFact(mine({ kind: 'message', id }), OVERLORD)).toBe('live');
    expect(noteKeyFact(theirs({ kind: 'message', id }), OTHER)).toBe('not-yours');
    expect(noteKeyFact(mine({ kind: 'message', id: id + 9 }), OVERLORD)).toBe('gone');
    expect(noteKeyFact(noteKeyReader(coordWith(() => none), OVERLORD, s)({ kind: 'message', id }), OVERLORD)).toBe('not-yours');
  });
  it('a pending body is not the designated session: it reads as roleOf reads it (pending first), never live', () => {
    const { store: s } = store();
    const id = record(s);
    const view = (live: string | null, pending: string | null) => ({ pending: pending === null ? null : { sessionId: pending, kind: 'rebind' as const }, term: 2 }) as never;
    const pendingOnly: DesignationRead = { kind: 'not-designated', row: view(null, OTHER) };
    const bothSame: DesignationRead = { kind: 'designated', sessionId: OTHER, term: 2, row: view(OTHER, OTHER) };
    const fact = (read: DesignationRead): string => noteKeyFact(noteKeyReader(coordWith(() => read), OTHER, s)({ kind: 'message', id }), OTHER);
    expect(fact(pendingOnly)).toBe('not-yours');
    expect(fact(bothSame)).toBe('not-yours');
    expect(fact(designated(OTHER))).toBe('live');
  });
  it('reads unmeasured when either read failed or is absent', () => {
    const { store: s, db } = store();
    const id = record(s);
    const throws = coordWith(() => { throw new Error('boom'); });
    expect(noteKeyFact(noteKeyReader(throws, OVERLORD, s)({ kind: 'message', id }), OVERLORD)).toBe('unmeasured');
    expect(noteKeyFact(noteKeyReader(coordWith(() => ({ kind: 'unmeasured', why: 'x' })), OVERLORD, s)({ kind: 'message', id }), OVERLORD)).toBe('unmeasured');
    expect(noteKeyFact(noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD)({ kind: 'message', id }), OVERLORD)).toBe('unmeasured');
    db.close();
    expect(noteKeyFact(noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD, s)({ kind: 'message', id }), OVERLORD)).toBe('unmeasured');
    const boom: NoteKeysMessages = { messageSessionOf: () => { throw new Error('boom'); } };
    expect(noteKeyFact(noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD, boom)({ kind: 'message', id }), OVERLORD)).toBe('unmeasured');
  });
  it('a store that cannot be read answers the generic unmeasured, as the door does for any key', () => {
    const { store: s, db } = store();
    const id = record(s);
    db.close();
    const fact = noteKeyFact(noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD, s)({ kind: 'message', id }), OVERLORD);
    expect(noteVerdict(input({ key: { kind: 'message', id } }), fact, 0, 'not-revising')).toEqual({ ok: false, refusal: 'unmeasured' });
  });
  it('a miss keyed to a message of the designated session is accepted; keyed to a run, or a thread keyed to a message, is bad-request', () => {
    const { store: s } = store();
    const id = record(s);
    const fact = noteKeyFact(noteKeyReader(coordWith(() => designated(OVERLORD)), OVERLORD, s)({ kind: 'message', id }), OVERLORD);
    expect(noteVerdict(input({ key: { kind: 'message', id } }), fact, 0, 'not-revising')).toEqual({ ok: true });
    expect(noteVerdict(input({ key: { kind: 'run', id: 4 } }), 'live', 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
    expect(noteVerdict(input({ kind: 'thread', next: 'x', key: { kind: 'message', id } }), fact, 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
    expect(noteVerdict(input({ kind: 'caution', key: { kind: 'message', id } }), fact, 0, 'not-revising')).toEqual({ ok: false, refusal: 'bad-request' });
  });
  it("a non-designated caller's miss reads not-yours and is refused note-key-unknown; an absent message is gone", () => {
    const { store: s } = store();
    const id = record(s);
    const read = noteKeyReader(coordWith(() => designated(OVERLORD)), OTHER, s);
    expect(noteVerdict(input({ key: { kind: 'message', id } }), noteKeyFact(read({ kind: 'message', id }), OTHER), 0, 'not-revising'))
      .toEqual({ ok: false, refusal: 'note-key-unknown' });
    expect(noteVerdict(input({ key: { kind: 'message', id: 99 } }), noteKeyFact(read({ kind: 'message', id: 99 }), OTHER), 0, 'not-revising'))
      .toEqual({ ok: false, refusal: 'note-key-unknown' });
  });
  it('the card renders a miss note\'s key as message 12', () => {
    expect(noteKeyText({ kind: 'message', id: 12 })).toBe('message 12');
  });
});

describe('noteKeys.ts takes no reader that returns a text', () => {
  it('the port is the text-free messageSessionOf (a type test)', () => {
    expectTypeOf<NoteKeysMessages>().toEqualTypeOf<Pick<OperatorModelStore, 'messageSessionOf'>>();
    type Out = ReturnType<NoteKeysMessages['messageSessionOf']>;
    expectTypeOf<Out>().toEqualTypeOf<StoreRead<{ readonly sessionId: string } | 'absent'>>();
    expectTypeOf<NoteKeysMessages>().not.toHaveProperty('messageById');
    expectTypeOf<NoteKeysMessages>().not.toHaveProperty('unsettledMessages');
  });
});
