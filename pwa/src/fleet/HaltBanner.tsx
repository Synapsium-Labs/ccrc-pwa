// HaltBanner — the home screen's halt (centralised-update design 2026-09-20 §10, §13; programme wave 14, R15(a)).
// A failed or reverted move halts every move in the fleet until the operator acks that node. Before this wave the
// only door out, Ack, sat on the node's row in Settings, and nothing on the home screen named the halt. This banner
// names each halting node, its state, its target and its detail, and offers that node's Ack IN PLACE.
//
// ONE Ack: the gate is `canAck` and the tap is `sendAck` (updateAck.ts), the very pair the Settings row calls, so
// the two buttons cannot disagree about one row. A halting row is settled `failed`/`reverted`, so `canAck` is true
// for it (halt-banner.test.tsx pins that over every state the halt rule names). It is still the one gate, never a
// halt-only copy. What the row does after a tap follows how the Ack ended (D-4272, D-4273): a clean 200 holds it
// until a poll shows a different lease (`leaseKey`); an unreadable answer, or no answer at all (a rejection, a 5xx,
// a timeout), holds it until a successful read the screen ISSUED after the outcome arrived, and then re-arms if that
// read still shows the same lease. A read issued earlier (before the tap, or while the POST was in flight) is never
// that read, however late it lands or renders; the poll's issue number tells the two apart. A 4xx refusal re-arms it
// at once.
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
import { Button } from '@ccrc/ui';
import { canAck, sendAck } from './updateAck';
import type { AckOutcome } from './updateAck';
import { haltLine, haltingNodes } from './updateHalt';
import './fleet.css';

/** The banner's lead sentence. */
export const HALT_LEAD_TEXT = 'Updates are halted — nothing moves on any node until each one below is acknowledged.';

/** The lease an Ack was sent against, as one string over every field of the lease (state, target, startedAt, detail).
 *  A clean 200 holds the row down while the view still shows THAT lease: between the 200 and the poll that drops the
 *  row (longer when a poll fails, since the hook keeps the last good view), a second tap would reach ackNode again,
 *  which acks an idle row too and clears whatever request was written since. A new failure is a new lease, so it
 *  re-arms the button, and any one field changing makes a new one (auto retrying the same tag and failing alike moves
 *  only `startedAt`). An unreadable answer or no answer holds on the poll's issue number instead (D-4272, D-4273, below). */
const leaseKey = (n: NodeWire): string => JSON.stringify(n.update ?? null);

/** What a tap left behind (D-4272, D-4273). A clean 200 holds until a poll shows a different lease. An outcome the
 *  screen cannot vouch for (`unreadable`, or `unanswered`: a rejection, a 5xx, a timeout) holds until a successful
 *  read the screen ISSUED after the outcome arrived. `after` is the issue number `onAcked()` returned when called
 *  inside the outcome callback, so every read issued before the outcome has a lower number; the poll's `seq` is the
 *  number of the read that set the view, and the hold ends when `seq >= after`. A read issued before the tap, or while
 *  the POST was in flight, is never fresh, however late it lands or renders. `after` is null when no read was issued
 *  (an injected parent polls through its own parent and its reload returns 0): the hold then falls back to the lease,
 *  so no mode can re-arm on a read it cannot date. A 4xx refusal leaves no hold. */
type Hold =
  | { kind: 'acked'; lease: string }
  | { kind: 'pending'; lease: string; after: number | null; said: 'unreadable' | 'unanswered' };

function HaltRow({ node: n, releases, seq, onAcked }: {
  node: NodeWire; releases: readonly ReleaseWire[]; seq: number; onAcked: () => number;
}): ReactNode {
  const [acking, setAcking] = useState(false);
  const [hold, setHold] = useState<Hold | null>(null);
  const held = hold !== null
    && (hold.kind === 'acked' || hold.after === null ? hold.lease === leaseKey(n) : seq < hold.after);
  const shownAcked = held && (hold.kind === 'acked' || hold.said === 'unreadable');
  const label = shownAcked ? 'Acked' : 'Ack';
  const ack = (): void => {
    const sentAgainst = leaseKey(n);
    setAcking(true);
    const settle = (outcome: AckOutcome): void => {
      setAcking(false);
      const issued = onAcked();   // the re-poll, issued INSIDE the outcome callback: every read before it is older
      if (outcome === 'acked') setHold({ kind: 'acked', lease: sentAgainst });
      else if (outcome === 'refused') setHold(null);
      else {
        setHold({
          kind: 'pending', lease: sentAgainst, said: outcome,
          after: Number.isInteger(issued) && issued > 0 ? issued : null,
        });
      }
    };
    void sendAck(n.nodeId).then(settle, () => settle('unanswered'));   // sendAck never rejects; belt and braces
  };
  return (
    <li className="halt-banner-node" data-node-id={n.nodeId}>
      <span className="halt-banner-node-text">{haltLine(n)}</span>
      <Button
        variant="primary"
        size="fit"
        className="flex-none"
        aria-label={`${label} ${n.label}`}
        disabled={!canAck(n, releases) || acking || held}
        onClick={ack}
      >
        {label}
      </Button>
    </li>
  );
}

export function HaltBanner({ updates: view, seq, onAcked }: {
  updates: UpdatesView | null; seq: number; onAcked: () => number;
}): ReactNode {
  if (view === null) return null;
  const halting = haltingNodes(view.nodes);
  if (halting.length === 0) return null;
  // useUpdatesView validates `releases` as an array (asUpdatesView), so it is passed as it stands.
  const releases = view.releases;
  return (
    <div className="halt-banner" role="status">
      <span className="halt-banner-msg">{HALT_LEAD_TEXT}</span>
      <ul className="halt-banner-list" aria-label="Halted nodes">
        {halting.map((n) => <HaltRow key={n.nodeId} node={n} releases={releases} seq={seq} onAcked={onAcked} />)}
      </ul>
    </div>
  );
}
