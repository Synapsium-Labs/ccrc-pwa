import type { ActorWire } from '../../../shared/overlord-identity.js';
import { isMintedActor, type AccountActor } from '../accounts/audit.js';
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
      if (!isMintedActor(actor)) throw new Error('callerIdentity.operator: not an actor the account gate minted');
      return mint({ kind: 'operator', subject: String(actor), issuer: 'account-gate', strength: 'operator' });
    },
    console(armed, device): ConsoleCaller {
      if (!armed) return { kind: 'dark' };
      if (device === null) return { kind: 'device-unmeasured' };
      return {
        kind: 'signed-in',
        actor: mint({ kind: 'operator', subject: deviceActor(device), issuer: 'session-cookie', strength: 'operator' }),
      };
    },
  };
}
