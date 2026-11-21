// The Helpers section (session helpers H2, D-8872; spec 2026-11-19-session-helpers-design §4 and §10): the session's
// subagents and workflows, in the rail at 1600 px and up, and under the transcript below that or while the rail is hidden.
// One instance per width, by the strips rule `SessionScreen` applies to the mail and task strips: where the skin's
// inspector holds them, the column does not render this section's strip.
//
// L4, C3: it reads the session store (`agents`, `agentsUnmeasured`, `readEvery`, the workflow rows and `reports`, each
// replaced wholesale by the reducer), hands them to the words module (`helpersWords.ts`, which decides the head and the
// two lists) and draws the design system's section. Opening a finished row asks the server for its report through the
// store's `requestHelperReport`, read at the moment of the ask. A session with nothing to draw renders nothing.
import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { HelpersPanel, HelpersStrip } from '@ccrc/ui';
import { helpersView } from '../session/helpersWords';
import type { SessionStore } from '../stores/session';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

/** The section's words from the store, subscribed through the store's own `subscribe` (D-5560's pattern): the reducer
 *  replaces each member on every frame, so each snapshot is stable between frames. */
function useHelpers(store: SessionStore) {
  const workflows = useSyncExternalStore(store.subscribe, () => store.getState().workflows);
  const workflowsUnreadable = useSyncExternalStore(store.subscribe, () => store.getState().workflowsUnreadable);
  const agents = useSyncExternalStore(store.subscribe, () => store.getState().agents);
  const agentsUnmeasured = useSyncExternalStore(store.subscribe, () => store.getState().agentsUnmeasured);
  const readEvery = useSyncExternalStore(store.subscribe, () => store.getState().readEvery);
  const reports = useSyncExternalStore(store.subscribe, () => store.getState().reports);
  const view = helpersView({ workflows, workflowsUnreadable, agents, agentsUnmeasured, readEvery });
  const onReport = (id: string): void => store.getState().requestHelperReport(id);
  return { view, reports, onReport };
}

/** Under the transcript: the collapsible strip. */
export function HelpersStripFor({ store }: { store: SessionStore }): ReactNode {
  const { view, reports, onReport } = useHelpers(store);
  return view === null ? null : <HelpersStrip view={view} reports={reports} onReport={onReport} />;
}

function HelpersBody({ store }: { store: SessionStore }): ReactNode {
  const { view, reports, onReport } = useHelpers(store);
  if (view === null) return null;
  return (
    <InspectorSection id="helpers" title="Helpers">
      <HelpersPanel view={view} reports={reports} onReport={onReport} />
    </InspectorSection>
  );
}

/** In the rail: the same rows, always open, under the section's heading. */
export function HelpersSection(): ReactNode {
  const session = useInspectorSession();
  return session === null ? null : <HelpersBody store={session.store} />;
}
