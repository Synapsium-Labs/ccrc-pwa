// D-7858 (plan docs/superpowers/plans/2026-11-03-backup-health.md). L0: imports NOTHING (the PWA bundles this file).
// ONE VOCABULARY for the fleet box's backup health: the five state files a box-side backup job writes, the line they
// hold, what the agent's `backup` op answers (`BackupRead`), the pure decider over it (`backupVerdict`) and the shape
// `GET /api/fleet/health` carries in its optional `backup` block (`BackupHealth`), each with its one reader.
//
// THE FILES. A backup job outside ccrc keeps one line per file in one directory, named by deployment config (never a
// path in this tree): `<ISO-8601>Z k=v ... free words`. A key this file does not know is kept and ignored, and the
// words that are not `k=v` are the note (a failed run's step, a warning's reason). `last-success` is the last run that
// wrote a backup; `last-failure`, `last-skip` and `last-warning` the last run of each kind; `stale` a marker the job
// writes when its own last success is too old. A file that is absent is a run that never happened, never a fault.
//
// THE PRECEDENCE (`backupVerdict`): stale > failed > warning > ok. Stale is the stale marker newer than the last
// success, or no success at all, or a last success older than the configured hours; failed is a last failure newer
// than the last success; warning a last warning newer than the last success. A skip changes no status by itself: a run
// of skips ends as stale.

/** The five state files, by name inside the configured directory. Derived lists read this one. */
export const BACKUP_FILES = ['last-success', 'last-failure', 'last-skip', 'last-warning', 'stale'] as const;
export type BackupFile = (typeof BACKUP_FILES)[number];

/** The most of one file the reader reads: a state file is one short line. Past this the line is cut, never streamed. */
export const BACKUP_FILE_MAX_BYTES = 4096;

/** `CCRC_BACKUP_STALE_HOURS`' default: a nightly job that misses one night is not yet stale, two nights are. */
export const BACKUP_STALE_HOURS_DEFAULT = 36;
/** The most hours the setting may name (a year); a larger value reads as the default. */
export const BACKUP_STALE_HOURS_MAX = 8760;

/** Why the files could not be read: `denied` is EACCES or EPERM (the box step that makes them readable is not done);
 *  `no-directory` the configured directory missing; `not-absolute` a relative setting; `malformed` a present file whose
 *  line is in no shape this file knows; `failed` any other fault (not a directory, a symlink, an I/O error). */
export type BackupUnreadableWhy = 'denied' | 'no-directory' | 'not-absolute' | 'malformed' | 'failed';
const BACKUP_UNREADABLE_MAP: Record<BackupUnreadableWhy, true> = {
  denied: true, 'no-directory': true, 'not-absolute': true, malformed: true, failed: true,
};
/** Every `BackupUnreadableWhy`, derived from the type. */
export const BACKUP_UNREADABLE_WHYS = Object.keys(BACKUP_UNREADABLE_MAP) as BackupUnreadableWhy[];

/** What the agent's `backup` op read (and the local adapter, the same body): nothing configured, a fault, or the first
 *  line of each present file (an absent file has no key). It decides nothing. */
export type BackupRead =
  | { readonly state: 'not-configured' }
  | { readonly state: 'unreadable'; readonly why: BackupUnreadableWhy }
  | { readonly state: 'read'; readonly files: Readonly<Partial<Record<BackupFile, string>>> };

/** One parsed line: its time (epoch ms), its `k=v` pairs (the first of a repeated key wins) and the other words. */
export interface BackupLine {
  readonly at: number;
  readonly kv: Readonly<Record<string, string>>;
  readonly note: string;
}

const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const KV = /^([A-Za-z][A-Za-z0-9_.-]*)=(.*)$/;

/** One state file's line, or `null` when its first word is not a UTC ISO-8601 time. Only the first line counts. */
export function parseBackupLine(text: string): BackupLine | null {
  const line = text.split('\n', 1)[0]!.trim();
  const words = line.split(/\s+/).filter((w) => w !== '');
  const first = words[0];
  if (first === undefined || !ISO_Z.test(first)) return null;
  const at = Date.parse(first);
  if (!Number.isFinite(at)) return null;
  const kv: Record<string, string> = {};
  const note: string[] = [];
  for (const w of words.slice(1)) {
    const m = KV.exec(w);
    if (m === null) note.push(w);
    else if (!Object.prototype.hasOwnProperty.call(kv, m[1]!)) kv[m[1]!] = m[2]!;
  }
  return { at, kv, note: note.join(' ') };
}

export type BackupStatus = 'not-configured' | 'unreadable' | 'ok' | 'warning' | 'failed' | 'stale';
const BACKUP_STATUS_MAP: Record<BackupStatus, true> = {
  'not-configured': true, unreadable: true, ok: true, warning: true, failed: true, stale: true,
};
/** Every `BackupStatus`, derived from the type (a member added to the union is a compile error until it is here). */
export const BACKUP_STATUSES = Object.keys(BACKUP_STATUS_MAP) as BackupStatus[];

/** A run of one kind: when, its `exit=` as a whole number (or `null` when the line names none) and its note. */
export interface BackupEvent {
  readonly at: number;
  readonly exit: number | null;
  readonly note: string;
}

/** `FleetHealth.backup`, optional on the wire (additive, no `FLEET_PROTO` bump). Read it through `readBackupHealth`. */
export interface BackupHealth {
  /** Epoch ms the files were read. */
  readonly at: number;
  readonly status: BackupStatus;
  /** Present only when `status` is `unreadable`. */
  readonly unreadable?: BackupUnreadableWhy;
  readonly lastSuccessAt: number | null;
  readonly lastFailure: BackupEvent | null;
  readonly lastSkip: BackupEvent | null;
  readonly lastWarning: BackupEvent | null;
  /** Present when `status` is `stale`: when it was judged stale (the marker's time, else the read's) and the hours
   *  since the last success, `null` when there is none. */
  readonly stale: { readonly at: number; readonly ageH: number | null } | null;
  /** The hours the server judged staleness by. */
  readonly staleHours: number;
}

const HOUR_MS = 3_600_000;

/** `CCRC_BACKUP_STALE_HOURS` read: a whole number from 1 to `BACKUP_STALE_HOURS_MAX`, else the default (unset, a bare
 *  line, or any other value). */
export function backupStaleHoursOf(raw: string | undefined): number {
  const t = (raw ?? '').trim();
  if (!/^\d+$/.test(t)) return BACKUP_STALE_HOURS_DEFAULT;
  const n = Number(t);
  return n >= 1 && n <= BACKUP_STALE_HOURS_MAX ? n : BACKUP_STALE_HOURS_DEFAULT;
}

const exitOf = (l: BackupLine): number | null => {
  const e = l.kv['exit'];
  return e !== undefined && /^\d+$/.test(e) ? Number(e) : null;
};
const eventOf = (l: BackupLine | null): BackupEvent | null => (l === null ? null : { at: l.at, exit: exitOf(l), note: l.note });

const EMPTY = { lastSuccessAt: null, lastFailure: null, lastSkip: null, lastWarning: null, stale: null } as const;

/** THE DECIDER: what one read says about the backup at `now`, judged against `staleHours`. Pure. */
export function backupVerdict(read: BackupRead, readAt: number, now: number, staleHours: number): BackupHealth {
  if (read.state === 'not-configured') return { at: readAt, status: 'not-configured', ...EMPTY, staleHours };
  if (read.state === 'unreadable') return { at: readAt, status: 'unreadable', unreadable: read.why, ...EMPTY, staleHours };
  const lines: Partial<Record<BackupFile, BackupLine>> = {};
  for (const f of BACKUP_FILES) {
    const text = read.files[f];
    if (text === undefined) continue;
    const l = parseBackupLine(text);
    if (l === null) return { at: readAt, status: 'unreadable', unreadable: 'malformed', ...EMPTY, staleHours };
    lines[f] = l;
  }
  const success = lines['last-success'] ?? null;
  const lastSuccessAt = success?.at ?? null;
  const newer = (l: BackupLine | undefined): boolean => l !== undefined && (lastSuccessAt === null || l.at > lastSuccessAt);
  const ageH = lastSuccessAt === null ? null : Math.max(0, Math.floor((now - lastSuccessAt) / HOUR_MS));
  const staleMarker = lines['stale'];
  const staleByMarker = newer(staleMarker);
  const staleByAge = lastSuccessAt === null || now - lastSuccessAt > staleHours * HOUR_MS;
  const status: BackupStatus = staleByMarker || staleByAge ? 'stale'
    : newer(lines['last-failure']) ? 'failed'
      : newer(lines['last-warning']) ? 'warning' : 'ok';
  return {
    at: readAt, status, lastSuccessAt,
    lastFailure: eventOf(lines['last-failure'] ?? null),
    lastSkip: eventOf(lines['last-skip'] ?? null),
    lastWarning: eventOf(lines['last-warning'] ?? null),
    stale: status === 'stale' ? { at: staleByMarker ? staleMarker!.at : readAt, ageH } : null,
    staleHours,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const time = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** THE ONE READER of the agent's `backup` reply (a wire boundary: validated, never trusted): the read, or `null` when
 *  it is in no shape this file knows. A file's text longer than `BACKUP_FILE_MAX_BYTES` characters is refused too. */
export function readBackupRead(x: unknown): BackupRead | null {
  if (!isObj(x)) return null;
  const state = x['state'];
  if (state === 'not-configured') return { state };
  if (state === 'unreadable') {
    const why = x['why'];
    return typeof why === 'string' && (BACKUP_UNREADABLE_WHYS as string[]).includes(why)
      ? { state, why: why as BackupUnreadableWhy } : null;
  }
  if (state !== 'read' || !isObj(x['files'])) return null;
  const raw = x['files'];
  const files: Partial<Record<BackupFile, string>> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!(BACKUP_FILES as readonly string[]).includes(k)) return null;
    if (typeof v !== 'string' || v.length > BACKUP_FILE_MAX_BYTES) return null;
    files[k as BackupFile] = v;
  }
  return { state, files };
}

function readEvent(v: unknown): BackupEvent | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const at = time(v['at']);
  const exit = v['exit'] === null ? null : typeof v['exit'] === 'number' && Number.isSafeInteger(v['exit']) ? v['exit'] : undefined;
  if (at === null || exit === undefined || typeof v['note'] !== 'string') return undefined;
  return { at, exit, note: v['note'] };
}

/** THE ONE READER of `FleetHealth.backup`: the block, or `null`. Absent (an older server, or no read yet) and malformed
 *  alike read as `null`, which is UNKNOWN: never "the backup is fine" and never an alarm. */
export function readBackupHealth(x: unknown): BackupHealth | null {
  if (!isObj(x)) return null;
  const v = x['backup'];
  if (!isObj(v)) return null;
  const at = time(v['at']);
  const status = v['status'];
  const staleHours = v['staleHours'];
  if (at === null || typeof status !== 'string' || !(BACKUP_STATUSES as string[]).includes(status)) return null;
  if (typeof staleHours !== 'number' || !Number.isSafeInteger(staleHours) || staleHours < 1) return null;
  const lastSuccessAt = v['lastSuccessAt'] === null ? null : time(v['lastSuccessAt']);
  if (v['lastSuccessAt'] !== null && lastSuccessAt === null) return null;
  const lastFailure = readEvent(v['lastFailure']);
  const lastSkip = readEvent(v['lastSkip']);
  const lastWarning = readEvent(v['lastWarning']);
  if (lastFailure === undefined || lastSkip === undefined || lastWarning === undefined) return null;
  let stale: BackupHealth['stale'] = null;
  if (v['stale'] !== null) {
    const s = v['stale'];
    if (!isObj(s)) return null;
    const sAt = time(s['at']);
    const ageH = s['ageH'] === null ? null : time(s['ageH']);
    if (sAt === null || (s['ageH'] !== null && ageH === null)) return null;
    stale = { at: sAt, ageH };
  }
  if ((status === 'stale') !== (stale !== null)) return null;
  let unreadable: BackupUnreadableWhy | undefined;
  if (status === 'unreadable') {
    const w = v['unreadable'];
    if (typeof w !== 'string' || !(BACKUP_UNREADABLE_WHYS as string[]).includes(w)) return null;
    unreadable = w as BackupUnreadableWhy;
  }
  return {
    at, status: status as BackupStatus, ...(unreadable === undefined ? {} : { unreadable }),
    lastSuccessAt, lastFailure, lastSkip, lastWarning, stale, staleHours,
  };
}
