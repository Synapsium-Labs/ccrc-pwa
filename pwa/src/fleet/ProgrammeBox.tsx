// A coordinator's programme, drawn as one box inside its project card (Task G2): a kicker, the coordinator's own row,
// a tray of its workers and the children toggle as its footer. Every row is the card's own (`ProjectCard`'s
// `rowBody`, handed in as `drawRow`), so the box adds no row renderer and no door: it decides nothing either, since
// its members, state, hue, tray and words are `programmeBoxes.ts`'s.
//
// In Instrument's Status view (Task G3, D-7333) the box is drawn with `mode`'s `folded: 'needs-only'`: its tray is the
// members that ask the operator, handed in (`statusGroups.ts`'s `statusView`), so it does not fold, has no footer and
// no far-worker line, and its kicker names the project, which no card is there to say.
//
// The movement readout ticks on its own leaf (`Movement`), as the folded header's `LastActive` does, so the card's
// memo (C9, D-6441) holds: the card never re-renders for the time.
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { BareRow, Icon, useNow } from '@ccrc/ui';
import type { RunSummary } from '../../../shared/api';
import { fleetRowKey, type FleetRow } from './nestFleet';
import {
  footerWords, movementWords, progressWords, type BoxState, type ProgHue, type ProgrammeBoxView, type Tray,
} from './programmeBoxes';
import './programmeBox.css';

/** Keyed on the box's state where it is drawn, so when the state turns (a box crossing its stall boundary, Task G1b) its
 *  clock starts again at that instant: the readout agrees with the state from the boundary on (spec §2.5), never "no
 *  move 1h 59m" on a stalled box for up to 30 s. */
function Movement({ view, state, nowMs }: { view: ProgrammeBoxView; state: BoxState; nowMs: number | undefined }): ReactNode {
  const tick = useNow(30_000, nowMs === undefined && view.lastMoveAt !== null);
  const words = movementWords(view, state, nowMs ?? tick);
  return words === '' ? null : <span className="pg-moved" data-state={state}>{words}</span>;
}

export function ProgrammeBox({ view, state, tray, drawRow, drawAbroad, hueOf, onToggleChildren, nowMs, mode }: {
  view: ProgrammeBoxView;
  state: BoxState;
  /** The rollup's fold of this box's children (`trayOf`). */
  tray: Tray;
  /** The card's own row: the coordinator at depth 0, a worker at depth 1 in the programme hue `hue`. */
  drawRow: (row: FleetRow, hue?: ProgHue) => ReactNode;
  /** The card's own abroad line, for a far worker. */
  drawAbroad: (run: RunSummary) => ReactNode;
  /** A worker's own programme hue: the lead's, or another of this coordinator's programmes'. */
  hueOf: (row: FleetRow) => ProgHue | undefined;
  onToggleChildren?: (parentId: string) => void;
  /** A test's clock for the movement readout; absent, the readout ticks its own. */
  nowMs?: number;
  /** The Status view's box (Task G3): the tray only as handed in, no footer, no far workers, the project named. */
  mode?: { readonly folded: 'needs-only'; readonly project: string };
}): ReactNode {
  const progress = progressWords(view.progress);
  const foot = mode === undefined ? footerWords(view, tray) : null;
  const abroad = mode === undefined ? view.abroad : [];
  return (
    <section className="pg-box" data-hue={view.lead.hue} data-state={state}>
      <div className="pg-kicker" data-hue={view.lead.hue}>
        <Icon name="workflow" className="pg-ico" />
        <span className="pg-word">Programme</span>
        <span className="pg-sep" aria-hidden="true">·</span>
        <span className="pg-title">{view.lead.title}</span>
        {view.more > 0 && <span className="pg-also">{`+ ${view.more} more`}</span>}
        {mode !== undefined && (
          <>
            <span className="pg-sep" aria-hidden="true">·</span>
            <span className="pg-project">{mode.project}</span>
          </>
        )}
        {progress !== null && (
          <span className="pg-prog">
            {progress.share !== null && (
              <span className="pg-bar" aria-hidden="true">
                <i style={{ width: `${Math.round(progress.share * 100)}%` }} />
              </span>
            )}
            <span className="pg-count">{progress.text}</span>
          </span>
        )}
      </div>
      <div className="pg-coord">
        {drawRow({ kind: 'session', depth: 0, session: view.coordinator })}
        <Movement key={state} view={view} state={state} nowMs={nowMs} />
      </div>
      {(tray.rows.length > 0 || abroad.length > 0) && (
        <div className="pg-tray">
          {tray.rows.map((row) => (
            <Fragment key={fleetRowKey(row)}>{drawRow(row, hueOf(row))}</Fragment>
          ))}
          {abroad.length > 0 && <div className="proj-abroad">{abroad.map(drawAbroad)}</div>}
        </div>
      )}
      {foot !== null && tray.summary !== null && (
        <div className="pg-foot">
          <BareRow
            className="proj-children-toggle"
            aria-expanded={tray.summary.expanded}
            onClick={() => onToggleChildren?.(view.coordinatorId)}
          >
            <span className="proj-card-chevron" aria-hidden="true">{tray.summary.expanded ? '▾' : '▸'}</span>
            <span className="proj-children-parts">
              {foot.map((w, i) => (
                <Fragment key={w}>
                  {i > 0 && ' · '}
                  <span className="proj-children-part">{w}</span>
                </Fragment>
              ))}
            </span>
          </BareRow>
        </div>
      )}
    </section>
  );
}
