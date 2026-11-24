// The programme lifecycle's ONE writer, coord.db SQL in `planStore.ts`' idiom (programme lifecycle spec 2026-11-24 §3, §5, §13, §15; D-8983, D-8985,
// D-8989, D-8993). Every write of `programs.state`, the end's record (`planEnd`, `planEndWhy`, `planEndAt`), the binding
// (`coordinator`, `coordinatorUuid`, `coordinatorSince`), the placeholder columns, `programme_events` and
// `programme_picks` is in this file, called inside its caller's transaction (`…InTx`); the one named exemption is the
// migration's own SQL in `schema.ts`. `single-definition/programme-lifecycle.test.ts` pins it.
//
// It names the handle by `import type` and every function takes it as an argument (`ledgersStore.ts`' idiom), and it
// decides nothing a door decides: the guards of an edge are the caller's. What it holds is the invariant of each write:
// an equal target writes nothing, an end writes its record and releases the binding in the same statement set, a reopen
// clears the record, and one incarnation owns at most one live real programme (the refusal here, and the partial unique
// index behind it).
import type { DatabaseSync } from 'node:sqlite';
import { TERMINAL_RUN_STATES, type RunState } from '../../../shared/api.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import {
  isEnded, type ProgrammeActorKind, type ProgrammeEventEdge, type ProgrammeMigrationRule, type ProgrammeStoredState,
} from '../../../shared/programmeLifecycle.js';
import { markSyncDueInTx } from './planStore.js';

const TERMINAL_SQL = `('${TERMINAL_RUN_STATES.join("','")}')`;
/** The run states whose `run_events` row witnesses that a run was ever dispatched (spec §3: `dispatched` reads
 *  `run_events`, not `runs.dispatchedAt`, because a resumed dispatch leaves that column null). */
const DISPATCH_WITNESS_STATES: readonly RunState[] = ['dispatched', 'working'];
const DISPATCH_WITNESS_SQL = `('${DISPATCH_WITNESS_STATES.join("','")}')`;

/** Who acted: the kind and the id (a session id, the signed-in device, or `unmeasured`). Never null. */
export interface ProgrammeActor {
  readonly kind: ProgrammeActorKind;
  readonly id: string;
}

/** A programme row's lifecycle columns, raw. `state` is a string: an out-of-vocabulary value is kept, never folded. */
export interface ProgrammeLifecycleRow {
  readonly slug: string;
  readonly state: string;
  readonly planEnd: string | null;
  readonly coordinator: string | null;
  readonly coordinatorUuid: string | null;
  readonly placeholder: string | null;
  readonly filedInto: string | null;
}

export function programmeRowOf(db: DatabaseSync, slug: string): ProgrammeLifecycleRow | null {
  const r = db.prepare(
    'SELECT slug, state, planEnd, coordinator, coordinatorUuid, placeholder, filedInto FROM programs WHERE slug = ?',
  ).get(slug) as ProgrammeLifecycleRow | undefined;
  return r ?? null;
}

/** One `programme_events` row. Append-only: nothing in the tree updates or deletes one. */
export interface ProgrammeEventInput {
  readonly program: string;
  readonly edge: ProgrammeEventEdge;
  readonly fromState?: string | null;
  readonly toState?: string | null;
  readonly actor: ProgrammeActor;
  readonly why: string;
  readonly session?: string | null;
  readonly sessionUuid?: string | null;
  readonly detail?: Readonly<Record<string, unknown>> | null;
}

export function appendEventInTx(db: DatabaseSync, e: ProgrammeEventInput, at: number): void {
  db.prepare(
    'INSERT INTO programme_events (program, at, edge, fromState, toState, actorKind, actor, why, session, sessionUuid, detail) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.program, at, e.edge, e.fromState ?? null, e.toState ?? null, e.actor.kind, e.actor.id, e.why,
    e.session ?? null, e.sessionUuid ?? null, e.detail == null ? null : JSON.stringify(e.detail));
}

/** The edges `decideInTx` writes (spec §5): each a stored-state change, recorded under its own event word. */
export type DecideEdge = Extract<ProgrammeEventEdge, 'ended' | 'reopened' | 'pause' | 'resume' | 'repaired' | 'migrated'>;

/** Every caller holds a row it read (a door's 404 comes first), so an absent programme throws, rolling the transaction
 *  back, rather than minting a refusal word no door answers. */
export type DecideResult = { readonly ok: true; readonly changed: boolean; readonly from: string; readonly released: string | null };

/**
 * THE writer of the stored decision (D-8983). `to` equal to the stored state writes nothing (what makes a re-run safe). An
 * ended `to` writes the end's record with it (`planEnd` equal to the state, `planEndWhy`, `planEndAt`) and releases the
 * binding in the same transaction, naming the released coordinator in the event (R11 rule 6); a live `to` clears the
 * record. The plan's sync is marked due whenever the record changes, as `closePlan` did.
 */
export function decideInTx(
  db: DatabaseSync,
  input: {
    readonly slug: string; readonly to: ProgrammeStoredState; readonly edge: DecideEdge; readonly actor: ProgrammeActor;
    readonly why: string; readonly detail?: Readonly<Record<string, unknown>>;
    /** The end's recorded why (`planEndWhy`); absent, `why`. Null records none (a plan close that gave none). */
    readonly planEndWhy?: string | null;
  },
  now: number,
): DecideResult {
  const row = programmeRowOf(db, input.slug);
  if (row === null) throw new Error(`decideInTx: no programme ${input.slug}`);
  const ended = isEnded(input.to);
  if (row.state === input.to && (ended ? row.planEnd === input.to : row.planEnd === null)) {
    return { ok: true, changed: false, from: row.state, released: null };
  }
  if (ended && row.planEnd === input.to) {
    // The record already says this end (a plan close an older build wrote): the decision follows it, the record is kept.
    db.prepare('UPDATE programs SET state = ? WHERE slug = ?').run(input.to, input.slug);
  } else if (ended) {
    db.prepare('UPDATE programs SET state = ?, planEnd = ?, planEndWhy = ?, planEndAt = ? WHERE slug = ?')
      .run(input.to, input.to, input.planEndWhy === undefined ? input.why : input.planEndWhy, now, input.slug);
  } else {
    db.prepare('UPDATE programs SET state = ?, planEnd = NULL, planEndWhy = NULL, planEndAt = NULL WHERE slug = ?')
      .run(input.to, input.slug);
  }
  const released = ended && row.coordinator !== null ? row.coordinator : null;
  if (released !== null) {
    bindCoordinatorInTx(db, input.slug, null, input.actor, input.why, now, { quiet: true });
  }
  appendEventInTx(db, {
    program: input.slug, edge: input.edge, fromState: row.state, toState: input.to, actor: input.actor, why: input.why,
    detail: released === null ? (input.detail ?? null) : { ...(input.detail ?? {}), released },
  }, now);
  if ((ended && row.planEnd !== input.to) || (!ended && row.planEnd !== null)) markSyncDueInTx(db, input.slug, now);
  return { ok: true, changed: true, from: row.state, released };
}

/** A new programme row (spec §5's start rows). Initial `paused` only for the system (the Linear backlog, D-8186). */
export interface MintInput {
  readonly slug: string;
  readonly title: string;
  readonly homeProject?: string | null;
  readonly state: Extract<ProgrammeStoredState, 'active' | 'paused'>;
  readonly placeholder?: 'unfiled';
  /** `programs.planRequired`; absent, the column's default. */
  readonly planRequired?: 0 | 1;
  readonly actor: ProgrammeActor;
  readonly why: string;
  /** The coordinator bound in the start's own transaction; absent or null, none (reconstruct, the backlog, a start sheet). */
  readonly coordinator?: { readonly session: string; readonly uuid: string | null } | null;
}

export type MintResult =
  | { readonly ok: true; readonly minted: boolean }
  | { readonly ok: false; readonly kind: 'owns-another-programme'; readonly by: string };

/** THE row creator: `INSERT … ON CONFLICT(slug) DO NOTHING`, then, only for a row it created, the `started` event and the
 *  binding. A coordinator that owns another live real programme is refused before the insert, so nothing is written. */
export function mintInTx(db: DatabaseSync, input: MintInput, now: number): MintResult {
  if (input.state === 'paused' && input.actor.kind !== 'system') {
    throw new Error(`mintInTx: only the system mints a paused programme (${input.slug})`);
  }
  // R11 rule 4, asked BEFORE the insert so a refusal writes nothing.
  if (input.coordinator != null) {
    const owned = ownedLiveProgrammeOf(db, input.coordinator.session, input.coordinator.uuid, input.slug);
    if (owned !== null && programmeRowOf(db, input.slug) === null) return { ok: false, kind: 'owns-another-programme', by: owned };
  }
  const res = input.planRequired === undefined
    ? db.prepare('INSERT INTO programs (slug, title, createdAt, state, homeProject, placeholder) VALUES (?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(slug) DO NOTHING').run(input.slug, input.title, now, input.state, input.homeProject ?? null, input.placeholder ?? null)
    : db.prepare('INSERT INTO programs (slug, title, createdAt, state, homeProject, placeholder, planRequired) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(slug) DO NOTHING')
      .run(input.slug, input.title, now, input.state, input.homeProject ?? null, input.placeholder ?? null, input.planRequired);
  if (Number(res.changes) === 0) return { ok: true, minted: false };
  appendEventInTx(db, {
    program: input.slug, edge: 'started', fromState: null, toState: input.state, actor: input.actor, why: input.why,
    detail: input.placeholder === undefined ? null : { placeholder: input.placeholder },
  }, now);
  if (input.coordinator != null) {
    const bound = bindCoordinatorInTx(db, input.slug, input.coordinator, input.actor, input.why, now);
    if (!bound.ok) return bound;
  }
  return { ok: true, minted: true };
}

export type BindResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly kind: 'owns-another-programme'; readonly by: string };

/** The live real programme (not ended, not a placeholder) this incarnation owns other than `except`, or null. A null
 *  uuid on either side matches by the session id alone (a migration-seeded binding, an unattributed caller). */
export function ownedLiveProgrammeOf(
  db: DatabaseSync, session: string, uuid: string | null, except: string | null,
): string | null {
  const r = db.prepare(
    "SELECT slug FROM programs WHERE coordinator = ? AND (coordinatorUuid IS NULL OR ? IS NULL OR coordinatorUuid = ?) " +
    "AND state NOT IN ('done', 'abandoned') AND placeholder IS NULL AND slug != ? ORDER BY slug LIMIT 1",
  ).get(session, uuid, uuid, except ?? '') as { slug: string } | undefined;
  return r?.slug ?? null;
}

/**
 * THE writer of the binding (D-8985, D-8993). `to` null releases it. A `to` that owns another live real programme is
 * refused `owns-another-programme`, naming it, and nothing is written; the partial unique index
 * `programs_one_per_coordinator` stands behind this check for any path that forgets it. Its callers are a closed list,
 * pinned by `single-definition/programme-lifecycle.test.ts`: `reclaimProgram`, `mintInTx`, `fileInTx`, `decideInTx`'s end
 * release and the boot re-measure. `quiet` writes no event (the end names the release in its own `ended` event).
 */
export function bindCoordinatorInTx(
  db: DatabaseSync, slug: string, to: { readonly session: string; readonly uuid: string | null } | null,
  actor: ProgrammeActor, why: string, now: number, opts: { readonly quiet?: boolean } = {},
): BindResult {
  const row = programmeRowOf(db, slug);
  if (row === null) throw new Error(`bindCoordinatorInTx: no programme ${slug}`);
  if (to !== null) {
    const owned = ownedLiveProgrammeOf(db, to.session, to.uuid, slug);
    if (owned !== null) return { ok: false, kind: 'owns-another-programme', by: owned };
  }
  if ((to?.session ?? null) === row.coordinator && (to?.uuid ?? null) === row.coordinatorUuid) return { ok: true, changed: false };
  db.prepare('UPDATE programs SET coordinator = ?, coordinatorUuid = ?, coordinatorSince = ? WHERE slug = ?')
    .run(to?.session ?? null, to?.uuid ?? null, to === null ? null : now, slug);
  if (opts.quiet !== true) {
    appendEventInTx(db, {
      program: slug, edge: 'coordinator', actor, why, session: to?.session ?? null, sessionUuid: to?.uuid ?? null,
      detail: { from: row.coordinator, to: to?.session ?? null },
    }, now);
  }
  return { ok: true, changed: true };
}

/** The programme this incarnation is bound to, read from the coordinator's side (at most one live row, by the index):
 *  a real programme or its unfiled placeholder. Null when it owns none. */
export function programmeOf(
  db: DatabaseSync, session: string, uuid: string | null,
): { readonly slug: string; readonly placeholder: string | null } | null {
  const r = db.prepare(
    "SELECT slug, placeholder FROM programs WHERE coordinator = ? AND (coordinatorUuid IS NULL OR ? IS NULL OR coordinatorUuid = ?) " +
    "AND state NOT IN ('done', 'abandoned') ORDER BY (placeholder IS NOT NULL), slug LIMIT 1",
  ).get(session, uuid, uuid) as { slug: string; placeholder: string | null } | undefined;
  return r ?? null;
}

/**
 * May this incarnation START a new programme it would own (spec §5's first-run row; R11 rules 3, 4 and 6)? Not while it
 * owns a live real programme, or claims an open run in one it does not own (`owns-another-programme`, naming it); and only
 * when it owns its unfiled placeholder (filed into the new one) or has never been joined (`not-your-programme`: a
 * coordinator left owning nothing is given a programme, never takes one). Joined is a `coordinator` event naming it as the
 * incoming coordinator, or a migration event naming it as a claimant. Asked by `openRun` and by a plan put on a new slug.
 */
export function mayStartProgrammeInTx(
  db: DatabaseSync, session: string, uuid: string | null,
): { readonly ok: true } | { readonly ok: false; readonly kind: 'owns-another-programme' | 'not-your-programme'; readonly by: string } {
  const owned = ownedLiveProgrammeOf(db, session, uuid, null);
  if (owned !== null) return { ok: false, kind: 'owns-another-programme', by: owned };
  const foreign = db.prepare(
    `SELECT r.program FROM runs r JOIN programs p ON p.slug = r.program WHERE r.claimedBy = ? AND r.state NOT IN ${TERMINAL_SQL} ` +
    'AND (p.coordinator IS NULL OR p.coordinator != ?) ORDER BY r.id LIMIT 1',
  ).get(session, session) as { program: string } | undefined;
  if (foreign !== undefined) return { ok: false, kind: 'owns-another-programme', by: foreign.program };
  const own = programmeOf(db, session, uuid);
  if (own !== null && own.placeholder === 'unfiled') return { ok: true };
  const joined = db.prepare(
    "SELECT 1 AS x FROM programme_events WHERE session = ? AND (sessionUuid IS NULL OR ? IS NULL OR sessionUuid = ?) " +
    "AND edge IN ('coordinator', 'migrated') LIMIT 1",
  ).get(session, uuid, uuid);
  return joined === undefined ? { ok: true } : { ok: false, kind: 'not-your-programme', by: 'you own no programme now' };
}

/** Start a new programme owned by `session` in the caller's transaction (the first run, a plan put on a new slug): mint
 *  it, file the session's unfiled placeholder into it (its binding cleared first), then bind the session. The caller has
 *  asked `mayStartProgrammeInTx`. */
export function startOwnedInTx(
  db: DatabaseSync, input: Omit<MintInput, 'coordinator' | 'state'> & { readonly session: string; readonly uuid: string | null },
  now: number,
): BindResult {
  mintInTx(db, { ...input, state: 'active' }, now);
  const own = programmeOf(db, input.session, input.uuid);
  if (own !== null && own.placeholder === 'unfiled' && own.slug !== input.slug) {
    fileInTx(db, own.slug, { kind: 'filed', into: input.slug }, input.actor, `new objective filed from ${own.slug}`, now);
  }
  return bindCoordinatorInTx(db, input.slug, { session: input.session, uuid: input.uuid }, input.actor, input.why, now);
}

/** File an unfiled placeholder into `into`, or withdraw it: its binding is cleared FIRST (so the session can be bound to
 *  a real programme in the same transaction without the index firing), then the placeholder's state, with `filed` on
 *  both rows or `withdrawn` on the placeholder. Nothing is deleted. False when `slug` is not an unfiled placeholder. */
export function fileInTx(
  db: DatabaseSync, slug: string, outcome: { readonly kind: 'filed'; readonly into: string } | { readonly kind: 'withdrawn' },
  actor: ProgrammeActor, why: string, now: number,
): boolean {
  const row = programmeRowOf(db, slug);
  if (row === null || row.placeholder !== 'unfiled') return false;
  bindCoordinatorInTx(db, slug, null, actor, why, now, { quiet: true });
  db.prepare('UPDATE programs SET placeholder = ?, filedInto = ? WHERE slug = ?')
    .run(outcome.kind, outcome.kind === 'filed' ? outcome.into : null, slug);
  if (outcome.kind === 'filed') {
    appendEventInTx(db, { program: slug, edge: 'filed', actor, why, detail: { into: outcome.into, coordinator: row.coordinator } }, now);
    appendEventInTx(db, { program: outcome.into, edge: 'filed', actor, why, detail: { from: slug, coordinator: row.coordinator } }, now);
  } else {
    appendEventInTx(db, { program: slug, edge: 'withdrawn', actor, why, detail: { coordinator: row.coordinator } }, now);
  }
  return true;
}

/** Reserve a pick (spec §7): the programme a create route was asked to start a coordinator for, keyed by the session id
 *  ccd answers (null until then). The join sweep (W4) completes or expires it. */
export function pickInTx(db: DatabaseSync, program: string, session: string | null, now: number): number {
  const r = db.prepare('INSERT INTO programme_picks (session, program, at) VALUES (?, ?, ?)').run(session, program, now);
  return Number(r.lastInsertRowid);
}

/** The count of open runs (any non-terminal state) and whether any run was ever dispatched, `lifecycleOf`'s two inputs. */
export function runFactsOf(db: DatabaseSync, slug: string): { open: number; dispatched: boolean } {
  const open = (db.prepare(`SELECT count(*) AS c FROM runs WHERE program = ? AND state NOT IN ${TERMINAL_SQL}`).get(slug) as { c: number }).c;
  const d = db.prepare(
    `SELECT 1 AS x FROM run_events e JOIN runs r ON r.id = e.runId WHERE r.program = ? AND e.toState IN ${DISPATCH_WITNESS_SQL} LIMIT 1`,
  ).get(slug) as { x: number } | undefined;
  return { open, dispatched: d !== undefined };
}

const REMEASURE_WHY = 'written by an older build (rollback); re-measured at start';
const SYSTEM: ProgrammeActor = { kind: 'migration', id: 'unmeasured' };

/** What one boot re-measure wrote, by kind (spec §15). Zero everywhere on a second boot. */
export interface RemeasureReport {
  readonly started: number;
  readonly states: number;
  readonly released: number;
  readonly bound: number;
}

/**
 * THE BOOT RE-MEASURE (spec §15): the migration runs once, so a rollback's writes are re-measured here at every start.
 * Rows with no `started` event get one; a row whose stored state differs from its newest event's `toState`, or whose
 * `planEnd` disagrees with an ended state, goes through the migration's step 4 rule with a `migrated` event; an ended
 * row's binding is released; a live row whose open runs one session claims and whose binding differs is put through step
 * 3's rule (an unambiguous pair whose session owns no other live programme binds; anything else is left, a conflict the
 * backfill door lists). Nothing is ever bound by guess. Runs inside the caller's transaction.
 */
export function remeasureAtBootInTx(db: DatabaseSync, now: number): RemeasureReport {
  let started = 0; let states = 0; let released = 0; let bound = 0;
  const rows = db.prepare(
    'SELECT slug, createdAt, state, planEnd, coordinator, coordinatorUuid, placeholder FROM programs WHERE slug != ? ORDER BY slug',
  ).all(LINEAR_SYNC_PROGRAMME) as { slug: string; createdAt: number; state: string; planEnd: string | null;
    coordinator: string | null; coordinatorUuid: string | null; placeholder: string | null }[];
  for (const r of rows) {
    const hasStart = db.prepare("SELECT 1 AS x FROM programme_events WHERE program = ? AND edge = 'started' LIMIT 1").get(r.slug);
    if (hasStart === undefined) {
      appendEventInTx(db, { program: r.slug, edge: 'started', fromState: null, toState: r.state, actor: SYSTEM,
        why: `who started it was not recorded; ${REMEASURE_WHY}` }, r.createdAt);
      started++;
    }
    const newest = db.prepare('SELECT toState FROM programme_events WHERE program = ? AND toState IS NOT NULL ORDER BY id DESC LIMIT 1')
      .get(r.slug) as { toState: string } | undefined;
    const planEndOff = r.planEnd !== null && r.planEnd !== r.state;
    if (planEndOff || (newest !== undefined && newest.toState !== r.state)) {
      const rule = stepFourRule(db, r.slug, r.state, r.planEnd);
      if (rule !== null) {
        if (rule.to === r.state) {
          appendEventInTx(db, { program: r.slug, edge: 'migrated', fromState: r.state, toState: r.state, actor: SYSTEM,
            why: REMEASURE_WHY, detail: { rule: rule.rule } }, now);
        } else {
          decideInTx(db, { slug: r.slug, to: rule.to, edge: 'migrated', actor: SYSTEM, why: REMEASURE_WHY, detail: { rule: rule.rule } }, now);
        }
        states++;
      }
    }
  }
  // An ended row's binding is released (an older build never moved it; a rollback's end left it standing).
  for (const r of db.prepare(
    "SELECT slug FROM programs WHERE coordinator IS NOT NULL AND state IN ('done', 'abandoned') ORDER BY slug",
  ).all() as { slug: string }[]) {
    bindCoordinatorInTx(db, r.slug, null, SYSTEM, REMEASURE_WHY, now);
    released++;
  }
  // Step 3's rule over live rows whose open runs' one claimant differs from the binding.
  const claims = db.prepare(
    `SELECT DISTINCT program, claimedBy AS s FROM runs WHERE state NOT IN ${TERMINAL_SQL} AND claimedBy IS NOT NULL`,
  ).all() as { program: string; s: string }[];
  const byProgramme = new Map<string, string[]>();
  const bySession = new Map<string, string[]>();
  for (const c of claims) {
    byProgramme.set(c.program, [...(byProgramme.get(c.program) ?? []), c.s]);
    bySession.set(c.s, [...(bySession.get(c.s) ?? []), c.program]);
  }
  for (const [program, sessions] of [...byProgramme.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const row = programmeRowOf(db, program);
    if (row === null || program === LINEAR_SYNC_PROGRAMME || isEnded(row.state) || row.placeholder !== null) continue;
    if (sessions.length !== 1) continue;
    const s = sessions[0]!;
    if (row.coordinator === s) continue;
    if ((bySession.get(s) ?? []).length !== 1) continue;
    if (ownedLiveProgrammeOf(db, s, null, program) !== null) continue;
    const b = bindCoordinatorInTx(db, program, { session: s, uuid: null }, SYSTEM, REMEASURE_WHY, now);
    if (b.ok && b.changed) bound++;
  }
  return { started, states, released, bound };
}

/** The migration's step 4 rule for one row, or null when the rule keeps a live state as it is. */
function stepFourRule(
  db: DatabaseSync, slug: string, state: string, planEnd: string | null,
): { readonly to: ProgrammeStoredState; readonly rule: ProgrammeMigrationRule } | null {
  if (planEnd === 'done' || planEnd === 'abandoned') return { to: planEnd, rule: 'plan-end' };
  if (state === 'done' || state === 'abandoned') {
    return runFactsOf(db, slug).open > 0 ? { to: 'active', rule: 'ended-over-open-runs' } : { to: state, rule: 'auto-retire-kept' };
  }
  return null;
}
