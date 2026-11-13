// L1, context C3 (Session Conversation): `renewalDue`, the one decider of when a long-lived role's generation is due a
// renewal, and of which class (Overlord spec §3.3.11, H13, Table 3.3.11b; C49: total over the roles). Pure: every
// reading arrives as an argument, and time arrives as numbers.
//
// Monotonic by construction (§11.7): a row whose input is unmeasured does not fire and is named in `blind`, so an
// unmeasured, stale or missing reading never makes a renewal due, and never moves the answer to an earlier row.
import type { FleetRole } from '../../../shared/fleetRoles.js';
import {
  HARD_CAP_TOKENS, IDLE_FLOOR_FRACTION, IDLE_SOFT_MS, RESUMED_LONG_FRACTION,
  SOFT_CEILING_FRACTION, TURNS_SOFT, WAVE_BOUNDARY_FLOOR_FRACTION, type RenewalTrigger, type TriggerClass,
} from '../../../shared/continuity.js';

/** A reading: measured with its value, or unmeasured with the reason (a stale sample is unmeasured, never "below"). */
export type Reading<T> = { readonly kind: 'measured'; readonly value: T } | { readonly kind: 'unmeasured'; readonly why: string };

export interface RenewalInputs {
  readonly role: FleetRole;
  /** The statusline sidecar's token count and window size. */
  readonly contextTokens: Reading<number>; readonly windowTokens: Reading<number>;
  /** Overlord: the fitted ceiling from probes at depth; the caller passes the hard cap until probes fit one. */
  readonly fittedCeilingTokens: Reading<number>;
  /** Overlord: operator messages and answered holds this generation (W1's rows). */
  readonly turns: Reading<number>;
  /** This generation's compactions (`compactionsSince`). */
  readonly compactions: Reading<number>;
  /** How long the session has been idle (the turn marker). */
  readonly idleMs: Reading<number>;
  /** Overlord: the daily backstop's hour has come. */
  readonly backstopDue: Reading<boolean>;
  /** The roll's own "behind" test. */
  readonly installBehind: Reading<boolean>;
  readonly probeFailedUnfixed: Reading<boolean>;
  /** Overlord: the model-switch journal (W1). */
  readonly modelDrift: Reading<boolean>;
  /** The start report: this generation's start resumed a conversation, and on another model class. */
  readonly startResumed: Reading<{ readonly resumed: boolean; readonly otherClass: boolean }>;
  readonly entryRetired: Reading<boolean>;
  readonly termRaised: Reading<boolean>;
  readonly accountOutsideSet: Reading<boolean>;
  readonly classUnservable: Reading<boolean>;
  /** Overlord: the account's load is past the harder line, the session is idle, and another account can take it. */
  readonly accountLoadMove: Reading<boolean>;
  /** The PreCompact arm refused a proactive compaction. */
  readonly compactionRefused: Reading<boolean>;
  readonly classChanged: Reading<boolean>;
  readonly evaluationDue: Reading<boolean>;
  readonly notLocal: Reading<boolean>;
  /** Coordinator: wave N+1's run is open and wave N's is closed. */
  readonly waveBoundary: Reading<boolean>;
  /** The operator's Renew now. */
  readonly renewNow: boolean;
}

export type RenewalDue =
  | { readonly due: false; readonly blind: readonly RenewalTrigger[] }
  | { readonly due: true; readonly cls: TriggerClass; readonly why: RenewalTrigger; readonly blind: readonly RenewalTrigger[] };

/** Table 3.3.11b's class column, and the operator's Renew now, which is hard. */
export const TRIGGER_CLASS: Readonly<Record<RenewalTrigger, TriggerClass>> = {
  'hard-cap': 'hard', 'soft-ceiling': 'soft', turns: 'soft', 'two-compactions': 'soft', idle: 'soft',
  'daily-backstop': 'soft', 'new-install': 'soft', 'probe-failed': 'soft', 'model-drift': 'hard',
  'resumed-other-class': 'hard', 'entry-retired': 'hard', 'term-raised': 'hard', 'account-outside-set': 'hard',
  'class-unservable': 'hard', 'account-load': 'hard', 'compaction-refused': 'soft', 'class-changed': 'soft',
  'evaluation-due': 'soft', 'not-local': 'hard', 'resumed-long': 'hard', 'wave-boundary': 'soft', operator: 'hard',
};

/** Table 3.3.11b, per role, the operator's Renew now first, then the hard rows, then the soft rows, each in the
 *  table's order. A role that is not long-lived has no row: its wave is its renewal. Total over `FleetRole` (C49). */
export const RENEWAL_ROWS: Readonly<Record<FleetRole, readonly RenewalTrigger[]>> = {
  overlord: ['operator', 'hard-cap', 'model-drift', 'resumed-other-class', 'entry-retired', 'term-raised',
    'account-outside-set', 'class-unservable', 'account-load', 'not-local', 'resumed-long',
    'soft-ceiling', 'turns', 'two-compactions', 'idle', 'daily-backstop', 'new-install', 'probe-failed',
    'compaction-refused', 'class-changed', 'evaluation-due'],
  auditor: [],
  replay: [],
  worker: [],
  reviewer: [],
  coordinator: ['operator', 'hard-cap', 'not-local', 'resumed-long',
    'two-compactions', 'new-install', 'probe-failed', 'compaction-refused', 'wave-boundary'],
  plain: [],
};

/** The hard cap: 250k tokens or half the window, whichever is lower (Table 3.3.11b). */
export function hardCapTokens(windowTokens: number): number {
  return Math.min(HARD_CAP_TOKENS, windowTokens / 2);
}

/** A row's verdict: fires, does not fire, or cannot tell because an input it needs is unmeasured. */
type Verdict = boolean | 'blind';

/** Kleene's and: false if any part is false, true if every part is true, else blind. A measured false decides the row
 *  whatever the unmeasured parts would say, so it is not blind. */
function all(...parts: Verdict[]): Verdict {
  if (parts.includes(false)) return false;
  return parts.every((p) => p === true) ? true : 'blind';
}

/** A measured count or duration: finite and not negative. Anything else is read as unmeasured. */
const num = (r: Reading<number>): number | null =>
  r.kind === 'measured' && Number.isFinite(r.value) && r.value >= 0 ? r.value : null;

const flag = (r: Reading<boolean>): Verdict => (r.kind === 'measured' ? r.value === true : 'blind');

/** The hard cap for this reading of the window, or null when the window is unmeasured or not a positive size. */
function capOf(i: RenewalInputs): number | null {
  const w = num(i.windowTokens);
  return w === null || w <= 0 ? null : hardCapTokens(w);
}

/** Context strictly above `fraction` of the hard cap (or at or above the whole cap when `atCap`). */
function contextPast(i: RenewalInputs, fraction: number, atCap: boolean): Verdict {
  const c = num(i.contextTokens);
  const cap = capOf(i);
  if (c === null || cap === null) return 'blind';
  return atCap ? c >= cap * fraction : c > cap * fraction;
}

const ge = (r: Reading<number>, t: number): Verdict => { const v = num(r); return v === null ? 'blind' : v >= t; };
const gt = (r: Reading<number>, t: number): Verdict => { const v = num(r); return v === null ? 'blind' : v > t; };

function resumed(i: RenewalInputs, otherClass: boolean): Verdict {
  if (i.startResumed.kind === 'unmeasured') return 'blind';
  return i.startResumed.value.resumed && (!otherClass || i.startResumed.value.otherClass);
}

/** One predicate per trigger, so a trigger without one is a compile error. */
const PREDICATES: Readonly<Record<RenewalTrigger, (i: RenewalInputs) => Verdict>> = {
  operator: (i) => i.renewNow,
  'hard-cap': (i) => contextPast(i, 1, true),
  'soft-ceiling': (i) => {
    const c = num(i.contextTokens);
    const f = num(i.fittedCeilingTokens);
    return c === null || f === null ? 'blind' : c > f * SOFT_CEILING_FRACTION;
  },
  turns: (i) => gt(i.turns, TURNS_SOFT),
  'two-compactions': (i) => ge(i.compactions, 2),
  idle: (i) => all(ge(i.idleMs, IDLE_SOFT_MS), contextPast(i, IDLE_FLOOR_FRACTION, false)),
  'daily-backstop': (i) => flag(i.backstopDue),
  'new-install': (i) => flag(i.installBehind),
  'probe-failed': (i) => flag(i.probeFailedUnfixed),
  'model-drift': (i) => flag(i.modelDrift),
  'resumed-other-class': (i) => resumed(i, true),
  'entry-retired': (i) => flag(i.entryRetired),
  'term-raised': (i) => flag(i.termRaised),
  'account-outside-set': (i) => flag(i.accountOutsideSet),
  'class-unservable': (i) => flag(i.classUnservable),
  'account-load': (i) => flag(i.accountLoadMove),
  'compaction-refused': (i) => flag(i.compactionRefused),
  'class-changed': (i) => flag(i.classChanged),
  'evaluation-due': (i) => flag(i.evaluationDue),
  'not-local': (i) => flag(i.notLocal),
  'resumed-long': (i) => all(resumed(i, false), contextPast(i, RESUMED_LONG_FRACTION, false)),
  'wave-boundary': (i) => all(flag(i.waveBoundary), contextPast(i, WAVE_BOUNDARY_FLOOR_FRACTION, false)),
};

/** The first firing row of `RENEWAL_ROWS[role]`, hard rows before soft ones; `blind` names every row of the role that
 *  could not be decided because an input it needs was unmeasured (such a row never fires). */
export function renewalDue(i: RenewalInputs): RenewalDue {
  const blind: RenewalTrigger[] = [];
  let why: RenewalTrigger | null = null;
  for (const t of RENEWAL_ROWS[i.role]) {
    const v = PREDICATES[t](i);
    if (v === 'blind') blind.push(t);
    else if (v && why === null) why = t;
  }
  return why === null ? { due: false, blind } : { due: true, cls: TRIGGER_CLASS[why], why, blind };
}
