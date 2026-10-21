// The inspector's History (W2 Task S8, D-5474): a door to the session's lifecycle history. It runs `open-history`
// (`commandDoor`), which the session screen answers by opening its one `HistoryTab`; the inspector owns no sheet.
import type { ReactNode } from 'react';
import { commandDoor } from '../command/door';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

export function HistorySection(): ReactNode {
  const session = useInspectorSession();
  if (session === null) return null;
  return (
    <InspectorSection id="history" title="History">
      <button type="button" className="insp-link" {...commandDoor('open-history')}>
        Open history
      </button>
    </InspectorSection>
  );
}
