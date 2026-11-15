/** The push outbox's vocabulary (Overlord design spec §6.7 "Pushes go through an outbox", §4.3 and C67, Table 11.1a's
 *  push outbox row; the spec is `docs/superpowers/specs/2026-11-09-overlord-design.md`; the plan is
 *  `docs/superpowers/plans/2026-11-14-overlord-w1/w1-push-outbox.md`, Task 2). Ring L0, context C6: pure vocabulary,
 *  no import.
 *
 *  Every Web Push the server sends becomes one row of `push_outbox`, and one sender drains it. A row is claimed in its
 *  own transaction before each attempt, and a verdict lands only on the claim it answers (`claimSeq`), so no attempt is
 *  ever sent twice (slug a-claimed-row-is-never-sent-again). The wire types live here, in their own file, and
 *  `shared/api.ts` gains only the capability word (slug wire-types-in-a-sibling). */

/** A row's states. `silent` is its own terminal state with its reason, so `sent` always means the push service took it
 *  (slug silent-is-its-own-state). */
const OUTBOX_STATE_MAP = {
  pending: 'written and due; no attempt holds it',
  sending: 'claimed for one attempt; the verdict is not in',
  retrying: 'some subscription refused for a reason that can pass, and none accepted or went unanswered; due again at nextAttemptAt',
  sent: 'the push service accepted it for at least one subscription (pushedAt)',
  silent: 'no push by decision: the level, the operator looking, the source settled, or no payload',
  unsent: 'no subscription left to deliver to',
  failed: 'refused for good, or past the retry horizon',
  unknown: 'an attempt with no verdict: that attempt is never retried',
} as const;
export type OutboxState = keyof typeof OUTBOX_STATE_MAP;
export const OUTBOX_STATES = Object.keys(OUTBOX_STATE_MAP) as OutboxState[];
export const TERMINAL_OUTBOX_STATES = ['sent', 'silent', 'unsent', 'failed', 'unknown'] as const satisfies readonly OutboxState[];

/** Who moves a row: the move that raised its source, the sender, the boot pass, and a re-arm (a toggle to blocking). */
export type OutboxActor = 'raise' | 'sender' | 'boot' | 'arm';
const OUTBOX_ACTOR_MAP: Readonly<Record<OutboxActor, true>> = { raise: true, sender: true, boot: true, arm: true };
export const OUTBOX_ACTORS = Object.keys(OUTBOX_ACTOR_MAP) as OutboxActor[];

/** One actor and one target on each move. `from: null` is an insert. Every writer of `push_outbox` checks its move here
 *  (`outboxMoveAllowed`). */
export const OUTBOX_TRANSITIONS: readonly {
  readonly from: OutboxState | null; readonly to: OutboxState; readonly actor: OutboxActor;
}[] = [
  { from: null, to: 'pending', actor: 'raise' }, { from: null, to: 'silent', actor: 'raise' },
  { from: null, to: 'sending', actor: 'sender' },                    // an unbound push, claimed at its insert
  { from: null, to: 'silent', actor: 'sender' },                     // the held drain's insert (always silent)
  { from: 'pending', to: 'sending', actor: 'sender' }, { from: 'retrying', to: 'sending', actor: 'sender' },
  { from: 'pending', to: 'silent', actor: 'sender' }, { from: 'retrying', to: 'silent', actor: 'sender' }, // the source re-read
  { from: 'sending', to: 'sent', actor: 'sender' }, { from: 'sending', to: 'retrying', actor: 'sender' },
  { from: 'sending', to: 'unsent', actor: 'sender' }, { from: 'sending', to: 'failed', actor: 'sender' },
  { from: 'sending', to: 'unknown', actor: 'sender' }, { from: 'sending', to: 'unknown', actor: 'boot' },
  { from: 'pending', to: 'failed', actor: 'boot' }, { from: 'retrying', to: 'failed', actor: 'boot' }, // stale after a restore
  // a bound row armed again (a toggle to blocking), from every state; `null` is the upsert's insert
  ...OUTBOX_STATES.map((from) => ({ from, to: 'pending' as const, actor: 'arm' as const })),
  { from: null, to: 'pending', actor: 'arm' },
];

/** Whether `actor` may move a row from `from` to `to`: a row of `OUTBOX_TRANSITIONS`, and nothing else. */
export function outboxMoveAllowed(from: OutboxState | null, to: OutboxState, actor: OutboxActor): boolean {
  return OUTBOX_TRANSITIONS.some((t) => t.from === from && t.to === to && t.actor === actor);
}

/** The source a bound row belongs to. An unbound push has none (slug bound-rows-are-asks-and-items). */
export type OutboxSource = 'ask' | 'item';
const OUTBOX_SOURCE_MAP: Readonly<Record<OutboxSource, true>> = { ask: true, item: true };
export const OUTBOX_SOURCES = Object.keys(OUTBOX_SOURCE_MAP) as OutboxSource[];

/** One subscription's answer to one send. `refused` can pass (429, any 5xx, or an error raised before the request left
 *  the box); `refused-for-good` cannot (400, 403, 413); `gone` is a 404 or 410, pruned; `no-answer` is a reset or a
 *  timeout after the request was written, where the service may have taken it (slug no-answer-is-never-retried). */
export type SubscriptionVerdict = 'accepted' | 'refused' | 'refused-for-good' | 'gone' | 'no-answer';
const SUBSCRIPTION_VERDICT_MAP: Readonly<Record<SubscriptionVerdict, true>> = {
  accepted: true, refused: true, 'refused-for-good': true, gone: true, 'no-answer': true,
};
export const SUBSCRIPTION_VERDICTS = Object.keys(SUBSCRIPTION_VERDICT_MAP) as SubscriptionVerdict[];

/** What one `PushService.notify` answers: no subscription at all, or one answer per subscription with the hex SHA-256
 *  of its endpoint, so no endpoint is stored (slug verdict-ships-with-the-outbox). */
export type PushSendVerdict =
  | { readonly kind: 'no-subscription' }
  | {
    readonly kind: 'sent';
    readonly subs: readonly {
      readonly endpointHash: string; readonly verdict: SubscriptionVerdict; readonly status: number | null;
    }[];
  };

/** Why a row made no push: no push service, no payload, the source settled, the level, the operator looking, or an
 *  older build that pushed it already. */
export type PushSilentWhy = 'level' | 'viewing' | 'settled' | 'no-payload' | 'no-service' | 'older-build';
const PUSH_SILENT_WHY_MAP: Readonly<Record<PushSilentWhy, true>> = {
  level: true, viewing: true, settled: true, 'no-payload': true, 'no-service': true, 'older-build': true,
};
export const PUSH_SILENT_WHYS = Object.keys(PUSH_SILENT_WHY_MAP) as PushSilentWhy[];

/** The push id's bytes (`Entropy.hex(PUSH_ID_BYTES)`): no restore can make one repeat. */
export const PUSH_ID_BYTES = 16;
/** web-push's per-request timeout, below the deadline. */
export const OUTBOX_SUB_TIMEOUT_MS = 20_000;
/** A send that has not answered by then has no verdict. */
export const OUTBOX_SEND_DEADLINE_MS = 30_000;
/** The first retry's delay, doubling per attempt. */
export const OUTBOX_RETRY_BASE_MS = 30_000;
/** The push's own TTL, from `armedAt`: no retry is scheduled past it (slug retry-horizon-is-the-ttl). */
export const OUTBOX_RETRY_HORIZON_MS = 600_000;
/** A terminal unbound row is purged a week after `settledAt`. */
export const OUTBOX_KEEP_MS = 7 * 86_400_000;
