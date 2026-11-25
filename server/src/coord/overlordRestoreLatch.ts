// The raise of the ladder's `restore-detected` latch when the authority guard refuses (Overlord W1, spec §7.6, Table 7.5a; authority
// journal plan Task 7, ruling F4). Ring L4, context C5. The guard DECIDES when (it calls `onRefusing` once on its first move off
// `coherent`, and once for a non-coherent boot verdict); this file only ACTS, through the ladder's one delivery-facing raise
// (`raiseLatch`), as the server's own lane (`serverActorOf('authority')`, slug `server-actor-is-attributed`).
//
// While the journal is not coherent the raise is a narrowing and lands as its row alone (`raiseSequence` NULL): expected, not a
// failure. A second raise of a standing cause is idempotent in the store (`raiseLatchInTx` answers `changed: false` and adds no
// row), so a restart over a still-standing latch raises nothing new (slug `restore-latch-raised-once`, measured, not guarded here).
//
// The guard calls its listeners from inside the writer's open transaction when the journal failed after its append
// (`writerFailed`), where a second `BEGIN` would throw. So a call made inside a transaction is deferred past it, as the guard's
// own `appended` report is; a boot call runs at once, before anything can read the ladder.
import type { OverlordAuthorityGuard } from './overlordAuthorityGuard.js';
import type { AuthorityAppender } from './overlordLadderStore.js';
import { raiseLatch } from './overlordLadderRead.js';
import { serverActorOf } from '../auth/attributionIdentity.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import type { CoordStore } from './store.js';
import type { Clock, Entropy } from '../time/ports.js';

export interface RestoreLatchDeps {
  readonly coord: Pick<CoordStore, 'raiseLatch'>;
  readonly journal: AuthorityAppender;
  readonly clock: Pick<Clock, 'wall'>;
  readonly entropy: Pick<Entropy, 'hex'>;
  /** True while a transaction is open on the coordination database: the raise then waits for it to end. */
  readonly inTransaction: () => boolean;
  readonly warn: (line: string) => void;
}

/** The latch's detail: the guard's state in plain words. */
export const restoreDetail = (s: AuthorityState): string =>
  s.kind === 'rolled-back' ? `the authority journal reads rolled-back: ${s.cause}`
    : s.kind === 'unmeasured' ? `the authority journal reads unmeasured: ${s.why}`
      : 'the authority journal reads coherent';

/** Register the raise on the guard. Call it BEFORE the boot step, so a non-coherent boot verdict raises too. */
export function raiseRestoreDetectedOn(guard: OverlordAuthorityGuard, deps: RestoreLatchDeps): void {
  const raise = (): void => {
    try {
      const r = raiseLatch({ coord: deps.coord, journal: deps.journal, clock: deps.clock, entropy: deps.entropy }, 'restore-detected', restoreDetail(guard.state()), serverActorOf('authority'));
      if (!r.ok) deps.warn(`ccrc-server: restore-detected latch not raised: ${'error' in r ? r.error : r.reason}`);
    } catch (err) { deps.warn(`ccrc-server: restore-detected latch not raised: ${err instanceof Error ? err.message : String(err)}`); }
  };
  guard.onRefusing(() => { if (deps.inTransaction()) setImmediate(raise); else raise(); });
}
