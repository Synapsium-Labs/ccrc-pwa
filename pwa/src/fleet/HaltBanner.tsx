// HaltBanner — the home screen's halt (centralised-update design 2026-09-20 §10, §13; programme wave 14, R15(a)).
// A failed or reverted move halts every move in the fleet until the operator acks that node. Before this wave the
// only door out, Ack, sat on the node's row in Settings, and nothing on the home screen named the halt. This banner
// names each halting node, its state, its target and its detail, and offers that node's Ack IN PLACE.
//
// ONE Ack: the gate is `canAck` and the tap is `sendAck` (updateAck.ts), the very pair the Settings row calls, so
// the two buttons cannot disagree about one row. A halting row is settled `failed`/`reverted`, so `canAck` is true
// for it (halt-banner.test.tsx pins that over every state the halt rule names). It is still the one gate, never a
// halt-only copy. After a clean 200 the row stays down until a poll shows a different lease (`leaseKey`).
// The route stays the authority: a row
// that went busy since the poll answers 409 `busy`, said as a toast, and the screen re-polls either way.
//
// Injected only: FleetScreen polls /api/updates once and hands the view down (`fleet-screen.test.tsx` pins one
// poll). It renders nothing while there is no view, or no halting node. Its own class, `.halt-banner`: attention
// amber like the skew warning, but not sticky, because the fleet-host banner owns the sticky slot. role="status"
// like every banner on this screen, so tests find it by class.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { NodeWire, ReleaseWire, UpdatesView } from '../../../shared/api';
import { canAck, sendAck } from './updateAck';
import { haltLine, haltingNodes } from './updateHalt';
import './fleet.css';

/** The banner's lead sentence. */
export const HALT_LEAD_TEXT = 'Updates are halted — nothing moves on any node until each one below is acknowledged.';

/** The lease an Ack was sent against. The row stays down while the view still shows THAT lease: between a clean 200
 *  and the poll that drops the row (longer when a poll fails, since the hook keeps the last good view), a second
 *  tap would reach ackNode again, which acks an idle row too and clears whatever request was written since. A new
 *  failure is a new lease, so it re-arms the button. */
const leaseKey = (n: NodeWire): string => JSON.stringify(n.update ?? null);

function HaltRow({ node: n, releases, onAcked }: {
  node: NodeWire; releases: readonly ReleaseWire[]; onAcked: () => void;
}): ReactNode {
  const [acking, setAcking] = useState(false);
  const [ackedLease, setAckedLease] = useState<string | null>(null);
  const acked = ackedLease !== null && ackedLease === leaseKey(n);
  const ack = (): void => {
    const sentAgainst = leaseKey(n);
    setAcking(true);
    void sendAck(n.nodeId).then((outcome) => {
      if (outcome !== 'refused') setAckedLease(sentAgainst);
    }).finally(() => {
      setAcking(false);
      onAcked();
    });
  };
  return (
    <li className="halt-banner-node" data-node-id={n.nodeId}>
      <span className="halt-banner-node-text">{haltLine(n)}</span>
      <button
        type="button"
        className="btn-primary"
        aria-label={`Ack ${n.label}`}
        disabled={!canAck(n, releases) || acking || acked}
        onClick={ack}
      >
        {acked ? 'Acked' : 'Ack'}
      </button>
    </li>
  );
}

export function HaltBanner({ updates: view, onAcked }: { updates: UpdatesView | null; onAcked: () => void }): ReactNode {
  if (view === null) return null;
  const halting = haltingNodes(view.nodes);
  if (halting.length === 0) return null;
  // useUpdatesView validates `releases` as an array (asUpdatesView), so it is passed as it stands.
  const releases = view.releases;
  return (
    <div className="halt-banner" role="status">
      <span className="halt-banner-msg">{HALT_LEAD_TEXT}</span>
      <ul className="halt-banner-list" aria-label="Halted nodes">
        {halting.map((n) => <HaltRow key={n.nodeId} node={n} releases={releases} onAcked={onAcked} />)}
      </ul>
    </div>
  );
}
