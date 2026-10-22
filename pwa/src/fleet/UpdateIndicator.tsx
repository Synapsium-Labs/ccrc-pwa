// UpdateIndicator — the fleet's "a release is out" line (D-6327), one quiet door to Settings › Updates. It replaced
// the full-width banner: an available release asks for nothing now, so it is a word in a bar, not a band that pushes
// the fleet down. Every action the banner offered (Update all, See what's new, the halt's reason) lives in Settings ›
// Updates, one tap away through this door.
//
// WHAT IT SAYS is `releaseWaitingWords(view)` and nothing else of its own (releaseWaiting.ts; Settings' index line
// builds on the same words, so the two never disagree), and it speaks iff `bannerRelease` names a waiting release over
// the shell's one updates poll (`useFleetChrome().updates`). No view yet, or none waiting: it renders nothing.
// UNREACHABLE IS NOT CURRENT still holds, in `bannerRelease`. The banner's channel-and-what-runs sentence stays one
// hover away, as the door's `title` (`updateBannerText`).
//
// DISMISSED (part b): a × beside the door, in every form, hides the line on this device until a NEWER release waits
// (`releaseDismissal.ts` keeps the mark; `shownRelease` is the rule). It hides this line and nothing else: Settings ›
// Updates and its index line, BuildLine's arrow, the push and the halt banner never read the dismissal.
//
// STALE (centralised-update wave 19, R24(b)): while a later poll failed and the view is the last answer that landed,
// the shared stale sentence follows the version in tertiary ink. It is `aria-hidden`: the fleet screen's one status
// region announces it once.
//
// ONE INSTANCE PER WIDTH, by who mounts it (never a media query): `bar` in Refined's app bar, `status` in Instrument's
// status bar (both mounted by the frame at a desk only), `row` under Refined's phone header and in Instrument's fleet
// column below the desk width. A door runs its command (`commandDoor`), and navigates by nothing of its own.
import type { ReactNode } from 'react';
import { Button, Door, Icon, toast } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { CONTENT_ID } from '../skins/frame';
import { useFleetChrome } from './FleetChrome';
import { dismissRelease, useDismissedRelease } from './releaseDismissal';
import { releaseWaitingDoorName, releaseWaitingWords, shownRelease, updateBannerText } from './releaseWaiting';
import { UPDATES_STALE_TEXT } from './useUpdatesView';
import './fleet.css';

/** Hide the waiting release `tag` on this device until a newer one waits. The control that was tapped leaves the page
 *  with the line, so focus is MOVED first, to the main landmark (never left to fall to the body), and the one toast
 *  says what happened and where the release is still listed. */
function dismiss(tag: string): void {
  dismissRelease(tag);
  document.getElementById(CONTENT_ID)?.focus();
  toast(`${tag} is hidden until a newer release. Settings › Updates still lists it.`, 'info');
}

export type UpdateIndicatorForm = 'bar' | 'status' | 'row';

export function UpdateIndicator({ form }: { form: UpdateIndicatorForm }): ReactNode {
  const { updates, health } = useFleetChrome();
  const dismissed = useDismissedRelease();
  const view = updates.view;
  if (view === null) return null;
  // Part (b), D-6327: the operator's dismissal (per device) hides the line until a NEWER release waits. Nothing of the
  // line renders while it is hidden, stale words included; the screen's one status region still announces a stale view.
  const shown = shownRelease(view, dismissed);
  const words = releaseWaitingWords(view);
  const name = releaseWaitingDoorName(view);
  if (shown === null || words === null || name === null) return null;
  // Wave 19, R24(b): a later poll failed and the view is the last answer that landed.
  const stale = updates.failure !== null;
  return (
    <span className="update-indicator" data-form={form}>
      <Door
        {...commandDoor('go-settings-updates')}
        glyph={null}
        aria-label={name}
        title={updateBannerText(view, health) ?? undefined}
        className="update-indicator-door"
      >
        {words}
      </Door>
      {stale && <span className="update-indicator-stale" aria-hidden="true">{UPDATES_STALE_TEXT}</span>}
      <Button
        variant="ghost"
        size="fit"
        className="update-indicator-dismiss"
        aria-label={`Dismiss ${shown.tag}`}
        title="Hidden until a newer release; Settings › Updates still lists it"
        onClick={() => dismiss(shown.tag)}
      >
        <Icon name="x" size={16} />
      </Button>
    </span>
  );
}
