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
  LINEAR_SYNC_PROGRAMME, UPKEEP_DUE_PREFIX, UPKEEP_EPIC_KEY, UPKEEP_EPIC_TITLE,
  type BindingKind, type BindingState, type InboundState, type CheckpointEvidence, type CheckpointKind, type CheckpointState, type EpicState,
  type PhaseRefKind, type PlanEndOutcome, type TicketDoneEvidence, type TicketKind, type TicketSource, type TicketState,
  type IssueSnapshot, type MapBody, type MigrationState,
} from '../../../shared/plan.js';
import { AUTO_TICKET_PREFIX, autoTicketKey, ccrcIssueIds, epicAdmitsRun, epicIsDone, fitInboundText } from './planPolicy.js';
import { inboundRetirable, retireWhyOf, type RetireWhy } from '../linear/inboundRetire.js';
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

/** The fingerprint of an adopted object (recovery, conflict, an inbound issue taken or placed): it was never sent the current
 *  inputs, so it matches no planned one and the next re-read emits one absolute update (or link) that writes the real
 *  fingerprint. The sync's `adopted` word, spelled once, here. */
export const ADOPTED_FINGERPRINT = 'adopted';

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
  tx(db, () => applyPlanChangesInTx(db, program, changes, by, now, newRow));
}
/** `applyPlanChanges` inside the caller's transaction. A new row is `active` unless `newRow.state` says `paused` (a backlog
 *  programme a migration map proposes, D-8186). */
function applyPlanChangesInTx(
  db: DatabaseSync, program: string, changes: PlanChanges, by: string, now: number, newRow: { home: string; title: string; state?: 'paused' } | null,
): void {
  {
    if (newRow !== null) {
      db.prepare(
        "INSERT INTO programs (slug, title, createdAt, state, homeProject, planRequired) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(slug) DO NOTHING",
      ).run(program, newRow.title, now, newRow.state ?? 'active', newRow.home);
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
  }
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

/** Every binding of a workspace, whatever its state, in id order (D-8183): the drift pass reads them BEFORE it reads Linear, so a
 *  sync write landing after its Linear read is seen as a moved fingerprint and never as drift; the inbound lane reads its
 *  `pending` ticket bindings, whose create may have been sent with its reply lost. */
export function bindingsInWorkspace(db: DatabaseSync, workspaceId: string): BindingRow[] {
  return db.prepare('SELECT * FROM linear_bindings WHERE workspaceId = ? ORDER BY id').all(workspaceId) as unknown as BindingRow[];
}
/** The binding holding a Linear object in a workspace (the drift pass maps each node it reads to its binding, D-8183), or null. */
export function bindingByLinearId(db: DatabaseSync, workspaceId: string, linearId: string): BindingRow | null {
  const r = db.prepare('SELECT * FROM linear_bindings WHERE workspaceId = ? AND linearId = ? ORDER BY id LIMIT 1').get(workspaceId, linearId);
  return (r as BindingRow | undefined) ?? null;
}
/** The sync's due key of a binding's programme: its slug, or `upkeep:<project>` for an Upkeep epic's own objects; null for a
 *  binding with no such object (D-8183: what the drift pass marks due or restores through). */
export function dueKeyOfBinding(db: DatabaseSync, bindingId: number): string | null {
  const b = db.prepare('SELECT localKind, localId FROM linear_bindings WHERE id = ?').get(bindingId) as { localKind: string; localId: number } | undefined;
  if (b === undefined) return null;
  const epic = (id: number): string | null => {
    const e = db.prepare('SELECT program, project FROM plan_epics WHERE id = ?').get(id) as { program: string | null; project: string } | undefined;
    return e === undefined ? null : e.program ?? `${UPKEEP_DUE_PREFIX}${e.project}`;
  };
  switch (b.localKind) {
    case 'programme': return (db.prepare('SELECT slug FROM programs WHERE rowid = ?').get(b.localId) as { slug: string } | undefined)?.slug ?? null;
    case 'epic': return epic(b.localId);
    case 'checkpoint': {
      const c = db.prepare('SELECT epicId FROM plan_checkpoints WHERE id = ?').get(b.localId) as { epicId: number } | undefined;
      return c === undefined ? null : epic(c.epicId);
    }
    case 'ticket': {
      const t = db.prepare('SELECT epicId FROM plan_tickets WHERE id = ?').get(b.localId) as { epicId: number } | undefined;
      return t === undefined ? null : epic(t.epicId);
    }
    default: return null;
  }
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

// ── Drift, managed teams, inbound issues and the sync's streaks (D-8183, wave 4's migration) ───────────────────────────────────
// Every write here is one statement and opens no transaction. `linear_drift_events.value` and `.actor` and
// `linear_inbound.title` and `.body` hold Linear text: read only under `untrusted`.

/** The workspace and team of every team migration that stands `applied`, distinct and ordered: the managed teams. */
export function managedTeams(db: DatabaseSync): { workspaceId: string; teamKey: string }[] {
  return (db.prepare("SELECT DISTINCT workspaceId, teamKey FROM linear_migrations WHERE state = 'applied' ORDER BY workspaceId, teamKey").all() as Raw[])
    .map((r) => ({ workspaceId: r.workspaceId as string, teamKey: r.teamKey as string }));
}

/** When a workspace's first team migration was applied (the drift pass's first watermark, D-8183); null when none was. */
export function managedSince(db: DatabaseSync, workspaceId: string): number | null {
  const r = db.prepare("SELECT MIN(appliedAt) AS at FROM linear_migrations WHERE state = 'applied' AND workspaceId = ?").get(workspaceId) as Raw | undefined;
  return (r?.at as number | null | undefined) ?? null;
}

/** Whether the plan holds a ticket binding for a Linear issue, by its id or its identifier, WHATEVER ITS STATE (D-8183, §7.7: the
 *  proxy refuses a session's update of one in a managed team, `plan-owned`). A `failed` binding keeps its issue (D-8680) and is
 *  ccrc's as much as a `bound` one (review 2386 F4); a `pending` one holds no id yet. Absent ids never match. */
export function issueBound(db: DatabaseSync, workspaceId: string, issue: { id: string | null; identifier: string | null }): boolean {
  return db.prepare("SELECT 1 FROM linear_bindings WHERE localKind = 'ticket' AND workspaceId = ? AND (linearId = ? OR identifier = ?) LIMIT 1")
    .get(workspaceId, issue.id ?? '', issue.identifier ?? '') !== undefined;
}

/** A changed* sweep that reached the page cap and goes on at the next pass (review 2408 F3, D-8734): it reads from `since` (the
 *  watermark, held until the sweep ends), resumes after Linear's cursor `after`, has read up to `newest`, and began at `startedAt`. */
export interface DriftCursor { since: string; after: string; newest: string | null; startedAt: number }
export function driftCursorsOf(db: DatabaseSync, workspaceId: string): Partial<Record<DriftKindWord, DriftCursor>> {
  const out: Partial<Record<DriftKindWord, DriftCursor>> = {};
  for (const r of db.prepare('SELECT * FROM linear_drift_cursors WHERE workspaceId = ?').all(workspaceId) as Raw[]) {
    out[r.kind as DriftKindWord] = { since: r.since as string, after: r.after as string, newest: (r.newest as string | null) ?? null, startedAt: r.startedAt as number };
  }
  return out;
}
/** The one writer of `linear_drift_cursors`: a sweep's cursor kept (a capped read), or cleared (null: the sweep ended, or must start
 *  again). */
export function setDriftCursor(db: DatabaseSync, workspaceId: string, kind: DriftKindWord, c: DriftCursor | null): void {
  if (c === null) { db.prepare('DELETE FROM linear_drift_cursors WHERE workspaceId = ? AND kind = ?').run(workspaceId, kind); return; }
  db.prepare('INSERT INTO linear_drift_cursors (workspaceId, kind, since, after, newest, startedAt) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT(workspaceId, kind) DO UPDATE SET since = excluded.since, after = excluded.after, newest = excluded.newest, startedAt = excluded.startedAt')
    .run(workspaceId, kind, c.since, c.after, c.newest, c.startedAt);
}
/** The drift pass's watermark for each changed* kind (review 2386 A3): the `updatedAt` that kind's read reached. */
export interface DriftWatermarks { initiative: string; project: string; milestone: string; issue: string }
/** The four changed* kinds, as the drift marks and cursors key them. */
export type DriftKindWord = keyof DriftWatermarks;
export function driftMarkOf(db: DatabaseSync, workspaceId: string): { watermarks: DriftWatermarks; passAt: number } | null {
  const r = db.prepare('SELECT * FROM linear_drift_marks WHERE workspaceId = ?').get(workspaceId) as Raw | undefined;
  return r === undefined ? null : {
    watermarks: { initiative: r.initiatives as string, project: r.projects as string, milestone: r.milestones as string, issue: r.issues as string },
    passAt: r.passAt as number,
  };
}
export function setDriftMark(db: DatabaseSync, workspaceId: string, w: DriftWatermarks, passAt: number): void {
  db.prepare('INSERT INTO linear_drift_marks (workspaceId, initiatives, projects, milestones, issues, passAt) VALUES (?, ?, ?, ?, ?, ?) '
    + 'ON CONFLICT(workspaceId) DO UPDATE SET initiatives = excluded.initiatives, projects = excluded.projects, '
    + 'milestones = excluded.milestones, issues = excluded.issues, passAt = excluded.passAt')
    .run(workspaceId, w.initiative, w.project, w.milestone, w.issue, passAt);
}
/** The ticket bindings of a workspace whose grace stands (`driftSince` set): the drift pass re-reads each by id (review 2386 F1). */
export function graceBindingsOf(db: DatabaseSync, workspaceId: string): BindingRow[] {
  return db.prepare("SELECT * FROM linear_bindings WHERE workspaceId = ? AND localKind = 'ticket' AND driftSince IS NOT NULL AND linearId IS NOT NULL ORDER BY id")
    .all(workspaceId) as unknown as BindingRow[];
}

export interface DriftEventRow {
  id: number; bindingId: number; at: number; field: string; value: string; actor: string; restored: boolean; commentedAt: number | null;
}
export function recordDrift(db: DatabaseSync, ev: { bindingId: number; at: number; field: string; value: string; actor: string; restored: boolean }): number {
  const res = db.prepare('INSERT INTO linear_drift_events (bindingId, at, field, value, actor, restored) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ev.bindingId, ev.at, ev.field, ev.value, ev.actor, ev.restored ? 1 : 0);
  return Number(res.lastInsertRowid);
}
/** The `at` of a binding's restores since `since`, ascending. */
export function driftRestoresOf(db: DatabaseSync, bindingId: number, since: number): number[] {
  return (db.prepare('SELECT at FROM linear_drift_events WHERE bindingId = ? AND restored = 1 AND at >= ? ORDER BY at, id').all(bindingId, since) as Raw[])
    .map((r) => r.at as number);
}
/** A binding's newest drift event for one field, or null (review 2386 A4: one change is recorded once). */
export function lastDriftEventOf(db: DatabaseSync, bindingId: number, field: string): { value: string; restored: boolean } | null {
  const r = db.prepare('SELECT value, restored FROM linear_drift_events WHERE bindingId = ? AND field = ? ORDER BY at DESC, id DESC LIMIT 1')
    .get(bindingId, field) as Raw | undefined;
  return r === undefined ? null : { value: r.value as string, restored: r.restored === 1 };
}
export function lastDriftCommentAt(db: DatabaseSync, bindingId: number): number | null {
  const r = db.prepare('SELECT MAX(commentedAt) AS at FROM linear_drift_events WHERE bindingId = ?').get(bindingId) as Raw | undefined;
  return (r?.at as number | null | undefined) ?? null;
}
export function markDriftCommented(db: DatabaseSync, eventId: number, at: number): void {
  db.prepare('UPDATE linear_drift_events SET commentedAt = ? WHERE id = ?').run(at, eventId);
}
export function driftEventsOf(db: DatabaseSync, bindingId: number, since: number): DriftEventRow[] {
  return (db.prepare('SELECT * FROM linear_drift_events WHERE bindingId = ? AND at >= ? ORDER BY at, id').all(bindingId, since) as Raw[]).map((r) => ({
    id: r.id as number, bindingId: r.bindingId as number, at: r.at as number, field: r.field as string, value: r.value as string,
    actor: r.actor as string, restored: r.restored === 1, commentedAt: (r.commentedAt as number | null) ?? null,
  }));
}
/** The one writer of `linear_bindings.driftSince` (null clears it) and, below, of `heldItemId`. */
export function setDriftSince(db: DatabaseSync, bindingId: number, at: number | null): void {
  db.prepare('UPDATE linear_bindings SET driftSince = ? WHERE id = ?').run(at, bindingId);
}
export function setDriftItem(db: DatabaseSync, bindingId: number, itemId: number | null): void {
  db.prepare('UPDATE linear_bindings SET heldItemId = ? WHERE id = ?').run(itemId, bindingId);
}

export interface InboundRow {
  linearId: string; workspaceId: string; teamKey: string; identifier: string; title: string; body: string | null; seenAt: number;
  mailedTo: string | null; mailedAt: number | null; handedTo: string | null; reason: string | null; actedAt: number | null; state: InboundState;
  /** The operator item a `raise` made for the row (D-8183): the link from a `raised` row to its answer. */
  itemId: number | null;
  /** Why a `retired` row left the lane (review 2457 F4, D-8735); null for every other state, and for a row retired before the column. */
  retiredWhy: RetireWhy | null;
}
const inboundRow = (r: Raw): InboundRow => ({
  linearId: r.linearId as string, workspaceId: r.workspaceId as string, teamKey: r.teamKey as string, identifier: r.identifier as string,
  title: r.title as string, body: (r.body as string | null) ?? null, seenAt: r.seenAt as number, mailedTo: (r.mailedTo as string | null) ?? null,
  mailedAt: (r.mailedAt as number | null) ?? null, handedTo: (r.handedTo as string | null) ?? null, reason: (r.reason as string | null) ?? null,
  actedAt: (r.actedAt as number | null) ?? null, state: r.state as InboundState, itemId: (r.itemId as number | null) ?? null,
  retiredWhy: retireWhyOf(r.retiredWhy),
});
/** A new issue is inserted `waiting`; a known one keeps its state and only refreshes `title` and `body`. The text is cut
 *  visibly to the plan's ticket bounds first (`fitInboundText`, D-8705): this is the one writer. */
export function upsertInbound(
  db: DatabaseSync, row: { linearId: string; workspaceId: string; teamKey: string; identifier: string; title: string; body: string | null; seenAt: number },
): 'new' | 'known' {
  const fit = fitInboundText(row.title, row.body);
  const known = db.prepare('SELECT 1 AS k FROM linear_inbound WHERE linearId = ?').get(row.linearId) !== undefined;
  if (known) {
    db.prepare('UPDATE linear_inbound SET title = ?, body = ? WHERE linearId = ?').run(fit.title, fit.body, row.linearId);
    return 'known';
  }
  db.prepare("INSERT INTO linear_inbound (linearId, workspaceId, teamKey, identifier, title, body, seenAt, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')")
    .run(row.linearId, row.workspaceId, row.teamKey, row.identifier, fit.title, fit.body, row.seenAt);
  return 'new';
}
export function inboundOf(db: DatabaseSync, linearId: string): InboundRow | null {
  const r = db.prepare('SELECT * FROM linear_inbound WHERE linearId = ?').get(linearId) as Raw | undefined;
  return r === undefined ? null : inboundRow(r);
}
const INBOUND_PATCH_COLUMNS = ['state', 'mailedTo', 'mailedAt', 'handedTo', 'reason', 'actedAt', 'itemId', 'retiredWhy'] as const;
/** Set the named columns of one row; a column not named stays. The column names come from the list above, never the caller. */
export function setInboundState(
  db: DatabaseSync, linearId: string,
  patch: Partial<{ state: InboundState; mailedTo: string | null; mailedAt: number | null; handedTo: string | null; reason: string | null; actedAt: number | null; itemId: number | null; retiredWhy: RetireWhy | null }>,
): void {
  const cols = INBOUND_PATCH_COLUMNS.filter((c) => patch[c] !== undefined);
  if (cols.length === 0) return;
  db.prepare(`UPDATE linear_inbound SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linearId = ?`)
    .run(...cols.map((c) => patch[c] as string | number | null), linearId);
}
/** THE ONE RETIRE of a stored inbound row (review 2457 F4, A6; D-8735): the state, its cause and the deletion of the row's stored note
 *  are ONE act, so no retire leaves an orphan note behind and none leaves a row retired with no cause. A row that is not retirable now
 *  (`inboundRetirable`: taken, placed, an acted close, already retired, or gone) is left as it is and the answer is false: a door's
 *  re-read ran outside the transaction, so the row is judged again here. The caller holds the transaction (`retireInbound` opens one). */
export function retireInboundInTx(db: DatabaseSync, linearId: string, why: RetireWhy): boolean {
  const row = inboundOf(db, linearId);
  if (row === null || !inboundRetirable(row)) return false;
  setInboundState(db, linearId, { state: 'retired', retiredWhy: why });
  clearInboundNote(db, linearId);
  return true;
}
/** `retireInboundInTx` in a transaction of its own. */
export function retireInbound(db: DatabaseSync, linearId: string, why: RetireWhy): boolean { return tx(db, () => retireInboundInTx(db, linearId, why)); }
export function inboundByState(db: DatabaseSync, workspaceId: string | null, states: InboundState[]): InboundRow[] {
  if (states.length === 0) return [];
  const marks = states.map(() => '?').join(', ');
  const rows = workspaceId === null
    ? db.prepare(`SELECT * FROM linear_inbound WHERE state IN (${marks}) ORDER BY seenAt, linearId`).all(...states)
    : db.prepare(`SELECT * FROM linear_inbound WHERE workspaceId = ? AND state IN (${marks}) ORDER BY seenAt, linearId`).all(workspaceId, ...states);
  return (rows as Raw[]).map(inboundRow);
}
/** How many `waiting` rows sit in the team the project is linked to (keys compared upper-case). */
export function inboundWaiting(db: DatabaseSync, project: string): number {
  const r = db.prepare(
    "SELECT COUNT(*) AS n FROM linear_inbound i JOIN project_linking l ON UPPER(l.teamKey) = UPPER(i.teamKey) WHERE l.project = ? AND i.state = 'waiting'",
  ).get(project) as Raw;
  return r.n as number;
}

export interface StreakRow { keyDigest: string; since: number; lastFilledAt: number; refills: number }
/** The plan sync's episode streaks (D-8701), by key. */
export function streaksOf(db: DatabaseSync): Map<string, StreakRow> {
  const out = new Map<string, StreakRow>();
  for (const r of db.prepare('SELECT * FROM linear_sync_streaks ORDER BY key').all() as Raw[]) {
    out.set(r.key as string, { keyDigest: r.keyDigest as string, since: r.since as number, lastFilledAt: r.lastFilledAt as number, refills: r.refills as number });
  }
  return out;
}
/** Write one streak, or delete it with null. */
export function setStreak(db: DatabaseSync, key: string, s: StreakRow | null): void {
  if (s === null) { db.prepare('DELETE FROM linear_sync_streaks WHERE key = ?').run(key); return; }
  db.prepare('INSERT INTO linear_sync_streaks (key, keyDigest, since, lastFilledAt, refills) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(key) DO UPDATE SET keyDigest = excluded.keyDigest, since = excluded.since, lastFilledAt = excluded.lastFilledAt, refills = excluded.refills')
    .run(key, s.keyDigest, s.since, s.lastFilledAt, s.refills);
}
/** The plan sync's settled probes: workspace to the programme slugs whose probe settled. */
export function settledProbes(db: DatabaseSync): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of db.prepare('SELECT workspaceId, program FROM linear_probe_settled ORDER BY workspaceId, program').all() as Raw[]) {
    const set = out.get(r.workspaceId as string) ?? new Set<string>();
    set.add(r.program as string);
    out.set(r.workspaceId as string, set);
  }
  return out;
}
export function addSettledProbe(db: DatabaseSync, workspaceId: string, program: string): void {
  db.prepare('INSERT INTO linear_probe_settled (workspaceId, program) VALUES (?, ?) ON CONFLICT DO NOTHING').run(workspaceId, program);
}
export function clearSettledProbes(db: DatabaseSync, workspaceId: string): void {
  db.prepare('DELETE FROM linear_probe_settled WHERE workspaceId = ?').run(workspaceId);
}

// ── The Upkeep epic and the inbound ticket (D-8183, Task 4.3) ─────────────────────────────────────────────────────────────

/** A project's Upkeep epic (no programme, one per project: the partial unique index `plan_epics_upkeep`), with its checkpoints
 *  (never any) and tickets; null before the first use. */
export function upkeepEpicOf(db: DatabaseSync, project: string): (EpicRow & { checkpoints: CheckpointRow[]; tickets: TicketRow[] }) | null {
  const r = db.prepare('SELECT * FROM plan_epics WHERE program IS NULL AND project = ?').get(project) as Raw | undefined;
  if (r === undefined) return null;
  const e = epicOf(r);
  const cps = db.prepare('SELECT * FROM plan_checkpoints WHERE epicId = ? ORDER BY ordinal, id').all(e.id) as Raw[];
  const tks = db.prepare('SELECT * FROM plan_tickets WHERE epicId = ? ORDER BY id').all(e.id) as Raw[];
  return { ...e, checkpoints: cps.map(checkpointOf), tickets: tks.map(ticketOf) };
}
/** The Upkeep epic as a plan, for the sync's snapshot and the console's page: its due key is `upkeep:<project>`, it has no
 *  coordinator and requires none. */
export function upkeepPlanOf(db: DatabaseSync, project: string): StoredPlan {
  const epic = upkeepEpicOf(db, project);
  return { program: `${UPKEEP_DUE_PREFIX}${project}`, planBy: null, required: false, epics: epic === null ? [] : [epic] };
}
/** Insert the project's Upkeep epic once (no programme, no waves, `active`, never closed: `settleEpicInTx` skips a programmeless
 *  epic) and answer its id; an epic already there is answered unchanged. Opens no transaction. */
export function ensureUpkeepEpicInTx(db: DatabaseSync, project: string, now: number): number {
  const held = upkeepEpicOf(db, project);
  if (held !== null) return held.id;
  const res = db.prepare(
    "INSERT INTO plan_epics (program, project, waves, key, ordinal, title, summary, state, openedAt) VALUES (NULL, ?, '[]', ?, 0, ?, ?, 'active', ?)",
  ).run(project, UPKEEP_EPIC_KEY, UPKEEP_EPIC_TITLE, 'Issues filed in Linear that no programme has taken yet.', now);
  return Number(res.lastInsertRowid);
}
/** The key of the ticket an inbound issue becomes: `inbound-<identifier lower-cased>`, a plan key. */
export const inboundTicketKey = (identifier: string): string => `inbound-${identifier.toLowerCase()}`;
/** A ticket for an inbound issue: `source` `inbound`, `kind` `task`, `open`, in the epic given (a programme's, or an Upkeep epic
 *  with `program` null); marks the epic's due key. Opens no transaction. */
export function inboundTicketInTx(
  db: DatabaseSync,
  t: { program: string | null; epicId: number; checkpointId: number | null; key: string; title: string; body: string; project: string },
  now: number,
): number {
  const res = db.prepare(
    "INSERT INTO plan_tickets (program, project, epicId, checkpointId, key, kind, title, body, source, state) VALUES (?, ?, ?, ?, ?, 'task', ?, ?, 'inbound', 'open')",
  ).run(t.program, t.project, t.epicId, t.checkpointId, t.key, t.title, t.body);
  const e = epicById(db, t.epicId);
  if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
  return Number(res.lastInsertRowid);
}
/** A `bound` ticket binding at an issue that exists already, with the adopted fingerprint, so the next pass sends one absolute
 *  update that re-parents the issue into its epic's project and never creates a second issue. Opens no transaction. */
export function adoptIssueBindingInTx(
  db: DatabaseSync, ticketId: number, workspaceId: string, teamKey: string, linearId: string, identifier: string, now: number,
): void {
  const b = ensurePending(db, 'ticket', ticketId, workspaceId, teamKey);
  markBound(db, b.id, linearId, identifier, ADOPTED_FINGERPRINT, now, teamKey);
}
/** An Upkeep ticket taken into a programme: `program`, `epicId` and `checkpointId` change in one statement; both epics' due keys
 *  are marked and both settle (the source epic may have nothing open now; an Upkeep epic never settles). Opens no transaction. */
export function moveTicketToProgrammeInTx(
  db: DatabaseSync, ticketId: number, program: string, epicId: number, checkpointId: number | null, now: number,
): void {
  const before = ticketById(db, ticketId);
  if (before === null) throw new Error(`plan store: no ticket ${ticketId} to move`);
  db.prepare('UPDATE plan_tickets SET program = ?, epicId = ?, checkpointId = ? WHERE id = ?').run(program, epicId, checkpointId, ticketId);
  for (const id of new Set([before.epicId, epicId])) {
    const e = epicById(db, id);
    if (e !== null) markSyncDueInTx(db, dueKeyOf(e), now);
    settleEpicInTx(db, id, now);
  }
}
/** What the owner's next mail about a `waiting` inbound issue must carry beyond the first mail (D-8734, D-8735): a coordinator's
 *  return made while the team had no live owner (`returned`, its programme and masked note), or Linear's reopen of a retired
 *  issue (`reopened`). One per issue: a later note replaces an earlier one. The inbound lane mails it and deletes it in one
 *  transaction (`clearInboundNote`). */
export type InboundNote = { kind: 'returned'; program: string; note: string; at: number } | { kind: 'reopened'; at: number; was: RetireWhy | null };
export function setInboundNote(db: DatabaseSync, linearId: string, n: InboundNote): void {
  db.prepare('INSERT INTO linear_inbound_notes (linearId, kind, program, note, at) VALUES (?, ?, ?, ?, ?) '
    + 'ON CONFLICT(linearId) DO UPDATE SET kind = excluded.kind, program = excluded.program, note = excluded.note, at = excluded.at')
    .run(linearId, n.kind, n.kind === 'returned' ? n.program : null, n.kind === 'returned' ? n.note : n.was, n.at);   // a reopen's `note` is the row's own retire cause, ccrc's word (review 2524 A4)
}
export function inboundNoteOf(db: DatabaseSync, linearId: string): InboundNote | null {
  const r = db.prepare('SELECT * FROM linear_inbound_notes WHERE linearId = ?').get(linearId) as Raw | undefined;
  if (r === undefined) return null;
  return r.kind === 'returned'
    ? { kind: 'returned', program: r.program as string, note: r.note as string, at: r.at as number }
    : { kind: 'reopened', at: r.at as number, was: retireWhyOf(r.note) };
}
/** Deletes an issue's note; the caller holds the transaction that mailed it. */
export function clearInboundNote(db: DatabaseSync, linearId: string): void {
  db.prepare('DELETE FROM linear_inbound_notes WHERE linearId = ?').run(linearId);
}
/** The inbound row of an issue by its identifier (the verbs name it so) in a workspace (round 4 A2: two workspaces may each hold
 *  a team keyed alike), or null; `null` for the workspace (unmeasured) resolves only an identifier no other workspace holds. */
export function inboundByIdentifier(db: DatabaseSync, workspaceId: string | null, identifier: string): InboundRow | null {
  const rows = (workspaceId === null
    ? db.prepare('SELECT * FROM linear_inbound WHERE identifier = ? COLLATE NOCASE ORDER BY seenAt LIMIT 2').all(identifier)
    : db.prepare('SELECT * FROM linear_inbound WHERE workspaceId = ? AND identifier = ? COLLATE NOCASE ORDER BY seenAt LIMIT 1').all(workspaceId, identifier)) as Raw[];
  // two workspaces' identifiers are not told apart without a workspace: an ambiguous one resolves to nothing, never to a guess
  return rows.length === 0 || (workspaceId === null && rows.length > 1) ? null : inboundRow(rows[0]!);
}
/** The rows of that identifier handed to a programme (`plan take`'s: the taking programme names no issue workspace of its own). */
export function handedInboundByIdentifier(db: DatabaseSync, slug: string, identifier: string): InboundRow[] {
  return (db.prepare("SELECT * FROM linear_inbound WHERE state = 'handed' AND handedTo = ? AND identifier = ? COLLATE NOCASE ORDER BY seenAt").all(slug, identifier) as Raw[]).map(inboundRow);
}
/** The Upkeep ticket (no programme) whose issue is bound under that identifier in that workspace, or null. */
export function upkeepTicketByIdentifier(db: DatabaseSync, workspaceId: string | null, identifier: string): TicketRow | null {
  const base = "SELECT t.* FROM plan_tickets t JOIN linear_bindings b ON b.localKind = 'ticket' AND b.localId = t.id "
    + 'WHERE t.program IS NULL AND b.identifier = ? COLLATE NOCASE';
  // keyed by the binding's workspace (review 2524 A1), as `inboundByIdentifier` is; no workspace resolves only an identifier no other
  // workspace's ticket holds, never a guess
  const rows = (workspaceId === null
    ? db.prepare(`${base} ORDER BY t.id LIMIT 2`).all(identifier)
    : db.prepare(`${base} AND b.workspaceId = ? ORDER BY t.id LIMIT 1`).all(identifier, workspaceId)) as Raw[];
  return rows.length === 0 || (workspaceId === null && rows.length > 1) ? null : ticketOf(rows[0]!);
}

/** Every Linear id a binding holds in the workspace (the drift pass's one read of what is bound, D-8183). */
export function boundLinearIdsOf(db: DatabaseSync, workspaceId: string): string[] {
  return (db.prepare('SELECT DISTINCT linearId FROM linear_bindings WHERE workspaceId = ? AND linearId IS NOT NULL ORDER BY linearId').all(workspaceId) as Raw[])
    .map((r) => r.linearId as string);
}
/** The projects that have an Upkeep epic, in order: the sweeps that walk every programme walk these keys too. */
export function upkeepProjectsOf(db: DatabaseSync): string[] {
  return (db.prepare('SELECT project FROM plan_epics WHERE program IS NULL ORDER BY project').all() as Raw[]).map((r) => r.project as string);
}

/** Run `fn` in ONE transaction on this handle (`BEGIN IMMEDIATE`, rolled back when it throws): the one door a route has to make
 *  a mail and an inbound row's state land together without naming the handle (D-8183). `fn` must open no transaction of its own. */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T { return tx(db, fn); }

/** What the composites below answer when the row is not there to act on. */
export type InboundAct = { ok: true; ticketId: number } | { ok: false; refused: 'issue-not-inbound' };

/** Whether a binding of the row's workspace already holds the issue, or a pending ticket's create carries its id (round 5 F2, round 6 P1;
 *  `ccrcIssueIds`, the one builder): read inside the composite's transaction, so a second ticket is never bound to one issue. */
const heldByCcrc = (db: DatabaseSync, row: InboundRow): boolean => ccrcIssueIds(bindingsInWorkspace(db, row.workspaceId)).has(row.linearId);

/** `plan triage upkeep` in ONE transaction: the project's Upkeep epic (made on first use), a ticket in it carrying the reporter's
 *  title and body (masked by the caller's `mask`), the issue's binding adopted, the row `placed`. */
export function placeInboundInUpkeep(
  db: DatabaseSync, p: { linearId: string; project: string; now: number; mask?: (text: string) => string },
): InboundAct {
  return tx(db, () => {
    const row = inboundOf(db, p.linearId);
    if (row === null || (row.state !== 'waiting' && row.state !== 'mailed') || heldByCcrc(db, row)) return { ok: false, refused: 'issue-not-inbound' };
    const mask = p.mask ?? ((x: string) => x);
    const epicId = ensureUpkeepEpicInTx(db, p.project, p.now);
    const ticketId = inboundTicketInTx(db, {
      program: null, epicId, checkpointId: null, key: inboundTicketKey(row.identifier), title: mask(row.title), body: mask(row.body ?? ''), project: p.project,
    }, p.now);
    adoptIssueBindingInTx(db, ticketId, row.workspaceId, row.teamKey, row.linearId, row.identifier, p.now);
    setInboundState(db, row.linearId, { state: 'placed' });
    return { ok: true, ticketId };
  });
}
/** `plan take` (and a hand to the owner's own programme) of an inbound row in ONE transaction: a ticket in the epic, its binding
 *  adopted, the row `taken`, the epic settled. The row must be `waiting`, `mailed` or `handed`. */
export function takeInboundIntoEpic(
  db: DatabaseSync,
  p: { linearId: string; program: string; epicId: number; checkpointId: number | null; project: string; now: number; mask?: (text: string) => string },
): InboundAct {
  return tx(db, () => {
    const row = inboundOf(db, p.linearId);
    if (row === null || (row.state !== 'waiting' && row.state !== 'mailed' && row.state !== 'handed') || heldByCcrc(db, row)) return { ok: false, refused: 'issue-not-inbound' };
    const mask = p.mask ?? ((x: string) => x);
    const ticketId = inboundTicketInTx(db, {
      program: p.program, epicId: p.epicId, checkpointId: p.checkpointId, key: inboundTicketKey(row.identifier), title: mask(row.title), body: mask(row.body ?? ''), project: p.project,
    }, p.now);
    adoptIssueBindingInTx(db, ticketId, row.workspaceId, row.teamKey, row.linearId, row.identifier, p.now);
    setInboundState(db, row.linearId, { state: 'taken' });
    settleEpicInTx(db, p.epicId, p.now);
    return { ok: true, ticketId };
  });
}
/** `plan take` of an Upkeep ticket in ONE transaction (`moveTicketToProgrammeInTx`). */
export function takeUpkeepTicket(
  db: DatabaseSync, p: { ticketId: number; program: string; epicId: number; checkpointId: number | null; now: number },
): { ok: true; ticketId: number } {
  return tx(db, () => { moveTicketToProgrammeInTx(db, p.ticketId, p.program, p.epicId, p.checkpointId, p.now); return { ok: true as const, ticketId: p.ticketId }; });
}

// ── The migration (D-8186, wave 7; the rows of migration 95, the columns of this wave's migration) ─────────────────────────

/** What a migration's report lists beyond its move rows: issues skipped as changed since the map was stored, issues of a live
 *  programme still waiting for its wave boundary, and, after put back, the issues that moved since (left untouched) and the
 *  milestones the migration created (they stay in Linear under their canceled project, D-8795). Identifiers, never UUIDs alone. */
export interface MigrationReport { skipped: string[]; waiting: string[]; movedSince: string[]; milestonesLeft: string[] }
export const EMPTY_MIGRATION_REPORT = (): MigrationReport => ({ skipped: [], waiting: [], movedSince: [], milestonesLeft: [] });
export interface MigrationRow {
  id: number; workspaceId: string; teamKey: string; project: string | null; state: MigrationState; map: MapBody | null;
  itemId: number | null; reportItemId: number | null; createdAt: number; updatedAt: number; appliedAt: number | null;
  putBackAt: number | null; report: MigrationReport | null; putBackAskedAt: number | null; reportDoneAt: number | null;
}
/** A `linear_migration_moves` row as stored (`before` and `after` parsed): `kind` is `issue`, or the binding kind of an object the
 *  migration created (`before` null, `subject` `<kind>:<localId>`). */
export interface MoveRowStored {
  id: number; migrationId: number; subject: string; kind: 'issue' | 'programme' | 'epic' | 'checkpoint'; linearId: string | null;
  identifier: string | null; before: IssueSnapshot | null; after: Record<string, unknown>; appliedAt: number | null; revertedAt: number | null;
}
const migrationOf = (r: Raw): MigrationRow => ({
  ...(r as unknown as MigrationRow), map: json<MapBody | null>(r.map, null), report: json<MigrationReport | null>(r.report, null),
});
const moveOf = (r: Raw): MoveRowStored => ({
  ...(r as unknown as MoveRowStored), before: json<IssueSnapshot | null>(r.before, null), after: json<Record<string, unknown>>(r.after, {}),
});
export function migrationById(db: DatabaseSync, id: number): MigrationRow | null {
  const r = db.prepare('SELECT * FROM linear_migrations WHERE id = ?').get(id) as Raw | undefined;
  return r === undefined ? null : migrationOf(r);
}
/** Every migration, newest first (one row per team migration: a small table). */
export function migrationsOf(db: DatabaseSync): MigrationRow[] {
  return (db.prepare('SELECT * FROM linear_migrations ORDER BY id DESC').all() as Raw[]).map(migrationOf);
}
/** A new migration of one team, `proposing`. */
export function insertMigration(db: DatabaseSync, m: { workspaceId: string; teamKey: string; project: string; now: number }): number {
  const res = db.prepare(
    "INSERT INTO linear_migrations (workspaceId, teamKey, project, state, createdAt, updatedAt) VALUES (?, ?, ?, 'proposing', ?, ?)",
  ).run(m.workspaceId, m.teamKey, m.project, m.now, m.now);
  return Number(res.lastInsertRowid);
}
const MIGRATION_PATCH = ['state', 'map', 'itemId', 'reportItemId', 'appliedAt', 'putBackAt', 'report', 'putBackAskedAt', 'reportDoneAt'] as const;
export type MigrationPatch = Partial<{
  state: MigrationState; map: MapBody | null; itemId: number | null; reportItemId: number | null; appliedAt: number | null;
  putBackAt: number | null; report: MigrationReport | null; putBackAskedAt: number | null; reportDoneAt: number | null;
}>;
/** THE one writer of a migration row's columns: the patch lands only while the row's state is one of `from` (a guard, so two
 *  acts never both move one row), and `updatedAt` moves with it. False: the row is not in any of those states. Opens no
 *  transaction of its own; a single statement is atomic. */
export function setMigration(db: DatabaseSync, id: number, from: readonly MigrationState[], patch: MigrationPatch, now: number): boolean {
  const cols = MIGRATION_PATCH.filter((c) => patch[c] !== undefined);
  const args = cols.map((c) => (c === 'map' || c === 'report') ? (patch[c] === null ? null : JSON.stringify(patch[c])) : patch[c] as string | number | null);
  const res = db.prepare(
    `UPDATE linear_migrations SET ${[...cols.map((c) => `${c} = ?`), 'updatedAt = ?'].join(', ')} WHERE id = ? AND state IN (${from.map(() => '?').join(', ')})`,
  ).run(...args, now, id, ...from);
  return Number(res.changes) > 0;
}
/** A move row, written BEFORE its write; a second insert of one subject keeps the first (the unique index): the row as it stands. */
export function insertMove(
  db: DatabaseSync,
  m: { migrationId: number; subject: string; kind: MoveRowStored['kind']; linearId: string | null; identifier: string | null; before: IssueSnapshot | null; after: Record<string, unknown> },
): MoveRowStored {
  db.prepare(
    'INSERT INTO linear_migration_moves (migrationId, subject, kind, linearId, identifier, before, after) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  ).run(m.migrationId, m.subject, m.kind, m.linearId, m.identifier, m.before === null ? null : JSON.stringify(m.before), JSON.stringify(m.after));
  return moveOf(db.prepare('SELECT * FROM linear_migration_moves WHERE migrationId = ? AND subject = ?').get(m.migrationId, m.subject) as Raw);
}
export function movesOf(db: DatabaseSync, migrationId: number): MoveRowStored[] {
  return (db.prepare('SELECT * FROM linear_migration_moves WHERE migrationId = ? ORDER BY id').all(migrationId) as Raw[]).map(moveOf);
}
/** A move's later facts: its Linear id (a created object's, from its binding), its after (a re-measured one), when it was applied,
 *  when it was put back. A field not named stays. */
export function setMove(db: DatabaseSync, id: number, p: Partial<{ linearId: string; after: Record<string, unknown>; appliedAt: number; revertedAt: number }>): void {
  if (p.linearId !== undefined) db.prepare('UPDATE linear_migration_moves SET linearId = ? WHERE id = ?').run(p.linearId, id);
  if (p.after !== undefined) db.prepare('UPDATE linear_migration_moves SET after = ? WHERE id = ?').run(JSON.stringify(p.after), id);
  if (p.appliedAt !== undefined) db.prepare('UPDATE linear_migration_moves SET appliedAt = ? WHERE id = ? AND appliedAt IS NULL').run(p.appliedAt, id);
  if (p.revertedAt !== undefined) db.prepare('UPDATE linear_migration_moves SET revertedAt = ? WHERE id = ? AND revertedAt IS NULL').run(p.revertedAt, id);
}

/** Task 7.3's adoption of an existing open issue as a ticket (D-8186; D-8796: inside the caller's transaction, with its move
 *  row): a `plan_tickets` row (the key and kind the map gives, the issue's title and body fitted to the ticket bounds, the epic's
 *  project, `source` `plan` for a leaf and `inbound` for an upkeep entry, `started` when the issue's state type is `started`,
 *  else `open`) and a binding already `bound` to the issue with the adopted fingerprint, so the next pass of the key sends one
 *  absolute update and never creates a second issue (`adoptIssueBindingInTx`, the inbound path's). The key is marked due.
 *  Opens no transaction. */
export function adoptIssueAsTicketInTx(
  db: DatabaseSync,
  a: { issue: IssueSnapshot & { linearId: string; identifier: string }; programme: string | null; epicId: number; checkpointId: number | null; key: string; kind: TicketKind; source: 'plan' | 'inbound'; mask?: (text: string) => string },
  binding: { workspaceId: string; teamKey: string },
  now: number,
): number {
  const e = epicById(db, a.epicId);
  if (e === null) throw new Error(`plan store: no epic ${a.epicId} to adopt ${a.issue.identifier} into`);
  const mask = a.mask ?? ((x: string) => x);
  const fit = fitInboundText(mask(a.issue.title), mask(a.issue.description));
  const state: TicketState = a.issue.state === 'started' ? 'started' : 'open';
  const res = db.prepare(
    'INSERT INTO plan_tickets (program, project, epicId, checkpointId, key, kind, title, body, source, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(a.programme, e.project, a.epicId, a.checkpointId, a.key, a.kind, fit.title, fit.body ?? '', a.source, state);
  const ticketId = Number(res.lastInsertRowid);
  adoptIssueBindingInTx(db, ticketId, binding.workspaceId, binding.teamKey, a.issue.linearId, a.issue.identifier, now);
  markSyncDueInTx(db, dueKeyOf(e), now);
  return ticketId;
}
/** The structure a map declares for one programme (D-8186, §10.1; D-8796): its plan rows, a new `paused` row for a backlog
 *  programme, and one move row per object the plan sync will create for it (`before` null, no Linear id yet), all in ONE
 *  transaction, so put back finds every created object in the move record. The key is marked due (the sync creates the
 *  objects). `by` is the plan's author for `planBy`. Answers the move rows written. */
export function declareMapStructure(
  db: DatabaseSync, migrationId: number, program: string, changes: PlanChanges, by: string, now: number, newRow: { home: string; title: string; state: 'paused' } | null,
): MoveRowStored[] {
  return tx(db, () => {
    applyPlanChangesInTx(db, program, changes, by, now, newRow);
    const rowid = programmeRowId(db, program);
    const subjects: { subject: string; kind: MoveRowStored['kind'] }[] = [];
    if (rowid !== null && !(db.prepare("SELECT 1 FROM linear_bindings WHERE localKind = 'programme' AND localId = ?").get(rowid))) {
      subjects.push({ subject: `programme:${rowid}`, kind: 'programme' });
    }
    for (const e of changes.epics.insert) {
      const id = epicIdByKey(db, program, e.project, e.key);
      if (id !== null) subjects.push({ subject: `epic:${id}`, kind: 'epic' });
    }
    for (const c of changes.checkpoints.insert) {
      const epicId = epicIdByKey(db, program, '', c.epicKey);
      const id = epicId === null ? null : checkpointIdByKey(db, epicId, c.key);
      if (id !== null) subjects.push({ subject: `checkpoint:${id}`, kind: 'checkpoint' });
    }
    return subjects.map((x) => insertMove(db, { migrationId, ...x, linearId: null, identifier: null, before: null, after: { created: true } }));
  });
}
/** D-8796 (condition 1): the objects an `approved` or `applying` migration still writes through the sync, as
 *  `<bindingKind>:<localId>`: a created object's move row names its own, an adopted issue's names its ticket (`after.ticketId`). */
export function migratingLocals(db: DatabaseSync): Set<string> {
  const rows = db.prepare(
    "SELECT mv.subject AS subject, mv.after AS after FROM linear_migration_moves mv JOIN linear_migrations m ON m.id = mv.migrationId "
    + "WHERE m.state IN ('approved', 'applying') AND mv.appliedAt IS NULL",
  ).all() as Raw[];
  const out = new Set<string>();
  for (const r of rows) {
    const subject = r.subject as string;
    if (!subject.startsWith('issue:')) { out.add(subject); continue; }
    const t = json<Record<string, unknown>>(r.after, {})['ticketId'];
    if (typeof t === 'number') out.add(`ticket:${t}`);
  }
  return out;
}
/** Every programme of the team's migration made plan-required on apply (§4.3): a new run there names its ticket. */
export function setPlanRequired(db: DatabaseSync, programs: readonly string[]): void {
  for (const p of programs) db.prepare('UPDATE programs SET planRequired = 1 WHERE slug = ?').run(p);
}
/** Put back's ccrc half (D-8186, Task 7.4): the epics, checkpoints and tickets the migration made are dropped with the reason
 *  "put back" and `putBackAt` set, in ONE transaction; the sync's snapshot leaves out every record with `putBackAt` set
 *  (`withoutPutBack`), so it emits nothing for them. A record already put back is left. Each touched epic's key is marked due. */
export function dropPutBack(db: DatabaseSync, ids: { epics: readonly number[]; checkpoints: readonly number[]; tickets: readonly number[] }, now: number): void {
  tx(db, () => {
    const why = 'put back';
    for (const id of ids.tickets) db.prepare("UPDATE plan_tickets SET state = 'dropped', droppedWhy = ?, putBackAt = ? WHERE id = ? AND putBackAt IS NULL").run(why, now, id);
    for (const id of ids.checkpoints) db.prepare("UPDATE plan_checkpoints SET state = 'dropped', droppedWhy = ?, putBackAt = ? WHERE id = ? AND putBackAt IS NULL").run(why, now, id);
    for (const id of ids.epics) db.prepare("UPDATE plan_epics SET state = 'dropped', droppedWhy = ?, putBackAt = ? WHERE id = ? AND putBackAt IS NULL").run(why, now, id);
    const keys = new Set<string>();
    for (const id of ids.epics) { const e = epicById(db, id); if (e !== null) keys.add(dueKeyOf(e)); }
    for (const id of ids.tickets) { const t = ticketById(db, id); const e = t === null ? null : epicById(db, t.epicId); if (e !== null) keys.add(dueKeyOf(e)); }
    for (const k of keys) markSyncDueInTx(db, k, now);
  });
}

// ── The port ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const PORT_FUNCTIONS = {
  planOf, phasesOf, writePhaseRef, planEndOf, planOwnerOf, applyPlanChanges, closePlan, settleEpicInTx, markCheckpointMet, insertTicket, updateTicket,
  doneFactsOf, ticketOfRun, markTicketDone,
  ticketById, ticketByKey, epicOfRun, attachTicketInTx, onRunAdvancedInTx, bindingOf, ensurePending, markBound, markFailed, requeueFailed,
  bindingsOf, markSyncDue, markSyncDueInTx, dueSyncs, clearSyncDue, deferSync, heldSyncUntil, hierarchySettingsOf, setHierarchySettings,
  hierarchyProjectsOf, setLinearOwnerForAll, latestProgrammeCoordinator, coordinatorIdsOf, programmeRowId, openOperatorActs,
  managedTeams, issueBound, driftMarkOf, setDriftMark, driftCursorsOf, setDriftCursor, graceBindingsOf, lastDriftEventOf, recordDrift, driftRestoresOf, lastDriftCommentAt, markDriftCommented, driftEventsOf,
  setDriftSince, setDriftItem, upsertInbound, inboundOf, setInboundState, retireInboundInTx, retireInbound, inboundByState, inboundWaiting, streaksOf, setStreak,
  settledProbes, addSettledProbe, clearSettledProbes, bindingByLinearId, bindingsInWorkspace, dueKeyOfBinding, managedSince,
  upkeepEpicOf, upkeepPlanOf, ensureUpkeepEpicInTx, inboundTicketInTx, adoptIssueBindingInTx, moveTicketToProgrammeInTx, inboundByIdentifier, handedInboundByIdentifier,
  upkeepTicketByIdentifier, setInboundNote, inboundNoteOf, clearInboundNote, placeInboundInUpkeep, takeInboundIntoEpic, takeUpkeepTicket, boundLinearIdsOf, upkeepProjectsOf, inTransaction,
  migrationById, migrationsOf, insertMigration, setMigration, insertMove, movesOf, setMove, adoptIssueAsTicketInTx, declareMapStructure,
  setPlanRequired, dropPutBack, migratingLocals,
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
