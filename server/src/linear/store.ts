/**
 * The Linear slot store (#1444, spec 2026-10-31 §3): ONE KEY PER LINEAR WORKSPACE, under `~/.ccrc/linear/`.
 *
 * L3 ADAPTER. Each workspace has one slot, named by the workspace's id (a UUID, checked before it becomes a file
 * name): `<id>.key` holds the key, one line, 0600, and `<id>.json` its version 2 display record
 * (`parseLinearStoreRecord`, `shared/linear.ts`). Only a `.key` makes a slot. A `.key` with no `.json` is a slot whose
 * record is `absent` (details unknown, as today). A `.json` with no `.key` is no slot: it is shown nowhere, and the
 * next locked write in the directory deletes it, which is how a crash between a remove's two deletions finishes.
 *
 * THE LEGACY PAIR IS READ, NEVER WRITTEN. `linear.key` and its v1 `linear.json` stay exactly as on `main`, written
 * only by `main`'s four `/api/linear/connection` routes. `readLinearStore` answers the pair, read-only, as one more
 * slot (`source: 'legacy'`), and what the legacy key's Check again learns beyond the v1 record (its workspace and
 * teams) lives in `legacy-teams.json` here, honoured only while its digest is the present `linear.key`'s. Nothing in
 * this file writes, removes or copies the pair.
 *
 * NO KEY IS HELD. A list carries each key's read kind and digest, never the key. `readLinearSlotKey` reads the file
 * at the moment it is called, every time, so a remove or a replace is seen by the next read.
 *
 * ONE SET OF RULES. Every write reuses `connection.ts`'s target helpers (the key written first and removed first; a
 * check recorded only while the key has the checked digest; a verdict cleared only for that key) and runs under its
 * one lock, `withConnectionLock`, held for file work only. No function here calls Linear.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  isLinearKeyShape, isLinearStoredName, isLinearUrlKey, isLinearUuid, parseLinearStoreRecord, parseLinearTeams,
  type LinearCheckOutcome, type LinearConnectionView, type LinearDetailsRead, type LinearStoreRecord, type LinearTeam,
} from '../../../shared/linear.js';
import { valueDigestHex, writeValueFileAtomic } from '../token/files.js';
import {
  clearLinearVerdictAt, keyTailOf, readLinearDetails, readLinearKey, readLinearKeyFile, readLinearRecord,
  recordLinearCheckAt, removeLinearKeyAndRecord, withConnectionLock, writeLinearKeyAndRecord,
  type LinearKeyRead, type LinearRecordRead, type LinearRecordTarget,
} from './connection.js';
import { linearConnectionView } from './view.js';

/** The store's directory inside the ccrc dir. */
export const LINEAR_STORE_DIR = 'linear';
/** What the legacy key's Check again learned. Never a slot and never a key; its stem is not a UUID, so it is never
 *  listed and never swept. */
export const LEGACY_TEAMS_FILE = 'legacy-teams.json';

export function linearStoreDir(ccrcDir: string): string {
  return path.join(ccrcDir, LINEAR_STORE_DIR);
}
const legacyTeamsPath = (ccrcDir: string): string => path.join(linearStoreDir(ccrcDir), LEGACY_TEAMS_FILE);

/** Which slot a key read names: the legacy pair, or one workspace's file slot. */
export type LinearSlotRef = { source: 'legacy' } | { source: 'file'; id: string };
export const LEGACY_SLOT: LinearSlotRef = { source: 'legacy' };

/** `LinearKeyRead` with the key replaced by its digest; every other kind kept as read, `unreadable`'s code included. */
export type LinearKeyMeasure =
  | { kind: 'key'; digest: string }
  | { kind: 'absent' }
  | { kind: 'unusable' }
  | { kind: 'placeholder' }
  | { kind: 'unreadable'; code: string };

export function measureLinearKey(k: LinearKeyRead): LinearKeyMeasure {
  return k.kind === 'key' ? { kind: 'key', digest: valueDigestHex(k.key) } : k;
}

export interface LinearFileSlot {
  source: 'file';
  id: string;
  key: LinearKeyMeasure;
  record: LinearRecordRead<LinearStoreRecord>;
}

/** `legacy-teams.json`: the workspace the legacy key's Check again learned, for the key whose digest it names. */
export interface LegacyTeams {
  keyDigest: string;
  workspaceId: string;
  name: string;
  urlKey: string;
  teams: LinearTeam[];
  teamsAt: number;
}

/** How `legacy-teams.json` read: `matched` (it describes the present `linear.key`), `stale` (it describes another
 *  key), or why there is nothing to honour. Every arm but `matched` leaves the legacy slot unlearned. */
export type LegacyTeamsRead = 'matched' | 'absent' | 'stale' | 'malformed' | 'unreadable';

export interface LinearLegacySlot {
  source: 'legacy';
  key: LinearKeyMeasure;
  details: LinearDetailsRead;
  /** Today's view of the pair, `linearConnectionView` exactly. */
  view: LinearConnectionView;
  teamsFile: LegacyTeamsRead;
  /** What its Check again learned, while that describes the present key; else null (not yet learned). */
  workspace: LegacyTeams | null;
  /** True while a file slot holds the same workspace: the file slot wins, and the legacy row says so. */
  superseded: boolean;
}

export type LinearStoreRead =
  | { kind: 'listed'; slots: LinearFileSlot[]; legacy: LinearLegacySlot | null }
  | { kind: 'unreadable'; code: string };

/** What an `ok` key check learned about the workspace, its names already cleaned. */
export interface LinearLearned {
  name: string;
  urlKey: string;
  user: string;
  teams: LinearTeam[];
  teamsAt: number;
}

export type PutSlotResult = 'added' | 'replaced' | 'exists';

const errnoOf = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';
const SLOT_KEY = /^(.+)\.key$/;
const SLOT_RECORD = /^(.+)\.json$/;

const recordText = (r: LinearStoreRecord): string => `${JSON.stringify({
  v: 2, workspaceId: r.workspaceId, name: r.name, urlKey: r.urlKey, user: r.user,
  teams: r.teams.map((t) => ({ id: t.id, key: t.key, name: t.name })), teamsAt: r.teamsAt,
  keyTail: r.keyTail, keyDigest: r.keyDigest, checkedAt: r.checkedAt, outcome: r.outcome,
})}\n`;

/** One slot's files, for `connection.ts`'s helpers. A record whose `workspaceId` is not its file's is no record of
 *  this slot. Throws on an id that is not a workspace id: no such id ever becomes a path. */
function slotTarget(ccrcDir: string, id: string): LinearRecordTarget<LinearStoreRecord> {
  if (!isLinearUuid(id)) throw new Error('linear store: not a workspace id');
  const dir = linearStoreDir(ccrcDir);
  return {
    keyPath: path.join(dir, `${id}.key`),
    recordPath: path.join(dir, `${id}.json`),
    parse: (raw) => {
      const r = parseLinearStoreRecord(raw);
      return r !== null && r.workspaceId === id ? r : null;
    },
    text: recordText,
  };
}

/** Throws unless `r` is a record the store's own parser reads back as `r`: nothing is written that reads malformed. */
function assertWritable(t: LinearRecordTarget<LinearStoreRecord>, r: LinearStoreRecord): void {
  const back = t.parse(t.text(r));
  if (back === null || t.text(back) !== t.text(r)) throw new Error('linear store: record out of its grammar');
}

const isEnoent = (e: unknown): boolean => errnoOf(e) === 'ENOENT';
async function exists(p: string): Promise<boolean> {
  try { await fsp.lstat(p); return true; } catch (e) { if (isEnoent(e)) return false; throw e; }
}

/** Deletes every `<id>.json` whose `<id>.key` is gone. Only a UUID stem is a slot's, so `legacy-teams.json` and any
 *  other file stay. A missing directory has nothing to sweep. Call inside the lock. */
async function sweepOrphans(ccrcDir: string): Promise<void> {
  const dir = linearStoreDir(ccrcDir);
  let names: string[];
  try { names = await fsp.readdir(dir); } catch (e) { if (isEnoent(e)) return; throw e; }
  const keys = new Set(names);
  for (const n of names) {
    const id = SLOT_RECORD.exec(n)?.[1];
    if (id === undefined || !isLinearUuid(id) || keys.has(`${id}.key`)) continue;
    await fsp.rm(path.join(dir, n), { force: true });
  }
}

/** Every write in the directory: under the one lock, the orphan sweep first. */
function lockedWrite<T>(ccrcDir: string, fn: () => Promise<T>): Promise<T> {
  return withConnectionLock(ccrcDir, async () => {
    await sweepOrphans(ccrcDir);
    return fn();
  });
}

/** The directory, created 0700 by the store's first write; the files inside are 0600 from birth. */
const makeStoreDir = (ccrcDir: string): Promise<string | undefined> =>
  fsp.mkdir(linearStoreDir(ccrcDir), { recursive: true, mode: 0o700 });

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Lists the slots and reads the legacy pair as one more. A missing directory is an empty list; a directory that
 *  cannot be listed is `unreadable` with its code. Never rejects. */
export async function readLinearStore(ccrcDir: string): Promise<LinearStoreRead> {
  let names: string[];
  try {
    names = await fsp.readdir(linearStoreDir(ccrcDir));
  } catch (e) {
    if (!isEnoent(e)) return { kind: 'unreadable', code: errnoOf(e) };
    names = [];
  }
  const ids = names.flatMap((n) => {
    const id = SLOT_KEY.exec(n)?.[1];
    return id !== undefined && isLinearUuid(id) ? [id] : [];
  }).sort();
  const slots = await Promise.all(ids.map(async (id): Promise<LinearFileSlot> => {
    const t = slotTarget(ccrcDir, id);
    const [key, record] = await Promise.all([readLinearKeyFile(t.keyPath), readLinearRecord(t)]);
    return { source: 'file', id, key: measureLinearKey(key), record };
  }));
  return { kind: 'listed', slots, legacy: await readLegacySlot(ccrcDir, new Set(ids)) };
}

async function readLegacySlot(ccrcDir: string, slotIds: ReadonlySet<string>): Promise<LinearLegacySlot | null> {
  const [k, details] = await Promise.all([readLinearKey(ccrcDir), readLinearDetails(ccrcDir)]);
  if (k.kind === 'absent') return null;
  const key = measureLinearKey(k);
  const teams = await readLegacyTeams(ccrcDir, key);
  const workspace = teams.kind === 'matched' ? teams.teams : null;
  return {
    source: 'legacy', key, details, view: linearConnectionView(key, details),
    teamsFile: teams.kind, workspace, superseded: workspace !== null && slotIds.has(workspace.workspaceId),
  };
}

async function readLegacyTeams(
  ccrcDir: string, key: LinearKeyMeasure,
): Promise<{ kind: 'matched'; teams: LegacyTeams } | { kind: Exclude<LegacyTeamsRead, 'matched'> }> {
  let raw: string;
  try {
    raw = await fsp.readFile(legacyTeamsPath(ccrcDir), 'utf8');
  } catch (e) {
    return { kind: isEnoent(e) ? 'absent' : 'unreadable' };
  }
  const teams = parseLegacyTeams(raw);
  if (teams === null) return { kind: 'malformed' };
  return key.kind === 'key' && key.digest === teams.keyDigest ? { kind: 'matched', teams } : { kind: 'stale' };
}

/** Reads one slot's key at the moment it is needed; for the legacy slot, `readLinearKey` unchanged. An id that is
 *  not a workspace id names no file, so it reads `absent`. Never rejects, and nothing keeps what it read. */
export function readLinearSlotKey(ccrcDir: string, slot: LinearSlotRef): Promise<LinearKeyRead> {
  if (slot.source === 'legacy') return readLinearKey(ccrcDir);
  if (!isLinearUuid(slot.id)) return Promise.resolve({ kind: 'absent' });
  return readLinearKeyFile(slotTarget(ccrcDir, slot.id).keyPath);
}

// ---------------------------------------------------------------------------
// Writing, one slot at a time
// ---------------------------------------------------------------------------

/**
 * Add or replace: the key FIRST, then its record (`writeLinearKeyAndRecord`). The slot is the record's workspace.
 * With `replace: false`, a workspace that already has a slot (its `.key` exists) answers `exists` and nothing is
 * touched; the test and the write are one locked act. Throws, writing nothing, when the key fails its shape, or the
 * record does not describe this key (its digest and tail), or is not one the store's parser reads back.
 */
export async function putLinearSlot(
  ccrcDir: string, key: string, record: LinearStoreRecord, opts: { replace: boolean },
): Promise<PutSlotResult> {
  const t = slotTarget(ccrcDir, record.workspaceId);
  if (!isLinearKeyShape(key)) throw new Error('linear store: not a key');
  if (record.keyDigest !== valueDigestHex(key) || record.keyTail !== keyTailOf(key)) {
    throw new Error('linear store: the record describes another key');
  }
  assertWritable(t, record);
  return lockedWrite(ccrcDir, async () => {
    const had = await exists(t.keyPath);
    if (had && !opts.replace) return 'exists';
    await makeStoreDir(ccrcDir);
    await writeLinearKeyAndRecord(t, key, record);
    return had ? 'replaced' : 'added';
  });
}

/**
 * Record what a check of the slot key whose digest is `digest` found, by `recordLinearCheckAt`'s rule: ONLY while the
 * slot's key still has that digest. `learned` is what an `ok` check learned; any other outcome keeps what a record of
 * this same key had learned, and a slot with no such record gets a full record with nothing learned. Answers whether
 * it wrote.
 */
export async function recordLinearSlotCheck(
  ccrcDir: string, id: string, digest: string, outcome: LinearCheckOutcome, learned: LinearLearned | null, now: number,
): Promise<boolean> {
  const t = slotTarget(ccrcDir, id);
  return lockedWrite(ccrcDir, () => recordLinearCheckAt(t, digest, (key, same) => {
    const from = learned ?? same;
    const r: LinearStoreRecord = {
      workspaceId: id, name: from?.name ?? null, urlKey: from?.urlKey ?? null, user: from?.user ?? null,
      teams: from?.teams ?? [], teamsAt: from?.teamsAt ?? null,
      keyTail: keyTailOf(key), keyDigest: digest, checkedAt: now, outcome,
    };
    assertWritable(t, r);
    return r;
  }));
}

/** A Linear 401 for the slot key whose digest is `usedDigest` marks that slot rejected, and only that slot, by
 *  `recordLinearSlotCheck`'s rule. Answers whether it wrote. */
export async function markLinearSlotRejected(ccrcDir: string, id: string, usedDigest: string, now: number): Promise<boolean> {
  return recordLinearSlotCheck(ccrcDir, id, usedDigest, 'rejected', null, now);
}

/** A success with the slot key whose digest is `usedDigest` clears that slot's stale `rejected` or `forbidden`
 *  verdict, by `clearLinearVerdictAt`'s rule. Answers whether it wrote. */
export async function clearLinearSlotVerdict(ccrcDir: string, id: string, usedDigest: string, now: number): Promise<boolean> {
  const t = slotTarget(ccrcDir, id);
  return lockedWrite(ccrcDir, () => clearLinearVerdictAt(t, usedDigest, now));
}

/** Remove: the key FIRST, then the record (`removeLinearKeyAndRecord`). A slot that is not there is a success. */
export async function removeLinearSlot(ccrcDir: string, id: string): Promise<void> {
  const t = slotTarget(ccrcDir, id);
  return lockedWrite(ccrcDir, () => removeLinearKeyAndRecord(t));
}

// ---------------------------------------------------------------------------
// legacy-teams.json
// ---------------------------------------------------------------------------

const LEGACY_TEAMS_FIELDS = ['v', 'keyDigest', 'workspaceId', 'name', 'urlKey', 'teams', 'teamsAt'] as const;

const legacyTeamsText = (t: LegacyTeams): string => `${JSON.stringify({
  v: 1, keyDigest: t.keyDigest, workspaceId: t.workspaceId, name: t.name, urlKey: t.urlKey,
  teams: t.teams.map((x) => ({ id: x.id, key: x.key, name: x.name })), teamsAt: t.teamsAt,
})}\n`;

/** Parses `legacy-teams.json`; null when it is not exactly `{v:1, keyDigest, workspaceId, name, urlKey, teams,
 *  teamsAt}`, each in the grammar the slot record uses. */
export function parseLegacyTeams(raw: string): LegacyTeams | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const own = Object.keys(o);
  if (o['v'] !== 1 || own.length !== LEGACY_TEAMS_FIELDS.length || !LEGACY_TEAMS_FIELDS.every((f) => own.includes(f))) return null;
  const { keyDigest, workspaceId, name, urlKey, teamsAt } = o;
  if (typeof keyDigest !== 'string' || !/^[0-9a-f]{64}$/.test(keyDigest) || !isLinearUuid(workspaceId)) return null;
  if (!isLinearUrlKey(urlKey) || typeof teamsAt !== 'number' || !Number.isFinite(teamsAt) || teamsAt < 0) return null;
  if (!isLinearStoredName(name)) return null;
  const teams = parseLinearTeams(o['teams']);
  if (teams === null) return null;
  return { keyDigest, workspaceId, name, urlKey, teams, teamsAt };
}

/**
 * What the legacy key's Check again learned beyond the v1 record, written to `linear/legacy-teams.json` under the lock
 * ONLY while `linear.key`'s digest still equals `digest` (the digest rule), so a check in flight across a replace
 * never describes the new key. The pair itself is never touched. Answers whether it wrote; throws, writing nothing,
 * on a value out of its grammar.
 */
export async function writeLegacyTeams(ccrcDir: string, digest: string, learned: Omit<LegacyTeams, 'keyDigest'>): Promise<boolean> {
  const t: LegacyTeams = { keyDigest: digest, ...learned };
  const text = legacyTeamsText(t);
  const back = parseLegacyTeams(text);
  if (back === null || legacyTeamsText(back) !== text) throw new Error('linear store: legacy teams out of their grammar');
  return lockedWrite(ccrcDir, async () => {
    const k = await readLinearKey(ccrcDir);
    if (k.kind !== 'key' || valueDigestHex(k.key) !== digest) return false;
    await makeStoreDir(ccrcDir);
    await writeValueFileAtomic(legacyTeamsPath(ccrcDir), text);
    return true;
  });
}
