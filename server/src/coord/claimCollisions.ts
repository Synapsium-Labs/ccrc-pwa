// Overlord W2, overlaps and goal conflicts (spec 2026-11-09 §5.5, H23; plan
// docs/superpowers/plans/2026-11-16-overlord-w2/w2-overlaps.md, Task 3, question 4). Ring: L3, context Coordination (C5).
// SQL only: every function is synchronous over the store's own database handle, and `CoordStore` keeps a one-line delegate.
//
// THE RECORD OF A REFUSED CLAIM. `decideClaim` (claims.ts) computes a refused claim's conflicts only to answer the 409, and
// keeps none; live claims never overlap each other, so nothing read afterwards can find one. `claim_collisions` keeps them.
//
// ONE WRITER: `recordCollisions` is the only writer of `claim_collisions`, prune included (`single-definition/writers-map
// .test.ts` pins it), and `CoordStore#claimAttempt` is its only caller: AFTER the claim's own transaction committed a
// refusal, in a transaction of its own (the plan review's F5). SQLite can roll a transaction back by itself (a full disk,
// an I/O error); a record inside the claim's transaction would then turn the 409 into a 500. In its own transaction it
// cannot: the claim's answer is already decided and committed, a throw is caught by the caller (warned once a process),
// and the 409 is sent as today. A crash between the two commits loses one record, which the overlaps arm can only miss.
//
// THE READ keeps every distinction it reads: a throw is `{ ok: false, detail }`, never an empty list, and a holder or
// requester with no run answers `program: null` (the arm counts it `unattributed`), never a guessed programme.
import type { DatabaseSync } from 'node:sqlite';
import type { ClaimConflict } from '../../../shared/api.js';
import { COLLISION_KEEP_HOURS } from '../../../shared/programmeFacts.js';
import { tx } from './tx.js';

const HOUR_MS = 60 * 60_000;

/** What a refused attempt was: its project, the requesting session and its run. */
export interface CollisionAttempt { readonly project: string; readonly sessionId: string; readonly runId: number | null }

/**
 * Records one row per conflict of one refused attempt, and prunes rows older than `COLLISION_KEEP_HOURS`, in ONE
 * transaction: the prune and the inserts commit together or not at all. Throws whatever SQLite throws; the caller's catch
 * owns the warning and any rollback left open.
 */
export function recordCollisions(db: DatabaseSync, attempt: CollisionAttempt, conflicts: readonly ClaimConflict[], now: number): void {
  tx(db, () => {
    db.prepare('DELETE FROM claim_collisions WHERE at < ?').run(now - COLLISION_KEEP_HOURS * HOUR_MS);
    const ins = db.prepare('INSERT INTO claim_collisions (at, project, path, claimedPath, requesterId, requesterRun, holderClaimId) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const c of conflicts) ins.run(now, attempt.project, c.path, c.claimedPath, attempt.sessionId, attempt.runId, c.claimId);
  });
}

let recordWarned = false;
/**
 * `CoordStore#claimAttempt`'s one call, made only after its own transaction committed a `conflict` refusal: records the
 * collisions and swallows every failure, so the claim's answer, and the route's 409, can never change (the plan review's
 * F5). A throw, or a rollback SQLite made by itself (which leaves no transaction open and makes the COMMIT throw), is
 * warned once a process; a transaction still open is rolled back so the next statement on the handle starts clean.
 */
export function recordCollisionsAfterRefusal(db: DatabaseSync, attempt: CollisionAttempt, conflicts: readonly ClaimConflict[], now: number): void {
  try {
    recordCollisions(db, attempt, conflicts, now);
  } catch (e) {
    try { if (db.isTransaction) db.exec('ROLLBACK'); } catch { /* the transaction is already gone */ }
    if (!recordWarned) console.warn(`ccrc-server: claims: a collision record failed: ${e instanceof Error ? e.message : String(e)}`);
    recordWarned = true;
  }
}

/** One stored collision with both sides' runs and programmes joined. `null` program: that side's claim has no run. */
export interface CollisionRow {
  readonly id: number; readonly at: number; readonly project: string; readonly path: string; readonly claimedPath: string;
  readonly requesterId: string; readonly requesterRun: number | null; readonly requesterProgram: string | null;
  readonly holderClaimId: number; readonly holderId: string | null; readonly holderRun: number | null;
  readonly holderProgram: string | null;
}
export type CollisionsRead = { ok: true; rows: readonly CollisionRow[] } | { ok: false; detail: string };

/** Every collision at or after `since`, oldest first, with the holder's `heldBy` and `runId` and both runs' `program`. */
export function collisionsSince(db: DatabaseSync, since: number): CollisionsRead {
  try {
    const rows = db.prepare(
      'SELECT cc.id AS id, cc.at AS at, cc.project AS project, cc.path AS path, cc.claimedPath AS claimedPath, ' +
      'cc.requesterId AS requesterId, cc.requesterRun AS requesterRun, rr.program AS requesterProgram, ' +
      'cc.holderClaimId AS holderClaimId, c.heldBy AS holderId, c.runId AS holderRun, hr.program AS holderProgram ' +
      'FROM claim_collisions cc LEFT JOIN runs rr ON rr.id = cc.requesterRun ' +
      'LEFT JOIN claims c ON c.id = cc.holderClaimId LEFT JOIN runs hr ON hr.id = c.runId ' +
      'WHERE cc.at >= ? ORDER BY cc.at, cc.id',
    ).all(since) as unknown as CollisionRow[];
    return { ok: true, rows: rows.map((r) => ({ ...r })) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}
