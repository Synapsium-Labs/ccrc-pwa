// L3 adapter, context C3 (Session Conversation): the Overlord's account holds, `overlord_account_holds` (Overlord spec §3.6;
// renewal readings PR H, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-renewal-readings.md` Task 11, question 6, slug
// ordered-list-hold-is-a-row). A start that loaded what the launch profile does not list holds its account out of the
// Overlord's ordered list until the operator clears it. One row per lane.
//
// TWO WRITERS, each a different move of the one fact (the plan's Global Constraints; `writers-map.test.ts` names both):
// `holdAccount`, called only by the generations pass behind `holdOfStart`, and `clearAccountHold`, called only by the
// operator's clear door. `standingHolds` and `accountHolds` are the reads; `CoordStore` keeps one-line delegates of the same
// names. Nothing here decides: the pass's decider holds, the door validates, and this file records.
//
// A SEPARATE MODULE, beside `continuityStore.ts` (slug holds-store-in-its-own-module): one table and its two writers, so the
// store the start, generation, card and probe tables share grows by nothing.
import type { DatabaseSync } from 'node:sqlite';
import type { AccountHoldsRead } from '../../../shared/renewal-readings.js';

/** One standing hold as the operator's read serves it: the lane, its cause, the start that held it and when. No text. */
export interface StandingHold { readonly lane: string; readonly cause: string; readonly startId: number; readonly heldAt: number }

export type StandingHoldsRead = { readonly ok: true; readonly holds: readonly StandingHold[] } | { readonly ok: false; readonly detail: string };
export type HoldWrite = { readonly ok: true; readonly changed: boolean } | { readonly ok: false; readonly detail: string };

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Hold `lane` for the start `startId`. Written once per start: a standing hold, or a cleared one, from the same start or an
 *  earlier one answers `changed: false`, so a restart that asks the same start again never undoes the operator's clear. A later
 *  failing start holds a cleared lane again (a fresh `heldAt`), and moves a standing hold onto its own start id, keeping its
 *  `heldAt`. */
export function holdAccount(db: DatabaseSync, h: { readonly lane: string; readonly startId: number; readonly at: number }): HoldWrite {
  try {
    const r = db.prepare(
      "INSERT INTO overlord_account_holds (lane, cause, startId, heldAt) VALUES (?, 'launch-profile-unmet', ?, ?) "
      + 'ON CONFLICT (lane) DO UPDATE SET startId = excluded.startId, '
      + 'heldAt = CASE WHEN overlord_account_holds.clearedAt IS NULL THEN overlord_account_holds.heldAt ELSE excluded.heldAt END, '
      + 'clearedAt = NULL, clearedBy = NULL WHERE excluded.startId > overlord_account_holds.startId',
    ).run(h.lane, h.startId, h.at);
    return { ok: true, changed: Number(r.changes) === 1 };
  } catch (e) {
    return { ok: false, detail: `overlord_account_holds write failed: ${errText(e)}` };
  }
}

/** Clear the standing hold on `lane`, recording who cleared it and when. No standing hold answers `changed: false`. */
export function clearAccountHold(db: DatabaseSync, c: { readonly lane: string; readonly by: string; readonly at: number }): HoldWrite {
  try {
    const r = db.prepare('UPDATE overlord_account_holds SET clearedAt = ?, clearedBy = ? WHERE lane = ? AND clearedAt IS NULL')
      .run(c.at, c.by, c.lane);
    return { ok: true, changed: Number(r.changes) === 1 };
  } catch (e) {
    return { ok: false, detail: `overlord_account_holds write failed: ${errText(e)}` };
  }
}

/** The standing holds, oldest first, or why they could not be read: never an empty list in place of an unread one. */
export function standingHolds(db: DatabaseSync): StandingHoldsRead {
  try {
    const rows = db.prepare('SELECT lane, cause, startId, heldAt FROM overlord_account_holds WHERE clearedAt IS NULL ORDER BY heldAt, lane')
      .all() as unknown as StandingHold[];
    return { ok: true, holds: rows.map((r) => ({ lane: r.lane, cause: r.cause, startId: r.startId, heldAt: r.heldAt })) };
  } catch (e) {
    return { ok: false, detail: `overlord_account_holds read failed: ${errText(e)}` };
  }
}

/** The held lanes, every reader's shape (L0's `AccountHoldsRead`). */
export function accountHolds(db: DatabaseSync): AccountHoldsRead {
  const r = standingHolds(db);
  return r.ok ? { ok: true, lanes: r.holds.map((h) => h.lane) } : r;
}
