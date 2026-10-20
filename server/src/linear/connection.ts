/**
 * The Linear connection's one credential: `~/.ccrc/linear.key`.
 *
 * L3 ADAPTER over `readValueFile` (`token/files.ts`), the box token's own
 * measured reader, so the file is read by one mechanism and its first
 * non-comment line is the value by the same rule. The key has ONE source: this
 * file. It is never taken from the process environment, because a key that can
 * be set in two places can disagree with itself, and the Settings route (the
 * one writer, a later stage) could never tell which one a lookup used.
 *
 * EVERY KIND `readValueFile` returns survives here, because each has a
 * different remedy and the Settings section must say which: `absent` (paste a
 * key), `unusable` (the file has no value line), `placeholder` (an example
 * value was never replaced) and `unreadable` (the file is there and the read
 * failed, so fix permissions; it is NOT "not connected"). The file's metadata
 * is dropped, which is the only thing narrowed, and no caller here wants it.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  LINEAR_CHECK_OUTCOMES, type LinearCheckOutcome, type LinearDetails, type LinearDetailsRead,
} from '../../../shared/linear.js';
import { readValueFile, valueDigestHex, writeValueFileAtomic } from '../token/files.js';

/** The file's name inside the ccrc dir. */
export const LINEAR_KEY_FILE = 'linear.key';

/** Where the key lives, under the config's ccrc dir (`cfg.ccrcDir`). */
export function linearKeyPath(ccrcDir: string): string {
  return path.join(ccrcDir, LINEAR_KEY_FILE);
}

export type LinearKeyRead =
  | { kind: 'key'; key: string }
  | { kind: 'absent' }
  | { kind: 'unusable' }
  | { kind: 'placeholder' }
  | { kind: 'unreadable'; code: string };

/** Never rejects: every outcome is a `LinearKeyRead`. */
export async function readLinearKey(ccrcDir: string): Promise<LinearKeyRead> {
  const r = await readValueFile(linearKeyPath(ccrcDir));
  switch (r.kind) {
    case 'value': return { kind: 'key', key: r.value };
    case 'absent': return { kind: 'absent' };
    case 'unusable': return { kind: 'unusable' };
    case 'placeholder': return { kind: 'placeholder' };
    case 'unreadable': return { kind: 'unreadable', code: r.code };
  }
}

// ---------------------------------------------------------------------------
// The details file, `~/.ccrc/linear.json` (named workspaces S4b, design §5.1): what the Settings section
// displays. It is a DISPLAY record, never a credential: the key itself is in `linear.key` alone, and what
// leaves the server of it is `keyTail`. Beside it sits `keyDigest`, the sha256 of the key it describes, which
// is how a record left by a different key (a crash between a replace's two writes) is told from one that is
// current, and how a 401 is attributed to the key that earned it.
// ---------------------------------------------------------------------------

/** The file's name inside the ccrc dir. */
export const LINEAR_DETAILS_FILE = 'linear.json';

export function linearDetailsPath(ccrcDir: string): string {
  return path.join(ccrcDir, LINEAR_DETAILS_FILE);
}

export type { LinearDetails, LinearDetailsRead };

const errnoOf = (e: unknown): string => (e as NodeJS.ErrnoException)?.code ?? 'EIO';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const nameOrNull = (v: unknown): boolean => v === null || (typeof v === 'string' && v.length > 0 && v.length <= 400);

/** Parses a details file's text; null when it is not exactly the shape this build writes. */
export function parseLinearDetails(raw: string): LinearDetails | null {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v) || v['v'] !== 1) return null;
  const { org, user, keyTail, keyDigest, checkedAt, outcome } = v;
  if (!nameOrNull(org) || !nameOrNull(user)) return null;
  if (typeof keyTail !== 'string' || keyTail.length !== 4) return null;
  if (typeof keyDigest !== 'string' || !/^[0-9a-f]{64}$/.test(keyDigest)) return null;
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt < 0) return null;
  if (!(LINEAR_CHECK_OUTCOMES as readonly unknown[]).includes(outcome)) return null;
  return {
    org: org as string | null, user: user as string | null, keyTail, keyDigest, checkedAt,
    outcome: outcome as LinearCheckOutcome,
  };
}

/** Never rejects. */
export async function readLinearDetails(ccrcDir: string): Promise<LinearDetailsRead> {
  let raw: string;
  try {
    raw = await fsp.readFile(linearDetailsPath(ccrcDir), 'utf8');
  } catch (e) {
    return errnoOf(e) === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', code: errnoOf(e) };
  }
  const details = parseLinearDetails(raw);
  return details === null ? { kind: 'malformed' } : { kind: 'details', details };
}

/**
 * Every writer of either file goes through `withConnectionLock`. The lock is a promise chain per directory,
 * held for file work only: never across a call to Linear, so a slow Linear cannot hold up the 401 marker or a
 * Disconnect. An act that verified a key BEFORE taking the lock re-reads the stored key inside it and drops its
 * result when the key has since changed (`recordLinearCheck`).
 */
const chains = new Map<string, Promise<unknown>>();
export function withConnectionLock<T>(ccrcDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(ccrcDir) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  chains.set(ccrcDir, tail);
  void tail.then(() => { if (chains.get(ccrcDir) === tail) chains.delete(ccrcDir); });
  return run;
}

const detailsText = (d: LinearDetails): string => `${JSON.stringify({ v: 1, ...d })}\n`;

/** The key's last four characters. */
export const keyTailOf = (key: string): string => key.slice(-4);

/**
 * Connect: the key FIRST, then its details, both through `writeValueFileAtomic` (0600 from birth, fsynced). A
 * crash between the two leaves a key with no details, which the section shows as `details-unknown`, and never a
 * description of a key that is not there. Call inside the lock.
 */
export async function writeLinearConnection(ccrcDir: string, key: string, details: LinearDetails): Promise<void> {
  await writeValueFileAtomic(linearKeyPath(ccrcDir), `${key}\n`);
  await writeValueFileAtomic(linearDetailsPath(ccrcDir), detailsText(details));
}

/** Check again: the details only, the key untouched. Call inside the lock. */
export async function writeLinearDetails(ccrcDir: string, details: LinearDetails): Promise<void> {
  await writeValueFileAtomic(linearDetailsPath(ccrcDir), detailsText(details));
}

/** Disconnect: the key FIRST, then the details, so a crash between the two leaves details with no key (shown as
 *  not connected, and finished by the next Disconnect), never a key whose description is gone. Call inside the lock. */
export async function removeLinearConnection(ccrcDir: string): Promise<void> {
  await fsp.rm(linearKeyPath(ccrcDir), { force: true });
  await fsp.rm(linearDetailsPath(ccrcDir), { force: true });
}

/**
 * Record what a check of the key whose digest is `digest` found: THE ONE PLACE `linear.json` is written for a
 * check, by Check again and by the 401 marker alike. It writes ONLY if the stored key's digest still equals
 * `digest`, so a result for a key the operator has just replaced (a check in flight across a Connect) can never
 * describe, or condemn, the new one. Answers whether it wrote.
 *
 * `names` is what an `ok` check learned; any other outcome keeps the previous record's names when that record
 * describes this same key, so the section still says which organisation a rejected key belonged to.
 */
export async function recordLinearCheck(
  ccrcDir: string, digest: string, outcome: LinearCheckOutcome, names: { org: string; user: string } | null, now: number,
): Promise<boolean> {
  return withConnectionLock(ccrcDir, async () => {
    const k = await readLinearKey(ccrcDir);
    if (k.kind !== 'key' || valueDigestHex(k.key) !== digest) return false;
    const prev = await readLinearDetails(ccrcDir);
    const same = prev.kind === 'details' && prev.details.keyDigest === digest ? prev.details : null;
    await writeLinearDetails(ccrcDir, {
      org: names?.org ?? same?.org ?? null, user: names?.user ?? same?.user ?? null,
      keyTail: keyTailOf(k.key), keyDigest: digest, checkedAt: now, outcome,
    });
    return true;
  });
}

/**
 * A Linear 401 for the key whose digest is `usedDigest` marks the connection REJECTED, so the Settings screen
 * tells the truth the next time it is opened, with no poller. It is `recordLinearCheck`'s `rejected` outcome
 * and so inherits its rule: marked ONLY if the stored key is still the one that was used (compared by digest).
 * The resolve route is its one caller.
 */
export function markLinearRejected(ccrcDir: string, usedDigest: string, now: number): Promise<boolean> {
  return recordLinearCheck(ccrcDir, usedDigest, 'rejected', null, now);
}
