// What a programme says is left: the SQL (Overlord W2 remaining work A, plan `w2-remaining-work.md` Task 2; spec §5.6
// H38, Table 11.1a). `programme_remaining` and `programme_edges` (one migration). It sits beside `store.ts` in the same
// ring and context (L3, Coordination), as `coordCallsStore.ts` does: every function takes the store's `DatabaseSync` and
// is synchronous, and `CoordStore` keeps one-line delegates of the same names.
//
// One writer per fact, and nothing else writes either table:
//   * `insertRemaining`  the only INSERT into `programme_remaining` (append-only: no UPDATE or DELETE names it) and the
//                        only INSERT into `programme_edges`, both in the statement's one transaction;
//   * the edge's state columns (`state`, `endedAt`, `evidence`, `unmeasuredSince`) are remaining work B's `settleEdge`'s,
//     called only by the forecast lane's edge arm. No coordinator path clears an edge.
// The body's rules and the target verdict are `programmeRemaining.ts`'s (L1); this file reads and writes.
import type { DatabaseSync } from 'node:sqlite';
import {
  EDGE_KINDS, EDGE_STATES, OPEN_EDGES_PER_PROGRAMME_MAX, edgeTargetKey, parseEdgeTarget,
  type EdgeKind, type EdgeState, type EdgeTarget, type ProgrammeEdge, type RemainingStatement,
} from '../../../shared/programmeFacts.js';
import { redactCommand } from './redact.js';
import { edgeTargetVerdict, type EdgeTargetFacts, type NewEdge, type NewRemaining } from './programmeRemaining.js';
import { tx } from './tx.js';

/** The types `CoordStore`'s delegates name, so `store.ts` takes one import for this file. */
export type { EdgeTarget, ProgrammeEdge, RemainingStatement } from '../../../shared/programmeFacts.js';
export type { NewEdge, NewRemaining } from './programmeRemaining.js';

export type InsertRemainingResult =
  | { ok: true; id: number; added: number[]; kept: number[] }
  | { ok: false; why: 'too-many-open-edges'; detail: string };

/** Records one statement and its edges in ONE transaction. An edge already open with the same kind and target is kept,
 *  never duplicated (its id goes to `kept`); a new one is inserted (`added`). A statement that would take the programme
 *  past `OPEN_EDGES_PER_PROGRAMME_MAX` open edges writes nothing. THE ONLY INSERT into either table; it never updates a
 *  statement and never changes an edge's state. A throw (an unknown `program`, a busy file) rolls the whole statement
 *  back. */
export function insertRemaining(
  db: DatabaseSync, program: string, byId: string, statement: NewRemaining, edges: readonly NewEdge[], build: string | null, now: number,
): InsertRemainingResult {
  return tx(db, (): InsertRemainingResult => {
    const openId = db.prepare("SELECT id FROM programme_edges WHERE program = ? AND kind = ? AND target = ? AND state = 'open'");
    const keyed = edges.map((e) => ({ e, target: edgeTargetKey(e.target) }));
    const existing = keyed.map(({ e, target }) => (openId.get(program, e.kind, target) as { id: number } | undefined)?.id ?? null);
    const open = (db.prepare("SELECT COUNT(*) AS n FROM programme_edges WHERE program = ? AND state = 'open'").get(program) as { n: number }).n;
    const adding = existing.filter((id) => id === null).length;
    if (open + adding > OPEN_EDGES_PER_PROGRAMME_MAX) {
      return { ok: false, why: 'too-many-open-edges',
        detail: `programme ${program} would hold ${open + adding} open edges, more than ${OPEN_EDGES_PER_PROGRAMME_MAX}` };
    }
    const r = db.prepare(
      'INSERT INTO programme_remaining (program, at, byId, runId, lo, hi, reason, build) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(program, now, byId, statement.runId, statement.lo, statement.hi, statement.reason, build);
    const id = Number(r.lastInsertRowid);
    const insertEdge = db.prepare(
      'INSERT INTO programme_edges (program, statementId, kind, target, why, openedAt) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const added: number[] = [];
    const kept: number[] = [];
    keyed.forEach(({ e, target }, i) => {
      const was = existing[i]!;
      if (was !== null) { kept.push(was); return; }
      added.push(Number(insertEdge.run(program, id, e.kind, target, e.why, now).lastInsertRowid));
    });
    return { ok: true, id, added, kept };
  });
}

/** The facts a target's verdict reads (`programmeRemaining.ts#edgeTargetVerdict`). A run's `prLineage` is written by
 *  `foldPrLineage` alone, from a typed list, so one that does not parse as a list of entries is a corrupt file and
 *  throws, naming the run, rather than reading as a lineage that lists nothing. */
export function edgeTargetFacts(db: DatabaseSync, target: EdgeTarget): EdgeTargetFacts {
  if (target.predicate === 'operator-confirms') {
    const it = db.prepare('SELECT program, state FROM operator_items WHERE id = ?').get(target.itemId) as
      { program: string; state: string } | undefined;
    return { predicate: target.predicate, item: it ?? null };
  }
  const run = db.prepare('SELECT program, prLineage FROM runs WHERE id = ?').get(target.runId) as
    { program: string; prLineage: string | null } | undefined;
  if (run === undefined) return { predicate: target.predicate, run: null };
  if (target.predicate === 'run-closed') return { predicate: target.predicate, run: { program: run.program, prs: [] } };
  const v: unknown = run.prLineage === null || run.prLineage === '' ? [] : JSON.parse(run.prLineage);
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'object' && x !== null && typeof (x as { pr?: unknown }).pr === 'number')) {
    throw new Error(`run ${target.runId}: prLineage is not a list of pull request entries`);
  }
  return { predicate: target.predicate, run: { program: run.program, prs: (v as { pr: number }[]).map((x) => x.pr) } };
}

/** The door's step 9: `ok`, or why the target is refused. It reads (`edgeTargetFacts`) and asks the verdict; it writes
 *  nothing. A throw is the store's (an unreadable lineage). */
export function edgeTargetCheck(db: DatabaseSync, slug: string, target: EdgeTarget): { ok: true } | { ok: false; detail: string } {
  return edgeTargetVerdict(slug, target, edgeTargetFacts(db, target));
}

/** Every text is masked again as it is read, so a text stored under an older mask is served through today's. */
const mask = (t: string): string => redactCommand(t);

interface RemainingRaw { id: number; program: string; at: number; byId: string; runId: number | null; lo: number; hi: number; reason: string }

/** The programme's newest statements, newest first, at most `limit`. */
export function remainingOf(db: DatabaseSync, program: string, limit: number): RemainingStatement[] {
  return (db.prepare(
    'SELECT id, program, at, byId, runId, lo, hi, reason FROM programme_remaining WHERE program = ? ORDER BY id DESC LIMIT ?',
  ).all(program, limit) as unknown as RemainingRaw[]).map((r) => ({ ...r, reason: mask(r.reason) }));
}

interface EdgeRaw {
  id: number; program: string; kind: string; target: string; why: string; state: string; openedAt: number; openedBy: string;
  endedAt: number | null; evidence: string | null; unmeasuredSince: number | null;
}

/** One stored edge, read through its guards. An unknown `kind` or a `target` this build cannot read is carried as null with
 *  its flag, never dropped; an unknown `state` reads as `open` with `stateUnreadable`, so a block this build does not know
 *  is never hidden. `unmeasured` is set while the edge arm's run of unmeasured answers stands (remaining work B). */
function edgeOf(r: EdgeRaw): ProgrammeEdge {
  const kind = (EDGE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as EdgeKind) : null;
  const target = parseEdgeTarget(r.target);
  const known = (EDGE_STATES as readonly string[]).includes(r.state);
  const state: EdgeState = known ? (r.state as EdgeState) : 'open';
  const edge: ProgrammeEdge = {
    id: r.id, program: r.program, kind, target, why: mask(r.why), state, openedAt: r.openedAt, openedBy: r.openedBy,
    endedAt: r.endedAt, evidence: r.evidence === null ? null : mask(r.evidence), unmeasuredSince: r.unmeasuredSince,
  };
  if (kind === null) edge.kindUnreadable = true;
  if (target === null) edge.targetUnreadable = true;
  if (!known) edge.stateUnreadable = true;
  if (state === 'open' && r.unmeasuredSince !== null) edge.unmeasured = true;
  return edge;
}

/** Every edge whose state is not `met`, for the listed programmes, oldest first. `openedBy` is the statement's sender. */
export function openEdgesOf(db: DatabaseSync, programs: readonly string[]): ProgrammeEdge[] {
  if (programs.length === 0) return [];
  const marks = programs.map(() => '?').join(', ');
  return (db.prepare(
    'SELECT e.id, e.program, e.kind, e.target, e.why, e.state, e.openedAt, s.byId AS openedBy, e.endedAt, e.evidence, ' +
    `e.unmeasuredSince FROM programme_edges e JOIN programme_remaining s ON s.id = e.statementId WHERE e.program IN (${marks}) ` +
    "AND e.state <> 'met' ORDER BY e.id",
  ).all(...programs) as unknown as EdgeRaw[]).map(edgeOf);
}
