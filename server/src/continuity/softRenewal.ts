// L1, context C3 (Session Conversation): `softRenewalMay`, the preconditions a soft renewal waits for, and
// `earlyWhileAway`, the early renewal at a break (Overlord spec §3.3.11, "How long a trigger waits (R19)", "The
// preconditions", "The soft budget"; C50 for the coordinator's ordering). Pure: every reading arrives as an argument,
// and every time is observed milliseconds (§11.5), counted by the caller with `observeTime`.
//
// The hold table is the hibernate lane's (`hibernateVerdict`, `server/src/coord/hibernate.ts`): its answer arrives as
// an input, and this module adds no second idle test. Monotonic by construction: an unmeasured reading, or a number
// that is not one, never turns a wait into a start.
import type { FleetRole } from '../../../shared/fleetRoles.js';
import {
  BREAK_NO_MESSAGE_MS, BREAK_PLACE_HIDDEN_MS, EARLY_WHILE_AWAY_FRACTION, LEAST_AGE_MS, ON_SCHEDULE_WAIT_MS, SOFT_BUDGET,
  SOFT_CEILING_FRACTION, TURNS_SOFT,
} from '../../../shared/continuity.js';
import { RENEWAL_ROWS, measuredCount, type Reading, type RenewalInputs } from './renewalDue.js';

/** A soft input: measured, unmeasured, or not applicable to this role (a role that has no Overlord place, or whose
 *  reader wait the hold table answers). Not applicable is never unmeasured: it neither blocks nor fires (I7). */
export type SoftReading<T> = Reading<T> | { readonly kind: 'not-applicable' };

export interface SoftInputs {
  readonly role: FleetRole;
  /** `hibernateVerdict`'s answer: the turn finished, no background or scheduled task, no menu or dialog. */
  readonly hibernateHold: { readonly held: false } | { readonly held: true; readonly reason: string };
  /** Readers running, from the hook's subagent start and stop reports. Not applicable where the hold table answers the
   *  reader wait (a coordinator in W1a). */
  readonly readersRunning: SoftReading<number>;
  /** Observed time since the operator's last activity: the Overlord's last operator message (W1); for a coordinator,
   *  the age of the operator-at-programme mark. */
  readonly operatorQuietObservedMs: SoftReading<number>;
  /** Overlord: observed time with no Overlord place visible (W1's console report). Not applicable to other roles. */
  readonly placeHiddenObservedMs: SoftReading<number>;
  /** The Setting (R19): renew when I'm away (the default), or on schedule. */
  readonly mode: 'when-away' | 'on-schedule';
  /** How long the soft trigger has waited, observed. */
  readonly dueSinceObservedMs: number;
  /** The generation's age, observed: the least age. */
  readonly generationAgeObservedMs: number;
  /** The end of a hold-off on the same observed clock as `generationAgeObservedMs`, or null when none stands. */
  readonly holdOffUntilObservedMs: number | null;
  /** Soft renewals inside the budget's window, counted over observed time. A count that is not a non-negative
   *  integer is unmeasured, and waits (review 1894, F3). */
  readonly softRenewalsInWindow: number;
  /** The Overlord's generation is outside `active`: a coordinator waits while the Overlord renews (C50). */
  readonly overlordOutsideActive: boolean;
}

export type SoftWait = 'least-age' | 'hold-off' | 'budget' | 'overlord-first' | 'hold' | 'readers' | 'unmeasured' | 'no-break';
export type SoftAnswer = { readonly start: true } | { readonly start: false; readonly waitFor: SoftWait };

const wait = (waitFor: SoftWait): SoftAnswer => ({ start: false, waitFor });
const START: SoftAnswer = { start: true };

/** A break (R19): no operator message for 20 minutes, or no visible place for five, both in observed time. Any
 *  measured disjunct that passes is a break; an input the role does not have neither blocks nor fires. 'unmeasured'
 *  when no measured disjunct passes and an applicable one is unmeasured. Quiet hours join in W3, with their Setting. A
 *  measured value that is not a count (`measuredCount`) never makes a break. */
function breakOf(i: SoftInputs): boolean | 'unmeasured' {
  const parts: Array<[SoftReading<number>, number]> = [
    [i.operatorQuietObservedMs, BREAK_NO_MESSAGE_MS], [i.placeHiddenObservedMs, BREAK_PLACE_HIDDEN_MS]];
  if (parts.some(([r, t]) => { const v = measuredCount(r); return v !== null && v >= t; })) return true;
  return parts.some(([r]) => r.kind !== 'not-applicable' && measuredCount(r) === null) ? 'unmeasured' : false;
}

/** May a soft renewal start now? The waits, first match: least age, hold-off, budget, the Overlord first, then the
 *  preconditions: the hold table, readers, the break. In `on-schedule` mode a trigger that has waited 30 minutes is no
 *  longer delayed by the preconditions (Appendix B: "the preconditions, at most 30 minutes"). */
export function softRenewalMay(i: SoftInputs): SoftAnswer {
  if (!(i.generationAgeObservedMs >= LEAST_AGE_MS)) return wait('least-age');
  if (i.holdOffUntilObservedMs !== null && !(i.generationAgeObservedMs >= i.holdOffUntilObservedMs)) return wait('hold-off');
  const used = i.softRenewalsInWindow;
  if (!(Number.isInteger(used) && used >= 0)) return wait('unmeasured');
  if (!(used < SOFT_BUDGET.count)) return wait('budget');
  if (i.role !== 'overlord' && i.overlordOutsideActive) return wait('overlord-first');
  if (i.mode === 'on-schedule' && i.dueSinceObservedMs >= ON_SCHEDULE_WAIT_MS) return START;
  if (i.hibernateHold.held) return wait('hold');
  if (i.readersRunning.kind !== 'not-applicable') {
    const readers = measuredCount(i.readersRunning);
    if (readers === null) return wait('unmeasured');
    if (readers !== 0) return wait('readers');
  }
  const away = breakOf(i);
  if (away === 'unmeasured') return wait('unmeasured');
  return away ? START : wait('no-break');
}

/** At a break, a generation past half of a soft row's threshold renews early (R19): the soft ceiling and the turns,
 *  each only for a role whose rows include it. An unmeasured reading says no. The account load's soft line is not an
 *  input of `renewalDue` yet, so it joins with its reading. */
export function earlyWhileAway(role: FleetRole, i: RenewalInputs): boolean {
  const rows = RENEWAL_ROWS[role];
  const ctx = measuredCount(i.contextTokens); const fit = measuredCount(i.fittedCeilingTokens); const turns = measuredCount(i.turns);
  const pastCeiling = rows.includes('soft-ceiling') && ctx !== null && fit !== null
    && ctx >= fit * SOFT_CEILING_FRACTION * EARLY_WHILE_AWAY_FRACTION;
  const pastTurns = rows.includes('turns') && turns !== null && turns >= TURNS_SOFT * EARLY_WHILE_AWAY_FRACTION;
  return pastCeiling || pastTurns;
}
