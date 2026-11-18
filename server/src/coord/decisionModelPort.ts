// Overlord W2, the decision-model port (spec 2026-11-09 §3.6 and §3.7 H6, Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 3). Ring: L2, context Coordination (C5): types
// only. Declared by its consumer, the one caller (`decisionModelAsk.ts#gatherDecisions`); its one adapter is
// `decisionModelHttp.ts#createHttpDecisionModel`, one wire for the three host kinds (plan question 1).
import type {
  DecisionBand, DecisionHeldCause, DecisionHostKind, DecisionMalformedWhy, DecisionRowId, DecisionRowSide, DecisionRowState,
  DecisionVerdict,
} from '../../../shared/decisionModel.js';
import type { DecisionUsage, DecisionWireRequest } from './decisionModel.js';
import type { LabelledAnswer } from './decisionLines.js';

export type { DecisionWireRequest };

/** The failure contract: every distinction the adapter receives survives as its own word, and it never throws. `attempts`
 *  is the HTTP attempts made, 0 to 2, on every answer (review 2262 F5), so the caller settles its reservation to them.
 *  `no-key` is the key read failing between the plan and the call (the caller planned with a key); no request is sent. */
export type DecisionCall =
  | { ok: true; answer: unknown; ms: number; attempts: number }
  | { ok: false; outcome: 'unavailable'; why: 'timeout' | 'unreachable' | 'server-error' | 'endpoint-not-private' | 'no-key'
      | 'endpoint-not-literal' | 'endpoint-unparseable';
      status: number | null; ms: number; attempts: number }
  | { ok: false; outcome: 'auth-failed' | 'refused' | 'over-size'; status: number; ms: number; attempts: number }
  | { ok: false; outcome: 'malformed'; why: Extract<DecisionMalformedWhy, 'not-json' | 'too-large'>; ms: number; attempts: number };

export interface DecisionModel {
  /** The host kind this adapter was built from (question 1): the caller refuses one that differs from its plan's. */
  readonly kind: DecisionHostKind;
  /** The endpoint's scheme, host and port, as the record keys it (review 2262 F20); null when the endpoint does not parse,
   *  which the caller answers as its own word, never as another host (review 2324 F4). */
  readonly origin: string | null;
  ask(req: DecisionWireRequest): Promise<DecisionCall>;
}

/** The `fetch` the adapter is handed, injectable so no test reaches a network. Its body is read chunk by chunk, so the
 *  adapter stops at the 64 KiB cap while reading (review 2324 F6) and tells a body that is not JSON itself. A `Response`'s
 *  `body` (a web `ReadableStream`) is such an iterable; null reads as an empty body. */
export type DecisionFetch = (url: string, init: {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  redirect: 'error';
}) => Promise<{ status: number; body: AsyncIterable<Uint8Array> | null }>;

// ── the records and the day counts, as the one caller reads and writes them ─────────────────────────────────────────

/** A record's key (question 7, review 2262 F20): the same state under another host, model, line or revision is a new key. */
export interface DecisionRecordKey {
  readonly row: DecisionRowId;
  readonly revision: string;
  readonly modelId: string;
  readonly hostKind: DecisionHostKind;
  readonly origin: string;
  /** SHA-256 of the canonical state sent, hex. */
  readonly stateHash: string;
  readonly lineGen: number;
}

/** One answer to keep. `refs` holds the state's ref fields, ids only; `inline` the non-private quoted and fact fields, and is
 *  null for a private-state row, whose writer refuses anything else (question 7). */
export interface DecisionRecordWrite extends DecisionRecordKey {
  readonly verdict: DecisionVerdict;
  readonly p: number;
  readonly band: DecisionBand;
  readonly ms: number;
  readonly refs: Readonly<Record<string, string | readonly string[]>>;
  readonly inline: Readonly<Record<string, string | readonly string[]>> | null;
  readonly at: number;
}

/** A record read under a key: none, the record, or a row this build cannot read (a word out of its vocabulary, or a failed
 *  read). Three conditions, three words. An unreadable record is never reused: the row is asked anew, and its answer is not
 *  recorded over the row already holding the key. */
export type DecisionRecordRead =
  | { kind: 'none' }
  | { kind: 'record'; id: number; verdict: DecisionVerdict; p: number; band: DecisionBand; ms: number }
  | { kind: 'unreadable' };

/** The store as the one caller uses it, declared here by its consumer and built from the database by
 *  `decisionModelStore.ts#decisionAskStore`. No method throws. */
export interface DecisionAskStore {
  /** Whether a transaction is open on the database: the caller refuses to ask a model inside one (H6). */
  inTransaction(): boolean;
  recordOf(key: DecisionRecordKey): DecisionRecordRead;
  /** In ONE transaction, row by row: read the row's usage, ask `decide`, and reserve `DECISION_RESERVE_PER_REQUEST` calls on
   *  each row it says yes to, so a later row and a concurrent gather see the reservation. `unmeasured` when the
   *  transaction failed: nothing was reserved. */
  reserve(day: string, rows: readonly { row: DecisionRowId; ceiling: number }[],
    decide: (row: DecisionRowId, usage: DecisionUsage) => boolean): readonly DecisionRowId[] | 'unmeasured';
  /** Release a request's reservation and count the attempts made on every row it carried. False when it was not written. */
  settle(day: string, kind: 'serve' | 'maintain', rows: readonly DecisionRowId[], reserved: number, attempts: number,
    unavailableMs: number): boolean;
  /** Keep an answer. `recorded: false` names the record already under the key; `failed` means nothing was written. */
  record(r: DecisionRecordWrite): { recorded: true; id: number } | { recorded: false; id: number } | { failed: true };
}

// ── PR B: the ports the anchor-set lane and the composition root fill (plan Tasks 8 and 9, questions 8 and 9) ───────────────

/** The hosted egress screen (question 9), declared by its consumer. `no-list`: no list was ever uploaded; `unreadable`: a list
 *  exists and cannot be read. Private names B fills it; until then the composition root passes `noListYet`. */
export interface DecisionEgress { screen(texts: readonly string[]): 'clear' | 'hit' | 'no-list' | 'unreadable' }

/** A row's labelled cases under its revision (question 8): the label queue fills it. A case is its refs (ids only), its
 *  non-private inline fields when it has them, and the label. The composition root passes an empty source until then. */
export interface LabelledCases {
  casesFor(row: DecisionRowId, revision: string): readonly {
    refs: Record<string, string | readonly string[]>; inline: Record<string, string> | null; label: LabelledAnswer['label'];
  }[];
}

/** A case's state, rebuilt from its refs (question 7): the fields, or `unresolvable` when a ref no longer resolves, which drops
 *  the case from admission, counted. */
export interface DecisionStateReads {
  fieldsOf(row: DecisionRowId, refs: Record<string, string | readonly string[]>, inline: Record<string, string> | null):
    Record<string, string | readonly string[]> | 'unresolvable';
}

// ── PR B: the arming store, as the doors and the anchor-set lane use it (plan Tasks 6, 7 and 9) ──────────────────────────
// Declared here by its consumers (`decisionModelRoutes.ts`, `decisionModelLane.ts`, both L4) and built over coord.db and the
// authority journal by `decisionModelStore.ts#decisionArmingStore` (L3), so no L4 file holds the database handle
// (`single-definition/core-vocab.test.ts`'s coord-ring rule).

/** A row as stored, or a row this build cannot read (a mode or cause out of its vocabulary, a ceiling that is not an integer,
 *  half or an out-of-range armed line, or a failed read): never folded into the default. An absent row reads the default. */
export type DecisionRowRead = { kind: 'row'; state: DecisionRowState } | { kind: 'unreadable' };

/** One arming move (the store's one writer of `decision_rows`, `moveDecisionRowInTx`). */
export interface DecisionRowMove {
  row: DecisionRowId;
  /** The side the caller read (a door: the operator's `expected`): the move refuses `row-changed` when the row is not it. */
  expected: DecisionRowSide;
  to: DecisionRowSide;
  /** Why `to` is held. Null keeps a held row's cause when `to` stays held, and is no cause when it is not held. */
  heldCause: DecisionHeldCause | null;
  /** The device actor, or `server` for a hold. */
  actor: string;
  at: number;
  opKey: string;
}
/** The authority journal writer's refusals, word for word (`overlordAuthorityJournal.ts#AuthorityAppendError`). */
export type DecisionAuthorityError = 'not-in-transaction' | 'bad-entry' | 'authority-rolled-back' | 'authority-unmeasured' | 'journal-append';
export type DecisionRowMoved =
  | { ok: true; kind: 'appended' | 'row-only'; state: DecisionRowState }
  | { ok: false; error: 'row-changed' | 'row-unreadable' }
  | { ok: false; error: DecisionAuthorityError; detail: string };

/** The host as stored. The key is never here: `keySetAt` says when it was last set, null after a removal. */
export interface DecisionHostRow {
  readonly kind: DecisionHostKind; readonly endpoint: string; readonly origin: string; readonly modelId: string;
  readonly keySetAt: number | null; readonly updatedAt: number; readonly actor: string;
}
export type DecisionHostRead = { kind: 'none' } | { kind: 'host'; host: DecisionHostRow } | { kind: 'unreadable' };

/** A line to admit (`admitLine`'s answer, with its key and its anchors' baseline on the day of admission, review 2262 F12). */
export interface DecisionLineWrite {
  readonly row: DecisionRowId; readonly revision: string; readonly hostKind: DecisionHostKind; readonly origin: string;
  readonly modelId: string; readonly line: number; readonly labelled: number; readonly errors: number; readonly bound: number;
  readonly canaryExpected: number; readonly baseline: readonly DecisionBand[]; readonly admittedAt: number;
}
export interface DecisionLineRow extends DecisionLineWrite { readonly id: number; readonly canaryAsked: number; readonly canaryCrossed: number }
/** A line's key: a line is current only under the host kind, origin, model and row revision it was admitted under. */
export interface DecisionLineKey { readonly hostKind: DecisionHostKind; readonly origin: string; readonly modelId: string; readonly revision: string }

/** The reads, none of which throws but `lineById` and `currentLine` on a database that cannot be read. */
export interface DecisionArmingReads {
  rowRead(row: DecisionRowId): DecisionRowRead;
  /** The side outside a door: an unreadable row reads `off`, the row disarmed (ruling F16). */
  rowSide(row: DecisionRowId): DecisionRowSide;
  hostRead(): DecisionHostRead;
  lineById(id: number): DecisionLineRow | null;
  currentLine(row: DecisionRowId, key: DecisionLineKey): DecisionLineRow | null;
  usage(row: DecisionRowId, day: string, ceiling: number): DecisionUsage;
}
/** Inside one transaction: the reads, an arming move, and the host. */
export interface DecisionArmingTx extends DecisionArmingReads {
  move(m: DecisionRowMove): DecisionRowMoved;
  setHost(host: { kind: DecisionHostKind; endpoint: string; origin: string; modelId: string; keySetAt: number | null }, actor: string, at: number): void;
}
export interface DecisionArmingStore extends DecisionArmingReads {
  /** One transaction: everything `fn` does commits together, or a throw rolls it back. */
  inTx<T>(fn: (t: DecisionArmingTx) => T): T;
  /** One arming move in its own transaction. */
  move(m: DecisionRowMove): DecisionRowMoved;
  admitLine(w: DecisionLineWrite): number;
  recordCanary(lineId: number, asked: number, crossed: number): void;
  recordAnchorRun(row: DecisionRowId, day: string, bands: readonly DecisionBand[], drift: boolean): void;
}
