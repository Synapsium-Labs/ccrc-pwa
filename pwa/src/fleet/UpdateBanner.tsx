// UpdateBanner — the fleet screen's "a release is out" line (centralised-update
// design 2026-09-20 §13; programme wave 3). One sentence and two buttons, over
// the answer FleetScreen's one /api/updates poll hands down. The sentence is
// `<tag> is out on <channel> — <summary>.`, the summary being versionsSummary's
// (shared/update-summary.ts) — the ONE spelling of what the nodes run, which
// the release push reads too; this file never restates it.
//
// It speaks iff the catalogue has been reached at least once since the server
// started (`catalogue.lastOkAt` is a number) AND some node's ONE arrow
// predicate (`pendingTag`, useUpdatesView.ts) names a tag. UNREACHABLE IS NOT
// CURRENT (§7, §18): a server that has never reached GitHub cannot know that
// nothing is newer, and a node that was never measured, or whose channel this
// build cannot name, has no arrow (nor does a macOS node, which this programme
// does not manage — decision 17) — so in each case the banner says nothing,
// never a calm "up to date" nobody measured. The settings screen is where the
// unknown is spelled out.
//
// THE FLEETHOSTBANNER IDIOM (FleetHostBanner.tsx): an injected prop (FleetScreen
// polls once and hands the view down), null when silent, a self-polling
// standalone shape for every other mount. role="status" like every banner on
// this screen — which is why it carries a class of its own, `.update-banner`,
// and never `.fleet-host-banner--warn`: a release being out is news, not a
// fault, and several status regions share this screen.
//
// "Update all" is DISABLED beside MOVE_DISABLED_TEXT: the apply route it would
// call does not exist in this wave (spec §13, §18 "the move controls are
// disabled in W3"). "See what's new" opens /settings, where the release list is.
import { useId } from 'react';
import type { ReactNode } from 'react';
import type { UpdateChannel, UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { versionsSummary } from '../../../shared/update-summary';
import { MOVE_DISABLED_TEXT } from '../lib/api';
import { navigate } from '../lib/router';
import { UPDATES_POLL_MS, nodeVersion, pendingTag, useUpdatesView } from './useUpdatesView';
import './fleet.css';

/** The release the banner announces: the NEWEST `pendingTag` across the
 *  inventory in semver order (`v0.0.10` above `v0.0.9` — string order has it
 *  the other way round), with the channel of the node that is behind it.
 *  `null` when the catalogue has never been reached since the server started,
 *  or when no node has an arrow. */
export function bannerRelease(view: UpdatesView): { tag: string; channel: UpdateChannel } | null {
  if (typeof view.catalogue.lastOkAt !== 'number') return null;
  if (!Array.isArray(view.nodes)) return null;
  let best: { tag: string; channel: UpdateChannel } | null = null;
  for (const n of view.nodes) {
    const tag = pendingTag(n);
    if (tag === null) continue;
    // pendingTag answers a tag only for a node whose channel is an
    // UpdateChannel (its contract). Restating that check here would be a
    // SECOND arrow predicate — one that keeps this banner green over a
    // pendingTag that lost its channel clause — so the type is asserted, not
    // re-derived.
    const channel = n.channel as UpdateChannel;
    if (best === null || compareReleaseTags(tag, best.tag) === 1) best = { tag, channel };
  }
  return best;
}

/** `${tag} is out on ${channel} — ${summary}.` over the MEASURED nodes only: a
 *  row nobody has measured has no version to report, and reading it as
 *  "unversioned" would state a measurement nobody made — versionsSummary says
 *  the side is missing instead. */
export function updateBannerText(view: UpdatesView): string | null {
  const release = bannerRelease(view);
  if (release === null) return null;
  const measured = view.nodes
    .filter((n) => typeof n.measuredAt === 'number')
    .map((n) => ({ role: n.role, version: nodeVersion(n) }));
  return `${release.tag} is out on ${release.channel} — ${versionsSummary(measured)}.`;
}

export function UpdateBanner({ updates: injected }: { updates?: UpdatesView | null } = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for the whole
  // screen; the standalone shape (tests, any other mount) still self-polls.
  const polled = useUpdatesView(injected === undefined ? UPDATES_POLL_MS : 0);
  const view = injected === undefined ? polled.view : injected;
  const noteId = useId();
  const text = view ? updateBannerText(view) : null;
  if (text === null) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-banner-msg">{text}</span>
      <div className="update-banner-actions">
        <button type="button" className="btn-ghost" disabled aria-describedby={noteId}>
          Update all
        </button>
        <button type="button" className="btn-primary" onClick={() => navigate('/settings')}>
          {"See what's new"}
        </button>
        <span id={noteId} className="update-banner-note">{MOVE_DISABLED_TEXT}</span>
      </div>
    </div>
  );
}
