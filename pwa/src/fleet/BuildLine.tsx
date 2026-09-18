import type { ReactNode } from 'react';
import type { FleetHealth } from '../../../shared/api';
import type { BuildInfo } from '../../../shared/buildinfo';
import './fleet.css';

/** "v0.0.7" / "unversioned (bd2bf57a)" / "—", plus " dirty"; amber unless
 *  the side is a clean, versioned release stamp. */
function side(label: string, b: BuildInfo | null): ReactNode {
  if (b === null) return <span className="build-line-side build-line-side--warn">{label} —</span>;
  // ONE predicate, read twice. The name used `??` (nullish: undefined AND
  // null) while the amber flag tested `=== undefined` alone, so a stamp
  // whose `version` arrived as null rendered "unversioned (…)" in calm
  // black — the line saying one thing and its colour saying the other, over
  // exactly the field this line exists to report.
  const versioned = typeof b.version === 'string';
  const name = versioned ? b.version : `unversioned (${b.sha.slice(0, 8)})`;
  const warn = !versioned || b.dirty;
  return (
    <span className={`build-line-side${warn ? ' build-line-side--warn' : ''}`}>
      {label} {name}{b.dirty ? ' dirty' : ''}
    </span>
  );
}

/** Always visible at the foot of FleetScreen (spec §6). Renders nothing for
 *  local mode, for no answer yet, or for a server older than `builds`. */
export function BuildLine({ health }: { health: FleetHealth | null }): ReactNode {
  if (!health || health.mode !== 'remote' || !health.builds) return null;
  return (
    <div className="build-line" role="status">
      {side('fleet', health.builds.fleet)}
      <span className="build-line-sep"> · </span>
      {side('server', health.builds.own)}
    </div>
  );
}
