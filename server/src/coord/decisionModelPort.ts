// Overlord W2, the decision-model port (spec 2026-11-09 §3.6 and §3.7 H6, Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 3). Ring: L2, context Coordination (C5): types
// only. Declared by its consumer, the one caller (`decisionModelAsk.ts#gatherDecisions`); its one adapter is
// `decisionModelHttp.ts#createHttpDecisionModel`, one wire for the three host kinds (plan question 1).
import type {
  DecisionBand, DecisionHostKind, DecisionMalformedWhy, DecisionRowId, DecisionVerdict,
} from '../../../shared/decisionModel.js';
import type { DecisionUsage, DecisionWireRequest } from './decisionModel.js';

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
