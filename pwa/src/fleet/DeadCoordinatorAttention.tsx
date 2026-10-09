// The dead-coordinator lane's attention list (workspace lifecycle spec 2026-09-24 §5.4, wave 4), rendered INSIDE the
// cleanup row (`ChildReclaimBanner`), under the expiry lane's list and in its shape: a REPORT, never a tap — no button,
// no link. The doors that act already exist (revive, reclaim, abandon), and the server's sentence names them. Each line
// is the kind's word, the claimant (or, for the circuit breaker, every claimant it holds) and the sentence. Nothing
// renders when the list is empty or the server predates it.
import type { ReactNode } from 'react';
import { deadCoordinatorAttentionOf, deadCoordinatorKindWord } from './deadCoordinatorWords';

export function DeadCoordinatorAttention({ coord }: { coord: unknown }): ReactNode {
  const list = deadCoordinatorAttentionOf(coord);
  if (list.length === 0) return null;
  return (
    <ul className="child-reclaim-attention" aria-label="coordinators the cleanup is reporting">
      {list.map((a) => (
        <li key={`${a.kind}:${a.claimants.join(',')}`} className="child-reclaim-item">
          <span className="child-reclaim-who">{`${deadCoordinatorKindWord(a.kind)} · ${a.claimants.join(', ')}`}</span>
          <span className="child-reclaim-sentence">{a.sentence}</span>
        </li>
      ))}
    </ul>
  );
}
