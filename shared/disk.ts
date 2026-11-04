// D-6613 (spec docs/superpowers/specs/2026-10-23-fleet-disk-retention-design.md §2.5; plan Task DR-1). L0: imports
// NOTHING (the PWA bundles this file). ONE VOCABULARY for the fleet's disk alarm: the roots that count as work space,
// the two thresholds and the clearing margin, the pressure-mode age table, and the shapes `GET /api/fleet/health`
// carries in its optional `disk` block. The agent's `disk` op, the server's decider and doctor's bash twin all read
// these values; a test pins the bash twins equal to them.

/** A work root: a label and the templates that name it. `${HOME}` is the agent's home; `${TMPDIR:-/tmp}` is the
 *  temp dir its sessions get, else `/tmp`; `${CONFIG_DIR}` stands for EVERY roster config dir (the roster is runtime
 *  data, so no account is named here). Resolved by whoever measures; never by a caller across the agent link. */
export interface DiskWorkRoot {
  readonly label: string;
  readonly templates: readonly string[];
}

export const DISK_WORK_ROOTS: readonly DiskWorkRoot[] = [
  { label: 'home', templates: ['${HOME}'] },
  { label: 'projects', templates: ['${HOME}/projects'] },
  { label: 'worktrees', templates: ['${HOME}/worktrees'] },
  { label: 'cc-tmp', templates: ['${HOME}/.cc-tmp'] },
  { label: 'claude-tmp', templates: ['${TMPDIR:-/tmp}', '/tmp'] },
  { label: 'config-dirs', templates: ['${CONFIG_DIR}'] },
  { label: 'ccrc', templates: ['${HOME}/.ccrc'] },
  { label: 'registry', templates: ['${HOME}/.cc-sessions'] },
];

/** A filesystem warns at this percent used (bytes or inodes, whichever is larger). */
export const DISK_WARN_PCT = 85;
/** A filesystem is critical at this percent used. Box-side sweeps enter pressure mode here too. */
export const DISK_CRITICAL_PCT = 92;
/** A held level clears only this many points below its threshold. */
export const DISK_CLEAR_MARGIN_PCT = 2;

/** One sweep's age floor, normal and under pressure, in seconds (spec §2.5.3). A pressure value never exceeds the
 *  normal one; `0` is "none" (a grace that ends at once) or "every pass" (a cadence). A floor the spec calls
 *  never-lowered carries the same number in both columns. */
export interface DiskPressureAge {
  readonly sweep: string;
  readonly normalS: number;
  readonly pressureS: number;
}

export const DISK_PRESSURE_AGES: readonly DiskPressureAge[] = [
  { sweep: 'tmp-sweep-dead-units', normalS: 604800, pressureS: 172800 },
  { sweep: 'tmp-sweep-live-untouched', normalS: 1209600, pressureS: 259200 },
  { sweep: 'tmp-sweep-quarantine-grace', normalS: 86400, pressureS: 3600 },
  { sweep: 'tmp-sweep-budget-grace', normalS: 86400, pressureS: 0 },
  { sweep: 'tmp-sweep-budget-untouched-floor', normalS: 172800, pressureS: 172800 },
  { sweep: 'tmp-sweep-live-cadence', normalS: 21600, pressureS: 0 },
  { sweep: 'tmp-sweep-test-run-quiet', normalS: 21600, pressureS: 3600 },
  { sweep: 'ws-collect-loose-floor', normalS: 172800, pressureS: 86400 },
  { sweep: 'ws-collect-witnessed-floor', normalS: 86400, pressureS: 86400 },
  { sweep: 'orphan-trees-idle', normalS: 604800, pressureS: 259200 },
  { sweep: 'orphan-trees-census-cadence', normalS: 21600, pressureS: 3600 },
];

/** `unmeasured` is not `ok`: nothing was read, so nothing is known. */
export type DiskLevel = 'ok' | 'warn' | 'critical' | 'unmeasured';

/** One filesystem the work roots live on, as the agent's `disk` op answers it. */
export interface DiskFilesystem {
  readonly dev: string;
  readonly mount: string;
  readonly fsType: string;
  /** Labels of the `DISK_WORK_ROOTS` rows on this filesystem. */
  readonly roots: readonly string[];
  readonly sizeBytes: number;
  /** Bytes a non-privileged writer can still use (`f_bavail`). */
  readonly availBytes: number;
  /** Bytes free including the reserved blocks (`f_bfree`). Used percent is computed the way `df` does:
   *  used = size - free, percent = used / (used + avail). So the server and the box's bash twins agree near 92%, where
   *  `(size - avail) / size` would read the reserved blocks as used. */
  readonly freeBytes: number;
  readonly files: number;
  readonly filesFree: number;
  readonly readOnly: boolean;
}

/** A filesystem with the level the decider holds for it. */
export interface DiskFilesystemLevel extends DiskFilesystem {
  readonly level: DiskLevel;
}

export interface DiskExpectedMount {
  readonly path: string;
  readonly mounted: boolean;
}

/** Why a work root could not be measured: `absent` is ENOENT (the root holds no bytes, so nothing is unknown);
 *  `failed` and `timeout` are unknown (the root may hold bytes nobody read). */
export type DiskMissingWhy = 'absent' | 'failed' | 'timeout';

const DISK_MISSING_WHY_MAP: Record<DiskMissingWhy, true> = { absent: true, failed: true, timeout: true };
/** Every `DiskMissingWhy`, derived from the type. */
export const DISK_MISSING_WHYS = Object.keys(DISK_MISSING_WHY_MAP) as DiskMissingWhy[];

/** THE CONTRACT the decider reads (DR-2's reply must keep it): one row per `DISK_WORK_ROOTS` label ANY of whose
 *  resolved paths could not be measured, even when its other paths were (a label such as `claude-tmp` or
 *  `config-dirs` can span devices); the worst `why` wins (`timeout` over `failed` over `absent`). A label is
 *  `absent` only when every path that failed was ENOENT. Reporting a label only when ALL its paths fail would let
 *  a critical filesystem behind a failed path read as "moved" and drop. */
export interface DiskMissingRoot {
  readonly label: string;
  readonly why: DiskMissingWhy;
}

/** What one measurement pass read, as the agent's `disk` reply carries it and the decider takes it. (The plan's
 *  DR-3 text calls this `DiskMeasure`; it means this one type.) */
export interface DiskMeasured {
  readonly filesystems: readonly DiskFilesystem[];
  readonly expectedMounts: readonly DiskExpectedMount[];
  readonly missing: readonly DiskMissingRoot[];
  /** The latest transcript-folder walk (D-7898), absent before the first one finished or from an older agent. */
  readonly transcriptWork?: TranscriptWorkMeasured;
}

/** One entry of the "who is growing" view: a named holder and the bytes it holds. */
export interface DiskHolder {
  readonly label: string;
  readonly bytes: number;
  /** Inodes the holder holds (#1411), absent from an older server or a sweep that predates the count. */
  readonly inodes?: number;
  /** True when `inodes` is a lower bound: the sweep's walk did not finish. */
  readonly inodesPartial?: true;
}

/** The orphan-worktree lane's census in the `disk` block (spec §2.3, D-6631): how many linked worktrees no registry row
 *  names, by location class, and how many of the audited ones stand at each outcome. Counts only; it names no path. */
export interface DiskOrphanTrees {
  readonly byClass: Readonly<Record<'ccd-root' | 'claude' | 'superpowers' | 'other' | 'not-a-worktree', number>>;
  readonly byOutcome: Readonly<Record<'pending' | 'would' | 'left' | 'removed', number>>;
}

/** D-7898: WORK KEPT INSIDE CLAUDE CODE'S TRANSCRIPT FOLDERS (`<config dir>/projects/<slug>/...`). Sessions sometimes
 *  write scratch repositories, reports and build output there instead of a workspace or their temp root; nothing
 *  governs those bytes, the swap carry copies them, and a transcript retention would delete them with no rescue. This
 *  vocabulary MEASURES and WARNS only: nothing here, in the agent or in doctor deletes or moves anything.
 *
 *  THE SHAPES CLAUDE CODE ITSELF WRITES, measured read-only on a fleet box on 2026-11-03 (every config dir's
 *  `projects/<slug>/` and each session directory in it): at the slug level `<uuid>.jsonl` (a transcript) and `<uuid>/`
 *  (that session's directory), and `memory` (a directory, or ccrc's link to a shared one); inside a session directory
 *  `subagents/`, `tool-results/` and `workflows/`. Everything else at either level is an entry this check counts and
 *  sizes. `<uuid>` is the lowercase 8-4-4-4-12 hex form. Doctor's bash twin (`_DR_TW_SHAPES`) is pinned equal. */
export interface TranscriptShape {
  /** `slug`: a direct entry of `projects/<slug>/`; `session`: an entry of `projects/<slug>/<uuid>/`. */
  readonly level: 'slug' | 'session';
  /** The literal name, or a pattern where `<uuid>` stands for one session id. */
  readonly name: string;
  /** The entry kinds the shape allows, from `lstat` (a link is never followed). */
  readonly kinds: readonly ('file' | 'dir' | 'link')[];
}

export const TRANSCRIPT_SHAPES: readonly TranscriptShape[] = [
  { level: 'slug', name: '<uuid>.jsonl', kinds: ['file'] },
  { level: 'slug', name: '<uuid>', kinds: ['dir'] },
  { level: 'slug', name: 'memory', kinds: ['dir', 'link'] },
  { level: 'session', name: 'subagents', kinds: ['dir'] },
  { level: 'session', name: 'tool-results', kinds: ['dir'] },
  { level: 'session', name: 'workflows', kinds: ['dir'] },
];

const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SHAPE_RES = TRANSCRIPT_SHAPES.map((s) => ({
  ...s, re: new RegExp(`^${s.name.split('<uuid>').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(UUID_SRC)}$`),
}));

/** Whether an entry is one of the shapes Claude Code writes at that level. A session directory (`<uuid>` at the slug
 *  level, a directory) is the one shape whose own entries are read in turn. */
export function isTranscriptShape(level: 'slug' | 'session', name: string, kind: 'file' | 'dir' | 'link' | 'other'): boolean {
  return SHAPE_RES.some((s) => s.level === level && s.re.test(name) && (s.kinds as readonly string[]).includes(kind));
}

/** WARN when the entries outside the shapes hold more than this many bytes in all (1 GiB). */
export const TRANSCRIPT_WORK_WARN_TOTAL_BYTES = 1024 ** 3;
/** WARN when any one entry outside the shapes holds more than this many bytes (256 MiB). */
export const TRANSCRIPT_WORK_WARN_ENTRY_BYTES = 256 * 1024 ** 2;
/** How many of the largest entries are named. */
export const TRANSCRIPT_WORK_TOP = 5;
/** The whole walk's bound. A walk that does not finish in it is unmeasured, never a count. */
export const TRANSCRIPT_WORK_DEADLINE_MS = 20_000;

/** One entry outside the shapes: `<account>/<slug>/<entry>`, or `<account>/<slug>/<uuid>/<entry>` inside a session
 *  directory, and its apparent bytes (files and links, each inode once; a directory counts 0, as `du -sb` does). */
export interface TranscriptWorkEntry {
  readonly name: string;
  readonly bytes: number;
}

/** What one walk read: a count and a size, the largest entries first (bytes, then name), or why it read nothing. A
 *  walk that failed anywhere, or ran out of time, is unmeasured as a whole: a partial count is never a count. */
export type TranscriptWorkMeasured =
  | { readonly measured: true; readonly at: number; readonly entries: number; readonly bytes: number; readonly top: readonly TranscriptWorkEntry[] }
  | { readonly measured: false; readonly at: number; readonly why: 'timeout' | 'failed' };

/** `disk.transcriptWork` on `GET /api/fleet/health`: the walk the server last received and the level its decider gave
 *  it (`server/src/disk.ts#transcriptWorkBlock`). `entries`, `bytes` and `top` are zero and empty when unmeasured. */
export interface DiskTranscriptWork {
  readonly at: number;
  readonly level: 'ok' | 'warn' | 'unmeasured';
  readonly entries: number;
  readonly bytes: number;
  readonly top: readonly TranscriptWorkEntry[];
}

/** `FleetHealth.disk`, optional on the wire (additive, no `FLEET_PROTO` bump). Read it through `readDiskHealth`. */
export interface DiskHealth {
  readonly at: number;
  readonly level: DiskLevel;
  readonly filesystems: readonly DiskFilesystemLevel[];
  readonly expectedMounts: readonly DiskExpectedMount[];
  /** Whether the fleet is in pressure mode (a filesystem is critical). */
  readonly pressure: boolean;
  readonly holders: readonly DiskHolder[];
  /** Present only once the orphan lane has read a census (D-6631); absent from an older server. */
  readonly orphanTrees?: DiskOrphanTrees;
  /** Present once a transcript-folder walk has reached the server (D-7898); absent from an older server or agent. */
  readonly transcriptWork?: DiskTranscriptWork;
}

const DISK_LEVEL_MAP: Record<DiskLevel, true> = { ok: true, warn: true, critical: true, unmeasured: true };
/** Every `DiskLevel`, derived from the type (a member added to the union is a compile error until it is here). */
export const DISK_LEVELS = Object.keys(DISK_LEVEL_MAP) as DiskLevel[];
const LEVELS: readonly string[] = DISK_LEVELS;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function readFilesystem(v: unknown): DiskFilesystemLevel | null {
  if (!isObj(v)) return null;
  const dev = str(v['dev']);
  const mount = str(v['mount']);
  const fsType = str(v['fsType']);
  const level = str(v['level']);
  const sizeBytes = num(v['sizeBytes']);
  const availBytes = num(v['availBytes']);
  const freeBytes = num(v['freeBytes']);
  const files = num(v['files']);
  const filesFree = num(v['filesFree']);
  const roots = v['roots'];
  if (dev === null || mount === null || fsType === null || level === null || !LEVELS.includes(level)) return null;
  if (sizeBytes === null || availBytes === null || freeBytes === null || files === null || filesFree === null) return null;
  if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) return null;
  if (typeof v['readOnly'] !== 'boolean') return null;
  return {
    dev, mount, fsType, roots: roots as string[], sizeBytes, availBytes, freeBytes, files, filesFree,
    readOnly: v['readOnly'], level: level as DiskLevel,
  };
}

function readMeasuredFilesystem(v: unknown): DiskFilesystem | null {
  if (!isObj(v)) return null;
  const dev = str(v['dev']);
  const mount = str(v['mount']);
  const fsType = str(v['fsType']);
  const sizeBytes = num(v['sizeBytes']);
  const availBytes = num(v['availBytes']);
  const freeBytes = num(v['freeBytes']);
  const files = num(v['files']);
  const filesFree = num(v['filesFree']);
  const roots = v['roots'];
  if (dev === null || mount === null || fsType === null) return null;
  if (sizeBytes === null || availBytes === null || freeBytes === null || files === null || filesFree === null) return null;
  if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) return null;
  if (typeof v['readOnly'] !== 'boolean') return null;
  return { dev, mount, fsType, roots: roots as string[], sizeBytes, availBytes, freeBytes, files, filesFree, readOnly: v['readOnly'] };
}

/** THE ONE READER of the agent's `disk` reply (a wire boundary: validated, never trusted): the measurement, or `null`
 *  when ANY element is malformed. A half-formed reply is unknown, never a measurement the decider could fold to `ok`. */
export function readDiskMeasured(x: unknown): DiskMeasured | null {
  if (!isObj(x)) return null;
  const { filesystems: fsRaw, expectedMounts: emRaw, missing: missRaw } = x;
  if (!Array.isArray(fsRaw) || !Array.isArray(emRaw) || !Array.isArray(missRaw)) return null;
  const filesystems: DiskFilesystem[] = [];
  for (const f of fsRaw) {
    const r = readMeasuredFilesystem(f);
    if (r === null) return null;
    filesystems.push(r);
  }
  const expectedMounts: DiskExpectedMount[] = [];
  for (const m of emRaw) {
    if (!isObj(m) || typeof m['path'] !== 'string' || typeof m['mounted'] !== 'boolean') return null;
    expectedMounts.push({ path: m['path'], mounted: m['mounted'] });
  }
  const missing: DiskMissingRoot[] = [];
  for (const m of missRaw) {
    if (!isObj(m) || typeof m['label'] !== 'string' || typeof m['why'] !== 'string') return null;
    if (!(DISK_MISSING_WHYS as string[]).includes(m['why'])) return null;
    missing.push({ label: m['label'], why: m['why'] as DiskMissingWhy });
  }
  const transcriptWork = readTranscriptWorkMeasured(x['transcriptWork']);
  return { filesystems, expectedMounts, missing, ...(transcriptWork === undefined ? {} : { transcriptWork }) };
}

const int = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) ? n : null;
};

/** The top list, or null when any element is malformed or it is longer than `TRANSCRIPT_WORK_TOP`. */
function readTop(v: unknown): TranscriptWorkEntry[] | null {
  if (!Array.isArray(v) || v.length > TRANSCRIPT_WORK_TOP) return null;
  const out: TranscriptWorkEntry[] = [];
  for (const e of v) {
    const bytes = isObj(e) ? int(e['bytes']) : null;
    if (!isObj(e) || typeof e['name'] !== 'string' || bytes === null) return null;
    out.push({ name: e['name'], bytes });
  }
  return out;
}

/** The agent's walk inside the `disk` reply (D-7898), or `undefined` when it is absent or malformed. A malformed one drops
 *  ALONE: the filesystems still read, and the walk reads as not yet known, never as zero. */
export function readTranscriptWorkMeasured(v: unknown): TranscriptWorkMeasured | undefined {
  if (!isObj(v)) return undefined;
  const at = int(v['at']);
  if (at === null) return undefined;
  if (v['measured'] === false) {
    return v['why'] === 'timeout' || v['why'] === 'failed' ? { measured: false, at, why: v['why'] } : undefined;
  }
  if (v['measured'] !== true) return undefined;
  const entries = int(v['entries']);
  const bytes = int(v['bytes']);
  const top = readTop(v['top']);
  if (entries === null || bytes === null || top === null || top.length > entries) return undefined;
  return { measured: true, at, entries, bytes, top };
}

/** `disk.transcriptWork` on the health block, or `undefined` when absent or malformed (dropped alone). */
function readDiskTranscriptWork(v: unknown): DiskTranscriptWork | undefined {
  if (!isObj(v)) return undefined;
  const at = int(v['at']);
  const level = v['level'];
  const entries = int(v['entries']);
  const bytes = int(v['bytes']);
  const top = readTop(v['top']);
  if (at === null || entries === null || bytes === null || top === null) return undefined;
  if (level !== 'ok' && level !== 'warn' && level !== 'unmeasured') return undefined;
  return { at, level, entries, bytes, top };
}

const CLASS_KEYS = ['ccd-root', 'claude', 'superpowers', 'other', 'not-a-worktree'] as const;
const OUTCOME_KEYS = ['pending', 'would', 'left', 'removed'] as const;
function countsOf<K extends string>(v: unknown, keys: readonly K[]): Record<K, number> | null {
  if (!isObj(v)) return null;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    const n = num(v[k]);
    if (n === null || !Number.isInteger(n)) return null;
    out[k] = n;
  }
  return out;
}
/** The orphan block, or `undefined` when it is absent or malformed. A malformed one drops ALONE: the rest of the block
 *  still reads, and the lane's counts read as unknown, never as zero. */
function readOrphanTrees(v: unknown): DiskOrphanTrees | undefined {
  if (!isObj(v)) return undefined;
  const byClass = countsOf(v['byClass'], CLASS_KEYS);
  const byOutcome = countsOf(v['byOutcome'], OUTCOME_KEYS);
  return byClass === null || byOutcome === null ? undefined : { byClass, byOutcome };
}

/** THE ONE READER of `FleetHealth.disk`: the block, or `null`. Absent (an older server, or no pass yet) and malformed
 *  alike read as `null`, and `null` is UNKNOWN, never "the disk is fine". `holders` is optional inside the block (an
 *  older server omits it) and reads as none. */
export function readDiskHealth(x: unknown): DiskHealth | null {
  if (!isObj(x)) return null;
  const v = x['disk'];
  if (!isObj(v)) return null;
  const at = num(v['at']);
  const level = str(v['level']);
  if (at === null || level === null || !LEVELS.includes(level)) return null;
  if (typeof v['pressure'] !== 'boolean') return null;
  if (!Array.isArray(v['filesystems']) || !Array.isArray(v['expectedMounts'])) return null;
  const filesystems: DiskFilesystemLevel[] = [];
  for (const f of v['filesystems']) {
    const r = readFilesystem(f);
    if (r === null) return null;
    filesystems.push(r);
  }
  const expectedMounts: DiskExpectedMount[] = [];
  for (const m of v['expectedMounts']) {
    if (!isObj(m) || typeof m['path'] !== 'string' || typeof m['mounted'] !== 'boolean') return null;
    expectedMounts.push({ path: m['path'], mounted: m['mounted'] });
  }
  const holders: DiskHolder[] = [];
  if (v['holders'] !== undefined) {
    if (!Array.isArray(v['holders'])) return null;
    for (const h of v['holders']) {
      const bytes = isObj(h) ? num(h['bytes']) : null;
      if (!isObj(h) || typeof h['label'] !== 'string' || bytes === null) return null;
      const inodes = h['inodes'] === undefined ? null : num(h['inodes']);
      if (h['inodes'] !== undefined && inodes === null) return null;
      holders.push({ label: h['label'], bytes, ...(inodes === null ? {} : { inodes }), ...(h['inodesPartial'] === true ? { inodesPartial: true as const } : {}) });
    }
  }
  const orphanTrees = readOrphanTrees(v['orphanTrees']);
  const transcriptWork = readDiskTranscriptWork(v['transcriptWork']);
  return {
    at, level: level as DiskLevel, filesystems, expectedMounts, pressure: v['pressure'], holders,
    ...(orphanTrees === undefined ? {} : { orphanTrees }),
    ...(transcriptWork === undefined ? {} : { transcriptWork }),
  };
}
