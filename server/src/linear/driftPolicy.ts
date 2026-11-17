/**
 * THE DRIFT DECIDERS (D-8183; Linear hierarchy design 2026-11-10 §6.2, §7.2 to §7.5): which fields of a Linear object ccrc
 * owns, whether Linear's copy of them differs from the plan's, whether that difference is drift or only the sync not having
 * written the plan yet, and the words ccrc leaves when it puts a field back. L1 POLICY: pure and total, no I/O, no clock
 * (every time is an argument). The pass that reads Linear and restores is Task 4.2's; the store is `planStore.ts`.
 *
 * ONE WRITER PER FACT. The owned columns of each kind are spelled once, in `OWNED_FIELDS`, as the shaped Linear answers
 * (`hierarchyOps.ts`) name them. `egress` is `planSyncPolicy.ts`'s, the one redactor of text ccrc sends.
 *
 * Departure D-8704: the plan's own test, `fingerprintOf(owned) === lastWritten`, cannot compare,
 * because a binding stores F(the planned inputs, with ids), never F(Linear's owned fields). A difference is a catch-up when
 * the binding's stored fingerprint is not the plan's current one (the sync has not written the plan, so it will and this
 * pass writes nothing); the caller measures that and passes `current`.
 */
import { withCcrcProvenance } from './hierarchyOps.js';
import { egress } from './planSyncPolicy.js';

export type DriftKind = 'initiative' | 'project' | 'milestone' | 'issue';

/** §6.2's owned columns. Labels: ccrc sets none today, so none is owned. A project's milestone ORDER is each milestone's own
 *  `sortOrder`; a project's `milestoneIds` is which milestones exist. */
export const OWNED_FIELDS: Readonly<Record<DriftKind, readonly string[]>> = {
  initiative: ['name', 'description', 'status', 'projectIds'],
  project: ['name', 'description', 'statusType', 'teamKeys', 'initiativeIds', 'milestoneIds'],
  milestone: ['name', 'description', 'targetDate', 'sortOrder', 'projectId'],
  issue: ['title', 'description', 'teamKey', 'projectId', 'milestoneId', 'parentId', 'stateType'],
};
const ALL_OWNED: ReadonlySet<string> = new Set(Object.values(OWNED_FIELDS).flat());

/** A planned field whose value is `undefined` is not owned now and is never compared (a milestone's `targetDate` before its
 *  checkpoint is met, D-8700). */
export type OwnedFields = Readonly<Record<string, string | number | null | readonly string[] | undefined>>;

/** Links compared one way (D-8681: nothing unlinks): a PLANNED id missing from Linear's set differs; an extra id does not. */
const ONE_WAY_LINKS: ReadonlySet<string> = new Set(['initiativeIds', 'projectIds']);

// ── Restored lines (a milestone takes no comment in Linear, so these are its only restore record; D-8407) ──

export const RESTORED_LINE_PREFIX = 'Restored on ';
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);
const isRestored = (l: string): boolean => l.startsWith(RESTORED_LINE_PREFIX);

/** The description without its Restored lines, and without the blank lines that leave trailing. Text with none is unchanged. */
export function withoutRestoredLines(description: string): string {
  const lines = description.split('\n');
  if (!lines.some(isRestored)) return description;
  return lines.filter((l) => !isRestored(l)).join('\n').replace(/\s+$/u, '');
}

/** The description keeping its last two Restored lines and `line`, three at most, at the end after one blank line. */
export function restoredLines(description: string, line: string): string {
  const kept = description.split('\n').filter(isRestored).slice(-2);
  const base = withoutRestoredLines(description).replace(/\s+$/u, '');
  const tail = [...kept, line].join('\n');
  return base === '' ? tail : `${base}\n\n${tail}`;
}

// ── The comparison ──

const trimEnd = (s: string): string => s.replace(/\s+$/u, '');
const asSet = (v: readonly string[], fold: boolean): Set<string> => new Set(v.map((x) => (fold ? x.toUpperCase() : x)));

/** One owned field of Linear's copy against the plan's. Strings after trimming trailing whitespace (a description also
 *  without its Restored lines); arrays as sets (team keys without case; links one way); ids exact; null equals null only. */
function sameOwned(field: string, linear: OwnedFields[string], planned: OwnedFields[string]): boolean {
  const l = linear === undefined ? null : linear;
  const p = planned === undefined ? null : planned;
  if (Array.isArray(l) || Array.isArray(p)) {
    if (!Array.isArray(l) || !Array.isArray(p)) return false;
    const fold = field === 'teamKeys';
    const ls = asSet(l as readonly string[], fold);
    const ps = asSet(p as readonly string[], fold);
    if (ONE_WAY_LINKS.has(field)) return [...ps].every((x) => ls.has(x));
    return ls.size === ps.size && [...ps].every((x) => ls.has(x));
  }
  if (typeof l === 'string' && typeof p === 'string') {
    return field === 'description'
      ? trimEnd(withoutRestoredLines(l)) === trimEnd(withoutRestoredLines(p))
      : trimEnd(l) === trimEnd(p);
  }
  return l === p;
}

/** The owned fields of `kind` that differ, in `OWNED_FIELDS` order, skipping a planned `undefined`. */
export function driftedFields(linear: OwnedFields, planned: OwnedFields, kind: DriftKind): string[] {
  return OWNED_FIELDS[kind].filter((f) => planned[f] !== undefined && !sameOwned(f, linear[f], planned[f]));
}

/** `match`: nothing differs. `catch-up`: something differs but the plan's current inputs were never written (`!sync.current`),
 *  so the sync will write them and this pass writes nothing. `drift`: the binding is current and Linear still differs. */
export function driftVerdict(
  linear: OwnedFields, planned: OwnedFields, kind: DriftKind, sync: { current: boolean },
): 'match' | 'catch-up' | 'drift' {
  if (driftedFields(linear, planned, kind).length === 0) return 'match';
  return sync.current ? 'drift' : 'catch-up';
}

/** §7.3: a difference that is not drift. A field ccrc does not own; a state of the same TYPE (In Progress to In Review is
 *  `started`); and Linear reading `completed` while the plan says another type, when ccrc recorded the PR merged (the
 *  integration closed it) or while the merge may not be recorded yet (the pass waits one more pass). */
export function notDrift(field: string, planned: unknown, linear: unknown, ctx: { prMerged: boolean; gracePasses: number }): boolean {
  if (!ALL_OWNED.has(field)) return true;
  if (field !== 'stateType') return false;
  if (planned === linear) return true;
  if (linear === 'completed') return ctx.prMerged || ctx.gracePasses < 1;
  return false;
}

// ── Persistence and period ──

/** Three restores of one binding within seven days make the drift persistent (§7.4). */
export const DRIFT_PERSIST = { restores: 3, windowMs: 7 * 86_400_000 } as const;
export function isPersistent(restores: readonly number[], now: number): boolean {
  return restores.filter((t) => now - t < DRIFT_PERSIST.windowMs).length >= DRIFT_PERSIST.restores;
}
/** The drift pass's period per workspace. */
export const DRIFT_PASS_MS = 30 * 60_000;

// ── Words ──

const NOUN: Readonly<Record<string, string>> = {
  projectId: 'project', milestoneId: 'milestone', teamKey: 'team', teamKeys: 'team', stateType: 'state', statusType: 'status',
  status: 'status', initiativeIds: 'initiative', projectIds: 'projects', parentId: 'parent', targetDate: 'target date',
  sortOrder: 'order', milestoneIds: 'milestones', name: 'name', title: 'title', description: 'description',
};
/** The fields whose change is a move to somewhere else; the rest are "changed". */
const MOVES: ReadonlySet<string> = new Set(['projectId', 'milestoneId', 'teamKey', 'teamKeys', 'initiativeIds', 'projectIds', 'parentId', 'milestoneIds']);
const nounOf = (field: string): string => NOUN[field] ?? field;

/** §7.2's sentence, through the same egress redaction as every text ccrc writes, ending with ccrc's provenance. A
 *  description, or a null value on either side, names no values. */
export function restoreComment(kind: DriftKind, field: string, planned: string | null, was: string | null, at: number): string {
  const noun = nounOf(field);
  const day = dayOf(at);
  const named = field !== 'description' && planned !== null && was !== null;
  const head = named
    ? `ccrc restored this ${kind}'s ${noun} to *${planned}*. It had been ${MOVES.has(field) ? 'moved' : 'changed'} to *${was}* on ${day}.`
    : `ccrc restored this ${kind}'s ${noun}. It had been changed on ${day}.`;
  const text = `${head} ccrc's plan decides where work sits here. To change it, ask the coordinator or use the ccrc console.`;
  return withCcrcProvenance(egress(text));
}

/** The Restored line a milestone's description takes for one put-back field. */
export function restoredLine(field: string, at: number): string {
  return `${RESTORED_LINE_PREFIX}${dayOf(at)}: ccrc put back this milestone's ${nounOf(field)}.`;
}

// ── Inbound ──

/** An issue is inbound when its team is managed (keys upper-cased; `managed` holds upper-case keys), no binding holds its
 *  `linearId`, the proxy journal does not name its identifier as a session's own write, and it is open: `changedIssues`
 *  selects no `createdAt` and no creator, so an old closed issue edited later must not read as inbound
 *  (D-8705). */
export function isInbound(
  issue: { linearId: string; identifier: string; teamKey: string; stateType: string },
  bound: ReadonlySet<string>, viaFleet: ReadonlySet<string>, managed: ReadonlySet<string>,
): boolean {
  if (!managed.has(issue.teamKey.toUpperCase())) return false;
  if (bound.has(issue.linearId) || viaFleet.has(issue.identifier)) return false;
  return issue.stateType !== 'completed' && issue.stateType !== 'canceled';
}
