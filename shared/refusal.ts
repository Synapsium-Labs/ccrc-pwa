/**
 * Every refusal word a route answers in `error`, and the ONE status each one
 * is answered with (D-5381, audit ticket #547, ARCH-11a). L0: type imports, and `SWAP_REFUSALS` (D-5242: its three
 * codes key their rows below by the declaration, so no code is spelled a second time).
 *
 * `RouteRefusal` is the union of the refusal vocabularies the typed route
 * helpers already answered with — the claim door's (`ClaimRefusal`), the mail
 * ingress's (`MailRouteRefusal`, below), the update routes'
 * (`UpdateRouteError`) and the collect-lane door's (`CollectLaneRouteRefusal`,
 * below) — the swap route's (`SwapRefusal`, `SWAP_REFUSALS`: all three are 409s, D-5242 added `hibernated` and moved
 * the route's swap refusals onto `refuseRoute`) — plus `GenericRefusal`, every other word a route sends as a literal
 * `error`. `REFUSAL_STATUS` is a `Record` over that union, so a word with
 * no status, or a status for no word, is a compile error, and a word cannot
 * carry two statuses. The runtime list is derived from it (`ROUTE_REFUSALS`),
 * never hand-kept.
 *
 * The four typed helpers consult this table instead of taking a status:
 * `token/routes.ts`'s and `update/routes.ts`'s `refuse`, `coord/routes.ts`'s
 * mail `refuse` (which still calls `recordRejection` first: a mail refusal is a
 * recorded fact) and its `collectRefuse`, plus `refuseRoute`
 * (`server/src/refuse.ts`) for every other route.
 * `server/test/refusal-status.test.ts` scans every refusal send (`.code(S)` or
 * `.status(S)`, any `.header(…)` chain, an `ok: false` body in any key order)
 * and holds that each literal-status send with a literal `error` word answers
 * that word's status here, the measured splits below excepted and counted;
 * that each `GenericRefusal` is still sent somewhere; and that the counts of
 * literal-status and computed-status inline sends only fall. A send whose
 * status or word is computed is counted, not checked against the table.
 *
 * THREE MEASURED SPLITS, kept as they were:
 *   - `registry-unmeasurable` answers 502 in `coord/routes.ts` and 503 in
 *     `server.ts`. The table says 502; `server.ts`'s eight 503 sends (four
 *     literal, four through a `read.reason === 'unlistable' ? 503 : 404`
 *     ternary) stay inline until #549 (ARCH-11b) unifies them.
 *   - `unauthenticated` answers 429 with verdict `locked-out` and a
 *     `retry-after` header from the three sign-in lockout sends in
 *     `server.ts`. The table's 401 is every other `unauthenticated`.
 *   - `bad-request` answers 413 from the claim route's error handler when
 *     Fastify refused an oversized body (spec 4.6 reshapes Fastify's own 413
 *     into the small claim body). That one send is `token/routes.ts`'s
 *     `refuseOversizedClaim`, not the table.
 */
import type { ClaimRefusal } from './box-token.js';
import type { CollectLaneRefusal, DoneRejectCode, MailRejectCode, RunRefuseCode, SwapRefusal, UpdateRouteError } from './api.js';
import { SWAP_REFUSALS } from './api.js';

/** The mail codes a route answers in `error`. The done-authority codes travel
 *  as a run advance's `reject.code` and `undeliverable` is a delivery outcome;
 *  neither is an HTTP `error` word. */
export type MailRouteRefusal = Exclude<MailRejectCode, DoneRejectCode | 'undeliverable'>;

/** The collect-lane words `collectRefuse` answers. `confirm-required` and
 *  `confirm-stale` travel in a body that carries the effect and its key, never
 *  through the helper, so they are not route refusal words here. */
export type CollectLaneRouteRefusal = Exclude<CollectLaneRefusal, 'confirm-required' | 'confirm-stale'>;

/** Every word a route sends as a literal that none of the four vocabularies
 *  above holds. Eighteen of them were declared nowhere in `shared/` before
 *  D-5381; the others also belong to a narrower vocabulary of their own (the
 *  asks', the claims', the pools'), which this list does not replace. */
export const GENERIC_REFUSALS = [
  'application-failed', 'ask-mismatch', 'ask-unreadable', 'bad-account-id', 'bad-attachment', 'bad-path',
  'bad-pool-name', 'bad-session', 'bad-session-id', 'bad-transition', 'ceiling', 'child-unmeasurable',
  'claim-conflict', 'claim-terminal', 'claimant-changed', 'clip-unmeasurable', 'fleetFailed',
  'foreign-origin', 'gone', 'hetzner-error', 'incarnation-changed', 'internal', 'no-record',
  'no-session', 'no-such-passkey', 'not-found', 'not-held', 'not-owner', 'not-parent', 'not-ready',
  'not-remote', 'not-seeded', 'pool-mismatch', 'pool-unreadable', 'registry-unreadable', 'run-closed',
  'run-unreadable', 'runs-unreadable', 'sweep-stopped', 'too-large', 'unknown-ask', 'unknown-claim',
  'unknown-session', 'unmeasured', 'unrouteable-record', 'unsupported', 'unsupported-type',
] as const;
export type GenericRefusal = (typeof GENERIC_REFUSALS)[number];

export type RouteRefusal = ClaimRefusal | MailRouteRefusal | UpdateRouteError | CollectLaneRouteRefusal | SwapRefusal | GenericRefusal;

/** Each route refusal word's one status (D-5381). Measured from the sends on
 *  landing day, never chosen: changing one is a behaviour change. */
export const REFUSAL_STATUS: Readonly<Record<RouteRefusal, number>> = {
  // 400
  'bad-request': 400, 'bad-tag': 400, 'bad-kind': 400, 'bad-account-id': 400, 'bad-attachment': 400,
  'bad-path': 400, 'bad-pool-name': 400, 'bad-session-id': 400,
  // 401, 403
  'unauthenticated': 401,
  'wrong-node': 403, 'unknown-sender': 403, 'stale-uuid': 403, 'foreign-origin': 403, 'not-owner': 403,
  'not-parent': 403, 'sign-in-unarmed': 403,
  // 404, 410
  'no-claim': 404, 'unknown-recipient': 404, 'unknown-run': 404, 'unknown-scope': 404, 'unknown-node': 404,
  'gone': 404, 'no-such-passkey': 404, 'not-found': 404, 'unknown-ask': 404, 'unknown-claim': 404,
  'unknown-session': 404,
  'code-expired': 410, 'code-used': 410,
  // 409
  'duplicate': 409, 'superseded': 409, 'busy': 409, 'auto-needs-rollback-gate': 409, 'no-channel': 409,
  'unknown-tag': 409, 'not-newer': 409, 'refused-by-node': 409, 'stamp-unread': 409, 'floor-unread': 409,
  'no-detach-cap': 409, 'no-rollback-cap': 409, 'agent-predates-update-op': 409, 'halted': 409,
  'no-bundle': 409, 'no-previous': 409, 'no-desired': 409,
  'ask-mismatch': 409, 'bad-session': 409, 'bad-transition': 409, 'ceiling': 409, 'child-unmeasurable': 409,
  'claim-conflict': 409, 'claim-terminal': 409, 'claimant-changed': 409, 'no-record': 409, 'no-session': 409,
  'not-held': 409, 'not-remote': 409, 'not-seeded': 409, 'pool-mismatch': 409, 'run-closed': 409,
  'sweep-stopped': 409, 'unrouteable-record': 409, 'marker-still-controls': 409, 'conflict': 409,
  'incarnation-changed': 409,
  [SWAP_REFUSALS.sessionBusy]: 409, [SWAP_REFUSALS.statusUnknown]: 409, [SWAP_REFUSALS.hibernated]: 409,
  // 413, 415, 429
  'oversize': 413, 'too-large': 413,
  'unsupported-type': 415,
  'rate-limited': 429, 'peer-quota': 429,
  // 500, 501, 502, 503
  'internal': 500,
  'not-configured': 501, 'unsupported': 501,
  'registry-unmeasurable': 502, 'clip-unmeasurable': 502, 'fleetFailed': 502, 'hetzner-error': 502,
  'unmeasured': 502,
  'unavailable': 503, 'journal-unreadable': 503, 'journal-unwritable': 503, 'ask-unreadable': 503,
  'pool-unreadable': 503, 'registry-unreadable': 503, 'run-unreadable': 503, 'runs-unreadable': 503,
  'state-unmeasurable': 503, 'write-failed': 503, 'application-failed': 503, 'not-ready': 503,
};

/** The runtime list, derived from the table (`PR_REASONS`'s idiom). */
export const ROUTE_REFUSALS = Object.keys(REFUSAL_STATUS) as RouteRefusal[];

/** The run refusals `POST /api/runs` answers in `refused` — a `RunRefuseCode`
 *  body key with its own field (`by`, `pr` or `detail`), never an `error` word,
 *  so they are not `RouteRefusal`s (D-5384, audit ticket ARCH-21). */
export type OpenRunConflict = Extract<RunRefuseCode,
  'project-mismatch' | 'home-mismatch' | 'claimant-is-a-worker' | 'workspace-spent' | 'spent-unmeasured'
  | 'claimed-by-another' | 'review-in-flight' | 'attribution-required' | 'not-a-child'>;

/** Each one's status (D-5384). Measured from the open route's inline sends on
 *  landing day — every one answered 409 — never chosen. */
export const RUN_REFUSAL_STATUS: Readonly<Record<OpenRunConflict, number>> = {
  'project-mismatch': 409, 'home-mismatch': 409, 'claimant-is-a-worker': 409,
  'workspace-spent': 409, 'spent-unmeasured': 409, 'claimed-by-another': 409, 'review-in-flight': 409,
  // D-5298 (coordinator-first Task 11b, spec §6.4): chosen, not measured — new
  // words, both 409 as the spec names them, the family's conflict status.
  'attribution-required': 409, 'not-a-child': 409,
};
