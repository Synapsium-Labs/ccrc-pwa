// The account-pool projection's lag readout (W2 Task S5, D-5471): one function, so the shared fleet head and Refined's
// phone header say the same thing (W2 plan, "one derived value, one function"). `FleetScreen`'s prop docs argue the
// three-valued contract of both numbers.
import type { ReactNode } from 'react';

/** The lag, or null when there is nothing to compare (either number unknown) or nothing to say (they agree). An equal
 *  pair means "not stale", never "placing", so it renders nothing rather than an all-clear. */
export function poolLagText(epoch: number | undefined, observedEpoch: number | null | undefined): string | null {
  return epoch !== undefined && observedEpoch !== undefined && observedEpoch !== epoch
    ? `epoch ${epoch} / observed ${observedEpoch === null ? 'never synced' : observedEpoch}`
    : null;
}

/** The readout, sized and coloured like `.fleet-count` beside it (`fleet.css`): one element for every head that shows
 *  the lag, so the two cannot drift. */
export function PoolLag({ text }: { text: string }): ReactNode {
  return <span className="pool-epoch-lag" data-testid="pool-epoch-lag" title="account-pool projection lag">{text}</span>;
}
