// The `SessionLiveness` adapter (native Docs HTML artifacts X5, plan Task A2.2; spec section 3.3). Ring L3: the adapter that reads
// the secret afresh and asks the session store, keeping every distinction the store gives (`live` against `ended`) and never
// narrowing a failure into `live`: whatever cannot be measured is `ended`, the shut direction.
//
// It imports no module of the auth tier at runtime (the one auth import is the session store's type): the store and the secret
// reader are handed in (`buildServer` passes the session store and the same `secretNow` the account gate uses), and
// `SecretReading` below is the structural subset of the gate's `SecretState` it reads, which `SecretState` is assignable to,
// so this file takes no edge into the gate.
import type { SessionLiveness } from './ports.js';
import type { SessionStore } from '../auth/sessions.js';

/** What the adapter needs of a measured secret: the gate's `SecretState`, less the fields it never reads. */
export type SecretReading =
  | { kind: 'unread' }
  | { kind: 'absent' }
  | { kind: 'unusable' }
  | { kind: 'ok'; secret: { generation: number } };

/** The one place a session id is judged live for a capability: the CURRENT generation, read on every call. */
export function sessionLiveness(
  sessions: Pick<SessionStore, 'livenessOf'>,
  secretNow: () => SecretReading,
): SessionLiveness {
  return {
    of(sessionIdHash: string, now: number): 'live' | 'ended' {
      try {
        const reading = secretNow();
        if (reading.kind !== 'ok') return 'ended';
        return sessions.livenessOf(sessionIdHash, reading.secret.generation, now);
      } catch {
        return 'ended';
      }
    },
  };
}
