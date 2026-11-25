import type { ActorWire } from '../../../shared/overlord-identity.js';
import type { AccountActor } from '../accounts/audit.js';
import type { AttributionRefusal } from '../coord/openRun.js';
import type { IncarnationRead } from '../continuity/timerLane.js';

/**
 * THE CALLER-IDENTITY PORT (Overlord W1, gates; spec 2026-11-09 §3.6 H2 and §7.4 C27; plan
 * `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 2). Ring L2 (the consumer's port: interfaces and
 * failure contracts, type-only imports), context C8. A door asks WHO is calling and HOW STRONGLY that is known; it
 * never builds an actor itself, and a store writer takes a `RecordedActor`, never a string.
 *
 * IDENTITY IS ATTRIBUTION, not authentication: the box token plus a session's id and current uuid is a fact any
 * process of the fleet's one UNIX user can read, and the answer's `strength` says so. An adapter keeps every
 * distinction it receives: an unreadable registry is never a stale uuid, an absent generation is never a measured one.
 *
 * The compile-time brand refuses the pinned string, AccountActor and plain ActorWire shapes only. A spread, JSON
 * round trip or cast can still type-check as RecordedActor: the adapter's private run-time WeakSet, checked by the
 * designation writers through isRecordedActor, is the provenance guard for those copies, not this TypeScript brand.
 */

declare const recordedActorBrand: unique symbol;

/** An actor the attribution adapter minted from what it verified, frozen. Only `isRecordedActor`'s module mints one. */
export type RecordedActor = ActorWire & { readonly [recordedActorBrand]: true };

/** A box-token door's caller, after attribution passed. The token itself was checked at the door's `onRequest`. */
export interface SessionCaller {
  readonly ok: true;
  readonly sessionId: string;
  readonly uuid: string;
  /** `{ kind: 'session', subject: sessionId, issuer: 'attribution', strength: 'attributed' }`. */
  readonly actor: RecordedActor;
}

/** `attributionVerdict`'s refusals, unchanged: an unreadable registry is never a stale uuid or an absent row. */
export type SessionRefusal = { readonly ok: false; readonly error: AttributionRefusal; readonly detail: string };

/** A console door's caller: signed in with a device label, signed in with none measured, or sign-in dark. */
export type ConsoleCaller =
  | { readonly kind: 'signed-in'; readonly actor: RecordedActor }   // session-cookie issuer, operator strength
  | { readonly kind: 'device-unmeasured' }                           // armed, no device label: recorded `unmeasured`
  | { readonly kind: 'dark' };                                      // sign-in is dark: recorded `flag-off`

/**
 * Who is calling, and how strongly that is known.
 * Failure contract: every member answers and never rejects or throws, except `operator`, which throws on an actor the
 * account gate did not mint (a look-alike is a programming error, never a runtime condition to answer).
 */
export interface CallerIdentity {
  /** Attribution of `{sessionId, uuid}` against the registry. `uuidField` names the caller's own body field for the detail. */
  session(sessionId: string, uuid: string, uuidField: 'byUuid' | 'fromUuid'): Promise<SessionCaller | SessionRefusal>;
  /** The session's incarnation (`$REG/<id>.generation` read twice and agreeing); `absent` stays apart from `unreadable`. */
  incarnation(sessionId: string): Promise<IncarnationRead>;
  /** An operator door the account gate passed: its minted actor at `operator` strength, issuer `account-gate`. Only an
   *  actor the account gate itself minted (`accounts/audit.ts#gateActorOf`) is taken; any other `actorOf` actor, the
   *  server's own among them, throws. */
  operator(actor: AccountActor): RecordedActor;
  /** A console door that may run dark: the device's actor, `device-unmeasured`, or `dark`, each a frozen answer only the
   *  adapter makes (slug console-results-are-minted); `consoleSubject` is the one mapping of it to a row's text. */
  console(armed: boolean, device: string | null): ConsoleCaller;
  /** The server's own lane as an actor (kind `server`, issuer `server`, strength `attributed`): never a caller. A brake
   *  takes it; a widening refuses it, since only the account gate's operator widens. */
  server(lane: string): RecordedActor;
}
