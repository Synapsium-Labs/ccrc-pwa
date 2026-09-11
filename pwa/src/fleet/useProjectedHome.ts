// Where a new workspace would land, for the `+` to say before the tap.
//
// The PROJECTION is the server's: `limits.ts projectHome`, itself a mirror of
// ccd's `_ws_least_loaded`, which is the rule that actually assigns `home` at
// ws-add time. This hook only carries the answer. Recomputing it here would
// make a THIRD implementation of one rule, and the spec is explicit about what
// happens then: "Two implementations of one rule drift; that is what they do."
//
// It polls /api/accounts on the same 20s cadence as AccountsStrip rather than
// sharing that component's state, because the strip is mounted separately (and
// not at all on desktop, where it is a top bar). One extra GET against a local
// endpoint reading two small JSON files is the cheaper of the two couplings.
import { useEffect, useState } from 'react';
import type { AccountUsage, ProjectedHome } from '../../../shared/api';
import { api } from '../lib/api';

/**
 * `active` defaults to `true` so every caller that predates it — `FleetScreen`
 * calls `useProjectedHome()` with no argument (`FleetScreen.tsx:145`) and
 * passes the answer down to `ProjectCard` as a prop; `ProjectCard` itself
 * never calls this hook — keeps polling exactly as before, byte-identical.
 * It exists for `StartProgramSheet` (Task 13, review
 * fix round 1, Minor 2), which — like `useAccountUsage`'s own two callers
 * just below — is mounted UNCONDITIONALLY at screen level and uses `open`
 * only to toggle the inner `Sheet`'s visibility. Without `active` this would
 * poll `/api/accounts` forever the moment `/runs` is visited, whether or not
 * the door is ever tapped — `useAccountUsage`'s own docstring states the
 * identical reasoning for the identical shape, and not taking it here was
 * exactly what forced `abandon-sheet.test.tsx`'s fetch-count assertions to
 * widen past what they were actually pinning.
 */
export function useProjectedHome(active: boolean = true): ProjectedHome | null | undefined {
  // `undefined`: no answer yet — the first poll hasn't landed, or every poll
  // so far has failed. `null`: an answer HAS landed, and it is the server's
  // own "nothing is placeable" (every home-able lane disabled). These are
  // different facts with different honest copy downstream (`FleetScreen`
  // passes this value to `ProjectCard`, which renders the copy) —
  // starting at `null` and letting a fetch error stay `null` would make
  // "I don't know" indistinguishable from "the fleet told me no", which is
  // the account-status equivalent of inventing a target.
  const [projected, setProjected] = useState<ProjectedHome | null | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      // Not polling is not the server's `null` ("nothing is placeable") —
      // it is "no answer has been asked for", the same fact the hook's own
      // initial state already carries. `useAccountUsage`'s inactive
      // default is its OWN "no row for any account" value (`null`, which its
      // readers already treat as absence-permits); this hook's is `undefined`,
      // because `null` here is a positive claim this hook has no standing to
      // make while it isn't even asking.
      setProjected(undefined);
      return undefined;
    }
    let live = true;
    const load = (): void => {
      // Silent on failure, and no state change on failure: this is decoration
      // on an affordance that must work regardless. A `+` that says nothing is
      // strictly better than a fleet screen that errors because telemetry is
      // missing — but "says nothing" means leaving `projected` exactly where
      // it was (`undefined` if nothing has ever landed, or the last good
      // answer if one has), never forcing it toward either defined value.
      void api.accounts().then((r) => { if (live) setProjected(r.projected); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [active]);

  return projected;
}

/** Every account row `GET /api/accounts` carries, kept WHOLE.
 *
 *  This was `useDisabledWrappers`, and the rename is the whole point: it made
 *  exactly this request, on exactly this cadence, and then threw all of it away
 *  except `a.disabled === true`. The pickers it fed read their NUMBERS off a
 *  second source — the live fleet frame's `FleetSession.limits` — which carries
 *  `{five, seven}` and NO provenance, so a rolled-over window (a rate-limit
 *  window whose reset merely elapsed) arrived there as a confident `0` and won
 *  every "suggested" ranking forever. The row this hook was already holding
 *  says `fiveRolledOver`/`sevenRolledOver` about that very number.
 *
 *  ONE SOURCE PER FACT, and this is it for account NUMBERS AND ELIGIBILITY.
 *  The measurement that decides it: both sources are the same server-side map.
 *  `server/src/fleet.ts` sets a session's `limits` from `readLimits(...)[wrapper]`
 *  and `GET /api/accounts` builds these rows from the same call — so the frame
 *  is a strictly LOSSY projection of this payload, dropping both rollover flags,
 *  `disabled`, `authDead` and every account with no live session on it. There is
 *  nothing the frame can tell a picker that this cannot, except sooner: the
 *  frame is live-pushed and this polls every 20s. That is the real and only
 *  cost, and it is small against what it buys — telemetry is a byproduct of a
 *  session rendering its statusline, so the underlying numbers move on the order
 *  of minutes and an idle account stops reporting for hours. Twenty seconds of
 *  staleness is inside that noise; a number whose provenance is unrecoverable
 *  is not.
 *
 *  `active` is the caller's own `open` prop. Both callers (SwapSheet,
 *  NewSessionSheet) mount their picker UNCONDITIONALLY and use `open` only to
 *  toggle the inner vaul `Sheet`'s visibility — the component, and its hooks,
 *  keep running underneath — so without this gate a session screen would poll
 *  `/api/accounts` forever whether or not its picker is ever opened. Its own
 *  poller rather than a prop threaded down from FleetScreen: the same trade
 *  `useProjectedHome` documents above — one extra GET against a local endpoint
 *  reading two small JSON files beats coupling two component trees.
 *
 *  `null` IS NOT AN EMPTY FLEET. It means no row for any account is available:
 *  nothing has landed yet, the poll is not running (`active` false), every
 *  attempt so far failed, or an answer landed whose `accounts` was not an array.
 *  Those four are one fact to every reader below — nothing is scoreable and
 *  nothing is excluded — which is why they may share one value; the moment a
 *  caller wants to handle them differently this must grow the distinction back,
 *  not overload this null further.
 *
 *  A FAILED POLL LEAVES THE LAST GOOD ANSWER STANDING (the `catch` writes
 *  nothing), for `useDisabledWrappers`'s original reason, with its false half
 *  removed: dropping an account because telemetry hiccuped makes a healthy lane
 *  look like it does not exist, and that is the worse half of the trade. The
 *  reason it was paired with — "showing an account that turns out to be
 *  unusable is recoverable, ccd refuses the swap" — was simply not true (D-1979).
 *  `cmd_swap` reads NEITHER marker (its own header: "Manual swaps may target
 *  ANY valid wrapper; the pool policy only constrains auto-swaps") and
 *  `POST /api/sessions/:id/swap` adds no check, so a swap onto a lane this hook
 *  was too stale to report as switched off simply happens. It is recoverable in
 *  the only sense that survives measurement — another swap undoes it, and the
 *  session's failure to come back is what tells the operator — not because
 *  anything downstream refuses. `disabledWrappers` (SwapSheet.tsx) carries the
 *  full argument and the ruling that governs the other marker. */
export function useAccountUsage(active: boolean): readonly AccountUsage[] | null {
  const [rows, setRows] = useState<readonly AccountUsage[] | null>(null);

  useEffect(() => {
    if (!active) {
      setRows(null);
      return undefined;
    }
    let live = true;
    const load = (): void => {
      void api.accounts()
        .then((r) => {
          if (!live) return;
          // `Array.isArray`, not a bare trust: a fetch stub answering an
          // unmatched route with a bare `{}` hands back `r.accounts ===
          // undefined`, and `AccountsScreen`'s own poll guards its roster the
          // same way. A payload that carried no accounts array has measured no
          // account, which is this hook's `null` — not "there are no accounts",
          // which `[]` would assert.
          setRows(Array.isArray(r.accounts) ? r.accounts : null);
        })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [active]);

  return rows;
}
