import { IDLE_RUN_STATES, isRegistryId, isRunState, parseCanonicalPositiveSafeInteger, transitionsFor } from '../../../shared/api.js';
import type { RunKind, RunState } from '../../../shared/api.js';

/**
 * `POST /api/runs/:id/advance`'s ordered gates, decided (D-TBD-arch33-advance-gate, audit ticket ARCH-33, GitHub
 * #550; the pattern of `openRunPreconditions`, ARCH-21). L1: no `fs`, no fastify, no `reply`, no clock; its value
 * imports are L0, `shared/api.ts`. The route (`coord/routes.ts`, L4) gathers the facts, calls `advanceGate` inside
 * `coordMutex`, answers a refusal through `refuse.ts`'s `refuseAdvance`, and acts: the re-measurement
 * (`verifyDone`), `CoordStore.advance` and the read-back are the route's, because each is an effect.
 *
 * WHAT MOVED HERE, behaviour-identical: the body shape and the target scope, the run read's three answers, the
 * transition edge, the dispatched session, design 2026-09-14 §9 invariant 3 (a work run under review is not sent
 * back), the spec §7.2 pin 2 cap on re-entering an active state, and spec §2.3's stored-id re-check.
 *
 * THE ORDER IS THE CONTRACT. `ADVANCE_GATES` runs top to bottom and the first refusal wins, so a request two gates
 * refuse gets the earlier one's answer. `advance-gate.test.ts` pins it with a row per adjacent pair one request can
 * trip together, each with a recorded reorder mutant, and `advance-gate-order-route.test.ts` holds what the wire
 * answers. The lookups are passed in and called LAZILY by the gate that needs each, so a refusal costs only the
 * reads ahead of it: the review lookup is made for a work run sent back to `working` only, the caps read for a
 * re-entry from an idle state only.
 */

/** The three states this route reaches: `dispatch` and `close` own every other edge. */
export const ADVANCE_TARGETS: readonly RunState[] = ['working', 'awaiting-review', 'merging'];

/** The run, as far as the gates read it. */
export interface AdvanceRunFacts { readonly kind: RunKind; readonly state: RunState; readonly sessionId: string | null }

export interface AdvanceGateFacts<R extends AdvanceRunFacts = AdvanceRunFacts> {
  /** The request's `to`, shaped by `advanceRequest`. */
  readonly to: RunState;
  /** `CoordStore.run(id)`: a row, no row, or an unreadable store (D-2545), never folded into one another. */
  readonly read: () => { ok: true; run: R | null } | { ok: false; detail: string };
  /** `CoordStore.reviewInFlightFor(id)`: the live review run of this work run, or null. */
  readonly reviewInFlight: () => number | null;
  /** `capsMeasured(coord).overConcurrency`: the numbers a refusal says, or null when a slot is free. */
  readonly overConcurrency: () => { limit: number; running: number } | null;
}

/** The body of a `reject` object: its `code` and exactly the fields the inline sends wrote. */
export type AdvanceReject =
  | { code: 'unknown-run' | 'not-dispatched' | 'bad-session' }
  | { code: 'bad-transition'; detail: string }
  | { code: 'bad-transition'; from: RunState; to: RunState }
  | { code: 'review-in-flight'; reviewRunId: number }
  | { code: 'cap-concurrency'; limit: number; running: number };

/** One refusal: the bare shape `error`, the unreadable store's `error` with its detail, or a `reject`. */
export type AdvanceRefusal =
  | { error: 'bad-request' }
  | { error: 'run-unreadable'; detail: string }
  | { reject: AdvanceReject };

/** What the route reads of the request: a `to` and a fingerprint of four typed fields (`prPhase` is checked
 *  against the closed set later, by `verifyDone`, as before). */
export interface AdvanceBody {
  to?: unknown;
  fingerprint?: { branchTip?: unknown; prNumber?: unknown; prPhase?: unknown; handoffCommit?: unknown };
}
export interface AdvanceRequest {
  id: number;
  to: RunState;
  fingerprint: { branchTip: string; prNumber: number | null; prPhase: string; handoffCommit: string };
}

/** The request's own three gates, in order and before the run is read: the canonical run id and the body shape
 *  (both `bad-request`), then the target scope (`bad-transition` with a `detail`, since no run is involved yet). */
export function advanceRequest(idParam: string, b: AdvanceBody):
  { ok: true; req: AdvanceRequest } | { ok: false; refusal: AdvanceRefusal } {
  const id = parseCanonicalPositiveSafeInteger(idParam);
  const fp = b.fingerprint;
  if (id === null || !isRunState(b.to) || typeof fp !== 'object' || fp === null ||
      typeof fp.branchTip !== 'string' || typeof fp.handoffCommit !== 'string' ||
      typeof fp.prPhase !== 'string' || !(fp.prNumber === null || typeof fp.prNumber === 'number')) {
    return { ok: false, refusal: { error: 'bad-request' } };
  }
  if (!ADVANCE_TARGETS.includes(b.to)) {
    return { ok: false, refusal: { reject: { code: 'bad-transition',
      detail: `POST /api/runs/:id/advance only reaches ${ADVANCE_TARGETS.join('/')} — ` +
        "'planned'/'dispatched' are POST .../dispatch's job and 'closing'/'done'/'failed' are POST .../close's" } } };
  }
  return { ok: true, req: { id, to: b.to,
    fingerprint: { branchTip: fp.branchTip, prNumber: fp.prNumber, prPhase: fp.prPhase, handoffCommit: fp.handoffCommit } } };
}

interface Ctx { readonly f: AdvanceGateFacts<AdvanceRunFacts>; run?: AdvanceRunFacts }
type GateResult = AdvanceRefusal | undefined;

/**
 * THE GATES, IN ORDER. One entry per refusal condition, each on its own line so a reorder is a one-line swap.
 * Comments name the inline handler's reasons for each position.
 */
const GATES = [
  // D-2545: an unreadable store is 503, a fact about this box, not the request; it answers ahead of `unknown-run`
  // because 404 would tell the coordinator a row sitting in the table does not exist. Before any re-measurement.
  ['read', (c) => {
    const r = c.f.read();
    if (!r.ok) return { error: 'run-unreadable', detail: r.detail };
    if (r.run === null) return { reject: { code: 'unknown-run' } };
    c.run = r.run;
    return undefined;
  }],
  ['edge', (c) => (transitionsFor(c.run!.kind)[c.run!.state] as readonly RunState[]).includes(c.f.to) ? undefined
    : { reject: { code: 'bad-transition', from: c.run!.state, to: c.f.to } }],
  ['dispatched', (c) => c.run!.sessionId === null ? { reject: { code: 'not-dispatched' } } : undefined],
  // Design 2026-09-14 §9 invariant 3 — the pair never disagrees. A work run under review cannot be moved back to
  // `working` until its review run is terminal. Ahead of the cap: a definite refusal before a contingent one.
  ['reviewInFlight', (c) => {
    if (c.f.to !== 'working' || c.run!.kind !== 'work') return undefined;
    const inflight = c.f.reviewInFlight();
    return inflight === null ? undefined : { reject: { code: 'review-in-flight', reviewRunId: inflight } };
  }],
  // Spec 2026-09-14 §7.2 pin 2: the one legal edge back INTO an active state takes the cap check dispatch takes.
  // `dispatched -> working` is not checked: that run is already counted.
  ['cap', (c) => {
    if (c.f.to !== 'working' || !(IDLE_RUN_STATES as readonly RunState[]).includes(c.run!.state)) return undefined;
    const over = c.f.overConcurrency();
    return over === null ? undefined : { reject: { code: 'cap-concurrency', limit: over.limit, running: over.running } };
  }],
  // Spec §2.3: a STORED sessionId is re-checked where the row enters an id-taking flow; `verifyDone` composes
  // `pr-state --session <id>`. Forward motion only: retreating to `working` composes no argv. Last, so every
  // refusal about the row answers before the re-measurement the route makes next.
  ['storedId', (c) => ((c.f.to === 'awaiting-review' || c.f.to === 'merging') && !isRegistryId(c.run!.sessionId))
    ? { reject: { code: 'bad-session' } } : undefined],
] as const satisfies readonly (readonly [string, (c: Ctx) => GateResult])[];

export type AdvanceGate = (typeof GATES)[number][0];
/** The gates in the order they run. Read by the order table's coverage check. */
export const ADVANCE_GATES: readonly (readonly [AdvanceGate, (c: Ctx) => GateResult])[] = GATES;

/** The first refusal in gate order, or the run the gates admitted. The `dispatched` gate is why `sessionId` is a
 *  string on the admitted run, and for a forward edge the `storedId` gate is why it is a registry id. */
export function advanceGate<R extends AdvanceRunFacts>(f: AdvanceGateFacts<R>):
  { ok: true; run: R & { sessionId: string } } | { ok: false; refusal: AdvanceRefusal } {
  const c: Ctx = { f };
  for (const [, gate] of ADVANCE_GATES) {
    const refusal = gate(c);
    if (refusal !== undefined) return { ok: false, refusal };
  }
  return { ok: true, run: c.run as R & { sessionId: string } };
}
