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
 *  keeps all of it (one instance of each at any width, as with the accounts strip). Four flags, because the four
 *  things are held by different parts (W2 desk polish T2e, D-6335; before it, one `barHoldsChrome` drove both of the first
 *  two; T2g, D-6715, adds the third; T2f, D-6371, the fourth):
 *  - `headChrome`: the head's wordmark and its Docs, Accounts, Settings, Inbox and Bell doors. Instrument's top bar
 *    holds the wordmark and its rail holds the doors, so its column draws none of them. The pool-lag readout stays,
 *    because it is drawn outside that gate.
 *  - `headCount`: the head's count line. Instrument's status bar prints the fleet's count at every desk width, so its
 *    column draws none; Refined's frame has no such bar, so its column keeps the line.
 *  - `runsLine`: the runs line (the "Runs · n" door and the class chooser). Instrument's rail holds the Runs door and
 *    its status bar the runs count, so its column draws no runs line at a desk; Refined's frame has neither, so its
 *    column keeps the line, and below 900 every column keeps it.
 *  - `banners`: the banner stack. Refined's frame places the stack under its bar; Instrument's `Banners` part is `null`,
 *    so its column is where the stack is drawn, and a flag tied to the head's would drop it there altogether.
 *  Each reads "the column draws it at a desk", and defaults to true. */
export function FleetColumn(
  { headChrome = true, headCount = true, runsLine = true, banners = true }: {
    headChrome?: boolean;
    headCount?: boolean;
    runsLine?: boolean;
    banners?: boolean;
  } = {},
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
      headCount={headCount || !desktop}
      runsLine={runsLine || !desktop}
      epoch={pools?.epoch}
      observedEpoch={pools?.observedEpoch}
    />
  );
}
