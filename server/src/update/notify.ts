// L1 — THE RELEASE NOTIFIER'S DECISION (design 2026-09-20 §13; W3). Pure:
// values in, one value out — no fs, no store, no push, no clock.
// `FleetWatcher.pushRelease` (watch.ts, L4) reads the store, calls this, marks
// the answer's tag and, iff it says so, sends; this file decides WHICH tag, on
// WHICH channel, and whether the mark carries a push. Ring membership is a
// property of the import block below — two shared/ modules and the L1
// resolver, nothing else — and update-notify.test.ts pins it by reading it.
//
// Eligibility is the resolver's ONE predicate (`eligibleTags`), never a second
// copy here: a tag this file announces is a tag the resolver would offer on
// that channel. It is asked with an EMPTY refused set — one node's
// provenance refusal makes a release no less news to the operator.
import { isReleaseTag, type NotifyMode, type UpdateChannel } from '../../../shared/api.js';
import { isNewerTag } from '../../../shared/semver.js';
import { eligibleTags, type EligibilityRow } from './resolve.js';

/** A catalogue row as the notifier reads it: the eligibility columns plus the
 *  notification group's one column. `ReleaseRow` (store.ts) satisfies it. */
export interface NotifyReleaseRow extends EligibilityRow { notifiedAt: number | null }
/** A live inventory row as the notifier reads it. `NodeRow` (store.ts) satisfies
 *  it. `measuredAt: null` = never measured (a `markUnreachable` placeholder).
 *  `reachable` — fix round 1 (F14, D-3316) — is false while a connection is down; `markUnreachable` keeps
 *  the row's last `measuredAt`/`currentVersion` unchanged, so an unreachable row is still `measured`, but its
 *  cached version is unconfirmed. */
export interface NotifyNodeRow { measuredAt: number | null; currentVersion: string | null; reachable: boolean }
export interface NotifyInput {
  /** update_intent[FLEET_SCOPE] — the ONE row that governs the release push; null = the seed row is gone → nothing */
  fleetIntent: { notify: NotifyMode; channel: UpdateChannel | null } | null;
  releases: readonly NotifyReleaseRow[];
  /** nodes() — live rows only (superseded excluded), placeholders included */
  nodes: readonly NotifyNodeRow[];
}
export interface ReleaseNotification {
  tag: string;
  channel: UpdateChannel;   // 'stable' under notify 'stable'; the fleet's resolved '*' channel under notify 'channel'
  push: boolean;            // false = mark only (D-3294)
}

/** A release is news to the fleet, not to one node: no node's refusal is an input. */
const NO_REFUSALS: ReadonlySet<string> = new Set<string>();

/** The channel whose newest release `notify` announces, or null for none. `stable`
 *  is stable promotions only, whatever the fleet follows; `channel` is the
 *  fleet's own resolved '*' channel, and a NULL one (a token this build cannot
 *  read, D-3181) announces nothing — never the stable default. */
function notifyChannel(notify: NotifyMode, fleetChannel: UpdateChannel | null): UpdateChannel | null {
  switch (notify) {
    case 'off': return null;
    case 'stable': return 'stable';
    case 'channel': return fleetChannel;
  }
}

/** Fix round 1 (F12, D-3317): the newest tag any row has ever been marked notified for — scanned over
 *  EVERY row, whether or not it is still eligible on any channel (a yanked or bundle-dropped row keeps its
 *  `notifiedAt`; `releases()` never clears it). null when nothing has ever been marked. */
function lastAnnouncedTag(releases: readonly NotifyReleaseRow[]): string | null {
  let best: string | null = null;
  for (const r of releases) {
    if (r.notifiedAt === null || !isReleaseTag(r.tag)) continue;
    if (best === null || isNewerTag(r.tag, best)) best = r.tag;
  }
  return best;
}

/** null = nothing to decide, nothing to mark: notify 'off'; no '*' row; notify 'channel' with a NULL channel
 *  (an unknown token, D-3181); no eligible release on the target channel; no node has measuredAt !== null
 *  (D-3300); or the candidate is not NEWER than the newest tag ever announced (D-3317 — this subsumes the
 *  plain self-check: a candidate equal to the last announced tag is never newer than itself).
 *  Candidate = eligibleTags(releases, target, ∅)[0] — ONLY the newest; an older tag is never announced once a
 *  newer one has been, even if that newer one is later yanked (D-3317: the silencing survives a yank).
 *  push = some MEASURED node is not reachable, or has currentVersion null, not a tag, or older than the
 *  candidate (D-3294; D-3316: an unreachable node's cached version is unconfirmed, so it never counts as
 *  "already on vX" and can never be the fact that suppresses a push). */
export function releaseToNotify(input: NotifyInput): ReleaseNotification | null {
  if (input.fleetIntent === null) return null;
  const channel = notifyChannel(input.fleetIntent.notify, input.fleetIntent.channel);
  if (channel === null) return null;
  // A placeholder row is UNMEASURED, not unversioned: on a fleet nobody has
  // measured yet, "no node is older" is vacuously true and would mark the tag
  // with no push, losing it for good. Wait for the sweep that measures.
  const measured = input.nodes.filter((n) => n.measuredAt !== null);
  if (measured.length === 0) return null;
  const tag = eligibleTags(input.releases, channel, NO_REFUSALS)[0];
  if (tag === undefined) return null;
  const announced = lastAnnouncedTag(input.releases);
  if (announced !== null && !isNewerTag(tag, announced)) return null;
  // D-3294/D-3316: a release every measured, REACHABLE node already runs (or runs past) is marked, not
  // pushed. Unversioned and unreadable versions are behind by definition — nothing proves them current — and
  // neither is an unreachable one: it is treated as not-current regardless of its cached value, exactly like
  // a stamp that never read, so it cannot be the sole reason a fleet reads as already up to date.
  const push = measured.some((n) => !n.reachable || !isReleaseTag(n.currentVersion) || isNewerTag(tag, n.currentVersion));
  return { tag, channel, push };
}

// ── The release push's copy (plan W3 Task 3; design 2026-09-20 §13) ──────────────────────────────────────
// Pure strings, beside the decision they announce. The summary clause is the CALLER's argument
// (`versionsSummary`, shared/update-summary.ts), so this file spells no part of it and imports nothing new.

/** Where the tap lands: the settings screen's release list (push-sw.js prefers a payload `url`, Task 4). */
export const RELEASE_PUSH_URL = '/settings';

/** The tray collapse key — the ONE spelling, as `mergedKey` is the one spelling of the merged tag
 *  (`watch.ts`'s `mergedKey`). One tag, one notification: a repeat (which the persisted mark exists to prevent)
 *  would replace, never stack. */
export function releasePushTag(tag: string): string {
  return `release-${tag}`;
}

export interface ReleasePushCopy { title: string; body: string; tag: string; url: string }

/** title `ccrc <tag> is out`; body `On <channel> — <summary>. Tap to see what's new.`; the collapse tag;
 *  the url. `n.push` is not read: a mark-only decision builds no copy, and the caller never asks. */
export function releasePushCopy(n: ReleaseNotification, summary: string): ReleasePushCopy {
  return {
    title: `ccrc ${n.tag} is out`,
    body: `On ${n.channel} — ${summary}. Tap to see what's new.`,
    tag: releasePushTag(n.tag),
    url: RELEASE_PUSH_URL,
  };
}
