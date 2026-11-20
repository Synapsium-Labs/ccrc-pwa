// L1 policy, pure (D-8186): the migration map's deciders. They check a map against the open issues and the plans, order
// the writes, say how to resume a half-done move, and say how to put a migration back. No I/O: the caller reads Linear
// and the store, and runs the steps this returns.
import { isPlanKey, MAP_CLASSES, TICKET_KINDS, type HierarchyState, type IssueSnapshot, type MapBody, type MapCounts, type MapEntry, type MigrationState, type PlanEpicBody, type TicketKind } from '../../../shared/plan.js';
import type { LinkingMode } from '../../../shared/api.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import type { RaiseItemInput } from '../coord/ledgersStore.js';
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

  // 5. A leaf stays in its own team: a migration never moves an issue across teams. And the structure a map declares lives in
  //    the map's own team: an owner never creates projects in another team's projects (D-8186, a security review's finding).
  const team = map.team.toLowerCase();
  for (const g of [...groups.map((x) => ({ slug: x.programme, epics: x.epics })), ...backlog.map((x) => ({ slug: x.slug, epics: x.epics }))]) {
    for (const ep of g.epics) {
      const key = ctx.teamOf(ep.project ?? ctx.home);
      if (key === null || key.toLowerCase() !== team) return fail('plan-bad-body', `epic-other-team:${g.slug}/${ep.key}`);
    }
  }
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
  const counts = countsOfMap(map);
  if (counts.moved + counts.closed + counts.left !== map.entries.length) throw new Error('migrationPolicy: counts do not add up');
  return { ok: true, counts };
}

/** A map's counts before it is applied (§10.3): the objects its structure creates, the issues it moves, closes and leaves. */
export function countsOfMap(map: MapBody): MapCounts {
  const n = (cls: MapEntry['class'][]) => map.entries.filter((e) => cls.includes(e.class)).length;
  const groups = [...(map.epics ?? []), ...(map.backlog ?? [])];
  const declaredEpics: PlanEpicBody[] = groups.flatMap((g) => g.epics);
  return {
    created: groups.length + declaredEpics.length + declaredEpics.reduce((a, e) => a + e.checkpoints.length, 0),
    moved: n(['leaf', 'upkeep']),
    closed: n(['programme', 'epic', 'checkpoint', 'finished', 'superseded', 'stale']),
    left: n(['unclear']),
    skipped: 0,
  };
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

// ── The migration's lifecycle words (Tasks 7.2 to 7.4; L1, pure) ──

/** The facts of a migration row these deciders read (the store's `MigrationRow`, narrowed). */
export interface MigrationFacts {
  id: number; workspaceId: string; teamKey: string; state: MigrationState; appliedAt: number | null; putBackAt: number | null;
  reportDoneAt: number | null; itemId: number | null; reportItemId: number | null; createdAt: number; updatedAt: number;
}
/** A migration that no longer holds the order (§10.2): put back, failed, or applied with its report closed. */
export const migrationSettled = (m: Pick<MigrationFacts, 'state' | 'reportDoneAt'>): boolean =>
  m.state === 'put-back' || m.state === 'failed' || (m.state === 'applied' && m.reportDoneAt !== null);

/** `POST /api/projects/:project/hierarchy/migrate` (Task 7.2): one team at a time, in order (§10.2), and never a team already
 *  migrated. `rows` are every migration, any order. */
export function startVerdict(rows: readonly MigrationFacts[], team: string | null, workspaceId: string | null):
  { ok: true } | { ok: false; word: 'no-team-key' | 'migration-in-flight'; detail: string } {
  if (team === null) return { ok: false, word: 'no-team-key', detail: 'the project has no Linear team key' };
  const open = rows.find((m) => !migrationSettled(m));
  if (open !== undefined) return { ok: false, word: 'migration-in-flight', detail: `team ${open.teamKey}'s migration is not finished` };
  const same = rows.filter((m) => m.teamKey.toUpperCase() === team.toUpperCase() && (workspaceId === null || m.workspaceId === workspaceId));
  if (same.some((m) => m.state === 'applied')) return { ok: false, word: 'migration-in-flight', detail: `team ${team} is migrated already` };
  return { ok: true };
}

/** The hierarchy state a project row shows (§11.1) from its team's newest migration: none is "Not migrated". */
export function hierarchyStateOf(m: MigrationFacts | null): { state: HierarchyState; at: number | null; itemId: number | null } {
  if (m === null) return { state: 'not-migrated', at: null, itemId: null };
  switch (m.state) {
    case 'proposed': return { state: 'map-waiting', at: m.updatedAt, itemId: m.itemId };
    case 'proposing': case 'approved': case 'applying': return { state: 'migrating', at: m.createdAt, itemId: m.itemId };
    case 'applied': return { state: 'migrated', at: m.appliedAt, itemId: m.reportItemId };
    case 'put-back': return { state: 'put-back', at: m.putBackAt, itemId: m.reportItemId };
    default: return { state: 'not-migrated', at: null, itemId: null };
  }
}

/** Put back is offered until the team's next migration starts (§10.4): a later row for the same team refuses it. */
export function putBackVerdict(m: MigrationFacts, rows: readonly MigrationFacts[]):
  { ok: true } | { ok: false; word: 'migration-in-flight' | 'item-act-mismatch'; detail: string } {
  if (m.state !== 'applied') return { ok: false, word: 'item-act-mismatch', detail: `the migration is ${m.state}` };
  const later = rows.some((r) => r.id > m.id && r.teamKey.toUpperCase() === m.teamKey.toUpperCase() && r.workspaceId === m.workspaceId);
  return later ? { ok: false, word: 'migration-in-flight', detail: 'the team\'s next migration has started' } : { ok: true };
}

/** A re-read in snapshot terms from the sync's planned owned fields of an issue (D-8796): the team by key, the state by type,
 *  the project and milestone by id, and the texts. `parentId` is not owned (ccrc sets no parent), so `expect` leaves it out. */
export function expectOfOwned(owned: Readonly<Record<string, unknown>>): Partial<IssueSnapshot> {
  const out: Partial<IssueSnapshot> = {};
  const str = (v: unknown): string | null | undefined => (typeof v === 'string' || v === null ? v : undefined);
  const pairs: [keyof IssueSnapshot, string][] = [['title', 'title'], ['description', 'description'], ['team', 'teamKey'], ['project', 'projectId'], ['milestone', 'milestoneId'], ['state', 'stateType']];
  for (const [to, from] of pairs) {
    const v = str(owned[from]);
    if (v !== undefined) (out as Record<string, string | null>)[to] = v;
  }
  return out;
}

/** The report's counts (§10.3): created objects and moved issues from the applied move rows; closed issues likewise; skipped
 *  and left from the report and the map. */
export function reportCounts(moves: readonly Pick<MoveRow, 'kind' | 'before' | 'appliedAt' | 'after'>[], map: MapBody, skipped: number): MapCounts {
  const applied = moves.filter((m) => m.appliedAt !== null);
  const closing = (m: (typeof applied)[number]): boolean => {
    const st = isObj(m.after.expect) ? (m.after.expect as Partial<IssueSnapshot>).state : undefined;
    return st === 'canceled' || st === 'completed';
  };
  return {
    created: applied.filter((m) => m.before === null).length,
    moved: applied.filter((m) => m.kind === 'issue' && m.before !== null && !closing(m)).length,
    closed: applied.filter((m) => m.kind === 'issue' && m.before !== null && closing(m)).length,
    left: map.entries.filter((e) => e.class === 'unclear').length,
    skipped,
  };
}

/** The map body a `plan map-propose` sends (`entries`, optional `backlog` and `epics`), shaped; the server fills `team` and
 *  `snapshot`. The deep checks are `checkMap`'s; this refuses only a body of the wrong shape. */
export function parseMapProposal(body: unknown, team: string): { ok: true; map: Omit<MapBody, 'snapshot'> } | { ok: false; word: 'plan-bad-body'; detail: string } {
  const bad = (detail: string) => ({ ok: false as const, word: 'plan-bad-body' as const, detail });
  if (!isObj(body)) return bad('the body is not an object');
  const { entries, backlog, epics } = body;
  if (!Array.isArray(entries)) return bad('entries is not a list');
  const out: MapEntry[] = [];
  for (const e of entries) {
    if (!isObj(e) || typeof e['issue'] !== 'string' || typeof e['identifier'] !== 'string' || !(MAP_CLASSES as readonly unknown[]).includes(e['class'])) return bad('an entry needs issue, identifier and a class');
    const t = e['target'];
    if (t !== undefined && !isObj(t)) return bad(`${e['identifier']}: target is not an object`);
    for (const [k, v] of Object.entries(t ?? {})) {
      if (!['programme', 'epic', 'checkpoint', 'successor', 'ticketKey', 'kind'].includes(k) || typeof v !== 'string') return bad(`${e['identifier']}: target.${k}`);
    }
    out.push({ issue: e['issue'], identifier: e['identifier'], class: e['class'] as MapEntry['class'], ...(t === undefined ? {} : { target: t as MapEntry['target'] }) });
  }
  const groups = (v: unknown, key: 'slug' | 'programme'): boolean => v === undefined || (Array.isArray(v) && v.every((g) => isObj(g) && typeof g[key] === 'string' && Array.isArray(g['epics'])));
  if (!groups(backlog, 'slug')) return bad('backlog');
  if (!groups(epics, 'programme')) return bad('epics');
  return {
    ok: true,
    map: {
      team, entries: out,
      ...(backlog === undefined ? {} : { backlog: backlog as NonNullable<MapBody['backlog']> }),
      ...(epics === undefined ? {} : { epics: epics as NonNullable<MapBody['epics']> }),
    },
  };
}

// ── Items and mails (§11.3; every one raised under `linear-sync`, acted on in the console only) ──

const countsLine = (c: MapCounts): string =>
  `${c.created} to create, ${c.moved} to move, ${c.closed} to close, ${c.left} left as they are${c.skipped > 0 ? `, ${c.skipped} skipped as changed` : ''}`;

/** The map's `decide` item: Approve (recommended) or Return with a note to the Linear owner. */
export function mapItemInput(migrationId: number, team: string, owner: string, c: MapCounts): RaiseItemInput {
  return {
    program: LINEAR_SYNC_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'decide', neededBy: 'later', soonLabel: null, secretSlot: null,
    title: `Approve the Linear migration map for team ${team}`,
    why: `The Linear owner ${owner} proposed how team ${team}'s open issues fit the hierarchy: ${countsLine(c)}. Nothing changes in Linear until you approve it, and the report after it offers Put back.`,
    how: [
      'Read the counts, each programme\'s epics and checkpoints, and the issues grouped by class below.',
      'Approve: ccrc applies the map, each live programme\'s part at its next wave boundary, and raises a report when it is done.',
      'Return: write a note; it goes back to the Linear owner, who proposes again.',
    ],
    options: ['Approve', 'Return'], recommended: 0, recommendedWhy: 'The server checked that the map lists every open issue once and every target exists.',
    action: { verb: 'linear-map', migrationId },
  };
}
/** The report's `do` item: Put back (confirm) or Done. */
export function reportItemInput(migrationId: number, team: string, c: MapCounts): RaiseItemInput {
  return {
    program: LINEAR_SYNC_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do', neededBy: 'later', soonLabel: null, secretSlot: null,
    title: `Linear migration report for team ${team}`,
    why: `The map for team ${team} is applied: ${c.created} created, ${c.moved} moved, ${c.closed} closed, ${c.skipped} skipped as changed, ${c.left} left. Team ${team} is now managed: ccrc keeps its Linear hierarchy.`,
    how: [
      'Read the counts and the full list below.',
      'Done: the report closes, and the next team may start.',
      'Put back: ccrc reverses every move from its record, cancels what it created (nothing is deleted), and lists any issue moved since.',
    ],
    options: null, action: { verb: 'linear-report', migrationId },
  };
}
/** The mail asking the team's Linear owner for the map (Task 7.2), deduped by its subject. */
export function proposeMail(migrationId: number, team: string, project: string, followUp: readonly string[] = []): { subject: string; body: string } {
  return {
    subject: `linear migration ${migrationId}: propose the map for team ${team}`,
    body: [
      `You are the Linear owner of project ${project}, whose team ${team} is to be reshaped into ccrc's hierarchy (migration ${migrationId}).`,
      followUp.length === 0
        ? 'Read the team\'s open issues, then send the map with `ccrc-api plan map-propose ' + team + ' --json -` (references/plan.md, "The migration map").'
        : `A follow-up map covers only the issues skipped as changed: ${followUp.join(', ')}. Send it with \`ccrc-api plan map-propose ${team} --json -\`.`,
      'The operator approves it in the console; nothing in Linear changes before that.',
    ].join('\n'),
  };
}
/** The mail asking a live programme's coordinator to declare its plan before the map places its issues (§10.1). */
export function declareMail(migrationId: number, team: string, slug: string): { subject: string; body: string } {
  return {
    subject: `linear migration ${migrationId}: declare the plan of ${slug} first`,
    body: `Team ${team} is being reshaped into ccrc's hierarchy. Programme ${slug} is live and has no declared plan: declare its epics (with their waves) and checkpoints with \`ccrc-api plan put ${slug}\`, so the team's Linear owner can place its open issues onto them. A map never rewrites your plan.`,
  };
}
/** The operator's Return, mailed to the Linear owner with its note. */
export function returnMail(migrationId: number, team: string, note: string, at: number): { subject: string; body: string } {
  return {
    subject: `linear migration ${migrationId}: the map for team ${team} came back at ${new Date(at).toISOString()}`,
    body: `The operator returned the map for team ${team} with this note:\n\n${note}\n\nPropose it again with \`ccrc-api plan map-propose ${team} --json -\`.`,
  };
}
