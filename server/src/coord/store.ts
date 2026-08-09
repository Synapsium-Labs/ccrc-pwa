import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db.js';
import {
  isMailDeliveryState, isProgramState, isRunState, RUN_TRANSITIONS,
  type CoordCaps, type MailDeliveryState, type MailKind, type MailRejectCode, type NotifyEvent,
  type ProgramState, type RunItemTally, type RunState, type RunSummary, type WorkItemState,
} from '../../../shared/api.js';

/** One entry in `$REG/<id>.prhistory` (ccd/ccd:855-858). Re-declared as a TYPE
 *  here rather than parsed twice: `coord/prhistory.ts` owns the reader. */
export interface PrLineageEntry { pr: number; branch: string; phase: string; recordedAt: number }

/**
 * A run row as the STORE reads it: `RunSummary` (the wire shape) plus
 * `prLineage`, which is server-internal review material — folded once, at
 * close, from `.prhistory` — and deliberately absent from `RunSummary`
 * itself. `RunSummary`'s own docstring says why: it "rides the fleet socket
 * alongside a full session snapshot on every change", and `prLineage` is
 * neither small nor something that changes on every frame. `PrLineageEntry`
 * cannot live in `shared/` without `RunSummary` importing server-only
 * knowledge of `.prhistory`'s shape, so this stays a server-side supertype
 * rather than growing the wire type.
 */
export interface RunRow extends RunSummary { prLineage: PrLineageEntry[] }

/** `RunRow` -> `RunSummary`: strips `prLineage`, server-internal review
 *  material `RunSummary`'s own docstring says is "deliberately absent" from
 *  the wire shape — "neither small nor something that changes on every
 *  frame." Shared by `GET /api/runs` (`coord/routes.ts`) and the `runs` WS
 *  frame's own emitter (`watch.ts`'s `emitRuns`, Task 10) rather than each
 *  holding its own copy of the strip. */
export const toRunSummary = (row: RunRow): RunSummary => {
  const { prLineage: _prLineage, ...summary } = row;
  return summary;
};

export type OpenRunResult =
  | { id: number; program: string; state: RunState }
  | { refused: 'claimed-by-another'; by: string };

export type AdvanceResult =
  | { ok: true; from: RunState; to: RunState }
  | { ok: false; error: 'bad-transition'; from: RunState; to: RunState }
  | { ok: false; error: 'unknown-run' };

/** The raw row shape common to `run(id)` and `runs()` — named columns only
 *  (no `SELECT *` anywhere in this file), joined once against `programs` for
 *  its title. */
interface RunRowDb {
  id: number; program: string; programTitle: string; wave: number; waveOf: number | null;
  project: string; sessionId: string | null; workspace: string | null; branch: string | null;
  state: string; resumed: number; clearedAt: number | null; openedAt: number;
  dispatchedAt: number | null; closedAt: number | null; handoffCommit: string | null;
  prLineage: string | null;
}

const RUN_ROW_COLUMNS =
  'r.id, r.program, p.title AS programTitle, r.wave, r.waveOf, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.resumed, r.clearedAt, r.openedAt, r.dispatchedAt, r.closedAt, ' +
  'r.handoffCommit, r.prLineage';

/**
 * Every read and every write of the coordination database, in one class, and
 * SYNCHRONOUS throughout — `DatabaseSync` has no async surface, so a whole
 * transaction runs without yielding the event loop and nothing can interleave
 * inside one. That is why there is no `KeyedQueue` here and no lock: the
 * serialisation the `KeyedQueue` gives injection (`server/src/inject/queue.ts`)
 * is already given here by the runtime.
 *
 * NO `SELECT *` ANYWHERE IN THIS FILE. Columns are named explicitly on every
 * read, which is exactly what makes "an older build ignores unknown columns"
 * (spec:78-81) true rather than aspirational.
 */
export class CoordStore {
  constructor(readonly db: DatabaseSync) {}

  // ── programs & runs ────────────────────────────────────────────────────────

  openRun(input: {
    program: string; title: string; project: string;
    wave: number; waveOf: number | null; claimedBy: string;
  }): OpenRunResult {
    return tx(this.db, () => {
      // `AND claimedBy IS NOT NULL` (deviation D-12, found in Task 3 review —
      // the original query read the absolute first row regardless of whether
      // it was ever claimed): `reconstruct` inserts every rebuilt run with
      // `claimedBy` bound to NULL — it has no way to know who will resume the
      // program — so without this clause the lowest-id row of a reconstructed
      // program pinned the guard at NULL forever and a second coordinator was
      // never refused. Skipping the unclaimed rows finds the first row a real
      // `openRun` actually claimed, which is the one the refusal must read.
      const existing = this.db.prepare(
        'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
      ).get(input.program) as { claimedBy: string | null } | undefined;
      // spec:291-292: multi-coordinator arbitration is a NON-GOAL. A second
      // coordinator is refused, in words, rather than silently allowed to
      // interleave dispatches with the first one's.
      if (existing?.claimedBy != null && existing.claimedBy !== input.claimedBy) {
        return { refused: 'claimed-by-another' as const, by: existing.claimedBy };
      }
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.program, input.title, now, 'active');
      const res = this.db.prepare(
        'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(input.program, input.wave, input.waveOf, input.project, 'planned', input.claimedBy, now);
      return { id: Number(res.lastInsertRowid), program: input.program, state: 'planned' as const };
    });
  }

  /**
   * The ONLY way a run's state changes, and the only place `run_events` is
   * written — one call, so "every transition records who caused it"
   * (spec:126) is a property of the code rather than of everyone remembering.
   *
   * `causedBy` is `'coordinator' | 'operator' | <session id>` and is NOT
   * validated against the registry: it is attribution, not authentication
   * (spec:26-30), and pretending otherwise in a column comment would be the
   * kind of claim this repo has already had to retract elsewhere.
   */
  advance(runId: number, to: RunState, causedBy: string, detail?: string): AdvanceResult {
    return tx(this.db, () => {
      const row = this.db.prepare('SELECT state FROM runs WHERE id = ?').get(runId) as
        { state: string } | undefined;
      if (!row) return { ok: false as const, error: 'unknown-run' as const };
      const from = isRunState(row.state) ? row.state : 'unknown';
      if (!(RUN_TRANSITIONS[from] as readonly string[]).includes(to)) {
        return { ok: false as const, error: 'bad-transition' as const, from, to };
      }
      const now = Date.now();
      this.db.prepare(
        "UPDATE runs SET state = ?, closedAt = CASE WHEN ? IN ('done','failed') THEN ? ELSE closedAt END " +
        'WHERE id = ?',
      ).run(to, to, now, runId);
      this.db.prepare(
        'INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(runId, now, from, to, causedBy, detail ?? null);
      return { ok: true as const, from, to };
    });
  }

  /**
   * Deviation (found while executing Task 9; not in the plan's own Task 9
   * File Structure entry, which named only `routes.ts` — see the plan's D-45):
   * `POST /api/runs`'s body may name an existing workspace (`sessionId?`,
   * wave N>=2 reclaiming the workspace it held since wave 1) and the OPEN
   * route places the hold immediately — spec:120-123, "When sessionId names
   * an existing workspace, places the hold immediately." Task 9's dispatch
   * route then needs to read `run.sessionId` back OFF THE ROW to decide
   * `CCD_ARGV.wsAdd` vs `CCD_ARGV.ensure` (D-1: "No sessionId on the run ->
   * ws-add; otherwise -> ensure") — but `openRun`'s own signature never took
   * a `sessionId`, and no writer of the column existed for anything but
   * `markDispatched` (a DISPATCH-time write that also stamps
   * `dispatchedAt`/`resumed`, both false of an open-time claim). This is the
   * matching open-time write, on `foldPrLineage`/`setHandoffCommit`'s single-
   * column-`UPDATE` pattern, deliberately NOT touching `dispatchedAt` or
   * `resumed` — a run whose wave N>=2 open just reclaimed its workspace has
   * not been dispatched yet, and must not read as though it had.
   */
  setSession(runId: number, sessionId: string): void {
    this.db.prepare('UPDATE runs SET sessionId = ? WHERE id = ?').run(sessionId, runId);
  }

  /**
   * `runs.clearedAt` — the proof D-1's post-resume `/clear` actually
   * committed (`RunSummary.clearedAt`'s own docstring; the column landed in
   * Task 2's v1 DDL, unwritten, per D-1's own amendment). Mirrors
   * `foldPrLineage`/`setHandoffCommit`: a single-column `UPDATE`, called once,
   * by the dispatch route, and ONLY when the injected `/clear` actually
   * verified — a refused send (dialog open, draft present) leaves this
   * column honestly null, never called with a guess. */
  setClearedAt(runId: number, at: number): void {
    this.db.prepare('UPDATE runs SET clearedAt = ? WHERE id = ?').run(at, runId);
  }

  /** Dispatch's write: the workspace a run landed in, and whether it was a
   *  fresh spawn or D-1's resume+`/clear`. Does NOT itself advance `state` —
   *  the caller (Task 9's dispatch route) calls `advance` separately, so the
   *  two writes stay independently attributable in `run_events`.
   *
   *  `workspace`/`branch` are nullable, matching the column (`runs.workspace`/
   *  `runs.branch`, both `TEXT` with no `NOT NULL`) and `RunSummary`'s own
   *  wire type — Task 9's dispatch route resolves both from the live
   *  registry (falling back to the run row on wave N>=2, the identical
   *  fallback `fingerprint.ts`'s `verifyDone` uses), which can genuinely come
   *  back empty for a registry row `readRegistry` otherwise accepted. */
  markDispatched(runId: number, sessionId: string, workspace: string | null, branch: string | null,
                 resumed: boolean, at: number = Date.now()): void {
    this.db.prepare(
      'UPDATE runs SET sessionId = ?, workspace = ?, branch = ?, resumed = ?, dispatchedAt = ? WHERE id = ?',
    ).run(sessionId, workspace, branch, resumed ? 1 : 0, at, runId);
  }

  /** `runs.prLineage`, written once at close from a `.prhistory` read
   *  (`coord/prhistory.ts`). Stored as JSON (spec:92-95's fold), never
   *  reconstructed lazily on read — the same "store the render, don't defer
   *  it" reasoning `mail_deliveries.envelope`'s own column comment states. */
  foldPrLineage(runId: number, lineage: readonly PrLineageEntry[]): void {
    this.db.prepare('UPDATE runs SET prLineage = ? WHERE id = ?').run(JSON.stringify(lineage), runId);
  }

  /**
   * `runs.handoffCommit`, written once at close (fix, found in a later Task 3
   * review — D-25): before this method the column had exactly one writer in
   * the whole tree, `reconstruct`'s disaster-recovery INSERT, so every run
   * this build actually closed could only ever read `handoffCommit: null` on
   * the wire — silently disagreeing with the fingerprint the close route
   * re-measures and rejects a claim over (`fingerprint.ts`'s `no-handoff-
   * commit`, D-2). Mirrors `foldPrLineage`'s shape on purpose: a single-
   * column UPDATE, called once, at close. Task 9's close route (not yet
   * written in this tree) is the intended caller — the same "known-green but
   * unconsumed" posture this task's own docstring already gives
   * `RunSummary`/`MailSummary`.
   */
  setHandoffCommit(runId: number, handoffCommit: string): void {
    this.db.prepare('UPDATE runs SET handoffCommit = ? WHERE id = ?').run(handoffCommit, runId);
  }

  run(id: number): RunRow | null {
    const row = this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program WHERE r.id = ?`,
    ).get(id) as RunRowDb | undefined;
    return row ? this.hydrateRun(row) : null;
  }

  runs(opts: { includeClosed?: boolean } = {}): RunRow[] {
    const where = opts.includeClosed ? '' : "WHERE r.state NOT IN ('done','failed')";
    const rows = this.db.prepare(
      `SELECT ${RUN_ROW_COLUMNS} FROM runs r JOIN programs p ON p.slug = r.program ${where} ORDER BY r.id`,
    ).all() as unknown as RunRowDb[];
    return rows.map((row) => this.hydrateRun(row));
  }

  /** `detail` joins the SELECT (fix, found in Task 9 review — D-47): `advance`
   *  has always taken a `detail` parameter, but until the dispatch route's
   *  refused-`/clear` fix started passing one, nothing in this file ever
   *  wrote a non-null value, so no reader had ever needed the column back.
   *  Widening the return type is additive-only — every existing caller reads
   *  a subset of these fields, never the whole shape by positional index. */
  runEvents(runId: number): { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[] {
    return this.db.prepare(
      'SELECT at, fromState, toState, causedBy, detail FROM run_events WHERE runId = ? ORDER BY id',
    ).all(runId) as { at: number; fromState: string; toState: string; causedBy: string; detail: string | null }[];
  }

  /**
   * The writer `programs.state` had none of, outside `openRun`'s hardcoded
   * `'active'` at first open (fix, found in a later Task 3 review — D-26):
   * the two `INSERT … ON CONFLICT(slug) DO UPDATE` sites (`openRun`,
   * `reconstruct`) both only ever touch `title` in their conflict arm, so a
   * program could never be retired. That silently disarmed
   * `resolveCoordinator(null)` the moment a SECOND program existed — its
   * "single active program" guard reads `ambiguous` (`active.length !== 1`)
   * forever once a prior program's runs finish and nothing ever moves it out
   * of `active`, which is this build's ordinary steady state, not an edge
   * case. Mirrors `setWorkItemState`'s shape.
   *
   * *Who* calls this and *when* a program should retire was deliberately left
   * to "whichever task closes the last run of a program" — Task 9's close
   * route now does (deviation D-51, found in Task 9 review: this writer had
   * ZERO callers in the tree Task 9 actually shipped, and this very
   * docstring still said "not yet written" about the task that had, by then,
   * been written for two commits). It checks `programOpenRunCount` below
   * immediately after its own final `advance()` succeeds, and calls this
   * with `'done'` or `'abandoned'` depending on how the closing run itself
   * ended — see the close route's own comment for the policy and its stated
   * limitation.
   */
  setProgramState(slug: string, state: ProgramState): void {
    this.db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run(state, slug);
  }

  /** Count of this program's runs still in a NON-terminal state — the
   *  question `setProgramState`'s caller (the close route, D-51) needs
   *  answered to know whether the run it just closed was the LAST one: zero
   *  remaining means nothing under this program can dispatch, mail, or hold
   *  a workspace open any more, so `resolveCoordinator`'s "exactly one
   *  active program" guard (D-26) must stop counting it. Mirrors
   *  `capsUsage().running`'s own `state NOT IN ('done','failed')` predicate,
   *  scoped to one program instead of the whole fleet. */
  programOpenRunCount(program: string): number {
    return (this.db.prepare(
      "SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ('done','failed')",
    ).get(program) as { c: number }).c;
  }

  programs(): { slug: string; title: string; state: ProgramState }[] {
    const rows = this.db.prepare('SELECT slug, title, state FROM programs ORDER BY slug')
      .all() as { slug: string; title: string; state: string }[];
    // D-8: read through the guard, never a cast — the same rule `run()` below
    // holds for `RunState`.
    return rows.map((r) => ({ slug: r.slug, title: r.title, state: isProgramState(r.state) ? r.state : 'unknown' }));
  }

  /** `RunRowDb` -> `RunRow`. The one place a raw `runs` row becomes the typed
   *  shape everything else in this class and its callers use — every enum
   *  column goes through its guard here, never a cast, so this is also the
   *  one place that rule could be forgotten for a future column. */
  private hydrateRun(row: RunRowDb): RunRow {
    return {
      id: row.id, program: row.program, programTitle: row.programTitle,
      wave: row.wave, waveOf: row.waveOf, project: row.project,
      sessionId: row.sessionId, workspace: row.workspace, branch: row.branch,
      state: isRunState(row.state) ? row.state : 'unknown',
      resumed: row.resumed !== 0,
      // A real column (`runs.clearedAt`), read straight through — not a
      // placeholder. It reads null today because nothing writes it yet: the
      // dispatch route that performs the post-resume `/clear` is Task 9's, and
      // until it lands every run's answer is honestly "nothing has cleared
      // anything", not a stand-in for a missing column.
      clearedAt: row.clearedAt,
      openedAt: row.openedAt, dispatchedAt: row.dispatchedAt, closedAt: row.closedAt,
      handoffCommit: row.handoffCommit,
      items: this.itemTally(row.id),
      unreadMail: this.unreadMailCount(row.id, row.sessionId),
      prLineage: row.prLineage ? (JSON.parse(row.prLineage) as PrLineageEntry[]) : [],
    };
  }

  private unreadMailCount(runId: number, sessionId: string | null): number {
    if (sessionId === null) return 0;
    return (this.db.prepare(
      "SELECT count(*) AS c FROM mail_deliveries d JOIN mail m ON m.id = d.mailId " +
      "WHERE m.runId = ? AND d.toId = ? AND d.state IN ('queued','delivered')",
    ).get(runId, sessionId) as { c: number }).c;
  }

  // ── caps ───────────────────────────────────────────────────────────────────

  caps(): CoordCaps {
    const row = this.db.prepare(
      'SELECT maxConcurrentWorkers, maxSessionsPerDay FROM coordinator_state WHERE id = 1',
    ).get() as { maxConcurrentWorkers: number; maxSessionsPerDay: number };
    return { maxConcurrentWorkers: row.maxConcurrentWorkers, maxSessionsPerDay: row.maxSessionsPerDay };
  }

  setCaps(next: CoordCaps): void {
    this.db.prepare(
      'UPDATE coordinator_state SET maxConcurrentWorkers = ?, maxSessionsPerDay = ?, updatedAt = ? WHERE id = 1',
    ).run(next.maxConcurrentWorkers, next.maxSessionsPerDay, Date.now());
  }

  /**
   * The two COUNTS, derived. `spec:201` says "rows in `coordinator_state`",
   * and the limits ARE rows there — but a stored counter beside them would be a
   * second copy of what `runs` already knows, and the copy is always the one
   * that drifts (`server/src/limits.ts:34-40` states the same lesson about
   * mirroring `_ws_least_loaded`: "put the authority in one place and let the
   * other predict"). Here there is no second box to predict for, so there is no
   * excuse for a second copy at all.
   */
  capsUsage(now: number = Date.now()): { running: number; dispatchedIn24h: number } {
    // `dispatchedAt IS NOT NULL` (deviation D-13, found in Task 3 review):
    // `state NOT IN ('done','failed')` alone also matched `planned` — the
    // state `openRun` writes and Task 9's `ambiguous-dispatch` refusal
    // deliberately leaves a run in, with no session and no workspace. Three
    // botched dispatches on one program would otherwise pin `running` at the
    // default `maxConcurrentWorkers` forever. In normal dispatch flow
    // `dispatchedAt` is the one column only `markDispatched` ever sets, so it
    // names the runs that actually hold a session rather than every
    // non-terminal state; `reconstruct`'s `working` wave (below) is the one
    // other writer, and for the same reason — it too holds a live session,
    // just one the database lost track of rather than one `markDispatched`
    // just minted.
    const running = (this.db.prepare(
      "SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND state NOT IN ('done','failed')",
    ).get() as { c: number }).c;
    const dispatchedIn24h = (this.db.prepare(
      'SELECT count(*) AS c FROM runs WHERE dispatchedAt IS NOT NULL AND dispatchedAt > ?',
    ).get(now - 24 * 3600_000) as { c: number }).c;
    return { running, dispatchedIn24h };
  }

  // ── work items ─────────────────────────────────────────────────────────────

  addWorkItem(runId: number, title: string, blockedBy: readonly number[]): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO work_items (runId, title, state, blockedBy) VALUES (?, ?, ?, ?)',
    ).run(runId, title, 'pending', JSON.stringify(blockedBy));
    return { id: Number(res.lastInsertRowid) };
  }

  setWorkItemState(id: number, state: WorkItemState, claimedBy: string | null): void {
    this.db.prepare('UPDATE work_items SET state = ?, claimedBy = ? WHERE id = ?').run(state, claimedBy, id);
  }

  itemTally(runId: number): RunItemTally {
    const total = (this.db.prepare('SELECT count(*) AS c FROM work_items WHERE runId = ?')
      .get(runId) as { c: number }).c;
    const done = (this.db.prepare("SELECT count(*) AS c FROM work_items WHERE runId = ? AND state = 'done'")
      .get(runId) as { c: number }).c;
    return { done, total };
  }

  // ── mail (rows only; ingress validation is routes.ts, delivery is watch.ts) ─

  insertMail(m: { fromId: string; fromUuid: string; toId: string; runId: number | null;
                  kind: MailKind; subject: string; body: string;
                  artifacts: readonly string[] }): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body, artifacts) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), m.fromId, m.fromUuid, m.toId, m.runId, m.kind, m.subject, m.body,
      JSON.stringify(m.artifacts));
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * `'coordinator'` is a ROLE, not a session id (Task 7's own docstring on the
   * ingress route). With a `runId`, it is that run's own claim; with none, it
   * is the claim of the ONE active program — ambiguous (more than one active
   * program) or absent (no program is both active and claimed) both answer
   * `null`, which the caller turns into `unknown-recipient`: "no guessing" —
   * an agent-to-agent message delivered to the wrong session is worse than
   * one refused with a reason.
   *
   * Mirrors `openRun`'s own one-coordinator guard query (`claimedBy IS NOT
   * NULL ORDER BY id LIMIT 1`) rather than re-deriving a different rule for
   * the same fact.
   */
  resolveCoordinator(runId: number | null): string | null {
    if (runId !== null) {
      const row = this.db.prepare('SELECT claimedBy FROM runs WHERE id = ?')
        .get(runId) as { claimedBy: string | null } | undefined;
      return row?.claimedBy ?? null;
    }
    const active = this.db.prepare("SELECT slug FROM programs WHERE state = 'active'")
      .all() as { slug: string }[];
    if (active.length !== 1) return null;   // no single active program: ambiguous or absent
    const row = this.db.prepare(
      'SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id LIMIT 1',
    ).get(active[0]!.slug) as { claimedBy: string | null } | undefined;
    return row?.claimedBy ?? null;
  }

  /** One delivery row by id, for the ack route: it must know who a delivery
   *  is ADDRESSED TO before deciding whether the acking session may touch it
   *  — `dueDeliveries` cannot answer that, it is scoped to what a SWEEP should
   *  inject, not to one row by id. */
  delivery(id: number): { id: number; mailId: number; toId: string; state: MailDeliveryState } | null {
    const row = this.db.prepare('SELECT id, mailId, toId, state FROM mail_deliveries WHERE id = ?')
      .get(id) as { id: number; mailId: number; toId: string; state: string } | undefined;
    if (!row) return null;
    return { id: row.id, mailId: row.mailId, toId: row.toId,
             state: isMailDeliveryState(row.state) ? row.state : 'unknown' };
  }

  queueDelivery(mailId: number, toId: string, envelope: string): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, ?, ?)',
    ).run(mailId, toId, 'queued', envelope);
    return { id: Number(res.lastInsertRowid) };
  }

  /**
   * Overwrites a delivery's stored `envelope` — used by the ingress route
   * ONLY, once, immediately after `queueDelivery`, to close a bug fix-round
   * finding 5 / D-41 named: the envelope's own `ack:` line has to name the
   * DELIVERY id (what `delivery(id)`/`markAcked` resolve by, both above),
   * but `mail.id` and `mail_deliveries.id` are two SEPARATE `AUTOINCREMENT`
   * sequences (`schema.ts`) that only happen to walk together while every
   * mail resolves to exactly one delivery. The delivery id does not exist
   * until the row is inserted, so the route inserts the row with an empty
   * envelope, renders the real one now that it can name the delivery's own
   * id, and calls this to land it — all inside the SAME transaction
   * `queueDelivery` ran in, so no reader ever observes the empty
   * intermediate. This is the second half of that one INSERT, not a
   * re-render: `renderEnvelope` itself still runs exactly once, at queue
   * time (spec:176-177, "verbatim, never re-rendered"), and this method
   * never re-derives its argument — it only stores what the caller already
   * computed. */
  setDeliveryEnvelope(id: number, envelope: string): void {
    this.db.prepare('UPDATE mail_deliveries SET envelope = ? WHERE id = ?').run(envelope, id);
  }

  /**
   * The due set for one sweep — two arms, not one (deviation, found in Task 3
   * review — see the plan's D-10). Spec:174-177 requires replay: "Until
   * acked, the delivery replays — verbatim, never re-rendered — on later
   * sweeps after cooldown." Only the `queued` arm shipped originally —
   * `markDelivered` moves a row OUT of `queued` and nothing ever moved it
   * back, so an unacked delivery could never be re-selected once injected,
   * which made replay-until-ack structurally impossible.
   *
   * `replayMs` is the caller's `MAIL_REPLAY_MS` (Task 8, `watch.ts`), passed
   * in rather than owned here: this file stores rows, it does not own mail
   * delivery POLICY — the same reason `capsUsage`/`markDispatched` take `now`
   * from the caller instead of calling `Date.now()` internally.
   *
   * The replay arm ALSO gates on `nextAttemptAt` (fix, found in Task 3
   * review — the two arms were asymmetric: `queued`'s arm always read it,
   * `delivered`'s never did). `backOff` writes `attempts`/`lastError`/
   * `nextAttemptAt` on whatever row it is given, delivered rows included —
   * it never moves a row's `state` — so a delivered row that just backed off
   * was selected again on the very next sweep regardless of the spacing
   * `backOff` had just written, making exponential backoff a no-op for
   * every replay (spec:170-172 held only for a delivery's first attempt).
   * The column defaults to 0, so a delivered row that has never backed off
   * is unaffected by this clause.
   *
   * `MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0))`, not
   * `COALESCE(ingestedAt, deliveredAt)` (fix, review findings 2/6): a REPLAY
   * calls only `markDelivered`, which writes a fresh `deliveredAt` and never
   * touches `ingestedAt` (`markIngested`'s own docstring). Under the old
   * `COALESCE`, once `ingestedAt` had ever been written once it was picked
   * forever and the new, later `deliveredAt` a replay just wrote was
   * silently ignored — so the clock froze at the FIRST `UserPromptSubmit`
   * edge and every replay after that one was due again almost immediately,
   * spaced only by the per-session `MAIL_COOLDOWN_MS` instead of
   * `MAIL_REPLAY_MS` (a 120 s floor standing in for the intended 10
   * minutes). `MAX` always picks whichever of the two actually happened
   * last, so a fresh replay's `deliveredAt` re-dates the clock exactly the
   * way the first delivery's did. Both arguments are `COALESCE`d to `0`
   * because SQLite's multi-argument `max()` returns NULL — not the other
   * argument — the instant ANY argument is NULL, and `ingestedAt` is NULL
   * until the first edge is ever observed.
   */
  dueDeliveries(now: number, replayMs: number): { id: number; mailId: number; toId: string;
                                attempts: number; envelope: string; deliveredAt: number | null;
                                ingestedAt: number | null }[] {
    return this.db.prepare(
      'SELECT id, mailId, toId, attempts, envelope, deliveredAt, ingestedAt FROM mail_deliveries ' +
      "WHERE (state = 'queued' AND nextAttemptAt <= ?) " +
      "OR (state = 'delivered' AND MAX(COALESCE(ingestedAt, 0), COALESCE(deliveredAt, 0)) + ? <= ? " +
      'AND nextAttemptAt <= ?) ' +
      'ORDER BY id',
    ).all(now, replayMs, now, now) as { id: number; mailId: number; toId: string; attempts: number;
                    envelope: string; deliveredAt: number | null; ingestedAt: number | null }[];
  }

  /**
   * Every `delivered`, unacked row, with NO timing filter — unlike
   * `dueDeliveries` above, which only surfaces a `delivered` row once
   * `replayMs` has already elapsed since it last moved the clock. That is
   * exactly wrong for the ONE thing `ingestedAt` exists to do (review
   * finding 3): `hookstate.ts`'s own docstring calls a `UserPromptSubmit`
   * newer than delivery "the cheapest available proof that the injected
   * turn actually STARTED" — proof that is only worth anything while the
   * turn it is proving might still be running, i.e. in the minutes right
   * after delivery, not ten minutes later once `dueDeliveries` finally
   * agrees to look. A sweep that samples the edge only through
   * `dueDeliveries`'s own result can therefore never observe it before the
   * replay it was supposed to prevent. This is the set that sweep instead
   * walks EVERY tick of its own clock, independent of due-ness, purely to
   * keep `ingestedAt` current.
   */
  deliveredUnacked(): { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[] {
    return this.db.prepare(
      "SELECT id, toId, deliveredAt, ingestedAt FROM mail_deliveries WHERE state = 'delivered'",
    ).all() as { id: number; toId: string; deliveredAt: number | null; ingestedAt: number | null }[];
  }

  markDelivered(id: number, at: number): void {
    this.db.prepare('UPDATE mail_deliveries SET state = ?, deliveredAt = ? WHERE id = ?')
      .run('delivered', at, id);
  }

  /** The `UserPromptSubmit` edge (`hookstate.ts:23-34`). Deliberately does
   *  NOT touch `deliveredAt` — a REPLAY re-dates the clock through its own
   *  fresh `markDelivered` call, and `dueDeliveries`'s `MAX(...)` above is
   *  what combines the two rather than either writer clobbering the other's
   *  column. */
  markIngested(id: number, at: number): void {
    this.db.prepare('UPDATE mail_deliveries SET ingestedAt = ? WHERE id = ?').run(at, id);
  }

  /** false when already acked or absent — an ack is idempotent, but the
   *  CALLER (the ack route) needs to know whether ITS call was the one that
   *  landed, so a double-ack answers honestly rather than reporting success
   *  twice. */
  markAcked(id: number, at: number): boolean {
    const row = this.db.prepare('SELECT state FROM mail_deliveries WHERE id = ?')
      .get(id) as { state: string } | undefined;
    if (!row || row.state === 'acked') return false;
    this.db.prepare('UPDATE mail_deliveries SET state = ?, ackedAt = ? WHERE id = ?')
      .run('acked', at, id);
    return true;
  }

  backOff(id: number, lastError: string, nextAttemptAt: number): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET attempts = attempts + 1, lastError = ?, nextAttemptAt = ? WHERE id = ?',
    ).run(lastError, nextAttemptAt, id);
  }

  rejectDelivery(id: number, code: MailRejectCode, lastError: string): void {
    this.db.prepare(
      'UPDATE mail_deliveries SET state = ?, rejectCode = ?, lastError = ? WHERE id = ?',
    ).run('rejected', code, lastError, id);
  }

  recordRejection(r: { code: MailRejectCode; fromId?: string; fromUuid?: string; toId?: string;
                       runId?: number | null; kind?: string; subject?: string;
                       detail?: string }): void {
    this.db.prepare(
      'INSERT INTO mail_rejections (at, code, fromId, fromUuid, toId, runId, kind, subject, detail) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(Date.now(), r.code, r.fromId ?? null, r.fromUuid ?? null, r.toId ?? null, r.runId ?? null,
      r.kind ?? null, r.subject ?? null, r.detail ?? null);
  }

  /** Every recorded rejection, oldest first — spec:147-148's "a rejected
   *  message is a fact about the fleet" needs a row, not necessarily a
   *  reader; this file's own tests are today's only consumer (PR J's feed is
   *  the eventual one). `code` stays a raw `string`: `mail_rejections.code`
   *  is not one of D-8's five we-do-not-know columns (it is written only from
   *  a typed `MailRejectCode` today, but nothing here re-validates it — the
   *  same honesty `RunRowDb`'s comment gives every OTHER column that IS
   *  guarded, stated instead of silently cast). */
  rejections(): { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[] {
    return this.db.prepare(
      'SELECT id, at, code, fromId, fromUuid, toId, runId, kind, subject, detail ' +
      'FROM mail_rejections ORDER BY id',
    ).all() as { id: number; at: number; code: string; fromId: string | null; fromUuid: string | null;
                 toId: string | null; runId: number | null; kind: string | null; subject: string | null;
                 detail: string | null }[];
  }

  // ── feed (Task 10, orchestrator-added scope: the durable archive behind ────
  //    NotifyLog's in-memory ring — PR J interface 5)

  /** Newest rows to keep. Also the upper clamp `feedEvents` enforces on its
   *  own `limit` argument, so a route can never be made to walk (and
   *  JSON-stringify) more history than the table is ever allowed to hold. */
  private static readonly FEED_RETENTION = 2000;

  /**
   * Append one notify event to the durable feed, beside `NotifyLog.record`
   * (`FleetWatcher.pushOne`'s own call — see that method's docstring). ALL
   * kinds land here, not just `mail`/`run`: a scrollback that silently
   * dropped `ask`/`done`/`merged` would not be a scrollback. `epoch`/`seq`
   * are `NotifyLog`'s own pair AT RECORD TIME, mirrored for correlation —
   * this table's own `id` is what orders `feedEvents`, since `seq` alone
   * cannot: it resets to 0 on every epoch rotation (a restart with an
   * unreadable watermark file), so two rows from different epochs can carry
   * the same `seq`.
   *
   * Retention (newest `FEED_RETENTION`) is pruned in the SAME transaction as
   * the insert, so a reader can never observe more rows than the retention
   * promise, even mid-write.
   */
  recordFeedEvent(epoch: string, e: NotifyEvent): void {
    tx(this.db, () => {
      this.db.prepare(
        'INSERT INTO feed_events (epoch, seq, at, kind, sessionId, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(epoch, e.seq, e.at, e.kind, e.sessionId, e.title, e.body);
      this.db.prepare(
        'DELETE FROM feed_events WHERE id NOT IN (SELECT id FROM feed_events ORDER BY id DESC LIMIT ?)',
      ).run(CoordStore.FEED_RETENTION);
    });
  }

  /**
   * `GET /api/feed`'s reader — oldest-first (the route's own promise), `limit`
   * clamped into `(0, FEED_RETENTION]` so neither an absent/non-positive
   * value nor one past the table's own retention ceiling can be asked for.
   * `kind` is read back with a cast, not a guard: see this file's own header
   * comment (schema.ts) on why `feed_events.kind` is not one of D-8's five
   * we-do-not-know columns.
   */
  feedEvents(limit: number): NotifyEvent[] {
    const n = Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), CoordStore.FEED_RETENTION)
      : CoordStore.FEED_RETENTION;
    const rows = this.db.prepare(
      'SELECT seq, at, kind, sessionId, title, body FROM ' +
      '(SELECT * FROM feed_events ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
    ).all(n) as { seq: number; at: number; kind: string; sessionId: string; title: string; body: string }[];
    return rows.map((r) => ({
      seq: r.seq, at: r.at, kind: r.kind as NotifyEvent['kind'], sessionId: r.sessionId,
      title: r.title, body: r.body,
    }));
  }

  // ── notify lanes (Task 10): what FleetWatcher polls to raise `mail`/`run` ──
  //    NotifyEvent pushes — level-triggered watermarks, the same shape every
  //    other lane in this build uses for "what is new since I last looked".

  /** `mail_deliveries`'s current high-water id — `FleetWatcher`'s priming read
   *  (its own `tick()`'s "no storm on boot" rule, extended to the mail lane
   *  per spec's restart semantics), so a restart does not re-notify for every
   *  delivery already queued before this process started. */
  maxMailDeliveryId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM mail_deliveries').get() as { m: number }).m;
  }

  /**
   * Every `mail_deliveries` row with `id > sinceId`, oldest first — mail
   * queued since `FleetWatcher` last looked, regardless of whether the
   * delivery lane (`sweepMail`) has attempted injection yet: spec:243-244's
   * push fires "at queue time (the message exists and is a record then), not
   * at injection — otherwise a message that never becomes deliverable is a
   * fact nothing recorded."
   *
   * `mailId` (for the push's non-collapsing tag, spec:236-237) and
   * `deliveryId` (the watermark's own unit) are deliberately BOTH returned —
   * two independent `AUTOINCREMENT` sequences, the same D-41 reason
   * `setDeliveryEnvelope`'s own comment gives for never assuming they walk
   * together. `workspace`/`project` come from the delivery's RUN when one is
   * named (`mail.runId`, nullable) — the common case, worker<->coordinator
   * mail inside a wave — and are `null` for ad-hoc mail with no run context;
   * the caller degrades both (`workspace ?? toId` for the title, same as
   * `pushOne`'s own fallback chains elsewhere in this file's callers).
   */
  mailQueuedSince(sinceId: number): { deliveryId: number; mailId: number; toId: string; kind: string;
                                       subject: string; project: string | null;
                                       workspace: string | null }[] {
    return this.db.prepare(
      'SELECT d.id AS deliveryId, m.id AS mailId, d.toId, m.kind, m.subject, r.project, r.workspace ' +
      'FROM mail_deliveries d JOIN mail m ON m.id = d.mailId LEFT JOIN runs r ON r.id = m.runId ' +
      'WHERE d.id > ? ORDER BY d.id',
    ).all(sinceId) as { deliveryId: number; mailId: number; toId: string; kind: string; subject: string;
                         project: string | null; workspace: string | null }[];
  }

  /** `run_events`'s current high-water id — same priming role as
   *  `maxMailDeliveryId`, over the run-transition notify lane. */
  maxRunEventId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM run_events').get() as { m: number }).m;
  }

  /**
   * Every `run_events` row with `id > sinceId`, oldest first, joined back to
   * the run it belongs to — spec:243-244's `run` push copy needs `state`,
   * `workspace ?? project`, `program:<slug> wave <n>/<of>`, all of which live
   * on `runs` already (`program` IS the slug — `runs.program REFERENCES
   * programs(slug)`; the copy names the slug, never the program's title, so
   * no join to `programs` is needed here, unlike `RUN_ROW_COLUMNS`'s own
   * join for `programTitle`).
   *
   * `sessionId` rides straight off `runs.sessionId` (nullable — a run can
   * transition, e.g. `planned` -> `failed`, before dispatch ever mints one);
   * the caller (`FleetWatcher`) skips a row with no session rather than
   * guess one, since presence-gating and the push's own target both need a
   * real session id.
   */
  runEventsSince(sinceId: number): { eventId: number; runId: number; toState: string; sessionId: string | null;
                                      project: string; workspace: string | null; program: string;
                                      wave: number; waveOf: number | null }[] {
    return this.db.prepare(
      'SELECT re.id AS eventId, re.runId, re.toState, r.sessionId, r.project, r.workspace, ' +
      'r.program, r.wave, r.waveOf ' +
      'FROM run_events re JOIN runs r ON r.id = re.runId ' +
      'WHERE re.id > ? ORDER BY re.id',
    ).all(sinceId) as { eventId: number; runId: number; toState: string; sessionId: string | null;
                         project: string; workspace: string | null; program: string;
                         wave: number; waveOf: number | null }[];
  }

  // ── disaster recovery (spec:82-85) ─────────────────────────────────────────

  /**
   * Rebuild a program's runs from the three artefacts that survive the database:
   * the markdown ledger (`docs/superpowers/programs/<slug>.md`, parsed by the
   * CALLER — nothing machine-reads it in ccrc, and this signature is what keeps
   * that true: it takes a parsed shape, never a path), the registry row, and
   * `.prhistory`.
   *
   * The drill is a TEST, not an operator tool, and its value is a constraint on
   * future columns: a column that cannot be reconstructed from these three
   * turns `coord-store.test.ts` red and has to justify itself in the diff.
   *
   * Two judgment calls the input does not fully pin, since the registry names
   * only the CURRENT state of one workspace, not each wave's own history:
   *  - every rebuilt run shares the registry's `sessionId`/`workspace`/
   *    `branch` — true by construction under D-1 (a session id is stable
   *    across waves; only its harness uuid rotates on `/clear`).
   *  - `.prhistory` entries fold onto the LAST wave that closed with this
   *    branch, not distributed across every closed wave — the honest
   *    approximation of "whatever `foldPrLineage` would have stored at THAT
   *    close" when the close-time snapshots themselves were lost with the
   *    database. A wave that has not closed gets `[]`, and that is NOT a
   *    stand-in: nothing has folded into it yet (`ccd/ccd:2018-2035`'s
   *    three-answer ladder).
   *
   * A THIRD rule (deviation D-11, found in Task 3 review — the plan's own
   * Step-4 rule 2, dropped on first landing): the LAST wave's state is read
   * from the hold, not guessed from the ledger alone. A wave with no handoff
   * commit is `working` ONLY while `registry.held` says the workspace is
   * still claimed for it; if the hold is gone too, nothing backs a live
   * session and calling it `working` would fabricate one — `spec:82-85`'s
   * "nothing is invented" for the DB-lost path applies to the STATE column
   * exactly as much as to any other field. Such a wave is `failed`: the
   * honest "this did not complete and nothing is running it", not a silent
   * default that also keeps counting against `capsUsage().running` forever.
   * Every wave BEFORE the last one is expected to already carry a handoff
   * commit (the ledger is append-only); the fallback below only ever matters
   * for the last one.
   *
   * A FOURTH rule (fix, found in Task 3 review): the `working` wave — and
   * ONLY that one — gets `dispatchedAt` bound to the reconstruction time,
   * the same honest-approximation reasoning `openedAt` already uses. Without
   * this, `capsUsage().running`'s `dispatchedAt IS NOT NULL` predicate
   * (below) could never count a rebuilt run no matter its state, so the very
   * run a disaster rebuild most needs the cap to see — a live session
   * surviving the database loss — was invisible to it; the THIRD rule's own
   * justification above ("keeps counting against `capsUsage().running`
   * forever" as the reason a hold-less last wave is `failed` rather than a
   * silently-defaulted `working`) only became true once this bound
   * `dispatchedAt` for `working`. A `done` or `failed` wave stays
   * `dispatchedAt = null`: it holds no live session for the cap to count,
   * and stamping the reconstruction time on a wave that in reality
   * dispatched long ago would falsify `dispatchedIn24h` for it too.
   */
  reconstruct(input: {
    ledger: { slug: string; title: string;
              waves: { wave: number; of: number; handoffCommit: string | null }[] };
    registry: { sessionId: string; project: string; workspace: string;
                branch: string; held: string | null };
    prHistory: readonly PrLineageEntry[];
  }): RunRow[] {
    return tx(this.db, () => {
      const now = Date.now();
      this.db.prepare(
        'INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(slug) DO UPDATE SET title = excluded.title',
      ).run(input.ledger.slug, input.ledger.title, now, 'active');

      const doneWaves = input.ledger.waves.filter((w) => w.handoffCommit !== null);
      const lastDoneWave = doneWaves.length > 0 ? doneWaves[doneWaves.length - 1] : null;
      const matchingLineage = input.prHistory.filter((e) => e.branch === input.registry.branch);
      const lastWave = input.ledger.waves[input.ledger.waves.length - 1];

      const ids: number[] = [];
      for (const wave of input.ledger.waves) {
        // The hold-based rule (D-11, above) applies ONLY to the last wave; a
        // done wave is always `done` regardless of position, matching the
        // original formula for every wave that HAS a handoff commit.
        const state: RunState = wave.handoffCommit !== null
          ? 'done'
          : wave === lastWave && input.registry.held === null
            ? 'failed'
            : 'working';
        const prLineage = wave === lastDoneWave ? matchingLineage : [];
        // Fix, found in Task 3 review (see the fourth rule in this method's
        // docstring): ONLY the `working` wave carries a live session, so only
        // it gets `dispatchedAt` bound — the reconstruction time stands in
        // for the real dispatch time nothing in the ledger preserves.
        const dispatchedAt = state === 'working' ? now : null;
        const res = this.db.prepare(
          'INSERT INTO runs (program, wave, waveOf, project, sessionId, workspace, branch, state, ' +
          'dispatchedAt, claimedBy, openedAt, handoffCommit, prLineage) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          input.ledger.slug, wave.wave, wave.of, input.registry.project,
          input.registry.sessionId, input.registry.workspace, input.registry.branch,
          state, dispatchedAt, null, now, wave.handoffCommit, JSON.stringify(prLineage),
        );
        ids.push(Number(res.lastInsertRowid));
      }
      return ids.map((id) => this.run(id)!);
    });
  }
}
