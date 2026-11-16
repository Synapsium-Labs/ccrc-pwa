/**
 * THE PLAN SYNC'S DECIDERS (D-8182; Linear hierarchy design 2026-11-10 §5.2, §5.3, §6.1, §6.2, §9): from one snapshot of
 * a programme (its plan, its bindings, each workspace's directory and each project's settings) to the steps the pass
 * sends, in §5.2's order. L1 POLICY: pure and total, no I/O. The snapshot builder and the pass are Task 3.2's.
 *
 * ONE WRITER PER FACT. The fingerprint of a managed object is F(the fields ccrc writes to it); the binding stores it, and
 * a step is emitted only when it differs. A `failed` binding emits nothing for itself or anything under it; the pass
 * reads `failedInputs` to see that a changed plan changed what that binding would send.
 */
import { createHash } from 'node:crypto';
import type { BindingKind, EpicState, PlanEndOutcome, TicketState } from '../../../shared/plan.js';
import type { LinkingMode } from '../../../shared/linking.js';
import { redactShapedCount } from '../coord/redact.js';
import { publicTextVerdict, ticketRefOfBranch } from '../linking/policy.js';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, TicketRow } from '../coord/planStore.js';
import { LINEAR_INITIATIVE_STATUSES, withCcrcProvenance, type CcrcOpInput, type CcrcOpName, type LinearInitiativeStatus } from './hierarchyOps.js';
import { statusOfType, type LinearDirectoryEntries } from './ops.js';

/** A project's name is at most 80 characters in Linear (R4); an epic's title allows 255. */
export const LINEAR_PROJECT_NAME_MAX_CHARS = 80;

// ── The snapshot ──

export interface SyncSnapshot {
  program: {
    slug: string; /** The `programs` row's rowid: the key of the programme's own bindings (C6). */ rowid: number; title: string;
    end: { outcome: PlanEndOutcome; why: string | null; at: number } | null; inShort: string | null;
    doneWhen: { text: string; proved: boolean }[];
    /** The programme reads `paused` (§5.3): the initiative's description notes it, its status unchanged. */
    paused?: boolean;
  };
  plan: StoredPlan;
  bindings: BindingRow[];
  workspaces: {
    workspaceId: string; initiatives: 'on' | 'off' | 'unknown'; directory: LinearDirectoryEntries | null;
    /** The slot's learned teams (C3): the one place team ids live. */
    teams: { id: string; key: string }[];
  }[];
  projects: { project: string; teamKey: string | null; workspaceId: string | null; mode: LinkingMode; initiatives: 'on' | 'off' }[];
  /** The installer's private tracker keys, for the public-text check. */
  privateTrackerKeys: string[];
  /** D-8182 (§5.6): the pull request each ticket's run opened, by ticket id (the sync builds the URL from the project's
   *  measured repository): the issue is linked to it unless the branch already carries the issue's identifier, in which
   *  case Linear's own GitHub integration links it. Absent: no PR is known. */
  ticketPrs?: Record<number, { url: string; number: number; branch: string | null }>;
}

export type SkipWhy = 'initiatives-off' | 'no-team-key' | 'status-missing' | 'workspace-mismatch' | 'ticket-workspace-mismatch' | 'text-public';
export type Local = { kind: BindingKind; id: number };
/** How a create that may have been sent is recovered (C2). */
export type Recover = 'name-and-creator' | 'name-in-project' | 'request-id';

interface StepBase { local: Local; workspaceId: string; teamKey: string | null; /** F(planned inputs, team key and workspace): what a `failed` binding stores. */ inputs: string }
export type SyncStep =
  | (StepBase & { kind: 'create'; op: CcrcOpName; bindingId: number | null; input: CcrcOpInput; fields: string[]; requestId: string; recover: Recover; fingerprint: string })
  | (StepBase & {
    kind: 'update'; op: CcrcOpName; bindingId: number; input: CcrcOpInput; fields: string[]; fingerprint: string;
    /** An issue update: the state TYPE the plan wants (C12: the pass reads Linear's before it sends a state). */
    stateType?: string;
    /** A cancel's comment, sent once BEFORE the update that cancels (C13); the update writes the fingerprint after its ok. */
    comment?: { requestId: string; body: string };
  })
  | (StepBase & { kind: 'link'; op: 'initiativeToProjectCreate' | 'issueLink'; bindingId: number; input: CcrcOpInput; fields: string[]; requestId: string; fingerprint: string })
  | { kind: 'skip'; local: Local; why: SkipWhy; workspaceId: string | null; bindingId: number | null; inputs: string | null; detail: string | null };
export type SkipStep = Extract<SyncStep, { kind: 'skip' }>;
export interface FailedInputs { bindingId: number; inputs: string }
/** What the pass tells the coordinator beyond a step: a programme ended `done` with issues still open (§5.4). */
export type SyncNotice = { kind: 'open-issues-left'; count: number };

// ── Fingerprints and ids ──

const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
  : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

/** The first 16 hex of sha256 over the canonical JSON (keys sorted at every depth). */
export function plannedFingerprint(fields: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(JSON.stringify(canon(fields))).digest('hex').slice(0, 16);
}

/** A v4-shaped UUID from sha256(`<kind>:<localId>:<workspaceId>`), with `:<part>` appended for a part (C5). */
export function requestIdOf(kind: BindingKind, localId: number, workspaceId: string, part?: 'link' | 'cancel' | 'pr'): string {
  const hex = createHash('sha256').update(`${kind}:${localId}:${workspaceId}${part === undefined ? '' : `:${part}`}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) & 3]!;
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── Texts (§6.1) ──

const egress = (text: string): string => redactShapedCount('linear-egress', text).text;
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** A project name fitted to {@link LINEAR_PROJECT_NAME_MAX_CHARS} code points: cut, trailing whitespace trimmed, and when
 *  cut ending with `…` inside the bound (R4). The by-name bind compares the name as sent, so this is the one fitter. */
export function fitProjectName(name: string): string {
  const cps = [...egress(name)];
  if (cps.length <= LINEAR_PROJECT_NAME_MAX_CHARS) return cps.join('');
  return `${cps.slice(0, LINEAR_PROJECT_NAME_MAX_CHARS - 1).join('').trimEnd()}…`;
}

export function initiativeDescription(s: SyncSnapshot): string {
  const parts: string[] = [];
  if (s.program.inShort !== null && s.program.inShort !== '') parts.push(s.program.inShort);
  if (s.program.doneWhen.length > 0) parts.push(['Done when:', ...s.program.doneWhen.map((d) => `- [${d.proved ? 'x' : ' '}] ${d.text}`)].join('\n'));
  const end = s.program.end;
  if (end !== null && end.outcome === 'abandoned') parts.push(`Abandoned on ${dayOf(end.at)}: ${end.why ?? ''}`.trimEnd());
  if (s.program.paused === true) parts.push('Paused: this programme is paused in ccrc.');
  return withCcrcProvenance(egress(parts.join('\n\n')));
}

export function projectDescription(epic: EpicRow & { checkpoints: CheckpointRow[] }, programmeTitle: string, initiativesOff: boolean): string {
  const parts = [epic.summary];
  if (initiativesOff) parts.push(`Part of ${programmeTitle}.`);
  if (epic.state === 'dropped' && epic.droppedWhy !== null) parts.push(`Dropped: ${epic.droppedWhy}`);
  if (epic.checkpoints.length > 0) {
    parts.push(epic.checkpoints.map((c) => `- [${c.state === 'met' ? 'x' : ' '}] ${c.title}${c.state === 'dropped' ? ' (dropped)' : ''}`).join('\n'));
  }
  return withCcrcProvenance(egress(parts.join('\n\n')));
}

const evidenceText = (e: CheckpointRow['evidence']): string => e === null ? '' : 'pr' in e ? `PR #${e.pr}` : 'itemId' in e ? `item #${e.itemId}` : e.path;

export function milestoneDescription(cp: CheckpointRow): string {
  const parts = [`Kind: ${cp.kind}`];
  if (cp.state === 'dropped') parts.push(`Dropped: ${cp.droppedWhy ?? ''}`.trimEnd());
  if (cp.state === 'met' && cp.metAt !== null) parts.push(`Met on ${dayOf(cp.metAt)}: ${evidenceText(cp.evidence)}`.trimEnd());
  return withCcrcProvenance(egress(parts.join('\n\n')));
}

export function issueText(ticket: TicketRow): string { return withCcrcProvenance(egress(ticket.body)); }

// ── The deciders ──

const PROJECT_STATUS_TYPE = { planned: 'planned', active: 'started', done: 'completed', dropped: 'canceled' } as const;
const ISSUE_STATE_TYPE = { open: 'unstarted', started: 'started', done: 'completed', dropped: 'canceled' } as const;
const INITIATIVE: Readonly<Record<'planned' | 'active' | 'completed' | 'canceled', LinearInitiativeStatus>> = {
  planned: LINEAR_INITIATIVE_STATUSES[1], active: LINEAR_INITIATIVE_STATUSES[2],
  completed: LINEAR_INITIATIVE_STATUSES[3], canceled: LINEAR_INITIATIVE_STATUSES[4],
};

type Fact = SyncSnapshot['projects'][number];
type Place = { ok: true; fact: Fact; workspaceId: string; teamKey: string; teamId: string; ws: SyncSnapshot['workspaces'][number] } | { ok: false };

/** The workflow status id of `type` for a project (`kind: 'project'`) or a team's issues. */
const statusId = (dir: LinearDirectoryEntries | null, kind: 'project' | 'issue', type: string, teamKey: string | null): string | null =>
  dir === null ? null : (statusOfType(dir, kind, type, teamKey)?.id ?? null);

export function planSyncSteps(s: SyncSnapshot): { steps: SyncStep[]; failedInputs: FailedInputs[]; notices: SyncNotice[] } {
  const phases: SyncStep[][] = [[], [], [], [], [], [], []]; // creates: initiative, project, milestone, issue; updates; links
  const failedInputs: FailedInputs[] = [];
  const notices: SyncNotice[] = [];
  const bindingOf = (kind: BindingKind, id: number, ws: string): BindingRow | undefined =>
    s.bindings.find((b) => b.localKind === kind && b.localId === id && b.workspaceId === ws);
  const factOf = (project: string): Fact | undefined => s.projects.find((p) => p.project === project);
  const placeOf = (project: string): Place => {
    const fact = factOf(project);
    if (fact === undefined || fact.teamKey === null || fact.workspaceId === null) return { ok: false };
    const ws = s.workspaces.find((w) => w.workspaceId === fact.workspaceId);
    const team = ws?.teams.find((t) => t.key.toLowerCase() === fact.teamKey!.toLowerCase());
    return ws === undefined || team === undefined ? { ok: false } : { ok: true, fact, workspaceId: ws.workspaceId, teamKey: fact.teamKey, teamId: team.id, ws };
  };
  const textRefusal = (texts: string[], facts: { teamKey: string | null; mode: LinkingMode }[]): string | null => {
    const text = texts.join('\n');
    for (const f of facts) {
      const v = publicTextVerdict(text, f.teamKey, f.mode, s.privateTrackerKeys);
      if (!v.ok) return v.class;
    }
    return null;
  };

  interface Decide {
    phase: number; kind: BindingKind; id: number; workspaceId: string; teamKey: string | null; op: { create: CcrcOpName; update: CcrcOpName };
    b: BindingRow | undefined; ready: boolean; statusMissing: boolean; texts: string[]; facts: Fact[];
    planned: Record<string, unknown>; fp: string; isCurrent: (stored: string | null) => boolean;
    create: () => { input: CcrcOpInput; fields: string[] };
    update: (linearId: string) => { input: CcrcOpInput; fields: string[]; extras?: { stateType?: string; comment?: { requestId: string; body: string } } };
    recover: Recover; link?: () => SyncStep | null;
  }
  const decide = (d: Decide): void => {
    const local: Local = { kind: d.kind, id: d.id };
    const inputs = plannedFingerprint({ ...d.planned, teamKey: d.teamKey, workspaceId: d.workspaceId });
    if (d.b?.state === 'failed') { failedInputs.push({ bindingId: d.b.id, inputs }); return; }
    if (!d.ready) return;
    const base = { local, workspaceId: d.workspaceId, teamKey: d.teamKey, inputs };
    const skip = (why: SkipWhy, detail: string | null = null): void => {
      phases[d.phase]!.push({ kind: 'skip', local, why, workspaceId: d.workspaceId, bindingId: d.b?.id ?? null, inputs, detail });
    };
    const bound = d.b?.state === 'bound' && d.b.linearId !== null;
    if (bound && d.link !== undefined) { const l = d.link(); if (l !== null) { phases[5]!.push(l); return; } }
    if (bound && d.isCurrent(d.b!.fingerprint)) return;
    if (d.statusMissing) { skip('status-missing'); return; }
    const refused = textRefusal(d.texts, d.facts);
    if (refused !== null) { skip('text-public', refused); return; }
    if (bound) {
      const u = d.update(d.b!.linearId!);
      phases[4]!.push({ ...base, kind: 'update', op: d.op.update, bindingId: d.b!.id, input: u.input, fields: u.fields, fingerprint: d.fp, ...u.extras });
    } else {
      const requestId = requestIdOf(d.kind, d.id, d.workspaceId);
      const c = d.create();
      phases[d.phase]!.push({ ...base, kind: 'create', op: d.op.create, bindingId: d.b?.id ?? null, input: { requestId, ...c.input }, fields: c.fields, requestId, recover: d.recover, fingerprint: d.fp });
    }
  };

  // ── The programme's end (§5.4): what an epic and a ticket are for Linear once the programme has ended. `programs.state` is
  // never read for it (D-51 sets it at every wave gap): only the snapshot's `end`.
  const end = s.program.end;
  const endDay = end === null ? '' : dayOf(end.at);
  interface Eff { state: EpicState; why: string | null; by: 'own' | 'abandon' }
  const effEpic = (e: EpicRow): Eff => {
    if (e.state === 'dropped') return { state: 'dropped', why: e.droppedWhy, by: 'own' };
    if (end === null || e.state === 'done') return { state: e.state, why: null, by: 'own' };
    return end.outcome === 'done' ? { state: 'done', why: null, by: 'own' }
      : { state: 'dropped', why: `Abandoned on ${endDay}: ${end.why ?? ''}`.trimEnd(), by: 'abandon' };
  };
  /** A ticket's state for Linear and the line its cancel comment carries: a dropped one, one of a dropped epic or one of an
   *  abandoned programme (an open one) is canceled; a `done` ticket stays completed; a `done` programme leaves open ones as they are. */
  const effTicket = (eff: Eff, t: TicketRow): { state: TicketState; comment: string | null } => {
    if (t.state === 'dropped') return { state: 'dropped', comment: `Dropped: ${t.droppedWhy ?? ''}`.trimEnd() };
    if (t.state === 'done' || eff.state !== 'dropped') return { state: t.state, comment: null };
    return { state: 'dropped', comment: eff.by === 'abandon' ? `Canceled: ${eff.why ?? ''}`.trimEnd() : `Canceled: its epic was dropped: ${eff.why ?? ''}`.trimEnd() };
  };
  const hasEpicBinding = (e: EpicRow): boolean => s.bindings.some((b) => b.localKind === 'epic' && b.localId === e.id);
  const effs = new Map<number, Eff>(s.plan.epics.map((e) => [e.id, effEpic(e)]));
  const places = new Map<number, Place>();
  // An epic nothing was ever created for stays uncreated when its programme's end would close it at once.
  const placed = s.plan.epics.filter((e) => e.state !== 'dropped' || hasEpicBinding(e));
  const liveEpics = placed.filter((e) => hasEpicBinding(e) || effs.get(e.id)!.state === e.state);
  if (end !== null && end.outcome === 'done') {
    const left = s.plan.epics.flatMap((e) => e.tickets).filter((t) => (t.state === 'open' || t.state === 'started') && s.bindings.some((b) => b.localKind === 'ticket' && b.localId === t.id)).length;
    if (left > 0) notices.push({ kind: 'open-issues-left', count: left });
  }
  for (const e of placed) places.set(e.id, placeOf(e.project));

  // ── 1. initiatives: one per workspace the epics sit in
  const wsIds = [...new Set([...places.values()].flatMap((p) => (p.ok ? [p.workspaceId] : [])))];
  const anyEpicState = (st: string): boolean => s.plan.epics.some((e) => e.state === st);
  const initiativeStatus: LinearInitiativeStatus = s.program.end !== null
    ? (s.program.end.outcome === 'done' ? INITIATIVE.completed : INITIATIVE.canceled)
    : anyEpicState('active') || anyEpicState('done') ? INITIATIVE.active : INITIATIVE.planned;
  const initiativeIdOf = new Map<string, string>();
  for (const wsId of wsIds) {
    const ws = s.workspaces.find((w) => w.workspaceId === wsId)!;
    const facts = [...places.values()].flatMap((p) => (p.ok && p.workspaceId === wsId ? [p.fact] : []));
    const b = bindingOf('programme', s.program.rowid, wsId);
    if (b?.state === 'bound' && b.linearId !== null) initiativeIdOf.set(wsId, b.linearId);
    const local: Local = { kind: 'programme', id: s.program.rowid };
    if (ws.initiatives === 'off' || !facts.some((f) => f.initiatives === 'on')) {
      phases[0]!.push({ kind: 'skip', local, why: 'initiatives-off', workspaceId: wsId, bindingId: b?.id ?? null, inputs: null, detail: null });
      continue;
    }
    if (ws.initiatives === 'unknown') continue;
    const planned = { name: egress(s.program.title), description: initiativeDescription(s), status: initiativeStatus };
    decide({
      phase: 0, kind: 'programme', id: s.program.rowid, workspaceId: wsId, teamKey: null, op: { create: 'initiativeCreate', update: 'initiativeUpdate' },
      b, ready: true, statusMissing: false, texts: [planned.name, planned.description], facts, planned, fp: plannedFingerprint(planned),
      isCurrent: (st) => st === plannedFingerprint(planned),
      create: () => ({ input: planned, fields: ['name', 'description', 'status'] }),
      update: (id) => ({ input: { id, ...planned }, fields: ['name', 'description', 'status'] }),
      recover: 'name-and-creator',
    });
  }

  // ── 2-4. projects, milestones, issues
  const epicProject = new Map<number, string>(); // epic id -> bound project linear id
  for (const e of liveEpics) {
    const pl = places.get(e.id)!;
    const eff = effs.get(e.id)!;
    if (!pl.ok) {
      if (eff.state !== 'dropped') phases[1]!.push({ kind: 'skip', local: { kind: 'epic', id: e.id }, why: 'no-team-key', workspaceId: null, bindingId: null, inputs: null, detail: null });
      continue;
    }
    const wsId = pl.workspaceId;
    const dir = pl.ws.directory;
    const pStatus = statusId(dir, 'project', PROJECT_STATUS_TYPE[eff.state], pl.teamKey);
    const off = pl.fact.initiatives === 'off' || pl.ws.initiatives === 'off';
    const initiativeId = pl.fact.initiatives === 'on' && pl.ws.initiatives !== 'off' ? (initiativeIdOf.get(wsId) ?? null) : null;
    const eb = bindingOf('epic', e.id, wsId);
    // An epic whose binding sits in another workspace than its project now resolves to: that binding fails, nothing is created
    // in the new workspace, and nothing under the epic is sent (the move is not ccrc's to make, §3).
    const elsewhere = s.bindings.filter((b) => b.localKind === 'epic' && b.localId === e.id && b.workspaceId !== wsId);
    if (eb === undefined && elsewhere.length > 0) {
      const inputs = plannedFingerprint({ epic: e.id, workspaceId: wsId, teamKey: pl.teamKey });
      for (const b of elsewhere) {
        if (b.state === 'failed') failedInputs.push({ bindingId: b.id, inputs });
        else phases[1]!.push({ kind: 'skip', local: { kind: 'epic', id: e.id }, why: 'workspace-mismatch', workspaceId: b.workspaceId, bindingId: b.id, inputs, detail: null });
      }
      continue;
    }
    // §5.2: the epic's team plus every team, in the same workspace, a ticket of the epic that is not dropped files into (C14).
    const teamIds = [...new Set([pl.teamId, ...e.tickets.flatMap((t) => {
      if (effTicket(eff, t).state === 'dropped') return [];
      const tp = placeOf(t.project);
      return tp.ok && tp.workspaceId === wsId ? [tp.teamId] : [];
    })])].sort();
    const planned = {
      name: fitProjectName(e.title), description: projectDescription({ ...e, state: eff.state, droppedWhy: eff.why }, s.program.title, off), statusId: pStatus, teamIds, initiativeId,
    };
    const fpFull = plannedFingerprint(planned);
    const fpNull = plannedFingerprint({ ...planned, initiativeId: null });
    decide({
      phase: 1, kind: 'epic', id: e.id, workspaceId: wsId, teamKey: pl.teamKey, op: { create: 'projectCreate', update: 'projectUpdate' },
      b: eb, ready: true, statusMissing: pStatus === null, texts: [planned.name, planned.description], facts: [pl.fact], planned,
      fp: fpNull, isCurrent: (st) => st === fpFull,
      create: () => ({ input: { name: planned.name, description: planned.description, statusId: pStatus, teamIds: planned.teamIds }, fields: ['name', 'description', 'status', 'teams'] }),
      update: (id) => ({ input: { id, name: planned.name, description: planned.description, statusId: pStatus, teamIds: planned.teamIds }, fields: ['name', 'description', 'status', 'teams'] }),
      link: () => {
        if (initiativeId === null || eb === undefined || eb.fingerprint !== fpNull || fpNull === fpFull) return null;
        const requestId = requestIdOf('epic', e.id, wsId, 'link');
        return {
          kind: 'link', op: 'initiativeToProjectCreate', local: { kind: 'epic', id: e.id }, workspaceId: wsId, teamKey: pl.teamKey, bindingId: eb.id,
          input: { requestId, initiativeId, projectId: eb.linearId! }, fields: ['project'], requestId, fingerprint: fpFull,
          inputs: plannedFingerprint({ ...planned, teamKey: pl.teamKey, workspaceId: wsId }),
        };
      },
      recover: 'name-and-creator',
    });
    if (eb?.state !== 'bound' || eb.linearId === null) continue;
    const projectId = eb.linearId;
    epicProject.set(e.id, projectId);

    const msIds = new Map<number, string>();
    for (const c of e.checkpoints) {
      const cb = bindingOf('checkpoint', c.id, wsId);
      if (c.state === 'dropped' && cb === undefined) continue;
      if (cb?.state === 'bound' && cb.linearId !== null) msIds.set(c.id, cb.linearId);
      const mp = {
        name: egress(c.title), description: milestoneDescription(c), targetDate: c.state === 'met' && c.metAt !== null ? dayOf(c.metAt) : null, sortOrder: c.ordinal,
      };
      decide({
        phase: 2, kind: 'checkpoint', id: c.id, workspaceId: wsId, teamKey: pl.teamKey, op: { create: 'projectMilestoneCreate', update: 'projectMilestoneUpdate' },
        b: cb, ready: true, statusMissing: false, texts: [mp.name, mp.description], facts: [pl.fact], planned: mp, fp: plannedFingerprint(mp),
        isCurrent: (st) => st === plannedFingerprint(mp),
        create: () => ({
          input: { projectId, name: mp.name, description: mp.description, sortOrder: mp.sortOrder, ...(mp.targetDate === null ? {} : { targetDate: mp.targetDate }) },
          fields: ['name', 'description', ...(mp.targetDate === null ? [] : ['targetDate']), 'project'],
        }),
        update: (id) => ({ input: { id, name: mp.name, description: mp.description, targetDate: mp.targetDate, sortOrder: mp.sortOrder }, fields: ['name', 'description', 'targetDate'] }),
        recover: 'name-in-project',
      });
    }

    for (const t of e.tickets) {
      const tb = bindingOf('ticket', t.id, wsId);
      const te = effTicket(eff, t);
      const tlocal: Local = { kind: 'ticket', id: t.id };
      const tpl = placeOf(t.project);
      // A binding in another workspace than the ticket's project resolves to now: it fails `ticket-workspace-mismatch`, once,
      // and nothing is created in the new workspace.
      const tElsewhere = s.bindings.filter((b) => b.localKind === 'ticket' && b.localId === t.id && b.workspaceId !== (tpl.ok ? tpl.workspaceId : wsId));
      if (tpl.ok && tb === undefined && tElsewhere.length > 0) {
        const inputs = plannedFingerprint({ ticket: t.id, workspaceId: tpl.workspaceId, teamKey: tpl.teamKey });
        for (const b of tElsewhere) {
          if (b.state === 'failed') failedInputs.push({ bindingId: b.id, inputs });
          else phases[3]!.push({ kind: 'skip', local: tlocal, why: 'ticket-workspace-mismatch', workspaceId: b.workspaceId, bindingId: b.id, inputs, detail: null });
        }
        continue;
      }
      if (te.state === 'dropped' && tb === undefined) continue;
      if (!tpl.ok) { phases[3]!.push({ kind: 'skip', local: tlocal, why: 'no-team-key', workspaceId: wsId, bindingId: tb?.id ?? null, inputs: null, detail: null }); continue; }
      if (tpl.workspaceId !== wsId) {
        const inputs = plannedFingerprint({ ticket: t.id, workspaceId: tpl.workspaceId, teamKey: tpl.teamKey });
        // A failed binding is told once: it reports its inputs (the requeue trigger) and emits no second skip, so `failedAt` stands.
        if (tb?.state === 'failed') failedInputs.push({ bindingId: tb.id, inputs });
        else phases[3]!.push({ kind: 'skip', local: tlocal, why: tb === undefined ? 'workspace-mismatch' : 'ticket-workspace-mismatch', workspaceId: wsId, bindingId: tb?.id ?? null, inputs, detail: null });
        continue;
      }
      const milestoneId = t.checkpointId === null ? null : (msIds.get(t.checkpointId) ?? null);
      const stateType = ISSUE_STATE_TYPE[te.state];
      const iStatus = statusId(tpl.ws.directory, 'issue', stateType, tpl.teamKey);
      const ip = {
        title: egress(t.title), description: issueText(t), teamId: tpl.teamId, stateId: iStatus, projectId, projectMilestoneId: milestoneId,
      };
      const cancelBody = te.comment === null ? null : withCcrcProvenance(egress(te.comment));
      // §5.6: the PR link rides on the bound issue; its URL enters the planned inputs only once the link was sent (the same
      // two-fingerprint mechanism as the project's initiative link, C4), so a sent link is never sent again.
      const pr = s.ticketPrs?.[t.id];
      const ident = tb?.state === 'bound' ? tb.identifier : null;
      const wantPr = pr !== undefined && ident !== null && ticketRefOfBranch(pr.branch ?? '', tpl.teamKey) !== ident.toUpperCase();
      const fpNull = plannedFingerprint(ip);
      const fpFull = wantPr ? plannedFingerprint({ ...ip, prUrl: pr.url }) : fpNull;
      decide({
        phase: 3, kind: 'ticket', id: t.id, workspaceId: wsId, teamKey: tpl.teamKey, op: { create: 'issueCreate', update: 'issueUpdate' },
        b: tb, ready: t.checkpointId === null || milestoneId !== null, statusMissing: iStatus === null, texts: [ip.title, ip.description, ...(cancelBody === null ? [] : [cancelBody])], facts: [tpl.fact],
        planned: ip, fp: fpNull, isCurrent: (st) => st === fpFull,
        link: () => {
          if (!wantPr || tb === undefined || tb.linearId === null || tb.fingerprint !== fpNull) return null;
          const requestId = requestIdOf('ticket', t.id, wsId, 'pr');
          return {
            kind: 'link', op: 'issueLink', local: tlocal, workspaceId: wsId, teamKey: tpl.teamKey, bindingId: tb.id,
            input: { requestId, issueId: tb.linearId, url: pr.url, title: `PR #${pr.number}` }, fields: ['url', 'title'], requestId, fingerprint: fpFull,
            inputs: plannedFingerprint({ ...ip, prUrl: pr.url, teamKey: tpl.teamKey, workspaceId: wsId }),
          };
        },
        create: () => ({
          input: { teamId: ip.teamId, title: ip.title, description: ip.description, stateId: iStatus, projectId, ...(milestoneId === null ? {} : { projectMilestoneId: milestoneId }) },
          fields: ['team', 'title', 'description', 'state', 'project', ...(milestoneId === null ? [] : ['milestone'])],
        }),
        update: (id) => ({
          input: { id, teamId: ip.teamId, title: ip.title, description: ip.description, stateId: iStatus, projectId, projectMilestoneId: milestoneId },
          fields: ['title', 'description', 'state', 'project', 'milestone', 'team'],
          extras: { stateType, ...(cancelBody === null ? {} : { comment: { requestId: requestIdOf('ticket', t.id, wsId, 'cancel'), body: cancelBody } }) },
        }),
        recover: 'request-id',
      });
    }
  }
  return { steps: phases.flat(), failedInputs, notices };
}
