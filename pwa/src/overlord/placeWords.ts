// The Overlord place's body part: its words and its pure deciders (Overlord W1 home B, Task 5; spec 2026-11-09 §3.1, §3.2, §6.4;
// plan `w1-home.md` Task 5). Ring L1: no store, no React, no DOM, no clock and no `lib/api.ts`; it imports types, L0 shared
// vocabulary and other L1 modules only, and `now` is always an argument. `BodyPart.tsx` (L4) draws what these answer and
// decides nothing.
//
// WHICH CONTROLS A STATE DRAWS is one table (`BODY_CONTROLS`), read by `bodyControlsOf` and by the tests alike:
// - `none` and `failed-start` draw Start (the second as "Start again", with the failed attempt's sentence);
// - `pending` draws no control: a start is in flight, and a second one is the spec's "no second start" (the door refuses it
//   `overlord-attempt-pending`);
// - `bound` draws Open and Rebind, and Restart only when the readiness read's `restartable` is true (F2: never keyed on the
//   word, so a `dead` word with `restartable: false` offers no Restart);
// - `unmeasured` draws no control: a designation that could not be read is not acted on.
// Start is never in the `bound` or `pending` row. A new designation kind without a row is a compile error here.
import {
  ATTEMPT_OUTCOME_MAP, OVERLORD_MODEL_CLASSES,
  type AttemptOutcome, type DesignationView, type OverlordModelClass, type PendingKind,
} from '../../../shared/overlord-designation';
import type { ReadinessWire } from '../../../shared/overlord-readiness';
import type { PoolSet } from '../../../shared/poolset';
import type { DesignationState } from './homePlace';
import type { ReadState } from './readState';

export type BodyControl = 'start' | 'open' | 'rebind' | 'restart';

/** The controls each designation kind draws, before the readiness read adds Restart to `bound`. */
export const BODY_CONTROLS: Readonly<Record<DesignationState['kind'], readonly BodyControl[]>> = {
  none: ['start'],
  'failed-start': ['start'],
  pending: [],
  bound: ['open', 'rebind'],
  unmeasured: [],
};

/** Whether the door would act: the readiness read's own `restartable`, from an answered or stale read; any other read
 *  (loading, unmeasured, absent) offers nothing, because nothing unmeasured reads as a value. Never keyed on the word. */
export function restartableOf(readiness: ReadState<ReadinessWire>): boolean {
  return (readiness.state === 'answered' || readiness.state === 'stale') && readiness.value.restartable === true;
}

/** The controls the part draws for a designation state: the table's row, and Restart after Rebind while `restartable`. */
export function bodyControlsOf(d: DesignationState, readiness: ReadState<ReadinessWire>): readonly BodyControl[] {
  const row = BODY_CONTROLS[d.kind];
  return d.kind === 'bound' && restartableOf(readiness) ? [...row, 'restart'] : row;
}

export const BODY_WORDS = {
  start: 'Start the Overlord',
  startAgain: 'Start again',
  starting: 'Starting…',
  open: 'Open the Overlord',
  rebind: 'Rebind the Overlord',
  rebindAnyway: 'Rebind anyway',
  restart: 'Restart the Overlord',
  working: 'Working…',
  model: 'Model class',
  accounts: 'Accounts it may use',
  untagged: 'Untagged accounts',
  /** Spec §3.1: the forced rebind stops the old session first. */
  forceSentence: 'The old Overlord session does not measure dead. Rebinding anyway stops it first, then starts a replacement.',
  unmeasured: 'The designation could not be read, so nothing here can act on it until it can be.',
  noAccounts: 'Pick at least one pool, or untagged accounts: an empty set serves nothing.',
  waitsForAccounts: 'Start waits for the accounts to load, so the set it sends is the one you see.',
} as const;

// ── Start's two inputs ──

/** The model class the first start offers selected: the cheaper one. `fable` is offered, never the default. */
export const DEFAULT_MODEL_CLASS: OverlordModelClass = 'opus';

const MODEL_CLASS_LABEL: Readonly<Record<OverlordModelClass, string>> = { opus: 'Opus', fable: 'Fable' };

/** The class radios, in the vocabulary's order, so a class the wire gains is a compile error here until it is worded. */
export const MODEL_CLASS_OPTIONS: readonly { readonly value: OverlordModelClass; readonly label: string }[] =
  OVERLORD_MODEL_CLASSES.map((value) => ({ value, label: MODEL_CLASS_LABEL[value] }));

/** The account set the form sends: the roster's pools the operator has not switched off, in the roster's order (`options` is
 *  `poolOptions`' answer), and the yes or no for untagged accounts. The form keeps what was switched OFF, so a pool the roster
 *  gains after the form opened starts on, as the rest do. A name switched off that the roster no longer carries is dropped. */
export function accountSetOf(options: readonly string[], off: readonly string[], untagged: boolean): PoolSet {
  return { pools: options.filter((p) => !off.includes(p)), untagged };
}

/** Whether untagged accounts open ON (slug `first-start-set-every-pool-untagged-off`): off, the spec's default for that field,
 *  while the roster has a pool or has not been heard yet; on only where the heard roster has no pool at all, because then
 *  nothing else could serve. */
export function openingUntaggedOf(options: readonly string[], accountsHeard: boolean): boolean {
  return accountsHeard && options.length === 0;
}

/** The yes or no for untagged accounts the form sends: the operator's own pick once made, else the opening. */
export function untaggedOf(pick: boolean | null, options: readonly string[], accountsHeard: boolean): boolean {
  return pick ?? openingUntaggedOf(options, accountsHeard);
}

/** Why Start cannot send, or null: the accounts read has not landed (the roster is not heard, so no set is the operator's
 *  yet), or the set is empty, which serves nothing and which the door would refuse. */
export type StartGate = { readonly kind: 'waiting' | 'empty'; readonly text: string };
export function startGateOf(set: PoolSet, accountsHeard: boolean): StartGate | null {
  if (!accountsHeard) return { kind: 'waiting', text: BODY_WORDS.waitsForAccounts };
  return set.pools.length === 0 && !set.untagged ? { kind: 'empty', text: BODY_WORDS.noAccounts } : null;
}

/** The label of Start for a state: "Start again" after a failed attempt. */
export function startLabelOf(d: DesignationState): string {
  return d.kind === 'failed-start' ? BODY_WORDS.startAgain : BODY_WORDS.start;
}

/** A designate answer's warning in words. `unknown-pool` names a pool no account carries (the door answers only that one on
 *  main); a warning this build does not know is drawn raw, never swallowed. */
export function designateWarningText(w: { readonly warning: string; readonly pool?: string }): string {
  if (w.warning === 'unknown-pool' && typeof w.pool === 'string') {
    return `No account is in the pool ${w.pool}, so it serves nothing until one is.`;
  }
  return `Warning: ${w.warning}`;
}

// ── what the part says of the row ──

/** The sentence beside the part for a state, or null when the frame's own state word says it all. A designation still
 *  loading says nothing here (the frame says "Loading…"). */
export function bodyLeadOf(d: DesignationState): string | null {
  if (d.kind === 'unmeasured') return d.why === 'loading' ? null : BODY_WORDS.unmeasured;
  return null;
}

/** A failed first start's sentence, one per outcome the wire names; an outcome this build does not know is drawn raw. */
export const ATTEMPT_OUTCOME_TEXT: Readonly<Record<AttemptOutcome, string>> = {
  'overlord-sandbox-unmet': "The last start failed: the session's sandbox check did not hold, so it was stopped.",
  'create-failed': 'The last start failed: the session could not be created.',
  'deadline-passed': 'The last start failed: the session never reported before its deadline.',
  'authority-unrecorded': 'The last start failed: the sandbox check held, but the authority journal would not record it before the deadline.',
  retired: 'The last Overlord was retired while its start was pending.',
};

/** The outcome as a sentence. `ATTEMPT_OUTCOME_MAP` is the wire's vocabulary: a word outside it is drawn raw. */
export function attemptOutcomeText(outcome: string): string {
  return Object.hasOwn(ATTEMPT_OUTCOME_MAP, outcome) ? ATTEMPT_OUTCOME_TEXT[outcome as AttemptOutcome] : `The last start failed (${outcome}).`;
}

/** A pending attempt, from the designation read: its session, its kind and its deadline. Null unless an answered (or stale)
 *  read carries one, so a read that failed never draws a deadline. */
export interface PendingFacts { readonly sessionId: string; readonly kind: PendingKind; readonly deadlineAt: number }
export function pendingOf(read: ReadState<DesignationView | null>): PendingFacts | null {
  if (read.state !== 'answered' && read.state !== 'stale') return null;
  const p = read.value?.pending ?? null;
  return p === null ? null : { sessionId: p.sessionId, kind: p.kind, deadlineAt: p.deadlineAt };
}

const PENDING_KIND_TEXT: Readonly<Record<PendingKind, string>> = { designate: 'A start', rebind: 'A rebind' };

/** The pending attempt's line: its kind, the session it created and how long its deadline has left (`now` is the caller's). A
 *  kind this build does not know is drawn raw. */
export function pendingWords(p: PendingFacts, now: number): string {
  const lead = Object.hasOwn(PENDING_KIND_TEXT, p.kind) ? PENDING_KIND_TEXT[p.kind] : `A ${p.kind}`;
  const left = p.deadlineAt - now;
  const rest = left <= 0 ? 'Its deadline has passed.' : `It goes live within ${Math.ceil(left / 60_000)} min, or fails.`;
  return `${lead} is pending on ${p.sessionId}. ${rest}`;
}

// ── refusals ──

/** The refusal word an answer's body carries, or null (a body with no word, or no body). */
export function refusalWordOf(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const word = (body as { error?: unknown }).error;
  return typeof word === 'string' ? word : null;
}

/** The refusal words that force lifts: `overlord-body-alive` only. A table, read by `Object.hasOwn`, never a comparison of the
 *  word to a literal (the refusal ratchet's rule), so a second word is a row. */
const FORCE_WORDS: Readonly<Record<string, true>> = { 'overlord-body-alive': true };

/** Whether a refused Rebind offers "Rebind anyway": only a word in `FORCE_WORDS`. */
export function offersForce(word: string | null): boolean {
  return word !== null && Object.hasOwn(FORCE_WORDS, word);
}

/** The binding a refused Rebind was refused for: the session and the designation term the store held at that moment. */
export interface ForceOffer { readonly sessionId: string; readonly term: number }

/** The live binding of a designation read (an answered or stale one), or null: no row, no binding, or a read that is not
 *  an answer. Nothing unmeasured reads as a binding. */
function bindingOf(read: ReadState<DesignationView | null>): ForceOffer | null {
  if (read.state !== 'answered' && read.state !== 'stale') return null;
  const row = read.value;
  return row === null || row.bound === null ? null : { sessionId: row.bound.sessionId, term: row.term };
}

/** The offer a refusal makes: the refusal's word is one force lifts and the designation read, as the store held it when the
 *  Rebind was refused, names a binding. Otherwise null (no offer). */
export function forceOfferOf(word: string | null, read: ReadState<DesignationView | null>): ForceOffer | null {
  return offersForce(word) ? bindingOf(read) : null;
}

/** Whether the offer still stands: the current designation read binds the same session at the same term. A binding that moved
 *  (another session, a new term, no binding, or a read that is not an answer) drops it, so a forced rebind is never offered
 *  on a premise the console no longer holds. */
export function forceStands(offer: ForceOffer | null, read: ReadState<DesignationView | null>): boolean {
  const now = bindingOf(read);
  return offer !== null && now !== null && now.sessionId === offer.sessionId && now.term === offer.term;
}

/** Whether a refusal's line is drawn: one that came with an offer goes with it. */
export function refusalStands(cameWithOffer: boolean, offerStands: boolean): boolean {
  return !cameWithOffer || offerStands;
}
