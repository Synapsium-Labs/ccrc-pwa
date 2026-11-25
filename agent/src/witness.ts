// The agent's held authority witness tuple (Overlord W1, plan w1-authority-journal.md Task 6, spec §7.6): what this node keeps of the
// server's journals, so that a restore of the server's volume shows as a witness holding more than the server. The file is
// `<home>/.ccrc/authority-witness.json` (`AUTHORITY_WITNESS_FILE_NAME`); this module is its ONLY writer, and `witnessKeep` (L0) is its
// one ordering rule. An unreadable or malformed file is NEVER overwritten: the agent answers `unmeasured` until a person removes it.
//
// THE RESIDUAL: any process of the fleet's one user can write this file. A session's spawn denies an edit of it (an accident guard
// only). A forged file can open a gap in message ids, the epoch and the restore generation, bounded by the witnessed raise
// ceiling; it cannot exhaust a counter or lift trust in W1. A forged base above that ceiling still fences authority: Confirm
// reports success and spends an epoch and a generation, but its follow-up restores the fence without replacing the file.
// Removing the held file has no effect until the agent sends a new ready frame on reconnect or restart. Once that frame no
// longer carries the witness, the guard remains rolled back until a second Confirm, spending another epoch and generation,
// or a server restart.
import { closeSync, constants as fsConstants, fstatSync, fsyncSync, mkdirSync, openSync, readSync, renameSync, writeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AUTHORITY_WITNESS_FILE_NAME, CCRC_DIR_NAME, type WitnessOpAnswer } from '../../shared/agent-protocol.js';
import { parseWitnessTuple, witnessKeep, type WitnessTuple } from '../../shared/authorityWitness.js';

export type HeldWitness =
  | { kind: 'held'; tuple: WitnessTuple | null }
  | { kind: 'unmeasured'; why: 'unreadable' | 'malformed' };

const witnessPath = (home: string): string => path.join(home, CCRC_DIR_NAME, AUTHORITY_WITNESS_FILE_NAME);
const WITNESS_MAX_BYTES = 64 * 1024;
const UNREADABLE = { kind: 'unmeasured', why: 'unreadable' } as const;

/** This fixed carrier is also read in the synchronous ready path. Open without blocking or following the leaf, and
 *  bound the read itself as well as the stat, so growth after the stat cannot make it unbounded. */
export function readHeldWitness(home: string): HeldWitness {
  let fd: number;
  try {
    fd = openSync(witnessPath(home), fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'held', tuple: null } : UNREADABLE;
  }
  let text: string;
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > WITNESS_MAX_BYTES) return UNREADABLE;
    const buf = Buffer.alloc(WITNESS_MAX_BYTES + 1);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
    }
    if (got > WITNESS_MAX_BYTES) return UNREADABLE;
    text = buf.toString('utf8', 0, got);
  } catch {
    return UNREADABLE;
  } finally {
    try { closeSync(fd); } catch { /* no further read is possible */ }
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { kind: 'unmeasured', why: 'malformed' }; }
  const p = parseWitnessTuple(json);
  return p.ok ? { kind: 'held', tuple: p.tuple } : { kind: 'unmeasured', why: 'malformed' };
}

/** Temp file in the same directory (0600), fsync, rename into place, fsync the directory. */
function writeTuple(home: string, tuple: WitnessTuple): void {
  const text = JSON.stringify(tuple);
  if (Buffer.byteLength(text) > WITNESS_MAX_BYTES) throw new Error('witness exceeds its read bound');
  const dir = path.join(home, CCRC_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${AUTHORITY_WITNESS_FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    try { unlinkSync(tmp); } catch { /* the temp file is ours; a failed removal leaves a dotfile only */ }
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, witnessPath(home));
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* as above */ }
    throw e;
  }
  const dfd = openSync(dir, 'r');
  try { fsyncSync(dfd); } finally { closeSync(dfd); }
}

/** The op: keep the higher epoch (equal keeps what is held), write only when that changed what is held, answer what it holds. */
export function answerWitness(home: string, offer: WitnessTuple): WitnessOpAnswer {
  const held = readHeldWitness(home);
  if (held.kind === 'unmeasured') return held;
  const kept = witnessKeep(held.tuple, offer);
  if (kept === held.tuple) return { kind: 'held', tuple: kept };
  try {
    writeTuple(home, kept);
  } catch {
    return { kind: 'unmeasured', why: 'unwritable' };
  }
  return { kind: 'held', tuple: kept };
}
