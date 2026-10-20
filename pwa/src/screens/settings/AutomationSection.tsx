// Settings › Automation (settings spec §3.1; D-5503): Stall watch, then the Temp root collector card with its Pause
// inside, as today's page placed them. Both read the frame's one view (`SettingsDataProvider`), never their own
// endpoints, so the index's status line and this page never read twice. Settings Task R2b1 moved them here from
// `SettingsScreen.tsx` unchanged; the page's `<h2>` is the frame's and each card's title is an `<h3>`.
import type { ReactNode } from 'react';
import { CollectLaneSection } from '../../fleet/CollectLaneSection';
import { StallWatchSection } from '../StallWatchSection';
import type { SettingsView } from './SettingsDataProvider';

export function AutomationSection({ view }: { view: SettingsView }): ReactNode {
  return (
    <>
      <StallWatchSection poll={view.stall} />
      <CollectLaneSection poll={view.collect} />
    </>
  );
}
