// The plan's deciders (Linear hierarchy design 2026-11-10, D-8181): pure, no I/O, no clock. L1. Task 2.2 lands the one
// decider the plan store needs (`epicIsDone`); Task 2.3 adds the rest of this file.
import type { ProgramState } from '../../../shared/api.js';
import type { CoordinatorPresence } from '../../../shared/ledgers.js';
import {
  CHECKPOINT_KINDS, PHASE_REF_KINDS, PLAN_BOUNDS, PLAN_END_OUTCOMES, TICKET_KINDS, TRIAGE_DECISIONS, isPlanKey,
  type CheckpointEvidence, type CheckpointState, type EpicState, type PlanCloseBody, type PlanEndOutcome, type PlanEpicBody, type PlanPhaseBody,
  type PlanPhaseRefBody, type PlanPhaseRefMoveBody, type PlanPutBody, type PlanRefusal, type PlanTicketBody,
  type PlanTicketDoneBody, type TicketDoneEvidence, type TicketState, type TriageDecision,
} from '../../../shared/plan.js';
import { isLinearIdentifier } from '../linear/ops.js';
import { measuredProjectTeam, type TeamRoutes } from '../linear/route.js';
import { requestIdOf } from '../linear/planSyncPolicy.js';
import type {
  BindingRow, Changes, CheckpointPatch, EpicPatch, HierarchyProjectFacts, InboundRow, NewCheckpoint, NewEpic, NewPhase, NewPhaseRef, NewTicket,
  PhaseChanges, PhasePatch, PhaseRefWrite, PhaseRow, PlanChanges, StoredPlan, TicketPatch,
} from './planStore.js';

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
  const topExtra = closed(body, ['home', 'title', 'phases', 'epics'], 'body');
  if (topExtra) return bad(topExtra);
  const { home, title, epics } = body;
  if (body.phases !== undefined) {
    const ph = parsePhases(body.phases);
    if (ph !== null) return ph;
  }
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
    if (e.waves !== undefined && !nonNegInts(e.waves, 64)) return bad(`epic ${e.key}: waves is not a list of wave numbers`);
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

/** A put's `phases` (programme work map WM0, D14): at most 24, each a key, a title, a one-line summary, its references (a
 *  whole epic or one ticket, by key) and an optional `droppedWhy`. Null when well formed. */
function parsePhases(phases: unknown): Bad | null {
  if (!Array.isArray(phases)) return bad('phases is not a list');
  if (phases.length > PLAN_BOUNDS.phases) return tooLarge(`more than ${PLAN_BOUNDS.phases} phases`);
  const keys = new Set<string>();
  for (const p of phases) {
    if (!isObj(p)) return bad('a phase is not an object');
    const x = closed(p, ['key', 'title', 'summary', 'refs', 'droppedWhy'], 'phase');
    if (x) return bad(x);
    if (!isPlanKey(p.key)) return bad('a phase key is not a plan key');
    if (keys.has(p.key)) return bad(`phase key ${p.key} is repeated`);
    keys.add(p.key);
    if (!textOk(p.title, PLAN_BOUNDS.titleChars, true)) return bad(`phase ${p.key}: title is not 1 to 255 characters`);
    if (typeof p.summary !== 'string' || [...p.summary].length > PLAN_BOUNDS.summaryChars) return bad(`phase ${p.key}: summary is over ${PLAN_BOUNDS.summaryChars} characters`);
    if (p.droppedWhy !== undefined && !textOk(p.droppedWhy, PLAN_BOUNDS.reasonChars, false)) return bad(`phase ${p.key}: droppedWhy is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
    if (!Array.isArray(p.refs)) return bad(`phase ${p.key}: refs is not a list`);
    if (p.refs.length > PLAN_BOUNDS.refsPerPhase) return tooLarge(`phase ${p.key}: more than ${PLAN_BOUNDS.refsPerPhase} references`);
    const seen = new Set<string>();
    for (const r of p.refs as unknown[]) {
      const rb = refBody(r);
      if (typeof rb === 'string') return bad(`phase ${p.key}: ${rb}`);
      if (seen.has(`${rb.kind}:${rb.key}`)) return bad(`phase ${p.key}: reference ${rb.kind} ${rb.key} is repeated`);
      seen.add(`${rb.kind}:${rb.key}`);
    }
  }
  return null;
}
/** One reference's body, `{ kind, key }`, or why it is not one. */
function refBody(r: unknown): PlanPhaseRefBody | string {
  if (!isObj(r)) return 'a reference is not an object';
  const x = closed(r, ['kind', 'key'], 'reference');
  if (x) return x;
  if (typeof r.kind !== 'string' || !(PHASE_REF_KINDS as readonly string[]).includes(r.kind)) return 'a reference kind is not epic or ticket';
  if (!isPlanKey(r.key)) return 'a reference key is not a plan key';
  return { kind: r.kind as PlanPhaseRefBody['kind'], key: r.key };
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

/** Wave 6 review round 3 F4, carried to wave 7 (design §12, D-8186): a worker's follow-up ticket (`plan ticket-add` filed by
 *  anyone but the programme's coordinator, stored with source `worker`) is told to that coordinator once, by mail naming the
 *  ticket's key, title and epic, and that it may move or drop it. The coordinator's own ticket-add, or a programme with no
 *  coordinator, tells nobody: null. One mail per ticket, since a ticket key is added once. */
export function followUpTicketMail(t: { slug: string; key: string; title: string; epic: string; caller: string; owner: string | null }):
  { to: string; subject: string; body: string } | null {
  if (t.owner === null || t.caller === t.owner) return null;
  return {
    to: t.owner,
    subject: `follow-up ticket ${t.key} filed in ${t.slug}`,
    body: `${t.caller} filed a follow-up ticket in your plan of ${t.slug}: ${t.key}, "${t.title}", in epic ${t.epic}. It is yours `
      + `to keep, move to another epic or checkpoint, or drop with a reason (\`plan ticket-move\`).`,
  };
}

/** `plan phase-ref`: `{ op: 'add' | 'remove', phase, ref: { kind, key } }` or `{ op: 'carry', from, to, ticket }` (D17). The
 *  caller's identity rides the query, so a body naming `byId` or `byUuid` is refused as an unknown field. */
export function parsePlanPhaseRef(body: unknown): { ok: true; move: PlanPhaseRefMoveBody } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  if (body.op === 'add' || body.op === 'remove') {
    const x = closed(body, ['op', 'phase', 'ref'], 'body');
    if (x) return verbBad(x);
    if (!isPlanKey(body.phase)) return verbBad('phase is not a plan key');
    const rb = refBody(body.ref);
    if (typeof rb === 'string') return verbBad(rb);
    return { ok: true, move: { op: body.op, phase: body.phase, ref: rb } };
  }
  if (body.op === 'carry') {
    const x = closed(body, ['op', 'from', 'to', 'ticket'], 'body');
    if (x) return verbBad(x);
    if (!isPlanKey(body.from)) return verbBad('from is not a plan key');
    if (!isPlanKey(body.to)) return verbBad('to is not a plan key');
    if (!isPlanKey(body.ticket)) return verbBad('ticket is not a plan key');
    return { ok: true, move: { op: 'carry', from: body.from, to: body.to, ticket: body.ticket } };
  }
  return verbBad('op is not add, remove or carry');
}

/** `plan ticket-done` (programme work map WM1, D-8727): `{ ticket, evidence: { runId } | { pr } }`, exactly one evidence
 *  key, a positive integer. The caller's identity rides the query, so a body naming `byId` or `byUuid` is refused as an
 *  unknown field. */
export function parsePlanTicketDone(body: unknown): { ok: true; done: PlanTicketDoneBody } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['ticket', 'evidence'], 'body');
  if (x) return verbBad(x);
  if (!isPlanKey(body.ticket)) return verbBad('ticket is not a plan key');
  const ev = body.evidence;
  if (!isObj(ev)) return verbBad('evidence is not an object');
  const keys = Object.keys(ev);
  if (keys.length !== 1) return verbBad('evidence names exactly one of runId or pr');
  const k = keys[0]!;
  const v = ev[k];
  if ((k !== 'runId' && k !== 'pr') || !Number.isSafeInteger(v) || (v as number) < 1) {
    return verbBad('evidence is not a run id or a pull request number');
  }
  return { ok: true, done: { ticket: body.ticket, evidence: k === 'runId' ? { runId: v as number } : { pr: v as number } } };
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
/** THE one reader of an epic's waves (programme work map WM6, D-8780; spec Q5, R133): `waves` is optional on the wire. An
 *  explicit list, `[]` included, is the epic's range; an ABSENT list keeps the stored epic's range (`stored`, as an absent
 *  ticket `body` keeps the stored body, the coordinator's ruling on review 2791 F6) and, with no stored epic, lists none.
 *  Every caller that wants an epic's waves reads them here (after `parsePlanPut` has validated the body's field). */
export const listedWaves = (e: { readonly waves?: readonly number[] | undefined }, stored?: readonly number[]): number[] => [...(e.waves ?? stored ?? [])];
/** An epic is checked against waves, and takes a run by its wave, only when it lists some. */
export const listsWaves = (e: { readonly waves?: readonly number[] | undefined }): boolean => listedWaves(e).length > 0;
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
  // Programme work map WM6 (D-8780): both checks read only the epics that list waves; one that lists none has no range to
  // be contiguous or to overlap, however many such epics a plan holds. An epic whose put omits `waves` keeps its stored
  // range (review 2791 F6), so every read here is of the range the put leaves it with.
  const rangeOf = (e: PlanEpicBody): number[] => listedWaves(e, byKey.get(e.key)?.waves);
  for (const e of put.epics) {
    const range = rangeOf(e);
    if (range.length > 0 && !contiguous(range)) return refuse('waves-not-contiguous', `epic ${e.key}: waves are not one contiguous range`);
  }
  const owner = new Map<number, string>();
  for (const e of live) {
    for (const w of rangeOf(e)) {
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
      const held = dropEpicInto(changes, was, e.droppedWhy);
      if (held !== null) return held;
      continue;
    }
    if (was === undefined) {
      changes.epics.insert.push({ key: e.key, project, waves: listedWaves(e), ordinal, title: e.title, summary: e.summary });
      for (const [i, c] of e.checkpoints.entries()) {
        changes.checkpoints.insert.push({ epicKey: e.key, key: c.key, ordinal: i, title: c.title, kind: c.kind, proves: c.proves ?? [], itemId: c.itemId ?? null });
      }
    } else {
      const patch: EpicPatch = {};
      if (was.project !== project) patch.project = project;
      const range = rangeOf(e);
      if (!sameList(was.waves, range)) patch.waves = range;
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

// ── Phases (programme work map WM0, D-8715) ────────────────────────────────────────────────────────────────────────────

/** THE one derivation of a phase's number (review 2268 F6): its 1-based place, in the order given, among the phases that are
 *  not dropped. The plan read's `PhaseView.number` and the work map's phase and carry numbers both take it from here. */
export function phaseNumbers(phases: readonly { key: string; dropped: boolean }[]): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const p of phases) if (!p.dropped) out.set(p.key, out.size + 1);
  return out;
}

const findTicket = (stored: StoredPlan, key: string) => {
  for (const e of stored.epics) { const t = e.tickets.find((x) => x.key === key); if (t !== undefined) return { epic: e, ticket: t }; }
  return undefined;
};

/** The put's phases against the stored ones (D18): diffed by key like epics; a stored phase that is not dropped and is
 *  absent from the put needs `droppedWhy` (`dropped-needs-reason`); a dropped phase is never revived. References are only
 *  ADDED: one the phase already holds is left as it is (even to an object dropped since), and a new one must name an epic or
 *  ticket that is not dropped once the put applies (`unknown-ref`), wherever it stands in the put: on a dropped phase and on a
 *  phase the same put drops too (review 2375 F9). Other content on a dropped phase (title, summary, position, valid new
 *  references) is ignored, as `diffPlan` ignores it on a dropped epic. A put whose order puts a recorded carry's target at or
 *  before its source is refused `bad-carry` (review 2268 F12). An absent `phases` changes nothing. */
export function diffPhases(stored: StoredPlan, phases: readonly PhaseRow[], put: PlanPutBody):
  { ok: true; changes: PhaseChanges | undefined } | Refused {
  if (put.phases === undefined) return { ok: true, changes: undefined };
  const byKey = new Map(phases.map((p) => [p.key, p]));
  const putKeys = new Set(put.phases.map((p) => p.key));
  for (const p of phases) {
    if (p.droppedWhy === null && !putKeys.has(p.key)) return refuse('dropped-needs-reason', `phase ${p.key} left the plan with no droppedWhy`);
  }
  // What is live once the put applies: an epic the put keeps (not dropped before, not dropped by it), and a ticket that is not
  // dropped (an open ticket of an epic the put drops drops with it, `dropEpicInto`) or a new one in a live epic.
  const putEpic = new Map(put.epics.map((e) => [e.key, e]));
  const storedEpic = new Map(stored.epics.map((e) => [e.key, e]));
  const epicLive = (key: string): boolean => {
    const e = putEpic.get(key);
    return e !== undefined && e.droppedWhy === undefined && storedEpic.get(key)?.state !== 'dropped';
  };
  const ticketLive = (key: string): boolean => {
    const f = findTicket(stored, key);
    if (f !== undefined) return f.ticket.state !== 'dropped' && !(f.ticket.state === 'open' && !epicLive(f.epic.key));
    return put.epics.some((e) => epicLive(e.key) && (e.tickets ?? []).some((t) => t.key === key));
  };
  const idOf = (kind: 'epic' | 'ticket', key: string): number | undefined =>
    kind === 'epic' ? storedEpic.get(key)?.id : findTicket(stored, key)?.ticket.id;

  // The references a phase of the put adds: those it does not already hold, each to an object live once the put applies.
  const newRefs = (p: PlanPhaseBody, was: PhaseRow | undefined): { ok: true; refs: PlanPhaseRefBody[] } | Refused => {
    const refs: PlanPhaseRefBody[] = [];
    for (const r of p.refs) {
      const id = idOf(r.kind, r.key);
      if (was !== undefined && id !== undefined && was.refs.some((x) => x.kind === r.kind && x.refId === id)) continue;
      if (!(r.kind === 'epic' ? epicLive(r.key) : ticketLive(r.key))) {
        return refuse('unknown-ref', `phase ${p.key}: no ${r.kind} ${r.key} that is not dropped`);
      }
      refs.push(r);
    }
    return { ok: true, refs };
  };

  const changes: PhaseChanges = { phases: { insert: [], update: [], drop: [] }, refs: [] };
  const liveOrdinal = new Map<number, number>();
  for (const [ordinal, p] of put.phases.entries()) {
    const was = byKey.get(p.key);
    if (p.droppedWhy !== undefined) {
      if (was === undefined) return refuse('plan-bad-body', `phase ${p.key} is new and cannot carry droppedWhy`);
      const adds = newRefs(p, was);
      if (!adds.ok) return adds;
      if (was.droppedWhy === null) changes.phases.drop.push({ id: was.id, why: p.droppedWhy });
      continue;
    }
    const adds = newRefs(p, was);
    if (!adds.ok) return adds;
    if (was !== undefined && was.droppedWhy !== null) continue;
    if (was === undefined) {
      changes.phases.insert.push({ key: p.key, ordinal, title: p.title, summary: p.summary } satisfies NewPhase);
    } else {
      liveOrdinal.set(was.id, ordinal);
      const patch: PhasePatch = {};
      if (was.ordinal !== ordinal) patch.ordinal = ordinal;
      if (was.title !== p.title) patch.title = p.title;
      if (was.summary !== p.summary) patch.summary = p.summary;
      if (Object.keys(patch).length > 0) changes.phases.update.push({ id: was.id, ...patch });
    }
    for (const r of adds.refs) changes.refs.push({ phaseKey: p.key, kind: r.kind, key: r.key } satisfies NewPhaseRef);
  }
  for (const p of phases) {
    for (const r of p.refs) {
      if (r.carriedTo === null) continue;
      const from = liveOrdinal.get(p.id);
      const to = liveOrdinal.get(r.carriedTo);
      if (from !== undefined && to !== undefined && to <= from) {
        const toKey = phases.find((x) => x.id === r.carriedTo)?.key ?? String(r.carriedTo);
        return refuse('bad-carry', `phase ${toKey} holds a carry from phase ${p.key} and cannot come before it`);
      }
    }
  }
  return { ok: true, changes };
}

/** `plan phase-ref`'s one decision (D17, review 2268 F12). `add` and `remove` name a phase that is not dropped and an epic or
 *  ticket by key (`unknown-ref` otherwise); adding a reference the phase holds changes nothing, and a new one must name an
 *  object that is not dropped. A `remove` of either end of a recorded carry, the source's reference marked carried to a phase
 *  that is not dropped or the reference in that carry's target, is refused `bad-carry`; every other remove is allowed.
 *  `carry` is refused `bad-carry` when either phase is dropped, `to` is not later than `from`, the ticket is done, or the
 *  ticket is not `from`'s own work: held there by a ticket or whole-epic reference, not dropped, and not already carried out
 *  of it to a phase that is not dropped. */
export function phaseRefVerdict(move: PlanPhaseRefMoveBody, stored: StoredPlan, phases: readonly PhaseRow[]):
  { ok: true; write: PhaseRefWrite } | Refused {
  const numbers = phaseNumbers(phases.map((p) => ({ key: p.key, dropped: p.droppedWhy !== null })));
  const live = (id: number | null): boolean => id !== null && phases.some((p) => p.id === id && p.droppedWhy === null);
  if (move.op === 'carry') {
    const from = phases.find((p) => p.key === move.from);
    const to = phases.find((p) => p.key === move.to);
    if (from === undefined) return refuse('unknown-ref', `no phase ${move.from}`);
    if (to === undefined) return refuse('unknown-ref', `no phase ${move.to}`);
    const f = findTicket(stored, move.ticket);
    if (f === undefined) return refuse('unknown-ref', `no ticket ${move.ticket}`);
    const t = f.ticket;
    if (from.droppedWhy !== null) return refuse('bad-carry', `phase ${from.key} was dropped`);
    if (to.droppedWhy !== null) return refuse('bad-carry', `phase ${to.key} was dropped`);
    if (!(numbers.get(to.key)! > numbers.get(from.key)!)) return refuse('bad-carry', `phase ${to.key} is not later than phase ${from.key}`);
    if (t.state === 'done') return refuse('bad-carry', `ticket ${t.key} is done`);
    const tref = from.refs.find((r) => r.kind === 'ticket' && r.refId === t.id);
    const held = tref !== undefined || from.refs.some((r) => r.kind === 'epic' && r.refId === t.epicId);
    const carriedOut = tref !== undefined && live(tref.carriedTo);
    if (!held || carriedOut || t.state === 'dropped') return refuse('bad-carry', `ticket ${t.key} is not phase ${from.key}'s own work`);
    return { ok: true, write: { kind: 'carry', fromPhaseId: from.id, toPhaseId: to.id, ticketId: t.id } };
  }
  const phase = phases.find((p) => p.key === move.phase);
  if (phase === undefined || phase.droppedWhy !== null) {
    return refuse('unknown-ref', phase === undefined ? `no phase ${move.phase}` : `phase ${move.phase} was dropped`);
  }
  const obj = move.ref.kind === 'epic'
    ? stored.epics.find((e) => e.key === move.ref.key)
    : findTicket(stored, move.ref.key)?.ticket;
  if (obj === undefined) return refuse('unknown-ref', `no ${move.ref.kind} ${move.ref.key}`);
  const held = phase.refs.find((r) => r.kind === move.ref.kind && r.refId === obj.id);
  if (move.op === 'add') {
    if (held !== undefined) return { ok: true, write: { kind: 'none' } };
    if (obj.state === 'dropped') return refuse('unknown-ref', `${move.ref.kind} ${move.ref.key} was dropped`);
    return { ok: true, write: { kind: 'insert', phaseId: phase.id, refKind: move.ref.kind, refId: obj.id } };
  }
  if (held === undefined) return refuse('unknown-ref', `phase ${phase.key} holds no reference to ${move.ref.kind} ${move.ref.key}`);
  if (held.kind === 'ticket' && live(held.carriedTo)) {
    return refuse('bad-carry', `phase ${phase.key} recorded a carry of ticket ${move.ref.key}: removing it would undo the carry`);
  }
  if (held.kind === 'ticket' && phases.some((p) => p.id !== phase.id && p.refs.some((r) => r.kind === 'ticket' && r.refId === obj.id && r.carriedTo === phase.id))) {
    return refuse('bad-carry', `ticket ${move.ref.key} was carried into phase ${phase.key}: removing it would leave the carry pointing nowhere`);
  }
  return { ok: true, write: { kind: 'delete', refRowId: held.id } };
}

// ── States ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How a programme's plan ends (design §5.4): by the coordinator's explicit `plan close`, or derived. A wave gap or a failed
 *  last run is never an end. */
export function programmeEnd(f: { programState: string }): PlanEndOutcome | null {
  // Programme lifecycle W1 (D-8983): the decision, and nothing else. Done syncs as `done`, Abandoned as `abandoned` (never
  // as completed), a live state as not ended, so a reopen syncs back. D-51's inference of `done` from settled epics is gone.
  return f.programState === 'done' || f.programState === 'abandoned' ? f.programState : null;
}

/** THE one definition of a live epic for opening a run: any epic but a dropped one. A `done` epic that lists the wave still
 *  takes a run (a later wave, or another run in a settled wave), and `attachTicketInTx` reopens it. The gate and the store
 *  both ask this. */
export const epicAdmitsRun = (state: EpicState): boolean => state !== 'dropped';

/** THE one definition of a ticket a run holds: `started`, or `open` with a `runId` (a `planned` run attaches its ticket at
 *  `runs open` and starts it only at dispatch). `runs open` refuses it `ticket-unavailable`; `plan ticket-move` and
 *  `plan epic-drop` refuse it `plan-runs-open`, so a planned run never dispatches into a moved or dropped ticket. */
export const ticketIsHeld = (t: { state: TicketState; runId: number | null }): boolean =>
  t.state === 'started' || (t.state === 'open' && t.runId !== null);

/** THE one epic drop, `plan epic-drop`'s and a put's `droppedWhy`: refused `plan-runs-open` while a run holds one of the
 *  epic's tickets (`ticketIsHeld`), so neither door drops an epic a planned run would dispatch into; otherwise the epic, its
 *  open checkpoints and its open tickets drop under the one reason, into `changes`. A `done` ticket keeps its runId and is
 *  not held: its run has ended. */
export function dropEpicInto(
  changes: PlanChanges,
  epic: { id: number; key: string; checkpoints: readonly { id: number; state: CheckpointState }[]; tickets: readonly { id: number; state: TicketState; runId: number | null }[] },
  why: string,
): Refused | null {
  if (epic.tickets.some(ticketIsHeld)) return refuse('plan-runs-open', `a run of this programme holds a ticket of epic ${epic.key}`);
  changes.epics.drop.push({ id: epic.id, why });
  for (const c of epic.checkpoints) if (c.state === 'open') changes.checkpoints.drop.push({ id: c.id, why });
  for (const t of epic.tickets) if (t.state === 'open') changes.tickets.drop.push({ id: t.id, why });
  return null;
}

/** Programme work map WM1 (D-8727; spec §4.1, D10): `runs open` with no `ticket` must name one when the plan declares at
 *  least one phase and the wave's epic holds an `open` ticket that is not an auto ticket (`isAutoTicketKey`) and that no run
 *  holds. A plan with no phases, or an epic with no such ticket, mints the run's own ticket as before. */
export function runMustNameTicket(phased: boolean, tickets: readonly { key: string; state: TicketState; runId: number | null }[]): boolean {
  if (!phased) return false;
  return tickets.some((t) => t.state === 'open' && t.runId === null && !isAutoTicketKey(t.key));
}

/** What `plan ticket-done`'s verdict reads (programme work map WM1, D-8727), gathered by the route. `run` is the run a
 *  `{ runId }` names (null when there is no such run; `ticketId`/`ticketKey` its own ticket, null for none); `landed` what
 *  the landing line says of a `{ pr }` for the ticket's own project; `stored` the done evidence already stored on the
 *  programme's tickets; `links` the landing line's pairs of a pull request and the run that carried it, which tie a stored
 *  piece of evidence of the other kind to this one (review 2429 F2; `evidenceLinksOf`, planRunFacts.ts, reads them). */
export interface TicketDoneFacts {
  program: string;
  ticket: { id: number; key: string; project: string; state: TicketState; runId: number | null };
  evidence: TicketDoneEvidence;
  run: { program: string; kind: string; state: string; ticketId: number | null; ticketKey: string | null } | null;
  landed: { kind: 'landed' } | { kind: 'unlanded'; state: string } | { kind: 'no-entry' } | { kind: 'unreadable'; detail: string } | null;
  /** The programme's other tickets' stored evidence; `malformed` is a column that reads as neither kind (review 2712 F3). */
  stored: readonly { ticketId: number; key: string; project: string; evidence: TicketDoneEvidence | 'malformed' }[];
  /** The landing line's ties of a pull request to the run that carried it, each with the ticket that run holds (its own
   *  ticket, `plan.ticketOfRun`; null for none), as `planRunFacts.ts#evidenceLinksOf` reads them (review 2712 F1). */
  links: { kind: 'read'; pairs: readonly EvidenceLink[] } | { kind: 'unreadable'; detail: string };
}
export interface EvidenceLink { project: string; pr: number; runId: number; holder: { ticketId: number; key: string } | null }

/** What one project's landing line says of pull request `pr` (its entries in line order): `landed` when any entry for it is,
 *  else the newest entry's state, else no entry. */
export function landedFactOf(entries: readonly { pr: number; state: string }[], pr: number): NonNullable<TicketDoneFacts['landed']> {
  const mine = entries.filter((e) => e.pr === pr);
  if (mine.length === 0) return { kind: 'no-entry' };
  return mine.some((e) => e.state === 'landed') ? { kind: 'landed' } : { kind: 'unlanded', state: mine[mine.length - 1]!.state };
}

/** THE evidence rule of `plan ticket-done` (spec §4.1, review 2375 F2), and the ticket's own state in `plan ticket-move`'s
 *  words (F21): a ticket a run holds is `plan-runs-open`, one not `open` is `plan-bad-body`. `{ runId }` verifies when that
 *  run is a `work` run of this programme in state `done` whose own ticket is this ticket, an auto ticket or none; `{ pr }`
 *  when the landing line holds that pull request `landed` for the ticket's own project (F19). A piece of evidence already
 *  stored on another ticket of the programme does not verify (F2: one run or pull request closes at most one ticket), except
 *  on the run's own auto ticket, which folds into the declared one. A pull request is one project's: the same number in
 *  another project is another pull request. A run and the pull request it carried are one piece of work (review 2429 F2,
 *  the coordinator's ruling): a `{ pr }` the landing line ties to a run stored on another ticket does not verify, nor a
 *  `{ runId }` tied to a pull request stored on another, except that run's own auto ticket again; a link that cannot be
 *  read refuses, as an unreadable landing line does. A `{ pr }` the landing line ties to a run that holds another declared
 *  ticket does not verify either, whether or not that ticket stores evidence yet (review 2712 F1); on the `{ pr }` side the
 *  exception is the linked run's own auto ticket alone, compared by ticket id (F2); and evidence another ticket stores that
 *  reads as neither kind refuses, since it could be this evidence (F3). */
export function ticketDoneVerdict(f: TicketDoneFacts): { ok: true } | Refused {
  const t = f.ticket;
  if (ticketIsHeld(t)) return refuse('plan-runs-open', `ticket ${t.key} is held by run ${t.runId ?? '?'}: it is recorded done once that run ends`);
  if (t.state !== 'open') return refuse('plan-bad-body', `ticket ${t.key} is ${t.state}: only an open ticket is recorded done`);
  const ev = f.evidence;
  if ('runId' in ev) {
    const r = f.run;
    if (r === null) return refuse('evidence-unverified', `no run ${ev.runId}`);
    if (r.program !== f.program || r.kind !== 'work') return refuse('evidence-unverified', `run ${ev.runId} is not a work run of ${f.program}`);
    if (r.state !== 'done') return refuse('evidence-unverified', `run ${ev.runId} is ${r.state}, not done`);
    if (r.ticketId !== null && r.ticketId !== t.id && !(r.ticketKey !== null && isAutoTicketKey(r.ticketKey))) {
      return refuse('evidence-unverified', `run ${ev.runId} did ticket ${r.ticketKey ?? '?'}, not ${t.key}`);
    }
  } else {
    const l = f.landed;
    if (l === null || l.kind === 'no-entry') {
      return refuse('evidence-unverified', `the landing line of ${t.project} holds no pull request ${ev.pr}: name the run that carried it`);
    }
    if (l.kind === 'unreadable') return refuse('evidence-unverified', `the landing line of ${t.project} could not be read (${l.detail})`);
    if (l.kind === 'unlanded') return refuse('evidence-unverified', `pull request ${ev.pr} of ${t.project} is ${l.state}, not landed`);
  }
  if (f.links.kind === 'unreadable') return refuse('evidence-unverified', `the landing line that ties runs to pull requests could not be read (${f.links.detail})`);
  const unread = f.stored.find((s) => s.ticketId !== t.id && s.evidence === 'malformed');
  if (unread !== undefined) return refuse('evidence-unverified', `ticket ${unread.key} stores evidence that cannot be read: it could be this evidence`);
  const pairs = f.links.pairs;
  // The { pr } side: this pull request's ties (its own project's line) to the runs that carried it.
  const ties = 'pr' in ev ? pairs.filter((p) => p.project === t.project && p.pr === ev.pr) : [];
  const ownAutoOf = (p: EvidenceLink): number | null => (p.holder !== null && isAutoTicketKey(p.holder.key) ? p.holder.ticketId : null);
  const holding = ties.find((p) => p.holder !== null && p.holder.ticketId !== t.id && !isAutoTicketKey(p.holder.key));
  if (holding !== undefined && holding.holder !== null) {
    return refuse('evidence-unverified', `pull request ${holding.pr} was carried by run ${holding.runId}, which holds ticket ${holding.holder.key}: they close one ticket`);
  }
  const ownAuto = 'runId' in ev && f.run !== null ? f.run.ticketId : null;
  const taken = f.stored.find((s) => {
    const se = s.evidence;
    if (s.ticketId === t.id || se === 'malformed') return false;
    if ('runId' in ev) {
      if (s.ticketId === ownAuto) return false;
      return 'runId' in se ? se.runId === ev.runId
        : pairs.some((p) => p.project === s.project && p.pr === se.pr && p.runId === ev.runId);
    }
    return 'pr' in se ? se.pr === ev.pr && s.project === t.project
      : ties.some((p) => p.runId === se.runId && s.ticketId !== ownAutoOf(p));
  });
  if (taken !== undefined) return refuse('evidence-unverified', `this evidence is already stored on ticket ${taken.key}: it closes one ticket`);
  return { ok: true };
}

/** The epic a wave's runs belong to: the first epic, in the order given, that lists the wave and is not dropped. */
export function epicForWave(epics: readonly { id: number; waves: readonly number[]; state: EpicState }[], wave: number): number | null {
  return epics.find((e) => epicAdmitsRun(e.state) && e.waves.includes(wave))?.id ?? null;
}

/** Programme work map WM6 (D-8780; spec Q5, R133): the epic a run opens into. A run that names a ticket of a live epic that
 *  lists no waves takes that epic, whatever its wave (the wave is checked against an epic only when it lists waves);
 *  otherwise the epic that lists the wave (`epicForWave`). With neither, a run that named no ticket in a plan where a live
 *  epic lists none is refused `ticket-required`, since naming a ticket is its remedy, and anything else `wave-epic-mismatch`,
 *  as before. `ticketEpic` is the named ticket's epic (null when the ticket is missing or none was named); `named` is whether
 *  the open named a ticket at all. */
export function epicForOpen(
  epics: readonly { id: number; waves: readonly number[]; state: EpicState }[], wave: number, ticketEpic: number | null, named: boolean,
): { epicId: number } | { refused: 'wave-epic-mismatch' | 'ticket-required' } {
  const waveless = epics.filter((e) => epicAdmitsRun(e.state) && !listsWaves(e));
  const own = ticketEpic === null ? undefined : waveless.find((e) => e.id === ticketEpic);
  if (own !== undefined) return { epicId: own.id };
  const listed = epicForWave(epics, wave);
  if (listed !== null) return { epicId: listed };
  return { refused: !named && waveless.length > 0 ? 'ticket-required' : 'wave-epic-mismatch' };
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

/** D-8183 (§7.5): the marked holder, else the one that set the key first, else the first holder without an order. */
function rankHolders(holders: readonly HierarchyProjectFacts[]): HierarchyProjectFacts | undefined {
  return holders.find((r) => r.ownsTeam)
    ?? holders.filter((r) => r.order !== null).sort((x, y) => x.order! - y.order!)[0]
    ?? holders[0];
}

export const teamHolders = (team: string, rows: readonly HierarchyProjectFacts[]) => rows.filter((r) => r.teamKey?.toUpperCase() === team.toUpperCase());
const NO_HOLDER = { kind: 'none', reason: null } as const;
type NoTeamOwner = { kind: 'none'; reason: 'team-ambiguous' | null };
type ProjectPick = { kind: 'owner'; row: HierarchyProjectFacts } | NoTeamOwner | { kind: 'unmeasured'; possible: readonly HierarchyProjectFacts[] };

/** The one workspace-qualified owner rule (D-8808). A holder pinned to this workspace that outranks every row naming the key is the
 *  owner whatever the routing says (a failed listing and an unreadable slot answer alike); the answer is unmeasured only when an
 *  unpinned row that outranks it exists and its routing cannot be read. The candidates on `unmeasured` are for refusals only. */
export function teamOwnerProject(team: string, rows: readonly HierarchyProjectFacts[], workspace: string, routes: TeamRoutes | null): ProjectPick {
  const holders = teamHolders(team, rows).filter((r) => r.workspaceId == null || r.workspaceId === workspace);
  const best = rankHolders(holders);
  if (best === undefined) return NO_HOLDER;
  const pinned = rankHolders(holders.filter((r) => r.workspaceId === workspace));
  const unmeasured = (): ProjectPick => ({ kind: 'unmeasured', possible: pinned === undefined || pinned === best ? [best] : [best, pinned] });
  const own = best.workspaceId == null ? measuredProjectTeam(routes, { teamKey: team, workspaceId: null }) : null;
  if (pinned === undefined && own?.kind === 'refused' && own.word === 'team-ambiguous') return { kind: 'none', reason: 'team-ambiguous' };
  if (own === null) return { kind: 'owner', row: best };
  if (own.kind === 'unmeasured') return unmeasured();
  if (own.kind === 'slot' && own.slot.workspaceId === workspace) return { kind: 'owner', row: best };
  return pinned === undefined ? NO_HOLDER : { kind: 'owner', row: pinned };
}

/** What the owner rule reads beyond the rows: the latest programme coordinator and a session's standing. */
export type OwnerReads = Omit<OwnerFacts, 'named' | 'ownsTeamProject'>;
type Owner = ReturnType<typeof linearOwnerOf> & { kind: 'owner'; project: string };
export type TeamOwner = Owner | NoTeamOwner | { kind: 'unmeasured'; possibleIds: readonly string[] };

const ownerFor = (project: string, named: string | null, f: OwnerReads): Owner =>
  ({ kind: 'owner', project, ...linearOwnerOf(project, { named, ownsTeamProject: null, ...f }) });
const resolvePick = (pick: ProjectPick, f: OwnerReads): TeamOwner => {
  if (pick.kind === 'owner') return ownerFor(pick.row.project, pick.row.linearOwner, f);
  if (pick.kind === 'none') return pick;
  return { kind: 'unmeasured', possibleIds: pick.possible.flatMap((r) => {
    const id = r.linearOwner ?? f.latestProgrammeCoordinator(r.project);
    return id === null ? [] : [id];
  }) };
};

/** The key-only diagnostic for a door with no workspace to act on. It can never authorize an issue read or write. */
export function teamOwnerDiagnostic(team: string, rows: readonly HierarchyProjectFacts[], f: OwnerReads): Owner | NoTeamOwner {
  const row = rankHolders(teamHolders(team, rows));
  return row === undefined ? NO_HOLDER : ownerFor(row.project, row.linearOwner, f);
}

export function linearOwnerOfTeam(team: string, rows: readonly HierarchyProjectFacts[], f: OwnerReads, workspace: string, routes: TeamRoutes | null): TeamOwner {
  return resolvePick(teamOwnerProject(team, rows, workspace, routes), f);
}

/** Read a project's team owner, and its workspace for waiting-issue checks, without a project fallback. */
function projectTeamOwner(row: Pick<HierarchyProjectFacts, 'teamKey' | 'workspaceId'> | undefined, rows: readonly HierarchyProjectFacts[], routes: TeamRoutes | null): { pick: ProjectPick; workspace: string | null } {
  if (row === undefined || row.teamKey === null) return { pick: NO_HOLDER, workspace: null };
  const pin = row.workspaceId ?? null;
  if (pin !== null) return { pick: teamOwnerProject(row.teamKey, rows, pin, routes), workspace: pin };
  const route = measuredProjectTeam(routes, { teamKey: row.teamKey, workspaceId: null });
  if (route.kind === 'unmeasured') return { pick: { kind: 'unmeasured', possible: [] }, workspace: null };
  if (route.kind === 'refused') return { pick: route.word === 'team-ambiguous' ? { kind: 'none', reason: route.word } : NO_HOLDER, workspace: null };
  return { pick: teamOwnerProject(row.teamKey, rows, route.slot.workspaceId, routes), workspace: route.slot.workspaceId };
}

/** Whether a project row's team owner is not measured: the one pick the hierarchy card's owner display reads, so the console's
 *  migration state and Reshape cannot disagree with it (D-8186, D-8808). */
export function teamOwnerUnmeasured(row: Pick<HierarchyProjectFacts, 'teamKey' | 'workspaceId'>, rows: readonly HierarchyProjectFacts[], routes: TeamRoutes | null): boolean {
  return projectTeamOwner(row, rows, routes).pick.kind === 'unmeasured';
}

/** The project fallback is for display and handoff only, and applies only on a measured `none`. */
export function linearOwnerOfProject(project: string, rows: readonly HierarchyProjectFacts[], f: OwnerReads, routes: TeamRoutes | null): Owner | Extract<TeamOwner, { kind: 'unmeasured' }> {
  const row = rows.find((r) => r.project === project);
  const owner = resolvePick(projectTeamOwner(row, rows, routes).pick, f);
  return owner.kind === 'none' ? ownerFor(project, row?.linearOwner ?? null, f) : owner;
}

/** An owner item cannot settle on the project fallback or with an issue for its current team still waiting. */
export function ownerItemReady(
  project: string, rows: readonly HierarchyProjectFacts[], f: OwnerReads, routes: TeamRoutes | null,
  waiting: readonly { teamKey: string; workspaceId: string }[],
): boolean {
  const row = rows.find((r) => r.project === project);
  const { pick, workspace } = projectTeamOwner(row, rows, routes);
  const owner = resolvePick(pick, f);
  return owner.kind === 'owner' && owner.live && !waiting.some((issue) => workspace === issue.workspaceId && row?.teamKey?.toUpperCase() === issue.teamKey.toUpperCase());
}

/** D-8808 (review 3048 F5): the shared-key item's decision, over the inbound route step's owner verdicts for the `waiting` issues.
 *  `raise`: the team keys (upper-case, sorted) whose issues wait because the owner rule MEASURED them `team-ambiguous` (the holders
 *  that could serve the issue's workspace are rows naming no workspace, and two readable workspaces hold the key), less the keys an
 *  open item already carries. `settle`: the open items once no waiting issue of their key is team-ambiguous or unmeasured; none
 *  while the routing is unread, so an item never settles on unmeasured. */
export function sharedKeyItemVerdict(
  verdicts: readonly { teamKey: string; owner: TeamOwner }[], open: readonly { id: number; teamKey: string }[], routesRead: boolean,
): { raise: string[]; settle: number[] } {
  const up = (k: string): string => k.toUpperCase();
  const ambiguous = new Set(verdicts.filter((v) => v.owner.kind === 'none' && v.owner.reason === 'team-ambiguous').map((v) => up(v.teamKey)));
  const unsettled = new Set([...ambiguous, ...verdicts.filter((v) => v.owner.kind === 'unmeasured').map((v) => up(v.teamKey))]);
  const carried = new Set(open.map((i) => up(i.teamKey)));
  return {
    raise: [...ambiguous].filter((k) => !carried.has(k)).sort(),
    settle: routesRead ? open.filter((i) => !unsettled.has(up(i.teamKey))).map((i) => i.id) : [],
  };
}

/** The projects the shared-key item names: the rows holding the key that name no workspace, sorted. */
export const sharedKeyProjects = (team: string, rows: readonly HierarchyProjectFacts[]): string[] =>
  teamHolders(team, rows).filter((r) => r.workspaceId == null).map((r) => r.project).sort();

// ── The inbound path's bodies and verdict (Task 4.3) ──

export interface PlanTriageBody {
  issue: string; decision: TriageDecision; programme?: string; epic?: string; checkpoint?: string; reason?: string; note?: string;
}
/** `plan triage`: the issue's identifier and one decision. `hand` needs the programme (its optional `epic` and `checkpoint` are
 *  required by the route only when the programme is the owner's own, D-8706); `close` needs the reason. */
export function parsePlanTriage(body: unknown): { ok: true; triage: PlanTriageBody } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['issue', 'decision', 'programme', 'epic', 'checkpoint', 'reason', 'note'], 'body');
  if (x) return verbBad(x);
  if (!isLinearIdentifier(body.issue)) return verbBad('issue is not a Linear issue identifier');
  const { decision } = body;
  if (typeof decision !== 'string' || !(TRIAGE_DECISIONS as readonly string[]).includes(decision)) return verbBad('decision is not hand, upkeep, close or raise');
  const out: PlanTriageBody = { issue: body.issue, decision: decision as TriageDecision };
  for (const k of ['programme', 'epic', 'checkpoint'] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (!isPlanKey(v)) return verbBad(`${k} is not a plan key`);
    out[k] = v;
  }
  for (const k of ['reason', 'note'] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (!textOk(v, PLAN_BOUNDS.reasonChars, false)) return verbBad(`${k} is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
    out[k] = v;
  }
  if (out.decision === 'hand' && out.programme === undefined) return verbBad('a hand names the programme');
  if (out.decision === 'close' && out.reason === undefined) return verbBad('a close needs a reason');
  return { ok: true, triage: out };
}

export type PlanTakeBody =
  | { issue: string; epic: string; checkpoint?: string }
  | { issue: string; close: { why: string } }
  | { issue: string; return: { note: string } };
/** `plan take`: the issue and exactly one arm: an epic (and optionally a checkpoint) to take it into, a close with a why, or a
 *  return with a note. */
export function parsePlanTake(body: unknown): { ok: true; take: PlanTakeBody } | VerbBad {
  if (!isObj(body)) return verbBad('the body is not an object');
  const x = closed(body, ['issue', 'epic', 'checkpoint', 'close', 'return'], 'body');
  if (x) return verbBad(x);
  if (!isLinearIdentifier(body.issue)) return verbBad('issue is not a Linear issue identifier');
  const arms = (['epic', 'close', 'return'] as const).filter((k) => body[k] !== undefined);
  if (arms.length !== 1) return verbBad('a take names exactly one of epic, close or return');
  if (body.checkpoint !== undefined && arms[0] !== 'epic') return verbBad('checkpoint goes with epic');
  const issue = body.issue;
  if (arms[0] === 'epic') {
    if (!isPlanKey(body.epic)) return verbBad('epic is not a plan key');
    if (body.checkpoint !== undefined && !isPlanKey(body.checkpoint)) return verbBad('checkpoint is not a plan key');
    return { ok: true, take: { issue, epic: body.epic, ...(body.checkpoint === undefined ? {} : { checkpoint: body.checkpoint as string }) } };
  }
  const arm = body[arms[0]!];
  const field = arms[0] === 'close' ? 'why' : 'note';
  if (!isObj(arm)) return verbBad(`${arms[0]} is not an object`);
  const ax = closed(arm, [field], arms[0]!);
  if (ax) return verbBad(ax);
  const text = arm[field];
  if (!textOk(text, PLAN_BOUNDS.reasonChars, false) || text.trim() === '') return verbBad(`${field} is not 1 to ${PLAN_BOUNDS.reasonChars} characters`);
  return { ok: true, take: arms[0] === 'close' ? { issue, close: { why: text } } : { issue, return: { note: text } } };
}

/** `plan triage`'s lookup (D-8808): the workspaces whose inbound row under the identifier the route reads — each holder's resolved
 *  workspace, every workspace the listing could not read, every slot listing the key while an unpinned holder's routing is unmeasured,
 *  and each pinned holder's workspace whose routing is unmeasured (a stored pin can name an unmeasured legacy workspace). With no
 *  workspace candidate it answers `[null]`: an identifier unique across workspaces. `team` must be upper-cased, as the route
 *  passes it: a slot's `teamKeys`, upper-cased when listed, are compared to it exactly. */
export function triageLookup(
  team: string, rows: readonly HierarchyProjectFacts[], ws: ReadonlyMap<string, string | null>, routes: TeamRoutes | null,
): readonly (string | null)[] {
  const holders = teamHolders(team, rows);
  const unpinnedUnmeasured = holders.some((r) => r.workspaceId == null)
    && measuredProjectTeam(routes, { teamKey: team, workspaceId: null }).kind === 'unmeasured';
  const where = [...new Set([
    ...holders.map((r) => ws.get(r.project)).filter((w): w is string => w != null),
    ...(routes?.unreadableWorkspaces ?? []),
    ...(unpinnedUnmeasured ? (routes?.slots ?? []).filter((s) => s.teamKeys.includes(team)).map((s) => s.workspaceId) : []),
    ...holders.flatMap((r) => r.workspaceId != null && routes !== null
      && measuredProjectTeam(routes, { teamKey: team, workspaceId: r.workspaceId }).kind === 'unmeasured' ? [r.workspaceId] : []),
  ])];
  return where.length === 0 ? [null] : where;
}

/** `plan triage`'s row choice (D-8808): among the rows the lookup found for the key, the one whose owner in its own workspace is the caller,
 *  else one the caller may own while that ownership is unmeasured, else the first; with none, the key-only diagnostic, which can never
 *  authorize a read or write. */
export function triageChoice<R extends Pick<InboundRow, 'teamKey' | 'workspaceId'>>(
  team: string, caller: string, found: readonly R[], rows: readonly HierarchyProjectFacts[], f: OwnerReads, routes: TeamRoutes | null,
): { row: R | null; owner: TeamOwner } {
  const each = found.filter((r) => r.teamKey.toUpperCase() === team.toUpperCase())
    .map((row) => ({ row, owner: linearOwnerOfTeam(team, rows, f, row.workspaceId, routes) }));
  return each.find((x) => x.owner.kind === 'owner' && x.owner.id === caller)
    ?? each.find((x) => x.owner.kind === 'unmeasured' && x.owner.possibleIds.includes(caller))
    ?? each[0] ?? { row: null, owner: teamOwnerDiagnostic(team, rows, f) };
}

/** Who may triage which issue: only the team's Linear owner (`not-linear-owner`, judged first), and only an issue that is
 *  inbound and still waiting or mailed (`issue-not-inbound`). When workspace ownership is unmeasured, the key-only owner
 *  can learn the retry word, but that diagnostic can never authorize an act. */
export function triageVerdict(
  caller: string, owner: { id: string | null }, row: Pick<InboundRow, 'state'> | null, possibleOwnerIds: readonly string[] = [],
): { ok: true } | { ok: false; word: 'not-linear-owner' | 'issue-not-inbound' | 'unreachable' } {
  if (owner.id !== caller) return { ok: false, word: possibleOwnerIds.includes(caller) ? 'unreachable' : 'not-linear-owner' };
  if (row === null || (row.state !== 'waiting' && row.state !== 'mailed')) return { ok: false, word: 'issue-not-inbound' };
  return { ok: true };
}

/** The Linear ids of a workspace that are ccrc's own (round 5 F2, round 6 P1; D-8183): every id a binding holds, and for each
 *  `pending` TICKET binding the id its create was sent with (`requestIdOf`), since a create whose reply was lost sits in Linear
 *  with no `linearId` on its binding yet. The ONE function that builds the set: the inbound lane's `detect` and the store's
 *  two inbound composites both ask it, so an issue ccrc made is never read as inbound and never bound a second time. */
export function ccrcIssueIds(bindings: ReadonlyArray<Pick<BindingRow, 'localKind' | 'localId' | 'workspaceId' | 'state' | 'linearId'>>): Set<string> {
  const ids = new Set<string>();
  for (const b of bindings) {
    if (b.linearId !== null) ids.add(b.linearId);
    if (b.localKind === 'ticket' && b.state === 'pending') ids.add(requestIdOf('ticket', b.localId, b.workspaceId));
  }
  return ids;
}

/** `plan take`'s choice among the rows handed to a programme under one identifier (review 2457 F2, round 4 A2): the only row, else
 *  the one of the programme home's workspace; when the home does not decide (no home, or a workspace no row holds), none is chosen,
 *  never a guess. */
export function handedRowOf<R extends Pick<InboundRow, 'workspaceId'>>(rows: readonly R[], homeWorkspace: string | null): R | null {
  if (rows.length === 1) return rows[0]!;
  return homeWorkspace === null ? null : rows.find((x) => x.workspaceId === homeWorkspace) ?? null;
}

/** An inbound issue's reporter text, cut visibly to the plan's ticket bounds before it is stored (D-8705): the title to
 *  `PLAN_BOUNDS.titleChars` code points, the body to `PLAN_BOUNDS.bodyBytes` UTF-8 bytes, never splitting a code point. A
 *  title's cut ends with `…`; a body's cut ends with a line holding `…`. Text inside its bound is returned unchanged. */
export function fitInboundText(title: string, body: string | null): { title: string; body: string | null } {
  const cps = [...title];
  const fitTitle = cps.length <= PLAN_BOUNDS.titleChars ? title : `${cps.slice(0, PLAN_BOUNDS.titleChars - 1).join('')}\u2026`;
  if (body === null || Buffer.byteLength(body, 'utf8') <= PLAN_BOUNDS.bodyBytes) return { title: fitTitle, body };
  const tail = '\n\u2026';
  const room = PLAN_BOUNDS.bodyBytes - Buffer.byteLength(tail, 'utf8');
  let out = '';
  let used = 0;
  for (const ch of body) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (used + n > room) break;
    out += ch;
    used += n;
  }
  return { title: fitTitle, body: out + tail };
}
