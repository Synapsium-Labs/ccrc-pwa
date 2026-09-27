import type { ReactNode } from 'react';
import type { FleetHealth, NodeWire } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import { remoteSides, statedOf } from '../../../shared/update-summary';
import { pendingTag } from './useUpdatesView';
import './fleet.css';

/** "v0.0.7" / "unversioned (bd2bf57a)" / "—", plus " dirty"; amber unless
 *  the side is a clean, versioned release stamp. `next` is the tag the
 *  inventory says this node should move UP to (`pendingTag`), rendered as an
 *  amber " → v0.0.9" affix inside the side, or nothing. */
function side(label: string, b: BuildInfo | null, next: string | null): ReactNode {
  const affix = next === null ? null : <span className="build-line-next"> → {next}</span>;
  if (b === null) return <span className="build-line-side build-line-side--warn">{label} —{affix}</span>;
  // ONE predicate, read twice. The name used `??` (nullish: undefined AND
  // null) while the amber flag tested `=== undefined` alone, so a stamp
  // whose `version` arrived as null rendered "unversioned (…)" in calm
  // black — the line saying one thing and its colour saying the other, over
  // exactly the field this line exists to report.
  const versioned = typeof b.version === 'string';
  // Fix round 1 (F11, item 6): `asUpdatesView` now drops a `current` with no
  // string `sha` before this ever renders, but this guard stays anyway,
  // beside `dirty`'s — the same "arrives unchecked" reason BuildLine.tsx
  // already gives that one, and belt-and-suspenders costs nothing here.
  const shaOk = typeof b.sha === 'string';
  const name = versioned ? b.version : shaOk ? `unversioned (${b.sha.slice(0, 8)})` : 'unversioned';
  // A wire boolean, read once and `=== true`: `current` reaches here through
  // asUpdatesView, which passes the rows through unchecked.
  const dirty = b.dirty === true;
  const warn = !versioned || dirty;
  return (
    <span className={`build-line-side${warn ? ' build-line-side--warn' : ''}`}>
      {label} {name}{dirty ? ' dirty' : ''}{affix}
    </span>
  );
}

/** Always visible at the foot of FleetScreen (spec §6). Reads the node
 *  inventory FleetScreen's one /api/updates poll hands down (§14) — the
 *  health answer supplies the mode and nothing else. Renders nothing for
 *  local mode or for no health answer. */
export function BuildLine({ health, nodes }: { health: FleetHealth | null; nodes: readonly NodeWire[] | null }): ReactNode {
  if (!health || health.mode !== 'remote') return null;
  // No inventory answer — not yet, or not for as long as /api/updates cannot
  // be read (a 5xx, the network, a malformed body): the line still stands,
  // both sides a dash. Hiding it would take "what each box runs" away exactly
  // when the update plane is unreadable; a dash claims no version (§18).
  const { fleet, server } = Array.isArray(nodes) ? remoteSides(nodes) : { fleet: null, server: null };
  // Fix round 1 (F14, D-3316), widened fix round 2 (item 5): a side occupied
  // by a row that fails `statedOf` (unmeasured this run, its stamp unread, or
  // — D-3316 — `reachable !== true`) still occupies it (so the OTHER side
  // never falls back into it — `remoteSides`'s own point), but its cached
  // `current`/version is not a fact this line speaks for — `markUnreachable`
  // keeps the last measurement, and rendering it calmly here is the exact
  // class F1/F3 fix: a surface stating a stale reading as present-tense fact.
  // `statedOf` (`shared/update-summary.ts`), not a narrower reachable-only
  // check — this file's own inline form was exactly that narrower drift
  // before this fix. The arrow (`pendingTag`) now ALSO refuses an unreachable
  // node (fix round 2, item 4 — D-3316's own text widened again), so the two
  // guards agree without this file re-deriving either; the settings inventory
  // alone keeps "unreachable since …" with the last measured values, because
  // that is where the history belongs — this line states nothing.
  const fleetCurrent = fleet && statedOf(fleet) ? fleet.current : null;
  const serverCurrent = server && statedOf(server) ? server.current : null;
  return (
    <div className="build-line" role="status">
      {side('fleet', fleetCurrent, fleet ? pendingTag(fleet) : null)}
      <span className="build-line-sep"> · </span>
      {side('server', serverCurrent, server ? pendingTag(server) : null)}
    </div>
  );
}
