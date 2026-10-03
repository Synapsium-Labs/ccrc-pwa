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
//    stamps disagree (`buildAgreement`, server/src/fleetstate.ts — the TRIGGER
//    stays that server-side word, D-3312). Names
//    both versions (or shas, for an unversioned deploy.sh stamp) from the node
//    inventory (`nodes`, FleetScreen's one /api/updates poll — centralised-
//    update §14; the same `remoteSides` BuildLine reads), and says nothing of
//    versions until that answer is in. No action button: the fix is `ccrc
//    rollout`/`ccrc update`, run from a terminal. `'unknown'` remains silent,
//    same rule as the two above.
//  - POOLS UNAVAILABLE (amber): the host is up, but its ccd has no project-pool
//    capability. No action button: the remedy is an agent-lane deploy.
//    `'unknown'` remains silent.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetHealth, NodeWire } from '../../../shared/api';
import { api, apiErrorText } from '../lib/api';
import { Banner, Button, elapsedWords, QuickConfirm, toast, useNow } from '@ccrc/ui';
import { useFleetHealth } from './useFleetHealth';
import { remoteSides, statedOf } from '../../../shared/update-summary';
import './fleet.css';

const POLL_MS = 15_000;

/** "5m ago" / "2h 10m ago" / "moments ago" — elapsed time since `downSince`.
 *  The span comes from `elapsedWords`; the preposition is this banner's own,
 *  which is the whole reason the split is where it is (@ccrc/ui lib/elapsed.ts). */
const elapsedSince = (downSince: number, nowMs: number): string =>
  `${elapsedWords(nowMs - downSince)} ago`;

export function FleetHostBanner(
  { health: injected, nodes }: { health?: FleetHealth | null; nodes?: readonly NodeWire[] | null } = {},
): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for this
  // banner and BuildLine together; the standalone shape (tests, other
  // screens) still self-polls the HEALTH route. It never polls /api/updates:
  // without `nodes` the skew arm names no versions, which is also what it
  // says while FleetScreen's inventory poll has not answered.
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
      <Banner tone="attention" sticky>
          This server and the fleet host are projecting different account rosters. Redeploy both
          boxes; if it persists, reconcile <code>~/.ccrc/accounts.json</code> on each.
      </Banner>
    );
  }

  // A build skew ranks below roster divergence (silent damage already
  // happening beats a version mismatch) and above the pools-unavailable arm
  // (a feature absent from the host is a smaller worry than two boxes
  // running different code).
  if (health && health.mode === 'remote' && health.connected && health.build === 'skewed') {
    // Fix round 2 (review of d5aefc4a, item 6): a row that fails `statedOf`
    // (unmeasured, unread stamp, or D-3316 unreachable) does not lend this
    // arm its cached `current` either — the same rule BuildLine's `side()`
    // applies, so a skewed-build warning never names a version off a stale
    // reading nobody just measured.
    const name = (row: NodeWire | null): string => {
      const b = row && statedOf(row) ? row.current : null;
      return b ? `${b.version ?? 'unversioned'} (${b.sha.slice(0, 8)})` : '—';
    };
    const sides = Array.isArray(nodes) ? remoteSides(nodes) : null;
    const fleet = sides ? ` fleet ${name(sides.fleet)} · server ${name(sides.server)}.` : '';
    return (
      <Banner tone="attention" sticky>
          The two boxes run different builds.{fleet} Run <code>ccrc rollout</code> from the deploying
          machine, or <code>ccrc update</code> on the lagging box, fleet box first.
      </Banner>
    );
  }

  // Roster divergence ranks above this: it is silent damage already happening,
  // while an unavailable pool capability is a feature absent from the host.
  if (health && health.mode === 'remote' && health.connected && health.projectPools === 'unavailable') {
    return (
      <Banner tone="attention" sticky>
          The fleet host's ccd does not honour project pools yet. Redeploy the agent lane.
      </Banner>
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
    <>
      <Banner
        tone="dead"
        sticky
        action={(
          <Button
            variant="primary"
            // `flex-none` ALONE, which is exactly what `.fleet-host-banner
            // .btn-primary` set — and Button's base is `w-full`, so this
            // button claims the row and collapses the message to its
            // `min-width: 0`. PRESERVED rather than corrected: adding
            // `w-auto` would be a visual change, and this wave changes no
            // visual output. Its sibling `.update-banner-actions` sets BOTH
            // `flex: none` and `width: auto`, which is almost certainly the
            // shape this one wants. Flagged, not fixed — and no test could
            // have caught it, because vitest runs with `css: false`.
            className="flex-none"
            disabled={rebooting}
            onClick={() => setConfirmOpen(true)}
          >
            Reboot
          </Button>
        )}
      >
        Fleet host unreachable{health.downSince !== null ? ` since ${elapsedSince(health.downSince, now)}` : ''}
      </Banner>
      {/* A SIBLING of the banner, not a child. It was nested in the old div
          because that div was the whole return; the dialog portals out of its
          parent either way, but keeping it inside `Banner`'s message region
          would put a dialog inside the `flex-1 min-w-0` span that exists to
          wrap a sentence. */}
      <QuickConfirm
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Reboot the fleet host?"
        consequence="Reboots the whole fleet box — everything else running on it goes down too, not just the fleet."
        confirmLabel="Reboot the fleet host"
        onConfirm={reboot}
      />
    </>
  );
}
