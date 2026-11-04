// A coordinator's programme, drawn as one box inside its project card (Task G2): a kicker, the coordinator's own row,
// a tray of its workers and the children toggle as its footer. Every row is the card's own (`ProjectCard`'s
// `rowBody`, handed in as `drawRow`), so the box adds no row renderer and no door: it decides nothing either, since
// its members, state, hue, tray and words are `programmeBoxes.ts`'s.
//
// In Instrument's Status view (Task G3, D-7333) the box is drawn with `mode`'s `folded: 'needs-only'`: its tray is the
// members that ask the operator, handed in (`statusGroups.ts`'s `statusView`), so it does not fold, has no footer and
// no far-worker line, and its kicker names the project, which no card is there to say.
//
// The waiting chip (desktop-polish PL5b, D-7713) sits after the title: "N waiting on you", only above zero, a `Door` to the
// programme's view. It reads its programme's count off the fleet store's one `waiting` list, on a leaf of its own as the
// movement readout does (the selector returns the NUMBER, so a frame that changes no count renders nothing), and it takes
// no prop: the card's memo holds, and neither skin's list passes it anything.
//
// The movement readout ticks on its own leaf (`Movement`), as the folded header's `LastActive` does, so the card's
// memo (C9, D-6441) holds: the card never re-renders for the time.
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { BareRow, Door, Icon, useNow } from '@ccrc/ui';
import type { RunSummary } from '../../../shared/api';
import { programmeWaitingCount } from '../ledgers/ledgerWords';
import { navigate } from '../lib/router';
import { programmeIsOpenable, programmePath } from '../lib/routes';
import { useFleetStore } from '../stores/fleet';
import { WAITING_BADGE_UNIT, badgePrint } from './navBadges';
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

/** The chip's words, "<figure> waiting on you", the navigation badge's unit (`WAITING_BADGE_UNIT`). The figure drawn is the
 *  badges' own print (`badgePrint`, one cap, "99+"), so the widest chip is a known width and the layout is measured with it;
 *  the figure spoken is the real count, as every navigation badge's accessible name carries it (`navBadges.ts`). One
 *  spelling for both (carry C, D-7951; review 1388's advisories). */
const waitingChipWords = (figure: string): string => `${figure} ${WAITING_BADGE_UNIT}`;

/** The chip: nothing at zero (and while no list has been heard), else the count in words, and a way into the programme. */
function WaitingChip({ slug, title }: { slug: string; title: string }): ReactNode {
  // The same number the programme view's heading reads (`waitingTotal`): open items plus its sessions' questions. The
  // fleet's rows and runs count only once their frames have landed, as the navigation badge reads them.
  const count = useFleetStore((s) =>
    programmeWaitingCount(s.waiting, s.fleetFrameSeen ? s.sessions : null, s.runsFrameSeen ? s.runs : null, slug));
  if (count === null || count === 0) return null;
  const drawn = waitingChipWords(badgePrint(count));
  const spoken = waitingChipWords(String(count));
  // A slug the programme view would refuse (a name the route cannot carry) is told as a plain count, never a dead door. A
  // screen reader hears the real count there too: the capped figure is hidden from it, and the real one is said in its place.
  if (!programmeIsOpenable(slug)) {
    return (
      <span className="pg-waiting-plain">
        <span aria-hidden="true">{drawn}</span>
        <span className="sr-only">{spoken}</span>
      </span>
    );
  }
  return (
    <Door
      className="pg-waiting" glyph="›" aria-label={`${spoken}: open ${title}`}
      onClick={() => navigate(programmePath(slug))}
    >
      {drawn}
    </Door>
  );
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
        <WaitingChip slug={view.lead.slug} title={view.lead.title} />
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
