// FleetHostBanner — the two things that can be wrong with the link to a REMOTE
// fleet host, on one poll of /api/fleet/health. Renders nothing when the fleet
// is local, or when the host is reachable and the two boxes agree.
//
//  - UNREACHABLE (red): the agent WS is down (server/src/remote/). Names how
//    long, and offers a Hetzner reboot behind a QuickConfirm whose copy names
//    the collateral. The dialog says what is true of ANY fleet host — a reboot
//    takes down every service on the box, not only the fleet — because it used
//    to name the reference fleet's OWN co-tenant stack by product name, which
//    on anybody else's box was simply a false statement about their machine.
//  - ROSTER DIVERGENT (amber): the host is up, and its installed roster
//    projection is not the one this server's roster produces
//    (`rosterAgreement`, server/src/fleetstate.ts). No action button: the fix
//    is a deploy or an edit on one of the two boxes, neither of which the PWA
//    can or should do. `'unknown'` renders nothing — an older agent reports no
//    digest, and a banner that fires when nothing is wrong stops being read.
//  - BUILD SKEWED (amber): the host is up, but the two boxes' `build.json`
//    stamps disagree (`buildAgreement`, server/src/fleetstate.ts). Names both
//    versions (or shas, for an unversioned deploy.sh stamp) when the server
//    reports them. No action button: the fix is `ccrc rollout`/`ccrc update`,
//    run from a terminal. `'unknown'` remains silent, same rule as the two
//    above.
//  - POOLS UNAVAILABLE (amber): the host is up, but its ccd has no project-pool
//    capability. No action button: the remedy is an agent-lane deploy.
//    `'unknown'` remains silent.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import { api, apiErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { QuickConfirm } from '../components/QuickConfirm';
import { useNow } from '../lib/useNow';
import { elapsedWords } from '../lib/elapsed';
import { useFleetHealth } from './useFleetHealth';
import './fleet.css';

const POLL_MS = 15_000;

/** "5m ago" / "2h 10m ago" / "moments ago" — elapsed time since `downSince`.
 *  The span comes from `elapsedWords`; the preposition is this banner's own,
 *  which is the whole reason the split is where it is (lib/elapsed.ts). */
const elapsedSince = (downSince: number, nowMs: number): string =>
  `${elapsedWords(nowMs - downSince)} ago`;

export function FleetHostBanner({ health: injected }: { health?: FleetHealth | null } = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for this
  // banner and BuildLine together; the standalone shape (tests, other
  // screens) still self-polls.
  const polled = useFleetHealth(injected === undefined ? POLL_MS : 0);
  const health = injected === undefined ? polled : injected;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const now = useNow(30_000);

  // Roster divergence is orthogonal to reachability and is checked FIRST: a
  // fleet host that is up and answering is exactly the state in which the two
  // boxes' rosters disagreeing does real damage, invisibly — sessions
  // attributed to the wrong account, a swap target ccd rejects. An unreachable
  // host outranks it only because nothing can be done about the roster until
  // the box is back, so the two never render together.
  if (health && health.mode === 'remote' && health.connected && health.roster === 'divergent') {
    return (
      <div className="fleet-host-banner fleet-host-banner--warn" role="status">
        <span className="fleet-host-banner-msg">
          This server and the fleet host are projecting different account rosters. Redeploy both
          boxes; if it persists, reconcile <code>~/.ccrc/accounts.json</code> on each.
        </span>
      </div>
    );
  }

  // A build skew ranks below roster divergence (silent damage already
  // happening beats a version mismatch) and above the pools-unavailable arm
  // (a feature absent from the host is a smaller worry than two boxes
  // running different code).
  if (health && health.mode === 'remote' && health.connected && health.build === 'skewed') {
    const name = (b: BuildInfo | null | undefined): string =>
      b ? `${b.version ?? 'unversioned'} (${b.sha.slice(0, 8)})` : '—';
    const fleet = health.builds ? ` fleet ${name(health.builds.fleet)} · server ${name(health.builds.own)}.` : '';
    return (
      <div className="fleet-host-banner fleet-host-banner--warn" role="status">
        <span className="fleet-host-banner-msg">
          The two boxes run different builds.{fleet} Run <code>ccrc rollout</code> from the deploying
          machine, or <code>ccrc update</code> on the lagging box, fleet box first.
        </span>
      </div>
    );
  }

  // Roster divergence ranks above this: it is silent damage already happening,
  // while an unavailable pool capability is a feature absent from the host.
  if (health && health.mode === 'remote' && health.connected && health.projectPools === 'unavailable') {
    return (
      <div className="fleet-host-banner fleet-host-banner--warn" role="status">
        <span className="fleet-host-banner-msg">
          The fleet host's ccd does not honour project pools yet. Redeploy the agent lane.
        </span>
      </div>
    );
  }

  if (!health || health.mode !== 'remote' || health.connected) return null;

  const reboot = (): void => {
    setRebooting(true);
    void api
      .rebootFleet()
      .then(() => toast('Reboot requested — the fleet host is restarting.'))
      .catch((err: unknown) => toast(`Couldn't reboot — ${apiErrorText(err)}`, 'error'))
      .finally(() => setRebooting(false));
  };

  return (
    <div className="fleet-host-banner" role="status">
      <span className="fleet-host-banner-msg">
        Fleet host unreachable{health.downSince !== null ? ` since ${elapsedSince(health.downSince, now)}` : ''}
      </span>
      <button
        type="button"
        className="btn-primary"
        disabled={rebooting}
        onClick={() => setConfirmOpen(true)}
      >
        Reboot
      </button>
      <QuickConfirm
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Reboot the fleet host?"
        consequence="Reboots the whole fleet box — everything else running on it goes down too, not just the fleet."
        confirmLabel="Reboot the fleet host"
        onConfirm={reboot}
      />
    </div>
  );
}
