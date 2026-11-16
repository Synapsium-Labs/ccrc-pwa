// The inspector's Routing (W2 Task S8, D-5474; desktop polish T3d, D-6334): ONE line that says what runs and asks only
// what it can measure, built by `routingLine` from the routing record `routeView` reads. The model and the effort are
// the header's own chips inside that sentence, each still a door to its chooser (`session-model`, `session-effort`);
// what was asked and not read back yet takes the header's pending style, so the two look alike. Before the first fleet
// frame there is no row to read, and the section renders nothing. The words are `routingLine`'s `parts`: this file maps
// them to markup and spells none of the sentence.
import type { ReactNode } from 'react';
import { accountLabel, accountProvider } from '../lib/accounts';
import { useLaneModels } from '../lib/useLaneModels';
import { metaChipTone } from '../session/chipTones';
import { routeView } from '../session/routeView';
import { routingLine, type RoutingPart } from '../session/routingLine';
import { useFleetStore } from '../stores/fleet';
import { InspectorSection } from './InspectorSection';
import { useSessionDoor } from './sessionDoor';
import { useInspectorSession } from './useInspectorSession';

export function RoutingSection(): ReactNode {
  const session = useInspectorSession();
  const roster = useFleetStore((s) => s.roster);
  // Inert, and marked so, until the session screen can run them (console speed C1, review 1464 F4).
  const modelDoor = useSessionDoor('session-model');
  const effortDoor = useSessionDoor('session-effort');
  const row = session?.row ?? null;
  // D-8406: the lane's model files name the asked class's model; read before the early return, as every hook is.
  const laneModels = useLaneModels(row?.wrapper ?? null);
  if (row === null) return null;
  const line = routingLine(
    row, routeView(row, row.wrapper, accountProvider(roster, row.wrapper), laneModels), accountLabel(roster, row.wrapper),
    laneModels,
  );
  // Named by its field: the words around a door are text, so a reader moving by buttons would hear the value alone.
  const part = (p: RoutingPart, i: number): ReactNode => {
    switch (p.kind) {
      case 'model':
        return (
          <button key={i} type="button" className={metaChipTone(p.tone ?? 'plain')} aria-label={`Model: ${p.text}, change`}
            {...modelDoor}>
            <span className="metachip-text">{p.text}</span>
          </button>
        );
      case 'effort':
        return (
          <button key={i} type="button" className={metaChipTone(p.tone ?? 'plain')}
            aria-label={`Effort: ${p.text}, change`} {...effortDoor}>
            <span className="metachip-text">{p.text}</span>
          </button>
        );
      case 'asked': return <span key={i} className="route-queued">{p.text}</span>;
      case 'note': return <span key={i} className="insp-note">{p.text}</span>;
      default: return p.text;
    }
  };
  // A separator, the plain words after it and the door, ask or note they lead to share one nowrap tail, so the line
  // breaks before the " · " and never after it: a lone "·" would otherwise end a line while its door or pill starts the
  // next. Each tail opens on a <wbr>, the break before its " · ", which two tails in a row would not otherwise have.
  // The text is unchanged, only grouped.
  const nodes: ReactNode[] = [];
  let tail: ReactNode[] | null = null;
  line.parts.forEach((p, i) => {
    if (p.kind === 'sep') {
      nodes.push(<wbr key={`wbr-${i}`} />);
      tail = [p.text];
      return;
    }
    if (tail === null) {
      nodes.push(part(p, i));
      return;
    }
    tail.push(part(p, i));
    if (p.kind !== 'text') {
      nodes.push(<span key={`tail-${i}`} className="insp-routing-tail">{tail}</span>);
      tail = null;
    }
  });
  return (
    <InspectorSection id="routing" title="Routing">
      <p className="insp-routing-row">{nodes}</p>
    </InspectorSection>
  );
}
