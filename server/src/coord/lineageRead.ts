/**
 * L3 adapter: reads the four files stage 4 of the landing order trusts (`$REG/landing/<project>/enabled`, the row's
 * `<id>.lineage`, `$REG/land-probe-paused` and `$REG/landing/<project>/paused`) through `FleetIO` and hands them to
 * `lineage.ts`'s parsers. It decides nothing and reads no clock: `nowMs` comes from the caller. It runs only after
 * `readBranchTip`'s project guard has passed and `id` has passed `isRegistryId`, and it never reads `probe` or
 * `main-health`.
 *
 * Wave 3b's rule, re-proved here: `enabled` and `<id>.lineage` count only as REGULAR files. `readFileMeasured`
 * follows symlinks, so each is read only after `lstatMeasured` (the path's own type, never its target's) answers
 * `regular`. The two pause markers are decided by `lstatMeasured` alone: any entry, a dangling symlink included,
 * pauses (the probe's own `lexists` for the project marker, and stricter than its `-e` for the global one, which is
 * the safe direction). Every distinction the io makes survives to the facts: a proven absence is `absent`/`running`,
 * and any other failure is `unreadable`/`unknown`.
 */
import path from 'node:path';
import type { FleetIO, ReadFailure } from '../io.js';
import { parseEnabled, parseLineage, type LineageRead, type MarkerRead, type PauseRead } from './lineage.js';

export interface LandingFacts {
  marker: MarkerRead;
  globalPause: PauseRead;
  projectPause: PauseRead;
  lineage: LineageRead;
}

type LandingIO = Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured'>;
type RegularRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

/** A regular file's bytes. A symlink or any other kind is `unreadable`, never its target's bytes; a failed lstat is
 *  `absent` only when it proved absence (`unmeasured` is an io that cannot answer, and is not absence). */
async function readRegular(io: LandingIO, file: string, signal?: AbortSignal): Promise<RegularRead> {
  const kind = await io.lstatMeasured(file);
  if (!kind.ok) return { ok: false, reason: kind.reason === 'absent' ? 'absent' : 'unreadable' };
  if (kind.kind !== 'regular') return { ok: false, reason: 'unreadable' };
  const r = await io.readFileMeasured(file, undefined, signal);
  return r.ok ? r : { ok: false, reason: r.reason };
}

/** A pause marker, by lstat alone: any entry pauses, a proven absence runs, anything else is not known. */
async function readPause(io: LandingIO, file: string): Promise<PauseRead> {
  const kind = await io.lstatMeasured(file);
  if (kind.ok) return 'paused';
  return kind.reason === 'absent' ? 'running' : 'unknown';
}

export async function readLandingFacts(
  io: LandingIO, registryDir: string, project: string, id: string, branch: string, nowMs: number,
  signal?: AbortSignal,
): Promise<LandingFacts> {
  const dir = path.join(registryDir, 'landing', project);
  const [marker, globalPause, projectPause, lineage] = await Promise.all([
    readRegular(io, path.join(dir, 'enabled'), signal),
    readPause(io, path.join(registryDir, 'land-probe-paused')),
    readPause(io, path.join(dir, 'paused')),
    readRegular(io, path.join(dir, `${id}.lineage`), signal),
  ]);
  return {
    marker: marker.ok ? parseEnabled(marker.content, project, nowMs) : marker.reason,
    globalPause,
    projectPause,
    lineage: lineage.ok ? parseLineage(lineage.content, { project, id, branch }, nowMs) : { ok: false, reason: lineage.reason },
  };
}
