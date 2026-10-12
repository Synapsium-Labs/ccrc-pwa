// UpdateBanner — the fleet screen's "a release is out" line (centralised-update
// design 2026-09-20 §13; programme wave 3). One sentence and two buttons, over
// the answer FleetScreen's one /api/updates poll hands down. The sentence is
// `<tag> is out on <channel> — <summary>.`, the summary being summaryFromSides's
// (shared/update-summary.ts, over the sides this file's own remoteSides/versionSides pick — W5 review 161,
// F-L: the convenience wrapper versionsSummary this comment used to name is gone; this file never composed
// through it either) — the ONE spelling of what the nodes run, which
// the release push reads too; this file never restates it.
//
// It speaks iff the catalogue has been reached at least once since the server
// started (`catalogue.lastOkAt` is a number) AND some node's ONE arrow
// predicate (`pendingTag`, useUpdatesView.ts) names a tag. UNREACHABLE IS NOT
// CURRENT (§7, §18): a server that has never reached GitHub cannot know that
// nothing is newer, and a node that was never measured, whose channel this
// build cannot name, or that is UNREACHABLE (`reachable !== true`, fix round
// 2, D-3316), has no arrow (nor does a macOS node, which this programme does
// not manage — decision 17) — so in each case the banner says nothing on
// that node's account, never a calm "up to date" nobody measured, and never
// an arrow off a stale reading. The settings screen is where the unknown is
// spelled out.
//
// THE FLEETHOSTBANNER IDIOM (FleetHostBanner.tsx): an injected prop (FleetScreen
// polls once and hands the view down), null when silent, a self-polling
// standalone shape for every other mount. role="status" like every banner on
// this screen — which is why it carries a class of its own, `.update-banner`,
// and never `.fleet-host-banner--warn`: a release being out is news, not a
// fault, and several status regions share this screen.
//
// "Update all" opens the one move sheet (UpdateMoveSheet, programme wave 5)
// with this banner's tag: every node the tag takes forward, named in dispatch
// order, and one `apply {all: true, tag}` on confirm — a Sheet, because a
// close-on-tap confirm cannot say a refusal (D-3389).
// After a 2xx the sheet calls onMoved: the screen's re-poll when the view was
// injected, this banner's own when it polls. "See what's new" opens /settings,
// where the release list is.
//
// WHILE A NODE HALTS THE FLEET (programme wave 14, R15(b)), Update all is
// disabled, and a second line says why and where the remedy is: the halt
// banner's Ack. Before this wave the tap opened the sheet, the route answered
// 202, and the sheet said "acknowledge that node" with no Ack in sight. Who
// halts is `haltingNodes` (updateHalt.ts), the dispatcher's own rule from L0;
// the line is tied to the button by aria-describedby. The route is unchanged:
// `{all: true}` still answers 202 for a tap that lands before the poll sees
// the halt, and the sheet says that skip (UpdateMoveSheet's moveSkippedText).
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetHealth, UpdateChannel, UpdatesView } from '../../../shared/api';
import { compareReleaseTags } from '../../../shared/semver';
import { remoteSides, statedOf, summaryFromSides, versionSides } from '../../../shared/update-summary';
import { navigate } from '../lib/router';
import { planMove, type PlannedMove } from './movePlan';
import { haltingNodes, updateAllHaltedText } from './updateHalt';
import { UpdateMoveSheet } from './UpdateMoveSheet';
import { UPDATES_POLL_MS, isPlaceableInstant, nodeVersion, pendingTag, useUpdatesView } from './useUpdatesView';
import './fleet.css';

/** The release the banner announces: the NEWEST `pendingTag` across the
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

export function UpdateBanner({ updates: injected, health = null, onMoved }: {
  updates?: UpdatesView | null; health?: FleetHealth | null; onMoved?: () => void;
} = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for the whole
  // screen; the standalone shape (tests, any other mount) still self-polls.
  const polled = useUpdatesView(injected === undefined ? UPDATES_POLL_MS : 0);
  const view = injected === undefined ? polled.view : injected;
  // The move being confirmed — a plan taken at the tap, so a poll landing
  // while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  const haltedId = useId();
  // After a 2xx: the screen's re-poll when it handed one down, else this
  // banner's own (useUpdatesView(0)'s reload is a no-op, by its contract).
  const moved = injected === undefined ? polled.reload : (onMoved ?? (() => {}));
  const release = view !== null ? bannerRelease(view) : null;
  const text = view !== null ? updateBannerText(view, health) : null;
  const halting = view !== null ? haltingNodes(view.nodes) : [];
  const halted = halting.length > 0 ? updateAllHaltedText(halting) : null;
  return (
    <>
      {view !== null && release !== null && text !== null && (
        <div className="update-banner" role="status">
          <span className="update-banner-msg">{text}</span>
          {halted !== null && <span className="update-banner-msg" id={haltedId}>{halted}</span>}
          <div className="update-banner-actions">
            <button
              type="button"
              className="btn-ghost"
              disabled={halted !== null}
              aria-describedby={halted !== null ? haltedId : undefined}
              onClick={() => setMove(planMove(view, { scope: 'fleet', direction: 'update', tag: release.tag }))}
            >
              Update all
            </button>
            <button type="button" className="btn-primary" onClick={() => navigate('/settings')}>
              {"See what's new"}
            </button>
          </div>
        </div>
      )}
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={moved} />
    </>
  );
}
