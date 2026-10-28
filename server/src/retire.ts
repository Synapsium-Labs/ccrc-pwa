/**
 * WHEN A WORKSPACE IS RETIRED (D-7166; ARCH-44, consolidation spec K1, C4 "Policies, not lanes"): the one gate decider.
 *
 * Three server lanes retire a workspace with a destructive ccd verb, each through its own executor: temp-orphan
 * (`ws-collect`, `coord/collectTempRoot.ts`), archive-expired (`ws-expire`, `coord/expireArchived.ts`) and child-spent
 * (`ws-reclaim`, `coord/childReclaim.ts`). Before the verb each runs the same KINDS of step (an id or record re-read, the
 * capability, the switches, the store, presence, the audit that mints the token, the switches again nearest the argv),
 * but in its own order, with its own words, and the order is behaviour. So they are three ROWS of one gate here: every
 * way they differ is a field of the row (`RetireReason`), and the row lives with its reason, beside the words its judges
 * answer. This file imports none of them (the rows import it).
 *
 * `decideRetire` walks a row's steps in the row's order (`decide`, then `audit`, then `act`) over the facts read so far.
 * For the first step with no fact it asks for that step (`{ need }`), so no fact is ever read out of order and no step
 * the old ladder never reached is ever read. A step's judge either answers the reason's own outcome word or passes;
 * after the last step the act may run (`{ act: true }`). It never asks which reason it runs (pinned by
 * `single-definition/late-census.test.ts`): only the row's fields steer it.
 *
 * What is NOT here: every read (the readers, the `ccdCan` questions and the switch wrappers stay in each reason's file,
 * D-7177, D-7224), every side effect (a reader's own, or the port's outcome hook, D-7199), each reason's lane verdict
 * (named by its row as `evidence`, never called, D-7173), the act, the notice and the queue.
 *
 * L1: decisions only. It has no runtime import.
 */

/** The three reasons, by name. A row's `name` is one of these, referenced, never re-spelled. */
export const RETIRE_REASON_NAMES = {
  tempOrphan: 'temp-orphan', archiveExpired: 'archive-expired', childSpent: 'child-spent',
} as const;
export type RetireReasonName = (typeof RETIRE_REASON_NAMES)[keyof typeof RETIRE_REASON_NAMES];

/** How a reason lists the registry for its switches. `measured-once`: ONE measured listing per listing step reads every
 *  marker the step names (expiry, the collector). `plain-per-marker`: one plain listing per marker, each its own step
 *  (child-spent's pause, then its own off switch). Merging the one or splitting the other changes which sentence an
 *  unlistable registry answers and how many registry reads a pass costs. */
export const RETIRE_LISTING_MODES = { measuredOnce: 'measured-once', plainPerMarker: 'plain-per-marker' } as const;
export type RetireListingMode = (typeof RETIRE_LISTING_MODES)[keyof typeof RETIRE_LISTING_MODES];

/** Whether presence defers past the request's ceiling. `no-ceiling`: for as long as it lasts (spec §6 O6 (a)).
 *  `until-ceiling`: only until the request says its defer ceiling was reached. */
export const RETIRE_PRESENCE_RULES = { noCeiling: 'no-ceiling', untilCeiling: 'until-ceiling' } as const;
export type RetirePresenceRule = (typeof RETIRE_PRESENCE_RULES)[keyof typeof RETIRE_PRESENCE_RULES];

/** Who writes the outcome's feed row: the `executor` itself, or the `lane` that folds the executor's report. */
export const RETIRE_NOTICE_HOMES = { executor: 'executor', lane: 'lane' } as const;
export type RetireNoticeHome = (typeof RETIRE_NOTICE_HOMES)[keyof typeof RETIRE_NOTICE_HOMES];

/** One name per point at which one of today's three ladders can answer (D-7199). A row uses a name at most once. */
export const RETIRE_STEPS = {
  /** child-spent: the record re-read and its re-listing. */
  record: 'record',
  /** temp-orphan, archive-expired: the id predicate. */
  id: 'id',
  /** all three: the reason's capability rows. */
  capability: 'capability',
  /** all three: the reason's own switch wrapper's answer, as it stands (D-7224). */
  switches: 'switches',
  /** child-spent: `child-reclaim-disabled` at decide. */
  offSwitch: 'off-switch',
  /** child-spent, archive-expired: the store's binding reads. */
  store: 'store',
  /** child-spent: coordinating, any state. */
  coordinated: 'coordinated',
  /** child-spent: the generation re-read. */
  generation: 'generation',
  /** all three: presence, by the row's presence rule. */
  presence: 'presence',
  /** all three: the audit that mints the token, judged on its own answer before its verdict. */
  audit: 'audit',
  /** archive-expired: the audit read another archive. */
  archiveMatch: 'archive-match',
  /** all three: the audit's verdict. */
  auditVerdict: 'audit-verdict',
  /** child-spent: the audit's child marker names another run. */
  markerMatch: 'marker-match',
  /** temp-orphan: a clear landed while the audit was in flight. */
  staleGeneration: 'stale-generation',
  /** temp-orphan: observation 1 against the audit (read before the hold, judged with it). */
  licence: 'licence',
  /** temp-orphan: the open-run hold on observation 2, then the licence's answer. */
  hold: 'hold',
  /** child-spent: the audit's generation. */
  auditGeneration: 'audit-generation',
  /** temp-orphan, archive-expired: the switches nearest the argv. */
  switchesLast: 'switches-last',
  /** child-spent: `child-reclaim-disabled` at the act. */
  offSwitchLast: 'off-switch-last',
  /** temp-orphan: the marker's latch (its reader writes it; it always passes). */
  latch: 'latch',
  /** temp-orphan: the resolved switch's stop and not-running arms. */
  lane: 'lane',
  /** temp-orphan: a flip of the effective switch. */
  flip: 'flip',
  /** temp-orphan: a control state that could not be proved coherent. */
  safety: 'safety',
  /** temp-orphan: observation 1 still stands. */
  licenceStands: 'licence-stands',
  /** temp-orphan: presence again, nearest the argv. */
  presenceLast: 'presence-last',
  /** temp-orphan: the hold again, nearest the argv. */
  holdLast: 'hold-last',
  /** temp-orphan, archive-expired: the shadow arm. */
  live: 'live',
  /** temp-orphan: the loose arm's own marker and capability. */
  looseMarker: 'loose-marker',
} as const;
export type RetireStep = (typeof RETIRE_STEPS)[keyof typeof RETIRE_STEPS];

/** What happens to a step's reader rejecting (D-7226). `judged`: the rejection is the step's fact (`RetireRejected`), and
 *  the step's judge answers its sentence. `propagate`: the rejection rejects the executor, as a bare `await` does today,
 *  so the decider never sees it (a reader whose wrapper folds its own failure answers that fold as its fact). */
export type RetireOnReject = 'propagate' | 'judged';

/** A `judged` step's fact when its read rejected. */
export class RetireRejected {
  constructor(readonly rejected: unknown) {}
}

/** The fact of a step that reads nothing of its own: its judge reads the earlier facts. */
export type RetireNoRead = true;

/** One step of a row: its name, whether its reader answers a plain value (`sync`, so the loop never awaits it), its
 *  rejection mode, and, for a listing step, the markers its listing reads. */
export interface RetireStepSpec {
  readonly step: RetireStep;
  readonly sync: boolean;
  readonly onReject: RetireOnReject;
  readonly markers?: readonly string[];
}

/** A reason's facts: each step's fact, absent until its reader has answered. */
export type RetireFactSet = { readonly [S in RetireStep]?: unknown };

/** A step's judge: pure, over its own fact, the facts read before it and the request. It answers the reason's own outcome
 *  word, or `null` to pass. */
export type RetireJudge<Req, Facts, Out, F> = (fact: F, facts: Facts, req: Req) => Out | null;
export type RetireJudges<Req, Facts extends RetireFactSet, Out> = {
  readonly [S in keyof Facts & RetireStep]?: RetireJudge<Req, Facts, Out, Exclude<Facts[S], undefined>>;
};

/** A reason's lane verdict, named by reference (D-7173): the gate never calls it. */
export type RetireEvidence = (...args: never[]) => unknown;

/** One reason's row. Every way the three gates differ is a field here. `decide` runs before the audit and `act` after it;
 *  `judge` holds each step's judge (a step with none passes); `evidence` names the reason's lane verdict. */
export interface RetireReason<Req, Facts extends RetireFactSet, Out> {
  readonly name: RetireReasonName;
  readonly decide: readonly RetireStepSpec[];
  readonly audit: RetireStepSpec & { readonly step: typeof RETIRE_STEPS.audit };
  readonly act: readonly RetireStepSpec[];
  readonly listing: RetireListingMode;
  readonly presence: RetirePresenceRule;
  readonly notice: RetireNoticeHome;
  readonly judge: RetireJudges<Req, Facts, Out>;
  readonly evidence: readonly RetireEvidence[];
}

/** The decider's answer: read this step next, this outcome ends the gate, or the act may run. */
export type RetireDecision<Out> = { readonly need: RetireStep } | { readonly outcome: Out } | { readonly act: true };

/** Presence, by the row's rule: a person looking defers, unless the rule is `until-ceiling` and the request says its
 *  ceiling was reached. */
export function presenceJudge<Req, Facts, Out>(
  rule: RetirePresenceRule, answer: (req: Req, facts: Facts) => Out, ceilingReached: (req: Req) => boolean = () => false,
): RetireJudge<Req, Facts, Out, boolean> {
  return (visible, facts, req) =>
    (visible && !(rule === RETIRE_PRESENCE_RULES.untilCeiling && ceilingReached(req)) ? answer(req, facts) : null);
}

/** A capability the box does not advertise: the fact lists each capability the row's reader asked, in the row's order
 *  (`true`: advertised), and the first `false` answers its own word. The `ccdCan` questions stay in the reader. */
export function capabilityJudge<Req, Facts, Out>(
  answers: readonly ((req: Req, facts: Facts) => Out)[],
): RetireJudge<Req, Facts, Out, readonly boolean[]> {
  return (asked, facts, req) => {
    const i = asked.indexOf(false);
    if (i < 0) return null;
    const answer = answers[i];
    if (answer === undefined) throw new Error(`capabilityJudge: capability ${i} has no answer`);
    return answer(req, facts);
  };
}

/**
 * The gate: walk the row's steps in order over the facts read so far. The first step with no fact is the step to read
 * next; a step whose judge answers ends the gate; past the last step, the act may run. A `propagate` step's rejection
 * never reaches a judge: it is thrown, as the executor's own bare `await` would.
 */
export function decideRetire<Req, Facts extends RetireFactSet, Out>(
  facts: Facts, reason: RetireReason<Req, Facts, Out>, req: Req,
): RetireDecision<Out> {
  const judges = reason.judge as { readonly [S in RetireStep]?: RetireJudge<Req, Facts, Out, unknown> };
  for (const spec of [...reason.decide, reason.audit, ...reason.act]) {
    const fact = (facts as RetireFactSet)[spec.step];
    if (fact === undefined) return { need: spec.step };
    if (fact instanceof RetireRejected && spec.onReject !== 'judged') throw fact.rejected;
    const out = judges[spec.step]?.(fact, facts, req) ?? null;
    if (out !== null) return { outcome: out };
  }
  return { act: true };
}
