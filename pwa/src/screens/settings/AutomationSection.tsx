// Settings › Automation (settings spec §3.3, §5.4; D-5503): five cards, in this order, each a `Section` with its
// scope and purpose line: Stall watch, Temp root collector, Dispatches that never came back (D-7319), Cleanup pause,
// then Roll idle sessions (D-7453), which reads and writes its own door. Cleanup pause is its own card since
// settings Task R2b2, because it stops more than the collector; it offers Pause only and links to Runs for Resume.
// Stall watch, the collector and the dispatch switch read the frame's one view (`SettingsDataProvider`), never their own endpoints, so the
// index's status line and this page never read twice; the pause reads the coord frame through the one reader
// (`childReclaimMarker`). The page's `<h2>` is the frame's and each card's title is an `<h3>`.
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import { CollectLaneSection, PauseAllCleanup } from '../../fleet/CollectLaneSection';
import { DispatchAbandonSection } from '../../fleet/DispatchAbandonSection';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { StallWatchSection } from '../StallWatchSection';
import { RollIdleSection } from '../../fleet/RollIdleSection';
import type { SettingsView } from './SettingsDataProvider';

export function AutomationSection({ view }: { view: SettingsView }): ReactNode {
  const pause = SETTINGS_CARDS.automation.pause;
  return (
    <>
      <StallWatchSection poll={view.stall} />
      <CollectLaneSection poll={view.collect} />
      <DispatchAbandonSection poll={view.dispatchAbandon} />
      <Section level={3} scope={pause.scope} title={pause.title} purpose={pause.purpose}>
        <PauseAllCleanup />
      </Section>
      <RollIdleSection />
    </>
  );
}
