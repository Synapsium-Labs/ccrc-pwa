import type { ActorWire } from '../../../shared/overlord-identity.js';
import { isGateActor, type AccountActor } from '../accounts/audit.js';
import type { AttributionRead } from '../coord/openRun.js';
import type { IncarnationRead } from '../continuity/timerLane.js';
import { deviceActor } from '../ccdargv.js';
import type { CallerIdentity, ConsoleCaller, RecordedActor, SessionCaller, SessionRefusal } from './callerIdentity.js';

/**
 * THE ATTRIBUTION ADAPTER of `CallerIdentity` (Overlord W1, gates; spec §3.6 H2, §7.4 C27; plan Task 2). Ring L3,
 * context C8. It composes two readers the server already builds, `attributionVerdict` and `incarnationOf`, and is the
 * ONE place a `RecordedActor` is minted: a module-private `WeakSet` holds each (the pattern of `accounts/audit.ts`'s
 * `actorOf`), every actor is frozen, and `isRecordedActor` is the check a writer makes at run time.
 *
 * IDENTITY IS ATTRIBUTION: `attributed` strength is answered only on `attributionVerdict`'s `{ ok: true }`, and a
 * refusal passes its `error` and `detail` through unchanged. `workload` is never minted here. This file reads no
 * cookie and names no Fastify type: the console's device label arrives as an argument, measured by the account gate.
 */

export interface AttributionIdentityDeps {
  readonly attribute: (id: string, uuid: string, field: 'byUuid' | 'fromUuid') => Promise<AttributionRead>;
  readonly incarnation: (id: string) => Promise<IncarnationRead>;
}

const MINTED = new WeakSet<object>();
/** Every console answer this module made (slug console-results-are-minted): a hand-built `{ kind: 'dark' }` is not one. */
const CONSOLE_MINTED = new WeakSet<object>();

/** True only for an actor this module minted: a structurally equal literal is not one. */
export const isRecordedActor = (a: unknown): a is RecordedActor =>
  typeof a === 'object' && a !== null && MINTED.has(a);

/** An operator admitted by the account gate, with adapter provenance intact. */
export const isAccountGateOperator = (a: unknown): a is RecordedActor =>
  isRecordedActor(a) && a.kind === 'operator' && a.issuer === 'account-gate' && a.strength === 'operator';

const mint = (actor: ActorWire): RecordedActor => {
  const frozen = Object.freeze({ ...actor }) as RecordedActor;
  MINTED.add(frozen);
  return frozen;
};

/** THE SERVER'S OWN ACTOR for one of its lanes (slug `server-actor-is-attributed`): kind `server`, issuer `server`, strength
 *  `attributed` (the three strengths describe a caller, and the server holds no credential). It is a recorded actor, so a
 *  brake takes it; it is not the account gate's operator, so a widening (`ladderActor(…, 'widen')`) refuses it. */
export const serverActorOf = (lane: string): RecordedActor =>
  mint({ kind: 'server', subject: `ccrc server: ${lane}`, issuer: 'server', strength: 'attributed' });

const consoleOf = (c: ConsoleCaller): ConsoleCaller => {
  const frozen = Object.freeze({ ...c });
  CONSOLE_MINTED.add(frozen);
  return frozen;
};

/** THE ONE MAPPING of a console answer to the text a row records (ladder review F4, F5; ask 563): `flag-off` for sign-in
 *  dark, `unmeasured` for a session with no device label, the device actor's subject when signed in. Anything this module
 *  did not mint, or a kind it does not know, is `null`, and every caller refuses it: it fails closed, never to `flag-off`. */
export function consoleSubject(c: unknown): string | null {
  if (typeof c !== 'object' || c === null || !CONSOLE_MINTED.has(c)) return null;
  const k = (c as { kind?: unknown }).kind;
  if (k === 'dark') return 'flag-off';
  if (k === 'device-unmeasured') return 'unmeasured';
  if (k === 'signed-in') {
    const actor = (c as { actor?: unknown }).actor;
    return isRecordedActor(actor) ? actor.subject : null;
  }
  return null;
}

export function attributionIdentity(deps: AttributionIdentityDeps): CallerIdentity {
  return {
    async session(sessionId, uuid, uuidField): Promise<SessionCaller | SessionRefusal> {
      const read = await deps.attribute(sessionId, uuid, uuidField);
      if (!read.ok) return { ok: false, error: read.error, detail: read.detail };
      return {
        ok: true, sessionId, uuid,
        actor: mint({ kind: 'session', subject: sessionId, issuer: 'attribution', strength: 'attributed' }),
      };
    },
    incarnation: (sessionId) => deps.incarnation(sessionId),
    operator(actor: AccountActor): RecordedActor {
      if (!isGateActor(actor)) throw new Error('callerIdentity.operator: not an actor the account gate minted');
      return mint({ kind: 'operator', subject: String(actor), issuer: 'account-gate', strength: 'operator' });
    },
    server: serverActorOf,
    console(armed, device): ConsoleCaller {
      if (!armed) return consoleOf({ kind: 'dark' });
      if (device === null) return consoleOf({ kind: 'device-unmeasured' });
      return consoleOf({
        kind: 'signed-in',
        actor: mint({ kind: 'operator', subject: deviceActor(device), issuer: 'session-cookie', strength: 'operator' }),
      });
    },
  };
}
