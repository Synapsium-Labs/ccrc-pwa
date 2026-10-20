import { actorOf, type AccountAudit } from './audit.js';
import type { AccountOpFields, AccountOpResult, AccountOps } from './ops.js';
import type { AccountSub } from '../../../shared/api.js';
import { rosterAnswerOf, type RosterAnswer, type RosterReload } from '../config.js';

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
 *    once per distinct fleet fingerprint, with a laneless row (D-6057).
 * A reconcile never blocks an account switch or the auto-swap: it runs only the read-only `roster` sub.
 */
export interface ReconcileDeps {
  reload: (answer: RosterAnswer) => RosterReload;
  audit?: AccountAudit;
  fleetIdentity: () => string | null;
}

export interface ReconcilingAccountOps extends AccountOps {
  /** Runs the `roster` sub and reloads when `fleetFp` is a disagreement this server has not reconciled yet. */
  reconcileDivergence(fleetFp: string): Promise<void>;
}

/** The audit row's actor for an act the server takes on its own: no session asked for it. */
const SERVER_ACTOR = actorOf('ccrc server', '');

/** An outcome the box may have acted on without saying so. */
const unknownOrFailed = (r: AccountOpResult): boolean =>
  r.kind === 'timeout' || r.kind === 'lost' || r.kind === 'too-large' || (r.kind === 'exited' && r.code !== 0);

export function reconcilingAccountOps(inner: AccountOps, deps: ReconcileDeps): ReconcilingAccountOps {
  /** Feeds a successful answer's roster to `reloadRoster`; true when one landed. */
  const take = (r: AccountOpResult): boolean => {
    if (r.kind !== 'exited' || r.code !== 0) return false;
    const answer = rosterAnswerOf(r.stdout);
    return answer !== null && deps.reload(answer).ok;
  };
  const reconcile = async (laneId: string | null): Promise<void> => {
    let landed = false;
    try { landed = take(await inner.run('roster', null, {})); } catch { landed = false; }
    deps.audit?.write({
      act: 'reconcile', laneId, provider: null, outcome: landed ? 'ok' : 'failed',
      fleetIdentity: deps.fleetIdentity(), actor: SERVER_ACTOR,
    });
  };
  let reconciledFp: string | null = null;
  return {
    arm: inner.arm,
    async run(sub: AccountSub, id: string | null, fields: AccountOpFields, stdin?: Buffer): Promise<AccountOpResult> {
      const r = await inner.run(sub, id, fields, stdin);
      if (take(r)) return r;
      if (sub !== 'roster' && unknownOrFailed(r)) await reconcile(id);
      return r;
    },
    async reconcileDivergence(fleetFp: string): Promise<void> {
      if (reconciledFp === fleetFp) return;
      reconciledFp = fleetFp;
      await reconcile(null);
    },
  };
}
