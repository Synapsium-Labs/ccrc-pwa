// THE APP-LEVEL RESUME BANNER (accounts plan Task A23, D-7871 (3); spec §6.2 "Closed mid-flow, or the PWA reloaded").
//
// A sign-in keeps running on the fleet host until its `expiresAt` when its sheet is closed or the PWA reloads, and an
// installed iPhone PWA that iOS evicted relaunches at the manifest's `start_url`, so a query string is lost and a check
// made only on Accounts would never run. So on ANY route, when `GET /api/accounts` (the fleet store's one read, held in
// memory only) shows an attempt THIS session started that waits for its code, the app says so: "A sign-in for lane-x
// is waiting for its code · 7 min left · Continue". Continue opens `/accounts?resume=<id>`, whose sheet adopts the
// attempt at its code field. Nothing about the attempt is read from storage or the URL; another session's attempt shows
// nothing (only the starting session may send its code, spec §3.7).
//
// WHERE IT SITS: in the fleet's banner stack (`FleetBanners`, pinned, never folded), which a desk shows on every route
// (Refined under its bar; Instrument in its list column, or above the list beside an item on the Waiting on you item route,
// `ItemListColumn`, which replaces that column) and a phone on the fleet view; and on a phone's other views at
// the top of the detail pane (`AuthResumeInDetail`), so one instance shows at a time. In flow, never over the composer
// or the tab bar: on a phone's session view the pane becomes a column so the chat keeps its composer on screen
// (`fleet.css`, `.shell-detail:has(> .auth-resume)`).
import type { ReactNode } from 'react';
import { Button, useNow } from '@ccrc/ui';
import type { LaneWire } from '../../../shared/api';
import { CONTINUE, minutesLeft, resumeBannerText } from '../fleet/accountWords';
import { navigate, useLocation } from '../lib/router';
import { accountsResumeHref, shellViewOf } from '../lib/routes';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { useFleetStore } from '../stores/fleet';
import { resumableAttempt } from './connectFlow';
import '../fleet/fleet.css';

/** The banner stack's predicate (`BannerStack`'s `shows`): the same reading the render makes. */
export function authResumeBannerShows(lanes: Readonly<Record<string, LaneWire>> | null, now: number): boolean {
  return resumableAttempt(lanes, now) !== null;
}

/** The banner: the lane, the minutes left of its deadline, and Continue. Draws nothing when no attempt applies. */
export function AuthResumeBanner({ lanes }: { lanes: Readonly<Record<string, LaneWire>> | null }): ReactNode {
  // The minutes are read from `expiresAt` at this clock; the attempt leaves the banner once its deadline passes.
  const now = useNow(15_000);
  const r = resumableAttempt(lanes, now);
  if (r === null) return null;
  return (
    <div className="auth-resume" data-lane={r.id}>
      <p className="auth-resume-text">{resumeBannerText(r.id, minutesLeft(r.held.expiresAt, now), r.held.method)}</p>
      <Button variant="primary" size="fit" className="auth-resume-continue" onClick={() => navigate(accountsResumeHref(r.id))}>
        {CONTINUE}
      </Button>
    </div>
  );
}

/** Whether the banner stack holds the banner here: on a desk (every route), and on a phone's fleet view. A phone's other
 *  views hide the fleet column, so there `AuthResumeInDetail` holds it and the stack holds none: one instance at a
 *  time, never a second one in a hidden column. */
export function useResumeInStack(): boolean {
  const desk = useMediaQuery(DESK_QUERY);
  const { path } = useLocation();
  return desk || shellViewOf(path) === 'fleet';
}

/** The banner on a phone's views other than the fleet's, at the top of the detail pane: the fleet view and every desk
 *  route show it in the banner stack instead, so exactly one instance is on screen. */
export function AuthResumeInDetail({ view }: { view: 'fleet' | 'session' }): ReactNode {
  const desk = useMediaQuery(DESK_QUERY);
  const lanes = useFleetStore((s) => s.lanes);
  if (desk || view === 'fleet') return null;
  return <AuthResumeBanner lanes={lanes} />;
}
