// The boot pass's citation inputs (Overlord W2 request record A, plan w2-requests.md Task A4, section 6 "The boot pass's three
// inputs"), written once here for `request-citations-boot.test.ts` and for the two mutant sets in `sim/requestSets.ts`:
// - `citedMessagesForBoot` answers measured, absent or unmeasured, never one folded into another, and reads the root-cited ids
//   apart from the merely cited ones. Fixture databases in temp dirs only; the citation rows are planted by hand (the table has
//   no foreign key), so a case reads the reader alone and not the insert's planner.
// - `bootSpend`, the spend arm's decider: it never takes a mark away, and spends a root-cited row or one at or below a read floor.
import { copyFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect } from 'vitest';
import { openCoordDb } from '../src/coord/db.js';
import type { SuiteCase } from './sim/mutate.js';
import { mkTmp } from './tmpHelpers.js';

export type CitedReaderModule = Pick<typeof import('../src/coord/overlordRequestStore.js'), 'citedMessagesForBoot'>;
export type BootSpendModule = Pick<typeof import('../src/operatorModel/messages.js'), 'bootSpend'>;
type CitationRead = import('../src/operatorModel/messages.js').CitationRead;

let template: string | null = null;
/** A migrated coord.db, copied from one template so a case does not replay every migration. The caller closes it. */
function migrated(): DatabaseSync {
  if (template === null) {
    template = path.join(mkTmp('ccrc-cited-reader-template-'), 'coord.db');
    openCoordDb(template).close();
  }
  const file = path.join(mkTmp('ccrc-cited-reader-'), 'coord.db');
  copyFileSync(template, file);
  return openCoordDb(file);
}
const withDb = (fn: (db: DatabaseSync) => void): void => {
  const db = migrated();
  try { fn(db); } finally { if (db.isOpen) db.close(); }
};
const plant = (db: DatabaseSync, requestId: number, messageId: unknown, root: 0 | 1): void => {
  db.prepare("INSERT INTO overlord_request_messages (requestId, messageId, sha256, root, at) VALUES (?, ?, 'h', ?, 1)")
    .run(requestId, messageId as number, root);
};

export function citedMessagesForBootCases(m: CitedReaderModule): Record<string, SuiteCase> {
  return {
    'a migrated table with no citation is measured, with two empty sets (no request rows: the state of every box today)': () => {
      withDb((db) => { expect(m.citedMessagesForBoot(db)).toEqual({ kind: 'measured', cited: new Set(), rootCited: new Set() }); });
    },
    'reads every cited id, and the root-cited ones apart': () => {
      withDb((db) => {
        plant(db, 1, 11, 1); plant(db, 1, 12, 1);
        plant(db, 2, 12, 0);                                    // a child cites 12 again, as a non-root
        expect(m.citedMessagesForBoot(db)).toEqual({ kind: 'measured', cited: new Set([11, 12]), rootCited: new Set([11, 12]) });
      });
    },
    'a non-root citation alone is cited and not root-cited': () => {
      withDb((db) => {
        plant(db, 1, 11, 1); plant(db, 2, 13, 0);
        expect(m.citedMessagesForBoot(db)).toEqual({ kind: 'measured', cited: new Set([11, 13]), rootCited: new Set([11]) });
      });
    },
    'ids with a gap are read as they stand, never filled in': () => {
      withDb((db) => {
        plant(db, 1, 3, 1); plant(db, 2, 7, 1);
        const r = m.citedMessagesForBoot(db);
        expect(r).toEqual({ kind: 'measured', cited: new Set([3, 7]), rootCited: new Set([3, 7]) });
      });
    },
    'a database without the table answers absent, never measured': () => {
      const bare = new DatabaseSync(':memory:');
      try { expect(m.citedMessagesForBoot(bare)).toEqual({ kind: 'absent' }); } finally { bare.close(); }
      withDb((db) => {
        db.exec('DROP TABLE overlord_request_messages');
        expect(m.citedMessagesForBoot(db)).toEqual({ kind: 'absent' });
      });
    },
    'a closed handle answers unmeasured, never absent': () => {
      const db = migrated();
      db.close();
      const r = m.citedMessagesForBoot(db);
      expect(r.kind).toBe('unmeasured');
    },
    'a citation row with no integer message id is unmeasured, never skipped': () => {
      withDb((db) => {
        db.exec('DROP TABLE overlord_request_messages');
        db.exec('CREATE TABLE overlord_request_messages (requestId INTEGER, messageId, sha256 TEXT, root INTEGER, at INTEGER)');
        plant(db, 1, 11, 1);
        plant(db, 2, 'not-a-number', 1);
        expect(m.citedMessagesForBoot(db)).toEqual({ kind: 'unmeasured', why: 'a citation row holds no integer message id' });
      });
    },
  };
}

export function bootSpendCases(m: BootSpendModule): Record<string, SuiteCase> {
  type State = Parameters<BootSpendModule['bootSpend']>[0]['state'];
  const row = (id: number, state: State) => ({ id, state });
  const measured = (over: Partial<Extract<CitationRead, { kind: 'measured' }>> = {}): CitationRead =>
    ({ kind: 'measured', cited: new Set(), ...over });
  return {
    'a spent row keeps its mark whatever the citations say': () => {
      expect(m.bootSpend(row(1, 'spent'), measured({ rootCited: new Set([1]), restoreFloor: { kind: 'floor', id: 9 } }))).toBe('keep');
      expect(m.bootSpend(row(1, 'spent'), { kind: 'unmeasured', why: 'x' })).toBe('keep');
      expect(m.bootSpend(row(1, 'spent'), { kind: 'not-applicable' })).toBe('keep');
    },
    'citations not measured leave an unspent row unjudged, both ways': () => {
      expect(m.bootSpend(row(1, 'settled'), { kind: 'unmeasured', why: 'x' })).toBe('unjudged');
      expect(m.bootSpend(row(1, 'settled'), { kind: 'not-applicable' })).toBe('unjudged');
    },
    'a root-cited row spends, in any unspent state, a word this build lacks included': () => {
      for (const s of ['settled', 'delivered', 'queued', 'unknown'] as const) {
        expect(m.bootSpend(row(1, s), measured({ cited: new Set([1]), rootCited: new Set([1]) })), s).toBe('spend');
      }
    },
    'a merely cited row keeps, and so does a measured read naming no root citation and no floor': () => {
      expect(m.bootSpend(row(1, 'delivered'), measured({ cited: new Set([1]), rootCited: new Set() }))).toBe('keep');
      expect(m.bootSpend(row(1, 'settled'), measured())).toBe('keep');
      expect(m.bootSpend(row(2, 'settled'), measured({ rootCited: new Set([1]) }))).toBe('keep');
    },
    'a read floor spends at and below it, never above': () => {
      expect(m.bootSpend(row(39, 'settled'), measured({ restoreFloor: { kind: 'floor', id: 40 } }))).toBe('spend');
      expect(m.bootSpend(row(40, 'settled'), measured({ restoreFloor: { kind: 'floor', id: 40 } }))).toBe('spend');
      expect(m.bootSpend(row(41, 'settled'), measured({ restoreFloor: { kind: 'floor', id: 40 } }))).toBe('keep');
    },
    'a floor of none or unreadable spends nothing': () => {
      expect(m.bootSpend(row(1, 'settled'), measured({ restoreFloor: { kind: 'none' } }))).toBe('keep');
      expect(m.bootSpend(row(1, 'settled'), measured({ restoreFloor: { kind: 'unreadable', why: 'x' } }))).toBe('keep');
    },
  };
}
