// D-6614 (fleet disk retention spec 2026-10-23 §2.5; plan Task DR-2). L3 adapter: the agent's `disk` op measures the
// filesystems the fleet's work roots live on and answers WHAT IT READ. It decides nothing: the level, the debounce
// and the hysteresis are `server/src/disk.ts`'s.
//
// The op takes no argument, so no path from a caller is ever statted: the paths are `DISK_WORK_ROOTS` resolved here
// against this agent's own HOME, its temp dir and the roster's config dirs. Each root is measured under a deadline,
// because a full or stalled volume is exactly when its `statfs` hangs.
//
// EVERY ROOT THAT COULD NOT BE READ IS NAMED, NEVER ZERO (`DiskMissingRoot`): `absent` is a proven ENOENT (the root
// holds no bytes); `failed` and `timeout` are unknown. A label is reported when ANY of its paths failed, even if its
// other paths were measured, and the worst reason wins, so a critical filesystem behind a failed path is not read as
// "moved". Expected mounts (`CCRC_WORK_MOUNTS`) are answered from mountinfo, never from whether the path exists:
// an unmounted volume leaves its empty mount-point directory behind.
import { readFileSync } from 'node:fs';
import { statfs, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DISK_STATFS_DEADLINE_MS, type DiskOpReply,
} from '../../shared/agent-protocol.js';
import {
  DISK_WORK_ROOTS, type DiskExpectedMount, type DiskFilesystem, type DiskMissingRoot, type DiskMissingWhy,
} from '../../shared/disk.js';
import { parseRoster } from '../../shared/roster.js';

/** The fields of a `statfs` answer this op reads. */
export interface DiskStatfs {
  bsize: number; blocks: number; bfree: number; bavail: number; files: number; ffree: number;
}

/** Every disk read this op makes, so a test injects the answer. The real ones are `realDiskSeams()`. */
export interface DiskSeams {
  statfs(p: string): Promise<DiskStatfs>;
  /** Only `dev` is read. */
  stat(p: string): Promise<{ dev: number }>;
  /** `/proc/self/mountinfo`'s text, or `null` when it cannot be read (not a Linux box, or no /proc). */
  readMountinfo(): string | null;
  /** A small file's text; throws on any failure (an ENOENT is `code: 'ENOENT'`). Used for the roster only. */
  readFile(p: string): string;
  env: NodeJS.ProcessEnv;
  /** One root's `stat` + `statfs` deadline. */
  deadlineMs: number;
}

const realStat = (p: string): Promise<{ dev: number }> => stat(p);

export function realDiskSeams(): DiskSeams {
  return {
    statfs: (p) => statfs(p).then((s) => ({
      bsize: Number(s.bsize), blocks: Number(s.blocks), bfree: Number(s.bfree), bavail: Number(s.bavail),
      files: Number(s.files), ffree: Number(s.ffree),
    })),
    stat: realStat,
    readMountinfo: () => {
      try { return readFileSync('/proc/self/mountinfo', 'utf8'); } catch { return null; }
    },
    readFile: (p) => readFileSync(p, 'utf8'),
    env: process.env,
    deadlineMs: DISK_STATFS_DEADLINE_MS,
  };
}

/** One mountinfo line, reduced to what this op reads. */
export interface MountEntry { majmin: string; mountPoint: string; fsType: string; readOnly: boolean }

/** mountinfo escapes space, tab, newline and backslash in a path as three-digit octal (`\040`). */
const unescapeMountPath = (s: string): string => s.replace(/\\([0-7]{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)));

/** `/proc/self/mountinfo`, one entry per well-formed line (a malformed line is skipped: it names no mount). */
export function parseMountinfo(text: string): MountEntry[] {
  const out: MountEntry[] = [];
  for (const line of text.split('\n')) {
    const f = line.split(' ');
    const dash = f.indexOf('-');
    if (f.length < 10 || dash < 6 || dash + 1 >= f.length) continue;
    out.push({
      majmin: f[2]!,
      mountPoint: unescapeMountPath(f[4]!),
      fsType: f[dash + 1]!,
      readOnly: f[5]!.split(',').includes('ro'),
    });
  }
  return out;
}

/** Linux's `st_dev` as mountinfo's `major:minor` (glibc's `gnu_dev_major`/`gnu_dev_minor`). */
export function devMajMin(dev: number): string {
  const d = BigInt(dev);
  const major = ((d >> 8n) & 0xfffn) | ((d >> 32n) & ~0xfffn);
  const minor = (d & 0xffn) | ((d >> 12n) & ~0xffn);
  return `${major}:${minor}`;
}

type Outcome =
  | { kind: 'ok'; dev: number; s: DiskStatfs }
  | { kind: 'missing'; why: DiskMissingWhy };

/** A probe that missed its deadline is abandoned, but its syscall still holds one of libuv's four threadpool threads
 *  until the kernel answers, and unlike a short-lived CLI this agent never exits to free it. So every probe still
 *  unsettled is remembered (per `stat` seam), and while a path's earlier probe is pending, or `MAX_HUNG` probes are
 *  already pending, a new probe answers `timeout` at once and starts no syscall: hung threads stay below the pool
 *  size and the agent's other file reads keep their threads. */
const MAX_HUNG = 2;
const hungBySeam = new WeakMap<object, Map<string, Promise<unknown>>>();

/** `stat` + `statfs` of one path, raced against the deadline. The timer is local to this call (a deadline, not a
 *  scheduler); a probe that never answers is abandoned, not awaited, and remembered until it settles. */
async function probe(seams: DiskSeams, p: string): Promise<Outcome> {
  const hung = hungBySeam.get(seams.stat) ?? new Map<string, Promise<unknown>>();
  hungBySeam.set(seams.stat, hung);
  if (hung.has(p) || hung.size >= MAX_HUNG) return { kind: 'missing', why: 'timeout' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'missing', why: 'timeout' }), seams.deadlineMs);
  });
  const read = (async (): Promise<Outcome> => {
    try {
      const st = await seams.stat(p);
      const s = await seams.statfs(p);
      return { kind: 'ok', dev: st.dev, s };
    } catch (e) {
      return { kind: 'missing', why: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'failed' };
    } finally {
      done = true;
      hung.delete(p);
    }
  })();
  try {
    return await Promise.race([read, deadline]);
  } finally {
    clearTimeout(timer);
    if (!done) hung.set(p, read);
  }
}

const WHY_RANK: Record<DiskMissingWhy, number> = { absent: 0, failed: 1, timeout: 2 };
const worse = (a: DiskMissingWhy, b: DiskMissingWhy): DiskMissingWhy => (WHY_RANK[b] > WHY_RANK[a] ? b : a);

/** The roster's config dirs under `home`. A roster that is absent has none (`absent`); one that cannot be read or
 *  parsed leaves them UNKNOWN (`failed`). */
function configDirs(home: string, seams: DiskSeams): { dirs: string[]; why: DiskMissingWhy | null } {
  let text: string;
  try {
    text = seams.readFile(path.join(home, '.ccrc', 'accounts.json'));
  } catch (e) {
    return { dirs: [], why: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'failed' };
  }
  try {
    const roster = parseRoster(JSON.parse(text));
    return { dirs: [...new Set(roster.accounts.map((a) => path.join(home, a.configDirSuffix)))], why: null };
  } catch {
    return { dirs: [], why: 'failed' };
  }
}

/** A template, resolved to the path(s) it names. `${CONFIG_DIR}` stands for every roster config dir. */
function resolveTemplate(t: string, home: string, tmp: string, dirs: readonly string[]): string[] {
  if (t === '${CONFIG_DIR}') return [...dirs];
  return [t.replace('${HOME}', home).replace('${TMPDIR:-/tmp}', tmp)];
}

/** The mountinfo entry for a device that best names `p`: the longest mount point containing it, else any on the dev. */
function mountFor(entries: readonly MountEntry[], majmin: string, p: string): MountEntry | null {
  const onDev = entries.filter((e) => e.majmin === majmin);
  const holding = onDev.filter((e) => e.mountPoint === '/' || p === e.mountPoint || p.startsWith(`${e.mountPoint}/`));
  const pool = holding.length > 0 ? holding : onDev;
  return pool.reduce<MountEntry | null>((best, e) => (best === null || e.mountPoint.length > best.mountPoint.length ? e : best), null);
}

/** Measure every work root once. Never throws for a disk fault: a fault is a `missing` row. */
export async function measureDisk(home: string, given: Partial<DiskSeams> = {}): Promise<DiskOpReply> {
  const seams: DiskSeams = { ...realDiskSeams(), ...given };
  const tmpEnv = seams.env['TMPDIR'];
  const tmp = tmpEnv !== undefined && tmpEnv !== '' ? tmpEnv : '/tmp';
  const cfg = configDirs(home, seams);

  // label -> the paths it resolves to, in table order; every path measured once however many labels name it.
  const byLabel = new Map<string, string[]>();
  for (const root of DISK_WORK_ROOTS) {
    const paths = [...new Set(root.templates.flatMap((t) => resolveTemplate(t, home, tmp, cfg.dirs)))];
    byLabel.set(root.label, paths);
  }
  const unique = [...new Set([...byLabel.values()].flat())];
  const outcomes = new Map<string, Outcome>();
  // In sequence: a stalled volume then holds at most MAX_HUNG threads, never one per path.
  for (const p of unique) outcomes.set(p, await probe(seams, p));

  const missing: DiskMissingRoot[] = [];
  const devLabels = new Map<number, string[]>();
  const devFirst = new Map<number, { path: string; s: DiskStatfs }>();
  for (const [label, paths] of byLabel) {
    let why: DiskMissingWhy | null = label === 'config-dirs' ? cfg.why : null;
    for (const p of paths) {
      const o = outcomes.get(p)!;
      if (o.kind === 'missing') { why = why === null ? o.why : worse(why, o.why); continue; }
      const labels = devLabels.get(o.dev) ?? [];
      if (!labels.includes(label)) labels.push(label);
      devLabels.set(o.dev, labels);
      if (!devFirst.has(o.dev)) devFirst.set(o.dev, { path: p, s: o.s });
    }
    if (why !== null) missing.push({ label, why });
  }

  const mountinfo = seams.readMountinfo();
  const entries = mountinfo === null ? [] : parseMountinfo(mountinfo);
  const filesystems: DiskFilesystem[] = [];
  for (const [d, labels] of devLabels) {
    const first = devFirst.get(d)!;
    const entry = mountFor(entries, devMajMin(d), first.path);
    const { s } = first;
    filesystems.push({
      dev: String(d),
      // Without mountinfo the mount point is unknown: name the first measured root, and the type `unknown`.
      mount: entry?.mountPoint ?? first.path,
      fsType: entry?.fsType ?? 'unknown',
      roots: DISK_WORK_ROOTS.map((r) => r.label).filter((l) => labels.includes(l)),
      sizeBytes: s.blocks * s.bsize,
      availBytes: s.bavail * s.bsize,
      freeBytes: s.bfree * s.bsize,
      files: s.files,
      filesFree: s.ffree,
      readOnly: entry?.readOnly ?? false,
    });
  }

  // An expected mount is MOUNTED only if mountinfo says so; unreadable mountinfo proves nothing, so it reads as not
  // mounted (the alarming direction: the decider needs two consecutive passes before it pages).
  const mountPoints = new Set(entries.map((e) => e.mountPoint));
  const expectedMounts: DiskExpectedMount[] = (seams.env['CCRC_WORK_MOUNTS'] ?? '').split(' ')
    .filter((p) => p !== '')
    .map((p) => ({ path: p, mounted: mountPoints.has(path.resolve(p)) }));

  return { filesystems, expectedMounts, missing };
}
