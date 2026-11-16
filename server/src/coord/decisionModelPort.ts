// Overlord W2, the decision-model port (spec 2026-11-09 §3.6 and §3.7 H6, Table 11.1c; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 3). Ring: L2, context Coordination (C5): types
// only. Declared by its consumer, the one caller (`decisionModelAsk.ts#gatherDecisions`); its one adapter is
// `decisionModelHttp.ts#createHttpDecisionModel`, one wire for the three host kinds (plan question 1).
import type { DecisionHostKind } from '../../../shared/decisionModel.js';
import type { DecisionWireRequest } from './decisionModel.js';

export type { DecisionWireRequest };

/** The failure contract: every distinction the adapter receives survives as its own word, and it never throws. `attempts`
 *  is the HTTP attempts made, 0 to 2, on every answer (review 2262 F5), so the caller settles its reservation to them.
 *  `no-key` is the key read failing between the plan and the call (the caller planned with a key); no request is sent. */
export type DecisionCall =
  | { ok: true; answer: unknown; ms: number; attempts: number }
  | { ok: false; outcome: 'unavailable'; why: 'timeout' | 'unreachable' | 'server-error' | 'endpoint-not-private' | 'no-key';
      status: number | null; ms: number; attempts: number }
  | { ok: false; outcome: 'auth-failed' | 'refused' | 'over-size'; status: number; ms: number; attempts: number }
  | { ok: false; outcome: 'malformed'; why: 'not-json' | 'too-large'; ms: number; attempts: number };

export interface DecisionModel {
  /** The host kind this adapter was built from (question 1): the caller refuses one that differs from its plan's. */
  readonly kind: DecisionHostKind;
  /** The endpoint's scheme, host and port, as the record keys it (review 2262 F20). */
  readonly origin: string;
  ask(req: DecisionWireRequest): Promise<DecisionCall>;
}

/** The `fetch` the adapter is handed, injectable so no test reaches a network. Its body is read as text, so the adapter
 *  measures the 64 KiB cap and a body that is not JSON itself. */
export type DecisionFetch = (url: string, init: {
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
  redirect: 'error';
}) => Promise<{ status: number; text: () => Promise<string> }>;
