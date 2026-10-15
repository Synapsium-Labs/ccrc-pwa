// The dead-coordinator lane's attention list (workspace lifecycle spec 2026-09-24 §5.4, wave 4), rendered INSIDE the
// cleanup row (`ChildReclaimBanner`), under the expiry lane's list and in its shape — `AttentionList` IS that shape.
// Each line is the kind's word, the claimant (or, for the circuit breaker, every claimant it holds) and the sentence.
// Nothing renders when the list is empty or the server predates it.
import type { ReactNode } from 'react';
import { AttentionList } from './AttentionList';
import { deadCoordinatorAttentionOf, deadCoordinatorKindWord } from './deadCoordinatorWords';

export function DeadCoordinatorAttention({ coord }: { coord: unknown }): ReactNode {
  return (
    <AttentionList
      label="coordinators the cleanup is reporting"
      lines={deadCoordinatorAttentionOf(coord).map((a) => ({
        key: `${a.kind}:${a.claimants.join(',')}`,
        who: [`${deadCoordinatorKindWord(a.kind)} · ${a.claimants.join(', ')}`],
        sentence: a.sentence,
      }))}
    />
  );
}
