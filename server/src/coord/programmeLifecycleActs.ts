// L3 adapter, context Coordination: the programme lifecycle's composite acts and reads for its doors (programme lifecycle
// spec 2026-11-24 §5, §6, §8, §11, §13; W2; D-8987, D-8989, D-8992, D-8993). Each `…InTx` runs inside its caller's
// transaction (`CoordStore`'s one-line delegates hold it) and writes through the lifecycle's one writer
// (`programmeLifecycleStore.ts`: the decision, the binding, the placeholder and the events) and the items' one writer
// (`ledgersStore.ts`: the item and its event), so an act and its record are one transaction. It decides nothing a door
// decides: the edge's guards are `programmeEdgePolicy.ts`'s (L1). It names the handle by `import type`.
import type { DatabaseSync } from 'node:sqlite';
import { TERMINAL_RUN_STATES } from '../../../shared/api.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import { END_PROGRAMME_VERB, OPEN_ITEM_STATES, endProgrammeAction, isEndProgrammeAction } from '../../../shared/ledgers.js';
import {
  isEnded, type CoordinatorWithoutProgramme, type NoProgrammeWhy, type ProgrammeClaimConflict, type ProgrammeEndOutcome,
  type ProgrammeHistoryEntry,
} from '../../../shared/programmeLifecycle.js';
import * as lifecycle from './programmeLifecycleStore.js';
import type { LifecycleRowFacts } from './programmeLifecycleView.js';
import { itemById, moveItemInTx, raiseItemCheckedInTx, type ItemRow } from './ledgersStore.js';

const TERMINAL_SQL = `('${TERMINAL_RUN_STATES.join("','")}')`;
const OPEN_ITEM_SQL = `('${OPEN_ITEM_STATES.join("','")}')`;

/** The start door's write (spec §5's start row): a free, well-formed slug (the door shaped it), minted `active` with its
 *  `started` event, and, when a session is named, bound in the same transaction after R11 rule 4: a session that owns a live
 *  real programme, or claims an open run in one it does not own, is refused `owns-another-programme`, naming it; its unfiled
 *  placeholder is withdrawn first, so the partial unique index never fires. Nothing is written on a refusal. */
export function startNamedInTx(
  db: DatabaseSync,
  input: { readonly slug: string; readonly title: string; readonly actor: lifecycle.ProgrammeActor; readonly why: string;
    readonly coordinator: { readonly session: string; readonly uuid: string | null } | null },
  now: number,
): { readonly ok: true } | { readonly ok: false; readonly why: 'slug-taken' | 'owns-another-programme'; readonly by?: string } {
  if (lifecycle.programmeRowOf(db, input.slug) !== null || input.slug === LINEAR_SYNC_PROGRAMME) return { ok: false, why: 'slug-taken' };
  const c = input.coordinator;
  if (c !== null) {
    const owned = lifecycle.ownedLiveProgrammeOf(db, c.session, c.uuid, null) ?? foreignOpenClaimOf(db, c.session);
    if (owned !== null) return { ok: false, why: 'owns-another-programme', by: owned };
    const own = lifecycle.programmeOf(db, c.session, c.uuid);
    if (own !== null && own.placeholder === 'unfiled') {
      lifecycle.fileInTx(db, own.slug, { kind: 'withdrawn' }, input.actor, `its coordinator was given ${input.slug}`, now);
    }
  }
  const minted = lifecycle.mintInTx(db, { slug: input.slug, title: input.title, state: 'active', actor: input.actor, why: input.why,
    coordinator: c }, now);
  if (!minted.ok) throw new Error(`startNamedInTx: ${minted.kind} ${minted.by} passed the start's own check`);
  return { ok: true };
}

/** A programme other than its own whose open run `session` claims while it is not that programme's coordinator (a migration
 *  conflict's party, spec §13), or null. */
export function foreignOpenClaimOf(db: DatabaseSync, session: string): string | null {
  const r = db.prepare(
    `SELECT r.program FROM runs r JOIN programs p ON p.slug = r.program WHERE r.claimedBy = ? AND r.state NOT IN ${TERMINAL_SQL} ` +
    'AND (p.coordinator IS NULL OR p.coordinator != ?) ORDER BY r.id LIMIT 1',
  ).get(session, session) as { program: string } | undefined;
  return r?.program ?? null;
}

/** The programme's open end proposal (an open or held `end-programme` item), or null. At most one is ever raised. */
export function openEndProposalOf(db: DatabaseSync, slug: string): ItemRow | null {
  const r = db.prepare(
    `SELECT id FROM operator_items WHERE program = ? AND state IN ${OPEN_ITEM_SQL} AND action LIKE ? ORDER BY id LIMIT 1`,
  ).get(slug, `%"verb":"${END_PROGRAMME_VERB}"%`) as { id: number } | undefined;
  if (r === undefined) return null;
  const item = itemById(db, r.id);
  return item !== null && isEndProgrammeAction(item.action) ? item : null;
}

/** The proposal's raise (spec §8): its decide item and the `end-proposed` event, in one transaction. Returns the item id. */
export function proposeEndInTx(
  db: DatabaseSync,
  input: { readonly slug: string; readonly by: string; readonly outcome: ProgrammeEndOutcome; readonly why: string;
    readonly evidence: readonly string[]; readonly via: 'door' | 'plan';
    readonly item: { title: string; why: string; how: string[]; options: string[]; recommended: number; recommendedWhy: string } },
  now: number,
): number {
  const id = raiseItemCheckedInTx(db, {
    program: input.slug, runId: null, raisedBy: input.by, kind: 'decide', ...input.item, neededBy: 'soon', soonLabel: null,
    secretSlot: null, action: endProgrammeAction(input.outcome), heldUntil: null,
  }, now, 'coordinator');
  lifecycle.appendEventInTx(db, { program: input.slug, edge: 'end-proposed', actor: { kind: 'coordinator', id: input.by },
    why: input.why, detail: { outcome: input.outcome, evidence: input.evidence, item: id, via: input.via } }, now);
  return id;
}

export type ConfirmEndResult =
  | { readonly ok: true; readonly slug: string; readonly outcome: ProgrammeEndOutcome; readonly released: string | null }
  | { readonly ok: false; readonly why: 'not-open' | 'programme-runs-open' | 'programme-ended'; readonly detail: string };

/** The confirm (spec §5's confirm row): the item is an open end proposal; no run is open (else the item stays open); the
 *  item moves `act` and `decideInTx` ends the programme with the proposal's outcome, its evidence and the item id, which
 *  releases the binding (R11 rule 6), all in one transaction. */
export function confirmEndInTx(db: DatabaseSync, itemId: number, actor: lifecycle.ProgrammeActor, now: number): ConfirmEndResult {
  const item = itemById(db, itemId);
  if (item === null || !isEndProgrammeAction(item.action) || !OPEN_ITEM_STATES.includes(item.state)) {
    return { ok: false, why: 'not-open', detail: `item ${itemId} is not an open end proposal` };
  }
  const row = lifecycle.programmeRowOf(db, item.program);
  if (row === null || isEnded(row.state)) return { ok: false, why: 'programme-ended', detail: `programme ${item.program} has already ended` };
  const open = lifecycle.runFactsOf(db, item.program).open;
  if (open > 0) return { ok: false, why: 'programme-runs-open', detail: `${open} run(s) of ${item.program} opened since the proposal: it stays open` };
  const moved = moveItemInTx(db, itemId, 'act', 'operator', {}, now, { programmeHasOpenRun: false });
  if (!moved.ok) return { ok: false, why: 'not-open', detail: `item ${itemId} is ${item.state}` };
  const proposed = proposalEventOf(db, item.program, itemId);
  const outcome = item.action.outcome;
  const d = lifecycle.decideInTx(db, { slug: item.program, to: outcome, edge: 'ended', actor, why: proposed?.why ?? item.why,
    detail: { item: itemId, evidence: proposed?.evidence ?? [], proposedBy: item.raisedBy } }, now);
  if (!d.ok) throw new Error(`confirmEndInTx: ${d.kind} over a live programme`);
  return { ok: true, slug: item.program, outcome, released: d.released };
}

/** The proposal's own `end-proposed` event (its why and evidence), read back for the end it is confirmed into. */
function proposalEventOf(db: DatabaseSync, slug: string, itemId: number): { why: string; evidence: unknown } | null {
  const r = db.prepare(
    "SELECT why, detail FROM programme_events WHERE program = ? AND edge = 'end-proposed' AND json_extract(detail, '$.item') = ? " +
    'ORDER BY id DESC LIMIT 1',
  ).get(slug, itemId) as { why: string; detail: string | null } | undefined;
  if (r === undefined) return null;
  const detail = r.detail === null ? null : JSON.parse(r.detail) as { evidence?: unknown };
  return { why: r.why, evidence: detail?.evidence ?? [] };
}

/** The decline (spec §5's decline row): the item moves `decline` and `end-declined` is recorded; the answer names the
 *  coordinator bound at this moment (null when there is none), whom the door mails in this transaction. */
export function declineEndInTx(
  db: DatabaseSync, itemId: number, actor: lifecycle.ProgrammeActor, why: string, now: number,
): { readonly ok: true; readonly slug: string; readonly coordinator: string | null; readonly item: ItemRow } | { readonly ok: false; readonly detail: string } {
  const item = itemById(db, itemId);
  if (item === null || !isEndProgrammeAction(item.action)) return { ok: false, detail: `item ${itemId} is not an end proposal` };
  const moved = moveItemInTx(db, itemId, 'decline', 'operator', {}, now, { programmeHasOpenRun: true });
  if (!moved.ok) return { ok: false, detail: `item ${itemId} is ${item.state}, not open` };
  const coordinator = lifecycle.programmeRowOf(db, item.program)?.coordinator ?? null;
  lifecycle.appendEventInTx(db, { program: item.program, edge: 'end-declined', actor, why, detail: { item: itemId, coordinator } }, now);
  return { ok: true, slug: item.program, coordinator, item: moved.item };
}

/** The bound coordinator's withdraw of the proposal (spec §5's withdraw row): the item moves `withdraw` and `end-withdrawn`
 *  is recorded. False when the move is refused. */
export function withdrawEndInTx(db: DatabaseSync, item: ItemRow, by: string, now: number): boolean {
  const moved = moveItemInTx(db, item.id, 'withdraw', 'coordinator', {}, now, { programmeHasOpenRun: true });
  if (!moved.ok) return false;
  lifecycle.appendEventInTx(db, { program: item.program, edge: 'end-withdrawn', actor: { kind: 'coordinator', id: by },
    why: 'withdrawn by its coordinator', detail: { item: item.id } }, now);
  return true;
}

/** Close the programme's open end proposal as the system (a run opened, spec §8; a direct end closes it with the end):
 *  the item settles with `note` and `end-withdrawn` is recorded with `why`. False when none is open. */
export function settleEndProposalInTx(db: DatabaseSync, slug: string, why: string, now: number): boolean {
  const item = openEndProposalOf(db, slug);
  if (item === null) return false;
  const moved = moveItemInTx(db, item.id, 'settle', 'ccrc', { note: why }, now, { programmeHasOpenRun: true });
  if (!moved.ok) return false;
  lifecycle.appendEventInTx(db, { program: slug, edge: 'end-withdrawn', actor: { kind: 'system', id: 'unmeasured' }, why,
    detail: { item: item.id } }, now);
  return true;
}

/** The ids of the programme's open runs (any non-terminal state), lowest first: what an Abandoned end with `abandonRuns` ends. */
export function openRunIdsOf(db: DatabaseSync, slug: string): number[] {
  return (db.prepare(`SELECT id FROM runs WHERE program = ? AND state NOT IN ${TERMINAL_SQL} ORDER BY id`).all(slug) as { id: number }[])
    .map((r) => r.id);
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A programme's story (spec §11): its own events and those of every placeholder filed into it, with its runs' transitions,
 *  oldest first (a tie keeps the programme event before the run's, then insertion order). Null when there is no such row. */
export function historyOf(db: DatabaseSync, slug: string): ProgrammeHistoryEntry[] | null {
  if (lifecycle.programmeRowOf(db, slug) === null) return null;
  const events = db.prepare(
    'SELECT id, program, at, edge, fromState, toState, actorKind, actor, why, session, detail FROM programme_events ' +
    'WHERE program = ? OR program IN (SELECT slug FROM programs WHERE filedInto = ?) ORDER BY at, id',
  ).all(slug, slug) as { id: number; program: string; at: number; edge: string; fromState: string | null; toState: string | null;
    actorKind: string; actor: string; why: string; session: string | null; detail: string | null }[];
  const runs = db.prepare(
    'SELECT e.id AS id, e.at AS at, e.runId AS runId, r.wave AS wave, r.kind AS kind, e.fromState AS fromState, ' +
    'e.toState AS toState, e.causedBy AS actor FROM run_events e JOIN runs r ON r.id = e.runId WHERE r.program = ? ORDER BY e.at, e.id',
  ).all(slug) as { id: number; at: number; runId: number; wave: number; kind: string; fromState: string | null; toState: string; actor: string }[];
  const out: (ProgrammeHistoryEntry & { readonly k: number; readonly id: number })[] = [
    ...events.map((e) => ({ source: 'programme' as const, k: 0, id: e.id, at: e.at, program: e.program, edge: e.edge,
      fromState: e.fromState, toState: e.toState, actorKind: e.actorKind, actor: e.actor, why: e.why, session: e.session,
      detail: e.detail === null ? null : JSON.parse(e.detail) as unknown })),
    ...runs.map((r) => ({ source: 'run' as const, k: 1, id: r.id, at: r.at, runId: r.runId, wave: r.wave, kind: r.kind,
      fromState: r.fromState, toState: r.toState, actor: r.actor })),
  ];
  out.sort((a, b) => a.at - b.at || a.k - b.k || a.id - b.id);
  return out.map(({ k: _k, id: _id, ...e }) => e as ProgrammeHistoryEntry);
}

/** The lifecycle facts of every programme row but the reserved one, for the programmes read (spec §15). */
export function lifecycleRowsOf(db: DatabaseSync): LifecycleRowFacts[] {
  const rows = db.prepare(
    'SELECT slug, title, state, placeholder, coordinator, coordinatorUuid FROM programs WHERE slug != ? ORDER BY slug',
  ).all(LINEAR_SYNC_PROGRAMME) as { slug: string; title: string; state: string; placeholder: string | null; coordinator: string | null;
    coordinatorUuid: string | null }[];
  const conflicts = conflictsOf(db);
  return rows.map((r) => ({ ...r, ...lifecycle.runFactsOf(db, r.slug), conflict: conflicts.get(r.slug) ?? null }));
}

/** Spec §13's conflicts, derived at each read, never stored: every live real programme whose open runs a session other than
 *  its binding claims. `programme-several-claimants` when two or more sessions hold its open runs, else
 *  `session-in-several`. A conflict leaves the list the moment its runs' claimants equal the binding. */
export function conflictsOf(db: DatabaseSync): Map<string, ProgrammeClaimConflict> {
  const claims = db.prepare(
    `SELECT DISTINCT r.program AS program, r.claimedBy AS s FROM runs r JOIN programs p ON p.slug = r.program ` +
    `WHERE r.state NOT IN ${TERMINAL_SQL} AND r.claimedBy IS NOT NULL AND p.placeholder IS NULL AND p.slug != ? ` +
    "AND p.state NOT IN ('done', 'abandoned') AND (p.coordinator IS NULL OR p.coordinator != r.claimedBy) ORDER BY r.program, r.claimedBy",
  ).all(LINEAR_SYNC_PROGRAMME) as { program: string; s: string }[];
  const by = new Map<string, string[]>();
  for (const c of claims) by.set(c.program, [...(by.get(c.program) ?? []), c.s]);
  const out = new Map<string, ProgrammeClaimConflict>();
  for (const [program, claimants] of by) {
    out.set(program, { kind: claimants.length > 1 ? 'programme-several-claimants' : 'session-in-several', claimants });
  }
  return out;
}

/** Every session that has been a coordinator (a `coordinator` event named it incoming), owns no live programme now (an
 *  unfiled placeholder counts as owning one) and claims no open run (a conflict's party is listed in its conflict), with
 *  why it has none and since when, from the newest event that took its programme away (spec §6). Keyed on the session id;
 *  the door filters out sessions the registry no longer lists. */
export function coordinatorsWithoutProgrammeOf(db: DatabaseSync): CoordinatorWithoutProgramme[] {
  const sessions = (db.prepare(
    "SELECT DISTINCT session FROM programme_events WHERE edge = 'coordinator' AND session IS NOT NULL ORDER BY session",
  ).all() as { session: string }[]).map((r) => r.session);
  const out: CoordinatorWithoutProgramme[] = [];
  for (const s of sessions) {
    if (lifecycle.programmeOf(db, s, null) !== null) continue;
    const claims = db.prepare(`SELECT 1 AS x FROM runs WHERE claimedBy = ? AND state NOT IN ${TERMINAL_SQL} LIMIT 1`).get(s);
    if (claims !== undefined) continue;
    const lost = db.prepare(
      'SELECT program, at, edge, json_extract(detail, \'$.to\') AS too FROM programme_events WHERE ' +
      "(edge = 'coordinator' AND json_extract(detail, '$.from') = ?) OR (edge = 'ended' AND json_extract(detail, '$.released') = ?) " +
      "OR (edge = 'withdrawn' AND json_extract(detail, '$.coordinator') = ?) ORDER BY at DESC, id DESC LIMIT 1",
    ).get(s, s, s) as { program: string; at: number; edge: string; too: string | null } | undefined;
    if (lost === undefined) continue;
    const why: NoProgrammeWhy = lost.edge === 'ended' ? 'ended' : lost.edge === 'withdrawn' ? 'withdrawn'
      : lost.too === null ? 'released' : 'handed-over';
    out.push({ session: s, why, since: lost.at, last: lost.program });
  }
  return out;
}
