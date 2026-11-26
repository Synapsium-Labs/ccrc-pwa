// L1 policy (pure), context Coordination: the backfill door's decisions (programme lifecycle spec 2026-11-24 §13, R9; W3;
// D-8990). `POST /api/programmes/decisions` takes the operator's private list of `{slug, to, why}`; this says what each
// entry does and how the answer reads. Every edge is spec §5's, asked of the one decider (`edgeDecision`, `endOver`): the
// file has no edge of its own, never abandons a run, never overturns a recorded end, and never resolves a conflict. The
// route (`programmeLifecycleRoutes.ts`, L4) measures the facts and writes through `decideInTx`. Nothing here reads a clock,
// the store or the registry.
import { ITEM_TEXT_MAX } from '../../../shared/ledgers.js';
import {
  endRecorded, isEnded, isProgrammeDecisionTarget, lifecycleOf, PROGRAMME_DECISION_TARGETS, PROGRAMME_DECISIONS_MAX, PROGRAMME_LIFECYCLES,
  type ProgrammeConflictGroup, type ProgrammeDecisionRefusal, type ProgrammeDecisionRow, type ProgrammeDecisionsAnswer,
  type ProgrammeDecisionTarget, type ProgrammeLifecycle, type ProgrammeStoredState,
} from '../../../shared/programmeLifecycle.js';
import { edgeDecision, endOver, type EdgeDecision, type EdgeRequest } from './programmeEdgePolicy.js';
import type { LifecycleRowFacts } from './programmeLifecycleView.js';

/** One entry as parsed. `why` is null when it is missing, blank or over `ITEM_TEXT_MAX`: a refusal of its row, not of the file. */
export interface DecisionEntry {
  readonly slug: string;
  readonly to: ProgrammeDecisionTarget;
  readonly why: string | null;
}

/** The entries of the file, or the first shape fault: the file is a list of `{slug, to, why}`, read whole or not at all. */
export function parseDecisions(raw: unknown): { readonly ok: true; readonly entries: DecisionEntry[] } | { readonly ok: false; readonly detail: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > PROGRAMME_DECISIONS_MAX) {
    return { ok: false, detail: `decisions is a list of 1 to ${PROGRAMME_DECISIONS_MAX} entries {slug, to, why}` };
  }
  const entries: DecisionEntry[] = [];
  for (const [i, v] of raw.entries()) {
    const e = typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
    const slug = e?.['slug'];
    if (e === null || typeof slug !== 'string' || slug === '') return { ok: false, detail: `entry ${i + 1}: slug is a programme slug` };
    const to = e['to'];
    if (!isProgrammeDecisionTarget(to)) return { ok: false, detail: `entry ${i + 1}: to is one of ${PROGRAMME_DECISION_TARGETS.join(', ')}` };
    const why = e['why'];
    entries.push({ slug, to, why: typeof why === 'string' && why.trim() !== '' && why.length <= ITEM_TEXT_MAX ? why.trim() : null });
  }
  return { ok: true, entries };
}

/** One programme as the door measured it: the view's facts (the reserved row never among them) and the end's record. */
export interface DecisionFacts extends LifecycleRowFacts {
  readonly planEnd: string | null;
}

/** What one entry does: refused; nothing to write; or one stored decision, written by `decideInTx` under `event`. */
export type EntryPlan =
  | { readonly kind: 'refused'; readonly code: ProgrammeDecisionRefusal; readonly detail: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'decide'; readonly to: ProgrammeStoredState; readonly event: Extract<EdgeDecision, { kind: 'decide' }>['event'];
      readonly why: string;
      /** The event's detail: what the file asked (`active`, `idle` and `open` are one stored state), and the unreadable value a
       *  repair replaces (spec §5's repair row). */
      readonly detail: { readonly decided: ProgrammeDecisionTarget; readonly unreadable?: string } };

const refuse = (code: ProgrammeDecisionRefusal, detail: string): EntryPlan => ({ kind: 'refused', code, detail });

/** A stored value no decision can leave but a repair: `unknown`, or out of vocabulary. */
const isUnreadable = (state: string): boolean => !isEnded(state) && state !== 'active' && state !== 'paused';

/** An edge's answer as an entry's plan, its refusal's word kept. */
function fromEdge(d: EdgeDecision, f: DecisionFacts, to: ProgrammeDecisionTarget, why: string): EntryPlan {
  if (!d.ok) return refuse(d.why, d.why === 'programme-runs-open' ? `${f.open} open run${f.open === 1 ? '' : 's'}: the file never abandons a run` : d.detail);
  if (d.kind !== 'decide') return { kind: 'none' };
  return { kind: 'decide', to: d.to, event: d.event, why, detail: { decided: to, ...(isUnreadable(f.state) ? { unreadable: f.state } : {}) } };
}

/**
 * Spec §13's rules for an entry over one real programme. `active`, `idle` and `open` are one decision, stored `active`
 * (nothing, or the resume, reopen or repair edge), and which of the three then shows is the runs' answer. `paused` is the
 * pause edge, or a repair. `done` and `abandoned` are the end's, refused over open runs. Equal targets write nothing. A
 * recorded end is moved only by a reopen; an end the migration kept (`endRecorded` false, spec §13 step 4) is recorded by
 * this decision, whichever outcome it names.
 */
function realEntryPlan(to: ProgrammeDecisionTarget, why: string, f: DecisionFacts): EntryPlan {
  const ended = isEnded(f.state);
  const unreadable = isUnreadable(f.state);
  const ask = (req: EdgeRequest): EntryPlan =>
    fromEdge(edgeDecision({ stored: f.state, placeholder: f.placeholder, openRuns: f.open }, req), f, to, why);
  if (to === 'done' || to === 'abandoned') {
    if (unreadable) return ask({ edge: 'repair', to });
    if (!ended) return ask({ edge: 'end', outcome: to, abandonRuns: false });
    const end = endOver(f.open, to, false, 'ended');
    if (!end.ok || !endRecorded(f.state, f.planEnd)) return fromEdge(end, f, to, why);
    return f.state === to ? { kind: 'none' } : refuse('programme-ended', `it ended ${f.state}, recorded: a reopen comes first`);
  }
  if (to === 'paused') {
    if (f.state === 'paused') return { kind: 'none' };
    return ask(unreadable ? { edge: 'repair', to } : { edge: 'pause' });
  }
  if (f.state === 'active') return { kind: 'none' };
  return ask(unreadable ? { edge: 'repair', to: 'active' } : { edge: ended ? 'reopen' : 'resume' });
}

/** The slugs the file names more than once: every entry of one is refused, so no reading of which was meant is guessed. */
export function repeatedSlugs(entries: readonly DecisionEntry[]): ReadonlySet<string> {
  const times = new Map<string, number>();
  for (const e of entries) times.set(e.slug, (times.get(e.slug) ?? 0) + 1);
  return new Set([...times].filter(([, n]) => n > 1).map(([slug]) => slug));
}

/** What one entry does (spec §13). `facts` is null when no row of that slug is a programme. */
export function entryPlan(e: DecisionEntry, facts: DecisionFacts | null, q: { readonly repeated: boolean; readonly reserved: boolean }): EntryPlan {
  if (q.repeated) return refuse('duplicate-entry', 'the file names this programme more than once');
  if (q.reserved) return refuse('reserved-programme', 'the reserved row is not a programme');
  if (facts === null) return refuse('unknown-programme', `no programme ${e.slug}`);
  if (facts.placeholder !== null) return refuse('programme-provisional', 'a placeholder is filed or withdrawn, never decided');
  if (e.why === null) return refuse('why-required', `an entry needs a why of 1 to ${ITEM_TEXT_MAX} characters`);
  return realEntryPlan(e.to, e.why, facts);
}

const shownOf = (f: DecisionFacts, state: string): ProgrammeLifecycle | null =>
  lifecycleOf(state, f.placeholder, { open: f.open, dispatched: f.dispatched });

/** One entry's answer, before (`applied` false) or after its write. `facts` are the ones its plan was decided over, so the
 *  shown state is the runs' answer to the decision it writes, and a mismatch is reported and never forced. */
export function entryRow(e: DecisionEntry, plan: EntryPlan, facts: DecisionFacts | null, applied: boolean): ProgrammeDecisionRow {
  const real = facts !== null && facts.placeholder === null ? facts : null;
  const base = { slug: e.slug, to: e.to, stored: real?.state ?? null, openRuns: real?.open ?? null };
  if (plan.kind === 'refused') {
    return { ...base, outcome: `refused:${plan.code}`, shown: real === null ? null : shownOf(real, real.state), edge: null, detail: plan.detail };
  }
  const shown = real === null ? null : shownOf(real, plan.kind === 'decide' ? plan.to : real.state);
  const edge = plan.kind === 'decide' ? plan.event : null;
  if (shown !== e.to) {
    return { ...base, outcome: 'mismatch', shown, edge, detail: `its runs show ${shown ?? 'nothing'}: the runs decide it, nothing is forced` };
  }
  return { ...base, outcome: plan.kind === 'none' ? 'unchanged' : applied ? 'applied' : 'would-apply', shown, edge };
}

/** Spec §13's conflicts, grouped from the rows' own (`conflictsOf`): by the one session, or by the one programme. */
export function conflictGroups(facts: readonly LifecycleRowFacts[]): ProgrammeConflictGroup[] {
  const sessions = new Map<string, { slug: string; openRuns: number }[]>();
  const several: ProgrammeConflictGroup[] = [];
  for (const f of facts) {
    if (f.conflict === null) continue;
    if (f.conflict.kind === 'programme-several-claimants') {
      several.push({ kind: f.conflict.kind, slug: f.slug, claimants: f.conflict.claimants, openRuns: f.open });
      continue;
    }
    for (const s of f.conflict.claimants) sessions.set(s, [...(sessions.get(s) ?? []), { slug: f.slug, openRuns: f.open }]);
  }
  return [...[...sessions].map(([session, programmes]) => ({ kind: 'session-in-several' as const, session, programmes })), ...several];
}

/** The answer (spec §13): the entries, and apart from them everything the file does not name. `after` is every row but the
 *  reserved one as it stands once the writes are done (a preview: as it stands now). The counts are over the programmes the
 *  file names, each once, as their entries show them. */
export function decisionsAnswer(input: {
  readonly apply: boolean; readonly entries: readonly ProgrammeDecisionRow[]; readonly after: readonly LifecycleRowFacts[]; readonly reservedRow: boolean;
}): ProgrammeDecisionsAnswer {
  const named = new Map(input.entries.map((e) => [e.slug, e]));
  const real = input.after.filter((f) => f.placeholder === null);
  const listed = real.filter((f) => named.has(f.slug));
  const counts = Object.fromEntries(PROGRAMME_LIFECYCLES.map((l) => [l, 0])) as Record<ProgrammeLifecycle, number>;
  for (const f of listed) { const shown = named.get(f.slug)!.shown; if (shown !== null) counts[shown]++; }
  return {
    ok: true, apply: input.apply, entries: input.entries, listed: listed.length, counts,
    unlisted: real.filter((f) => !named.has(f.slug)).map((f) => ({ slug: f.slug, shown: lifecycleOf(f.state, f.placeholder, f) })),
    placeholders: input.after.filter((f) => f.placeholder === 'unfiled').length,
    conflicts: conflictGroups(input.after), reservedRow: input.reservedRow,
  };
}
