import { useState } from 'react';
import type { FleetHealth } from '../../../shared/api';
import { api } from '../lib/api';
import { sameJson } from '../lib/sameJson';
import { usePoll } from '../lib/usePoll';

/** One poll of /api/fleet/health every `pollMs`, newest issued request
 *  authoritative (an older in-flight answer never overwrites a newer one).
 *  Lifted out of FleetHostBanner so FleetScreen can poll ONCE and hand the
 *  answer to both the banner and BuildLine (spec §6: one request, not two).
 *  An answer equal to the last keeps the previous object (C8, D-6440), so its
 *  readers re-render only when the fleet's health moves. The poll is usePoll's
 *  (W7 C7m, D-7191); it never re-polled on a return to the page, so
 *  `refetchOnVisible: false` keeps that schedule. */
export function useFleetHealth(pollMs = 15_000): FleetHealth | null {
  const [health, setHealth] = useState<FleetHealth | null>(null);
  usePoll({
    pollMs,   // `<= 0`: an injected consumer never polls (FleetHostBanner with `health`)
    request: () => api.fleetHealth(),
    onOutcome: (outcome) => {
      if (!outcome.ok) return;
      const h = outcome.raw as FleetHealth;
      setHealth((prev) => (sameJson(prev, h) ? prev : h));
    },
    refetchOnVisible: false,
  });
  return health;
}
