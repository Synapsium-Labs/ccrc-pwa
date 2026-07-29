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

export function useProjectedHome(): ProjectedHome | null {
  const [projected, setProjected] = useState<ProjectedHome | null>(null);

  useEffect(() => {
    let live = true;
    const load = (): void => {
      // Silent on failure: this is decoration on an affordance that must work
      // regardless. A `+` with no account line is strictly better than a fleet
      // screen that errors because telemetry is missing.
      void api.accounts().then((r) => { if (live) setProjected(r.projected ?? null); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { live = false; clearInterval(t); };
  }, []);

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
