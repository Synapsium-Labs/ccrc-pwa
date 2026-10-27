// The inspector's Routing (W2 Task S8, D-5474): the model and the effort as the header's own chips, each a door to its
// chooser (`session-model`, `session-effort`), with what the routing record says about them, read once by `routeView`:
// a value asked for and not read back yet (`queued`, measured from the wire), a field this lane does not apply, and a
// field whose read failed. Before the first fleet frame there is no record to read, and it says so.
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import { commandDoor } from '../command/door';
import { accountProvider } from '../lib/accounts';
import { metaChipTone, type MetaChipTone } from '../session/chipTones';
import { routeView } from '../session/routeView';
import { useFleetStore } from '../stores/fleet';
import { InspectorSection } from './InspectorSection';
import { useInspectorSession } from './useInspectorSession';

function Note({ queued, intended, inert, unreadable }: {
  queued: boolean; intended: string | null; inert: boolean; unreadable: boolean;
}): ReactNode {
  if (queued) return <span className="route-queued">{intended === null ? 'queued' : `queued: ${intended}`}</span>;
  if (inert) return <span className="insp-note">not applied on this lane</span>;
  if (unreadable) return <span className="insp-note">routing could not be read</span>;
  return null;
}

/** One routed field: its chip, a door to its chooser, and what the routing record says about it. */
function RoutingRow({ label, command, tone, text, note }: {
  label: string; command: string; tone: MetaChipTone; text: string; note: ReactNode;
}): ReactNode {
  return (
    <div className="insp-routing-row">
      <dt>{label}</dt>
      <dd>
        {/* Named by its field: the `dt` is a sibling, so a reader moving by buttons would hear the value alone. */}
        <button type="button" className={metaChipTone(tone)} aria-label={`${label}: ${text}, change`} {...commandDoor(command)}>
          <span className="metachip-text">{text}</span>
        </button>
        {note}
      </dd>
    </div>
  );
}

function RoutingRows({ row }: { row: FleetSession }): ReactNode {
  const roster = useFleetStore((s) => s.roster);
  const view = routeView(row, row.wrapper, accountProvider(roster, row.wrapper));
  return (
    <dl className="insp-routing">
      <RoutingRow
        label="Model" command="session-model" tone="model" text={row.model ?? 'not read yet'}
        note={<Note queued={view.wireQueuedField === 'class'} intended={view.classIntended} inert={view.classInert} unreadable={view.classUnreadable} />}
      />
      <RoutingRow
        label="Effort" command="session-effort" tone={row.ultracode ? 'ultra' : 'plain'}
        text={row.ultracode ? 'ultracode' : (row.effort ?? 'set effort')}
        note={<Note queued={view.wireQueuedField === 'effort'} intended={view.effortIntended} inert={view.effortInert} unreadable={view.effortUnreadable} />}
      />
    </dl>
  );
}

export function RoutingSection(): ReactNode {
  const session = useInspectorSession();
  if (session === null) return null;
  return (
    <InspectorSection id="routing" title="Routing">
      {session.row === null ? <p className="insp-empty">Not read yet</p> : <RoutingRows row={session.row} />}
    </InspectorSection>
  );
}
