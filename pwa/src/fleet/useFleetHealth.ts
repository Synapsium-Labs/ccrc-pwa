import { useEffect, useState } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { api } from '../lib/api';

/** One poll of /api/fleet/health every `pollMs`, newest issued request
 *  authoritative (an older in-flight answer never overwrites a newer one).
 *  Lifted out of FleetHostBanner so FleetScreen can poll ONCE and hand the
 *  answer to both the banner and BuildLine (spec §6: one request, not two). */
export function useFleetHealth(pollMs = 15_000): FleetHealth | null {
  const [health, setHealth] = useState<FleetHealth | null>(null);
  useEffect(() => {
    if (pollMs <= 0) return undefined;   // an injected consumer never polls (FleetHostBanner with `health`)
    let live = true;
    let issued = 0;
    const load = (): void => {
      const mine = ++issued;
      void api.fleetHealth().then((h) => { if (live && mine === issued) setHealth(h); }).catch(() => {});
    };
    load();
    const t = setInterval(load, pollMs);
    return () => { live = false; clearInterval(t); };
  }, [pollMs]);
  return health;
}
