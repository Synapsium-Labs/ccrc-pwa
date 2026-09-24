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
 *  it. `measuredAt: null` = never measured (a `markUnreachable` placeholder). */
export interface NotifyNodeRow { measuredAt: number | null; currentVersion: string | null }
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

/** null = nothing to decide, nothing to mark: notify 'off'; no '*' row; notify 'channel' with a NULL channel
 *  (an unknown token, D-3181); no eligible release on the target channel; the candidate's notifiedAt is set;
 *  or no node has measuredAt !== null (D-3300).
 *  Candidate = eligibleTags(releases, target, ∅)[0] — ONLY the newest; an older unnotified tag is never announced.
 *  push = some node with measuredAt !== null has currentVersion null, not a tag, or older than the candidate. */
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
  // Only the newest is ever a candidate, so a tag already announced silences
  // every older one — an operator who heard of v0.0.10 needs no v0.0.9 push.
  if (input.releases.find((r) => r.tag === tag)?.notifiedAt !== null) return null;
  // D-3294: a release every measured node already runs (or
  // runs past) is marked, not pushed. Unversioned and unreadable versions are
  // behind by definition — nothing proves them current.
  const push = measured.some((n) => !isReleaseTag(n.currentVersion) || isNewerTag(tag, n.currentVersion));
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
