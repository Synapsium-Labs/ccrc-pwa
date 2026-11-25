// L1 policy (pure, no I/O), context Coordination: the programme lifecycle's door decisions (programme lifecycle spec
// 2026-11-24 §5, §8, §14; D-8983, D-8987, D-8992, D-8993). The doors (`programmeLifecycleRoutes.ts`, L4) measure, ask these,
// and act; the one writer (`programmeLifecycleStore.ts#decideInTx`, L3) holds the invariant of each write. Nothing here
// reads a clock, the store or the registry.
//
// `edgeDecision` is spec §5's transition table for the state door's five edges and the hand-over. `doorCredential` is
// §14's one credential rule, a table: a narrowing act works while sign-in is dark, a widening or irreversible one takes
// the account gate, and the ones that change who leads or whether a programme lives take its step-up. The Overlord's door
// (W7) is gated by its rung cell alone, never a step-up. `startDecision` is the start row's coordinator rule.
// `endProposalDecision` and `endProposalItem` are §8's proposal, and `confirmEndDecision` its confirm.
import {
  END_EVIDENCE_LINE_MAX, END_EVIDENCE_MAX, END_PROPOSAL_OPTIONS, isEnded,
  type DoorCredential, type ProgrammeDecider, type ProgrammeDoorAct, type ProgrammeDoorRefusal, type ProgrammeEndOutcome, type ProgrammeStateEdge,
  type ProgrammeStoredState,
} from '../../../shared/programmeLifecycle.js';
import { ITEM_STEPS_MAX, ITEM_TEXT_MAX, ITEM_TITLE_MAX } from '../../../shared/ledgers.js';
import { END_REQUEST_REFUSALS, type EndRequestRefusal } from '../../../shared/refusal.js';

/** What an edge is asked of: the stored decision (raw: an out-of-vocabulary value is kept), the placeholder column, and the
 *  count of open runs (any non-terminal run). */
export interface EdgeFacts {
  readonly stored: string;
  readonly placeholder: string | null;
  readonly openRuns: number;
}

/** The state door's request, as parsed: `end` carries its outcome and whether to abandon the open runs, `repair` its target. */
export type EdgeRequest =
  | { readonly edge: 'pause' | 'resume' | 'reopen' }
  | { readonly edge: 'end'; readonly outcome: ProgrammeEndOutcome; readonly abandonRuns: boolean }
  | { readonly edge: 'repair'; readonly to: Exclude<ProgrammeStoredState, 'unknown'> }
  | { readonly edge: 'hand-over' };

/** The words an edge refuses with: the door table's, and the ledger's `programme-ended`. */
export type EdgeRefusal = ProgrammeDoorRefusal | 'programme-ended';

/** The event word `decideInTx` records for each stored-state edge. */
const EVENT_OF = {
  pause: 'pause', resume: 'resume', end: 'ended', reopen: 'reopened', repair: 'repaired',
} as const satisfies Readonly<Record<ProgrammeStateEdge, string>>;

export type EdgeDecision =
  /** A stored-state edge: write `to` through `decideInTx` under `event`; `abandonRuns` asks the door to abandon the open
   *  runs first (through the abandon door's own decision), which only an Abandoned end over open runs does. */
  | { readonly ok: true; readonly kind: 'decide'; readonly to: ProgrammeStoredState; readonly event: (typeof EVENT_OF)[ProgrammeStateEdge];
      readonly abandonRuns: boolean }
  /** The hand-over: the binding moves (through `reclaimProgramme`); no stored state changes. */
  | { readonly ok: true; readonly kind: 'hand-over' }
  | { readonly ok: false; readonly why: EdgeRefusal; readonly detail: string };

const isKnownLive = (s: string): boolean => s === 'active' || s === 'paused';
const unreadable = (s: string): string => `the stored state ${JSON.stringify(s)} is unreadable: repair it`;
const refuse = (why: EdgeRefusal, detail: string): EdgeDecision => ({ ok: false, why, detail });

/**
 * Spec §5's table for the state door and the hand-over. The decider is the same for the operator and the Overlord (R11
 * binds both alike; the credential is `doorCredential`'s). Every edge refuses a placeholder (`programme-provisional`):
 * filing and withdrawing are the placeholder's own doors (W4).
 */
export function edgeDecision(f: EdgeFacts, req: EdgeRequest): EdgeDecision {
  if (f.placeholder !== null) return refuse('programme-provisional', 'a placeholder is filed or withdrawn, never decided');
  const ended = isEnded(f.stored);
  switch (req.edge) {
    case 'pause':
      if (ended) return refuse('programme-ended', 'the programme has ended: reopen it first');
      if (!isKnownLive(f.stored)) return refuse('programme-unknown', unreadable(f.stored));
      return { ok: true, kind: 'decide', to: 'paused', event: EVENT_OF.pause, abandonRuns: false };
    case 'resume':
      if (f.stored !== 'paused') return refuse('not-paused', 'the programme is not paused');
      return { ok: true, kind: 'decide', to: 'active', event: EVENT_OF.resume, abandonRuns: false };
    case 'reopen':
      if (!ended) return refuse('not-ended', 'the programme has not ended');
      return { ok: true, kind: 'decide', to: 'active', event: EVENT_OF.reopen, abandonRuns: false };
    case 'end':
      if (ended) return refuse('programme-ended', 'the programme has already ended');
      if (!isKnownLive(f.stored)) return refuse('programme-unknown', unreadable(f.stored));
      return endOver(f.openRuns, req.outcome, req.abandonRuns, EVENT_OF.end);
    case 'repair':
      if (ended || isKnownLive(f.stored)) return refuse('not-unknown', `the stored state ${JSON.stringify(f.stored)} is readable`);
      // Done and Abandoned follow the end's guards (spec §5's repair row); a repair never abandons a run.
      if (isEnded(req.to)) return endOver(f.openRuns, req.to as ProgrammeEndOutcome, false, EVENT_OF.repair);
      return { ok: true, kind: 'decide', to: req.to, event: EVENT_OF.repair, abandonRuns: false };
    case 'hand-over':
      if (ended) return refuse('programme-ended', 'an ended programme has no coordinator: reopen it first');
      return { ok: true, kind: 'hand-over' };
  }
}

/** An end over `open` runs: none open ends it as asked; open runs refuse unless `abandonRuns`, which only an Abandoned end
 *  may name (spec §5: Done needs no open run, and an end over open runs is always Abandoned, never silently rewritten).
 *  The decisions file asks it too (`programmeDecisionsPolicy.ts`), never naming `abandonRuns`. */
export function endOver(open: number, outcome: ProgrammeEndOutcome, abandonRuns: boolean, event: 'ended' | 'repaired'): EdgeDecision {
  if (open === 0) return { ok: true, kind: 'decide', to: outcome, event, abandonRuns: false };
  if (!abandonRuns) {
    return refuse('programme-runs-open', `${open} run${open === 1 ? ' is' : 's are'} still open: close ${open === 1 ? 'it' : 'them'}, or end with abandonRuns (Abandoned)`);
  }
  if (outcome !== 'abandoned') return refuse('programme-runs-open', 'a programme with open runs ends only as Abandoned, with abandonRuns');
  return { ok: true, kind: 'decide', to: 'abandoned', event, abandonRuns: true };
}


/** Spec §14's ONE credential rule, as a table: narrowing acts (pause, decline) work dark; the start takes the account gate;
 *  the acts that change who leads or whether a programme lives take its step-up. A coordinator never reaches these doors. */
export const OPERATOR_DOOR_CREDENTIALS: Readonly<Record<ProgrammeDoorAct, Exclude<DoorCredential, 'rung'>>> = {
  pause: 'dark-ok', 'decline-end': 'dark-ok',
  start: 'gate',
  resume: 'step-up', end: 'step-up', reopen: 'step-up', repair: 'step-up', 'hand-over': 'step-up', 'confirm-end': 'step-up',
  'apply-decisions': 'step-up',
};

export function doorCredential(act: ProgrammeDoorAct, decider: ProgrammeDecider): DoorCredential {
  return decider === 'overlord' ? 'rung' : OPERATOR_DOOR_CREDENTIALS[act];
}

/** Spec §5's start row, on whether the start names its coordinator: the Overlord must always name one; the operator's start
 *  with none is the start sheet's pick, which arrives with the join sweep (W4), so until then it is refused too. Both answer
 *  `coordinator-required`, so no start is left unbound with nothing to bind it. */
export function startDecision(decider: ProgrammeDecider, coordinatorNamed: boolean):
  { readonly ok: true } | { readonly ok: false; readonly why: 'coordinator-required'; readonly detail: string } {
  if (coordinatorNamed) return { ok: true };
  return { ok: false, why: 'coordinator-required', detail: decider === 'overlord'
    ? 'the Overlord names the session that will coordinate the programme it starts'
    : 'name the session that will coordinate it; the start sheet\'s pick arrives with the join sweep' };
}

/** What the proposal door measured (spec §8). */
export interface EndProposalFacts {
  readonly stored: string;
  readonly placeholder: string | null;
  readonly openRuns: number;
  /** The programme's open end proposal's item id, or null. */
  readonly openProposal: number | null;
  readonly evidence: readonly string[];
}

/** Spec §8's proposal guards, after ownership (the door's `claimsProgramme`, 403 `not-your-programme`). */
export function endProposalDecision(f: EndProposalFacts):
  { readonly ok: true } | { readonly ok: false; readonly why: EdgeRefusal | EndRequestRefusal; readonly detail: string } {
  if (f.placeholder !== null) return { ok: false, why: 'programme-provisional', detail: 'a placeholder is filed, never ended' };
  if (isEnded(f.stored)) return { ok: false, why: 'programme-ended', detail: 'the programme has already ended' };
  if (!isKnownLive(f.stored)) return { ok: false, why: 'programme-unknown', detail: unreadable(f.stored) };
  if (f.openRuns > 0) return { ok: false, why: 'programme-runs-open', detail: `${f.openRuns} run(s) still open: close them before proposing the end` };
  if (f.openProposal !== null) return { ok: false, why: END_REQUEST_REFUSALS.alreadyAsked, detail: `the end is already proposed, item ${f.openProposal}` };
  if (f.evidence.length === 0) return { ok: false, why: 'evidence-required', detail: 'an end proposal needs evidence against the definition of done' };
  return { ok: true };
}

/** Spec §5's confirm row: from Open, Idle or Paused only (a stored `active` or `paused` with no open run), so an ended,
 *  unreadable or placeholder programme is refused as the state door's `end` refuses it, and an open run refuses with the
 *  proposal left open. The decider of "may this programme end" stays one: the confirm asks the same guards as `end`. */
export function confirmEndDecision(f: EdgeFacts):
  { readonly ok: true } | { readonly ok: false; readonly why: Extract<EdgeRefusal, 'programme-ended' | 'programme-unknown' | 'programme-provisional' | 'programme-runs-open'>; readonly detail: string } {
  if (f.placeholder !== null) return { ok: false, why: 'programme-provisional', detail: 'a placeholder is filed or withdrawn, never ended' };
  if (isEnded(f.stored)) return { ok: false, why: 'programme-ended', detail: 'the programme has already ended' };
  if (!isKnownLive(f.stored)) return { ok: false, why: 'programme-unknown', detail: unreadable(f.stored) };
  if (f.openRuns > 0) return { ok: false, why: 'programme-runs-open', detail: `${f.openRuns} run(s) opened since the proposal: it stays open` };
  return { ok: true };
}

/** The evidence as the body gave it: 1 to `END_EVIDENCE_MAX` non-blank strings of at most `END_EVIDENCE_LINE_MAX` characters.
 *  An absent or empty list is `[]` (the decision's `evidence-required`); any other shape is null (`bad-request`). */
export function parseEvidence(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > END_EVIDENCE_MAX) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.trim() === '' || v.length > END_EVIDENCE_LINE_MAX) return null;
    out.push(v.trim());
  }
  return out;
}

const clip = (s: string, max: number): string => ([...s].length <= max ? s : `${[...s].slice(0, max - 1).join('')}…`);

/** The proposal's item (spec §8, `endRequest.ts`'s shape): a decide item whose why is the coordinator's case, whose steps are
 *  the evidence against each pinned line of the definition of done (positionally; a pinned line with no entry reads "no
 *  evidence given", and entries past the pin follow it), or the free lines under "no definition of done was pinned", and
 *  whose two options are "End the programme" and "Keep it open". */
export function endProposalItem(input: {
  readonly title: string; readonly outcome: ProgrammeEndOutcome; readonly why: string;
  readonly evidence: readonly string[]; readonly doneWhen: readonly string[] | null;
}): { title: string; why: string; how: string[]; options: string[]; recommended: number; recommendedWhy: string } {
  const outcome = input.outcome === 'done' ? 'Done' : 'Abandoned';
  const lines: string[] = [];
  if (input.doneWhen === null || input.doneWhen.length === 0) {
    lines.push('No definition of done was pinned; the coordinator\'s evidence:', ...input.evidence);
  } else {
    input.doneWhen.forEach((d, i) => lines.push(`${d}: ${input.evidence[i] ?? 'no evidence given'}`));
    lines.push(...input.evidence.slice(input.doneWhen.length));
  }
  const how = lines.map((l) => clip(l, ITEM_TEXT_MAX));
  const kept = how.length <= ITEM_STEPS_MAX ? how : [...how.slice(0, ITEM_STEPS_MAX - 1), `…and ${how.length - ITEM_STEPS_MAX + 1} more lines`];
  return {
    title: clip(`End programme as ${outcome}: ${input.title}`, ITEM_TITLE_MAX),
    why: clip(`${input.why}\nProposed outcome: ${outcome}. Its coordinator proposed this end; the operator or the Overlord decides it.`, ITEM_TEXT_MAX),
    how: kept,
    options: [...END_PROPOSAL_OPTIONS],
    recommended: 0,
    recommendedWhy: 'Its coordinator proposes the end, with the evidence above.',
  };
}
