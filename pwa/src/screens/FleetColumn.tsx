// The fleet column as the shell places it (W2 Task S2b, D-5678), beside the screen it composes (a feature directory
// never imports a screen, D-5897): `FleetScreen` with the props `app.tsx` used to hand
// it, read here instead, so a skin's `Nav` part is this component and takes no props (`skins/types.ts`).
//
// ONE COMPONENT FOR BOTH SKINS' PARTS, not one per skin: the two sets place the same column in this task, and a
// skin places a shared component, it never re-implements one (W2 plan, Global constraints). Without it each skin's
// `parts.tsx` would carry its own copy of the route read, the width query and the pools wiring (T9-R2).
import type { ReactNode } from 'react';
import { matchRoute } from '../lib/routes';
import { useLocation } from '../lib/router';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { FleetScreen } from './FleetScreen';
import { useFleetStore } from '../stores/fleet';

/** The skin's frame holds part of the fleet's chrome at a desk, and the column leaves out what it holds; below 900 it
 *  keeps all of it (one instance of each at any width, as with the accounts strip). Two flags, because the two things
 *  are held by different parts (W2 desk polish T2e, D-6335; before it, one `barHoldsChrome` drove both):
 *  - `headChrome`: the head's wordmark and its Docs, Account, Settings, Mail and Bell doors. Instrument's top bar holds
 *    the wordmark and its rail holds the doors, so its column draws none of them; the head keeps its count line and the
 *    pool-lag readout, which it draws outside that gate.
 *  - `banners`: the banner stack. Refined's frame places the stack under its bar; Instrument's `Banners` part is `null`,
 *    so its column is where the stack is drawn, and a flag tied to the head's would drop it there altogether.
 *  Each reads "the column draws it at a desk", and defaults to true. */
export function FleetColumn(
  { headChrome = true, banners = true }: { headChrome?: boolean; banners?: boolean } = {},
): ReactNode {
  const { path } = useLocation();
  const at = matchRoute(path);
  const selectedId = at?.route.id === 'session' ? at.param : null;
  // On desktop the accounts strip is the frame's bar; on mobile it stays inside the fleet screen. One instance either
  // way: no duplication, no double polling.
  const desktop = useMediaQuery(DESK_QUERY);
  // T9-R2: the `pools` frame is the epoch's one carrier. `?.` keeps the three-valued rule at this hop: no frame yet
  // and a frame missing the key both read as `undefined`; `observedEpoch === null` (never synced) passes through.
  const pools = useFleetStore((s) => s.pools);
  return (
    <FleetScreen
      selectedId={selectedId}
      showAccounts={!desktop}
      banners={banners || !desktop}
      headChrome={headChrome || !desktop}
      epoch={pools?.epoch}
      observedEpoch={pools?.observedEpoch}
    />
  );
}
