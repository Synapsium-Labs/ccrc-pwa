import type { ReactNode } from 'react';
import type { FleetHealth, NodeWire } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import { versionSides } from '../../../shared/update-summary';
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
  const name = versioned ? b.version : `unversioned (${b.sha.slice(0, 8)})`;
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

/**
 * The two sides of a REMOTE fleet, read off the node inventory
 * (centralised-update design 2026-09-20 §14) — the ONE place BuildLine and
 * FleetHostBanner's skew arm learn which row is which box, so the two cannot
 * disagree on one screen.
 *
 * `versionSides` (shared/update-summary.ts) is the side picker; this adds one
 * rule (D-3313): a fleet side that IS the
 * server row — versionSides' fallback for a lone `both` row, which is right in
 * local mode, where one box is both — is NULL here. Both readers render only
 * on a remote fleet, where a `both` row is this box and never the fleet box;
 * the server's own agreement word (`health.build`, from W2's `derivedBuilds`)
 * reads that row the same way, so the names never contradict the trigger.
 */
export function remoteSides(nodes: readonly NodeWire[]): { fleet: NodeWire | null; server: NodeWire | null } {
  const { fleet, server } = versionSides(nodes);
  return { fleet: fleet === server ? null : fleet, server };
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
  return (
    <div className="build-line" role="status">
      {side('fleet', fleet?.current ?? null, fleet ? pendingTag(fleet) : null)}
      <span className="build-line-sep"> · </span>
      {side('server', server?.current ?? null, server ? pendingTag(server) : null)}
    </div>
  );
}
