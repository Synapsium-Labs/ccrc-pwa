// D-6613 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.5; plan Task DR-1). L1: pure and
// clock-free (the clock is an argument), `fs`-free; it imports L0 alone. The disk alarm's DECISION: what level a
// filesystem is at, when a level changes, and what the fleet's level is. The tick that measures and the funnel that
// notifies are `watch.ts`'s (L4); nothing here reads a disk.
//
// EVERY UNCERTAIN ANSWER IS "UNMEASURED", NEVER "OK": a read of nothing, or of a filesystem that reports neither size
// nor inodes, must not look like a healthy disk. A MISSING EXPECTED MOUNT IS CRITICAL AT ONCE: a silently absent
// volume pages as plainly as a full one.
import {
  DISK_CLEAR_MARGIN_PCT, DISK_CRITICAL_PCT, DISK_WARN_PCT,
  type DiskExpectedMount, type DiskFilesystem, type DiskFilesystemLevel, type DiskHealth, type DiskLevel, type DiskMeasured,
} from '../../shared/disk.js';

/** A filesystem's held level and the one differing level seen once, awaiting its second sighting. */
export interface DiskFilesystemVerdict extends DiskFilesystemLevel {
  readonly pending: DiskLevel | null;
}

/** The decider's memory and answer, in one: pass the last one back as `prev`. */
export interface DiskVerdict {
  readonly at: number;
  readonly level: DiskLevel;
  readonly filesystems: readonly DiskFilesystemVerdict[];
  readonly expectedMounts: readonly DiskExpectedMount[];
  /** Expected mounts missing in this pass: one missing pass is a bad read, two in a row is critical. */
  readonly mountsDown: readonly string[];
  /** The instant the standing `warn`/`critical` run began (D-6616): a rise to `warn`/`critical` with no episode open
   *  starts one, `unmeasured` carries an open one, and `ok` closes it. Absent while none is open, and on a verdict
   *  built before the field existed. */
  readonly episode?: number;
}

/** Whether `used` of `total` is at least `pct` percent, by integer cross-multiplication: 85.0% is exactly 85. */
const atLeast = (used: number, total: number, pct: number): boolean => total > 0 && used * 100 >= pct * total;

/** Whether either of bytes-used and inodes-used is at least `pct` percent. */
function usedAtLeast(fs: DiskFilesystem, pct: number): boolean {
  // df's formula: used / (used + avail), with used = size - free (reserved blocks are neither used nor available).
  const used = Math.max(0, fs.sizeBytes - fs.freeBytes);
  return atLeast(used, used + fs.availBytes, pct) || atLeast(fs.files - fs.filesFree, fs.files, pct);
}

/** A filesystem that reports neither a size nor inodes tells nothing. */
const measurable = (fs: DiskFilesystem): boolean => fs.sizeBytes > 0 || fs.files > 0;

/** The level a single reading gives a filesystem, with no memory: the larger of bytes-used and inodes-used. */
export function diskLevelOf(fs: DiskFilesystem): DiskLevel {
  if (!measurable(fs)) return 'unmeasured';
  if (usedAtLeast(fs, DISK_CRITICAL_PCT)) return 'critical';
  if (usedAtLeast(fs, DISK_WARN_PCT)) return 'warn';
  return 'ok';
}

/** The level a reading gives a filesystem that HOLDS `held`: a held level clears only `DISK_CLEAR_MARGIN_PCT` below
 *  its threshold. */
function targetLevel(fs: DiskFilesystem, held: DiskLevel): DiskLevel {
  if (!measurable(fs)) return 'unmeasured';
  if (usedAtLeast(fs, DISK_CRITICAL_PCT)) return 'critical';
  if (held === 'critical' && usedAtLeast(fs, DISK_CRITICAL_PCT - DISK_CLEAR_MARGIN_PCT)) return 'critical';
  if (usedAtLeast(fs, DISK_WARN_PCT)) return 'warn';
  if ((held === 'warn' || held === 'critical') && usedAtLeast(fs, DISK_WARN_PCT - DISK_CLEAR_MARGIN_PCT)) return 'warn';
  return 'ok';
}

/** What a process with no episode of its own does with the durable mark, judged by the filesystem(s) that pushed it and
 *  by no other: `resume` when one of them stands at warn/critical now; `forget` when every one reads below its clear band
 *  or is absent (a mark with no filesystem is stale); else `keep`. A read that tells nothing keeps, never forgets. */
export function diskMarkFate(devs: readonly string[], v: DiskVerdict, measured: DiskMeasured): 'resume' | 'forget' | 'keep' {
  const standing = (d: string): boolean => (d === 'mount' ? v.mountsDown.length > 0 : ['warn', 'critical'].includes(v.filesystems.find((f) => f.dev === d)?.level ?? ''));
  if (devs.some(standing)) return 'resume';
  const anyReadable = measured.filesystems.some(measurable);
  const clear = (d: string): boolean => {
    const fs = measured.filesystems.find((f) => f.dev === d);
    return d === 'mount' ? anyReadable : fs === undefined ? anyReadable : measurable(fs) && !usedAtLeast(fs, DISK_WARN_PCT - DISK_CLEAR_MARGIN_PCT);
  };
  return devs.every(clear) ? 'forget' : 'keep';
}

/** The fleet fold's order: `unmeasured` outranks `ok`, so a filesystem that cannot be read is never hidden by one that
 *  can; it still ranks below a measured `warn` or `critical`. */
const RANK: Record<DiskLevel, number> = { ok: 0, unmeasured: 1, warn: 2, critical: 3 };

/** One measurement folded into the memory. A filesystem seen for the first time is taken as it reads (there is no held
 *  level to protect); after that a level changes only when two consecutive measurements agree on the new one. */
export function diskVerdict(prev: DiskVerdict | null, measured: DiskMeasured, nowMs: number): DiskVerdict {
  const before = new Map((prev?.filesystems ?? []).map((f) => [f.dev, f]));
  const step = (last: DiskFilesystemVerdict, fs: DiskFilesystem, target: DiskLevel): DiskFilesystemVerdict => {
    // Fail toward keeping: a reading that could not be taken never lowers a known-bad level. Only a real measurement
    // moves a held `warn` or `critical`, through the hysteresis and the debounce below; otherwise the one alarm left
    // would go dark exactly when a full box stalls and its statfs times out.
    if (target === 'unmeasured' && RANK[last.level] >= RANK.warn) return { ...fs, level: last.level, pending: null };
    if (target === last.level) return { ...fs, level: last.level, pending: null };
    if (last.pending === target) return { ...fs, level: target, pending: null };
    if (last.pending !== null) {
      // Two differing sightings on the same side of the held level agree that it moved at least that far: take the
      // level both reached (the lower rank of the two going up, the higher going down), not "no agreement".
      const base = RANK[last.level];
      const rise = RANK[target] > base;
      if (rise === RANK[last.pending] > base) {
        const [a, b] = [RANK[last.pending], RANK[target]];
        const agreed = rise ? (a < b ? last.pending : target) : (a > b ? last.pending : target);
        return { ...fs, level: agreed, pending: target };
      }
    }
    return { ...fs, level: last.level, pending: target };
  };
  const seen = new Set(measured.filesystems.map((f) => f.dev));
  const read = measured.filesystems.map((fs): DiskFilesystemVerdict => {
    const last = before.get(fs.dev);
    return last === undefined ? { ...fs, level: diskLevelOf(fs), pending: null } : step(last, fs, targetLevel(fs, last.level));
  });
  // A held filesystem absent from this pass could not be read. A held `warn` or `critical` keeps its level (see
  // `step`); an `ok` one drifts toward `unmeasured` on the usual two sightings, never toward `ok`, and once drifted it is
  // a ghost, dropped unless a root that could not be read (failed or timed out) still points at it. Any filesystem is
  // dropped at once when every root now reports on another device or is absent (an absent root holds no bytes), and
  // none could not be read this pass (a label can span devices).
  const unreadable = new Set(measured.missing.filter((m) => m.why !== 'absent').map((m) => m.label));
  const absent = new Set(measured.missing.filter((m) => m.why === 'absent').map((m) => m.label));
  const reported = new Set(measured.filesystems.flatMap((f) => f.roots));
  let drifted = 0;
  const carried = [...before.values()].filter((f) => !seen.has(f.dev)).map((f) => step(f, f, 'unmeasured'))
    .filter((f) => {
      if (f.roots.length > 0 && f.roots.every((r) => reported.has(r) || absent.has(r)) && !f.roots.some((r) => unreadable.has(r))) return false;
      if (f.level === 'unmeasured' && !f.roots.some((r) => unreadable.has(r))) { drifted += 1; return false; }
      return true;
    });
  const filesystems = [...read, ...carried];
  // A missing mount pages only when it was missing the pass before too; one bad read never pages.
  const mountsDown = measured.expectedMounts.filter((m) => !m.mounted).map((m) => m.path);
  const confirmed = mountsDown.some((p) => (prev?.mountsDown ?? []).includes(p));
  let level: DiskLevel = 'ok';
  for (const f of filesystems) if (RANK[f.level] > RANK[level]) level = f.level;
  // Whatever could not be read this pass keeps the fleet off `ok`, while each filesystem's own level stays debounced.
  const unknown = unreadable.size > 0 || carried.length > 0 || drifted > 0 || mountsDown.length > 0 || measured.filesystems.length === 0;
  if (unknown && RANK[level] < RANK.unmeasured) level = 'unmeasured';
  if (confirmed) level = 'critical';
  // An episode starts at a rise to `warn`/`critical` with none open, is carried through `unmeasured`, and `ok` closes it.
  const standing = prev !== null && (prev.level === 'warn' || prev.level === 'critical');
  const open = prev === null ? undefined : (prev.episode ?? (standing ? prev.at : undefined));
  const episode = level === 'ok' ? undefined : level === 'unmeasured' ? open : (open ?? nowMs);
  return { at: nowMs, level, filesystems, expectedMounts: measured.expectedMounts, mountsDown, episode };
}

/** What the disk alarm says when the fleet level moves (D-6616, spec §2.5). `push` goes out through the notice funnel,
 *  `record-only` is the feed's alone. `dedupeKey` is `disk:<dev>:<level>:<episode>`; the watcher reads it before it
 *  writes, so a restart inside one episode says nothing twice. */
export interface DiskNotice {
  readonly mode: 'push' | 'record-only';
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
  /** The filesystem the key names (`mount` for a missing work mount): the episode mark records it. */
  readonly dev: string;
}

const GIB = 1024 ** 3;

/** A filesystem's used percent the way `df` reads it, the larger of bytes and inodes, whole points rounded down. */
function usedPct(fs: DiskFilesystem): number {
  const used = Math.max(0, fs.sizeBytes - fs.freeBytes);
  const bytes = used + fs.availBytes > 0 ? (used * 100) / (used + fs.availBytes) : 0;
  const inodes = fs.files > 0 ? ((fs.files - fs.filesFree) * 100) / fs.files : 0;
  return Math.floor(Math.max(bytes, inodes) + 1e-9);
}

const gib = (bytes: number): string => {
  const v = bytes / GIB;
  return v >= 1 ? `${Math.round(v)} GiB` : `${v.toFixed(1)} GiB`;
};

/** Decide the notice for one level change, from the verdict before it and the verdict after it. Only a RISE to `warn`
 *  or `critical` pushes (a rise to `critical` pushes even when `warn` already did); a fall between the two is silent; a
 *  clear to `ok` is recorded and never pushed; `unmeasured` says nothing. The body names the filesystem's labels and
 *  never a path. */
export function diskNotice(prev: DiskVerdict | null, next: DiskVerdict): DiskNotice | null {
  const heldRank = prev !== null && (prev.level === 'warn' || prev.level === 'critical') ? RANK[prev.level] : 0;
  if (next.level === 'ok') {
    if (heldRank === 0 || prev === null) return null;
    return {
      mode: 'record-only', title: 'Fleet disk back to normal',
      body: 'Every work filesystem is back under its warning level.',
      dedupeKey: `disk:fleet:clear:${prev.episode ?? prev.at}`, dev: 'fleet',
    };
  }
  if ((next.level !== 'warn' && next.level !== 'critical') || RANK[next.level] <= heldRank) return null;
  const episode = next.episode ?? next.at;
  const worst = next.filesystems.filter((f) => f.level === next.level).sort((a, b) => usedPct(b) - usedPct(a))[0];
  // A missing mount is named by its position in the expected list (1-based), never by its path.
  const down = next.expectedMounts.flatMap((m, i) => (next.mountsDown.includes(m.path) ? [i + 1] : []));
  const downText = down.length > 0 ? ` Work mount${down.length === 1 ? '' : 's'} ${down.map((i) => `#${i}`).join(', ')} not mounted.` : '';
  const limits = `Warns at ${DISK_WARN_PCT}%, critical at ${DISK_CRITICAL_PCT}%.`;
  if (worst === undefined) {
    // Critical with no full filesystem: an expected work mount is not mounted.
    return {
      mode: 'push', title: 'Fleet disk: a work volume is not mounted',
      body: `${next.mountsDown.length} expected work mount${next.mountsDown.length === 1 ? ' is' : 's are'} not mounted (${down.map((i) => `#${i}`).join(', ')}). ${limits}`,
      dedupeKey: `disk:mount:${next.level}:${episode}`, dev: 'mount',
    };
  }
  const others = next.filesystems.filter((f) => f.level === next.level).length - 1;
  return {
    mode: 'push', title: `Fleet disk ${usedPct(worst)}% full · ${gib(worst.availBytes)} free`,
    body: `Holds ${worst.roots.join(', ')}${others > 0 ? `, and ${others} more filesystem${others === 1 ? '' : 's'} at ${next.level}` : ''}.${downText} ${limits}`,
    dedupeKey: `disk:${worst.dev}:${next.level}:${episode}`, dev: worst.dev,
  };
}

/** The block `GET /api/fleet/health` serves for a verdict (D-6615): the pending sightings dropped, pressure when critical,
 *  `holders` empty (the tmp census's five largest are overlaid by whoever serves the block). */
export function diskBlockOf(v: DiskVerdict): DiskHealth {
  return {
    at: v.at,
    level: v.level,
    filesystems: v.filesystems.map(({ pending: _pending, ...fs }) => fs),
    expectedMounts: v.expectedMounts,
    pressure: v.level === 'critical',
    holders: [],
  };
}

/** The block after a read that could not be taken (an older agent, a fault on the link): the held block's facts stay, and
 *  the level stays a standing `warn` or `critical`, else reads `unmeasured`, never `ok`, so the one alarm does not go dark
 *  exactly when a full box stalls. */
export function unmeasuredDiskBlock(held: DiskHealth | null, nowMs: number): DiskHealth {
  const standing = held !== null && (held.level === 'warn' || held.level === 'critical');
  return {
    at: held?.at ?? nowMs,
    level: standing ? held.level : 'unmeasured',
    filesystems: held?.filesystems ?? [],
    expectedMounts: held?.expectedMounts ?? [],
    pressure: held?.pressure ?? false,
    holders: [],
  };
}
