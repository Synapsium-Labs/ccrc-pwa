// The inspector's PR (W2 Task S8, D-5474): the workspace's PR state, through the header's own cap (`PrKeycap`), and its
// door to `PrSheet`. The door runs `session-pr` (`commandDoor`), which the session screen's `SessionFlows` answers by
// opening its one PR sheet: the inspector sits outside that host, and owns no sheet of its own. The section renders
// only when a PR EXISTS, that is when it has a number: a main checkout (`hasPrCap`), a row not read yet and a workspace
// that has not opened a PR all render nothing, because the header's PR door is the door to make one and a heading
// over "No PR" would only repeat it (desktop polish T3d, D-6334).
import type { ReactNode } from 'react';
import { commandDoor } from '../command/door';
import { PrKeycap, hasPrCap } from '../session/PrKeycap';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

export function PrSection(): ReactNode {
  const session = useInspectorSession();
  if (session === null) return null;
  const row = session.row;
  if (!hasPrCap(row) || row.pr === null || row.pr.number === null) return null;
  const door = commandDoor('session-pr');
  return (
    <InspectorSection id="pr" title="PR">
      <div className="insp-pr">
        <PrKeycap pr={row.pr} onOpen={door.onClick} data-command={door['data-command']} />
      </div>
    </InspectorSection>
  );
}
