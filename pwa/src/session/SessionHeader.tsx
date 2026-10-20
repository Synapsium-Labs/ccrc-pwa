// Session header — the chat's sticky, safe-area-padded top strip: back
// chevron, the session's live name (fleet `name`, falling back to project),
// status meta (breathing dot + mono word; busy ticks a live elapsed clock),
// the account chip, and raised keycaps — `>_` opens the terminal drawer,
// `⋯` opens the lifecycle overflow menu (change model / move account /
// archive), and `esc` interrupts (DIRECTION: "a keycap, not an icon"), enabled
// only while the session is busy. Confirm-free: pressing esc just sends it.
// The esc cap is touch-only: where a physical keyboard exists ((pointer:
// fine)) it hides and the real Escape key takes over instead — the session
// screen's `useEscapeInterrupt`, never this header's (W2 Task S2d, D-5466).
// The ⋯ menu and the PR sheet are `SessionFlows`', opened through
// `useSessionFlows()`, so a skin switch that replaces this chrome keeps them.
import type { ReactNode } from 'react';
import type { FleetSession, RosterWire, RouteField, SessionStatus } from '../../../shared/api';
import {
  BackButton, Chip, Keycap, StatusDot, TypedLabel, cn, useNow,
} from '@ccrc/ui';
import { commandDoor } from '../command/door';
import { useMediaQuery } from '../lib/useMediaQuery';
// main's TypedLabel import is dropped, not lost: the component lives in
// @ccrc/ui now and the line above already carries it.
import { PrKeycap } from './PrKeycap';
import { useSessionFlows } from './SessionFlows';
import './chat.css';
import { chipTone, metaChipTone } from './chipTones';
import { SessionCoordination, SessionDetails } from './SessionDetails';
import type { Coordination } from '../fleet/fleetTree';
import type { SessionFactSet } from '../fleet/sessionFacts';
// W2 Task S7a (D-5471): every word, chip and state below is the view's (`sessionHeaderView`), the one derivation both
// skins' session chrome render from. This part holds the hooks (the clock, the pointer query, the flows' doors) and
// the markup, nothing else.
import { headerTickMs, sessionHeaderView, type HeaderChip } from './sessionHeaderView';

export interface SessionHeaderProps {
  session: FleetSession | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  /** D-5237: called with the control that sent it, which the server records. The keycap's; the Escape key is the
   *  session screen's (`useEscapeInterrupt`). */
  onInterrupt: (source: 'keycap' | 'escape-key') => void;
  onBack: () => void;
  /** A routing write in flight on this field, until the pane reads it back
   *  or the 60s timeout clears it (routing spec §5.3, slice 4, Task 5) — the
   *  chip for THAT field wears a `queued` badge while this is non-null.
   *  Typed as the full `RouteField` union (only `class`/`effort` are ever
   *  passed — the two fields the model/effort pickers write — but the value
   *  arrives through `SessionScreen`'s general-purpose queue state, so this
   *  prop takes the same type rather than a narrower one no caller could
   *  satisfy without a cast). Defaults to `null` so a caller that never wires
   *  the picker's queue state renders exactly as it always did. */
  queuedField?: RouteField | null;
  /** Pre-snapshot identity derived from the session id (`wrapper:project`) —
   *  keeps the header instant on deep links before `/ws/fleet` lands. */
  fallback?: { title: string; wrapper: string };
  /** The account roster (`stores/fleet.ts`'s `roster`) — defaults to `[]` so
   *  a header rendered before the first poll lands degrades to
   *  `accountLabel`'s own raw-wrapper-name fallback rather than needing a
   *  roster it was never given. */
  roster?: readonly RosterWire[];
  /** The repository this session's project was last measured to be — R3:
   *  shown whenever known, there is no card here to imply it. `null`/absent
   *  renders nothing. */
  repo?: string | null;
  /** D-5527: who this session works for (`fleetTree.ts`'s `coordinationOf`) — its coordinator's id and
   *  state and the run number, which the session's facts do not carry. `null`: nobody's worker. */
  coordination?: Coordination | null;
  /** D-5545: the session's facts, from the same model the fleet card reads (`sessionFacts`), so the header
   *  holds every fact the card shows and the rest beside it. `null` before the first fleet frame. */
  facts?: SessionFactSet | null;
}

export function SessionHeader({
  session,
  status,
  statusUpdatedAt,
  onInterrupt,
  onBack,
  fallback,
  roster = [],
  queuedField = null,
  repo = null,
  coordination = null,
  facts = null,
}: SessionHeaderProps): ReactNode {
  const { openMenu } = useSessionFlows();
  // The PR cap runs `session-pr` (D-5469's door rule), which opens `SessionFlows`' PR sheet.
  const prDoor = commandDoor('session-pr');
  // The clock ticks every second while `working` (the live elapsed clock), else every 30s.
  const now = useNow(headerTickMs(status, session));
  // The keycap exists because phone keyboards have no Escape key. Where one
  // exists the key is the better control and the cap is clutter; the binding
  // is the session screen's `useEscapeInterrupt` (W2 Task S2d), which reads the
  // same query, so the cap hides exactly where the key takes over.
  const finePointer = useMediaQuery('(pointer: fine)');
  const view = sessionHeaderView({
    session, status, statusUpdatedAt, queuedField, fallback, roster, repo, coordination, facts, now, finePointer,
  });
  const chip = <K extends HeaderChip['kind']>(kind: K): Extract<HeaderChip, { kind: K }> | undefined =>
    view.chips.find((c): c is Extract<HeaderChip, { kind: K }> => c.kind === kind);
  const coord = chip('coordination');
  const statusChip = chip('status');
  const lane = chip('lane');
  const restart = chip('restart');
  const repoChip = chip('repo');
  const archived = chip('archived');
  const model = chip('model');
  const effort = chip('effort');
  const branch = chip('branch');
  const details = chip('details');
  const pr = chip('pr');

  return (
    <header className="chat-head">
      <BackButton className="chat-back" aria-label="Back to fleet" onClick={onBack}>
        ‹
      </BackButton>
      <div className="chat-title-wrap">
        <h1 className="chat-title">
          {view.title}
          {view.crumb !== null && (
            <>
              <span className="chat-crumb-sep" aria-hidden="true">
                ›
              </span>
              <TypedLabel className="chat-crumb" text={view.crumb} />
            </>
          )}
        </h1>
        {/* D-5527: under the name, because it says what this session IS for —
            whose code, whose programme — before the meta row says how it is. */}
        {coord !== undefined && <SessionCoordination facts={coord.facts} coordination={coord.coordination} />}
        <div className="chat-meta">
          {statusChip !== undefined && (
            <>
              <StatusDot status={statusChip.bucket} asleep={statusChip.asleep} />
              <span
                className={cn('status-line', `status-line--${statusChip.variant}`, statusChip.coordinator !== null && 'status-line--coordinator')}
                title={statusChip.title}
              >
                {statusChip.coordinator !== null ? (
                  // D-5390: the phrase yields width before the parent's name does.
                  <>
                    <span className="status-line-lead">with coordinator</span>
                    {' '}<span className="status-line-name">{`· ${statusChip.coordinator.short}`}</span>
                  </>
                ) : statusChip.word}
              </span>
            </>
          )}
          {lane !== undefined && (
            <Chip dot className={chipTone('active')} title={lane.title}>
              {lane.text}
            </Chip>
          )}
          {restart !== undefined && (
            <Chip className={chipTone('restart')} title={restart.title} data-restart={restart.cause}>
              {restart.text}
            </Chip>
          )}
          {repoChip !== undefined && (
            <Chip className={chipTone('repo')} title="repository">
              {repoChip.text}
            </Chip>
          )}
          {archived !== undefined && <Chip className={chipTone('archived')}>{archived.parts}</Chip>}
          {/* Status, account, model, effort and branch share ONE wrapping row —
              two fixed rows cost a line of chat height on every screen to say
              what fits comfortably on one. Tapping the model or effort chip opens its chooser. */}
          {model !== undefined && (model.text !== null ? (
            <button type="button" className={metaChipTone('model')} {...commandDoor('session-model')}>
              <span className="metachip-glyph" aria-hidden="true">🤖</span>
              <span className="metachip-text">{model.text}</span>
              {model.queued && <span className="route-queued">queued</span>}
            </button>
          ) : (
            <span className="route-queued">queued</span>
          ))}
          {effort !== undefined && (
            <button
              type="button"
              className={metaChipTone(effort.ultra ? 'ultra' : 'plain')}
              {...commandDoor('session-effort')}
            >
              <span className="metachip-text">{effort.text}</span>
              {effort.queued && <span className="route-queued">queued</span>}
            </button>
          )}
          {branch !== undefined && (
            <span className={metaChipTone('branch')} title={branch.text}>
              <span className="metachip-glyph" aria-hidden="true">⎇</span>
              <span className="metachip-text">{branch.text}</span>
            </span>
          )}
          {/* D-5545: every other fact, in full — a details row from 900px, behind one door on a phone. */}
          {details !== undefined && <SessionDetails facts={details.facts} coordination={details.coordination} />}
        </div>
      </div>
      <Keycap className="keycap--term" aria-label="Terminal" {...commandDoor('open-terminal')}>
        <span aria-hidden="true">&gt;_</span>
      </Keycap>
      <Keycap className="keycap--more" aria-label="More" onClick={openMenu}>
        <span aria-hidden="true">⋯</span>
      </Keycap>
      {/* Top right, to the right of the ···. `esc` keeps the OUTER edge because
          it is the interrupt and its position is muscle memory; on a fine
          pointer esc is absent and this becomes rightmost naturally. */}
      {pr !== undefined && (
        <PrKeycap pr={pr.pr} onOpen={prDoor.onClick} data-command={prDoor['data-command']} />
      )}
      {view.stop.shown && (
        <Keycap className="keycap--esc" aria-label="Stop" disabled={!view.stop.enabled} onClick={() => onInterrupt('keycap')}>
          esc
        </Keycap>
      )}
    </header>
  );
}
