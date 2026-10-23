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
  readonly availBytes: number;
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
  const files = num(v['files']);
  const filesFree = num(v['filesFree']);
  const roots = v['roots'];
  if (dev === null || mount === null || fsType === null || level === null || !LEVELS.includes(level)) return null;
  if (sizeBytes === null || availBytes === null || files === null || filesFree === null) return null;
  if (!Array.isArray(roots) || !roots.every((r) => typeof r === 'string')) return null;
  if (typeof v['readOnly'] !== 'boolean') return null;
  return {
    dev, mount, fsType, roots: roots as string[], sizeBytes, availBytes, files, filesFree,
    readOnly: v['readOnly'], level: level as DiskLevel,
  };
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
