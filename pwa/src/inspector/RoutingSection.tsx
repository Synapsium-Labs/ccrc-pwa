// The inspector's Routing (W2 Task S8, D-5474; desktop polish T3d, D-6334): ONE line that says what runs and asks only
// what it can measure, built by `routingLine` from the routing record `routeView` reads. The model and the effort are
// the header's own chips inside that sentence, each still a door to its chooser (`session-model`, `session-effort`);
// what was asked and not read back yet takes the header's pending style, so the two look alike. Before the first fleet
// frame there is no row to read, and the section renders nothing.
import type { ReactNode } from 'react';
import { commandDoor } from '../command/door';
import { accountLabel, accountProvider } from '../lib/accounts';
import { metaChipTone } from '../session/chipTones';
import { routeView } from '../session/routeView';
import { routingLine } from '../session/routingLine';
import { useFleetStore } from '../stores/fleet';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

export function RoutingSection(): ReactNode {
  const session = useInspectorSession();
  const roster = useFleetStore((s) => s.roster);
  const row = session?.row ?? null;
  if (row === null) return null;
  const line = routingLine(
    row, routeView(row, row.wrapper, accountProvider(roster, row.wrapper)), accountLabel(roster, row.wrapper),
  );
  const modelText = line.model ?? 'a model not read yet';
  // Named by its field: the words around a door are text, so a reader moving by buttons would hear the value alone.
  return (
    <InspectorSection id="routing" title="Routing">
      <p className="insp-routing-row">
        Runs{' '}
        <button
          type="button" className={metaChipTone('model')} aria-label={`Model: ${modelText}, change`}
          {...commandDoor('session-model')}
        >
          <span className="metachip-text">{modelText}</span>
        </button>
        {` on ${line.lane} · effort `}
        <button
          type="button" className={metaChipTone(row.ultracode ? 'ultra' : 'plain')}
          aria-label={`Effort: ${line.effort}, change`} {...commandDoor('session-effort')}
        >
          <span className="metachip-text">{line.effort}</span>
        </button>
        {line.askedClass !== null && <span className="route-queued">{` · asked ${line.askedClass}`}</span>}
        {line.askedEffort !== null && <span className="route-queued">{` · asked effort ${line.askedEffort}`}</span>}
        {line.unreadable && <span className="insp-note">{' · routing could not be read'}</span>}
      </p>
    </InspectorSection>
  );
}
