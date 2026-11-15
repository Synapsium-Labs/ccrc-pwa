import type { PushPayload } from './push.js';
import {
  OUTBOX_RETRY_BASE_MS, OUTBOX_RETRY_HORIZON_MS, SUBSCRIPTION_VERDICTS,
  type OutboxSource, type PushSendVerdict, type PushSilentWhy, type SubscriptionVerdict,
} from '../../shared/push-outbox.js';

/**
 * ONE OWNER FOR A PUSH'S TEXT, AND THE PUSH OUTBOX'S DECIDERS (Overlord spec §6.7, §4.2 and §4.3; plan
 * `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Task 2).
 *
 * L1, pure, C6: this file decides over facts and does no I/O. The time is a fact its caller passes in. Its imports are
 * L0 values from `shared/push-outbox.ts` and one type from `push.ts`.
 *
 * - `noticeTitle` and `noticePayload` build every push's text, each called once per push, so no title is suffixed
 *   twice (slug one-payload-builder).
 * - `pushDue` says whether a row pushes now or stays silent. It is total over its facts (index open question 28,
 *   slug push-due-ships-total): W1 answers `now` or `silent`, and W3 adds `deferred` without changing any W1 answer.
 * - `outboxNextState`, `outboxRetryAt` and `outboxBootVerdict` say where a row goes after a verdict, when it is due
 *   again, and what the boot pass does with a row it finds open.
 */

/** Today's `pushOne` title rule, byte for byte: " · <project>" only when more than one project is active and the
 *  project is known (an empty project degrades to no decoration, never a dangling " · "). */
export function noticeTitle(title: string, project: string, activeProjects: ReadonlySet<string>): string {
  return activeProjects.size > 1 && project !== '' ? `${title} · ${project}` : title;
}

/** Today's `raise` rule, byte for byte: the default tag `${kind}-${sessionId}` or the caller's, and `actions` and `url`
 *  when given, in that key order. It takes the title as it is (already suffixed or not), so it never suffixes. */
export function noticePayload(
  e: { readonly kind: string; readonly sessionId: string; readonly title: string; readonly body: string },
  opts: { readonly tag?: string | undefined; readonly url?: string | undefined; readonly actions?: PushPayload['actions'] },
): PushPayload {
  return {
    title: e.title, body: e.body, sessionId: e.sessionId,
    tag: opts.tag ?? `${e.kind}-${e.sessionId}`,
    ...(opts.actions ? { actions: opts.actions } : {}),
    ...(opts.url !== undefined ? { url: opts.url } : {}),
  };
}

/** What the sender's `prepare` answers. `payload` is null and `service` false when there is no push service. */
export interface PreparedPush { readonly payload: PushPayload | null; readonly pushId: string; readonly service: boolean }
/** The bound-row callback a raising transaction calls with its source's id, built from the sender's `prepare`, so the
 *  store takes no entropy and no masker (slug bound-row-callback). */
export type BoundRowOf = (id: number) => PreparedPush;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const SUB_VERDICTS: ReadonlySet<string> = new Set(SUBSCRIPTION_VERDICTS);

/** A resolved send read as a verdict. Anything that is not one (a test double's `undefined`, a malformed object) reads
 *  null, so its attempt is `unknown`. */
export function asSendVerdict(x: unknown): PushSendVerdict | null {
  if (!isRecord(x)) return null;
  if (x.kind === 'no-subscription') return { kind: 'no-subscription' };
  if (x.kind !== 'sent' || !Array.isArray(x.subs)) return null;
  const subs: { endpointHash: string; verdict: SubscriptionVerdict; status: number | null }[] = [];
  for (const s of x.subs as unknown[]) {
    if (!isRecord(s) || typeof s.endpointHash !== 'string' || typeof s.verdict !== 'string' || !SUB_VERDICTS.has(s.verdict)) return null;
    if (s.status !== null && typeof s.status !== 'number') return null;
    subs.push({ endpointHash: s.endpointHash, verdict: s.verdict as SubscriptionVerdict, status: s.status as number | null });
  }
  return { kind: 'sent', subs };
}

/** The facts `pushDue` decides over. */
export interface PushDueFacts {
  /** `reach`: a source reaches the operator; `arm`: a bound row armed again; `claim`: the re-read before each attempt;
   *  `held`: the held drain. */
  readonly event: 'reach' | 'arm' | 'claim' | 'held';
  /** A push service exists. */
  readonly service: boolean;
  readonly source: OutboxSource | 'none';
  /** An item's current level; an ask always pushes today. */
  readonly blocking: boolean;
  /** The presence gate's one answer; a notice with no session is never viewed. */
  readonly viewing: boolean;
  /** The source row was answered, withdrawn or closed. */
  readonly settled: boolean;
  /** A payload exists (a handover with no in-memory hold has none). */
  readonly payload: boolean;
}
/** Total over its facts. W1 answers `now` or `silent`; W3 adds `deferred` and changes no answer W1 gives. */
export type PushDue = { readonly due: 'now' } | { readonly due: 'silent'; readonly why: PushSilentWhy };

const silent = (why: PushSilentWhy): PushDue => ({ due: 'silent', why });

/** What each event means to `pushDue`, total over the events: whether it is the held drain, and whether presence is
 *  asked (a `claim` re-reads the source but not presence, which was decided once, at the reach or the arm). */
const EVENT_RULES: Readonly<Record<PushDueFacts['event'], { readonly heldDrain: boolean; readonly asksPresence: boolean }>> = {
  reach: { heldDrain: false, asksPresence: true },
  arm: { heldDrain: false, asksPresence: true },
  claim: { heldDrain: false, asksPresence: false },
  held: { heldDrain: true, asksPresence: true },
};

/** Whether a row pushes now, by the first rule that matches:
 *  1. no push service is `no-service`; 2. no payload is `no-payload`; 3. a settled source is `settled`;
 *  4. an item that is not blocking is `level`; 5. the held drain never pushes (`older-build`: only an older build's
 *  toggle inside the hold makes a held item blocking with no row, and that build pushed it then; slug
 *  held-drain-is-silent); 6. a notice being viewed is `viewing`, except on a `claim`, because presence was decided once,
 *  at the reach or the arm (slug presence-read-once); 7. everything else is `now`. */
export function pushDue(f: PushDueFacts): PushDue {
  if (!f.service) return silent('no-service');
  if (!f.payload) return silent('no-payload');
  if (f.settled) return silent('settled');
  if (f.source === 'item' && !f.blocking) return silent('level');
  const ev = EVENT_RULES[f.event];
  if (ev.heldDrain) return silent('older-build');
  if (f.viewing && ev.asksPresence) return silent('viewing');
  return { due: 'now' };
}

/** The next attempt's time: `OUTBOX_RETRY_BASE_MS` doubled per attempt since the last arm, or null when it would fall
 *  past `armedAt + OUTBOX_RETRY_HORIZON_MS` (slugs retry-horizon-is-the-ttl, horizon-from-armed-at). */
export function outboxRetryAt(attempts: number, armedAt: number, now: number): number | null {
  const at = now + OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1);
  return at > armedAt + OUTBOX_RETRY_HORIZON_MS ? null : at;
}

/** What a claimed attempt's verdict moves the row to. `null` is a send that did not answer by its deadline, or
 *  rejected. In order: `no-subscription` is `unsent`; any `accepted` is `sent`; any `no-answer` or a null verdict is
 *  `unknown`, because the service may have taken it (slug no-answer-is-never-retried); every subscription `gone` is
 *  `unsent` (slug all-gone-is-unsent); any `refused` is `retrying` at `outboxRetryAt`, or `failed` past the horizon;
 *  anything else (a `refused-for-good` with no `refused`) is `failed` (slug permanent-refusal-fails). */
export function outboxNextState(
  v: PushSendVerdict | null, row: { readonly attempts: number; readonly armedAt: number }, now: number,
): { readonly to: 'sent' | 'unsent' | 'failed' | 'unknown' } | { readonly to: 'retrying'; readonly nextAttemptAt: number } {
  if (v === null) return { to: 'unknown' };
  if (v.kind === 'no-subscription') return { to: 'unsent' };
  const has = (w: string): boolean => v.subs.some((s) => s.verdict === w);
  if (has('accepted')) return { to: 'sent' };
  if (has('no-answer')) return { to: 'unknown' };
  if (v.subs.every((s) => s.verdict === 'gone')) return { to: 'unsent' };
  if (has('refused')) {
    const at = outboxRetryAt(row.attempts, row.armedAt, now);
    return at === null ? { to: 'failed' } : { to: 'retrying', nextAttemptAt: at };
  }
  return { to: 'failed' };
}

/** The boot pass's answer for one row it finds open. A `sending` row belongs to a process that died, so its attempt is
 *  sealed `unknown` and never retried (slug a-claimed-row-is-never-sent-again); a `pending` or `retrying` row past the
 *  horizon fails, so a `coord.db` restored from an older snapshot never re-sends its old rows (slug
 *  stale-rows-fail-at-boot); any other is left for the first drain to send. */
export function outboxBootVerdict(
  row: { readonly state: 'pending' | 'sending' | 'retrying'; readonly armedAt: number }, now: number,
): 'send' | 'seal-unknown' | 'fail-stale' {
  if (row.state === 'sending') return 'seal-unknown';
  return now > row.armedAt + OUTBOX_RETRY_HORIZON_MS ? 'fail-stale' : 'send';
}
