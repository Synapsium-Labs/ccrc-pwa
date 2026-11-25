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
const LS = 'server/src/coord/overlordLadderStore.ts';
const INBOX = 'server/src/coord/overlordInboxRoutes.ts#registerOverlordInboxRoutes';
const STAMP_ACK = 'server/src/coord/overlordSequenceStore.ts#stampInboxAcknowledgement';
const STAMP_MESSAGE = 'server/src/coord/overlordSequenceStore.ts#stampMessageLine';
const ML = 'server/src/operatorModel/messageLine.ts';
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
      [`${OM}#OperatorModelStore.recordMessage`]: 'creation as recorded stamps no line; a marked message, created settled, gets its settled line from the route right after the record commits (call 1218)',
      [`${OM}#OperatorModelStore.moveMessage`]: 'no transaction spans the private store and coord.db: every move\'s line is stamped after its commit, by the movers listed in MESSAGE_MOVERS (call 1218)',
    },
    afterCommit: { route: INBOX, delegate: RECORD_ACK, stamp: STAMP_ACK },
  },
  'ladder-rung': {
    table: 'overlord_ladder',
    stampers: [`${LS}#setRungInTx`, `${LS}#applyRestoreInTx`],
    nothing: {
      [`${LS}#journalPendingInTx`]: 'the catch-up stamps a pending record\'s sequence only; the rung it records was stamped when it moved',
    },
  },
  'ladder-latch': {
    table: 'overlord_latches',
    stampers: [`${LS}#raiseLatchInTx`, `${LS}#clearLatchInTx`, `${LS}#applyRestoreInTx`],
    nothing: {
      [`${LS}#journalPendingInTx`]: 'the catch-up stamps a pending record\'s sequence only; the latch it records was stamped when it was raised',
    },
  },
};

/** The operator message's after-commit path (call 1218, slug `message-lines-stamp-after-the-move`; review 3646 F8): the one helper
 *  that calls the writer for the kind, the functions that call it, and EVERY caller of the private store's move in server/src, each
 *  with how its line is written. A new caller of the move (a W2 citing door, say) goes red here until it takes a side. */
const MESSAGE_STAMP_CALLERS = [STAMP_ACK, `${ML}#stampOperatorMessageLine`] as const;
const MESSAGE_LINE_CALLERS = [`${ML}#moveOperatorMessage`, 'server/src/operatorModel/promptRecord.ts#recordOperatorPrompt'] as const;
export const MESSAGE_MOVERS: Readonly<Record<string, string>> = {
  [`${ML}#moveOperatorMessage`]: 'the one combinator: the move, then its line when the state word changed, in one synchronous segment',
  'server/src/coord/overlordInboxRoutes.ts#registerOverlordInboxRoutes': 'acknowledge: settles, then stamps through recordInboxAcknowledgement and answers 503 when the line is refused (PR A)',
  'server/src/server.ts#buildServer': 'the hook\'s pick-up port: moves with no line until its peer packet lands (the continuity routes and server.ts are held by another run)',
};
/** Every caller of the combinator, in server/src. */
const COMBINATOR_CALLERS = [
  'server/src/operatorModel/bootPass.ts#runOperatorModelBootPass', 'server/src/operatorModel/nudgeLane.ts#deliverWhileQueued',
  'server/src/operatorModel/promptRecord.ts#recordOperatorPrompt',
] as const;

/** The helpers a stamper calls, each of which calls the writer and checks its answer. */
const TX_STAMP_HELPERS = [`${CS}#stampGeneration`, `${DS}#stampLines`, `${LS}#stampLadderLine`] as const;
const AFTER_COMMIT = Object.values(STAMPED_TABLES).flatMap((row) => row.afterCommit === undefined ? [] : [row.afterCommit]);
const STAMP_HELPERS = [...TX_STAMP_HELPERS, STAMP_MESSAGE];

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

  it('the message kind\'s one helper is called only by the acknowledgement and the line stamp, and those only by their listed callers', () => {
    expect(callersOf(split(STAMP_MESSAGE)[1])).toEqual([...MESSAGE_STAMP_CALLERS].sort());
    expect(callersOf('stampOperatorMessageLine')).toEqual([...MESSAGE_LINE_CALLERS].sort());
    expect(callersOf('moveOperatorMessage')).toEqual([...COMBINATOR_CALLERS].sort());
  });

  it('every caller of the private store\'s move in server/src is listed with how its line is written (review 3646 F8)', () => {
    expect(callersOf('moveMessage')).toEqual(Object.keys(MESSAGE_MOVERS).sort());
  });
});
