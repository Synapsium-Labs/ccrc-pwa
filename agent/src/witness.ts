// The agent's held authority witness tuple (Overlord W1, plan w1-authority-journal.md Task 6, spec §7.6): what this node keeps of the
// server's journals, so that a restore of the server's volume shows as a witness holding more than the server. The file is
// `<home>/.ccrc/authority-witness.json` (`AUTHORITY_WITNESS_FILE_NAME`); this module is its ONLY writer, and `witnessKeep` (L0) is its
// one ordering rule. An unreadable or malformed file is NEVER overwritten: the agent answers `unmeasured` until a person removes it.
//
// THE RESIDUAL (review F8): any process of the fleet's one user can write this file. The Overlord has no write tool (§3.6, R12), the
// spec already caps a forged caller on a shared-user box at `advise` (Table 3.8a), and every agent reads `unmeasured` until the
// isolation word lands (question 10), so a forged file lifts nothing in W1. What is left is a false "held" on the console and a
// refusal a forger can cause, which fences toward safety. A session's spawn denies an edit of it (an accident guard only).
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AUTHORITY_WITNESS_FILE_NAME, CCRC_DIR_NAME, type WitnessOpAnswer } from '../../shared/agent-protocol.js';
import { parseWitnessTuple, witnessKeep, type WitnessTuple } from '../../shared/authorityWitness.js';

export type HeldWitness =
  | { kind: 'held'; tuple: WitnessTuple | null }
  | { kind: 'unmeasured'; why: 'unreadable' | 'malformed' };

const witnessPath = (home: string): string => path.join(home, CCRC_DIR_NAME, AUTHORITY_WITNESS_FILE_NAME);

/** Read the file fresh: absent is `held: null`; any other read error is `unreadable`; contents that are not a tuple are `malformed`. */
export function readHeldWitness(home: string): HeldWitness {
  let text: string;
  try {
    text = readFileSync(witnessPath(home), 'utf8');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'held', tuple: null } : { kind: 'unmeasured', why: 'unreadable' };
  }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return { kind: 'unmeasured', why: 'malformed' }; }
  const p = parseWitnessTuple(json);
  return p.ok ? { kind: 'held', tuple: p.tuple } : { kind: 'unmeasured', why: 'malformed' };
}

/** Temp file in the same directory (0600), fsync, rename into place, fsync the directory. Throws on any failure, leaving the old file. */
function writeTuple(home: string, tuple: WitnessTuple): void {
  const dir = path.join(home, CCRC_DIR_NAME);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.${AUTHORITY_WITNESS_FILE_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, JSON.stringify(tuple));
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
