// The one sequence's stamp census (Overlord spec §10.4; plan `w1-sequence-monitor.md` Task 2, questions 2 to 4). For every kind
// of `SEQUENCE_KIND_MAP`: its table, the writers that stamp a line (each one changes the row's state word, or creates or ends a
// row), and every other writer of the same table, each with the reason it stamps nothing. A new writer of a stamped table must
// take a side here. Read by symbol (`scan/symbols.ts`), never the whole file as text.
import { describe, expect, it } from 'vitest';
import { sqlWrites } from './single-definition/sqlStatements.js';
import { ALL, rel } from './single-definition/helpers.js';
import { callsIn, parsedFile, symbolOf } from './scan/symbols.js';
import { SEQUENCE_KINDS, type SequenceKind } from '../../shared/overlord-sequence.js';

const CS = 'server/src/continuity/continuityStore.ts';
const DS = 'server/src/coord/overlordDesignationStore.ts';
const OM = 'server/src/operatorModel/store.ts';
const INBOX = 'server/src/coord/overlordInboxRoutes.ts#registerOverlordInboxRoutes';
const STAMP_ACK = 'server/src/coord/overlordSequenceStore.ts#stampInboxAcknowledgement';
const RECORD_ACK = 'server/src/coord/store.ts#CoordStore.recordInboxAcknowledgement';
const WRITER = 'stampSequenceInTx';

interface StampedTable {
  readonly table: string;
  /** `file#symbol` of each writer that stamps. */
  readonly stampers: readonly string[];
  /** `file#symbol` of each other writer of the table, and why it stamps nothing in its transaction. */
  readonly nothing: Readonly<Record<string, string>>;
  /** The named cross-file exception: a route stamps only after its private-store writer commits. */
  readonly afterCommit?: { readonly route: string; readonly delegate: string; readonly stamp: string };
}

export const STAMPED_TABLES: Readonly<Record<SequenceKind, StampedTable>> = {
  generation: {
    table: 'continuity_generations',
    stampers: [`${CS}#mintGeneration`, `${CS}#stepGeneration`, `${CS}#endOverlordGeneration`],
    nothing: {
      [`${CS}#clearShadowWalk`]: 'it removes a shadow walk\'s residue and never moves `state` (slug shadow-walks-stamp-nothing)',
      [`${CS}#setGenerationDue`]: 'the due fields only',
      [`${CS}#advanceObserved`]: 'the accumulator only',
      [`${CS}#setHoldOff`]: 'the hold-off only',
      [`${CS}#restampOverlordGeneration`]: 'the identity and term, not the state: designation B\'s rebind ends the old body\'s generation through `endOverlordGeneration`, which stamps (slug restamp-stays-identity-only)',
    },
  },
  designation: {
    table: 'overlord_designation',
    stampers: [`${DS}#designatePending`, `${DS}#rebindPending`, `${DS}#goLive`, `${DS}#goLiveRebind`, `${DS}#failPending`, `${DS}#retire`,
      `${DS}#applyDesignationRestoreInTx`],
    nothing: {
      [`${DS}#bindPendingGeneration`]: 'it fills the pending attempt\'s generation once; the state stays pending',
      [`${DS}#stopDone`]: 'the owed-stop list only',
      [`${DS}#setModelClass`]: 'the model class, a Settings value, not a state',
      [`${DS}#setAccountSet`]: 'the account set, a Settings value, not a state',
      'server/src/coord/schema.ts#(module)': 'a migration\'s one-time backfill of the pending actor columns',
    },
  },
  message: {
    table: 'operator_messages',
    stampers: [],
    nothing: {
      [`${OM}#OperatorModelStore.recordMessage`]: 'creation stays in the private store; PR B owns the settlement-mark and queue stamps (message-stamps-ride-pr-b)',
      [`${OM}#OperatorModelStore.moveMessage`]: 'no transaction spans the private store and coord.db; PR A stamps the Inbox acknowledgement after commit, PR B owns the queue, delivery and settle stamps and the mover-caller census (message-stamps-ride-pr-b)',
    },
    afterCommit: { route: INBOX, delegate: RECORD_ACK, stamp: STAMP_ACK },
  },
};

/** The helpers a stamper calls, each of which calls the writer and checks its answer. */
const TX_STAMP_HELPERS = [`${CS}#stampGeneration`, `${DS}#stampLines`] as const;
const AFTER_COMMIT = Object.values(STAMPED_TABLES).flatMap((row) => row.afterCommit === undefined ? [] : [row.afterCommit]);
const STAMP_HELPERS = [...TX_STAMP_HELPERS, ...AFTER_COMMIT.map((row) => row.stamp)];

const split = (ref: string): [string, string] => { const i = ref.indexOf('#'); return [ref.slice(0, i), ref.slice(i + 1)]; };
const callsOf = (ref: string): string[] => { const [f, n] = split(ref); return callsIn(symbolOf(f, n)).map((c) => c.name ?? c.callee); };
const SERVER_SRC = ALL.filter((f) => rel(f).startsWith('server/src/'));

/** The innermost symbol of `file` around each call named `name`: `file#symbol`. */
function callersOf(name: string): string[] {
  const out: string[] = [];
  for (const abs of SERVER_SRC) {
    const p = parsedFile(abs);
    for (const c of p.calls.filter((x) => (x.name ?? x.callee) === name)) {
      const around = p.symbols.filter((s) => s.start <= c.start && c.end <= s.end).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
      out.push(`${rel(abs)}#${around?.name ?? '(module)'}`);
    }
  }
  return [...new Set(out)].sort();
}

describe('the sequence stamp census (Overlord §10.4)', () => {
  it('every kind of SEQUENCE_KIND_MAP has a row here, and every row\'s kind is in the map', () => {
    expect(Object.keys(STAMPED_TABLES).sort()).toEqual([...SEQUENCE_KINDS].sort());
  });

  it('each kind\'s stampers and non-stampers, together, are exactly the writers of its table, both ways', () => {
    const files = ALL.filter((f) => !rel(f).startsWith('pwa/'));
    for (const [kind, row] of Object.entries(STAMPED_TABLES)) {
      const measured = [...new Set(sqlWrites(files, [row.table]).map((w) => w.writer))].sort();
      expect([...row.stampers, ...Object.keys(row.nothing)].sort(), kind).toEqual(measured);
    }
  });

  it('every stamper calls the writer through a helper that checks its answer', () => {
    for (const ref of STAMP_HELPERS) {
      const [f, n] = split(ref);
      const src = symbolOf(f, n).text;
      expect(callsOf(ref), ref).toContain(WRITER);
      expect(src, `${ref} reads the answer and rolls back on failure`).toMatch(/if \(!s\.ok\) (?:\{ refused\.answer = s; )?throw /);
    }
    const helperNames = STAMP_HELPERS.map((r) => split(r)[1]);
    for (const row of Object.values(STAMPED_TABLES)) {
      for (const ref of row.stampers) expect(callsOf(ref).some((c) => helperNames.includes(c) || c === WRITER), ref).toBe(true);
    }
  });

  it('no writer that stamps nothing calls the writer or a stamp helper', () => {
    const helperNames = STAMP_HELPERS.map((r) => split(r)[1]);
    for (const row of Object.values(STAMPED_TABLES)) {
      for (const ref of Object.keys(row.nothing).filter((r) => !r.endsWith('#(module)'))) {
        expect(callsOf(ref).filter((c) => helperNames.includes(c) || c === WRITER), ref).toEqual([]);
      }
    }
  });

  it('every call of the writer in server/src sits in a listed helper, and every call of a helper in a listed stamper', () => {
    expect(callersOf(WRITER)).toEqual([...STAMP_HELPERS].sort());
    const stampers = Object.values(STAMPED_TABLES).flatMap((r) => r.stampers);
    for (const ref of TX_STAMP_HELPERS) {
      const [f, n] = split(ref);
      const callers = callersOf(n).filter((c) => c.startsWith(`${f}#`));
      expect(callers.length, ref).toBeGreaterThan(0);
      for (const c of callers) expect(stampers, `${c} calls ${n}`).toContain(c);
    }
  });

  it('each post-commit stamp is reachable only through its listed delegate and route', () => {
    for (const { route, delegate, stamp } of AFTER_COMMIT) {
      expect(callersOf(split(stamp)[1])).toEqual([delegate]);
      expect(callersOf(split(delegate)[1].split('.').at(-1)!)).toEqual([route]);
    }
  });
});
