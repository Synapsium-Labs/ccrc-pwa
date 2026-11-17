// The plan tables' SQL (Linear hierarchy design 2026-11-10 §4.2, D-8181): epics, checkpoints, tickets, the Linear bindings,
// the sync's due queue and the per-project hierarchy settings; and the programme's phases and their references (programme
// work map WM0, D-8715), whose one writer this is too; and a ticket's done time and evidence (`doneAt`, `doneEvidence`, WM1,
// D-8727), written here and by WM1's back-fill migration alone.
//
// It sits beside `store.ts` in the same ring and context (Coordination), in `ledgersStore.ts`'s idiom: every function takes
// the store's `DatabaseSync` and is synchronous. It holds the handle (`core-vocab.test.ts`'s `HANDLE_HOLDERS`); the plan
// routes, the hierarchy routes, `PlanSync`, `DriftPass` and `LinearMigration` take the `PlanStorePort` built once in
// `index.ts` and never name `coord.db`. A function named `…InTx` runs inside the caller's open transaction and opens none
// (`DatabaseSync` transactions do not nest); every other write opens its own. The decisions are `planPolicy.ts`'s.
import type { DatabaseSync } from 'node:sqlite';
import type { RunState } from '../../../shared/api.js';
import {
  LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX,
  type BindingKind, type BindingState, type CheckpointEvidence, type CheckpointKind, type CheckpointState, type EpicState,
  type PhaseRefKind, type PlanEndOutcome, type TicketDoneEvidence, type TicketKind, type TicketSource, type TicketState,
} from '../../../shared/plan.js';
import { AUTO_TICKET_PREFIX, autoTicketKey, epicAdmitsRun, epicIsDone } from './planPolicy.js';
import { tx } from './tx.js';

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface EpicRow {
  id: number; program: string | null; project: string; waves: number[]; key: string; ordinal: number; title: string;
  summary: string; state: EpicState; droppedWhy: string | null; putBackAt: number | null; openedAt: number | null;
  doneAt: number | null;
}
export interface CheckpointRow {
  id: number; epicId: number; key: string; ordinal: number; title: string; kind: CheckpointKind; proves: number[];
  state: CheckpointState; droppedWhy: string | null; putBackAt: number | null; metAt: number | null;
  evidence: CheckpointEvidence | null; itemId: number | null;
}
export interface TicketRow {
  id: number; program: string | null; project: string; epicId: number; checkpointId: number | null; key: string;
  kind: TicketKind; title: string; body: string; source: TicketSource; state: TicketState; runId: number | null;
  droppedWhy: string | null; putBackAt: number | null;
}
export interface BindingRow {
  id: number; localKind: BindingKind; localId: number; workspaceId: string; teamKey: string | null;
  linearId: string | null; identifier: string | null; fingerprint: string | null; syncedAt: number | null;
  state: BindingState; failedAt: number | null; failedWord: string | null; failedInputs: string | null;
  driftCount: number; driftSince: number | null; heldItemId: number | null;
}
export interface StoredPlan {
  program: string; planBy: string | null; required: boolean;
  epics: (EpicRow & { checkpoints: CheckpointRow[]; tickets: TicketRow[] })[];
}
/** A phase reference (programme work map WM0): `refId` is an epic's or a ticket's id by `kind`; `carriedTo` the phase id a
 *  recorded carry took this ticket to. */
export interface PhaseRefRow { id: number; phaseId: number; kind: PhaseRefKind; refId: number; carriedTo: number | null; carriedAt: number | null }
/** A phase of the sequence, dropped when `droppedWhy` is set, with its references. */
export interface PhaseRow {
  id: number; program: string; key: string; ordinal: number; title: string; summary: string; droppedWhy: string | null;
  refs: PhaseRefRow[];
}

// ── Changes (what `plan put` and the verbs write) ──────────────────────────────────────────────────────────────────────

export interface NewEpic { key: string; project: string; waves: number[]; ordinal: number; title: string; summary: string }
export type EpicPatch = Partial<{ project: string; waves: number[]; ordinal: number; title: string; summary: string }>;
/** A new checkpoint names its epic by `epicKey`; the epic may be inserted in the same change. */
export interface NewCheckpoint {
  epicKey: string; key: string; ordinal: number; title: string; kind: CheckpointKind; proves: number[]; itemId: number | null;
}
export type CheckpointPatch = Partial<{ ordinal: number; title: string; kind: CheckpointKind; proves: number[]; itemId: number | null }>;
/** A new ticket names its epic by `epicKey` (and its checkpoint by `checkpointKey`). `program` is null for a ticket in a
 *  team's Upkeep epic, whose epic is then found by `project` and `epicKey`. */
export interface NewTicket {
  program: string | null; epicKey: string; checkpointKey: string | null; key: string; kind: TicketKind; title: string;
  body: string; project: string; source: TicketSource;
}
export type TicketPatch = Partial<{
  epicId: number; checkpointId: number | null; kind: TicketKind; title: string; body: string; project: string;
  state: TicketState; droppedWhy: string | null; runId: number | null;
}>;
export interface Changes<N, P> { insert: N[]; update: (P & { id: number })[]; drop: { id: number; why: string }[] }
export interface PlanChanges {
  epics: Changes<NewEpic, EpicPatch>; checkpoints: Changes<NewCheckpoint, CheckpointPatch>; tickets: Changes<NewTicket, TicketPatch>;
  /** The put's phases (`diffPhases`), applied after the tickets in the same transaction; absent: the phases are untouched. */
  phases?: PhaseChanges;
}
/** A new phase, or a reference a put ADDS (by keys: a put may add the epic or ticket it references in the same write). */
export interface NewPhase { key: string; ordinal: number; title: string; summary: string }
export type PhasePatch = Partial<{ ordinal: number; title: string; summary: string }>;
export interface NewPhaseRef { phaseKey: string; kind: PhaseRefKind; key: string }
export interface PhaseChanges { phases: Changes<NewPhase, PhasePatch>; refs: NewPhaseRef[] }
/** `plan phase-ref`'s one write (`phaseRefVerdict` decides it): add a reference, remove one, or record a carry. */
export type PhaseRefWrite =
  | { kind: 'insert'; phaseId: number; refKind: PhaseRefKind; refId: number }
  | { kind: 'delete'; refRowId: number }
  | { kind: 'carry'; fromPhaseId: number; toPhaseId: number; ticketId: number }
  | { kind: 'none' };
export const NO_PLAN_CHANGES = (): PlanChanges => ({
  epics: { insert: [], update: [], drop: [] }, checkpoints: { insert: [], update: [], drop: [] },
  tickets: { insert: [], update: [], drop: [] },
});

/** The ticket a run opens with (Task 2.5 reads this from the route's verdict). */
export type OpenRunTicket =
  | { kind: 'existing'; id: number; epicId: number; reproject: string | null }
  | { kind: 'new'; epicId: number; project: string; title: string };

/** A project's hierarchy settings (the `project_linking` columns of migration 59). */
export interface HierarchySettingsBody { initiatives: 'on' | 'off'; linearOwner: string | null; ownsTeam: boolean }

// ── Row readers ────────────────────────────────────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
};
const epicOf = (r: Raw): EpicRow => ({ ...(r as unknown as EpicRow), waves: json<number[]>(r.waves, []) });
const checkpointOf = (r: Raw): CheckpointRow => ({
  ...(r as unknown as CheckpointRow), proves: json<number[]>(r.proves, []), evidence: json<CheckpointEvidence | null>(r.evidence, null),
});
const ticketOf = (r: Raw): TicketRow => r as unknown as TicketRow;

/** The due-queue key of an epic: its programme's slug, or `upkeep:<project>` for a team's Upkeep epic. */
const dueKeyOf = (e: { program: string | null; project: string }): string =>
  e.program ?? `${UPKEEP_DUE_PREFIX}${e.project}`;

// ── The queue ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Mark a programme (or `upkeep:<project>`) due. Keeps the earlier `dueAt`, except that a row deferred for a FAILURE keeps
 *  its own (A7/A12: a plan write, a run transition or an attach never pulls a backoff back to now). Opens no transaction.
 *
 *  The row's `attempts` column (migration 59, read nowhere before) is the failure mark: `deferSync` counts a failure
 *  deferral there and sets it to 0 for an ordinary one; `clearSyncDue` deletes the row. No migration (D-8673). */
export function markSyncDueInTx(db: DatabaseSync, program: string, at: number): void {
  if (program === LINEAR_SYNC_PROGRAMME) return;
  db.prepare(
    'INSERT INTO plan_sync_due (program, dueAt) VALUES (?, ?) ON CONFLICT(program) DO UPDATE SET '
    + 'dueAt = CASE WHEN attempts > 0 THEN dueAt ELSE MIN(dueAt, excluded.dueAt) END',
  ).run(program, at);
}
export function markSyncDue(db: DatabaseSync, program: string, at: number): void { markSyncDueInTx(db, program, at); }
export function dueSyncs(db: DatabaseSync, now: number): string[] {
  return (db.prepare('SELECT program FROM plan_sync_due WHERE dueAt <= ? ORDER BY dueAt, program').all(now) as Raw[])
    .map((r) => r.program as string);
}
export function clearSyncDue(db: DatabaseSync, program: string): void {
  db.prepare('DELETE FROM plan_sync_due WHERE program = ?').run(program);
}
/** Why a due row is deferred: a `failure`'s backoff (the next mark must not shorten it, A7/A12) or an ordinary `wait`. */
export type SyncDeferral = 'failure' | 'wait';
/** Defer a due row to `until`, for a `failure` or a `wait` ({@link SyncDeferral}). */
export function deferSync(db: DatabaseSync, program: string, until: number, why: SyncDeferral): void {
  db.prepare('UPDATE plan_sync_due SET dueAt = ?, attempts = CASE WHEN ? THEN attempts + 1 ELSE 0 END WHERE program = ?')
    .run(until, why === 'failure' ? 1 : 0, program);
}
/** The `dueAt` of a row deferred for a failure whose backoff has not passed at `now`; null when none holds the programme. */
export function heldSyncUntil(db: DatabaseSync, program: string, now: number): number | null {
  const r = db.prepare('SELECT dueAt FROM plan_sync_due WHERE program = ? AND attempts > 0 AND dueAt > ?').get(program, now) as Raw | undefined;
  return r === undefined ? null : (r.dueAt as number);
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function planOf(db: DatabaseSync, program: string): StoredPlan {
  const prog = db.prepare('SELECT planBy, planRequired FROM programs WHERE slug = ?').get(program) as Raw | undefined;
  const epics = (db.prepare('SELECT * FROM plan_epics WHERE program = ? ORDER BY ordinal, id').all(program) as Raw[]).map(epicOf);
  const cps = db.prepare('SELECT c.* FROM plan_checkpoints c JOIN plan_epics e ON e.id = c.epicId WHERE e.program = ? ORDER BY c.ordinal, c.id')
    .all(program) as Raw[];
  const tks = db.prepare('SELECT * FROM plan_tickets WHERE program = ? ORDER BY id').all(program) as Raw[];
  return {
    program, planBy: (prog?.planBy as string | null | undefined) ?? null,
    // An absent row requires a plan: answering false would silently disarm `plan-missing` for a new programme.
    required: prog === undefined ? true : prog.planRequired !== 0,
    epics: epics.map((e) => ({
      ...e,
      checkpoints: cps.filter((c) => c.epicId === e.id).map(checkpointOf),
      tickets: tks.filter((t) => t.epicId === e.id).map(ticketOf),
    })),
  };
}

/** A programme's phases in order (dropped ones included), each with its references. */
export function phasesOf(db: DatabaseSync, program: string): PhaseRow[] {
  const phases = db.prepare('SELECT id, program, key, ordinal, title, summary, droppedWhy FROM plan_phases WHERE program = ? ORDER BY ordinal, id')
    .all(program) as unknown as Omit<PhaseRow, 'refs'>[];
  if (phases.length === 0) return [];
  const refs = db.prepare(
    'SELECT r.id, r.phaseId, r.kind, r.refId, r.carriedTo, r.carriedAt FROM plan_phase_refs r JOIN plan_phases p ON p.id = r.phaseId '
    + 'WHERE p.program = ? ORDER BY r.id',
  ).all(program) as unknown as PhaseRefRow[];
  return phases.map((p) => ({ ...p, refs: refs.filter((r) => r.phaseId === p.id) }));
}

export function planEndOf(db: DatabaseSync, program: string): { outcome: PlanEndOutcome; why: string | null; at: number } | null {
  const r = db.prepare('SELECT planEnd, planEndWhy, planEndAt FROM programs WHERE slug = ?').get(program) as Raw | undefined;
  if (r === undefined || r.planEnd === null || r.planEnd === undefined) return null;
  return { outcome: r.planEnd as PlanEndOutcome, why: (r.planEndWhy as string | null) ?? null, at: (r.planEndAt as number | null) ?? 0 };
}

/** The `claimedBy` of the programme's newest claimed run, else the session that first declared its plan. */
export function planOwnerOf(db: DatabaseSync, program: string): string | null {
  const run = db.prepare('SELECT claimedBy FROM runs WHERE program = ? AND claimedBy IS NOT NULL ORDER BY id DESC LIMIT 1')
    .get(program) as Raw | undefined;
  if (run !== undefined) return run.claimedBy as string;
  const prog = db.prepare('SELECT planBy FROM programs WHERE slug = ?').get(program) as Raw | undefined;
  return (prog?.planBy as string | null | undefined) ?? null;
}

/** A ticket's done facts (programme work map WM1, D-8727): `doneAt` and `doneEvidence` as stored. `evidence` is null when
 *  none is stored and `malformed` when the column holds something that is not `{ runId }` or `{ pr }` (never folded into
 *  none). Kept beside `TicketRow`, not in it, so a plan read stays as it was. */
export interface TicketDoneRow {
  ticketId: number; key: string; project: string; doneAt: number | null; evidence: TicketDoneEvidence | 'malformed' | null;
}
const evidenceOf = (raw: unknown): TicketDoneEvidence | 'malformed' | null => {
  if (raw === null || raw === undefined) return null;
  try {
    const v = JSON.parse(String(raw)) as unknown;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1) {
      const [k, n] = Object.entries(v)[0]!;
      if ((k === 'runId' || k === 'pr') && Number.isSafeInteger(n) && (n as number) >= 1) return k === 'runId' ? { runId: n as number } : { pr: n as number };
    }
  } catch { /* malformed below */ }
  return 'malformed';
};
/** Every ticket of a programme with its done facts, in id order (the evidence check of `plan ticket-done`, and WM2's map). */
export function doneFactsOf(db: DatabaseSync, program: string): TicketDoneRow[] {
  const rows = db.prepare('SELECT id, key, project, doneAt, doneEvidence FROM plan_tickets WHERE program = ? ORDER BY id').all(program) as Raw[];
  return rows.map((r) => ({
    ticketId: r.id as number, key: r.key as string, project: r.project as string, doneAt: (r.doneAt as number | null) ?? null,
    evidence: evidenceOf(r.doneEvidence),
  }));
}
/** A run's own ticket (`runs.ticketId` and that ticket's key): null for no such run; `ticketId` null for a run with none. */
export function ticketOfRun(db: DatabaseSync, runId: number): { ticketId: number | null; key: string | null } | null {
  const r = db.prepare('SELECT r.ticketId AS ticketId, t.key AS key FROM runs r LEFT JOIN plan_tickets t ON t.id = r.ticketId WHERE r.id = ?')
    .get(runId) as Raw | undefined;
  if (r === undefined) return null;
  return { ticketId: (r.ticketId as number | null) ?? null, key: (r.key as string | null) ?? null };
}

export function ticketById(db: DatabaseSync, id: number): TicketRow | null {
  const r = db.prepare('SELECT * FROM plan_tickets WHERE id = ?').get(id) as Raw | undefined;
  return r === undefined ? null : ticketOf(r);
}
export function ticketByKey(db: DatabaseSync, program: string | null, epicId: number, key: string): TicketRow | null {
  const r = db.prepare('SELECT * FROM plan_tickets WHERE program IS ? AND epicId = ? AND key = ?').get(program, epicId, key) as Raw | undefined;
  return r === undefined ? null : ticketOf(r);
}

const epicById = (db: DatabaseSync, id: number): EpicRow | null => {
  const r = db.prepare('SELECT * FROM plan_epics WHERE id = ?').get(id) as Raw | undefined;
  return r === undefined ? null : epicOf(r);
};

// ── Settling an epic ───────────────────────────────────────────────────────────────────────────────────────────────────

/** THE one writer of an epic's `done`: a `planned` or `active` epic whose checkpoints and tickets satisfy `epicIsDone` is
 *  set `done` with `doneAt`, and its programme is marked due. An Upkeep epic (no programme) never closes. */
export function settleEpicInTx(db: DatabaseSync, epicId: number, now: number): void {
  const e = epicById(db, epicId);
  if (e === null || e.program === null || (e.state !== 'planned' && e.state !== 'active')) return;
  const cps = db.prepare('SELECT state FROM plan_checkpoints WHERE epicId = ?').all(epicId) as unknown as { state: CheckpointState }[];
  const tks = db.prepare('SELECT state FROM plan_tickets WHERE epicId = ?').all(epicId) as unknown as { state: TicketState }[];
  if (!epicIsDone(cps, tks)) return;
  db.prepare("UPDATE plan_epics SET state = 'done', doneAt = ? WHERE id = ?").run(now, epicId);
  markSyncDueInTx(db, e.program, now);
}

// ── Writes: the plan ───────────────────────────────────────────────────────────────────────────────────────────────────

const ARRAY_FIELDS = new Set(['waves', 'proves']);
function patchStatement(update: string, patch: Record<string, unknown>, allowed: readonly string[], id: number): { sql: string; args: unknown[] } | null {
  const cols = Object.keys(patch).filter((k) => allowed.includes(k) && patch[k] !== undefined);
  if (cols.length === 0) return null;
  return {
    sql: `${update}${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
    args: [...cols.map((c) => (ARRAY_FIELDS.has(c) ? JSON.stringify(patch[c]) : patch[c])), id],
  };
}
const EPIC_COLS = ['project', 'waves', 'ordinal', 'title', 'summary'] as const;
const CHECKPOINT_COLS = ['ordinal', 'title', 'kind', 'proves', 'itemId'] as const;
const TICKET_COLS = ['epicId', 'checkpointId', 'kind', 'title', 'body', 'project', 'state', 'droppedWhy', 'runId'] as const;

function epicIdByKey(db: DatabaseSync, program: string | null, project: string, key: string): number | null {
  const r = (program === null
    ? db.prepare('SELECT id FROM plan_epics WHERE program IS NULL AND project = ? AND key = ?').get(project, key)
    : db.prepare('SELECT id FROM plan_epics WHERE program = ? AND key = ?').get(program, key)) as Raw | undefined;
  return r === undefined ? null : (r.id as number);
}
function checkpointIdByKey(db: DatabaseSync, epicId: number, key: string): number | null {
  const r = db.prepare('SELECT id FROM plan_checkpoints WHERE epicId = ? AND key = ?').get(epicId, key) as Raw | undefined;
  return r === undefined ? null : (r.id as number);
}

function insertTicketInTx(db: DatabaseSync, t: NewTicket, now: number): number {
  const epicId = epicIdByKey(db, t.program, t.project, t.epicKey);
  if (epicId === null) throw new Error(`plan store: no epic ${t.epicKey} for a new ticket ${t.key}`);
  const checkpointId = t.checkpointKey === null ? null : checkpointIdByKey(db, epicId, t.checkpointKey);
  if (t.checkpointKey !== null && checkpointId === null) throw new Error(`plan store: no checkpoint ${t.checkpointKey} in epic ${t.epicKey}`);
  const res = db.prepare(
    "INSERT INTO plan_tickets (program, project, epicId, checkpointId, key, kind, title, body, source, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')",
  ).run(t.program, t.project, epicId, checkpointId, t.key, t.kind, t.title, t.body, t.source);
  const e = epicById(db, epicId);
  if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
  return Number(res.lastInsertRowid);
}

export function insertTicket(db: DatabaseSync, t: NewTicket, now: number): number {
  return tx(db, () => {
    const id = insertTicketInTx(db, t, now);
    const row = ticketById(db, id);
    if (row !== null) settleEpicInTx(db, row.epicId, now);
    return id;
  });
}

export function updateTicket(db: DatabaseSync, id: number, patch: TicketPatch, now: number): void {
  tx(db, () => {
    const before = ticketById(db, id);
    if (before === null) return;
    const st = patchStatement('UPDATE plan_tickets SET ', patch, TICKET_COLS, id);
    if (st !== null) db.prepare(st.sql).run(...(st.args as never[]));
    const touched = new Set<number>([before.epicId]);
    if (patch.epicId !== undefined) touched.add(patch.epicId);
    for (const epicId of touched) {
      const e = epicById(db, epicId);
      if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
      settleEpicInTx(db, epicId, now);
    }
  });
}

export function applyPlanChanges(
  db: DatabaseSync, program: string, changes: PlanChanges, by: string, now: number, newRow: { home: string; title: string } | null,
): void {
  tx(db, () => {
    if (newRow !== null) {
      db.prepare(
        "INSERT INTO programs (slug, title, createdAt, state, homeProject, planRequired) VALUES (?, ?, ?, 'active', ?, 1) ON CONFLICT(slug) DO NOTHING",
      ).run(program, newRow.title, now, newRow.home);
    }
    const touched = new Set<number>();
    const touchEpic = (id: number | null): void => { if (id !== null) touched.add(id); };

    for (const e of changes.epics.insert) {
      db.prepare("INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'planned')")
        .run(program, e.project, JSON.stringify(e.waves), e.key, e.ordinal, e.title, e.summary);
      touchEpic(epicIdByKey(db, program, e.project, e.key));
    }
    for (const u of changes.epics.update) {
      const st = patchStatement('UPDATE plan_epics SET ', u, EPIC_COLS, u.id);
      if (st !== null) db.prepare(st.sql).run(...(st.args as never[]));
      touchEpic(u.id);
    }
    for (const d of changes.epics.drop) {
      db.prepare("UPDATE plan_epics SET state = 'dropped', droppedWhy = ? WHERE id = ?").run(d.why, d.id);
      touchEpic(d.id);
    }

    for (const c of changes.checkpoints.insert) {
      const epicId = epicIdByKey(db, program, '', c.epicKey);
      if (epicId === null) throw new Error(`plan store: no epic ${c.epicKey} for a new checkpoint ${c.key}`);
      db.prepare("INSERT INTO plan_checkpoints (epicId, key, ordinal, title, kind, proves, state, itemId) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)")
        .run(epicId, c.key, c.ordinal, c.title, c.kind, JSON.stringify(c.proves), c.itemId);
      touchEpic(epicId);
    }
    for (const u of changes.checkpoints.update) {
      const st = patchStatement('UPDATE plan_checkpoints SET ', u, CHECKPOINT_COLS, u.id);
      if (st !== null) db.prepare(st.sql).run(...(st.args as never[]));
      touchEpic((db.prepare('SELECT epicId FROM plan_checkpoints WHERE id = ?').get(u.id) as { epicId: number } | undefined)?.epicId ?? null);
    }
    for (const d of changes.checkpoints.drop) {
      db.prepare("UPDATE plan_checkpoints SET state = 'dropped', droppedWhy = ? WHERE id = ?").run(d.why, d.id);
      touchEpic((db.prepare('SELECT epicId FROM plan_checkpoints WHERE id = ?').get(d.id) as { epicId: number } | undefined)?.epicId ?? null);
    }

    for (const t of changes.tickets.insert) {
      insertTicketInTx(db, { ...t, program: t.program ?? program }, now);
      touchEpic(epicIdByKey(db, t.program ?? program, t.project, t.epicKey));
    }
    for (const u of changes.tickets.update) {
      const before = ticketById(db, u.id);
      if (before === null) continue;
      const st = patchStatement('UPDATE plan_tickets SET ', u, TICKET_COLS, u.id);
      if (st !== null) db.prepare(st.sql).run(...(st.args as never[]));
      touchEpic(before.epicId);
      touchEpic(u.epicId ?? null);
    }
    for (const d of changes.tickets.drop) {
      const before = ticketById(db, d.id);
      if (before === null) continue;
      db.prepare("UPDATE plan_tickets SET state = 'dropped', droppedWhy = ? WHERE id = ?").run(d.why, d.id);
      touchEpic(before.epicId);
    }

    if (changes.phases !== undefined) applyPhaseChangesInTx(db, program, changes.phases);

    db.prepare('UPDATE programs SET planBy = ?, planAt = ? WHERE slug = ? AND planBy IS NULL').run(by, now, program);
    for (const epicId of touched) settleEpicInTx(db, epicId, now);
    markSyncDueInTx(db, program, now);
  });
}

const PHASE_COLS = ['ordinal', 'title', 'summary'] as const;
const phaseIdByKey = (db: DatabaseSync, program: string, key: string): number | null =>
  (db.prepare('SELECT id FROM plan_phases WHERE program = ? AND key = ?').get(program, key) as Raw | undefined)?.id as number | undefined ?? null;

/** Inside `applyPlanChanges`' transaction, after the tickets: the put's phases, then the references it ADDS, each resolved by
 *  key (the epic or ticket may be the put's own) and inserted unless the phase already holds it (D18: a put never removes a
 *  reference, so it never undoes a carry). `diffPhases` checked every key; one that does not resolve throws, which rolls the
 *  whole put back. */
function applyPhaseChangesInTx(db: DatabaseSync, program: string, c: PhaseChanges): void {
  for (const p of c.phases.insert) {
    db.prepare('INSERT INTO plan_phases (program, key, ordinal, title, summary) VALUES (?, ?, ?, ?, ?)').run(program, p.key, p.ordinal, p.title, p.summary);
  }
  for (const u of c.phases.update) {
    const st = patchStatement('UPDATE plan_phases SET ', u, PHASE_COLS, u.id);
    if (st !== null) db.prepare(st.sql).run(...(st.args as never[]));
  }
  for (const d of c.phases.drop) db.prepare('UPDATE plan_phases SET droppedWhy = ? WHERE id = ? AND droppedWhy IS NULL').run(d.why, d.id);
  for (const r of c.refs) {
    const phaseId = phaseIdByKey(db, program, r.phaseKey);
    const row = (r.kind === 'epic'
      ? db.prepare('SELECT id FROM plan_epics WHERE program = ? AND key = ?')
      : db.prepare('SELECT id FROM plan_tickets WHERE program = ? AND key = ?')).get(program, r.key) as Raw | undefined;
    if (phaseId === null || row === undefined) throw new Error(`plan store: phase ${r.phaseKey} cannot reference ${r.kind} ${r.key}`);
    db.prepare('INSERT INTO plan_phase_refs (phaseId, kind, refId) VALUES (?, ?, ?) ON CONFLICT(phaseId, kind, refId) DO NOTHING')
      .run(phaseId, r.kind, row.id as number);
  }
}

/** THE one writer of `plan phase-ref` (D17): one reference added or removed, or a carry, in one transaction. A carry marks
 *  the `from` phase's ticket reference carried to `to` (inserting it when `from` held the ticket through a whole-epic
 *  reference) and inserts a ticket reference in `to` unless it is there (review 2268 F12: both halves or neither). */
export function writePhaseRef(db: DatabaseSync, w: PhaseRefWrite, now: number): void {
  tx(db, () => {
    if (w.kind === 'insert') {
      db.prepare('INSERT INTO plan_phase_refs (phaseId, kind, refId) VALUES (?, ?, ?) ON CONFLICT(phaseId, kind, refId) DO NOTHING')
        .run(w.phaseId, w.refKind, w.refId);
    } else if (w.kind === 'delete') {
      db.prepare('DELETE FROM plan_phase_refs WHERE id = ?').run(w.refRowId);
    } else if (w.kind === 'carry') {
      db.prepare(
        "INSERT INTO plan_phase_refs (phaseId, kind, refId, carriedTo, carriedAt) VALUES (?, 'ticket', ?, ?, ?) "
        + 'ON CONFLICT(phaseId, kind, refId) DO UPDATE SET carriedTo = excluded.carriedTo, carriedAt = excluded.carriedAt',
      ).run(w.fromPhaseId, w.ticketId, w.toPhaseId, now);
      db.prepare("INSERT INTO plan_phase_refs (phaseId, kind, refId) VALUES (?, 'ticket', ?) ON CONFLICT(phaseId, kind, refId) DO NOTHING")
        .run(w.toPhaseId, w.ticketId);
    }
  });
}

export function closePlan(db: DatabaseSync, program: string, outcome: PlanEndOutcome, why: string | null, now: number): void {
  tx(db, () => {
    db.prepare('UPDATE programs SET planEnd = ?, planEndWhy = ?, planEndAt = ? WHERE slug = ? AND planEnd IS NULL')
      .run(outcome, why, now, program);
    markSyncDueInTx(db, program, now);
  });
}

/** THE writer of `plan ticket-done` (programme work map WM1, D-8727): an `open` ticket no run holds is set `done` with its
 *  time and evidence, its epic settles and the programme's sync is due, in one transaction. The verdict was
 *  `planPolicy.ts#ticketDoneVerdict`'s; the guard here only keeps a raced write from closing a ticket that moved since. */
export function markTicketDone(db: DatabaseSync, ticketId: number, evidence: TicketDoneEvidence, now: number): void {
  tx(db, () => {
    const t = ticketById(db, ticketId);
    if (t === null) return;
    db.prepare("UPDATE plan_tickets SET state = 'done', doneAt = ?, doneEvidence = ? WHERE id = ? AND state = 'open' AND runId IS NULL")
      .run(now, JSON.stringify(evidence), ticketId);
    const e = epicById(db, t.epicId);
    if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
    settleEpicInTx(db, t.epicId, now);
  });
}

export function markCheckpointMet(db: DatabaseSync, checkpointId: number, evidence: CheckpointEvidence, now: number): void {
  tx(db, () => {
    const c = db.prepare('SELECT epicId FROM plan_checkpoints WHERE id = ?').get(checkpointId) as { epicId: number } | undefined;
    if (c === undefined) return;
    db.prepare("UPDATE plan_checkpoints SET state = 'met', metAt = ?, evidence = ? WHERE id = ? AND state = 'open'")
      .run(now, JSON.stringify(evidence), checkpointId);
    const e = epicById(db, c.epicId);
    if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
    settleEpicInTx(db, c.epicId, now);
  });
}

// ── Runs and tickets ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Inside `openRun`'s transaction: re-check the plan facts (the plan open, the epic live, a named ticket `open` with no
 *  run), then take the wave's orphaned auto ticket (one a failed run of the same wave left `open`), else insert the auto
 *  ticket (key `run-<runId>`, derived again on a retry), or re-project the named one, and attach it only when
 *  `runs.ticketId IS NULL`, so a retried open attaches nothing twice. */
export function attachTicketInTx(
  db: DatabaseSync, runId: number, ticket: OpenRunTicket, now: number,
): { ok: true } | { ok: false; refused: 'plan-closed' | 'wave-epic-mismatch' | 'ticket-unavailable' } {
  const run = db.prepare('SELECT program, wave, ticketId FROM runs WHERE id = ?').get(runId) as { program: string; wave: number; ticketId: number | null } | undefined;
  if (run === undefined) return { ok: false, refused: 'wave-epic-mismatch' };
  if (run.ticketId !== null) return { ok: true };
  if (planEndOf(db, run.program) !== null) return { ok: false, refused: 'plan-closed' };
  const epic = epicById(db, ticket.epicId);
  if (epic === null || epic.program !== run.program || !epicAdmitsRun(epic.state)) {
    return { ok: false, refused: 'wave-epic-mismatch' };
  }
  // A settled epic that lists the wave takes the run and is live again (reopened only once every refusal is behind us, since a
  // refusal is returned and the transaction commits); it settles afresh when this run's ticket closes.
  const reopenEpic = (): void => {
    if (epic.state === 'done') db.prepare("UPDATE plan_epics SET state = 'active', doneAt = NULL WHERE id = ? AND state = 'done'").run(epic.id);
  };
  let ticketId: number;
  if (ticket.kind === 'existing') {
    const t = ticketById(db, ticket.id);
    if (t === null || t.program !== run.program) return { ok: false, refused: 'ticket-unavailable' };
    if (t.epicId !== ticket.epicId) return { ok: false, refused: 'wave-epic-mismatch' };
    if (t.state !== 'open' || t.runId !== null) return { ok: false, refused: 'ticket-unavailable' };
    reopenEpic();
    db.prepare('UPDATE plan_tickets SET runId = ?, project = COALESCE(?, project) WHERE id = ?').run(runId, ticket.reproject, t.id);
    ticketId = t.id;
  } else {
    reopenEpic();
    // A failed run returns its auto ticket to `open` with no run; the next open of the same wave with no ticket takes that
    // ticket (re-projected and re-titled to this run) rather than minting another, so a retried wave leaves no orphan
    // `open` ticket that would keep the epic from settling. An auto ticket's key is reserved (`isAutoTicketKey`), so only
    // ccrc's own tickets match.
    const orphan = db.prepare(
      "SELECT t.id AS id FROM plan_tickets t WHERE t.program = ? AND t.epicId = ? AND t.state = 'open' AND t.runId IS NULL "
      + 'AND substr(t.key, 1, ?) = ? AND EXISTS (SELECT 1 FROM runs r WHERE r.ticketId = t.id AND r.wave = ?) ORDER BY t.id LIMIT 1',
    ).get(run.program, ticket.epicId, AUTO_TICKET_PREFIX.length, AUTO_TICKET_PREFIX, run.wave) as { id: number } | undefined;
    if (orphan !== undefined) {
      db.prepare('UPDATE plan_tickets SET runId = ?, project = ?, title = ? WHERE id = ?').run(runId, ticket.project, ticket.title, orphan.id);
      ticketId = orphan.id;
    } else {
      const res = db.prepare(
        "INSERT INTO plan_tickets (program, project, epicId, checkpointId, key, kind, title, body, source, state, runId) VALUES (?, ?, ?, NULL, ?, 'work', ?, '', 'plan', 'open', ?)",
      ).run(run.program, ticket.project, ticket.epicId, autoTicketKey(runId), ticket.title, runId);
      ticketId = Number(res.lastInsertRowid);
    }
  }
  db.prepare('UPDATE runs SET ticketId = ? WHERE id = ? AND ticketId IS NULL').run(ticketId, runId);
  markSyncDueInTx(db, run.program, now);
  return { ok: true };
}

/** The epic a run's ticket sits in (the follow-up verb's own-epic check, Task 2.4), or null for a run with no ticket. */
export function epicOfRun(db: DatabaseSync, runId: number): number | null {
  const r = db.prepare('SELECT t.epicId AS epicId FROM runs r JOIN plan_tickets t ON t.id = r.ticketId WHERE r.id = ?').get(runId) as { epicId: number } | undefined;
  return r?.epicId ?? null;
}

/** Called from `advanceInner`, in its own transaction: `dispatched` starts the run's ticket and activates its epic, `done`
 *  closes the ticket with its time and evidence (`{ runId }`, programme work map WM1) and settles the epic, and a run that
 *  ends `failed` returns the ticket to `open` with no run. A review run, or a run with no ticket, moves nothing. */
export function onRunAdvancedInTx(db: DatabaseSync, runId: number, from: RunState, to: RunState, now: number): void {
  if (from === to) return;
  const run = db.prepare('SELECT program, kind, ticketId FROM runs WHERE id = ?').get(runId) as
    { program: string; kind: string; ticketId: number | null } | undefined;
  if (run === undefined || run.kind !== 'work' || run.ticketId === null) return;
  const t = ticketById(db, run.ticketId);
  if (t === null || t.runId !== runId) return;
  if (to === 'dispatched') {
    db.prepare("UPDATE plan_tickets SET state = 'started' WHERE id = ? AND state = 'open'").run(t.id);
    db.prepare("UPDATE plan_epics SET state = 'active', openedAt = ? WHERE id = ? AND state = 'planned'").run(now, t.epicId);
  } else if (to === 'done') {
    db.prepare("UPDATE plan_tickets SET state = 'done', doneAt = ?, doneEvidence = ? WHERE id = ? AND state IN ('open', 'started')")
      .run(now, JSON.stringify({ runId }), t.id);
    settleEpicInTx(db, t.epicId, now);
  } else if (to === 'failed') {
    db.prepare("UPDATE plan_tickets SET state = 'open', runId = NULL WHERE id = ? AND state IN ('open', 'started')").run(t.id);
  } else return;
  markSyncDueInTx(db, run.program, now);
}

// ── Bindings ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function bindingOf(db: DatabaseSync, kind: BindingKind, localId: number, workspaceId: string): BindingRow | null {
  const r = db.prepare('SELECT * FROM linear_bindings WHERE localKind = ? AND localId = ? AND workspaceId = ?').get(kind, localId, workspaceId);
  return (r as BindingRow | undefined) ?? null;
}
export function ensurePending(db: DatabaseSync, kind: BindingKind, localId: number, workspaceId: string, teamKey: string | null): BindingRow {
  db.prepare("INSERT INTO linear_bindings (localKind, localId, workspaceId, teamKey, state) VALUES (?, ?, ?, ?, 'pending') ON CONFLICT DO NOTHING")
    .run(kind, localId, workspaceId, teamKey);
  return bindingOf(db, kind, localId, workspaceId)!;
}
/** `teamKey`, when given, replaces the stored key (an issue moved to another team); absent or null leaves it. */
export function markBound(db: DatabaseSync, id: number, linearId: string, identifier: string | null, fingerprint: string, now: number, teamKey?: string | null): void {
  db.prepare(
    "UPDATE linear_bindings SET linearId = ?, identifier = ?, fingerprint = ?, syncedAt = ?, state = 'bound', failedAt = NULL, failedWord = NULL, failedInputs = NULL, teamKey = COALESCE(?, teamKey) WHERE id = ?",
  ).run(linearId, identifier, fingerprint, now, teamKey ?? null, id);
}
export function markFailed(db: DatabaseSync, id: number, word: string, inputs: string, now: number): void {
  db.prepare("UPDATE linear_bindings SET state = 'failed', failedAt = ?, failedWord = ?, failedInputs = ? WHERE id = ?").run(now, word, inputs, id);
}
/** `failed` bindings back to `to`, clearing the three `failed*` columns and keeping the stored fingerprint; `where` narrows by
 *  workspace, one binding or failures older than a time. C17 (`requeueVerdict` decides `to`): only a binding with a Linear
 *  object returns to `bound`, only one without returns to `pending`, so a row is never a create of an object that exists.
 *  Returns how many it returned. */
export function requeueFailed(db: DatabaseSync, where: { workspaceId?: string; bindingId?: number; olderThan?: number; to: 'bound' | 'pending' }): number {
  const conds = ["state = 'failed'", where.to === 'bound' ? 'linearId IS NOT NULL' : 'linearId IS NULL'];
  const args: (string | number)[] = [];
  if (where.workspaceId !== undefined) { conds.push('workspaceId = ?'); args.push(where.workspaceId); }
  if (where.bindingId !== undefined) { conds.push('id = ?'); args.push(where.bindingId); }
  if (where.olderThan !== undefined) { conds.push('failedAt < ?'); args.push(where.olderThan); }
  const res = db.prepare(
    `UPDATE linear_bindings SET state = ?, failedAt = NULL, failedWord = NULL, failedInputs = NULL WHERE ${conds.join(' AND ')}`,
  ).run(where.to, ...args);
  return Number(res.changes);
}
/** Every `operator-act` checkpoint of a programme that is still open and names an operator item: what the sync's tick checks
 *  against the item's state (design §4.1: ccrc marks it met when that item is done). */
export function openOperatorActs(db: DatabaseSync): { checkpointId: number; itemId: number; program: string }[] {
  return (db.prepare(
    "SELECT c.id AS checkpointId, c.itemId AS itemId, e.program AS program FROM plan_checkpoints c JOIN plan_epics e ON e.id = c.epicId "
    + "WHERE c.state = 'open' AND c.kind = 'operator-act' AND c.itemId IS NOT NULL AND e.program IS NOT NULL ORDER BY c.id",
  ).all() as Raw[]).map((r) => ({ checkpointId: r.checkpointId as number, itemId: r.itemId as number, program: r.program as string }));
}
/** The `programs` row's rowid: the key of the programme's own bindings (C6); null for a slug with no row. */
export function programmeRowId(db: DatabaseSync, slug: string): number | null {
  const r = db.prepare('SELECT rowid AS rid FROM programs WHERE slug = ?').get(slug) as Raw | undefined;
  return r === undefined ? null : Number(r.rid);
}
/** Every binding of a programme's objects (its own row, its epics, checkpoints and tickets), or, for `upkeep:<project>`,
 *  of that project's Upkeep epic and its tickets. A programme's own binding is keyed by the `programs` row's `rowid`. */
export function bindingsOf(db: DatabaseSync, program: string): BindingRow[] {
  if (program.startsWith(UPKEEP_DUE_PREFIX)) {
    const project = program.slice(UPKEEP_DUE_PREFIX.length);
    return db.prepare(
      "SELECT b.* FROM linear_bindings b WHERE (b.localKind = 'epic' AND b.localId IN (SELECT id FROM plan_epics WHERE program IS NULL AND project = ?)) "
      + "OR (b.localKind = 'ticket' AND b.localId IN (SELECT t.id FROM plan_tickets t JOIN plan_epics e ON e.id = t.epicId WHERE e.program IS NULL AND e.project = ?)) ORDER BY b.id",
    ).all(project, project) as unknown as BindingRow[];
  }
  return db.prepare(
    "SELECT b.* FROM linear_bindings b WHERE (b.localKind = 'programme' AND b.localId = (SELECT rowid FROM programs WHERE slug = ?)) "
    + "OR (b.localKind = 'epic' AND b.localId IN (SELECT id FROM plan_epics WHERE program = ?)) "
    + "OR (b.localKind = 'checkpoint' AND b.localId IN (SELECT c.id FROM plan_checkpoints c JOIN plan_epics e ON e.id = c.epicId WHERE e.program = ?)) "
    + "OR (b.localKind = 'ticket' AND b.localId IN (SELECT id FROM plan_tickets WHERE program = ?)) ORDER BY b.id",
  ).all(program, program, program, program) as unknown as BindingRow[];
}

// ── Per-project settings ───────────────────────────────────────────────────────────────────────────────────────────────

export function hierarchySettingsOf(db: DatabaseSync, project: string): HierarchySettingsBody {
  const r = db.prepare('SELECT initiatives, linearOwner, ownsTeam FROM project_linking WHERE project = ?').get(project) as Raw | undefined;
  return { initiatives: r?.initiatives === 'off' ? 'off' : 'on', linearOwner: (r?.linearOwner as string | null | undefined) ?? null, ownsTeam: r?.ownsTeam === 1 };
}
/** Write one project's settings. `ownsTeam` true clears it on every other project with the same team key, in the same
 *  transaction. `by` and `at` are the caller's attribution (the route's journal line); the columns hold no author. */
export function setHierarchySettings(db: DatabaseSync, project: string, s: HierarchySettingsBody, _by: string, _at: number): void {
  tx(db, () => {
    db.prepare(
      'INSERT INTO project_linking (project, initiatives, linearOwner, ownsTeam) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(project) DO UPDATE SET initiatives = excluded.initiatives, linearOwner = excluded.linearOwner, ownsTeam = excluded.ownsTeam',
    ).run(project, s.initiatives, s.linearOwner, s.ownsTeam ? 1 : 0);
    if (s.ownsTeam) {
      db.prepare(
        'UPDATE project_linking SET ownsTeam = 0 WHERE project <> ? AND ownsTeam = 1 AND teamKey IS NOT NULL '
        + 'AND teamKey = (SELECT teamKey FROM project_linking WHERE project = ?)',
      ).run(project, project);
    }
  });
}

/** Name one coordinator the owner of every project in ONE transaction, leaving each project's other settings. Returns the count. */
export function setLinearOwnerForAll(db: DatabaseSync, linearOwner: string): number {
  return tx(db, () => {
    const rows = hierarchyProjectsOf(db);
    for (const r of rows) {
      db.prepare(
        'INSERT INTO project_linking (project, initiatives, linearOwner, ownsTeam) VALUES (?, ?, ?, ?) '
        + 'ON CONFLICT(project) DO UPDATE SET linearOwner = excluded.linearOwner',
      ).run(r.project, r.initiatives, linearOwner, r.ownsTeam ? 1 : 0);
    }
    return rows.length;
  });
}

/** Every project the hierarchy settings can name: each `project_linking` row and each programme's home, with its settings. */
export interface HierarchyProjectFacts { project: string; teamKey: string | null; initiatives: 'on' | 'off'; linearOwner: string | null; ownsTeam: boolean; /** The `project_linking` row's insertion order: the first project that set a team key. Null for a project with no row. */ order: number | null }
export function hierarchyProjectsOf(db: DatabaseSync): HierarchyProjectFacts[] {
  const rows = db.prepare(
    'SELECT project, teamKey, initiatives, linearOwner, ownsTeam, rowid AS ord FROM project_linking '
    + 'UNION ALL SELECT homeProject, NULL, \'on\', NULL, 0, NULL FROM programs WHERE homeProject IS NOT NULL '
    + 'AND homeProject NOT IN (SELECT project FROM project_linking) GROUP BY homeProject ORDER BY 1',
  ).all() as unknown as Raw[];
  return rows.map((r) => ({
    project: r.project as string, teamKey: (r.teamKey as string | null) ?? null, initiatives: r.initiatives === 'off' ? 'off' as const : 'on' as const,
    linearOwner: (r.linearOwner as string | null) ?? null, ownsTeam: r.ownsTeam === 1,
    order: (r.ord as number | null) ?? null,
  }));
}
/** The coordinator of a project's newest programme (the plan owner of the newest programme homed there), else null. */
export function latestProgrammeCoordinator(db: DatabaseSync, project: string): string | null {
  const progs = db.prepare('SELECT slug FROM programs WHERE homeProject = ? AND slug <> ? ORDER BY createdAt DESC, rowid DESC')
    .all(project, LINEAR_SYNC_PROGRAMME) as unknown as Raw[];
  for (const p of progs) {
    const owner = planOwnerOf(db, p.slug as string);
    if (owner !== null) return owner;
  }
  return null;
}
/** Every session id that has claimed a run or declared a plan: the ids a Linear owner may name. */
export function coordinatorIdsOf(db: DatabaseSync): string[] {
  const rows = db.prepare(
    'SELECT claimedBy AS id FROM runs WHERE claimedBy IS NOT NULL UNION SELECT planBy FROM programs WHERE planBy IS NOT NULL ORDER BY 1',
  ).all() as unknown as Raw[];
  return rows.map((r) => r.id as string);
}

// ── The port ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const PORT_FUNCTIONS = {
  planOf, phasesOf, writePhaseRef, planEndOf, planOwnerOf, applyPlanChanges, closePlan, settleEpicInTx, markCheckpointMet, insertTicket, updateTicket,
  doneFactsOf, ticketOfRun, markTicketDone,
  ticketById, ticketByKey, epicOfRun, attachTicketInTx, onRunAdvancedInTx, bindingOf, ensurePending, markBound, markFailed, requeueFailed,
  bindingsOf, markSyncDue, markSyncDueInTx, dueSyncs, clearSyncDue, deferSync, heldSyncUntil, hierarchySettingsOf, setHierarchySettings,
  hierarchyProjectsOf, setLinearOwnerForAll, latestProgrammeCoordinator, coordinatorIdsOf, programmeRowId, openOperatorActs,
};
type Bound<F> = F extends (db: DatabaseSync, ...a: infer A) => infer R ? (...a: A) => R : never;
type PortShape = { [K in keyof typeof PORT_FUNCTIONS]: Bound<(typeof PORT_FUNCTIONS)[K]> };
/** Every function above, bound to one handle without the `db` argument: what the routes and the sync hold instead of it. */
export interface PlanStorePort extends PortShape {}

export function planStorePort(db: DatabaseSync): PlanStorePort {
  const port: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(PORT_FUNCTIONS)) {
    port[name] = (...a: unknown[]) => (fn as (...x: unknown[]) => unknown)(db, ...a);
  }
  return port as unknown as PlanStorePort;
}
