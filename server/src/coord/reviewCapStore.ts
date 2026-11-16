// The review-round cap's SQL (D-6795, D-6909, D-8125): the gate `openRun` reads, the once-per-cap-level ask, the
// coordinator's lift and the batch read of a run's cap state.
//
// It sits beside `store.ts` in the same ring and context (Coordination), because it is that file's body moved out
// (`ledgersStore.ts`'s idiom): every function takes the store's `DatabaseSync` and is synchronous, and `CoordStore` keeps
// one-line delegates of the same names. The decisions are `reviewcap.ts`'s (`coordLiftVerdict`) and nothing here.
import type { DatabaseSync } from 'node:sqlite';
import { REVIEW_ROUND_CAP, coordLiftEventDetail, coordLiftVerdict, type CoordLiftRefusal } from './reviewcap.js';
import { tx } from './tx.js';

/** One coordinator lift as the journal holds it, with how many the run has had. */
export interface CoordLiftRow { at: number; by: string; reason: string; rounds: number; capBefore: number; capAfter: number; count: number }

/** The cap state of one work run: the rounds so far, the ask's and the operator lift's times, the grant, and the last
 *  coordinator lift. An id with neither a review run nor a row has no entry. */
export interface ReviewCapState {
  rounds: number; askedAt: number | null; liftedAt: number | null; granted: number; askHandledAt: number | null;
  coordLift: CoordLiftRow | null;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',');

/** One row read: the operator's lift time and the coordinator's grant. An absent row is not lifted, granted 0. */
export function reviewCapGate(db: DatabaseSync, workRunId: number): { liftedAt: number | null; granted: number } {
  const row = db.prepare('SELECT liftedAt, granted FROM review_cap WHERE workRunId = ?')
    .get(workRunId) as { liftedAt: number | null; granted: number | null } | undefined;
  return { liftedAt: row?.liftedAt ?? null, granted: row?.granted ?? 0 };
}

/** Record that the cap's ask is raised. True when it raised: a new row, or an existing row whose ask is not open (never
 *  raised, or closed by a coordinator lift), which sets `askedAt = now` and clears `askHandledAt`. False while the ask is
 *  open. So the ask is once per cap level, not once per run. */
export function raiseReviewCapAsk(db: DatabaseSync, workRunId: number, now: number): boolean {
  const res = db.prepare(
    'INSERT INTO review_cap (workRunId, askedAt, liftedAt) VALUES (?, ?, NULL) '
    + 'ON CONFLICT(workRunId) DO UPDATE SET askedAt = excluded.askedAt, askHandledAt = NULL '
    + 'WHERE review_cap.askedAt IS NULL OR review_cap.askHandledAt IS NOT NULL',
  ).run(workRunId, now);
  return Number(res.changes) === 1;
}

/** The last coordinator lift of each run and how many it has had, in two statements whatever the batch (D-1299). */
export function coordLiftsOf(db: DatabaseSync, ids: readonly number[]): Map<number, { count: number; last: CoordLiftRow }> {
  const out = new Map<number, { count: number; last: CoordLiftRow }>();
  if (ids.length === 0) return out; // an empty `IN ()` is a SQLite syntax error
  const ph = placeholders(ids.length);
  const counts = db.prepare(`SELECT workRunId AS id, COUNT(*) AS n FROM review_cap_lifts WHERE workRunId IN (${ph}) GROUP BY workRunId`)
    .all(...ids) as { id: number; n: number }[];
  const lasts = db.prepare(
    'SELECT workRunId AS id, at, byId, reason, rounds, capBefore, capAfter FROM review_cap_lifts WHERE id IN '
    + `(SELECT MAX(id) FROM review_cap_lifts WHERE workRunId IN (${ph}) GROUP BY workRunId)`,
  ).all(...ids) as { id: number; at: number; byId: string; reason: string; rounds: number; capBefore: number; capAfter: number }[];
  const n = new Map(counts.map((c) => [Number(c.id), Number(c.n)]));
  for (const l of lasts) {
    const id = Number(l.id);
    out.set(id, { count: n.get(id) ?? 1, last: { at: Number(l.at), by: l.byId, reason: l.reason, rounds: Number(l.rounds),
      capBefore: Number(l.capBefore), capAfter: Number(l.capAfter), count: n.get(id) ?? 1 } });
  }
  return out;
}

/** D-6909: the review-cap state of a batch of runs, in two statements for the counts and the rows plus `coordLiftsOf`'s two
 *  (`healthFor`'s rule, D-1299). An id with no review run and no row has no entry; `hydrateRun` reads that as zero rounds. */
export function reviewCapStatesOf(db: DatabaseSync, ids: readonly number[]): Map<number, ReviewCapState> {
  const out = new Map<number, ReviewCapState>();
  if (ids.length === 0) return out;
  const ph = placeholders(ids.length);
  const blank = (rounds: number): ReviewCapState =>
    ({ rounds, askedAt: null, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null });
  const counts = db.prepare(`SELECT reviews AS id, COUNT(*) AS n FROM runs WHERE kind = 'review' AND reviews IN (${ph}) GROUP BY reviews`)
    .all(...ids) as { id: number; n: number }[];
  for (const c of counts) out.set(Number(c.id), blank(Number(c.n)));
  const rows = db.prepare(`SELECT workRunId AS id, askedAt, liftedAt, granted, askHandledAt FROM review_cap WHERE workRunId IN (${ph})`)
    .all(...ids) as { id: number; askedAt: number | null; liftedAt: number | null; granted: number | null; askHandledAt: number | null }[];
  const num = (v: number | null): number | null => (v === null ? null : Number(v));
  for (const r of rows) {
    const id = Number(r.id);
    out.set(id, { ...blank(out.get(id)?.rounds ?? 0), askedAt: num(r.askedAt), liftedAt: num(r.liftedAt),
      granted: Number(r.granted ?? 0), askHandledAt: num(r.askHandledAt) });
  }
  for (const [id, l] of coordLiftsOf(db, ids)) out.set(id, { ...(out.get(id) ?? blank(0)), coordLift: l.last });
  return out;
}

export type CoordLiftResult =
  | { ok: true; rounds: number; capBefore: number; capAfter: number; closedAskAt: number | null; liftId: number }
  | { ok: false; refused: CoordLiftRefusal; detail: string };

/** D-8125: a coordinator allows `REVIEW_ROUND_CAP` more review rounds for a work run. ONE transaction: the run, its rounds
 *  and its gate are read inside it and `coordLiftVerdict` decides, so two racing lifts at one cap cannot both pass. On ok:
 *  the grant is added, an open ask is marked handled (`askHandledAt`; the `operator_items` row is the route's to close
 *  through `moveItemInTx`, never written here), one `review_cap_lifts` row and one `run_events` row are written. Neither
 *  `askedAt` nor `liftedAt` is ever written, so an older build still reads a raised ask and no lift. */
export function liftReviewCapByCoordinator(db: DatabaseSync,
  i: { workRunId: number; byId: string; reason: string; now: number }): CoordLiftResult {
  return tx(db, (): CoordLiftResult => {
    const run = db.prepare('SELECT kind, state FROM runs WHERE id = ?').get(i.workRunId) as { kind: string; state: string } | undefined;
    const rounds = reviewCapStatesOf(db, [i.workRunId]).get(i.workRunId)?.rounds ?? 0;
    const gate = reviewCapGate(db, i.workRunId);
    const verdict = coordLiftVerdict({
      kind: run?.kind === 'work' || run?.kind === 'review' ? run.kind : 'unknown',
      closed: run?.state === 'done' || run?.state === 'failed', rounds, granted: gate.granted, liftedAt: gate.liftedAt,
    });
    if (!verdict.ok) return verdict;
    const ask = db.prepare('SELECT askedAt FROM review_cap WHERE workRunId = ? AND askedAt IS NOT NULL AND askHandledAt IS NULL')
      .get(i.workRunId) as { askedAt: number } | undefined;
    const closedAskAt = ask === undefined ? null : Number(ask.askedAt);
    db.prepare(
      'INSERT INTO review_cap (workRunId, askedAt, liftedAt, granted, askHandledAt) VALUES (?, NULL, NULL, ?, NULL) '
      + 'ON CONFLICT(workRunId) DO UPDATE SET granted = COALESCE(granted, 0) + ?, '
      + 'askHandledAt = CASE WHEN ? IS NULL THEN askHandledAt ELSE ? END',
    ).run(i.workRunId, REVIEW_ROUND_CAP, REVIEW_ROUND_CAP, closedAskAt, i.now);
    const lift = db.prepare(
      'INSERT INTO review_cap_lifts (workRunId, at, byId, reason, rounds, capBefore, capAfter, closedAskAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(i.workRunId, i.now, i.byId, i.reason, rounds, verdict.capBefore, verdict.capAfter, closedAskAt);
    db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.workRunId, i.now, run!.state, run!.state, i.byId, coordLiftEventDetail(rounds, verdict.capBefore, verdict.capAfter, i.reason));
    return { ok: true, rounds, capBefore: verdict.capBefore, capAfter: verdict.capAfter, closedAskAt, liftId: Number(lift.lastInsertRowid) };
  });
}
