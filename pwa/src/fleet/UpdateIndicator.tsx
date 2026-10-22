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
// STALE (centralised-update wave 19, R24(b)): while a later poll failed and the view is the last answer that landed,
// the shared stale sentence follows the version in tertiary ink. It is `aria-hidden`: the fleet screen's one status
// region announces it once.
//
// ONE INSTANCE PER WIDTH, by who mounts it (never a media query): `bar` in Refined's app bar, `status` in Instrument's
// status bar (both mounted by the frame at a desk only), `row` under Refined's phone header and in Instrument's fleet
// column below the desk width. A door runs its command (`commandDoor`), and navigates by nothing of its own.
import type { ReactNode } from 'react';
import { Door } from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { useFleetChrome } from './FleetChrome';
import { releaseWaitingDoorName, releaseWaitingWords, updateBannerText } from './releaseWaiting';
import { UPDATES_STALE_TEXT } from './useUpdatesView';
import './fleet.css';

export type UpdateIndicatorForm = 'bar' | 'status' | 'row';

export function UpdateIndicator({ form }: { form: UpdateIndicatorForm }): ReactNode {
  const { updates, health } = useFleetChrome();
  const view = updates.view;
  if (view === null) return null;
  const words = releaseWaitingWords(view);
  const name = releaseWaitingDoorName(view);
  if (words === null || name === null) return null;
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
    </span>
  );
}
