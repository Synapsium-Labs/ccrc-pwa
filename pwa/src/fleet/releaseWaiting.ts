// releaseWaiting — the ONE decision of which release waits, and the sentences that name it. It imports no component,
// store or the fetch adapter directly (its one runtime import of `useUpdatesView.ts` is for `newestPending`). The
// fleet's update line (UpdateIndicator) and Settings › Updates both read these answers, so the two surfaces cannot
// name different releases or spell what the nodes run two ways. `bannerRelease` and `updateBannerText` moved here
// unchanged from UpdateBanner.tsx (D-6327, behaviour-neutral); the arrow predicate itself stays `pendingTag`
// (shared/update-arrow.ts).
import { isReleaseTag, type FleetHealth, type UpdateChannel, type UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { nodeVersion } from '../../../shared/update-arrow';
import { remoteSides, statedOf, summaryFromSides, versionSides } from '../../../shared/update-summary';
import { isPlaceableInstant } from '../lib/format';
import { newestPending } from './useUpdatesView';

/** The release that waits: the NEWEST `pendingTag` across the
 *  inventory in semver order (`v0.0.10` above `v0.0.9` — string order has it
 *  the other way round), with the channel of the node that is behind it.
 *  `null` when the catalogue has never been reached since the server started,
 *  or when no node has an arrow. */
export function bannerRelease(view: UpdatesView): { tag: string; channel: UpdateChannel } | null {
  // fix round 1 (F13, item 8): `typeof … === 'number'` alone let a magnitude
  // this build's `Date` cannot place (`1e20`) read as "reached", the settings
  // catalogue line's own `isPlaceableInstant` guard already refused — the same
  // predicate, imported rather than re-derived, so the two surfaces cannot
  // answer differently about the same `lastOkAt`.
  if (typeof view.catalogue.lastOkAt !== 'number' || !isPlaceableInstant(view.catalogue.lastOkAt)) return null;
  if (!Array.isArray(view.nodes)) return null;
  // The newest arrow across the inventory, the same one the Settings release window puts first (D-5505).
  const best = newestPending(view.nodes);
  if (best === null) return null;
  // pendingTag answers a tag only for a node whose channel is an
  // UpdateChannel (its contract). Restating that check here would be a
  // SECOND arrow predicate — one that keeps this decision green over a
  // pendingTag that lost its channel clause — so the type is asserted, not
  // re-derived.
  return { tag: best.tag, channel: best.node.channel as UpdateChannel };
}

/** `${tag} is out on ${channel} — ${summary}.`, routed through the SAME L0
 *  rule the push body uses (fix round 1, F1/F14, D-3313/D-3316; group A's
 *  `server/src/watch.ts:pushRelease` is the server-side twin of this exact
 *  computation) — sides are picked from EVERY live row, never a pre-filtered
 *  subset: filtering first is what let a `both` server row's own version
 *  stand in for a fleet nobody measured (the reviewer's exact rows, F1).
 *  `stated` (`statedOf`, `shared/update-summary.ts`, fix round 2 item 5) is
 *  the per-row "does this reading vouch for its version" fact — measured this
 *  poll, its stamp read, and (D-3316) reachable — so an occupying row that
 *  fails it renders as a dash, never its stale value, but still blocks
 *  another row from falling back into its side.
 *
 *  Fix round 2 (review of d5aefc4a, item 3): while `health` is UNKNOWN
 *  (`null`, the default — the mode has not loaded yet, or was never handed
 *  down) this now reads as REMOTE, not local. A dash claims nothing; the
 *  local fallback (`versionSides`' `both`-row-is-both-sides rule) would state
 *  a fleet version nobody has actually measured yet, off a box that might
 *  turn out to be remote — the exact class of defect D-3313 exists to
 *  refuse. `versionSides` (the permissive, local-mode form) is used ONLY when
 *  `health` EXPLICITLY says `'local'`; both `'remote'` and unknown route
 *  through `remoteSides`. */
export function updateBannerText(view: UpdatesView, health?: FleetHealth | null): string | null {
  const release = bannerRelease(view);
  if (release === null) return null;
  const rows = view.nodes.map((n) => ({ role: n.role, version: nodeVersion(n), stated: statedOf(n) }));
  const knownLocal = health != null && health.mode === 'local';
  const sides = knownLocal ? versionSides(rows) : remoteSides(rows);
  return `${release.tag} is out on ${release.channel} — ${summaryFromSides(sides)}.`;
}

/** `v0.0.9 available`: the tag and its one verb, spelled here and nowhere else. */
const tagAvailable = (tag: string): string => `${tag} available`;

/** The words of the fleet's update line and of Settings' index line for the waiting release: `↑ v0.0.9 available`,
 *  or `null` when no release waits (`bannerRelease`'s answer, so the two surfaces never disagree). The one place the
 *  sentence is spelled; a caller appends its own suffix and never rebuilds it. */
export function releaseWaitingWords(view: UpdatesView): string | null {
  const release = bannerRelease(view);
  return release === null ? null : `↑ ${tagAvailable(release.tag)}`;
}

/** The update line's accessible name, `Update v0.0.9 available, open Settings › Updates`: the same tag and verb as
 *  {@link releaseWaitingWords}, with where the door goes. `null` when no release waits. */
export function releaseWaitingDoorName(view: UpdatesView): string | null {
  const release = bannerRelease(view);
  return release === null ? null : `Update ${tagAvailable(release.tag)}, open Settings › Updates`;
}

/** The release the fleet's update line shows, given the highest tag the operator dismissed on this device (`null` when
 *  none): {@link bannerRelease}'s answer unless it is hidden. A HIGH-WATER MARK, as the push is: a dismissal hides that
 *  tag and any older one (a release withdrawn after a newer one was seen); only a STRICTLY newer waiting tag shows
 *  again. Tags compare in semver order (`v0.0.10` is newer than `v0.0.9`; string order says the opposite). A tag that
 *  is no release tag cannot be compared, so it is never read as hidden. Settings › Updates never calls this: it reads
 *  {@link bannerRelease} and so always lists the waiting release. */
export function shownRelease(view: UpdatesView, dismissed: string | null): { tag: string; channel: UpdateChannel } | null {
  const release = bannerRelease(view);
  if (release === null || dismissed === null) return release;
  if (!isReleaseTag(release.tag) || !isReleaseTag(dismissed)) return release;
  return compareReleaseTags(release.tag, dismissed) === 1 ? release : null;
}
