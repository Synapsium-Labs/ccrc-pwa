// L1 policy, pure (D-8186): the migration map's deciders. They check a map against the open issues and the plans, order
// the writes, say how to resume a half-done move, and say how to put a migration back. No I/O: the caller reads Linear
// and the store, and runs the steps this returns.
import { isPlanKey, TICKET_KINDS, type IssueSnapshot, type MapBody, type MapCounts, type MapEntry, type PlanEpicBody, type TicketKind } from '../../../shared/plan.js';
import type { LinkingMode } from '../../../shared/api.js';
import { parsePlanPut } from '../coord/planPolicy.js';
import type { StoredPlan } from '../coord/planStore.js';
import type { CcrcOpName } from './hierarchyOps.js';

export type IssueSnapshotRow = IssueSnapshot & { linearId: string; identifier: string };
export interface IssueAfter {
  /** What the issue reads after the write, in a re-read's terms (state TYPE, team KEY, ids): for reconcile and put back. */
  expect: Partial<IssueSnapshot>;
  [k: string]: unknown;
}
export type MigrationStep = { op: CcrcOpName; linearId: string | null; before: IssueSnapshot | null; after: Readonly<Record<string, unknown>> };
export type MoveKind = 'issue' | 'programme' | 'epic' | 'checkpoint';
/** A `linear_migration_moves` row with `before` and `after` parsed. */
export interface MoveRow {
  id: number; migrationId: number; subject: string; kind: MoveKind; linearId: string | null; identifier: string | null;
  before: IssueSnapshot | null; after: Readonly<Record<string, unknown>>; appliedAt: number | null; revertedAt: number | null;
}
export interface MapContext {
  /** The team's owning project: the project of a map-declared epic that names none. */
  home: string;
  /** A ccrc project's team key, or null when it has none. */
  teamOf(project: string): string | null;
  /** Ticket keys already in the home project's Upkeep epic. */
  upkeepKeys: ReadonlySet<string>;
}
export type PlanFacts = { declared: boolean; live: boolean; plan: StoredPlan | null };
type MapWord = 'map-incomplete' | 'map-rewrites-plan' | 'plan-bad-body';
type Checked = { ok: true; counts: MapCounts } | { ok: false; word: MapWord; detail: string };

const FIELDS = ['state', 'team', 'project', 'parent', 'milestone', 'title', 'description'] as const satisfies readonly (keyof IssueSnapshot)[];
/** A field holds a value a re-read can measure: a string, or null for an absent project, parent or milestone. */
const measured = (v: unknown): boolean => typeof v === 'string' || v === null;
/** Equal on every listed field, by key and type (D-8795): a field either side cannot measure is never a match. */
const sameOn = (a: Partial<IssueSnapshot>, b: Partial<IssueSnapshot>, fields: readonly (keyof IssueSnapshot)[] = FIELDS): boolean =>
  fields.every((f) => measured(a[f]) && measured(b[f]) && a[f] === b[f]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const ticketKeyOf = (e: MapEntry): string => e.target?.ticketKey ?? e.identifier.toLowerCase();
export const ticketKindOf = (e: MapEntry): TicketKind => e.target?.kind ?? 'task';
export const programmeOfEntry = (e: MapEntry): string | null => e.target?.programme ?? null;

// ── checkMap ──

interface EpicFacts { project: string; checkpoints: Set<string>; tickets: string[] }

/** The epics a programme has, from the map's declarations and the stored plan (a dropped or put-back epic is no target). */
function epicsOf(map: MapBody, prog: string, plans: (p: string) => PlanFacts, home: string): Map<string, EpicFacts> {
  const out = new Map<string, EpicFacts>();
  const declared = [...(map.backlog ?? []).filter((g) => g.slug === prog), ...(map.epics ?? []).filter((g) => g.programme === prog)];
  for (const g of declared) {
    for (const e of g.epics) {
      out.set(e.key, { project: e.project ?? home, checkpoints: new Set(e.checkpoints.map((c) => c.key)), tickets: (e.tickets ?? []).map((t) => t.key) });
    }
  }
  for (const e of plans(prog).plan?.epics ?? []) {
    if (e.state === 'dropped' || e.putBackAt !== null) continue;
    out.set(e.key, { project: e.project, checkpoints: new Set(e.checkpoints.map((c) => c.key)), tickets: e.tickets.map((t) => t.key) });
  }
  return out;
}

function storedTicketKeys(plan: StoredPlan | null): string[] {
  return (plan?.epics ?? []).flatMap((e) => e.tickets.map((t) => t.key));
}

export function checkMap(map: MapBody, open: readonly IssueSnapshotRow[], plans: (programme: string) => PlanFacts, ctx: MapContext): Checked {
  const fail = (word: MapWord, detail: string): Checked => ({ ok: false, word, detail });

  // 1. Coverage: every open issue once, and nothing else.
  const openIds = new Set(open.map((o) => o.linearId));
  const seen = new Set<string>();
  for (const e of map.entries) {
    if (!openIds.has(e.issue)) return fail('map-incomplete', `not-open:${e.identifier}`);
    if (seen.has(e.issue)) return fail('map-incomplete', `twice:${e.identifier}`);
    seen.add(e.issue);
  }
  const missing = open.find((o) => !seen.has(o.linearId));
  if (missing) return fail('map-incomplete', `missing:${missing.identifier}`);

  // 2. The map declares structure only for a programme with no plan and no live run (design §10.1).
  const backlog = map.backlog ?? [];
  const groups = map.epics ?? [];
  for (const slug of [...groups.map((g) => g.programme), ...backlog.map((g) => g.slug)]) {
    const f = plans(slug);
    if (f.declared || f.live) return fail('map-rewrites-plan', slug);
  }
  for (const g of backlog) if ((plans(g.slug).plan?.epics.length ?? 0) > 0) return fail('map-rewrites-plan', g.slug);

  // 3. Body shape.
  const slugs = [...groups.map((g) => g.programme), ...backlog.map((g) => g.slug)];
  for (const s of slugs) if (!isPlanKey(s)) return fail('plan-bad-body', `programme-key:${String(s)}`);
  const dup = slugs.find((s, i) => slugs.indexOf(s) !== i);
  if (dup !== undefined) return fail('plan-bad-body', `programme-twice:${dup}`);
  for (const g of backlog) if (typeof g.title !== 'string' || g.title === '') return fail('plan-bad-body', `backlog-title:${g.slug}`);
  for (const g of [...groups.map((x) => ({ slug: x.programme, epics: x.epics })), ...backlog.map((x) => ({ slug: x.slug, epics: x.epics }))]) {
    const p = parsePlanPut({ epics: g.epics });
    if (!p.ok) return fail('plan-bad-body', `${g.slug}: ${p.detail}`);
  }

  // 4. Targets, by class.
  const declaredProg = new Set(slugs);
  const progExists = (p: string | undefined): boolean => p !== undefined && (declaredProg.has(p) || plans(p).plan !== null || plans(p).declared);
  const cache = new Map<string, Map<string, EpicFacts>>();
  const epicsFor = (p: string) => cache.get(p) ?? (cache.set(p, epicsOf(map, p, plans, ctx.home)), cache.get(p)!);
  const unknown = (e: MapEntry) => fail('plan-bad-body', `unknown-target:${e.identifier}`);
  for (const e of map.entries) {
    const t = e.target ?? {};
    const ep = t.programme !== undefined && t.epic !== undefined ? epicsFor(t.programme).get(t.epic) : undefined;
    let good: boolean;
    switch (e.class) {
      case 'leaf': good = progExists(t.programme) && ep !== undefined && (t.checkpoint === undefined || ep.checkpoints.has(t.checkpoint)); break;
      case 'programme': good = progExists(t.programme); break;
      case 'epic': good = progExists(t.programme) && ep !== undefined; break;
      case 'checkpoint': good = progExists(t.programme) && ep !== undefined && t.checkpoint !== undefined && ep.checkpoints.has(t.checkpoint); break;
      case 'superseded': good = typeof t.successor === 'string' && t.successor !== ''; break;
      default: good = true;
    }
    if (!good) return unknown(e);
  }

  // 5. A leaf stays in its own team: a migration never moves an issue across teams.
  const team = map.team.toLowerCase();
  for (const e of map.entries) {
    if (e.class !== 'leaf') continue;
    const project = epicsFor(e.target!.programme!).get(e.target!.epic!)!.project;
    const key = ctx.teamOf(project);
    if (key === null) return fail('plan-bad-body', `leaf-no-team:${e.identifier}`);
    if (key.toLowerCase() !== team) return fail('plan-bad-body', `leaf-other-team:${e.identifier}`);
  }

  // 6. Ticket keys.
  const usedIn = new Map<string, Set<string>>();
  const upkeepUsed = new Set(ctx.upkeepKeys);
  for (const e of map.entries) {
    if (e.class !== 'leaf' && e.class !== 'upkeep') continue;
    const key = ticketKeyOf(e);
    if (!isPlanKey(key)) return fail('plan-bad-body', `ticket-key-bad:${e.identifier}`);
    if (e.target?.kind !== undefined && !(TICKET_KINDS as readonly string[]).includes(e.target.kind)) return fail('plan-bad-body', `ticket-kind:${e.identifier}`);
    let used: Set<string>;
    if (e.class === 'upkeep') used = upkeepUsed;
    else {
      const p = e.target!.programme!;
      used = usedIn.get(p) ?? new Set([...storedTicketKeys(plans(p).plan), ...[...epicsFor(p).values()].flatMap((x) => x.tickets)]);
      usedIn.set(p, used);
    }
    if (used.has(key)) return fail('plan-bad-body', `ticket-key-used:${key}`);
    used.add(key);
  }

  // 7. Counts.
  const n = (cls: MapEntry['class'][]) => map.entries.filter((e) => cls.includes(e.class)).length;
  const declaredEpics: PlanEpicBody[] = [...groups, ...backlog].flatMap((g) => g.epics);
  const counts: MapCounts = {
    created: slugs.length + declaredEpics.length + declaredEpics.reduce((a, e) => a + e.checkpoints.length, 0),
    moved: n(['leaf', 'upkeep']),
    closed: n(['programme', 'epic', 'checkpoint', 'finished', 'superseded', 'stale']),
    left: n(['unclear']),
    skipped: 0,
  };
  if (counts.moved + counts.closed + counts.left !== map.entries.length) throw new Error('migrationPolicy: counts do not add up');
  return { ok: true, counts };
}

// ── applySteps ──

const APPLY_ORDER: readonly (readonly MapEntry['class'][])[] = [['leaf', 'upkeep'], ['finished', 'superseded', 'stale'], ['programme', 'epic', 'checkpoint']];

/** The writes to run now, in order: tickets are placed before a replaced level is closed, so its relation names the first
 *  ticket placed. An issue changed since the map was stored is skipped; a live programme's part waits. */
export function applySteps(map: MapBody, live: ReadonlySet<string>, reread: ReadonlyMap<string, IssueSnapshot | 'closed'>,
  afterOf: (e: MapEntry) => IssueAfter | null): { now: MigrationStep[]; waiting: string[]; skipped: string[] } {
  const now: MigrationStep[] = [];
  const waiting: string[] = [];
  const skipped: string[] = [];
  for (const group of APPLY_ORDER) {
    for (const e of map.entries.filter((x) => group.includes(x.class))) {
      const prog = programmeOfEntry(e);
      if (prog !== null && live.has(prog)) { waiting.push(e.issue); continue; }
      const cur = reread.get(e.issue);
      const was = map.snapshot[e.issue];
      if (cur === undefined || cur === 'closed' || was === undefined || !sameOn(cur, was)) { skipped.push(e.issue); continue; }
      const after = afterOf(e);
      if (after === null) { waiting.push(e.issue); continue; }
      now.push({ op: 'issueUpdate', linearId: e.issue, before: cur, after });
    }
  }
  return { now, waiting, skipped };
}

// ── reconcileMove and put back ──

/** A row with no `appliedAt` found on a re-run: did the write land before the crash? */
export function reconcileMove(row: MoveRow, reread: IssueSnapshot | 'closed'): 'applied' | 'redo' | 'skip' {
  if (row.before === null) return row.linearId === null ? 'redo' : 'applied';
  const expect: Partial<IssueSnapshot> = isObj(row.after.expect) ? (row.after.expect as Partial<IssueSnapshot>) : {};
  if (reread === 'closed') return expect.state === 'completed' || expect.state === 'canceled' ? 'applied' : 'skip';
  // An `expect` that names no field proves nothing: the row is listed, never marked applied on no evidence.
  const named = FIELDS.filter((f) => f in expect);
  if (named.length > 0 && sameOn(reread, expect, named)) return 'applied';
  return sameOn(reread, row.before) ? 'redo' : 'skip';
}

/** The steps that put an applied migration back, last move first. An issue that moved since is listed in `moved`, never
 *  touched. A milestone the migration created is written nothing (Linear's milestone has no status, D-8795): it stays in
 *  Linear under its canceled project, and `left` lists it by subject for the report. */
export function putBackSteps(moves: readonly MoveRow[], current: ReadonlyMap<string, IssueSnapshot>): { steps: MigrationStep[]; moved: string[]; left: string[] } {
  const steps: MigrationStep[] = [];
  const moved: string[] = [];
  const left: string[] = [];
  const done = moves.filter((m) => m.appliedAt !== null && m.revertedAt === null).sort((a, b) => b.id - a.id);
  for (const m of done) {
    if (m.before === null) {
      // A create: cancel the object. A milestone has no status, so it is left.
      const op: CcrcOpName | null = m.kind === 'programme' ? 'initiativeUpdate' : m.kind === 'epic' ? 'projectUpdate' : null;
      if (op !== null) steps.push({ op, linearId: m.linearId, before: null, after: { cancel: true } });
      else left.push(m.subject);
      continue;
    }
    if (m.kind !== 'issue' || m.linearId === null) continue;
    const cur = current.get(m.linearId);
    const expect: Partial<IssueSnapshot> = isObj(m.after.expect) ? (m.after.expect as Partial<IssueSnapshot>) : {};
    if (cur === undefined || !sameOn(cur, expect, FIELDS.filter((f) => f in expect))) { moved.push(m.identifier ?? m.linearId); continue; }
    steps.push({ op: 'issueUpdate', linearId: m.linearId, before: cur, after: { expect: m.before, restore: m.before } });
  }
  return { steps, moved, left };
}

// ── the comment on a replaced issue ──

/** A public team's comment carries no URL and no identifier; a private team's may carry the link. */
export function replacementComment(home: string, mode: LinkingMode, url: string | null): string {
  const link = mode === 'private' && url !== null ? ` (${url})` : '';
  return `This issue now lives in “${home}”${link}. ccrc's migration closed it; nothing was deleted.`;
}

