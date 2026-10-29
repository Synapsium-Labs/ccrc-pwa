/**
 * L3 adapter: reads the four files stage 4 of the landing order trusts (`$REG/landing/<project>/enabled`, the row's
 * `<id>.lineage`, `$REG/land-probe-paused` and `$REG/landing/<project>/paused`) through `FleetIO` and hands them to
 * `lineage.ts`'s parsers. It decides nothing and reads no clock: `nowMs` comes from the caller. It runs only after
 * `readBranchTip`'s project guard has passed and `id` has passed `isRegistryId`, and it never reads `main-health`
 * (D-7478). Landing order wave 4b adds the one other reader of the radar's files: `probe` (below `readRadarProbe`), for
 * the fleet frame's `landing`, by the same regular-file rule, with `radar.ts`'s parser and a 512 KiB cap measured
 * before the read (D-7482).
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
import { parseProbe, RADAR_PROBE_MAX_BYTES, type ProbeRead } from './radar.js';

export interface LandingFacts {
  marker: MarkerRead;
  globalPause: PauseRead;
  projectPause: PauseRead;
  lineage: LineageRead;
}

type LandingIO = Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured'>;
type RegularRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

type SizedIO = LandingIO & Pick<FleetIO, 'statMeasured'>;

/** A regular file's bytes. A symlink or any other kind is `unreadable`, never its target's bytes; a failed lstat is
 *  `absent` only when it proved absence (`unmeasured` is an io that cannot answer, and is not absence). With `maxBytes`
 *  (the radar's `probe`, D-7482) the size is measured by `statMeasured` AFTER the kind check and BEFORE any read: a file
 *  over the cap is `unreadable` and is never read, a failed stat keeps its own reason, and the bytes are checked against
 *  the cap again after the read. Without it nothing changes for the other callers. */
export async function readRegular(io: LandingIO, file: string, signal?: AbortSignal): Promise<RegularRead>;
export async function readRegular(io: SizedIO, file: string, signal: AbortSignal | undefined, maxBytes: number): Promise<RegularRead>;
export async function readRegular(io: LandingIO | SizedIO, file: string, signal?: AbortSignal, maxBytes?: number): Promise<RegularRead> {
  const kind = await io.lstatMeasured(file);
  if (!kind.ok) return { ok: false, reason: kind.reason === 'absent' ? 'absent' : 'unreadable' };
  if (kind.kind !== 'regular') return { ok: false, reason: 'unreadable' };
  if (maxBytes !== undefined) {
    const size = await (io as SizedIO).statMeasured(file);
    if (!size.ok) return { ok: false, reason: size.reason };
    if (size.size > maxBytes) return { ok: false, reason: 'unreadable' };
  }
  const r = await io.readFileMeasured(file, undefined, signal);
  if (!r.ok) return { ok: false, reason: r.reason };
  return maxBytes !== undefined && Buffer.byteLength(r.content, 'utf8') > maxBytes ? { ok: false, reason: 'unreadable' } : r;
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

/** The radar's project directories, `$REG/landing/*`, with the lister's own `.lp.*` temporaries left out. A proven
 *  absence of the directory (no radar) and any other failure keep their own reasons. */
export async function listRadarProjects(
  io: Pick<FleetIO, 'readdirMeasured'>, registryDir: string,
): Promise<{ ok: true; names: string[] } | { ok: false; reason: ReadFailure }> {
  const r = await io.readdirMeasured(path.join(registryDir, 'landing'));
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, names: r.entries.filter((n) => !n.startsWith('.lp.')) };
}

/** One project's `probe`, through `readRegular` (the one regular-file reader, with the 512 KiB cap measured before the
 *  read, D-7482) and then `parseProbe`, which checks the bytes again. A proven absence is `absent`; every other fault is
 *  `unreadable`, and the parser's own `stale` and `unmeasured` pass through unchanged. */
export async function readRadarProbe(
  io: Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured' | 'statMeasured'>, registryDir: string, project: string,
  nowMs: number, signal?: AbortSignal,
): Promise<ProbeRead | { ok: false; reason: ReadFailure }> {
  const r = await readRegular(io, path.join(registryDir, 'landing', project, 'probe'), signal, RADAR_PROBE_MAX_BYTES);
  return r.ok ? parseProbe(r.content, project, nowMs) : r;
}

/** What one project's read came to in a pass: `readRadarProbe`'s answer, or `late` when it had not answered by the
 *  pass's deadline. */
export type RadarPassRead = ProbeRead | { ok: false; reason: ReadFailure | 'late' };

/** One pass of the radar lane's reads: ONE listing, then every named project's `probe` at once under ONE deadline.
 *  A project that has not answered by `deadlineMs` is `late` and its read is aborted, so it contributes nothing and
 *  never holds the others back. The timer is a local of this call (a deadline inside one adapter call). */
export async function readRadarPass(
  io: Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured' | 'statMeasured' | 'readdirMeasured'>, registryDir: string,
  projectsWanted: ReadonlySet<string>, nowMs: number, deadlineMs: number,
): Promise<{ ok: true; reads: Map<string, RadarPassRead> } | { ok: false; reason: ReadFailure }> {
  const listing = await listRadarProjects(io, registryDir);
  if (!listing.ok) return listing;
  const names = listing.names.filter((n) => projectsWanted.has(n));
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<RadarPassRead>((resolve) => {
    timer = setTimeout(() => { ac.abort(); resolve({ ok: false, reason: 'late' }); }, deadlineMs);
  });
  try {
    const answers = await Promise.all(names.map((n) => Promise.race([
      readRadarProbe(io, registryDir, n, nowMs, ac.signal).catch((): RadarPassRead => ({ ok: false, reason: 'unreadable' })),
      late,
    ])));
    return { ok: true, reads: new Map(names.map((n, i) => [n, answers[i]!] as const)) };
  } finally {
    clearTimeout(timer);
  }
}
