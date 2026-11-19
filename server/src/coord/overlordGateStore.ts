// The gate's store (Overlord W1, gates B; spec §3.3.11 H12 "The fence"; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 5). Ring L3, context C5: two adapters over `coord.db`,
// deciding nothing.
//
//   - `advanceCounterGuarded`: the act counter's ONE guarded way in. The counter is door process A's column
//     (`continuity_act_keys.counter`) with its one writer, `actKeyStore.ts#advanceActCounter`; this adapter adds no column and
//     writes none itself. In one transaction it reads the generation's state, answers `ended` for an ended or missing
//     generation, and otherwise calls that writer (slug `act-counter-is-door-process-as`). A thrown statement is `unmeasured`.
//   - `overlord_fence_refusals`: a refused `stale-generation` write at an Overlord door, recorded as a counted fact for a later
//     cause row (slug `witness-after-the-fence`: a forger without the act key never reaches the witness, so the unwitnessed
//     latch no longer sees it). `recordFenceRefusal` is the table's ONE writer; it prunes rows older than
//     `FENCE_REFUSAL_RETENTION_MS` in the same transaction. `fenceRefusalsSince` is the read a later cause row counts.
//
// Reached through `coord.db`, as the claim door reaches `actKeyStore.ts`, so `CoordStore` gains no delegate. Every function
// answers, never throws. The act key is never an argument here: the refusal row carries the door, the session, the generation
// and the reason word only.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { actKeyOf, advanceActCounter } from '../continuity/actKeyStore.js';
import { tx } from './tx.js';
import type { FenceWhy } from './overlordGate.js';

/** How long a fence refusal is kept: a starting value, read against the `Clock` port's wall time the runner passes in. */
export const FENCE_REFUSAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CounterAnswer = 'advanced' | 'not-above' | 'ended' | 'unmeasured';

/** The guarded compare-and-set (ruled, F3 and F4): in one transaction, the generation's state, then door process A's writer. */
export function advanceCounterGuarded(db: DatabaseSync, generationId: number, counter: number): CounterAnswer {
  try {
    return tx(db, (): CounterAnswer => {
      const row = db.prepare('SELECT state FROM continuity_generations WHERE id = ?').get(generationId) as { state: unknown } | undefined;
      if (row === undefined || row.state === 'ended') return 'ended';
      return advanceActCounter(db, generationId, counter).changed ? 'advanced' : 'not-above';
    });
  } catch {
    return 'unmeasured';
  }
}

/** The live generation's act key against the presented one, and its stored counter (ruled, F12): `unissued` when no key was
 *  issued for the generation, `unmeasured` when the row could not be read. The presented key is hashed and compared by
 *  digest with `timingSafeEqual`, and it is never stored, logged or answered. No key presented reads `mismatch`. */
export type ActKeyFact =
  | { readonly kind: 'read'; readonly key: 'match' | 'mismatch' | 'unissued'; readonly counter: number }
  | { readonly kind: 'unmeasured'; readonly why: string };
export function actKeyFact(db: DatabaseSync, generationId: number, presented: string | null): ActKeyFact {
  const read = actKeyOf(db, generationId);
  if (!read.ok) return { kind: 'unmeasured', why: read.detail };
  if (read.value === 'none') return { kind: 'read', key: 'unissued', counter: 0 };
  const stored = Buffer.from(read.value.keySha256, 'hex');
  const given = presented === null ? Buffer.alloc(0) : createHash('sha256').update(presented, 'utf8').digest();
  const match = given.length === stored.length && stored.length === 32 && timingSafeEqual(given, stored);
  return { kind: 'read', key: match ? 'match' : 'mismatch', counter: read.value.counter };
}

/** One refused `stale-generation` write, as recorded. `generationId` is null when no live generation was read. */
export interface FenceRefusalRow {
  readonly sessionId: string;
  readonly generationId: number | null;
  readonly door: string;
  readonly why: FenceWhy;
  readonly at: number;
}

/** THE TABLE'S ONE WRITER: insert one row and, in the same transaction, delete the rows older than the retention. */
export function recordFenceRefusal(db: DatabaseSync, row: FenceRefusalRow): { ok: true } | { ok: false } {
  try {
    tx(db, () => {
      db.prepare('INSERT INTO overlord_fence_refusals (sessionId, generationId, door, why, at) VALUES (?, ?, ?, ?, ?)')
        .run(row.sessionId, row.generationId, row.door, row.why, row.at);
      db.prepare('DELETE FROM overlord_fence_refusals WHERE at < ?').run(row.at - FENCE_REFUSAL_RETENTION_MS);
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The session's fence refusals at or after `since`, oldest first: the read a later cause row counts (question 1). */
export function fenceRefusalsSince(db: DatabaseSync, sessionId: string, since: number):
  { ok: true; rows: FenceRefusalRow[] } | { ok: false } {
  try {
    const rows = db.prepare('SELECT sessionId, generationId, door, why, at FROM overlord_fence_refusals WHERE sessionId = ? AND at >= ? ORDER BY at, id')
      .all(sessionId, since) as unknown as FenceRefusalRow[];
    return { ok: true, rows: rows.map((r) => ({ ...r })) };
  } catch {
    return { ok: false };
  }
}
