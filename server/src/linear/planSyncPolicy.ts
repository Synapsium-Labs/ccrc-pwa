/**
 * THE PLAN SYNC'S DECIDERS (D-8182; Linear hierarchy design 2026-11-10 §5.2, §5.3, §6.1, §6.2, §9): from one snapshot of
 * a programme (its plan, its bindings, each workspace's directory and each project's settings) to the steps the pass
 * sends, in §5.2's order. L1 POLICY: pure and total, no I/O. The snapshot builder and the pass are Task 3.2's.
 *
 * ONE WRITER PER FACT. The fingerprint of a managed object is F(the fields ccrc writes to it); the binding stores it, and
 * a step is emitted only when it differs. A `failed` binding emits nothing for itself or anything under it; the pass
 * reads `failedInputs` to see that a changed plan changed what that binding would send. A project's link to its initiative and an
 * issue's link to its pull request ride the stored fingerprint as `<base>+<mark>` (`withLinkMark`, D-8183): no link row.
 */
import { createHash } from 'node:crypto';
import type { BindingKind, EpicState, PlanEndOutcome, TicketState } from '../../../shared/plan.js';
import type { LinkingMode } from '../../../shared/linking.js';
import { rfc8785Json } from '../canonical.js';
import { redactShapedCount } from '../coord/redact.js';
import { publicTextVerdict, ticketRefOfBranch } from '../linking/policy.js';
import type { RaiseItemInput } from '../coord/ledgersStore.js';
import { LINEAR_SYNC_PROGRAMME } from '../../../shared/plan.js';
import type { BindingRow, CheckpointRow, EpicRow, StoredPlan, SyncDeferral, TicketRow } from '../coord/planStore.js';
import { LINEAR_INITIATIVE_STATUSES, withCcrcProvenance, type CcrcOpInput, type CcrcOpName, type LinearInitiativeStatus } from './hierarchyOps.js';
import { statusOfType, type LinearDirectoryEntries } from './ops.js';
import type { DriftKind, OwnedFields } from './driftPolicy.js';

/** A project's name is at most 80 characters in Linear (R4); an epic's title allows 255. */
export const LINEAR_PROJECT_NAME_MAX_CHARS = 80;

// ── The snapshot ──

export interface SyncSnapshot {
  /** The programme the plan belongs to; null for a project's Upkeep epic (D-8183, the due key `upkeep:<project>`), which has no
   *  programme: no initiative step, no programme end, no "Part of" line and no notice. */
  program: {
    slug: string; /** The `programs` row's rowid: the key of the programme's own bindings (C6). */ rowid: number; title: string;
    end: { outcome: PlanEndOutcome; why: string | null; at: number } | null; inShort: string | null;
    doneWhen: { text: string; proved: boolean }[];
    /** The programme reads `paused` (§5.3): the initiative's description notes it, its status unchanged. */
    paused?: boolean;
  } | null;
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

interface StepBase {
  local: Local; workspaceId: string; teamKey: string | null; /** F(planned inputs, team key and workspace): what a `failed` binding stores. */ inputs: string;
  /** D-8707: a project step's planned teams' keys, all of them (the write policy is asked about each); absent on every other step. */
  teamKeys?: readonly string[];
}
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

/** Task 3.1 (F5 of fix round 1): the plan as the sync reads it: every epic, checkpoint and ticket whose `putBackAt` is set
 *  left out (a record *Put back* dropped, Task 2.2), so no step is ever emitted for one. Pure: the input is not changed. */
export function withoutPutBack(plan: StoredPlan): StoredPlan {
  return {
    ...plan,
    epics: plan.epics.filter((e) => e.putBackAt === null).map((e) => ({
      ...e, checkpoints: e.checkpoints.filter((c) => c.putBackAt === null), tickets: e.tickets.filter((t) => t.putBackAt === null),
    })),
  };
}

// ── Fingerprints and ids ──

/** What `rfc8785Json` refuses is a fact about the fields: an `undefined` member means "not sent", as `JSON.stringify` read it, so it is dropped here, at every depth, before the canonical writer sees the value. */
const withoutUndefined = (v: unknown): unknown => Array.isArray(v) ? v.map(withoutUndefined)
  : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, withoutUndefined(x)])) : v;

/** The first 16 hex of sha256 over the canonical JSON of `canonical.ts` (RFC 8785; keys sorted at every depth). */
export function plannedFingerprint(fields: Readonly<Record<string, unknown>>): string {
  const json = rfc8785Json(withoutUndefined(fields), (detail) => new Error(`plannedFingerprint: ${detail}`));
  return createHash('sha256').update(json, 'utf8').digest('hex').slice(0, 16);
}

/** D-8183 (carried items 8 and 9; D-8677's link-by-fingerprint, still no link row): a link made after a binding's last write rides
 *  its stored fingerprint, which reads `<base>` or `<base>+<mark>`: `<base>` is F(the planned fields without the link), `<mark>` is
 *  F({ link: <initiativeId> }) for a project's link to its initiative, F({ pr: <url> }) for an issue's pull request link. */
const LINK_MARK_SEPARATOR = '+';
/** A stored fingerprint: the base alone, or the base with the link's mark. */
export function withLinkMark(base: string, mark: string | null): string {
  return mark === null ? base : `${base}${LINK_MARK_SEPARATOR}${mark}`;
}
/** A stored fingerprint read back: its base and its mark (null: none, or no fingerprint at all). */
export function linkMarkOf(stored: string | null): { base: string | null; mark: string | null } {
  if (stored === null) return { base: null, mark: null };
  const i = stored.indexOf(LINK_MARK_SEPARATOR);
  return i < 0 ? { base: stored, mark: null } : { base: stored.slice(0, i), mark: stored.slice(i + 1) };
}

/** A v4-shaped UUID from sha256(`seed`): the one function every request id of ccrc's Linear writes is made by (D-8183). */
export function uuidOf(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16]!, 16) & 3]!;
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** A v4-shaped UUID from sha256(`<kind>:<localId>:<workspaceId>`), with `:<part>` appended for a part (C5). */
export function requestIdOf(kind: BindingKind, localId: number, workspaceId: string, part?: 'link' | 'cancel' | 'pr' | `restore-${string}`): string {
  return uuidOf(`${kind}:${localId}:${workspaceId}${part === undefined ? '' : `:${part}`}`);
}

// ── Texts (§6.1) ──

export const egress = (text: string): string => redactShapedCount('linear-egress', text).text;
const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** A project name fitted to {@link LINEAR_PROJECT_NAME_MAX_CHARS} code points: cut, trailing whitespace trimmed, and when
 *  cut ending with `…` inside the bound (R4). The by-name bind compares the name as sent, so this is the one fitter. */
export function fitProjectName(name: string): string {
  const cps = [...egress(name)];
  if (cps.length <= LINEAR_PROJECT_NAME_MAX_CHARS) return cps.join('');
  return `${cps.slice(0, LINEAR_PROJECT_NAME_MAX_CHARS - 1).join('').trimEnd()}…`;
}

/** A snapshot of a programme: `program` is there (an Upkeep epic's is null). */
export type ProgrammeSnapshot = SyncSnapshot & { program: NonNullable<SyncSnapshot['program']> };

/** Linear refuses an initiative's or a project's description over 255 characters (INVALID_INPUT, measured live
 *  2026-11-17; D-8708). Counted in UTF-16 units (JavaScript string length), which is never fewer than code points, so the
 *  bound holds if Linear counts either. Bytes were not measured: the cap's answer waits for the next capture (D-8708). */
export const LINEAR_DESCRIPTION_MAX_CHARS = 255;

/** D-8708: `body` (already through `linear-egress`, so the redactor never sees a cut text) with the ccrc provenance line,
 *  fitted to {@link LINEAR_DESCRIPTION_MAX_CHARS}. Trailing whitespace is trimmed first, so a body that already ends with
 *  the provenance line is measured as it is sent and the line is never doubled. The provenance line always survives
 *  whole: a body too long for both is cut at its END (never inside a surrogate pair), its trailing whitespace trimmed,
 *  and ended with `…`, so a builder puts what must survive (the status notes) first. A body that fits is returned as
 *  `withCcrcProvenance` gives it, so a bound object's fingerprint does not move. This is the planned description's one
 *  source: the fingerprint, the journal's fields and the update path all read its answer, so a binding that failed on an
 *  over-long description retries by itself once its planned input changes. The public-text gate judges the unfitted body
 *  as well as this answer (a name cut in two reaches the answer only as a prefix). The full text stays in ccrc's plan. */
export function fitLinearDescription(body: string): string {
  const text = body.trimEnd();
  const whole = withCcrcProvenance(text);
  if (whole.length <= LINEAR_DESCRIPTION_MAX_CHARS) return whole;
  const room = LINEAR_DESCRIPTION_MAX_CHARS - withCcrcProvenance('…').length;
  const high = text.charCodeAt(room - 1);
  const cut = text.slice(0, high >= 0xd800 && high <= 0xdbff ? room - 1 : room);
  return withCcrcProvenance(`${cut.trimEnd()}…`);
}

/** The initiative's description before the fit (through `linear-egress`): what the public-text gate judges besides the
 *  fitted text. D-8708: the status notes come first (Abandoned, then Paused), then In short, then the done-when list, so
 *  the fit's cut at the end never takes a note. */
export function initiativeBody(s: ProgrammeSnapshot): string {
  const parts: string[] = [];
  const end = s.program.end;
  if (end !== null && end.outcome === 'abandoned') parts.push(`Abandoned on ${dayOf(end.at)}: ${end.why ?? ''}`.trimEnd());
  if (s.program.paused === true) parts.push('Paused: this programme is paused in ccrc.');
  if (s.program.inShort !== null && s.program.inShort !== '') parts.push(s.program.inShort);
  if (s.program.doneWhen.length > 0) parts.push(['Done when:', ...s.program.doneWhen.map((d) => `- [${d.proved ? 'x' : ' '}] ${d.text}`)].join('\n'));
  return egress(parts.join('\n\n'));
}

export function initiativeDescription(s: ProgrammeSnapshot): string { return fitLinearDescription(initiativeBody(s)); }

/** The project's description before the fit. D-8708: the notes come first (Dropped, then "Part of"), then the summary,
 *  then the checkpoint list. */
export function projectBody(epic: EpicRow & { checkpoints: CheckpointRow[] }, programmeTitle: string, initiativesOff: boolean): string {
  const parts: string[] = [];
  if (epic.state === 'dropped' && epic.droppedWhy !== null) parts.push(`Dropped: ${epic.droppedWhy}`);
  if (initiativesOff) parts.push(`Part of ${programmeTitle}.`);
  parts.push(epic.summary);
  if (epic.checkpoints.length > 0) {
    parts.push(epic.checkpoints.map((c) => `- [${c.state === 'met' ? 'x' : ' '}] ${c.title}${c.state === 'dropped' ? ' (dropped)' : ''}`).join('\n'));
  }
  return egress(parts.join('\n\n'));
}

export function projectDescription(epic: EpicRow & { checkpoints: CheckpointRow[] }, programmeTitle: string, initiativesOff: boolean): string {
  return fitLinearDescription(projectBody(epic, programmeTitle, initiativesOff));
}

const evidenceText = (e: CheckpointRow['evidence']): string => e === null ? '' : 'pr' in e ? `PR #${e.pr}` : 'itemId' in e ? `item #${e.itemId}` : e.path;

/** The milestone's description before the fit: Kind first, then the notes. D-8708 fits it too, as insurance: a dropped
 *  checkpoint's reason may reach 500 characters, and no limit of Linear's on it is recorded. */
export function milestoneBody(cp: CheckpointRow): string {
  const parts = [`Kind: ${cp.kind}`];
  if (cp.state === 'dropped') parts.push(`Dropped: ${cp.droppedWhy ?? ''}`.trimEnd());
  if (cp.state === 'met' && cp.metAt !== null) parts.push(`Met on ${dayOf(cp.metAt)}: ${evidenceText(cp.evidence)}`.trimEnd());
  return egress(parts.join('\n\n'));
}

export function milestoneDescription(cp: CheckpointRow): string { return fitLinearDescription(milestoneBody(cp)); }

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

/** What the deciders answer: the steps in §5.2's order, the inputs of each failed binding, the coordinator's notices, and
 *  `waits`: the workspaces whose initiative step waits for the probe to answer (it reads `unknown`), so the pass keeps the
 *  programme due and asks the refresher again rather than settle without it. */
export interface SyncDecision { steps: SyncStep[]; failedInputs: FailedInputs[]; notices: SyncNotice[]; waits: string[]; owned: PlannedOwned[] }

/** D-8183 (§6.2): what the plan says a bound object's owned fields are, in Linear's terms, as the same computation that decides
 *  the sync's steps (one computation, never a second copy of the rules): the drift pass compares Linear's copy against it.
 *  `current` is whether the binding's stored fingerprint is the plan's current one (`isCurrent`): when it is not, a difference
 *  is the sync not having written the plan yet, a catch-up (D-8704). One entry per `bound` binding with a Linear id that is ready
 *  to be sent: never a `failed` or a `pending` one. */
export interface PlannedOwned { bindingId: number; kind: DriftKind; local: Local; owned: OwnedFields; current: boolean }

/** The public-text check of one write's texts (§6.1), the ONE place a sync step's text is judged: the class that refused it, or null.
 *  Every project fact that speaks for the object is asked, a `public` or `unknown` one with its team key. The sync's steps and the
 *  drift restore's comment (review 2457 F3) both come here. */
export function textRefusalOf(texts: readonly string[], facts: readonly { teamKey: string | null; mode: LinkingMode }[], privateKeys: readonly string[]): string | null {
  const text = texts.join('\n');
  for (const f of facts) {
    const v = publicTextVerdict(text, f.teamKey, f.mode, privateKeys);
    if (!v.ok) return v.class;
  }
  return null;
}

/** Review 2834 F1, the ONE writer of "a team no project claims is judged as `unknown`, public" (design §6.1): the project fact
 *  `textRefusalOf` reads for one issue's text. `owner` is the owning project's linking reading (its team key and mode), or null
 *  when no project claims the issue's team; then the fact is the issue's own team with mode `unknown`, which is public. The plan
 *  routes' door and the inbound lane's act-time check both come here, so they never disagree on an unowned team. */
export function textFactOfTeam(owner: { teamKey: string | null; mode: LinkingMode } | null, issueTeam: string | null): { teamKey: string | null; mode: LinkingMode } {
  return owner ?? { teamKey: issueTeam, mode: 'unknown' };
}

/** The project facts that speak for a binding's text (review 2457 F3): a ticket's and an epic's own project; an initiative's, every
 *  epic's of the plan (the strictest reading: the one fact set `planSyncSteps` picks per workspace is a subset of it); a checkpoint's
 *  epic's. A project the snapshot does not describe is judged as `unknown`, public (§6.1), with the binding's own team. */
export function textFactsOf(s: Pick<SyncSnapshot, 'plan' | 'projects'>, b: Pick<BindingRow, 'localKind' | 'localId' | 'teamKey'>): { teamKey: string | null; mode: LinkingMode }[] {
  const unknown = { teamKey: b.teamKey, mode: 'unknown' } as const;
  const factOf = (project: string): { teamKey: string | null; mode: LinkingMode } => s.projects.find((p) => p.project === project) ?? unknown;
  const epics = s.plan.epics;
  const projects: string[] = b.localKind === 'programme' ? epics.map((e) => e.project)
    : b.localKind === 'epic' ? epics.filter((e) => e.id === b.localId).map((e) => e.project)
      : b.localKind === 'checkpoint' ? epics.filter((e) => e.checkpoints.some((c) => c.id === b.localId)).map((e) => e.project)
        : epics.flatMap((e) => e.tickets.filter((t) => t.id === b.localId).map((t) => t.project));
  const facts = [...new Set(projects)].map(factOf);
  return facts.length > 0 ? facts : [unknown];
}

/** `opts.force` (the drift restore, Task 4.2): a binding id in it is treated as NOT current, so its absolute update is emitted
 *  though its fingerprint is current, and a forced project whose initiative is live also emits its link step, under a requestId
 *  of the map's tag (`restore-<tag>`), so a link deleted in Linear is made again instead of answered `conflict` by its old id. */
export function planSyncSteps(s: SyncSnapshot, opts: { force?: ReadonlyMap<number, string> } = {}): SyncDecision {
  const force = opts.force ?? new Map<number, string>();
  const owned: PlannedOwned[] = [];
  const phases: SyncStep[][] = [[], [], [], [], [], [], []]; // creates: initiative, project, milestone, issue; updates; links
  const failedInputs: FailedInputs[] = [];
  const notices: SyncNotice[] = [];
  const waits: string[] = [];
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
  const textRefusal = (texts: string[], facts: { teamKey: string | null; mode: LinkingMode }[]): string | null => textRefusalOf(texts, facts, s.privateTrackerKeys);

  interface Decide {
    phase: number; kind: BindingKind; id: number; workspaceId: string; teamKey: string | null; op: { create: CcrcOpName; update: CcrcOpName };
    b: BindingRow | undefined; ready: boolean; statusMissing: boolean; texts: string[]; facts: Fact[];
    planned: Record<string, unknown>; fp: string; isCurrent: (stored: string | null) => boolean;
    create: () => { input: CcrcOpInput; fields: string[] };
    /** A project's planned teams' keys (D-8707), on its create and update steps. */
    teamKeys?: readonly string[];
    update: (linearId: string) => { input: CcrcOpInput; fields: string[]; extras?: { stateType?: string; comment?: { requestId: string; body: string } } };
    recover: Recover;
    /** A link step on the bound object; its `inputs` are the object's own (what a failed binding reports), set by `decide`. Given
     *  the restore's tag when the binding is forced (its link is then made again), else null. */
    link?: (forced: string | null) => Omit<Extract<SyncStep, { kind: 'link' }>, 'inputs'> | null;
    /** The owned fields the drift pass compares (D-8183), as the shaped Linear answers name them. */
    owned: { kind: DriftKind; fields: OwnedFields };
  }
  const decide = (d: Decide): void => {
    const local: Local = { kind: d.kind, id: d.id };
    const inputs = plannedFingerprint({ ...d.planned, teamKey: d.teamKey, workspaceId: d.workspaceId });
    if (d.b?.state === 'failed') { failedInputs.push({ bindingId: d.b.id, inputs }); return; }
    if (!d.ready) return;
    const forced = d.b === undefined ? undefined : force.get(d.b.id);
    if (d.b?.state === 'bound' && d.b.linearId !== null) {
      owned.push({ bindingId: d.b.id, kind: d.owned.kind, local, owned: d.owned.fields, current: d.isCurrent(d.b.fingerprint) });
    }
    const base = { local, workspaceId: d.workspaceId, teamKey: d.teamKey, inputs, ...(d.teamKeys === undefined ? {} : { teamKeys: d.teamKeys }) };
    const skip = (why: SkipWhy, detail: string | null = null): void => {
      phases[d.phase]!.push({ kind: 'skip', local, why, workspaceId: d.workspaceId, bindingId: d.b?.id ?? null, inputs, detail });
    };
    const bound = d.b?.state === 'bound' && d.b.linearId !== null;
    if (bound && d.link !== undefined) {
      const l = d.link(forced ?? null);
      if (l !== null) { phases[5]!.push({ ...l, inputs }); if (forced === undefined) return; }
    }
    if (bound && forced === undefined && d.isCurrent(d.b!.fingerprint)) return;
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
  const prog = s.program;
  const end = prog?.end ?? null;
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

  // ── 1. initiatives: one per workspace the programme sits in (F2, Review Focus 3: a team key moved to another workspace
  // moves nothing and creates nothing). Its workspaces are where its initiative is bound already, and where an epic is
  // placed that is unbound or bound in that same workspace; an epic bound elsewhere places nothing (its binding fails
  // `workspace-mismatch` below). An old workspace's initiative keeps being updated, and is closed at the programme's end.
  const epicBindingWs = (e: EpicRow): string[] => s.bindings.flatMap((b) => (b.localKind === 'epic' && b.localId === e.id ? [b.workspaceId] : []));
  const anchoredIn = (e: EpicRow, wsId: string): boolean => { const at = epicBindingWs(e); return at.length === 0 || at.includes(wsId); };
  const wsIds = [...new Set([
    ...placed.flatMap((e) => { const p = places.get(e.id)!; return p.ok && anchoredIn(e, p.workspaceId) ? [p.workspaceId] : []; }),
    ...s.bindings.flatMap((b) => (prog !== null && b.localKind === 'programme' && b.localId === prog.rowid ? [b.workspaceId] : [])),
  ])];
  /** The project facts that speak for a workspace's initiative (its setting, its text check): those of the epics placed
   *  there or bound there; for an initiative bound where no epic is any more, every epic's. */
  const factsIn = (wsId: string): Fact[] => {
    const of = (keep: (e: EpicRow) => boolean): Fact[] => placed.flatMap((e) => { const f = factOf(e.project); return keep(e) && f !== undefined ? [f] : []; });
    const here = of((e) => { const p = places.get(e.id)!; return (p.ok && p.workspaceId === wsId) || epicBindingWs(e).includes(wsId); });
    return here.length > 0 ? here : of(() => true);
  };
  const anyEpicState = (st: string): boolean => s.plan.epics.some((e) => e.state === st);
  const initiativeStatus: LinearInitiativeStatus = end !== null
    ? (end.outcome === 'done' ? INITIATIVE.completed : INITIATIVE.canceled)
    : anyEpicState('active') || anyEpicState('done') ? INITIATIVE.active : INITIATIVE.planned;
  /** The initiative each workspace's projects link to: its Linear id, and whether its binding is `bound` (`live`). A failed
   *  initiative that has a Linear object keeps its projects' links as they are (A3: no update that unlinks, no second link
   *  when it binds again), and no new link is made to it. */
  const initiativeIdOf = new Map<string, { id: string; live: boolean }>();
  /** Per workspace, the Linear ids of the bound projects the initiative should link (D-8183), filled by the epic loop below. */
  const linkedProjects = new Map<string, string[]>();
  for (const wsId of wsIds) {
    // An Upkeep epic has no programme and so no initiative (D-8183): its project is made in the team and linked to nothing.
    if (prog === null) break;
    // A workspace the snapshot does not describe (no slot serves it now) cannot be written: nothing is decided for it.
    const ws = s.workspaces.find((w) => w.workspaceId === wsId);
    if (ws === undefined) continue;
    const facts = factsIn(wsId);
    const b = bindingOf('programme', prog.rowid, wsId);
    if ((b?.state === 'bound' || b?.state === 'failed') && b.linearId !== null) initiativeIdOf.set(wsId, { id: b.linearId, live: b.state === 'bound' });
    const local: Local = { kind: 'programme', id: prog.rowid };
    if (ws.initiatives === 'off' || !facts.some((f) => f.initiatives === 'on')) {
      phases[0]!.push({ kind: 'skip', local, why: 'initiatives-off', workspaceId: wsId, bindingId: b?.id ?? null, inputs: null, detail: null });
      continue;
    }
    const planned = { name: egress(prog.title), description: initiativeDescription({ ...s, program: prog }), status: initiativeStatus };
    // A probe that has not answered (`unknown`) defers the initiative's step: nothing is sent for it, and the workspace waits
    // for a refill unless its initiative is bound and current already (D-8182 fix round 1, F1).
    if (ws.initiatives === 'unknown') {
      if (!(b?.state === 'bound' && b.fingerprint === plannedFingerprint(planned))) waits.push(wsId);
      continue;
    }
    decide({
      phase: 0, kind: 'programme', id: prog.rowid, workspaceId: wsId, teamKey: null, op: { create: 'initiativeCreate', update: 'initiativeUpdate' },
      // D-8708: the gate judges the unfitted body too: a name the fit cuts in two reaches the fitted text only as a prefix.
      b, ready: true, statusMissing: false, texts: [planned.name, planned.description, initiativeBody({ ...s, program: prog })], facts, planned, fp: plannedFingerprint(planned),
      isCurrent: (st) => st === plannedFingerprint(planned),
      create: () => ({ input: planned, fields: ['name', 'description', 'status'] }),
      update: (id) => ({ input: { id, ...planned }, fields: ['name', 'description', 'status'] }),
      recover: 'name-and-creator',
      owned: { kind: 'initiative', fields: { ...planned, projectIds: linkedProjects.set(wsId, []).get(wsId)! } },
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
    const initiative = pl.fact.initiatives === 'on' && pl.ws.initiatives !== 'off' ? initiativeIdOf.get(wsId) : undefined;
    const initiativeId = initiative?.id ?? null;
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
    // F3 (Review Focus 3): a ticket bound here keeps the team its issue sits in on the project, whatever its project key does
    // now: cleared or moved to another workspace (the issue is not moved), and (M2) re-keyed inside this workspace until the
    // move binds, so the project gains the new team first and drops the old one only after the issue left it.
    const teamIds = [...new Set([pl.teamId, ...e.tickets.flatMap((t) => {
      if (effTicket(eff, t).state === 'dropped') return [];
      const tp = placeOf(t.project);
      const planned = tp.ok && tp.workspaceId === wsId ? [tp.teamId] : [];
      const tb = bindingOf('ticket', t.id, wsId);
      const held = tb === undefined || tb.linearId === null || tb.teamKey === null ? undefined
        : pl.ws.teams.find((k) => k.key.toLowerCase() === tb.teamKey!.toLowerCase());
      return held === undefined ? planned : [...planned, held.id];
    })])].sort();
    const pBody = projectBody({ ...e, state: eff.state, droppedWhy: eff.why }, prog?.title ?? '', off && prog !== null);
    const planned = { name: fitProjectName(e.title), description: fitLinearDescription(pBody), statusId: pStatus, teamIds, initiativeId };
    const plannedTeamKeys = planned.teamIds.flatMap((id) => { const t = pl.ws.teams.find((k) => k.id === id); return t === undefined ? [] : [t.key]; });
    // D-8183: the project's fingerprint is `<base>` or `<base>+<mark>` (`withLinkMark`): the base is the planned fields without the
    // initiative link, the mark is the link to the live initiative once made. An update keeps the stored mark (nothing unlinks); the
    // link step writes it. Current is the base matching AND (the initiative not live, or the stored mark the live one's).
    const fpBase = plannedFingerprint({ ...planned, initiativeId: null });
    const liveMark = initiative?.live === true ? plannedFingerprint({ link: initiative.id }) : null;
    const keptMark = eb?.state === 'bound' ? linkMarkOf(eb.fingerprint).mark : null;
    /** The Linear ids of this project's bound checkpoints' milestones, filled by the checkpoint loop below (D-8183). */
    const milestoneIds: string[] = [];
    const projectIsCurrent = (st: string | null): boolean => { const m = linkMarkOf(st); return m.base === fpBase && (liveMark === null || m.mark === liveMark); };
    // D-8183 (round 1 A1, §5.2's order): the project gains a team before an issue is created in it. `projectHasTeams` is whether the
    // project's stored base is the plan's (it holds the planned `teamIds`, whatever its link); a ticket's create on another team waits for it.
    const projectHasTeams = eb?.state === 'bound' && eb.linearId !== null && linkMarkOf(eb.fingerprint).base === fpBase;
    decide({
      phase: 1, kind: 'epic', id: e.id, workspaceId: wsId, teamKey: pl.teamKey, op: { create: 'projectCreate', update: 'projectUpdate' },
      // D-8708: the gate judges the fitted name and description and their unfitted forms (the title and the body) both.
      b: eb, ready: true, statusMissing: pStatus === null, texts: [planned.name, egress(e.title), planned.description, pBody], facts: [pl.fact], planned, teamKeys: plannedTeamKeys,
      // A project not yet linked to a failed initiative is current unlinked: no link is made to it until it binds again.
      fp: withLinkMark(fpBase, keptMark), isCurrent: projectIsCurrent,
      create: () => ({ input: { name: planned.name, description: planned.description, statusId: pStatus, teamIds: planned.teamIds }, fields: ['name', 'description', 'status', 'teams'] }),
      update: (id) => ({ input: { id, name: planned.name, description: planned.description, statusId: pStatus, teamIds: planned.teamIds }, fields: ['name', 'description', 'status', 'teams'] }),
      link: (forced) => {
        if (initiative?.live !== true || liveMark === null || eb === undefined) return null;
        const held = linkMarkOf(eb.fingerprint);
        if (forced === null && (held.base !== fpBase || held.mark === liveMark)) return null;
        const requestId = requestIdOf('epic', e.id, wsId, forced === null ? 'link' : `restore-${forced}`);
        return {
          kind: 'link', op: 'initiativeToProjectCreate', local: { kind: 'epic', id: e.id }, workspaceId: wsId, teamKey: pl.teamKey, bindingId: eb.id,
          input: { requestId, initiativeId, projectId: eb.linearId! }, fields: ['project'], requestId, fingerprint: withLinkMark(fpBase, liveMark),
        };
      },
      recover: 'name-and-creator',
      owned: {
        kind: 'project',
        fields: {
          name: planned.name, description: planned.description, statusType: PROJECT_STATUS_TYPE[eff.state],
          teamKeys: plannedTeamKeys,
          initiativeIds: initiative?.live === true ? [initiative.id] : [], milestoneIds,
        },
      },
    });
    if (eb?.state !== 'bound' || eb.linearId === null) continue;
    const projectId = eb.linearId;
    epicProject.set(e.id, projectId);
    // D-8183: this bound project is one the workspace's live initiative should link (the setting on and the initiative bound).
    if (initiative?.live === true) linkedProjects.get(wsId)?.push(projectId);

    const msIds = new Map<number, string>();
    for (const c of e.checkpoints) {
      const cb = bindingOf('checkpoint', c.id, wsId);
      if (c.state === 'dropped' && cb === undefined) continue;
      if (cb?.state === 'bound' && cb.linearId !== null) { msIds.set(c.id, cb.linearId); milestoneIds.push(cb.linearId); }
      // D-8700 (milestone-target-date-once-met; spec §6.2, §5.3): the target date is ccrc's only once the checkpoint is met.
      // An open (or dropped) checkpoint's create and update leave it out of the input and the fields, so a date set in Linear
      // stands; a met one sets it, and owns it from then on.
      const mp = {
        name: egress(c.title), description: milestoneDescription(c), targetDate: c.state === 'met' && c.metAt !== null ? dayOf(c.metAt) : null, sortOrder: c.ordinal,
      };
      const dated: Record<string, string> = mp.targetDate === null ? {} : { targetDate: mp.targetDate };
      const dateField = mp.targetDate === null ? [] : ['targetDate'];
      decide({
        phase: 2, kind: 'checkpoint', id: c.id, workspaceId: wsId, teamKey: pl.teamKey, op: { create: 'projectMilestoneCreate', update: 'projectMilestoneUpdate' },
        b: cb, ready: true, statusMissing: false, texts: [mp.name, mp.description, milestoneBody(c)], facts: [pl.fact], planned: mp, fp: plannedFingerprint(mp),
        isCurrent: (st) => st === plannedFingerprint(mp),
        create: () => ({
          input: { projectId, name: mp.name, description: mp.description, sortOrder: mp.sortOrder, ...dated },
          fields: ['name', 'description', ...dateField, 'project'],
        }),
        update: (id) => ({ input: { id, name: mp.name, description: mp.description, sortOrder: mp.sortOrder, ...dated }, fields: ['name', 'description', ...dateField] }),
        recover: 'name-in-project',
        // D-8700: a target date not yet set by ccrc is `undefined` here, never compared.
        owned: { kind: 'milestone', fields: { name: mp.name, description: mp.description, targetDate: mp.targetDate ?? undefined, sortOrder: mp.sortOrder, projectId } },
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
      // A create (no issue yet) in a team the epic's project is not in: it waits until the project's update with that team is current.
      const createsOnOtherTeam = (tb === undefined || tb.state !== 'bound' || tb.linearId === null) && tpl.teamKey.toUpperCase() !== pl.teamKey.toUpperCase();
      // D-8183: the same encoding as the project's link: `<base>` or `<base>+<mark>` with the mark F({ pr: <url> }) once the link was sent. A
      // pass where no PR is known keeps the stored mark and sends nothing; an update keeps it; a new URL is linked once.
      const fpBase = plannedFingerprint(ip);
      const prMark = wantPr && pr !== undefined ? plannedFingerprint({ pr: pr.url }) : null;
      const keptMark = tb?.state === 'bound' ? linkMarkOf(tb.fingerprint).mark : null;
      decide({
        phase: 3, kind: 'ticket', id: t.id, workspaceId: wsId, teamKey: tpl.teamKey, op: { create: 'issueCreate', update: 'issueUpdate' },
        b: tb, ready: (t.checkpointId === null || milestoneId !== null) && (projectHasTeams || !createsOnOtherTeam), statusMissing: iStatus === null, texts: [ip.title, ip.description, ...(cancelBody === null ? [] : [cancelBody])], facts: [tpl.fact],
        planned: ip, fp: withLinkMark(fpBase, keptMark), isCurrent: (st) => { const m = linkMarkOf(st); return m.base === fpBase && (prMark === null || m.mark === prMark); },
        link: (forced) => {
          if (forced !== null || prMark === null || pr === undefined || tb === undefined || tb.linearId === null) return null;
          const held = linkMarkOf(tb.fingerprint);
          if (held.base !== fpBase || held.mark === prMark) return null;
          const requestId = requestIdOf('ticket', t.id, wsId, 'pr');
          return {
            kind: 'link', op: 'issueLink', local: tlocal, workspaceId: wsId, teamKey: tpl.teamKey, bindingId: tb.id,
            input: { requestId, issueId: tb.linearId, url: pr.url, title: `PR #${pr.number}` }, fields: ['url', 'title'], requestId, fingerprint: withLinkMark(fpBase, prMark),
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
        // ccrc sets no parent, so `parentId` is not owned now (`undefined`); the team key is compared as Linear writes it.
        owned: {
          kind: 'issue',
          fields: {
            title: ip.title, description: ip.description, teamKey: tpl.teamKey.toUpperCase(), projectId, milestoneId, stateType, parentId: undefined,
          },
        },
      });
    }
  }
  return { steps: phases.flat(), failedInputs, notices, waits, owned };
}

// ── The pass's ruled verdicts (final review I-4): what the L4 pass reads, it asks here; it never decides itself ──

/** Why a pass defers (M5): an outcome word that defers it, or a condition it waits on. */
export type DeferCause =
  | 'rate-limited' | 'unreachable' | 'timeout' | 'policy-unavailable' | 'journal-unavailable' | 'malformed' | 'linear-unauthorised'
  | 'store-unreadable' | 'created-without-id' | 'workspace-blocked'
  | 'directory-missing' | 'statuses-unread' | 'viewer-unknown' | 'initiatives-unknown';
/** What a deferral is: a `failure` holds its backoff against every later mark (A7/A12), a `wait` is ordinary; and how long it
 *  waits: the escalating `backoff` step, the short `directory` wait for a fill, or `until` a time the cause carries. */
export interface Deferral { why: SyncDeferral; wait: 'backoff' | 'directory' | 'until' }
const DEFERRALS: Readonly<Record<DeferCause, Deferral>> = {
  'rate-limited': { why: 'failure', wait: 'backoff' },          // the executor waits at least Linear's retryAfterS too
  unreachable: { why: 'failure', wait: 'backoff' },
  timeout: { why: 'failure', wait: 'backoff' },
  'policy-unavailable': { why: 'failure', wait: 'backoff' },
  'journal-unavailable': { why: 'failure', wait: 'backoff' },
  malformed: { why: 'failure', wait: 'backoff' },
  'linear-unauthorised': { why: 'failure', wait: 'backoff' },   // the workspace is blocked until the same time
  'store-unreadable': { why: 'failure', wait: 'backoff' },      // C18
  'created-without-id': { why: 'failure', wait: 'backoff' },    // an ok with no id may have been sent
  'workspace-blocked': { why: 'failure', wait: 'until' },       // another programme's refused key blocks the workspace
  'directory-missing': { why: 'wait', wait: 'directory' },
  'viewer-unknown': { why: 'wait', wait: 'directory' },
  'initiatives-unknown': { why: 'wait', wait: 'backoff' },
  'statuses-unread': { why: 'wait', wait: 'backoff' },           // I1: a page that keeps failing is retried on the backoff
};
/** M5: the one table of what each deferral is; the executor asks it at every site that defers. */
export function deferralOf(cause: DeferCause): Deferral { return DEFERRALS[cause]; }

/** D-8183 (carried item 7): the time a deferral waits to. `backoffMs` is the step the caller holds for it (consulted when the
 *  deferral waits on the backoff, or on an `until` the cause did not carry), `floorMs` a wait it may not be shorter than (Linear's
 *  retry-after), `until` the time an `until` deferral carries, `directoryWaitMs` the short directory wait. */
export function deferralUntil(d: Deferral, o: { now: number; backoffMs: number; floorMs?: number; until?: number; directoryWaitMs: number }): number {
  if (d.wait === 'directory') return o.now + o.directoryWaitMs;
  if (d.wait === 'until') return o.until ?? o.now + o.backoffMs;
  return o.now + Math.max(o.floorMs ?? 0, o.backoffMs);
}
/** Whether a deferral takes a step of the backoff (the caller's counter then moves): only one that waits on it. */
export function deferralUsesBackoff(d: Deferral): boolean { return d.wait === 'backoff'; }

// ── D-8701's episodes: the bounded waits (coordinator ruling, mail 22220; review I1) ──

/** How many consecutive directory fills reading the same unsettled answer bound an episode. */
export const DIRECTORY_EPISODE_REFILLS = 3;
/** One workspace's run of fills that read an unsettled answer (initiatives `unknown`, or statuses never read), for one key:
 *  `since` is its first fill (it names the episode), `refills` how many distinct fills it has seen, the first included. */
export interface DirectoryStreak { keyDigest: string; since: number; lastFilledAt: number; refills: number }
/** What one look at a workspace's directory read: no fill held (`none`), or a fill whose answer is settled or not. */
export interface FillLook { keyDigest: string; filledAt: number | null; reading: 'none' | 'settled' | 'unsettled' }

/** The streak after one look. No fill changes nothing; a settled fill ends the episode; an unsettled fill starts one (or a
 *  new one for another key), and a fill not seen before counts once however many passes look at it. */
export function nextDirectoryStreak(prev: DirectoryStreak | undefined, look: FillLook): DirectoryStreak | undefined {
  if (look.reading === 'none' || look.filledAt === null) return prev;
  if (look.reading === 'settled') return undefined;
  if (prev === undefined || prev.keyDigest !== look.keyDigest) return { keyDigest: look.keyDigest, since: look.filledAt, lastFilledAt: look.filledAt, refills: 1 };
  return look.filledAt === prev.lastFilledAt ? prev : { ...prev, lastFilledAt: look.filledAt, refills: prev.refills + 1 };
}

const bounded = (st: DirectoryStreak | undefined): boolean => st !== undefined && st.refills >= DIRECTORY_EPISODE_REFILLS;

/** D-8183 (carried item 7): whether a programme settled without its initiative at a probe episode's bound is due again: its
 *  workspace's directory was refilled since the episode's last fill, or the episode ended (no streak). No fill held, or the same
 *  one the episode last saw, is nothing new. */
export function probeRecheckDue(streak: DirectoryStreak | undefined, filledAt: number | null): boolean {
  return streak === undefined || (filledAt !== null && filledAt !== streak.lastFilledAt);
}

/** D-8183 (carried items 7 and 10): what a dispatch does about its ticket's issue. `bound`: it is bound already (the wait is for
 *  nothing). `go-without`: the programme's row (`programmeHeldUntil`, a failure's hold) or the ticket's workspace is held, so the
 *  dispatch goes as it would without the sync. `wait`: start or join the pass and wait for it, up to the budget. */
export function dispatchWaitVerdict(o: { identifier: string | null; programmeHeldUntil: number | null; workspaceHeld: boolean; now: number }): 'bound' | 'go-without' | 'wait' {
  if (o.identifier !== null) return 'bound';
  return (o.programmeHeldUntil !== null && o.programmeHeldUntil > o.now) || o.workspaceHeld ? 'go-without' : 'wait';
}

/** D-8183 (carried item 10): the sentence of the probe episode's mail, with no Linear text. An initiative not yet bound waits to be
 *  created; one bound waits for its UPDATE (a rename, or the programme's end moving it to Completed or Canceled), and its projects stay
 *  linked as they are; at a programme's end such an initiative stays unclosed (Active in Linear) until a refill reads `on`. */
export function probeEpisodeText(o: { slug: string; workspaceId: string; initiativeBound: boolean; endWaiting: boolean }): string {
  const tell = `ccrc cannot tell whether initiatives are on in the Linear workspace ${o.workspaceId}, so`;
  if (!o.initiativeBound) {
    return `${tell} the initiative of ${o.slug} there is waiting. Its projects, milestones and issues still sync, not linked to an initiative; ccrc looks again at the next directory refill or plan change.`;
  }
  const end = o.endWaiting ? ' The programme has ended, and the initiative stays unclosed until ccrc can tell: it is closed once ccrc can tell.' : '';
  return `${tell} the initiative's update waits; its projects stay linked as they are. Its projects, milestones and issues still sync; ccrc looks again at the next directory refill or plan change.${end}`;
}

/** The initiatives probe's waits (`planSyncSteps`' `waits`): a workspace whose streak is short still waits (ask a refill,
 *  defer); one at the bound is settled without its initiative (projects unlinked) and its coordinator is told once. The
 *  pass settles when nothing waits. */
export function probeWaitsVerdict(waits: readonly string[], streakOf: (workspaceId: string) => DirectoryStreak | undefined): { waitOn: string[]; bounded: string[] } {
  return { waitOn: waits.filter((ws) => !bounded(streakOf(ws))), bounded: waits.filter((ws) => bounded(streakOf(ws))) };
}

/** The workspaces a pass waits on for their directory: the short wait while any has no directory at all, else the backoff
 *  for statuses never read (I1); never settled (nothing there can be built), and each unread workspace at the bound is told. */
export function directoryWaitVerdict(waiting: readonly { workspaceId: string; missing: 'directory' | 'statuses'; streak: DirectoryStreak | undefined }[]): { cause: 'directory-missing' | 'statuses-unread'; tell: string[] } {
  return {
    cause: waiting.some((w) => w.missing === 'directory') ? 'directory-missing' : 'statuses-unread',
    tell: waiting.filter((w) => w.missing === 'statuses' && bounded(w.streak)).map((w) => w.workspaceId),
  };
}

/**
 * D-8701 (statuses-unread-distinct): whether a workspace's directory is a miss for the sync, so the pass asks the refresher
 * for a fill and waits, sending nothing in that workspace: none is held for the slot's key, or one is held whose project
 * statuses were never read (`statuses` not `read`). An empty list that WAS read is no miss: a status type it lacks is
 * `status-missing`, as before.
 */
export function directoryMissed(entries: LinearDirectoryEntries | null, statuses: 'read' | 'unread' | null): boolean {
  return entries === null || statuses !== 'read';
}

/** What a Linear object is to the adoption rule: an initiative, a project, a milestone or an issue. */
export type AdoptionKind = 'initiative' | 'project' | 'milestone' | 'issue';
/** One object as a read answered it (`creatorId` from a by-name listing, `teamKeys` a project's, `teamKey` an issue's). */
export interface AdoptionNode { id: string; creatorId?: string | null; teamKeys?: readonly string[]; teamKey?: string }
export interface AdoptionAsk {
  /** The id ccrc sent on its create (R1): ccrc's own object always carries it. */
  requestId: string;
  /** The directory's viewer: the key ccrc writes with. Null when no directory is held (nothing is then provably ccrc's). */
  viewer: string | null;
  /** Every Linear id another binding holds. */
  held: ReadonlySet<string>;
}
/** `teamKey` is the object's own team as it was read (an issue's; a project has several, and the step's planned team stays its
 *  binding's): absent when the read did not answer one. */
export type AdoptionVerdict = { verdict: 'adopt'; id: string; teamKey?: string } | { verdict: 'none' };

/**
 * C2' (amending C2), C11, R2 and D-8183 (round 1 A11): which object, if any, is ccrc's own, after a create that may have been sent
 * (`recover`) or one answered "conflict on insert" (`bindExisting`). Only the object at the requestId, held by no other binding,
 * and: an initiative or a project made by the viewer; a milestone as it is (it was read inside ccrc's own bound project, and has no
 * creator, R3); an issue, by its id alone. The planned TEAM is no part of the rule: the team key may have changed between a lost
 * create reply and the recovery, and an object made under the old key is ccrc's all the same; an issue's actual team is answered,
 * so the binding records it and the next pass's update moves the issue (C15). A name-only match is never ours (every kind takes a
 * caller id, FX2): `none`, and the caller sends the create (recovery) or fails the binding (a conflict).
 */
export function adoptionVerdict(kind: AdoptionKind, nodes: readonly AdoptionNode[], a: AdoptionAsk): AdoptionVerdict {
  const ours = (n: AdoptionNode): boolean => {
    if (n.id !== a.requestId || a.held.has(n.id)) return false;
    switch (kind) {
      case 'milestone': case 'issue': return true;
      case 'initiative': case 'project': return a.viewer !== null && n.creatorId === a.viewer;
    }
  };
  const found = nodes.find(ours);
  if (found === undefined) return { verdict: 'none' };
  return kind === 'issue' && typeof found.teamKey === 'string' ? { verdict: 'adopt', id: found.id, teamKey: found.teamKey } : { verdict: 'adopt', id: found.id };
}

/** An issue as `issueOwned` answered it, for C12's read. */
export interface IssueRead { stateType?: string; title?: string; description?: string | null; teamKey?: string; projectId?: string | null; milestoneId?: string | null }
export type IssueReadVerdict = 'same' | 'state-held' | 'send';

/**
 * C12 and C19: what an issue update sends once the issue was read. Another state type, or another team (a move, or a team it
 * did not answer), sends the update as planned, its state with it (a moved issue's state goes with the move). The planned type
 * in the planned team with every other planned field the same is `same` (only the fingerprint is written); the type alone
 * agreeing is `state-held` (the update goes without its state: Linear owns the state's name).
 */
export function issueReadVerdict(issue: IssueRead, step: { stateType?: string; teamKey: string | null; input: CcrcOpInput }): IssueReadVerdict {
  const sameTeam = typeof issue.teamKey === 'string' && step.teamKey !== null && issue.teamKey.toUpperCase() === step.teamKey.toUpperCase();
  if (issue.stateType !== step.stateType || !sameTeam) return 'send';
  const sameRest = issue.title === step.input['title'] && (issue.description ?? '').trim() === String(step.input['description'] ?? '').trim()
    && issue.projectId === step.input['projectId'] && (issue.milestoneId ?? null) === (step.input['projectMilestoneId'] ?? null);
  return sameRest ? 'same' : 'state-held';
}

/** Why a failed binding is asked about: the tick's sweep (a directory refresh after the failure, or the last backoff step
 *  passed), or the pass's inputs trigger (the inputs the deciders report for it now). */
export type RequeueWhy = { kind: 'time'; filledAt: number | null; olderThan: number } | { kind: 'inputs'; inputs: string };
export type RequeueVerdict = 'stay' | 'to-bound' | 'to-pending';

/**
 * C10 and C17: whether a `failed` binding gets another try, and where it goes. It is retried when its workspace's directory
 * was filled after the failure (`filledAt`, null when none is held), when it failed before `olderThan`, or when its inputs
 * changed. A binding with a Linear object goes back to `bound` with its stored fingerprint, so the deciders emit an update
 * (or a move, or a link) and never a create; one with none goes back to `pending`.
 */
export function requeueVerdict(b: Pick<BindingRow, 'state' | 'failedAt' | 'failedInputs' | 'linearId'>, why: RequeueWhy): RequeueVerdict {
  if (b.state !== 'failed') return 'stay';
  const due = why.kind === 'inputs'
    ? b.failedInputs !== why.inputs
    : b.failedAt !== null && ((why.filledAt !== null && b.failedAt < why.filledAt) || b.failedAt < why.olderThan);
  if (!due) return 'stay';
  return b.linearId === null ? 'to-pending' : 'to-bound';
}

// ── The initiatives-off item (Task 3.5, §5.2's "initiatives off") ──

/** What the pass does about one workspace's operator item: raise it or leave things as they are (settling is the tick's:
 *  {@link initiativesItemsToSettle}). */
export type InitiativesItemVerdict = 'raise' | 'none';

/**
 * Per workspace of the snapshot: a workspace reading `off` where this programme has a project whose setting is `on` needs
 * the item (one per workspace, so none when `openFor` already holds one). `unknown` (a probe that has not answered)
 * changes nothing, and a project set `off` needs nothing.
 */
export function initiativesItemVerdicts(s: SyncSnapshot, openFor: ReadonlySet<string>): { workspaceId: string; verdict: InitiativesItemVerdict }[] {
  return s.workspaces.map((w) => {
    const needed = s.projects.some((p) => p.workspaceId === w.workspaceId && p.initiatives === 'on');
    return { workspaceId: w.workspaceId, verdict: w.initiatives === 'off' && needed && !openFor.has(w.workspaceId) ? 'raise' : 'none' };
  });
}

/** The open initiatives items whose workspace's directory now reads `on` (`null`: no directory held yet): the ones to settle. */
export function initiativesItemsToSettle(
  open: readonly { id: number; workspaceId: string }[], initiativesOf: (workspaceId: string) => 'on' | 'off' | 'unknown' | null,
): { id: number; workspaceId: string }[] {
  return open.filter((i) => initiativesOf(i.workspaceId) === 'on');
}

/** The operator item that asks for initiatives to be turned on in one workspace. Its steps name no workspace or team. */
export function initiativesItemInput(workspaceId: string): RaiseItemInput {
  return {
    program: LINEAR_SYNC_PROGRAMME, runId: null, raisedBy: 'ccrc', kind: 'do', neededBy: 'later', soonLabel: null, secretSlot: null,
    title: 'Turn on initiatives in this Linear workspace',
    why: 'A programme here is set to carry a Linear initiative, but this workspace has initiatives switched off. Until they are on, its epics sync as projects with no initiative above them.',
    how: [
      'In Linear, open the workspace settings and turn on Initiatives (a workspace admin does this).',
      'Come back here and choose Check again: ccrc reads the workspace once more and, when initiatives are on, links the projects to their initiatives and closes this item.',
    ],
    options: null, action: { verb: 'linear-initiatives', workspaceId },
  };
}
