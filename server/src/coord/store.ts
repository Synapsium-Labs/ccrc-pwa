import type { DatabaseSync } from 'node:sqlite';
import { tx } from './db.js';
import {
  isProgramState, isRunState, RUN_TRANSITIONS,
  type CoordCaps, type MailKind, type MailRejectCode, type ProgramState,
  type RunItemTally, type RunState, type RunSummary, type WorkItemState,
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
  state: string; resumed: number; openedAt: number; dispatchedAt: number | null;
  closedAt: number | null; handoffCommit: string | null; prLineage: string | null;
}

const RUN_ROW_COLUMNS =
  'r.id, r.program, p.title AS programTitle, r.wave, r.waveOf, r.project, r.sessionId, ' +
  'r.workspace, r.branch, r.state, r.resumed, r.openedAt, r.dispatchedAt, r.closedAt, ' +
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
      const existing = this.db.prepare(
        'SELECT claimedBy FROM runs WHERE program = ? ORDER BY id LIMIT 1',
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

  /** Dispatch's write: the workspace a run landed in, and whether it was a
   *  fresh spawn or D-1's resume+`/clear`. Does NOT itself advance `state` —
   *  the caller (Task 9's dispatch route) calls `advance` separately, so the
   *  two writes stay independently attributable in `run_events`. */
  markDispatched(runId: number, sessionId: string, workspace: string, branch: string,
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

  runEvents(runId: number): { at: number; fromState: string; toState: string; causedBy: string }[] {
    return this.db.prepare(
      'SELECT at, fromState, toState, causedBy FROM run_events WHERE runId = ? ORDER BY id',
    ).all(runId) as { at: number; fromState: string; toState: string; causedBy: string }[];
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
      // No backing column yet. Task 2's v1 schema added `resumed` for D-1 but
      // not `clearedAt` — the dispatch route that actually performs `/clear`
      // (Task 9) is what needs one, via its own additive migration. Honestly
      // `null` for every run until then: nothing has cleared anything yet, so
      // this is a measured answer, not a placeholder for a missing column.
      clearedAt: null,
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
    const running = (this.db.prepare(
      "SELECT count(*) AS c FROM runs WHERE state NOT IN ('done','failed')",
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

  queueDelivery(mailId: number, toId: string, envelope: string): { id: number } {
    const res = this.db.prepare(
      'INSERT INTO mail_deliveries (mailId, toId, state, envelope) VALUES (?, ?, ?, ?)',
    ).run(mailId, toId, 'queued', envelope);
    return { id: Number(res.lastInsertRowid) };
  }

  dueDeliveries(now: number): { id: number; mailId: number; toId: string; attempts: number;
                                envelope: string; deliveredAt: number | null;
                                ingestedAt: number | null }[] {
    return this.db.prepare(
      'SELECT id, mailId, toId, attempts, envelope, deliveredAt, ingestedAt FROM mail_deliveries ' +
      "WHERE state = 'queued' AND nextAttemptAt <= ? ORDER BY id",
    ).all(now) as { id: number; mailId: number; toId: string; attempts: number;
                    envelope: string; deliveredAt: number | null; ingestedAt: number | null }[];
  }

  markDelivered(id: number, at: number): void {
    this.db.prepare('UPDATE mail_deliveries SET state = ?, deliveredAt = ? WHERE id = ?')
      .run('delivered', at, id);
  }

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

      const ids: number[] = [];
      for (const wave of input.ledger.waves) {
        const state: RunState = wave.handoffCommit !== null ? 'done' : 'working';
        const prLineage = wave === lastDoneWave ? matchingLineage : [];
        const res = this.db.prepare(
          'INSERT INTO runs (program, wave, waveOf, project, sessionId, workspace, branch, state, ' +
          'claimedBy, openedAt, handoffCommit, prLineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(
          input.ledger.slug, wave.wave, wave.of, input.registry.project,
          input.registry.sessionId, input.registry.workspace, input.registry.branch,
          state, null, now, wave.handoffCommit, JSON.stringify(prLineage),
        );
        ids.push(Number(res.lastInsertRowid));
      }
      return ids.map((id) => this.run(id)!);
    });
  }
}
