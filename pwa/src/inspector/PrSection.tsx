// The inspector's PR (W2 Task S8, D-5474): the workspace's PR state, through the header's own cap (`PrKeycap`), and its
// door to `PrSheet`. The door runs `session-pr` (`commandDoor`), which the session screen's `SessionFlows` answers by
// opening its one PR sheet: the inspector sits outside that host, and owns no sheet of its own. A main checkout has no
// PR (`hasPrCap`), and says so.
import type { ReactNode } from 'react';
import { commandDoor } from '../command/door';
import { PrKeycap, hasPrCap } from '../session/PrKeycap';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

export function PrSection(): ReactNode {
  const session = useInspectorSession();
  if (session === null) return null;
  const row = session.row;
  const door = commandDoor('session-pr');
  return (
    <InspectorSection id="pr" title="PR">
      {hasPrCap(row) ? (
        <div className="insp-pr">
          <PrKeycap pr={row.pr} onOpen={door.onClick} data-command={door['data-command']} />
        </div>
      ) : (
        <p className="insp-empty">{row === null ? 'Not read yet' : 'No PR: a main checkout'}</p>
      )}
    </InspectorSection>
  );
}
