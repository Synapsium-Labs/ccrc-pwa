// Overlord W1, gates A (plan `w1-gates.md` Task 3, Review Focus 6): a designation writer takes a `RecordedActor`, the frozen,
// branded actor only the attribution adapter mints, never a string, a raw `AccountActor` or a plain `ActorWire`. Each
// `@ts-expect-error` line below goes red under `tsc -p test/tsconfig.tests.json` if a writer's actor type widens; the run-time
// half (`isRecordedActor`, the kind and the strength) is `designation-actor.test.ts`'s.
import { describe, it, expect } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { actorOf, type AccountActor } from '../src/accounts/audit.js';
import type { ActorWire } from '../../shared/overlord-identity.js';
import { designatePending, retire, type AuthorityAppender, type DesignateInput } from '../src/coord/overlordDesignationStore.js';

const base: Omit<DesignateInput, 'actor'> = {
  sessionId: 'overlord-quiet-otter', deadlineAt: 2, model: 'opus', accountPools: { pools: [], untagged: false }, at: 1, opKey: 'k',
};
const account: AccountActor = actorOf('device-a', 'abcdef0123456789');
const wire: ActorWire = { kind: 'operator', subject: 'device-a abcdef01', issuer: 'account-gate', strength: 'operator' };

/** Type-level only: never called, so no database is opened. */
export function neverCalled(db: DatabaseSync, j: AuthorityAppender): void {
  // @ts-expect-error a string is not a RecordedActor
  designatePending(db, j, { ...base, actor: 'device-a abcdef01' });
  // @ts-expect-error the account gate's actor is minted, but not through the identity port
  designatePending(db, j, { ...base, actor: account });
  // @ts-expect-error a plain ActorWire carries no brand
  designatePending(db, j, { ...base, actor: wire });
  // @ts-expect-error a string is not a RecordedActor
  retire(db, j, { actor: 'device-a abcdef01', at: 1, opKey: 'k' });
  // @ts-expect-error the account gate's actor is minted, but not through the identity port
  retire(db, j, { actor: account, at: 1, opKey: 'k' });
  // @ts-expect-error a plain ActorWire carries no brand
  retire(db, j, { actor: wire, at: 1, opKey: 'k' });
}

describe('the writers\' actor type', () => {
  it('is checked by the tests type check (this file\'s @ts-expect-error lines)', () => {
    expect(typeof neverCalled).toBe('function');
  });
});
