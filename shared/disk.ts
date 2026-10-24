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
}

/** One entry of the "who is growing" view: a named holder and the bytes it holds. */
export interface DiskHolder {
  readonly label: string;
  readonly bytes: number;
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
  return { filesystems, expectedMounts, missing };
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
      holders.push({ label: h['label'], bytes });
    }
  }
  return { at, level: level as DiskLevel, filesystems, expectedMounts, pressure: v['pressure'], holders };
}
