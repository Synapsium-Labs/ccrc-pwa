// One fault, one banner (spec §4): when EVERY running row reports a substrate
// fault inside one snapshot, that is one event, not seventeen — this banner
// states it once and names the remedy; the per-row `sess-substrate` chips keep
// the partial case (and the reasons the majority text below does not carry).
//
// DERIVED from the rows the fleet frame already ships, never its own wire
// fact — hence the CoordBanner store-injection shape, NOT FleetHostBanner's
// health poll: §2's one-writer-per-marker design is exactly what makes a
// reader's "all of them" derivation sound, and a second wire fact would be a
// second writer for the same statement.
//
// No button. Recovery is a human at a terminal (spec §1's no-escalation rule:
// the supervisors keep refusing to guess, and nothing here may restart tmux on
// their behalf), so unlike FleetHostBanner this banner only points at the
// remedy. That is also why it wears the attention amber and not the dead red:
// the sessions are still RUNNING, unattached — the one thing this fault does
// not mean is that work was lost.
import type { ReactNode } from 'react';
import { substrateFault } from '../../../shared/api';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import './fleet.css';

export function SubstrateBanner({
  store = useFleetStore,
}: {
  store?: FleetStore; // injectable for tests — the CoordBanner idiom
}): ReactNode {
  const sessions = store((s) => s.sessions);

  // `?? null`: the live frame is cast, not revived (`asFleetMsg`), so an older
  // server's row can lack the key at runtime — the same tolerance
  // `substrateFault` itself applies to its own field.
  const running = sessions.filter((s) => (s.lifecycle ?? null) === 'running');
  if (running.length === 0) return null;

  // EVERY running row, not some: the partial case is real (one wrapper's
  // supervisor wedged, the rest fine) and belongs to the per-row chips — a
  // fleet-wide sentence over it would name a fault most of the fleet does not
  // have. Read through `substrateFault`, never `session.substrate` directly.
  const faults: { at: number; text: string }[] = [];
  for (const row of running) {
    const f = substrateFault(row);
    if (f === null) return null;
    faults.push(f);
  }

  // The most-common reason, shown once — seventeen supervisors probing one
  // wedged server overwhelmingly agree on the text, and the odd one out
  // (an unreadable marker's synthesized reason, say) still has its own chip.
  // Insertion-ordered Map + strict `>`: a tie goes to the first-seen text,
  // deterministically.
  const counts = new Map<string, number>();
  for (const f of faults) counts.set(f.text, (counts.get(f.text) ?? 0) + 1);
  let commonest = '';
  let best = 0;
  for (const [text, n] of counts) {
    if (n > best) { best = n; commonest = text; }
  }

  const n = running.length;
  return (
    <div className="substrate-banner" role="status">
      <span className="substrate-banner-msg">
        tmux unreachable on the fleet host — {n} {n === 1 ? 'session reports' : 'sessions report'} it
        {' '}(<code className="substrate-banner-reason">{commonest}</code>);
        sessions are still running unattached. Remedy: restart tmux or reboot.
      </span>
    </div>
  );
}
