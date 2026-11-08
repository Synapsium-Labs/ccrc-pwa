// Settings › Automation (settings spec §3.3, §5.4; D-5503): twelve cards, in this order, each a `Section` with its
// scope and purpose line: Stall watch, Temp root collector, Dispatches that never came back (D-7319), Cleanup pause,
// Browser tools (D-8121), which reads the updates poll's fleet node and the fleet frame, Roll idle sessions (D-7453), which reads and writes its own door, Stop leftovers (D-7902), which reads the coord frame
// through its one reader (`paneScopeStopMarker`) and writes its switch, Leftover processes (D-7994), Worktrees left behind (D-8114), which reads the frame's view, Backups (D-7860) and
// Work in transcript folders (D-7898), which read the shell's health poll, then Test box (D-7412), the section's last card
// (D-7418), which reads the frame's view and writes its switch and its tools sync. Cleanup pause is its own card since
// settings Task R2b2, because it stops more than the collector; it offers Pause only and links to Runs for Resume.
// Stall watch, the collector, the dispatch switch, the leftover processes, the kept worktrees and the test box read the frame's one view
// (`SettingsDataProvider`), never their own endpoints, so the index's status line and this page never read twice; the pause reads the coord frame through the one reader
// (`childReclaimMarker`). The page's `<h2>` is the frame's and each card's title is an `<h3>`.
import type { ReactNode } from 'react';
import { Section } from '@ccrc/ui';
import { CollectLaneSection, PauseAllCleanup } from '../../fleet/CollectLaneSection';
import { DispatchAbandonSection } from '../../fleet/DispatchAbandonSection';
import { ScopeSweepSection } from '../../fleet/ScopeSweepSection';
import { DelegationAdoptSection } from '../../fleet/DelegationAdoptSection';
import { SETTINGS_CARDS } from '../../fleet/settingsText';
import { StallWatchSection } from '../StallWatchSection';
import { RollIdleSection } from '../../fleet/RollIdleSection';
import { PaneScopeStopSection } from '../../fleet/PaneScopeStopSection';
import { BrowserToolsSection } from '../../fleet/BrowserToolsSection';
import { TestBoxSection } from '../../fleet/TestBoxSection';
import { BackupSection } from '../../fleet/BackupSection';
import { TranscriptWorkSection } from '../../fleet/TranscriptWorkSection';
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
      <BrowserToolsSection nodes={view.updates.view?.nodes ?? null} />
      <RollIdleSection />
      <PaneScopeStopSection />
      <ScopeSweepSection poll={view.scopeSweep} />
      <DelegationAdoptSection poll={view.delegationAdopt} />
      <BackupSection />
      <TranscriptWorkSection />
      <TestBoxSection poll={view.testbox} />
    </>
  );
}
