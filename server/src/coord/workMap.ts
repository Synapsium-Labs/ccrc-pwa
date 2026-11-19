// The programme's work map (programme work map WM2, D-8779; spec 2026-11-16 §3.1, §4, §5.1 and §7, D2, D3, D12, D16, D19
// and D20). L1, Coordination (C5): pure, no I/O and no clock. `workMapOf` is THE one place a ticket's status, a phase's
// progress, a carry's reading and a finish time are decided (D2); none of them is stored. `doneEvidenceVerdict` is the read
// side of WM1's evidence rule, deciding whether a ticket's stored done evidence still holds on this read (§4.1). The plan
// read (`planRoutes.ts`, L4) gathers the facts, calls both, and serves the view as `work` beside `plan`.
import type { RunKind, RunState, RunSummary } from '../../../shared/api.js';
import {
  WORK_GROUPS,
  type EpicView, type PhaseView, type PlanView, type TicketDoneEvidence, type TicketView, type WorkGroup, type WorkItemView,
  type WorkMapView, type WorkPhaseView, type WorkStatus, type WorkEpicView,
} from '../../../shared/plan.js';
import { autoTicketKey, isAutoTicketKey, phaseNumbers } from './planPolicy.js';

/** Who acts on each status (spec Table 6's Group column; D3). */
export const WORK_STATUS_GROUP: Readonly<Record<WorkStatus, WorkGroup>> = {
  dropped: 'dropped', closed: 'closed', done: 'done', 'done-unverified': 'held', 'left-open': 'left-open',
  'waiting-on-you': 'waiting-on-you', stuck: 'held', blocked: 'held', working: 'in-progress', 'state-unknown': 'in-progress',
  'in-review': 'in-progress', merging: 'in-progress', queued: 'in-progress', 'not-started': 'not-started', failed: 'failed',
};
/** The groups a headline's or a chip's "N of M" counts: closed, left open, dropped and failed count apart (F4). */
const COUNTED: ReadonlySet<WorkGroup> = new Set(['done', 'in-progress', 'waiting-on-you', 'held', 'not-started']);

/** One stored piece of done evidence's verdict on this read. */
export type EvidenceVerdict = { holds: true } | { holds: false; reason: string };

/** What the read side of the evidence rule reads, gathered by the route: for `{ runId }` the run it names (null: no such run)
 *  with its own ticket's key; for `{ pr }` what the landing line of the ticket's own project says of it (F19). */
export interface DoneEvidenceFacts {
  program: string;
  ticketKey: string;
  evidence: TicketDoneEvidence | 'malformed';
  run: { program: string; kind: RunKind; state: RunState; ticketKey: string | null } | null;
  landed: { kind: 'landed' } | { kind: 'unlanded'; state: string } | { kind: 'no-entry' } | { kind: 'unreadable'; detail: string } | null;
}

/** Whether a ticket's stored done evidence holds on this read (spec §4.1: verified when recorded, and again on every read).
 *  `{ runId }` holds while that run is a work run of this programme in state `done` whose own ticket is this ticket, an auto
 *  ticket or none (review 2375 F2); `{ pr }` while the landing line of the ticket's own project holds it `landed`. */
export function doneEvidenceVerdict(f: DoneEvidenceFacts): EvidenceVerdict {
  const ev = f.evidence;
  if (ev === 'malformed') return { holds: false, reason: 'the stored evidence cannot be read' };
  if ('runId' in ev) {
    const r = f.run;
    if (r === null) return { holds: false, reason: `run ${ev.runId} is not recorded` };
    if (r.program !== f.program || r.kind !== 'work') return { holds: false, reason: `run ${ev.runId} is not a work run of this programme` };
    if (r.state !== 'done') return { holds: false, reason: `run ${ev.runId} is ${r.state}, not done` };
    if (r.ticketKey !== null && r.ticketKey !== f.ticketKey && !isAutoTicketKey(r.ticketKey)) {
      return { holds: false, reason: `run ${ev.runId} did ticket ${r.ticketKey}` };
    }
    return { holds: true };
  }
  const l = f.landed;
  if (l === null || l.kind === 'no-entry') return { holds: false, reason: `the landing line holds no pull request ${ev.pr}` };
  if (l.kind === 'unreadable') return { holds: false, reason: `the landing line could not be read (${l.detail})` };
  if (l.kind === 'unlanded') return { holds: false, reason: `pull request ${ev.pr} is ${l.state}, not landed` };
  return { holds: true };
}

/** A work run as the map reads it: the run's own fields and its ticket's key (`runs.ticketId` joined, null for none). */
export type WorkMapRun = Pick<RunSummary, 'id' | 'kind' | 'state' | 'wave' | 'programTitle'>
  & { runTitle?: string | null; lastMoveAt?: number | null; ticketKey: string | null };

export interface WorkMapInput {
  plan: PlanView & {
    /** `plan put` was run (`programs.planAt` set). */
    declared: boolean;
    end: WorkMapView['end'];
    /** Each ticket's stored done facts, by key: its time and its evidence (null: none stored). */
    done: ReadonlyMap<string, { at: number | null; evidence: TicketDoneEvidence | 'malformed' | null }>;
  };
  /** The programme's runs; only work runs make rows. */
  runs: readonly WorkMapRun[];
  /** The run verdicts reader: `not-read` while it is empty (before its first pass, or after a restart). */
  verdicts: 'not-read' | ReadonlyMap<number, { stuck: boolean; blockedBy: number | null }>;
  /** The programme's open operator items. */
  openItems: readonly { id: number; runId: number | null }[];
  /** `${epicKey}/${checkpointKey}` of an `operator-act` checkpoint -> its open operator item. */
  checkpointItems: ReadonlyMap<string, number>;
  /** Ticket key -> its stored evidence's verdict on this read (`doneEvidenceVerdict`). */
  evidence: ReadonlyMap<string, EvidenceVerdict>;
  /** Ticket key -> the reason the hierarchy's close stored (its Task 4.3, F10). Empty until that task stores one. */
  closed: ReadonlyMap<string, string>;
}

/** The run verdicts reader as the map reads it (spec §4, rows 7 and 8): `not-read` while the reader is absent or empty (before
 *  its first pass, or after a restart), never folded into "not stuck"; else each run's stuck verdict and what it waits behind. */
export function verdictsReadOf(
  all: ReadonlyMap<number, { readonly stuck: object | null; readonly blockedBy: number | null }> | undefined,
): WorkMapInput['verdicts'] {
  if (all === undefined || all.size === 0) return 'not-read';
  return new Map([...all].map(([id, v]) => [id, { stuck: v.stuck !== null, blockedBy: v.blockedBy }] as const));
}

const zeroCounts = (): Record<WorkGroup, number> =>
  Object.fromEntries(WORK_GROUPS.map((g) => [g, 0])) as Record<WorkGroup, number>;

/** The run-state rows of Table 6 (9 to 13), with rows 7 and 8 before them when the verdicts were read. Shared by a ticket's
 *  run and a no-plan run row. Null for a terminal state, which no row of 7 to 13 reads. */
function runStatus(state: RunState, verdict: { stuck: boolean; blockedBy: number | null } | null): WorkStatus | null {
  if (verdict !== null && verdict.stuck) return 'stuck';                                    // row 7
  if (verdict !== null && state === 'planned' && verdict.blockedBy !== null) return 'blocked'; // row 8
  if (state === 'dispatched' || state === 'working') return 'working';                     // row 9
  if (state === 'unknown') return 'state-unknown';                                         // row 10
  if (state === 'awaiting-review') return 'in-review';                                     // row 11
  if (state === 'merging' || state === 'closing') return 'merging';                        // row 12
  if (state === 'planned') return 'queued';                                                // row 13
  return null;
}

/** THE work map (D2). See the spec's Tables 6 and 6a for the order every reading follows. */
export function workMapOf(input: WorkMapInput): WorkMapView {
  const { plan } = input;
  const ended = plan.end !== null;
  const verdictOf = (runId: number | null): { stuck: boolean; blockedBy: number | null } | null =>
    runId === null || input.verdicts === 'not-read' ? null : (input.verdicts.get(runId) ?? null);
  const workRuns = input.runs.filter((r) => r.kind === 'work');
  const runById = new Map(workRuns.map((r) => [r.id, r]));
  const itemsOfRun = (runId: number | null): number[] =>
    runId === null ? [] : input.openItems.filter((i) => i.runId === runId).map((i) => i.id);

  // ── The tickets, each once ────────────────────────────────────────────────────────────────────────────────────────
  const tickets: { epic: EpicView; t: TicketView }[] = plan.epics.flatMap((epic) => epic.tickets.map((t) => ({ epic, t })));
  // A run's own ticket folds into the declared ticket its run is the evidence of (F2; review 2375 F2): one piece of work.
  const folded = new Map<string, string>();
  for (const { t } of tickets) {
    const ev = input.plan.done.get(t.key)?.evidence;
    if (isAutoTicketKey(t.key) || ev === undefined || ev === null || ev === 'malformed' || !('runId' in ev)) continue;
    const auto = autoTicketKey(ev.runId);
    if (tickets.some((x) => x.t.key === auto)) folded.set(auto, t.key);
  }
  const canonical = (key: string): string => folded.get(key) ?? key;

  const statusOf = (epic: EpicView, t: TicketView): { status: WorkStatus; reason: string | null; itemIds: number[] } => {
    if (t.state === 'dropped') return { status: 'dropped', reason: null, itemIds: [] };                       // row 1
    const closedWhy = input.closed.get(t.key);
    if (closedWhy !== undefined) return { status: 'closed', reason: closedWhy, itemIds: [] };                  // row 2
    const verdict: EvidenceVerdict | null = t.state !== 'done' ? null
      : (input.plan.done.get(t.key)?.evidence ?? null) === null ? { holds: false, reason: 'no evidence stored' }
        : (input.evidence.get(t.key) ?? { holds: false, reason: 'the evidence was not read' });
    if (verdict !== null && verdict.holds) return { status: 'done', reason: null, itemIds: [] };               // row 3
    if (ended) return { status: 'left-open', reason: null, itemIds: [] };                                      // row 5, before 4 when ended
    if (verdict !== null && !verdict.holds) return { status: 'done-unverified', reason: verdict.reason, itemIds: [] }; // row 4
    const cp = t.checkpoint === null ? undefined : epic.checkpoints.find((c) => c.key === t.checkpoint);
    const cpItem = cp !== undefined && cp.kind === 'operator-act' ? input.checkpointItems.get(`${epic.key}/${cp.key}`) : undefined;
    const itemIds = [...itemsOfRun(t.runId), ...(cpItem === undefined ? [] : [cpItem])];
    if (itemIds.length > 0) return { status: 'waiting-on-you', reason: null, itemIds };                        // row 6
    const run = t.runId === null ? undefined : runById.get(t.runId);
    if (t.runId !== null) {
      // A held ticket whose run is not in the programme's work runs cannot be read: the server could not read its state.
      const s = run === undefined ? 'state-unknown' : runStatus(run.state, verdictOf(t.runId));                // rows 7 to 13
      if (s !== null) return { status: s, reason: null, itemIds: [] };
    }
    return { status: 'not-started', reason: null, itemIds: [] };                                              // row 14
  };

  // ── The phases' references, resolved ─────────────────────────────────────────────────────────────────────────────
  const declared: readonly PhaseView[] = plan.phases ?? [];
  const numbers = phaseNumbers(declared.map((p) => ({ key: p.key, dropped: p.dropped })));
  const live = declared.filter((p) => !p.dropped);
  const ticketsOfEpic = new Map(plan.epics.map((e) => [e.key, e.tickets.map((t) => t.key)]));
  /** A phase's referenced set: its ticket references and every ticket of each whole epic it references (D15), each once. */
  const referenced = (p: PhaseView): Set<string> => {
    const out = new Set<string>();
    for (const r of p.refs) {
      if (r.kind === 'ticket') out.add(canonical(r.key));
      else for (const k of ticketsOfEpic.get(r.key) ?? []) out.add(canonical(k));
    }
    return out;
  };
  const sets = new Map(live.map((p) => [p.key, referenced(p)]));
  /** The recorded carry of `ticket` out of phase `p`, to a phase that is not dropped (a carry to a dropped phase is void). */
  const carryOut = (p: PhaseView, ticket: string): { to: string; at: number | null } | null => {
    const r = p.refs.find((x) => x.kind === 'ticket' && canonical(x.key) === ticket && x.carriedTo !== null);
    if (r === undefined || r.carriedTo === null || !numbers.has(r.carriedTo)) return null;
    return { to: r.carriedTo, at: r.carriedAt };
  };

  // ── The items ────────────────────────────────────────────────────────────────────────────────────────────────────
  const items: WorkItemView[] = [];
  const byKey = new Map<string, WorkItemView>();
  for (const { epic, t } of tickets) {
    if (folded.has(t.key)) continue;
    const { status, reason, itemIds } = statusOf(epic, t);
    const run = t.runId === null ? undefined : runById.get(t.runId);
    const lastFailed = status === 'not-started'
      ? workRuns.filter((r) => r.state === 'failed' && r.ticketKey === t.key).reduce<number | null>((m, r) => (m === null || r.id > m ? r.id : m), null)
      : null;
    const phases: WorkItemView['phases'] = status === 'dropped' ? [] : live.filter((p) => sets.get(p.key)!.has(t.key)).map((p) => {
      const out = carryOut(p, t.key);
      return {
        key: p.key, number: numbers.get(p.key)!,
        carriedTo: out === null ? null : { key: out.to, number: numbers.get(out.to)! },
        carriedFrom: declared.filter((src) => src.key !== p.key && src.refs.some((x) =>
          x.kind === 'ticket' && canonical(x.key) === t.key && x.carriedTo === p.key)).map((src) => ({ key: src.key, number: numbers.get(src.key) ?? null })),
      };
    });
    const item: WorkItemView = {
      key: t.key, title: t.title, status, group: WORK_STATUS_GROUP[status], reason, epic: { key: epic.key, title: epic.title },
      phases, runId: t.runId, lastMoveAt: run?.lastMoveAt ?? null, wave: run?.wave ?? null,
      doneAt: t.state === 'done' ? (input.plan.done.get(t.key)?.at ?? null) : null, itemIds, lastFailedRunId: lastFailed,
    };
    items.push(item);
    byKey.set(t.key, item);
  }
  const counts = zeroCounts();
  for (const i of items) counts[i.group] += 1;
  const shown = (key: string): boolean => byKey.has(key) && byKey.get(key)!.status !== 'dropped';

  // ── The sequence axis (Table 6a) ─────────────────────────────────────────────────────────────────────────────────
  const order = items.map((i) => i.key);
  const phases: WorkPhaseView[] = live.map((p) => {
    const set = sets.get(p.key)!;
    const keys = order.filter((k) => set.has(k) && shown(k));
    const pc = zeroCounts();
    let carried = 0;
    const times: (number | null)[] = [];
    let own = 0;
    let ownDone = 0;
    for (const k of keys) {
      const item = byKey.get(k)!;
      if (item.status === 'closed') { pc.closed += 1; continue; }                 // closed, counted apart
      const out = carryOut(p, k);
      if (out !== null) { carried += 1; times.push(out.at); continue; }           // carried out
      pc[item.group] += 1;                                                       // done, left open, or outstanding
      own += 1;   // a left-open ticket is counted apart, but it keeps its phase from finishing (§3.1)
      if (item.group === 'done') { ownDone += 1; times.push(item.doneAt); }
    }
    const empty = own === 0 && carried === 0;
    const finished = !empty && ownDone === own;
    const finish: WorkPhaseView['finish'] = !finished ? null
      : times.some((x) => x === null) ? { at: 'unknown' } : { at: Math.max(...(times as number[])) };
    return {
      key: p.key, number: numbers.get(p.key)!, title: p.title, summary: p.summary, finish, counts: pc, carried,
      wholeEpics: p.refs.filter((r) => r.kind === 'epic' && ticketsOfEpic.has(r.key)).map((r) => r.key), items: keys,
    };
  });
  const inAPhase = new Set(phases.flatMap((p) => p.items));
  const notInPhase = live.length === 0 ? [] : order.filter((k) => shown(k) && !inAPhase.has(k));

  // ── The work axis and the strip ──────────────────────────────────────────────────────────────────────────────────
  const epics: WorkEpicView[] = plan.epics.flatMap((e) => {
    const keys = order.filter((k) => byKey.get(k)!.epic!.key === e.key && shown(k));
    const dropped = e.state === 'dropped';
    if (dropped && keys.length === 0) return [];
    const cps = e.checkpoints.filter((c) => c.state !== 'dropped');
    return [{
      key: e.key, title: e.title, url: e.url, dropped,
      done: keys.filter((k) => byKey.get(k)!.group === 'done').length,
      total: keys.filter((k) => COUNTED.has(byKey.get(k)!.group)).length,
      checkpointsMet: cps.filter((c) => c.state === 'met').length, checkpointsTotal: cps.length,
      checkpoints: cps.map((c) => ({ key: c.key, title: c.title, kind: c.kind, state: c.state, metAt: c.metAt, evidence: c.evidence, url: c.url })),
      items: keys,
    }];
  });

  const anyTicket = items.some((i) => i.status !== 'dropped');
  const source: WorkMapView['source'] = ended ? 'ended' : anyTicket ? 'plan' : plan.declared ? 'declared-empty' : 'runs';
  const verdicts: WorkMapView['verdicts'] = input.verdicts === 'not-read' ? 'not-read' : 'read';
  const base = { end: plan.end, verdicts, initiatives: plan.initiatives, doneWhen: plan.doneWhen };

  if (source === 'runs') {
    // The no-plan fallback (§5.1, D9): its work runs, newest first, counted by run, never "N of M".
    const rows: WorkItemView[] = [...workRuns].sort((a, b) => b.id - a.id).map((r) => {
      const itemIds = itemsOfRun(r.id);
      const status: WorkStatus = r.state === 'done' ? 'done' : r.state === 'failed' ? 'failed'
        : itemIds.length > 0 ? 'waiting-on-you' : (runStatus(r.state, verdictOf(r.id)) ?? 'state-unknown');
      const title = r.runTitle === undefined || r.runTitle === null || r.runTitle === r.programTitle ? null : r.runTitle;
      return {
        key: autoTicketKey(r.id), title, status, group: WORK_STATUS_GROUP[status], reason: null, epic: null, phases: [],
        runId: r.id, lastMoveAt: r.lastMoveAt ?? null, wave: r.wave, doneAt: null, itemIds, lastFailedRunId: null,
      };
    });
    const runCounts = zeroCounts();
    for (const i of rows) runCounts[i.group] += 1;
    const waves = workRuns.length === 0 ? null
      : { from: Math.min(...workRuns.map((r) => r.wave)), to: Math.max(...workRuns.map((r) => r.wave)) };
    return { source, ...base, counts: runCounts, items: [], phases: [], notInPhase: [], epics, beforePlan: null, runs: { items: rows, waves } };
  }
  const before = workRuns.filter((r) => r.ticketKey === null).length;
  return {
    source, ...base, counts, items, phases, notInPhase, epics, beforePlan: before === 0 ? null : { runs: before }, runs: null,
  };
}
