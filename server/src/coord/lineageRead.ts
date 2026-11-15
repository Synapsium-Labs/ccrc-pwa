/**
 * L3 adapter: reads the four files stage 4 of the landing order trusts (`$REG/landing/<project>/enabled`, the row's
 * `<id>.lineage`, `$REG/land-probe-paused` and `$REG/landing/<project>/paused`) through `FleetIO` and hands them to
 * `lineage.ts`'s parsers. It decides nothing and reads no clock: `nowMs` comes from the caller. It runs only after
 * `readBranchTip`'s project guard has passed and `id` has passed `isRegistryId`, and it never reads `main-health`
 * (D-7478). Landing order wave 4b adds the one other reader of the radar's files: `probe` (below `readRadarProbe`), for
 * the fleet frame's `landing`, by the same regular-file rule, with `radar.ts`'s parser and a 512 KiB cap measured
 * before the read (D-7482). Landing order wave 5a hardens that pass (D-7530, D-7531): a listed name that is not a safe
 * project segment (`isSafeProjectSegment`, the radar's own grammar) joins no path and is kept apart as `refused`; a
 * rejected listing answers `unreadable`; at most `RADAR_PASS_CONCURRENCY` probe reads are in flight, through `mapBounded`;
 * and the pass's one deadline starts before the listing and covers it, so a hung listing, like a hung read, settles as
 * `late` and a name whose turn comes after the deadline is `late` with no io.
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
import {
  parseLander, parseMainHealth, parseProbe, RADAR_PROBE_MAX_BYTES,
  type ControlFailure, type LandingControlRead, type ProbeRead,
} from './radar.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';
import { isSafeProjectSegment } from './ledgerseed.js';
import { mapBounded } from '../bounded.js';

export interface LandingFacts {
  marker: MarkerRead;
  globalPause: PauseRead;
  projectPause: PauseRead;
  lineage: LineageRead;
}

type LandingIO = Pick<FleetIO, 'readFileMeasured' | 'lstatMeasured'>;
type RegularRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

type BoundedIO = Pick<FleetIO, 'lstatMeasured' | 'statMeasured' | 'readFileFromBytesMeasured'>;

/** The unbounded legacy read keeps its contract: a regular file's bytes, a symlink or any other kind `unreadable`, a
 *  failed lstat `absent` only when it proved absence (`unmeasured` is an io that cannot answer, and is not absence). */
export async function readRegular(io: LandingIO, file: string, signal?: AbortSignal): Promise<RegularRead>;
/** The BOUNDED read (wave 5i; the radar's `probe` since D-7482): the cap is checked on a `statMeasured` that follows the
 *  kind check, BEFORE any byte moves, so a file over it is `oversize` (with the measured size) and nothing is read. The
 *  bytes then come in ranges of at most `READ_FROM_MAX_BYTES` through `readFileFromBytesMeasured`, each no longer than
 *  the size promised, every answer carrying the same size; the whole is decoded ONCE, as strict UTF-8, only after the
 *  assembled length equals the size and a second stat shows the same size and mtime. Every distinction survives: proven
 *  absence `absent`, an io that cannot lstat `unmeasured`, any other fault `unreadable`, a file that changed under the
 *  read `unmeasured` (not a measurement of one file), a short range or invalid UTF-8 `unreadable`. An older peer that
 *  cannot return bytes answers `unreadable` from `readFileFromBytesMeasured` itself. Residual: metadata rechecks cannot
 *  prove inode identity across remote range calls, so the result is a cue snapshot, never merge permission. */
export async function readRegular(io: BoundedIO, file: string, signal: AbortSignal | undefined, maxBytes: number): Promise<{ ok: true; content: string } | ControlFailure>;
export async function readRegular(
  io: LandingIO | BoundedIO, file: string, signal?: AbortSignal, maxBytes?: number,
): Promise<RegularRead | { ok: true; content: string } | ControlFailure> {
  const lio = io as LandingIO;
  const kind = await lio.lstatMeasured(file);
  if (maxBytes === undefined) {
    if (!kind.ok) return { ok: false, reason: kind.reason === 'absent' ? 'absent' : 'unreadable' };
    if (kind.kind !== 'regular') return { ok: false, reason: 'unreadable' };
    return lio.readFileMeasured(file, undefined, signal);
  }
  const bio = io as BoundedIO;
  if (!kind.ok) return { ok: false, reason: kind.reason };
  if (kind.kind !== 'regular') return { ok: false, reason: 'unreadable' };
  const first = await bio.statMeasured(file);
  if (!first.ok) return { ok: false, reason: first.reason };
  if (first.size > maxBytes) return { ok: false, reason: 'oversize', size: first.size };
  const chunks: Uint8Array[] = [];
  let have = 0;
  while (have < first.size) {
    const ask = Math.min(READ_FROM_MAX_BYTES, first.size - have);
    const r = await bio.readFileFromBytesMeasured(file, have, ask, undefined, signal);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.size !== first.size) return { ok: false, reason: 'unmeasured' };
    if (r.bytes.length !== ask) return { ok: false, reason: 'unreadable' };
    chunks.push(r.bytes);
    have += ask;
  }
  const again = await bio.statMeasured(file);
  if (!again.ok) return { ok: false, reason: again.reason };
  if (again.size !== first.size || again.mtimeMs !== first.mtimeMs) return { ok: false, reason: 'unmeasured' };
  try {
    return { ok: true, content: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
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

/** The radar's project directories, `$REG/landing/*`, with the lister's own `.lp.*` temporaries left out. A name that
 *  passes `isSafeProjectSegment` goes to `names`; one that fails goes to `refused`, and nothing joins a path for it. A
 *  proven absence of the directory (no radar) and any other failure keep their own reasons. */
export async function listRadarProjects(
  io: Pick<FleetIO, 'readdirMeasured'>, registryDir: string, signal?: AbortSignal,
): Promise<{ ok: true; names: string[]; refused: string[] } | { ok: false; reason: ReadFailure }> {
  const r = await io.readdirMeasured(path.join(registryDir, 'landing'), undefined, signal);
  if (!r.ok) return { ok: false, reason: r.reason };
  const listed = r.entries.filter((n) => !n.startsWith('.lp.'));
  return { ok: true, names: listed.filter(isSafeProjectSegment), refused: listed.filter((n) => !isSafeProjectSegment(n)) };
}

/** One project's `probe`, through the bounded `readRegular` (the one regular-file reader, with the 512 KiB cap measured
 *  before the read, D-7482) and then `parseProbe`, which checks the bytes again. Every failure of the read keeps its own
 *  reason (`absent`, `oversize`, `unmeasured`, `unreadable`), and the parser's own `unreadable`, `stale` and `unmeasured`
 *  pass through unchanged. */
export async function readRadarProbe(
  io: BoundedIO, registryDir: string, project: string, nowMs: number, signal?: AbortSignal,
): Promise<ProbeRead | ControlFailure> {
  const r = await readRegular(io, path.join(registryDir, 'landing', project, 'probe'), signal, RADAR_PROBE_MAX_BYTES);
  return r.ok ? parseProbe(r.content, project, nowMs) : r;
}

/** The lander marker's cap: the producer's document is a few dozen bytes. */
export const LANDER_MAX_BYTES = 4096;

export type ControlIO = BoundedIO & Pick<FleetIO, 'readdirMeasured'>;

/** One component of the marker's ancestor chain, proved a REAL directory. `lstatMeasured` answers the path's own type
 *  and says `other` for a directory and for a FIFO alike, so a directory is proved by the listing too: lstat says "not a
 *  link" and `readdirMeasured` says "listable". A symlink is `absent` for this marker (the producer's own rule: it
 *  writes and removes only through real directories), an io that cannot lstat is `unmeasured`, a regular file is
 *  `unreadable`, and a listing fault or an absence the lstat did not show keeps its own reason. */
async function realDirectory(io: ControlIO, dir: string, signal?: AbortSignal): Promise<ControlFailure | null> {
  const kind = await io.lstatMeasured(dir);
  if (!kind.ok) return { ok: false, reason: kind.reason };
  if (kind.kind === 'symlink') return { ok: false, reason: 'absent' };
  if (kind.kind === 'regular') return { ok: false, reason: 'unreadable' };
  const listed = await io.readdirMeasured(dir, undefined, signal);
  return listed.ok ? null : { ok: false, reason: listed.reason };
}

/** The chain from the registry boundary (trusted as configured) through `landing/<project>`, component by component. */
async function markerChain(io: ControlIO, registryDir: string, project: string, signal?: AbortSignal): Promise<ControlFailure | null> {
  const landing = path.join(registryDir, 'landing');
  return (await realDirectory(io, landing, signal)) ?? (await realDirectory(io, path.join(landing, project), signal));
}

/** The lander marker: the chain proved before any byte moves, the bounded read, the chain proved again after it, then the
 *  parser. A symlinked ancestor is `absent`, never a read of its target. */
async function readLander(io: ControlIO, registryDir: string, project: string, nowMs: number, signal?: AbortSignal) {
  const before = await markerChain(io, registryDir, project, signal);
  if (before !== null) return before;
  const r = await readRegular(io, path.join(registryDir, 'landing', project, 'lander'), signal, LANDER_MAX_BYTES);
  if (!r.ok) return r;
  const after = await markerChain(io, registryDir, project, signal);
  if (after !== null) return after;
  return parseLander(r.content, project, nowMs);
}

async function readHealth(io: ControlIO, registryDir: string, project: string, nowMs: number, signal?: AbortSignal) {
  const r = await readRegular(io, path.join(registryDir, 'landing', project, 'main-health'), signal, RADAR_PROBE_MAX_BYTES);
  return r.ok ? parseMainHealth(r.content, project, nowMs) : r;
}

/** One project's control bundle, around a probe the caller already read (the pass reads each probe once). It decides
 *  nothing and reads no clock: `nowMs` is the caller's. A name that is no safe project segment joins no path (`refused`).
 *  Each document keeps its own failure, so a marker fault is never an opted-out marker and a health fault is never green. */
export async function readLandingControl(
  io: ControlIO, registryDir: string, project: string, probe: ProbeRead | ControlFailure, nowMs: number, signal?: AbortSignal,
): Promise<LandingControlRead> {
  if (!isSafeProjectSegment(project)) {
    const refused = { ok: false, reason: 'refused' } as const;
    return { lander: refused, probe, health: refused };
  }
  const [lander, health] = await Promise.all([
    readLander(io, registryDir, project, nowMs, signal),
    readHealth(io, registryDir, project, nowMs, signal),
  ]);
  return { lander, probe, health };
}

/** At most this many projects' `probe` reads are in flight in one pass (D-7531). */
export const RADAR_PASS_CONCURRENCY = 8;

/** What one project's read came to in a pass: `readRadarProbe`'s answer, `late` when it had not answered by the pass's
 *  deadline, or `refused` for a listed name that is not a safe project segment (never read, D-7530). */
export type RadarPassRead = ProbeRead | ControlFailure;

/** A bundle in which every document failed the same way (a deadline, a refused name, a directory that is not listed). */
export const allFailed = (f: ControlFailure): LandingControlRead => ({ lander: f, probe: f, health: f });

/** One pass of the radar lane's reads: ONE listing, then each wanted project's `probe` at most `RADAR_PASS_CONCURRENCY`
 *  at a time, under ONE deadline that starts before the listing. A listing or a project that has not answered by
 *  `deadlineMs` is `late` and its read is aborted, so it contributes nothing and never holds the others back: a hung
 *  read frees its slot at the deadline, and a name whose turn comes after it is `late` without any io. A listing that
 *  rejects answers `unreadable`. The timer is a local of this call (a deadline inside one adapter call).
 *
 *  Wave 5i: a project in `controlsWanted` also gets its control bundle in the same slot, around the probe already read
 *  (each probe is read once). A wanted project the successful listing does not return is `absent` in all three documents,
 *  a refused name is `refused`, and no `controlsWanted` means an empty `controls`. */
export async function readRadarPass(
  io: Pick<FleetIO, 'readFileFromBytesMeasured' | 'lstatMeasured' | 'statMeasured' | 'readdirMeasured'>, registryDir: string,
  projectsWanted: ReadonlySet<string>, nowMs: number, deadlineMs: number, controlsWanted: ReadonlySet<string> = new Set(),
): Promise<{ ok: true; reads: Map<string, RadarPassRead>; controls: Map<string, LandingControlRead> } | { ok: false; reason: ReadFailure | 'late' }> {
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<{ ok: false; reason: 'late' }>((resolve) => {
    timer = setTimeout(() => { ac.abort(); resolve({ ok: false, reason: 'late' }); }, deadlineMs);
  });
  type Bundle = { probe: RadarPassRead; control: LandingControlRead | null };
  try {
    const listing = await Promise.race([
      listRadarProjects(io, registryDir, ac.signal).catch(() => ({ ok: false, reason: 'unreadable' }) as const), late]);
    if (!listing.ok) return listing;
    const safe = listing.names.filter((n) => projectsWanted.has(n) || controlsWanted.has(n));
    const failedBundle = (n: string, f: ControlFailure): Bundle => ({ probe: f, control: controlsWanted.has(n) ? allFailed(f) : null });
    const read = async (n: string): Promise<Bundle> => {
      const probe = await readRadarProbe(io, registryDir, n, nowMs, ac.signal);
      return { probe, control: controlsWanted.has(n) ? await readLandingControl(io, registryDir, n, probe, nowMs, ac.signal) : null };
    };
    const answers = await mapBounded(safe, RADAR_PASS_CONCURRENCY, (n): Promise<Bundle> => (ac.signal.aborted
      ? Promise.resolve(failedBundle(n, { ok: false, reason: 'late' }))
      : Promise.race([read(n).catch((): Bundle => failedBundle(n, { ok: false, reason: 'unreadable' })), late.then((l) => failedBundle(n, l))])));
    const reads = new Map<string, RadarPassRead>();
    const controls = new Map<string, LandingControlRead>();
    safe.forEach((n, i) => {
      if (projectsWanted.has(n)) reads.set(n, answers[i]!.probe);
      const c = answers[i]!.control;
      if (c !== null) controls.set(n, c);
    });
    for (const n of listing.refused) {
      if (projectsWanted.has(n)) reads.set(n, { ok: false, reason: 'refused' });
      if (controlsWanted.has(n)) controls.set(n, allFailed({ ok: false, reason: 'refused' }));
    }
    for (const n of controlsWanted) if (!controls.has(n)) controls.set(n, allFailed({ ok: false, reason: 'absent' }));
    return { ok: true, reads, controls };
  } finally {
    clearTimeout(timer);
  }
}
