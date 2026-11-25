import { OUTSTANDING_DELIVERY_STATES, isSessionLifecycle, lifecycleIsDead } from '../../../shared/api.js';
import { isProviderRetryMail, providerRetryDueOf } from '../../../shared/provider-retry.js';
import { type ProviderRetryWire } from '../../../shared/provider-retry-wire.js';
import { isProviderFailure } from './stopFailure.js';
import {
  BACKLOG_HORIZON_MS, isIdleWord, stallCurrentMark, stallNewestDelivery, stallSessionHold, stallSessionLive,
  type StallArming, type StallDeliveryRow, type StallHold, type StallMailRow, type StallSessionInput, type TurnMark, type TurnMarkRead,
} from './stall.js';
import type { StallResolved } from './stallsettings.js';
/**
 * THE PROVIDER-FAILURE LADDER (operator ruling 2026-11-25, D-9085; plan
 * `docs/superpowers/plans/2026-11-25-provider-retry.md`). L1, C5, pure: no clock, no I/O, no store.
 *
 * A session whose turn ended on a provider error is nudged to carry on, 1, 4 and then every 15 minutes after the n-th
 * consecutive failure, until a turn runs. Any live session (a worker, a reviewer, a coordinator, the designated Overlord,
 * a session of the operator's own), never only a run's. Nobody else is told: no coordinator is asked to mend a provider.
 *
 * WHAT IS OWED is the marker's `failAts`, never its state word: a restart relabels a `failed` line `done` and starts no turn
 * (measured, 2.1.332), so a retry is owed while the newest failure is newer than the newest turn (`providerRetryOwed`).
 *
 * The 22 h cutoff of the `failed` arm does not apply: the nudges of one failure are found by their own due times, over a mail
 * read that reaches back to the failure itself (`providerRetryMailSince`), so a repeat is never re-read as a first nudge.
 */

/** The wait after the n-th consecutive failure, *ruled* (2026-11-25): 1, 4, then 15 minutes, staying at 15. */
export const PROVIDER_RETRY_DELAYS_MS: readonly number[] = [60_000, 4 * 60_000, 15 * 60_000];
/** A nudge that started no turn is repeated after the ladder's last step, *chosen*: one that got no turn says nothing about
 *  the provider, so it neither counts as a failure nor earns a shorter wait. */
export const PROVIDER_RETRY_REPEAT_MS = 15 * 60_000;

/** The retry a marker says is owed: the newest failure's epoch, how many in a row, and the oldest of the ones no more
 *  than two repeats apart (a turn that worked for hours between two failures got past the first). Null when none is.
 *  - `failAts` non-empty and its newest entry newer than `turnAt`: the hook counted it, and no turn ran since.
 *  - A `failed` line whose token is a provider's and whose hook counted none (an older fleet build): one failure, at its stop. */
export function providerRetryOwed(m: Pick<TurnMark, 'state' | 'err' | 'stopAt' | 'turnAt' | 'failAts'>): { readonly at: number; readonly count: number; readonly since: number } | null {
  const fails = m.failAts ?? [];
  const last = fails[fails.length - 1];
  if (last !== undefined && (m.turnAt === null || m.turnAt < last)) return { at: last, count: fails.length, since: fails.reduceRight((from, f) => (from - f <= 2 * PROVIDER_RETRY_REPEAT_MS ? f : from), last) };
  return m.state === 'failed' && m.stopAt !== null && isProviderFailure(m.err) ? { at: m.stopAt, count: 1, since: m.stopAt } : null;
}

/** When the first nudge after the n-th consecutive failure falls due. */
export function providerRetryFirstDue(owed: { readonly at: number; readonly count: number }): number {
  return owed.at + PROVIDER_RETRY_DELAYS_MS[Math.min(owed.count, PROVIDER_RETRY_DELAYS_MS.length) - 1]!;
}

/** Whether the ladder sends (its own rule, never the stall watch's wave-2 level). Stopped by the watch's kill switch, by a
 *  chosen level of Off (both `disabled`) or Log only (a chosen row that is not live), and by the mail kill switch. A box that
 *  follows its files, with no level chosen, is armed: the ladder ships armed and has no marker of its own. */
export function providerRetryArmed(a: StallArming, levelSource: StallResolved['levelSource']): boolean {
  return !a.disabled && a.mailDisabled !== true && (levelSource === 'files' || a.live);
}

/** The quiet ladder's hold: a worker that owes a provider retry is the ladder's, so its coordinator is not mailed `stall:`
 *  about a provider. Only while the ladder would nudge it. */
export function providerRetryHoldsQuiet(mark: TurnMarkRead, armed: boolean): boolean {
  return armed && mark.ok && providerRetryOwed(mark) !== null;
}

/** How far back the ladder's mail read reaches: to the failure, when that is older than the lane's own horizon. */
export function providerRetryMailSince(mark: TurnMarkRead, now: number): number {
  const owed = mark.ok ? providerRetryOwed(mark) : null;
  return Math.min(now - BACKLOG_HORIZON_MS, owed?.at ?? now);
}

/** One session, as the ladder judges it: the stall lane's own facts, and two of the registry row's. */
export interface ProviderRetryInput {
  readonly session: StallSessionInput;
  readonly archived: boolean;
  readonly hibernated: boolean;
  readonly armed: boolean;
}

export type ProviderRetryVerdict =
  | { readonly act: 'none' }
  | { readonly act: 'hold'; readonly why: StallHold }
  | { readonly act: 'nudge'; readonly dueAt: number }
  /** A nudge still queued for a failure the session has moved past: it is taken back, never typed. */
  | { readonly act: 'withdraw'; readonly deliveryId: number };

const NONE: ProviderRetryVerdict = { act: 'none' };
const hold = (why: StallHold): ProviderRetryVerdict => ({ act: 'hold', why });
const OUTSTANDING: ReadonlySet<string> = new Set<string>(OUTSTANDING_DELIVERY_STATES);

interface SentNudge { readonly dueAt: number; readonly mail: StallMailRow; readonly delivery: StallDeliveryRow | null }
function sentNudges(input: StallSessionInput): SentNudge[] {
  return input.mail.filter((m) => m.toId === input.sessionId && isProviderRetryMail(m)).map((mail) => ({
    dueAt: providerRetryDueOf(mail.subject)!, mail,
    delivery: stallNewestDelivery(input.deliveries.filter((d) => d.toId === input.sessionId), mail.id),
  }));
}

/** When a session may not be nudged although it owes a retry: the stall session holds (absent, unmeasured, a dialog, a usage
 *  limit), then the ladder's own. The run is left out of them: a run that reads `unknown` is a reason to nudge its silent
 *  worker, not to wait. An open question is a hold whatever the word; the operator's programme hold on a workspace is not
 *  one (it is a claim every programme worker carries). */
function nudgeHold(input: ProviderRetryInput, now: number): StallHold | null {
  const held = stallSessionHold({ ...input.session, run: null }, now);
  if (held !== null) return held.act === 'hold' ? held.why : 'unmeasured';
  const w = input.session.worker;
  if (w.present !== true) return 'absent';
  if (input.archived || input.hibernated || w.lifecycle === 'restarting') return 'lifecycle';
  if (isSessionLifecycle(w.lifecycle) && lifecycleIsDead(w.lifecycle)) return 'lifecycle';
  if (w.askRow.kind === 'unmeasured') return 'unmeasured';
  if (w.hookAsk.kind === 'ask' || w.hookAsk.kind === 'approval') return 'ask';
  if (w.askRow.kind === 'row' && (w.askRow.state === 'held' || w.askRow.state === 'answering')) return 'ask';
  const live = stallSessionLive(input.session);
  if (live === null) return 'unmeasured';
  if (live.word === 'waiting') return 'dialog';
  return isIdleWord(live.word) ? null : 'busy';
}

/** The nudges of the failure still owed: whether one is out (queued or delivered and unacked), whether it is queued and not
 *  yet typed, and when the next one falls due. The next after one that started no turn is counted from when it landed. */
interface OwedNudges { readonly out: boolean; readonly untyped: boolean; readonly dueAt: number }
function owedNudges(sent: readonly SentNudge[], owed: { readonly at: number; readonly count: number }): OwedNudges {
  const mine = sent.filter((n) => n.dueAt > owed.at);
  return {
    out: mine.some((n) => n.delivery !== null && OUTSTANDING.has(n.delivery.state)),
    untyped: mine.some((n) => n.delivery !== null && n.delivery.state === 'queued'),
    dueAt: mine.reduce((due, n) =>
      Math.max(due, Math.max(n.dueAt, n.delivery?.ackedAt ?? n.delivery?.deliveredAt ?? 0) + PROVIDER_RETRY_REPEAT_MS), providerRetryFirstDue(owed)),
  };
}

/** The ladder's answer for one session this sweep. Never two outstanding: while one nudge for this failure is queued or
 *  delivered and unacked, nothing is due. */
export function providerRetryVerdict(input: ProviderRetryInput, now: number): ProviderRetryVerdict {
  const s = input.session;
  const m = stallCurrentMark(s);
  if (m === null) return !s.mark.ok && s.mark.reason === 'unmeasured' ? hold('unmeasured') : NONE;
  const owed = providerRetryOwed(m);
  const sent = sentNudges(s);
  const stale = sent.find((n) => (owed === null || n.dueAt <= owed.at) && n.delivery !== null && n.delivery.state === 'queued');
  if (stale?.delivery) return { act: 'withdraw', deliveryId: stale.delivery.id };
  if (owed === null || !input.armed) return NONE;
  const { out, dueAt } = owedNudges(sent, owed);
  if (out || now < dueAt) return NONE;
  const why = nudgeHold(input, now);
  return why === null ? { act: 'nudge', dueAt } : hold(why);
}

/** The holds a person can read on the session and end: a dialog, a question, a usage limit. The console says the retry waits. */
const WAITING_HOLDS: ReadonlySet<StallHold> = new Set<StallHold>(['dialog', 'ask', 'limit']);

/** What the console is told of one session (wave 2, D-9100): the retry the ladder would make and when, or
 *  null when it would make none (nothing owed, a stopped ladder, a running turn, a session that is gone, asleep or archived) or
 *  could not be measured. `nextAt` is the verdict's own due time, and null while something keeps the nudge out: one of
 *  `WAITING_HOLDS`, or the mail lane holding one it has not typed (a person's draft, or any gate of its own). */
export function providerRetryWire(input: ProviderRetryInput, now: number): ProviderRetryWire | null {
  const m = stallCurrentMark(input.session);
  const owed = m === null ? null : providerRetryOwed(m);
  if (m === null || owed === null || !input.armed) return null;
  const held = nudgeHold(input, now);
  if (held !== null && !WAITING_HOLDS.has(held)) return null;
  const { untyped, dueAt } = owedNudges(sentNudges(input.session), owed);
  return { err: m.err, since: owed.since, attempts: owed.count, nextAt: held !== null || untyped ? null : dueAt, phase: 'retrying' };
}

/** Whether a row still says it, by the raw live word of the assembly (null: not read). The pass judged it up to a minute ago,
 *  and a turn that runs now is the retry, or a person's own. */
export function providerRetryShown(w: ProviderRetryWire | undefined, liveWord: string | null): w is ProviderRetryWire {
  return w !== undefined && liveWord !== 'busy';
}

/** Why a withdrawn nudge's delivery ended, as its row says it. */
export const PROVIDER_RETRY_WITHDRAWN = 'withdrawn: the session has moved past the failure this nudge was for';
