// FleetHostBanner — degraded-mode surface: the ccrc-server drives a REMOTE
// fleet host over the agent WS (server/src/remote/), and that connection can
// drop. Polls /api/fleet/health; renders nothing when the fleet is local or
// the host is reachable. When unreachable it names how long, and offers a
// Hetzner reboot behind a QuickConfirm whose copy names the collateral — the
// fleet box also runs the rp-llm services.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { api, apiErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { QuickConfirm } from '../components/QuickConfirm';
import { useNow } from '../lib/useNow';
import './fleet.css';

const POLL_MS = 15_000;

/** "5m ago" / "2h 10m ago" / "moments ago" — elapsed time since `downSince`. */
function elapsedSince(downSince: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - downSince) / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h ago` : `${d}d ago`;
  if (h > 0) return m > 0 ? `${h}h ${m}m ago` : `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'moments ago';
}

export function FleetHostBanner(): ReactNode {
  const [health, setHealth] = useState<FleetHealth | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const now = useNow(30_000);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      void api.fleetHealth().then((h) => { if (live) setHealth(h); }).catch(() => {});
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

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
        consequence="Reboots the whole fleet box (also restarts the rp-llm services on it)."
        confirmLabel="Reboot the fleet host"
        onConfirm={reboot}
      />
    </div>
  );
}
