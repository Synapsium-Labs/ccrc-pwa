// The inspector's History (W2 Task S8, D-5474): a door to the session's lifecycle history. It runs `open-history`
// (`commandDoor`), which the session screen answers by opening its one `HistoryTab`; the inspector owns no sheet.
import type { ReactNode } from 'react';
import { InspectorSection } from './InspectorSection';
import { useSessionDoor } from './sessionDoor';
import { useInspectorSession } from './useInspectorSession';

export function HistorySection(): ReactNode {
  const session = useInspectorSession();
  // Inert, and marked so, until the session screen can run it (console speed C1, review 1464 F4).
  const door = useSessionDoor('open-history');
  if (session === null) return null;
  return (
    <InspectorSection id="history" title="History">
      <button type="button" className="insp-link" {...door}>
        Open history
      </button>
    </InspectorSection>
  );
}
