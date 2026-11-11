// The plan's deciders (Linear hierarchy design 2026-11-10, D-8181): pure, no I/O, no clock. L1. Task 2.2 lands the one
// decider the plan store needs (`epicIsDone`); Task 2.3 adds the rest of this file.
import type { ProgramState } from '../../../shared/api.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import {
  CHECKPOINT_KINDS, PLAN_BOUNDS, PLAN_END_OUTCOMES, TICKET_KINDS, isPlanKey,
  type CheckpointEvidence, type CheckpointState, type EpicState, type PlanCloseBody, type PlanEndOutcome, type PlanPutBody,
  type PlanRefusal, type PlanTicketBody, type TicketState,
} from '../../../shared/plan.js';
import type { Changes, CheckpointPatch, EpicPatch, NewCheckpoint, NewEpic, NewTicket, PlanChanges, StoredPlan, TicketPatch } from './planStore.js';

/** An epic is done when no checkpoint is `open`, no ticket is `open` or `started`, and at least one checkpoint is `met` or
 *  one ticket `done` (design §4.1). An epic with nothing in it, or with everything dropped, is not done: a plan declared
 *  with an empty epic must not close it on the spot, and a fully dropped epic is dropped, not finished. */
export function epicIsDone(
  checkpoints: readonly { state: CheckpointState }[], tickets: readonly { state: TicketState }[],
): boolean {
  if (checkpoints.some((c) => c.state === 'open')) return false;
  if (tickets.some((t) => t.state === 'open' || t.state === 'started')) return false;
  return checkpoints.some((c) => c.state === 'met') || tickets.some((t) => t.state === 'done');
}

/** The key of the ticket ccrc makes for a run opened with no `ticket` (`run-<runId>`). The prefix is reserved: a plan verb
 *  never takes a new ticket whose key starts with it, so an auto ticket's key cannot already be taken when its run opens. */
export const AUTO_TICKET_PREFIX = 'run-';
export const autoTicketKey = (runId: number): string => `${AUTO_TICKET_PREFIX}${runId}`;
export const isAutoTicketKey = (key: string): boolean => key.startsWith(AUTO_TICKET_PREFIX);

// ── Parsing ────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Bad = { ok: false; word: 'plan-bad-body' | 'plan-too-large'; detail: string };
const bad = (detail: string): Bad => ({ ok: false, word: 'plan-bad-body', detail });
const tooLarge = (detail: string): Bad => ({ ok: false, word: 'plan-too-large', detail });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const closed = (o: Record<string, unknown>, allowed: readonly string[], where: string): string | null => {
  const extra = Object.keys(o).find((k) => !allowed.includes(k));
  return extra === undefined ? null : `${where}: unknown field ${extra}`;
};
const textOk = (v: unknown, max: number, controlFree: boolean): v is string =>
  typeof v === 'string' && v.length > 0 && [...v].length <= max && (!controlFree || !CONTROL.test(v));
const nonNegInts = (v: unknown, max: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.every((n) => Number.isInteger(n) && n >= 0);

/** What the route knows when it parses a put: the programme's done-when count (the bound of `proves`), and whether a row
 *  exists (`stored: null` means none, so `home` is required; a stored home must equal the body's `home` when it is given). */
export interface PlanPutOpts { doneWhenCount?: number; home?: { stored: string | null } }

export function parsePlanPut(body: unknown, opts: PlanPutOpts = {}):
  { ok: true; put: PlanPutBody } | Bad {
  if (!isObj(body)) return bad('the body is not an object');
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(body), 'utf8'); } catch { return bad('the body is not JSON'); }
  if (bytes > PLAN_BOUNDS.bodyBytes) return tooLarge(`the body is over ${PLAN_BOUNDS.bodyBytes} bytes`);
  const topExtra = closed(body, ['home', 'title', 'epics'], 'body');
  if (topExtra) return bad(topExtra);
  const { home, title, epics } = body;
  if (home !== undefined && !textOk(home, PLAN_BOUNDS.titleChars, true)) return bad('home is not a project name');
  if (title !== undefined && !textOk(title, PLAN_BOUNDS.titleChars, true)) return bad('title is not 1 to 255 characters');
  if (opts.home) {
    if (opts.home.stored === null && home === undefined) return bad('a new programme needs its home project');
    if (opts.home.stored !== null && home !== undefined && home !== opts.home.stored) return bad('home differs from the stored home');
  }
  if (!Array.isArray(epics)) return bad('epics is not a list');
  if (epics.length > PLAN_BOUNDS.epics) return tooLarge(`more than ${PLAN_BOUNDS.epics} epics`);
  let tickets = 0;
  const epicKeys = new Set<string>();
  const ticketKeys = new Set<string>();
  for (const e of epics) {
    if (!isObj(e)) return bad('an epic is not an object');
    const x = closed(e, ['key', 'title', 'summary', 'project', 'waves', 'checkpoints', 'tickets', 'droppedWhy'], 'epic');
    if (x) return bad(x);
    if (!isPlanKey(e.key)) return bad('an epic key is not a plan key');
    if (epicKeys.has(e.key)) return bad(`epic key ${e.key} is repeated`);
    epicKeys.add(e.key);
    if (!textOk(e.title, PLAN_BOUNDS.titleChars, true)) return bad(`epic ${e.key}: title is not 1 to 255 characters`);
    if (typeof e.summary !== 'string' || [...e.summary].length > PLAN_BOUNDS.summaryChars) return bad(`epic ${e.key}: summary is over ${PLAN_BOUNDS.summaryChars} characters`);
    if (e.project !== undefined && !textOk(e.project, PLAN_BOUNDS.titleChars, true)) return bad(`epic ${e.key}: project is not a project name`);
    if (!nonNegInts(e.waves, 64)) return bad(`epic ${e.key}: waves is not a list of wave numbers`);
    if (e.droppedWhy !== undefined && !textOk(e.droppedWhy, PLAN_BOUNDS.reasonChars, false)) return bad(`epic ${e.key}: droppedWhy is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
    if (!Array.isArray(e.checkpoints)) return bad(`epic ${e.key}: checkpoints is not a list`);
    if (e.checkpoints.length > PLAN_BOUNDS.checkpointsPerEpic) return tooLarge(`epic ${e.key}: more than ${PLAN_BOUNDS.checkpointsPerEpic} checkpoints`);
    const cpKeys = new Set<string>();
    for (const c of e.checkpoints) {
      if (!isObj(c)) return bad(`epic ${e.key}: a checkpoint is not an object`);
      const cx = closed(c, ['key', 'title', 'kind', 'proves', 'itemId'], 'checkpoint');
      if (cx) return bad(cx);
      if (!isPlanKey(c.key)) return bad(`epic ${e.key}: a checkpoint key is not a plan key`);
      if (cpKeys.has(c.key)) return bad(`epic ${e.key}: checkpoint key ${c.key} is repeated`);
      cpKeys.add(c.key);
      if (!textOk(c.title, PLAN_BOUNDS.titleChars, true)) return bad(`checkpoint ${c.key}: title is not 1 to 255 characters`);
      if (typeof c.kind !== 'string' || !(CHECKPOINT_KINDS as readonly string[]).includes(c.kind)) return bad(`checkpoint ${c.key}: unknown kind`);
      if (c.proves !== undefined) {
        if (!nonNegInts(c.proves, 64)) return bad(`checkpoint ${c.key}: proves is not a list of done-when indexes`);
        if (opts.doneWhenCount !== undefined && c.proves.some((n) => n >= opts.doneWhenCount!)) return bad(`checkpoint ${c.key}: proves an index outside the done-when list`);
      }
      if (c.itemId !== undefined) {
        if (!Number.isInteger(c.itemId) || (c.itemId as number) < 1) return bad(`checkpoint ${c.key}: itemId is not an item id`);
        if (c.kind !== 'operator-act') return bad(`checkpoint ${c.key}: itemId is only for an operator-act checkpoint`);
      }
    }
    if (e.tickets !== undefined && !Array.isArray(e.tickets)) return bad(`epic ${e.key}: tickets is not a list`);
    for (const t of (e.tickets ?? []) as unknown[]) {
      if (++tickets > PLAN_BOUNDS.ticketsPerBody) return tooLarge(`more than ${PLAN_BOUNDS.ticketsPerBody} tickets`);
      if (!isObj(t)) return bad(`epic ${e.key}: a ticket is not an object`);
      const tx = closed(t, ['key', 'kind', 'title', 'body', 'project', 'checkpoint'], 'ticket');
      if (tx) return bad(tx);
      if (!isPlanKey(t.key)) return bad(`epic ${e.key}: a ticket key is not a plan key`);
      if (ticketKeys.has(t.key)) return bad(`ticket key ${t.key} is repeated`);
      ticketKeys.add(t.key);
      if (typeof t.kind !== 'string' || !(TICKET_KINDS as readonly string[]).includes(t.kind)) return bad(`ticket ${t.key}: unknown kind`);
      if (!textOk(t.title, PLAN_BOUNDS.titleChars, true)) return bad(`ticket ${t.key}: title is not 1 to 255 characters`);
      if (t.body !== undefined && typeof t.body !== 'string') return bad(`ticket ${t.key}: body is not text`);
      if (t.project !== undefined && !textOk(t.project, PLAN_BOUNDS.titleChars, true)) return bad(`ticket ${t.key}: project is not a project name`);
      if (t.checkpoint !== undefined && (typeof t.checkpoint !== 'string' || !cpKeys.has(t.checkpoint))) return bad(`ticket ${t.key}: checkpoint is not one of its epic's`);
    }
  }
  return { ok: true, put: body as unknown as PlanPutBody };
}

export function parsePlanClose(body: unknown):
  { ok: true; close: PlanCloseBody } | { ok: false; word: 'plan-bad-body' | 'dropped-needs-reason'; detail: string } {
  if (!isObj(body)) return { ok: false, word: 'plan-bad-body', detail: 'the body is not an object' };
  const x = closed(body, ['outcome', 'why'], 'body');
  if (x) return { ok: false, word: 'plan-bad-body', detail: x };
  const { outcome, why } = body;
  if (typeof outcome !== 'string' || !(PLAN_END_OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: false, word: 'plan-bad-body', detail: 'outcome is not done or abandoned' };
  }
  if (why !== undefined && !textOk(why, PLAN_BOUNDS.reasonChars, false)) {
    return { ok: false, word: 'plan-bad-body', detail: `why is not 1 to ${PLAN_BOUNDS.reasonChars} characters` };
  }
  if (outcome === 'abandoned' && (why === undefined || why.trim() === '')) {
    return { ok: false, word: 'dropped-needs-reason', detail: 'abandoning a plan needs a reason' };
  }
  return { ok: true, close: { outcome: outcome as PlanEndOutcome, ...(why === undefined ? {} : { why }) } };
}

// ── The single-object verbs' bodies (Task 2.4) ────────────────────────────────────────────────────────────────────────

type VerbBad = { ok: false; word: 'plan-bad-body' | 'dropped-needs-reason'; detail: string };
const verbBad = (detail: string): VerbBad => ({ ok: false, word: 'plan-bad-body', detail });
const needsReason = (detail: string): VerbBad => ({ ok: false, word: 'dropped-needs-reason', detail });

/** `plan met`: `{ checkpoint, epic?, evidence }`, exactly one of `pr`, `itemId` or `path` as the evidence. `epic` names the
 *  checkpoint's epic when two epics reuse the key. */
export function parsePlanMet(body: unknown):
  { ok: true; met: { checkpoint: string; epic?: string; evidence: CheckpointEvidence } } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['checkpoint', 'epic', 'evidence'], 'body');
  if (x) return verbBad(x);
  if (!isPlanKey(body.checkpoint)) return verbBad('checkpoint is not a plan key');
  if (body.epic !== undefined && !isPlanKey(body.epic)) return verbBad('epic is not a plan key');
  const ev = body.evidence;
  if (!isObj(ev)) return verbBad('evidence is not an object');
  const keys = Object.keys(ev);
  if (keys.length !== 1) return verbBad('evidence names exactly one of pr, itemId or path');
  const epic = body.epic === undefined ? {} : { epic: body.epic as string };
  const k = keys[0]!;
  const v = ev[k];
  if ((k === 'pr' || k === 'itemId') && Number.isInteger(v) && (v as number) >= 1) {
    return { ok: true, met: { checkpoint: body.checkpoint, ...epic, evidence: k === 'pr' ? { pr: v as number } : { itemId: v as number } } };
  }
  if (k === 'path' && textOk(v, PLAN_BOUNDS.reasonChars, true)) {
    return { ok: true, met: { checkpoint: body.checkpoint, ...epic, evidence: { path: v } } };
  }
  return verbBad('evidence is not a pull request number, an item id or a path');
}

/** `plan ticket-add`: a ticket's body and the key of the epic it joins. */
export function parsePlanTicketAdd(body: unknown): { ok: true; add: { epic: string; ticket: PlanTicketBody } } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['epic', 'key', 'kind', 'title', 'body', 'project', 'checkpoint'], 'body');
  if (x) return verbBad(x);
  if (!isPlanKey(body.epic)) return verbBad('epic is not a plan key');
  if (!isPlanKey(body.key)) return verbBad('a ticket key is not a plan key');
  if (isAutoTicketKey(body.key)) return verbBad(`a ticket key starting ${AUTO_TICKET_PREFIX} is ccrc's own (a run's auto ticket)`);
  if (typeof body.kind !== 'string' || !(TICKET_KINDS as readonly string[]).includes(body.kind)) return verbBad('unknown ticket kind');
  if (!textOk(body.title, PLAN_BOUNDS.titleChars, true)) return verbBad('title is not 1 to 255 characters');
  if (body.body !== undefined && (typeof body.body !== 'string' || Buffer.byteLength(body.body, 'utf8') > PLAN_BOUNDS.bodyBytes)) return verbBad('body is not text within bounds');
  if (body.project !== undefined && !textOk(body.project, PLAN_BOUNDS.titleChars, true)) return verbBad('project is not a project name');
  if (body.checkpoint !== undefined && !isPlanKey(body.checkpoint)) return verbBad('checkpoint is not a plan key');
  const { epic, ...ticket } = body as Record<string, unknown> & { epic: string };
  return { ok: true, add: { epic, ticket: ticket as unknown as PlanTicketBody } };
}

/** `plan ticket-move`: a ticket's key and what changes (its epic, its checkpoint, its project), or its drop with a reason. */
export function parsePlanTicketMove(body: unknown):
  { ok: true; move: { ticket: string; epic?: string; checkpoint?: string; project?: string; drop?: { why: string } } } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['ticket', 'epic', 'checkpoint', 'project', 'drop'], 'body');
  if (x) return verbBad(x);
  if (!isPlanKey(body.ticket)) return verbBad('ticket is not a plan key');
  if (body.epic !== undefined && !isPlanKey(body.epic)) return verbBad('epic is not a plan key');
  if (body.checkpoint !== undefined && !isPlanKey(body.checkpoint)) return verbBad('checkpoint is not a plan key');
  if (body.project !== undefined && !textOk(body.project, PLAN_BOUNDS.titleChars, true)) return verbBad('project is not a project name');
  const out: { ticket: string; epic?: string; checkpoint?: string; project?: string; drop?: { why: string } } = { ticket: body.ticket };
  if (body.epic !== undefined) out.epic = body.epic as string;
  if (body.checkpoint !== undefined) out.checkpoint = body.checkpoint as string;
  if (body.project !== undefined) out.project = body.project as string;
  if (body.drop !== undefined) {
    if (!isObj(body.drop)) return verbBad('drop is not an object');
    const dx = closed(body.drop, ['why'], 'drop');
    if (dx) return verbBad(dx);
    const why = body.drop.why;
    if (typeof why !== 'string' || why.trim() === '') return needsReason('dropping a ticket needs a reason');
    if (!textOk(why, PLAN_BOUNDS.reasonChars, false)) return verbBad(`why is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
    if (out.epic !== undefined || out.checkpoint !== undefined || out.project !== undefined) return verbBad('a drop moves nothing');
    out.drop = { why };
  } else if (out.epic === undefined && out.checkpoint === undefined && out.project === undefined) {
    return verbBad('the body moves nothing and drops nothing');
  }
  return { ok: true, move: out };
}

/** `plan epic-drop`: the epic's key and a reason. */
export function parsePlanEpicDrop(body: unknown): { ok: true; drop: { epic: string; why: string } } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['epic', 'why'], 'body');
  if (x) return verbBad(x);
  if (!isPlanKey(body.epic)) return verbBad('epic is not a plan key');
  if (typeof body.why !== 'string' || body.why.trim() === '') return needsReason('dropping an epic needs a reason');
  if (!textOk(body.why, PLAN_BOUNDS.reasonChars, false)) return verbBad(`why is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
  return { ok: true, drop: { epic: body.epic, why: body.why } };
}

// ── The diff ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PlanCtx { home: string; doneWhenCount: number; workspaceOfProject(project: string): string | null }
type Refused = { ok: false; word: PlanRefusal; detail: string };
const refuse = (word: PlanRefusal, detail: string): Refused => ({ ok: false, word, detail });
const contiguous = (w: readonly number[]): boolean => {
  const s = [...new Set(w)].sort((a, b) => a - b);
  return s.every((n, i) => i === 0 || n === s[i - 1]! + 1);
};
const sameList = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((n, i) => n === b[i]);
const empty = <N, P>(): Changes<N, P> => ({ insert: [], update: [], drop: [] });

/** The changes that turn the stored plan into the put. An epic that is absent from the put cannot be dropped (it has no
 *  field to carry a reason): the put names it with `droppedWhy` instead. A stored open checkpoint that vanishes is refused
 *  the same way; tickets are never dropped by absence (`plan ticket move` drops them). A met or dropped record is never
 *  re-opened by a put, and a dropped epic is not revived. */
export function diffPlan(stored: StoredPlan, put: PlanPutBody, ctx: PlanCtx): { ok: true; changes: PlanChanges } | Refused {
  const home = put.home ?? ctx.home;
  const byKey = new Map(stored.epics.map((e) => [e.key, e]));
  const putKeys = new Set(put.epics.map((e) => e.key));
  for (const e of stored.epics) {
    if (e.state !== 'dropped' && !putKeys.has(e.key)) return refuse('dropped-needs-reason', `epic ${e.key} left the plan with no droppedWhy`);
  }
  const live = put.epics.filter((e) => e.droppedWhy === undefined && byKey.get(e.key)?.state !== 'dropped');
  for (const e of put.epics) {
    if (!contiguous(e.waves)) return refuse('waves-not-contiguous', `epic ${e.key}: waves are not one contiguous range`);
  }
  const owner = new Map<number, string>();
  for (const e of live) {
    for (const w of e.waves) {
      const o = owner.get(w);
      if (o !== undefined && o !== e.key) return refuse('wave-overlap', `wave ${w} is in epics ${o} and ${e.key}`);
      owner.set(w, e.key);
    }
  }
  const changes: PlanChanges = { epics: empty<NewEpic, EpicPatch>(), checkpoints: empty<NewCheckpoint, CheckpointPatch>(), tickets: empty<NewTicket, TicketPatch>() };
  const storedTicketEpic = new Map<string, string>();
  for (const e of stored.epics) for (const t of e.tickets) storedTicketEpic.set(t.key, e.key);

  for (const [ordinal, e] of put.epics.entries()) {
    const project = e.project ?? home;
    const was = byKey.get(e.key);
    if (was?.state === 'dropped') continue;
    const epicWs = ctx.workspaceOfProject(project);
    for (const t of e.tickets ?? []) {
      const prior = storedTicketEpic.get(t.key);
      if (prior !== undefined && prior !== e.key) return refuse('plan-bad-body', `ticket ${t.key} is in epic ${prior}; move it with plan ticket move`);
      const tw = ctx.workspaceOfProject(t.project ?? project);
      if (epicWs !== null && tw !== null && tw !== epicWs) return refuse('ticket-workspace-mismatch', `ticket ${t.key} is in another workspace than epic ${e.key}`);
    }
    if (e.droppedWhy !== undefined) {
      if (was === undefined) return refuse('plan-bad-body', `epic ${e.key} is new and cannot carry droppedWhy`);
      changes.epics.drop.push({ id: was.id, why: e.droppedWhy });
      continue;
    }
    if (was === undefined) {
      changes.epics.insert.push({ key: e.key, project, waves: e.waves, ordinal, title: e.title, summary: e.summary });
      for (const [i, c] of e.checkpoints.entries()) {
        changes.checkpoints.insert.push({ epicKey: e.key, key: c.key, ordinal: i, title: c.title, kind: c.kind, proves: c.proves ?? [], itemId: c.itemId ?? null });
      }
    } else {
      const patch: EpicPatch = {};
      if (was.project !== project) patch.project = project;
      if (!sameList(was.waves, e.waves)) patch.waves = e.waves;
      if (was.ordinal !== ordinal) patch.ordinal = ordinal;
      if (was.title !== e.title) patch.title = e.title;
      if (was.summary !== e.summary) patch.summary = e.summary;
      if (Object.keys(patch).length > 0) changes.epics.update.push({ id: was.id, ...patch });
      const cpPut = new Set(e.checkpoints.map((c) => c.key));
      for (const c of was.checkpoints) {
        if (c.state === 'open' && !cpPut.has(c.key)) return refuse('dropped-needs-reason', `checkpoint ${c.key} left the plan with no reason`);
      }
      for (const [i, c] of e.checkpoints.entries()) {
        const cw = was.checkpoints.find((x) => x.key === c.key);
        if (cw === undefined) {
          changes.checkpoints.insert.push({ epicKey: e.key, key: c.key, ordinal: i, title: c.title, kind: c.kind, proves: c.proves ?? [], itemId: c.itemId ?? null });
          continue;
        }
        if (cw.state !== 'open') continue;
        const p: CheckpointPatch = {};
        if (cw.ordinal !== i) p.ordinal = i;
        if (cw.title !== c.title) p.title = c.title;
        if (cw.kind !== c.kind) p.kind = c.kind;
        if (!sameList(cw.proves, c.proves ?? [])) p.proves = c.proves ?? [];
        if (c.itemId !== undefined && cw.itemId !== c.itemId) p.itemId = c.itemId;
        if (Object.keys(p).length > 0) changes.checkpoints.update.push({ id: cw.id, ...p });
      }
    }
    for (const t of e.tickets ?? []) {
      const tw = was?.tickets.find((x) => x.key === t.key);
      if (tw === undefined) {
        // a stored auto ticket restated in a put is an update; a NEW one would take a key a later run's open derives
        if (isAutoTicketKey(t.key)) return refuse('plan-bad-body', `ticket ${t.key}: a key starting ${AUTO_TICKET_PREFIX} is ccrc's own (a run's auto ticket)`);
        changes.tickets.insert.push({
          program: stored.program, epicKey: e.key, checkpointKey: t.checkpoint ?? null, key: t.key, kind: t.kind, title: t.title,
          body: t.body ?? '', project: t.project ?? project, source: 'plan',
        });
        continue;
      }
      if (tw.state === 'done' || tw.state === 'dropped') continue;
      const p: TicketPatch = {};
      if (tw.kind !== t.kind) p.kind = t.kind;
      if (tw.title !== t.title) p.title = t.title;
      if (t.body !== undefined && tw.body !== t.body) p.body = t.body;
      if (t.project !== undefined && tw.project !== t.project) p.project = t.project;
      if (Object.keys(p).length > 0) changes.tickets.update.push({ id: tw.id, ...p });
    }
  }
  return { ok: true, changes };
}

// ── States ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How a programme's plan ends (design §5.4): by the coordinator's explicit `plan close`, or derived. A wave gap or a failed
 *  last run is never an end. */
export function programmeEnd(f: {
  planEnd: PlanEndOutcome | null; programState: ProgramState; epics: readonly { state: EpicState }[]; openTickets: number;
}): PlanEndOutcome | null {
  if (f.planEnd !== null) return f.planEnd;
  if (f.programState !== 'done') return null;
  if (f.epics.length === 0) return null;
  if (!f.epics.every((e) => e.state === 'done' || e.state === 'dropped')) return null;
  return f.openTickets === 0 ? 'done' : null;
}

/** THE one definition of a live epic for opening a run: any epic but a dropped one. A `done` epic that lists the wave still
 *  takes a run (a later wave, or another run in a settled wave), and `attachTicketInTx` reopens it. The gate and the store
 *  both ask this. */
export const epicAdmitsRun = (state: EpicState): boolean => state !== 'dropped';

/** THE one definition of a ticket a run holds: `started`, or `open` with a `runId` (a `planned` run attaches its ticket at
 *  `runs open` and starts it only at dispatch). `runs open` refuses it `ticket-unavailable`; `plan ticket-move` and
 *  `plan epic-drop` refuse it `plan-runs-open`, so a planned run never dispatches into a moved or dropped ticket. */
export const ticketIsHeld = (t: { state: TicketState; runId: number | null }): boolean => t.state === 'started' || t.runId !== null;

/** The epic a wave's runs belong to: the first epic, in the order given, that lists the wave and is not dropped. */
export function epicForWave(epics: readonly { id: number; waves: readonly number[]; state: EpicState }[], wave: number): number | null {
  return epics.find((e) => epicAdmitsRun(e.state) && e.waves.includes(wave))?.id ?? null;
}

// ── Callers ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The programme verbs are the programme's coordinator's (or, before any is recorded, whoever declares first). A worker may
 *  file a follow-up, and only into its own run's epic: `target` names the epic the call writes into when the route knows
 *  it; without it a run with an epic is enough. */
export function planCallerVerdict(
  caller: string, owner: string | null, verb: 'programme' | 'follow-up',
  runOfCaller: { program: string; epicId: number | null } | null,
  target?: { program: string; epicId: number },
): { ok: true } | { ok: false; word: 'not-plan-owner' } {
  if (owner === null || caller === owner) return { ok: true };
  if (verb === 'follow-up' && runOfCaller !== null && runOfCaller.epicId !== null) {
    if (target === undefined || (target.program === runOfCaller.program && target.epicId === runOfCaller.epicId)) return { ok: true };
  }
  return { ok: false, word: 'not-plan-owner' };
}

/** `named` is the named owner of the project whose owner applies; `ownsTeamProject` is the project that owns a shared team key
 *  (null or this project: the project itself), whose latest programme's coordinator is the default (design §7.5). */
export interface OwnerFacts {
  named: string | null; ownsTeamProject: string | null;
  latestProgrammeCoordinator(project: string): string | null; presence(id: string): CoordinatorPresence;
}
export function linearOwnerOf(project: string, f: OwnerFacts):
  { id: string | null; source: 'named' | 'default' | 'none'; live: boolean; gone: boolean } {
  const id = f.named ?? f.latestProgrammeCoordinator(f.ownsTeamProject ?? project);
  if (id === null) return { id: null, source: 'none', live: false, gone: true };
  const p = f.presence(id);
  return { id, source: f.named !== null ? 'named' : 'default', live: p === 'alive', gone: p === 'dead' || p === 'absent' };
}
