// The post-append receipt's own cases (review 3646 F4, call 1216; sequence PR B1 piece 4): `txWithAuthorityReceipt` in the
// authority journal's module, over an in-memory database and a scripted appender. The journal suite runs them against the module,
// and the mutation floor runs the same cases against each receipt mutant (`sim/designationSets.ts`, the receipt set).
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import type { AuthorityAppend } from '../src/coord/overlordAuthorityJournal.js';
import type { OverlordAuthorityMove } from '../src/coord/overlordAuthority.js';

type Journal = typeof import('../src/coord/overlordAuthorityJournal.js');
const ENTRY = { kind: 'authority-rung', opKey: 'op-1', from: 'chat', to: 'off' } as unknown as OverlordAuthorityMove;

/** A database with one table, and an appender answering `answer` and counting its receipt's calls, with whether each came inside a
 *  transaction. */
function rig(answer: 'appended' | 'row-only' | 'refused', receipt: () => void = () => {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (v INTEGER)');
  const calls: boolean[] = [];
  const journal = {
    appendInTx: (): AuthorityAppend => answer === 'appended'
      ? { ok: true, kind: 'appended', record: { sequence: 1 }, postAppendFailed: () => { calls.push(db.isTransaction); receipt(); } } as unknown as AuthorityAppend
      : answer === 'row-only' ? { ok: true, kind: 'row-only', state: { kind: 'unmeasured', why: 'fixture' } } as unknown as AuthorityAppend
        : { ok: false, error: 'journal-append', detail: 'refused for the test' },
  };
  const rows = (): number => (db.prepare('SELECT count(*) AS n FROM t').get() as { n: number }).n;
  return { db, journal, calls, rows };
}

export function authorityReceiptCases(m: Journal): Record<string, () => void> {
  return {
    'a throw after a durable append calls the receipt once, after the rollback, and rethrows the original error': () => {
      const r = rig('appended');
      expect(() => m.txWithAuthorityReceipt(r.db, r.journal, (j) => {
        j.appendInTx(r.db, ENTRY); r.db.exec('INSERT INTO t VALUES (1)'); throw new Error('a later write failed');
      })).toThrow(/^a later write failed$/);
      expect(r.calls).toEqual([false]);
      expect(r.rows()).toBe(0);
    },
    'a write that returns commits, answers its value and calls no receipt': () => {
      const r = rig('appended');
      expect(m.txWithAuthorityReceipt(r.db, r.journal, (j) => { j.appendInTx(r.db, ENTRY); r.db.exec('INSERT INTO t VALUES (1)'); return 'done'; })).toBe('done');
      expect(r.calls).toEqual([]);
      expect(r.rows()).toBe(1);
    },
    'the appender handed to the write answers exactly what the journal answered': () => {
      for (const answer of ['appended', 'row-only', 'refused'] as const) {
        const r = rig(answer);
        const seen = m.txWithAuthorityReceipt(r.db, r.journal, (j) => j.appendInTx(r.db, ENTRY));
        expect(seen, answer).toMatchObject(answer === 'appended' ? { ok: true, kind: 'appended' } : answer === 'row-only' ? { ok: true, kind: 'row-only' } : { ok: false });
      }
    },
    'a throw with no append calls nothing, even after an earlier transaction appended and committed': () => {
      const r = rig('appended');
      m.txWithAuthorityReceipt(r.db, r.journal, (j) => j.appendInTx(r.db, ENTRY));
      expect(() => m.txWithAuthorityReceipt(r.db, r.journal, () => { throw new Error('nothing appended'); })).toThrow('nothing appended');
      expect(r.calls).toEqual([]);
    },
    'a row-only or refused answer arms nothing': () => {
      for (const answer of ['row-only', 'refused'] as const) {
        const r = rig(answer);
        expect(() => m.txWithAuthorityReceipt(r.db, r.journal, (j) => { j.appendInTx(r.db, ENTRY); throw new Error('after'); })).toThrow('after');
        expect(r.calls, answer).toEqual([]);
      }
    },
    'a receipt that throws never replaces the original error': () => {
      const r = rig('appended', () => { throw new Error('receipt failed'); });
      expect(() => m.txWithAuthorityReceipt(r.db, r.journal, (j) => { j.appendInTx(r.db, ENTRY); throw new Error('the first error'); }))
        .toThrow(/^the first error$/);
      expect(r.calls).toEqual([false]);
    },
  };
}
