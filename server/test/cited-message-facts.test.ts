// Overlord W2, request record A (plan `w2-requests.md` Task A4, RQ19, F11): `OperatorModelStore.citedMessageFacts`, the private store's
// reader for a citing door. It rehashes the stored text with its own hash, leaves exactly one read-ledger line per call under the door
// `open-request`, and never hands the text out. Fixture files only, neutral names.
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { gateActorOf } from '../src/accounts/audit.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { defaultOperatorModelDbPath, openOperatorModelDb } from '../src/operatorModel/db.js';
import { OperatorModelStore, type CitedMessageFacts, type CitedReadCaller, type PrivacyIssuer } from '../src/operatorModel/store.js';
import { READ_SERVED_OUTCOME } from '../../shared/overlordInbox.js';
import { mkTmp } from './tmpHelpers.js';

const ACTOR = attributionIdentity({ attribute: async () => ({ ok: true }), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) })
  .operator(gateActorOf('Fixture browser', 'abcdef0123456789'));
const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const TEXT = 'a sentence only the operator wrote';
const READER: CitedReadCaller = { at: 5_000, caller: 'overlord', generation: 2, generationRead: 'measured', turnState: 'working' };

function issuer(): PrivacyIssuer {
  let last = 0;
  return { kind: 'ready', issue(hi) { last = Math.max(hi ?? 0, last) + 1; return { ok: true, id: last }; } };
}
interface Fixture { db: DatabaseSync; store: OperatorModelStore }
const opened: DatabaseSync[] = [];
function fixture(): Fixture {
  const db = openOperatorModelDb(defaultOperatorModelDbPath(mkTmp('ccrc-cited-')));
  opened.push(db);
  return { db, store: new OperatorModelStore(db, issuer()) };
}
afterEach(() => { for (const d of opened.splice(0)) if (d.isOpen) d.close(); });

const record = (f: Fixture, over: Partial<Parameters<OperatorModelStore['recordMessage']>[0]> = {}): number => {
  const r = f.store.recordMessage({ at: 1_000, sessionId: 'lane-a-project-a', term: 1, actor: ACTOR, text: TEXT, mark: false, composedKey: null, offRecord: false, ...over });
  if (!r.ok) throw new Error(`${r.error}: ${r.detail}`);
  return r.value.id;
};
const ledger = (f: Fixture) => f.db.prepare('SELECT door, caller, scope, count, outcome, generation, generationRead, turnState, at FROM read_ledger ORDER BY id').all() as
  { door: string; caller: string; scope: string; count: number; outcome: string; generation: number | null; generationRead: string; turnState: string | null; at: number }[];

describe('citedMessageFacts', () => {
  it('answers hashMatches true for a stored row, with its state, time and stored hash', () => {
    const f = fixture();
    const id = record(f);
    expect(f.store.citedMessageFacts(id, READER)).toEqual({ kind: 'measured', value: { state: 'recorded', at: 1_000, sha256: sha(TEXT), hashMatches: true } });
  });

  it('answers hashMatches false after the stored text is changed behind its hash, and still reports the stored hash', () => {
    const f = fixture();
    const id = record(f);
    f.db.prepare('UPDATE operator_messages SET text = ? WHERE id = ?').run('a different sentence', id);
    expect(f.store.citedMessageFacts(id, READER)).toEqual({ kind: 'measured', value: { state: 'recorded', at: 1_000, sha256: sha(TEXT), hashMatches: false } });
  });

  it('a cut message hashes its STORED text (the cut mark included), so it matches', () => {
    const f = fixture();
    const id = record(f, { text: 'x'.repeat(20_000) });
    const r = f.store.citedMessageFacts(id, READER);
    expect(r).toMatchObject({ kind: 'measured', value: { hashMatches: true } });
  });

  it('a message sent off the record is cited like any other: its state, time and hash, its ledger line, and no field more', () => {
    const f = fixture();
    const id = record(f, { offRecord: true });
    const r = f.store.citedMessageFacts(id, READER);
    expect(r).toEqual({ kind: 'measured', value: { state: 'recorded', at: 1_000, sha256: sha(TEXT), hashMatches: true } });
    expect(ledger(f)).toEqual([expect.objectContaining({ door: 'open-request', scope: `message:${id}`, count: 1 })]);
    expect(JSON.stringify([r, ledger(f)])).not.toContain('operator wrote');
  });

  it('answers absent for an id with no row (there is no gone state)', () => {
    const f = fixture();
    record(f);
    expect(f.store.citedMessageFacts(99, READER)).toEqual({ kind: 'measured', value: 'absent' });
  });

  it('reads a state this build lacks as `unknown`, never as a word it knows', () => {
    const f = fixture();
    const id = record(f);
    f.db.prepare("UPDATE operator_messages SET state = 'from-a-later-build' WHERE id = ?").run(id);
    expect(f.store.citedMessageFacts(id, READER)).toMatchObject({ kind: 'measured', value: { state: 'unknown' } });
  });

  it('writes exactly one read-ledger line per call, under the door open-request: count 1 and the served outcome, or count 0 and absent', () => {
    const f = fixture();
    const id = record(f);
    expect(ledger(f)).toEqual([]);
    f.store.citedMessageFacts(id, READER);
    expect(ledger(f)).toEqual([{ door: 'open-request', caller: 'overlord', scope: `message:${id}`, count: 1, outcome: READ_SERVED_OUTCOME,
      generation: 2, generationRead: 'measured', turnState: 'working', at: 5_000 }]);
    f.store.citedMessageFacts(id, { ...READER, at: 5_001 });
    expect(ledger(f)).toHaveLength(2);
    f.store.citedMessageFacts(404, { ...READER, at: 5_002 });
    expect(ledger(f)).toHaveLength(3);
    expect(ledger(f)[2]).toMatchObject({ door: 'open-request', scope: 'message:404', count: 0, outcome: 'absent' });
    // A changed-text answer is still a served read.
    f.db.prepare('UPDATE operator_messages SET text = ? WHERE id = ?').run('changed', id);
    f.store.citedMessageFacts(id, { ...READER, at: 5_003 });
    expect(ledger(f)).toHaveLength(4);
    expect(ledger(f).every((l) => l.door === 'open-request')).toBe(true);
  });

  it('a reader that is not a session (the console) leaves its own kind of line', () => {
    const f = fixture();
    const id = record(f);
    f.store.citedMessageFacts(id, { at: 7, caller: 'operator', generation: null, generationRead: 'not-a-session', turnState: null });
    expect(ledger(f)).toEqual([expect.objectContaining({ door: 'open-request', caller: 'operator', generationRead: 'not-a-session', turnState: null, count: 1 })]);
  });

  it('never hands the text out: its answer type has no field that carries text, nor does the answer or the ledger', () => {
    expectTypeOf<keyof CitedMessageFacts>().toEqualTypeOf<'state' | 'at' | 'sha256' | 'hashMatches'>();
    const f = fixture();
    const id = record(f);
    const r = f.store.citedMessageFacts(id, READER);
    expect(r.kind).toBe('measured');
    if (r.kind === 'measured' && r.value !== 'absent') expect(Object.keys(r.value).sort()).toEqual(['at', 'hashMatches', 'sha256', 'state']);
    expect(JSON.stringify(r)).not.toContain('operator wrote');
    expect(JSON.stringify(ledger(f))).not.toContain('operator wrote');
  });

  it('a closed store answers unmeasured and writes nothing', () => {
    const f = fixture();
    const id = record(f);
    f.db.close();
    expect(f.store.citedMessageFacts(id, READER)).toMatchObject({ kind: 'unmeasured' });
  });

  it('a ledger that cannot take its line makes the read unmeasured, never served, and leaves no line', () => {
    const f = fixture();
    const id = record(f);
    f.db.exec('ALTER TABLE read_ledger RENAME TO read_ledger_gone');
    const r = f.store.citedMessageFacts(id, READER);
    expect(r).toMatchObject({ kind: 'unmeasured' });
    expect(r.kind === 'unmeasured' && r.why).toContain('read ledger');
  });

  it('a read with a line the ledger refuses (a caller word it does not know) is unmeasured, and no row is read as served', () => {
    const f = fixture();
    const id = record(f);
    const r = f.store.citedMessageFacts(id, { ...READER, caller: 'coordinator' as never });
    expect(r).toMatchObject({ kind: 'unmeasured' });
    expect(ledger(f)).toEqual([]);
  });
});
