import type { AccountActor, AccountAudit } from './audit.js';
import type { AccountOpFields, AccountOpResult, AccountOps } from './ops.js';
import type { AccountSub } from '../../../shared/api.js';
import type { RosterReload } from '../config.js';

/**
 * RECONCILE (D-5518; spec §3.9, G6, G18; accounts plan Task A12): the server never guesses what a verb did. This wraps
 * the ONE `AccountOps` arm so that
 *  - every answer that carries a roster (`roster` itself and each mutating sub, spec §3.9) feeds `reloadRoster`, with
 *    no extra round trip;
 *  - after an op whose outcome is unknown or failed (`timeout`, `lost`, `too-large`, or a verb that exited non-zero)
 *    it runs the `roster` sub ONCE, reloads, and writes a `reconcile` audit row naming the lane (`ok` when the roster
 *    landed, `failed` when it did not). It never retries the op, and never retries the reconcile on its own;
 *  - a refusal before anything ran (`refused`, `unsupported`, `not-started`) changes nothing on the box, so it
 *    reconciles nothing;
 *  - `reconcileDivergence(fleetFp)` does the same when the fleet's roster fingerprint disagrees with this server's,
 *    with a laneless row (D-6057). Only while the fleet identity is known, and latched per fingerprint only once the
 *    roster landed or was refused as another fleet's; a failed one is retried at the next chance (D-6057 (6));
 *  - concurrent reconciles coalesce into one trailing `roster` sub, never a stale in-flight one (D-6057 (8)).
 * A reconcile never blocks an account switch or the auto-swap: it runs only the read-only `roster` sub.
 */
/** The ports a reconcile takes (D-6058 (7)): it reads no roster file, parses no answer and mints no actor itself, so it
 *  imports no value from an outer ring (ARCH-04 stage 2, D-6045); the composition root wires them. */
export interface ReconcileDeps {
  /** An answer's stdout to `reloadRoster`: its verdict, or null when the answer carried no roster. */
  reload: (stdout: string) => RosterReload | null;
  audit?: AccountAudit;
  fleetIdentity: () => string | null;
  /** The audit row's actor for an act the server takes on its own (no session asked for it): `ccrc server`. */
  actor: AccountActor;
}

export interface ReconcilingAccountOps extends AccountOps {
  /** Runs the `roster` sub and reloads when `fleetFp` is a disagreement this server has not reconciled yet. */
  reconcileDivergence(fleetFp: string): Promise<void>;
}

/** An outcome the box may have acted on without saying so. */
const unknownOrFailed = (r: AccountOpResult): boolean =>
  r.kind === 'timeout' || r.kind === 'lost' || r.kind === 'too-large' || (r.kind === 'exited' && r.code !== 0);

export function reconcilingAccountOps(inner: AccountOps, deps: ReconcileDeps): ReconcilingAccountOps {
  /** Feeds a successful answer's roster to `reloadRoster`: its verdict, or null when the answer carried none. */
  const take = (r: AccountOpResult): RosterReload | null => {
    return r.kind !== 'exited' || r.code !== 0 ? null : deps.reload(r.stdout);
  };
  // Concurrent reconciles coalesce into a TRAILING `roster` sub (D-6057 (8), revised after #950): a caller with no sub
  // in flight starts one; a caller that arrives while one is in flight never takes that sub's answer, which was read
  // before its own op touched the box, but waits for ONE fresh sub that starts once the in-flight one settles, shared
  // by every caller arriving meanwhile. N ops failing at once on a busy fleet box start at most two read-only runs,
  // and every reconcile reloads a roster read after its op ended; each caller still writes its own row.
  let running: Promise<RosterReload | null> | null = null;
  let trailing: Promise<RosterReload | null> | null = null;
  const start = (): Promise<RosterReload | null> => {
    const p = (async () => {
      try { return take(await inner.run('roster', null, {})); } catch { return null; }
    })();
    running = p;
    void p.then(() => { if (running === p) running = null; });
    return p;
  };
  const rosterOnce = (): Promise<RosterReload | null> => {
    if (running === null) return start();
    if (trailing !== null) return trailing;
    const t = running.then(() => { trailing = null; return start(); });
    trailing = t;
    return t;
  };
  const reconcile = async (laneId: string | null): Promise<RosterReload | null> => {
    const verdict = await rosterOnce();
    deps.audit?.write({
      act: 'reconcile', laneId, provider: null, outcome: verdict?.ok === true ? 'ok' : 'failed',
      fleetIdentity: deps.fleetIdentity(), actor: deps.actor,
    });
    return verdict;
  };
  let reconciledFp: string | null = null;
  return {
    arm: inner.arm,
    async run(sub: AccountSub, id: string | null, fields: AccountOpFields, stdin?: Buffer): Promise<AccountOpResult> {
      const r = await inner.run(sub, id, fields, stdin);
      if (take(r)?.ok === true) return r;
      if (sub !== 'roster' && unknownOrFailed(r)) await reconcile(id);
      return r;
    },
    async reconcileDivergence(fleetFp: string): Promise<void> {
      if (reconciledFp === fleetFp) return;
      // The ready frame that measured `fleetFp` also invalidated the fleet identity, and `reloadRoster` refuses
      // while it is unknown: run nothing and latch nothing, so the inventory's publish (or the next ready) retries
      // it (D-6057 (6)).
      if (deps.fleetIdentity() === null) return;
      const verdict = await reconcile(null);
      // Latched only when the roster landed, or was refused as another fleet's against a KNOWN identity, which a
      // retry cannot change. A sub that failed or timed out is tried again on the next chance.
      if (verdict !== null && (verdict.ok || verdict.why === 'fleet-identity')) reconciledFp = fleetFp;
    },
  };
}
