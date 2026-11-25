import { OUTSTANDING_DELIVERY_STATES, lifecycleIsDead } from '../../../shared/api.js';
import { isProviderRetryMail, providerRetryDueOf } from '../../../shared/provider-retry.js';
import { isProviderFailure } from './stopFailure.js';
import {
  BACKLOG_HORIZON_MS, isIdleWord, stallCurrentMark, stallNewestDelivery, stallSessionHold, stallSessionLive,
  type StallArming, type StallDeliveryRow, type StallHold, type StallMailRow, type StallSessionInput, type TurnMark, type TurnMarkRead,
} from './stall.js';
import type { StallResolved } from './stallsettings.js';
/**
 * THE PROVIDER-FAILURE LADDER, wave 1 (operator ruling 2026-11-25, D-TBD-provider-retry-armed; plan
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

/** The retry a marker says is owed: the newest failure's epoch, and how many in a row. Null when none is.
 *  - `failAts` non-empty and its newest entry newer than `turnAt`: the hook counted it, and no turn ran since.
 *  - A `failed` line whose token is a provider's and whose hook counted none (an older fleet build): one failure, at its stop. */
export function providerRetryOwed(m: Pick<TurnMark, 'state' | 'err' | 'stopAt' | 'turnAt' | 'failAts'>): { readonly at: number; readonly count: number } | null {
  const fails = m.failAts ?? [];
  const last = fails[fails.length - 1];
  if (last !== undefined && (m.turnAt === null || m.turnAt < last)) return { at: last, count: fails.length };
  return m.state === 'failed' && m.stopAt !== null && isProviderFailure(m.err) ? { at: m.stopAt, count: 1 } : null;
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
  if (input.archived || input.hibernated || w.lifecycle === 'stopped' || w.lifecycle === 'restarting') return 'lifecycle';
  if (w.lifecycle !== null && lifecycleIsDead(w.lifecycle as Parameters<typeof lifecycleIsDead>[0])) return 'lifecycle';
  if (w.askRow.kind === 'unmeasured') return 'unmeasured';
  if (w.hookAsk.kind === 'ask' || w.hookAsk.kind === 'approval') return 'ask';
  if (w.askRow.kind === 'row' && (w.askRow.state === 'held' || w.askRow.state === 'answering')) return 'ask';
  const live = stallSessionLive(input.session);
  if (live === null) return 'unmeasured';
  if (live.word === 'waiting') return 'dialog';
  return isIdleWord(live.word) ? null : 'busy';
}

/** The ladder's answer for one session this sweep. Never two outstanding: while one nudge for this failure is queued or
 *  delivered and unacked, nothing is due. The next due time after one that started no turn is counted from when it landed. */
export function providerRetryVerdict(input: ProviderRetryInput, now: number): ProviderRetryVerdict {
  const s = input.session;
  const m = stallCurrentMark(s);
  if (m === null) return !s.mark.ok && s.mark.reason === 'unmeasured' ? hold('unmeasured') : NONE;
  const owed = providerRetryOwed(m);
  const sent = sentNudges(s);
  const stale = sent.find((n) => (owed === null || n.dueAt <= owed.at) && n.delivery !== null && n.delivery.state === 'queued');
  if (stale?.delivery) return { act: 'withdraw', deliveryId: stale.delivery.id };
  if (owed === null || !input.armed) return NONE;
  const mine = sent.filter((n) => n.dueAt > owed.at);
  if (mine.some((n) => n.delivery !== null && OUTSTANDING.has(n.delivery.state))) return NONE;
  const dueAt = mine.reduce((due, n) =>
    Math.max(due, Math.max(n.dueAt, n.delivery?.ackedAt ?? n.delivery?.deliveredAt ?? 0) + PROVIDER_RETRY_REPEAT_MS), providerRetryFirstDue(owed));
  if (now < dueAt) return NONE;
  const why = nudgeHold(input, now);
  return why === null ? { act: 'nudge', dueAt } : hold(why);
}

/** Why a withdrawn nudge's delivery ended, as its row says it. */
export const PROVIDER_RETRY_WITHDRAWN = 'withdrawn: the session has moved past the failure this nudge was for';
