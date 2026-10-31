// The inspector's shared sections (W2 Task S8, D-5474; spec §5.1 and §5.3, Inspector). Shared, and tested once
// (`inspector.test.tsx`): each reads the open session through `useInspectorSession()` and renders nothing off a session
// route, so either skin places them in its inspector slot without handing them a value. Each skin places them by width
// (Refined: a 320 rail at >=1600; Instrument: S12). Version and cost join in S16 (D-5104) as `FactsSection`.
// A section with nothing to show renders nothing (desktop polish T3d, D-6334), so with no content the rail holds
// History alone.
import type { ReactNode } from 'react';
import { HistorySection } from './HistorySection';
import { LaneSection } from './LaneSection';
import { MailSection } from './MailSection';
import { PrSection } from './PrSection';
import { RoutingSection } from './RoutingSection';
import { TasksSection } from './TasksSection';
import './inspector.css';

export { HistorySection, LaneSection, MailSection, PrSection, RoutingSection, TasksSection };

/** Every section, in the spec's order. */
export function InspectorSections(): ReactNode {
  return (
    <>
      <TasksSection />
      <MailSection />
      <PrSection />
      <RoutingSection />
      <LaneSection />
      <HistorySection />
    </>
  );
}
