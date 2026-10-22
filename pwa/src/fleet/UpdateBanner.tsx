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
// injected, this banner's own when it polls. "See what's new" opens the
// What's-new sheet IN PLACE (WhatsNewSheet, D-5549): every release the update
// brings, with its notes. It used to open /settings, whose release list sits
// far below the fold, so the tap read as doing nothing. That sheet's own
// Update all closes it and opens the move sheet here, the same plan as this
// banner's button.
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
import type { FleetHealth, UpdatesView } from '../../../shared/api';
import { planMove, type PlannedMove } from './movePlan';
import { haltingNodes, updateAllHaltedText } from './updateHalt';
import { UpdateMoveSheet } from './UpdateMoveSheet';
import { WhatsNewSheet } from './WhatsNewSheet';
import { UPDATES_POLL_MS, UPDATES_STALE_TEXT, useUpdatesView } from './useUpdatesView';
import { bannerRelease, updateBannerText } from './releaseWaiting';
import './fleet.css';
import { Button } from '@ccrc/ui';

// Kept only so screens/settings/UpdatesSection.tsx resolves until its import moves to ./releaseWaiting.
export { bannerRelease } from './releaseWaiting';

/** Does the update banner show? A view has landed and it names a release to move to (`bannerRelease`, the same
 *  answer the render below gates on). The banner stack asks it (W2 Task S2c, BannerStack.tsx). */
export function updateBannerShows(view: UpdatesView | null): boolean {
  return view !== null && bannerRelease(view) !== null;
}

export function UpdateBanner({ updates: injected, health = null, onMoved, stale: staleInjected = false }: {
  updates?: UpdatesView | null; health?: FleetHealth | null; onMoved?: () => void; stale?: boolean;
} = {}): ReactNode {
  // Polls only when nothing was injected: FleetScreen polls once for the whole
  // screen; the standalone shape (tests, any other mount) still self-polls.
  const polled = useUpdatesView(injected === undefined ? UPDATES_POLL_MS : 0);
  const view = injected === undefined ? polled.view : injected;
  // Wave 19, R24(b): a later poll failed and the view is the last answer that landed — said, never a gate.
  const stale = injected === undefined ? polled.view !== null && polled.failure !== null : staleInjected;
  // The move being confirmed — a plan taken at the tap, so a poll landing
  // while the sheet is open cannot change the list under a thumb.
  const [move, setMove] = useState<PlannedMove | null>(null);
  // The What's-new sheet (D-5549). Its Update all hands over to the move sheet: one sheet at a time.
  const [whatsNew, setWhatsNew] = useState(false);
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
      {/* The render reads its own check (W2 Task S2c); the sheets below stay mounted either way. */}
      {updateBannerShows(view) && view !== null && release !== null && text !== null && (
        <div className="update-banner" role="status">
          <span className="update-banner-msg">{text}</span>
          {halted !== null && <span className="update-banner-msg" id={haltedId}>{halted}</span>}
          {stale && <span className="update-banner-msg" aria-hidden="true">{UPDATES_STALE_TEXT}</span>}
          <div className="update-banner-actions">
            <Button
              variant="ghost"
              size="fit"
              className="flex-none"
              disabled={halted !== null}
              aria-describedby={halted !== null ? haltedId : undefined}
              onClick={() => setMove(planMove(view, { scope: 'fleet', direction: 'update', tag: release.tag }))}
            >
              Update all
            </Button>
            <Button variant="primary" size="fit" className="flex-none" onClick={() => setWhatsNew(true)}>
              {"See what's new"}
            </Button>
          </div>
        </div>
      )}
      <WhatsNewSheet
        open={whatsNew && view !== null && release !== null}
        view={view}
        tag={release?.tag ?? null}
        halted={halted}
        onClose={() => setWhatsNew(false)}
        onUpdateAll={() => {
          if (view === null || release === null) return;
          setWhatsNew(false);
          setMove(planMove(view, { scope: 'fleet', direction: 'update', tag: release.tag }));
        }}
      />
      <UpdateMoveSheet open={move !== null} plan={move} onClose={() => setMove(null)} onDone={moved} />
    </>
  );
}
