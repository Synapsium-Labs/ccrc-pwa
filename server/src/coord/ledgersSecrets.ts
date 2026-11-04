// Programme ledgers (plan PL6, spec §5): the operator's pasted secrets, kept in slot files on the server box. L3 adapter,
// context Coordination: the one writer and the one reader of `<ccrcDir>/operator-secrets/`.
//
// A slot is `<ccrcDir>/operator-secrets/<programme>/<slot>.secret` (the value, verbatim, 0600 from birth by
// `writeValueFileAtomic`) beside `<slot>.json` (`{v:1, setAt, tail, masked, why?}`: never the value, nor a digest of it,
// review 1389 A2). BOTH SLUGS ARE RE-CHECKED before any path is built, whatever validated them before: the programme by `shapeProgramSlug` (untrimmed),
// the slot by `isSlotSlug`. A session never names a path (the coordinator names a slot when it raises the item), and no
// session reads this directory: it is one of `ACCOUNT_SECRET_PATHS` (`shared/api.ts`), the account deny rules.
//
// The directories are made 0700 and an existing one is never chmodded; a directory on the path that is a symlink, or that
// group or others may enter, refuses the write (`OperatorSecretStoreUnsafe`), so a planted link never receives a value.
//
// Nothing in ccrc reads a stored value yet (spec §5): a later feature that needs a secret reads its own slot through a
// reader added here, on this box. The only reads of a VALUE in this file are the masker's re-key (`operatorSecretRows`),
// which fingerprints each value under the current box token and keeps nothing.
//
// NEVER LOG, RETURN OR THROW THE VALUE: every error raised here names a slot at most, and the caller answers fixed words.
import { constants as FS, lstatSync, readFileSync, readdirSync, promises as fsp } from 'node:fs';
import path from 'node:path';
import { shapeProgramSlug } from '../../../shared/api.js';
import {
  OPERATOR_SECRET_LANE_PREFIX, OPERATOR_SECRETS_DIR, isSecretUnmasked, isSlotSlug, secretTailOf, type SecretUnmasked,
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
 * private (or refused); the value written atomically at 0600; `register` asked to fingerprint it with the egress masker (the
 * route passes `SecretMasker.ingestSecret`), so the answer says whether outgoing text will be masked; then the metadata
 * file. Answers the metadata; a rejection carries no value.
 *
 * TWO KINDS OF FAILURE (review 1389 F3). Anything before the value is renamed into place rejects with what failed, and the
 * slot is as it was. Anything after it (the directory fsync that follows the rename, or the metadata write) rejects with
 * `OperatorSecretStoredUnrecorded`, AFTER `register` has run: the value is in its slot, so the masker must know it. Which
 * of the two a failed atomic write was is measured, not guessed: the slot is read back (no symlink followed) and compared.
 */
export async function writeOperatorSecret(
  ccrcDir: string, program: string, slot: string, value: string, now: number,
  register: (laneId: string, value: string) => 'masked' | SecretUnmasked,
): Promise<OperatorSecretMeta> {
  const file = operatorSecretPath(ccrcDir, program, slot);
  await privateDir(path.join(ccrcDir, OPERATOR_SECRETS_DIR), 'top');
  await privateDir(path.dirname(file), 'programme');
  let unsynced = false;
  try {
    await writeValueFileAtomic(file, value);
  } catch (e) {
    if (!(await slotHolds(file, value))) throw e;
    unsynced = true;
  }
  const said = register(operatorSecretLaneId(program, slot), value);
  const meta: OperatorSecretMeta = said === 'masked'
    ? { setAt: now, tail: secretTailOf(value), masked: true }
    : { setAt: now, tail: secretTailOf(value), masked: false, why: said };
  try {
    await writeValueFileAtomic(metaPathOf(file), `${JSON.stringify({ v: 1, ...meta })}\n`);
  } catch {
    throw new OperatorSecretStoredUnrecorded();
  }
  if (unsynced) throw new OperatorSecretStoredUnrecorded();
  return meta;
}

/** Whether the slot's value file holds exactly `value` (a regular file, opened with no symlink followed); false when it
 *  cannot be read. Used only to tell a failed write's two kinds apart; the value read is compared and dropped. */
async function slotHolds(file: string, value: string): Promise<boolean> {
  try {
    const fh = await fsp.open(file, FS.O_RDONLY | FS.O_NOFOLLOW);
    try {
      if (!(await fh.stat()).isFile()) return false;
      return (await fh.readFile('utf8')) === value;
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

/** The slot's metadata, or `null` when the slot holds none (never set, or a file this build cannot read). SYNCHRONOUS, so the
 *  one item builder (`viewOfItem`, which may not await) can carry it; a bad name answers `null` without building a path. */
export function readOperatorSecretMeta(ccrcDir: string, program: string, slot: string): OperatorSecretMeta | null {
  let file: string;
  try { file = operatorSecretPath(ccrcDir, program, slot); } catch { return null; }
  let raw: string;
  try { raw = readFileSync(metaPathOf(file), 'utf8'); } catch { return null; }
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (v === null || typeof v !== 'object' || v['v'] !== 1) return null;
    const { setAt, tail, masked, why } = v;
    if (typeof setAt !== 'number' || !Number.isFinite(setAt) || typeof tail !== 'string' || typeof masked !== 'boolean') return null;
    if (masked) return { setAt, tail, masked };
    return isSecretUnmasked(why) ? { setAt, tail, masked, why } : { setAt, tail, masked };
  } catch {
    return null;
  }
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
 *  (`ingest` refuses it either way), and an answer of these rows alone when the box gave none. `gen` null: no token yet. */
export function withOperatorSecretRows(fromBox: FingerprintAnswer | null, gen: string | null, rows: readonly FingerprintIn[]): FingerprintAnswer | null {
  if (gen === null || rows.length === 0) return fromBox;
  if (fromBox === null) return { gen, rows: [...rows] };
  if (fromBox.gen !== gen) return fromBox;
  return { gen, rows: [...fromBox.rows, ...rows] };
}
