// Programme ledgers (plan PL6, spec §5): the operator's pasted secrets, kept in slot files on the server box. L3 adapter,
// context Coordination: the one writer and the one reader of `<ccrcDir>/operator-secrets/`.
//
// A slot is `<ccrcDir>/operator-secrets/<programme>/<slot>.secret` (the value, verbatim, 0600 from birth by
// `writeValueFileAtomic`) beside `<slot>.json` (`{v:1, setAt, tail, masked, why?, item?}`: never the value, nor a digest of
// it, review 1389 A2; `item` is the id of the item whose save wrote it, for the operator's stored-secrets read). BOTH SLUGS ARE RE-CHECKED before any path is built, whatever validated them before: the programme by `shapeProgramSlug` (untrimmed),
// the slot by `isSlotSlug`. A session never names a path (the coordinator names a slot when it raises the item), and no
// session reads this directory: it is one of `ACCOUNT_SECRET_PATHS` (`shared/api.ts`), the account deny rules.
//
// The directories are made 0700 and an existing one is never chmodded; a directory on the path that is a symlink, or that
// group or others may enter, refuses the write (`OperatorSecretStoreUnsafe`), so a planted link never receives a value.
//
// Nothing in ccrc reads a stored value yet (spec §5): a later feature that needs a secret reads its own slot through a
// reader added here, on this box. The only reads of a VALUE in this file are the masker's re-key (`operatorSecretRows`),
// which fingerprints each value under the current box token and keeps nothing, and a failed write's read-back (`slotHolds`),
// which compares and drops. A stored slot outlives its item (the operator's ruling on programme item 9); the operator's
// Remove door is the one way a slot leaves (`removeOperatorSecret`), and the stored-secrets read (`readStoredSecrets`) answers
// names and records only.
//
// NEVER LOG, RETURN OR THROW THE VALUE: every error raised here names a slot at most, and the caller answers fixed words.
import { constants as FS, lstatSync, readFileSync, readdirSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { shapeProgramSlug } from '../../../shared/api.js';
import {
  OPERATOR_SECRET_LANE_PREFIX, OPERATOR_SECRETS_DIR, isOperatorSecretLane, isSecretUnmasked, isSlotSlug, secretTailOf, type SecretUnmasked,
} from '../../../shared/ledgers.js';
import type { FingerprintAnswer, FingerprintIn } from '../accounts/mask.js';
import { writeValueFileAtomic } from '../token/files.js';

/** The store's directory under `ccrcDir` (`OPERATOR_SECRETS_DIR`, `shared/ledgers.ts`). */
export { OPERATOR_SECRETS_DIR };
const SECRET_EXT = '.secret';
const META_EXT = '.json';
/** The masker lane of one slot (`OPERATOR_SECRET_LANE_PREFIX`, `shared/ledgers.ts`). */
export { OPERATOR_SECRET_LANE_PREFIX };
export const operatorSecretLaneId = (program: string, slot: string): string => `${OPERATOR_SECRET_LANE_PREFIX}${program}:${slot}`;

/** The slot's state as its metadata file holds it, and as an `ItemView.secretSet` carries it (`at` is `setAt`). */
export interface OperatorSecretMeta { setAt: number; tail: string; masked: boolean; why?: SecretUnmasked }

/** A programme slug as `shapeProgramSlug` takes it, with nothing trimmed: a name with spaces around it is not the name. */
const isProgramSlug = (s: unknown): s is string => typeof s === 'string' && (() => {
  const shaped = shapeProgramSlug(s);
  return shaped.ok && shaped.slug === s;
})();

/** Thrown when a programme or slot name fails its shape: no path was built. */
export class OperatorSecretBadSlot extends Error {
  constructor() { super('the programme or slot name is not a valid slug; no path was built'); this.name = 'OperatorSecretBadSlot'; }
}
/** Thrown when a directory of the store is a symlink, not a directory, or open to group or others: nothing was written. */
export class OperatorSecretStoreUnsafe extends Error {
  constructor(which: string) { super(`the operator-secrets store's ${which} directory is not a private directory; nothing was written`); this.name = 'OperatorSecretStoreUnsafe'; }
}

/** Thrown when the value IS in its slot but what follows failed: the directory fsync after the rename, or the metadata write
 *  (review 1389 F3). The masker was asked first, so the value is registered for masking as far as the masker could take it. */
export class OperatorSecretStoredUnrecorded extends Error {
  constructor() { super('the secret is stored in its slot, but its record could not be completed'); this.name = 'OperatorSecretStoredUnrecorded'; }
}

/** Whether a programme and a slot are names this store builds a path from. */
export function operatorSlotNamesValid(program: unknown, slot: unknown): boolean {
  return isProgramSlug(program) && typeof slot === 'string' && isSlotSlug(slot);
}

/** The slot's value file. Both names are checked first; a bad one throws before any path exists. */
export function operatorSecretPath(ccrcDir: string, program: string, slot: string): string {
  if (!operatorSlotNamesValid(program, slot)) throw new OperatorSecretBadSlot();
  return path.join(ccrcDir, OPERATOR_SECRETS_DIR, program, `${slot}${SECRET_EXT}`);
}
const metaPathOf = (secretPath: string): string => `${secretPath.slice(0, -SECRET_EXT.length)}${META_EXT}`;
/** The tail of a temporary file `writeValueFileAtomic` (`token/files.ts`) makes beside a slot's two files, after the
 *  `.<slot>.` it begins with: `secret` or `json`, then `.tmp-` and 16 hex digits. A fixed expression: no slot name is ever
 *  compiled into one. */
const TEMP_TAIL = /^(?:secret|json)\.tmp-[0-9a-f]{16}$/;
/** Whether a directory entry is one of `slot`'s temporary files. */
const isTempOf = (entry: string, slot: string): boolean =>
  entry.startsWith(`.${slot}.`) && TEMP_TAIL.test(entry.slice(slot.length + 2));

/**
 * Removes what a crash between a temp file's open and its rename left of ONE slot (review 1389 A4): a 0600 copy of a value in
 * the programme directory, which nothing lists, masks or re-keys. Only this slot's own temps, and only on this slot's chain
 * (the route's `underSlot`), so another slot's write in flight is never touched. `slot` passed its shape before any path was
 * built. Never throws: a temp that cannot be removed stays, as before.
 */
async function sweepSlotTemps(dir: string, slot: string): Promise<void> {
  let names: string[];
  try { names = await fsp.readdir(dir); } catch { return; }
  for (const n of names) if (isTempOf(n, slot)) await fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
}

/** Whether a store directory is a private directory of ours: not a link, not open to group or others, owned by this user. */
const isPrivateDir = (st: { isDirectory(): boolean; mode: number; uid: number }): boolean =>
  st.isDirectory() && (st.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || st.uid === process.getuid());

/** Makes `dir` at 0700 when absent; refuses when it is anything but a directory of ours that group and others cannot enter. */
async function privateDir(dir: string, which: string): Promise<void> {
  try {
    await fsp.mkdir(dir, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e;
  }
  const st = await fsp.lstat(dir);
  if (!st.isDirectory() || (st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
    throw new OperatorSecretStoreUnsafe(which);
  }
}

/**
 * Stores one value in its slot and records it (spec §5). In order: both names re-checked; the store's two directories made
 * private (or refused); this slot's leftover temp files removed (review 1389 A4); the value written atomically at 0600;
 * `register` asked to fingerprint it with the egress masker (the route passes `SecretMasker.ingestSecret`), so the answer says
 * whether outgoing text will be masked; then the metadata file, which names `item`, the item whose save this is. Answers the
 * metadata; a rejection carries no value.
 *
 * THE TAIL IS SHOWN ONLY WHEN THE MASKER CATCHES THE VALUE (review 1391 F2): `masked` gives `secretTailOf`'s tail, and every
 * unmasked answer gives none, whatever the value's length. A value the masker would not catch never has a character of it
 * leave the server.
 *
 * TWO KINDS OF FAILURE (review 1389 F3). Anything before the value is renamed into place rejects with what failed, and the
 * slot is as it was. Anything after it (the directory fsync that follows the rename, or the metadata write) rejects with
 * `OperatorSecretStoredUnrecorded`, AFTER `register` has run: the value is in its slot, so the masker must know it. Which
 * of the two a failed atomic write was is measured, not guessed: the slot is read back (no symlink followed) and compared,
 * and a read-back that cannot read the file counts as stored (review 1391 A-4): the masker is told, and the operator is
 * told to save again, which finishes either way. A `register` that throws counts as `unregistered`, never as a failed write.
 * A failed metadata write removes the previous save's record, so no reader shows another save's time beside this value.
 */
export async function writeOperatorSecret(
  ccrcDir: string, program: string, slot: string, value: string, now: number,
  register: (laneId: string, value: string) => 'masked' | SecretUnmasked, item?: number,
): Promise<OperatorSecretMeta> {
  const file = operatorSecretPath(ccrcDir, program, slot);
  await privateDir(path.join(ccrcDir, OPERATOR_SECRETS_DIR), 'top');
  await privateDir(path.dirname(file), 'programme');
  await sweepSlotTemps(path.dirname(file), slot);
  let unsynced = false;
  try {
    await writeValueFileAtomic(file, value);
  } catch (e) {
    if ((await slotHolds(file, value)) === 'no') throw e;
    unsynced = true;
  }
  let said: 'masked' | SecretUnmasked;
  try { said = register(operatorSecretLaneId(program, slot), value); } catch { said = 'unregistered'; }
  const meta: OperatorSecretMeta = said === 'masked'
    ? { setAt: now, tail: secretTailOf(value), masked: true }
    : { setAt: now, tail: '', masked: false, why: said };
  try {
    await writeValueFileAtomic(metaPathOf(file), `${JSON.stringify({ v: 1, ...meta, ...(item === undefined ? {} : { item }) })}\n`);
  } catch {
    await fsp.rm(metaPathOf(file), { force: true }).catch(() => {});
    throw new OperatorSecretStoredUnrecorded();
  }
  if (unsynced) throw new OperatorSecretStoredUnrecorded();
  return meta;
}

/** Whether the slot's value file holds exactly `value` (a regular file, opened with no symlink followed): `yes`, `no` (it is
 *  absent, not a regular file, or holds something else), or `unknown` (it is there and could not be read). Used only to tell a
 *  failed write's two kinds apart; the value read is compared and dropped. */
async function slotHolds(file: string, value: string): Promise<'yes' | 'no' | 'unknown'> {
  let fh: Awaited<ReturnType<typeof fsp.open>>;
  try {
    fh = await fsp.open(file, FS.O_RDONLY | FS.O_NOFOLLOW);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code;
    return code === 'ENOENT' || code === 'ELOOP' ? 'no' : 'unknown';
  }
  try {
    if (!(await fh.stat()).isFile()) return 'no';
    return (await fh.readFile('utf8')) === value ? 'yes' : 'no';
  } catch {
    return 'unknown';
  } finally {
    await fh.close().catch(() => {});
  }
}

/** A slot's metadata file parsed: the slot's state and the item its save named, or `null` when the file is not one this
 *  build reads. The value is never in it. */
function parseMeta(raw: string): { meta: OperatorSecretMeta; item: number | null } | null {
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v === null || typeof v !== 'object' || v['v'] !== 1) return null;
    const { setAt, tail, masked, why, item } = v;
    if (typeof setAt !== 'number' || !Number.isFinite(setAt) || typeof tail !== 'string' || typeof masked !== 'boolean') return null;
    const itemId = typeof item === 'number' && Number.isSafeInteger(item) && item > 0 ? item : null;
    if (masked) return { meta: { setAt, tail, masked }, item: itemId };
    return { meta: isSecretUnmasked(why) ? { setAt, tail, masked, why } : { setAt, tail, masked }, item: itemId };
  } catch {
    return null;
  }
}

/** The slot's metadata, or `null` when the slot holds none: never set, removed (its value file is gone, whatever record is
 *  left), or a record this build cannot read. SYNCHRONOUS, so the one item builder (`viewOfItem`, which may not await) can
 *  carry it; a bad name answers `null` without building a path. */
export function readOperatorSecretMeta(ccrcDir: string, program: string, slot: string): OperatorSecretMeta | null {
  let file: string;
  try { file = operatorSecretPath(ccrcDir, program, slot); } catch { return null; }
  try { if (!lstatSync(file).isFile()) return null; } catch { return null; }
  let raw: string;
  try { raw = readFileSync(metaPathOf(file), 'utf8'); } catch { return null; }
  return parseMeta(raw)?.meta ?? null;
}

/** One stored slot as the stored-secrets read lists it: its name, when it was saved (`null`: its record could not be read)
 *  and the item its save named (`null`: none named). Never any part of the value. */
export interface StoredSlotRecord { slot: string; setAt: number | null; item: number | null }

/**
 * THE STORED-SECRETS READ (the operator's ruling on programme item 9): one programme's stored slots, by name, with when each was
 * saved and the item that asked for it. It reads directory listings and the metadata files only, never a value file's
 * contents. MEASURED: an absent store or programme directory is `ok` with no slots, and a directory that exists and cannot
 * be listed (or is not a private directory of ours) is `unreadable`; the two are never folded. `invalid` when the programme
 * name fails its shape, before any path is built. Never throws.
 */
export function readStoredSecrets(ccrcDir: string, program: string):
  { state: 'ok'; slots: StoredSlotRecord[] } | { state: 'unreadable' } | { state: 'invalid' } {
  if (!isProgramSlug(program)) return { state: 'invalid' };
  // NO PATH IS BUILT FROM THE NAME ASKED FOR: the programme directory is found by listing the store and taking the entry that
  // equals it, so every path below is made of names the store's own listing gave (the caller's name is a route parameter).
  const top = path.join(ccrcDir, OPERATOR_SECRETS_DIR);
  let entries: string[];
  try {
    if (!isPrivateDir(lstatSync(top))) return { state: 'unreadable' };
    entries = readdirSync(top);
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? { state: 'ok', slots: [] } : { state: 'unreadable' };
  }
  const found = entries.find((e) => e === program);
  if (found === undefined) return { state: 'ok', slots: [] };
  const dir = path.join(top, found);
  try {
    if (!isPrivateDir(lstatSync(dir))) return { state: 'unreadable' };
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === 'ENOENT' ? { state: 'ok', slots: [] } : { state: 'unreadable' };
  }
  let names: string[];
  try { names = readdirSync(dir); } catch { return { state: 'unreadable' }; }
  const slots: StoredSlotRecord[] = [];
  for (const n of names.sort()) {
    if (!n.endsWith(SECRET_EXT)) continue;
    const slot = n.slice(0, -SECRET_EXT.length);
    if (!isSlotSlug(slot)) continue;
    const file = path.join(dir, n);
    try { if (!lstatSync(file).isFile()) continue; } catch { continue; }
    let parsed: { meta: OperatorSecretMeta; item: number | null } | null = null;
    try { parsed = parseMeta(readFileSync(metaPathOf(file), 'utf8')); } catch { parsed = null; }
    slots.push({ slot, setAt: parsed?.meta.setAt ?? null, item: parsed?.item ?? null });
  }
  return { state: 'ok', slots };
}

/**
 * REMOVES ONE STORED SLOT (the operator's Remove door, programme item 9): the value file, then its metadata, then this slot's
 * leftover temp files. Both names are re-checked before any path is built (`OperatorSecretBadSlot`). The store's two
 * directories must be private directories of ours, never followed through a link (`OperatorSecretStoreUnsafe`), and are never
 * made here. Answers `removed`, or `none` when no value file is there (a record left without one is removed too). A value
 * file that cannot be removed rejects with what failed, and nothing else is touched; a record or temp that cannot be removed
 * after the value is gone stays (every reader ignores a record whose value file is gone). Never reads the value.
 */
export async function removeOperatorSecret(ccrcDir: string, program: string, slot: string): Promise<'removed' | 'none'> {
  if (!operatorSlotNamesValid(program, slot)) throw new OperatorSecretBadSlot();
  // NO PATH IS BUILT FROM THE NAMES ASKED FOR (they are the Remove door's route parameters): the programme directory and the
  // slot's two files are found by listing the store and taking the entries equal to them, so every path below is made of
  // names the store's own listing gave.
  const top = path.join(ccrcDir, OPERATOR_SECRETS_DIR);
  /** The entry of `dir` equal to `name`, after `dir` is checked private; `null` when `dir` or the entry is absent. */
  const entryOf = async (dir: string, which: string, name: string): Promise<string | null> => {
    let st: Awaited<ReturnType<typeof fsp.lstat>>;
    try {
      st = await fsp.lstat(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
      throw e;
    }
    if (!isPrivateDir(st)) throw new OperatorSecretStoreUnsafe(which);
    return (await fsp.readdir(dir)).find((e) => e === name) ?? null;
  };
  const programEntry = await entryOf(top, 'top', program);
  if (programEntry === null) return 'none';
  const dir = path.join(top, programEntry);
  const valueEntry = await entryOf(dir, 'programme', `${slot}${SECRET_EXT}`);
  const metaEntry = await entryOf(dir, 'programme', `${slot}${META_EXT}`);
  let had = false;
  if (valueEntry !== null) {
    try {
      await fsp.unlink(path.join(dir, valueEntry));
      had = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') throw e;
    }
  }
  if (metaEntry !== null) await fsp.rm(path.join(dir, metaEntry), { force: true }).catch(() => {});
  await sweepSlotTemps(dir, slot);
  if (had) {
    try {
      const dh = await fsp.open(dir, 'r');
      try { await dh.sync(); } finally { await dh.close(); }
    } catch {
      // The value is unlinked; its durability across a crash is unproven, and a re-run of Remove finishes it.
    }
  }
  return had ? 'removed' : 'none';
}

/** What a listing of the store found: every slot whose two names pass their shapes, and whether any directory of the store
 *  could not be listed (review 1389 F1: an unreadable store is never "no slots"; an absent one is empty, and readable). */
interface StoredSlots { slots: { program: string; slot: string; file: string }[]; unreadable: boolean }

/** Every stored slot as its programme and slot, from the value files whose two names pass their shapes. Measured: a
 *  directory that exists and cannot be listed sets `unreadable`, and the rest are still listed. Never throws. */
function storedSlots(ccrcDir: string): StoredSlots {
  const top = path.join(ccrcDir, OPERATOR_SECRETS_DIR);
  const out: StoredSlots = { slots: [], unreadable: false };
  let programs: string[];
  try {
    programs = readdirSync(top);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') out.unreadable = true;
    return out;
  }
  for (const program of programs.sort()) {
    if (!isProgramSlug(program)) continue;
    let names: string[];
    try { names = readdirSync(path.join(top, program)); } catch { out.unreadable = true; continue; }
    for (const n of names.sort()) {
      if (!n.endsWith(SECRET_EXT)) continue;
      const slot = n.slice(0, -SECRET_EXT.length);
      if (isSlotSlug(slot)) out.slots.push({ program, slot, file: path.join(top, program, n) });
    }
  }
  return out;
}

/** Each stored value's fingerprint row, made by `rowOf` (the composition root passes the masker's `fingerprintRow` under the
 *  current token: a value is taken from this adapter, never handed to an outer ring's import), for the masker's re-key after a
 *  rotation (the box's `roster` answer cannot carry them: the box holds none of them). A value file that is not a regular file,
 *  or cannot be read, is left out and sets `unreadable`, as a directory that cannot be listed does: the rows it would have
 *  replaced stay as they are, under the generation they were keyed with, and the re-key keeps retrying them. */
export async function operatorSecretRows(
  ccrcDir: string, rowOf: (laneId: string, value: string) => FingerprintIn,
): Promise<{ rows: FingerprintIn[]; unreadable: boolean }> {
  const listed = storedSlots(ccrcDir);
  const rows: FingerprintIn[] = [];
  let unreadable = listed.unreadable;
  for (const s of listed.slots) {
    try {
      const st = lstatSync(s.file);
      if (!st.isFile()) { unreadable = true; continue; }
      const fh = await fsp.open(s.file, FS.O_RDONLY | FS.O_NOFOLLOW);
      let value: string;
      try { value = await fh.readFile('utf8'); } finally { await fh.close(); }
      rows.push(rowOf(operatorSecretLaneId(s.program, s.slot), value));
    } catch {
      unreadable = true;
    }
  }
  return { rows, unreadable };
}

/** The re-key's answer with the operator-secret rows added (plan PL6): the box's answer with them when it came keyed with
 *  `gen` (the current token's generation, `fingerprintGeneration`), the box's answer unchanged when it came keyed with another
 *  (`ingest` refuses it either way), and an answer of these rows alone when the box gave none. `gen` null: no token yet.
 *  A row of the BOX's answer that names an operator-secret lane is dropped first (review 1391 A-1): those lanes are this
 *  server's own, so only the rows read from its own store ever speak for them. */
export function withOperatorSecretRows(fromBox: FingerprintAnswer | null, gen: string | null, rows: readonly FingerprintIn[]): FingerprintAnswer | null {
  const box = fromBox === null ? null : { gen: fromBox.gen, rows: fromBox.rows.filter((r) => !isOperatorSecretLane(r.laneId)) };
  if (gen === null || rows.length === 0) return box;
  if (box === null) return { gen, rows: [...rows] };
  if (box.gen !== gen) return box;
  return { gen, rows: [...box.rows, ...rows] };
}
