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
import type { ProjectedHome } from '../../../shared/api';
import { api } from '../lib/api';

/**
 * `active` defaults to `true` so every caller that predates it — `FleetScreen`
 * calls `useProjectedHome()` with no argument (`FleetScreen.tsx:145`) and
 * passes the answer down to `ProjectCard` as a prop; `ProjectCard` itself
 * never calls this hook — keeps polling exactly as before, byte-identical.
 * It exists for `StartProgramSheet` (Task 13, review
 * fix round 1, Minor 2), which — like `useDisabledWrappers`'s own two callers
 * just below — is mounted UNCONDITIONALLY at screen level and uses `open`
 * only to toggle the inner `Sheet`'s visibility. Without `active` this would
 * poll `/api/accounts` forever the moment `/runs` is visited, whether or not
 * the door is ever tapped — `useDisabledWrappers`'s own docstring states the
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
      // initial state already carries. `useDisabledWrappers`'s inactive
      // default is its OWN safe absence-permits value (`[]`); this hook's is
      // `undefined`, because `null` here is a positive claim this hook has
      // no standing to make while it isn't even asking.
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

/** Accounts ccd's kill-switch has switched off — swap targets that cannot take
 *  work. Both callers (SwapSheet, NewSessionSheet) mount their picker
 *  unconditionally and use `open` only to toggle the inner vaul `Sheet`'s
 *  visibility — the component itself, and its hooks, keep running underneath.
 *  Without `active` this would poll /api/accounts forever the moment a
 *  session screen is visited, whether or not its picker is ever opened. `active`
 *  is that callers' own `open` prop, so the poll (and its interval) runs only
 *  while the picker a caller is actually showing. Its own poller rather than a
 *  prop threaded down from FleetScreen: that is the same trade useProjectedHome
 *  documents above — one extra GET against a local endpoint reading two small
 *  JSON files beats coupling two component trees. */
export function useDisabledWrappers(active: boolean): string[] {
  const [disabled, setDisabled] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      setDisabled([]);
      return undefined;
    }
    let live = true;
    const load = (): void => {
      // Silent on failure, and an empty list on error: showing an account that
      // turns out to be disabled is recoverable (ccd refuses the swap), while
      // hiding one because telemetry hiccuped looks like it does not exist.
      void api.accounts()
        .then((r) => { if (live) setDisabled((r.accounts ?? []).filter((a) => a.disabled === true).map((a) => a.wrapper)); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [active]);

  return disabled;
}
