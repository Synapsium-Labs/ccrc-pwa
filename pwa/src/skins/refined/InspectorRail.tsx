// Refined's inspector (W2 Task S8, D-5474; spec §5.3, Inspector, wide row): at >=1600, on a session route, a 320 rail to
// the right of the reading column, which scrolls itself, inside the frame's `<aside aria-label="Inspector">`. Below
// 1600 and off a session route it renders nothing (the aside is then empty, and `refined.css` gives it no track), and
// today's strips, chips and sheets carry the same content; at >=1600 the column does not render the task and mail
// strips (`SessionScreen`), so each is mounted once at any width.
//
// The sections are the SHARED ones (`inspector/`), placed here in Refined's order: this file defines none. A section
// with nothing to show renders nothing, so with no content the rail holds History alone (desktop polish T3d, D-6334).
import type { ReactNode } from 'react';
import { useMediaQuery } from '../../lib/useMediaQuery';
import {
  HistorySection, LaneSection, MailSection, PrSection, RoutingSection, TasksSection,
} from '../../inspector/InspectorSections';
import { INSPECTOR_QUERY, useInspectorSession } from '../../inspector/useInspectorSession';

export function InspectorRail(): ReactNode {
  const wide = useMediaQuery(INSPECTOR_QUERY);
  const session = useInspectorSession();
  if (!wide || session === null) return null;
  return (
    <div className="ref-inspector">
      <TasksSection />
      <MailSection />
      <PrSection />
      <RoutingSection />
      <LaneSection />
      <HistorySection />
    </div>
  );
}
