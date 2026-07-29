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
