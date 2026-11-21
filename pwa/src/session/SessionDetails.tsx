// The session header's FULL SET of facts (D-5545): a superset of the fleet card.
//
// The card is a glance — name, state, one context fact, one marker, the
// cross-project chip — and everything else it used to cram onto one truncating
// line lives HERE, each fact in full: who this session works for (its
// programme and wave and its coordinator, each a link, with the coordinator's
// state), whose code it works on, the run number, the verbatim hold, the role,
// the waiting question, the task tally, the last spawn, the graph counters, the
// worktrees it holds, and EVERY attention marker, not just the first. Its helpers
// are not here: the Helpers section lists and counts them (session helpers H3, D-8875).
// The facts come from `sessionFacts` — the same model the card reads — so the
// header can never know less than the card.
//
// At every width every fact stays reachable: from 900px up the details row is
// always shown; on a phone it folds behind one "details" door beside the
// coordination row, so the header stays short until it is asked.
import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Door, Icon } from '@ccrc/ui';
import { navigate } from '../lib/router';
import { runPath, sessionPath } from '../lib/routes';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { SessionMeta } from '../fleet/SessionMeta';
import { SessionWorktrees } from './SessionWorktrees';
import { cardFacts, contextFact, heldWords, type SessionFactSet } from '../fleet/sessionFacts';
import { programmeWave } from '../fleet/runWords';
import { openRunAt } from '../fleet/openers';
import { coordinationLine, type Coordination } from '../fleet/fleetTree';
import { coordinationClauses, detailRows, detailsHaveFacts } from './sessionHeaderView';

/** A plain detail — one fact in words, its tooltip when it has one. */
function Detail({ children, title }: { children: ReactNode; title?: string }): ReactNode {
  return <span className="chat-fact" title={title}>{children}</span>;
}

/** One clause of the coordination row that opens somewhere — the run board, or the coordinator's session. */
function CoordLink({ glyph, label, to, children }: { glyph: string; label: string; to: string; children: ReactNode }): ReactNode {
  return (
    <Door className="chat-coord-link" glyph={glyph} aria-label={label} onClick={() => navigate(to)}>
      {children}
    </Door>
  );
}

/** THE GOALS DOOR (desktop-polish PL11, D-7986; spec §2, D30): the programme's own glyph, the one its box's kicker wears, and
 *  its word, which chat.css shows from 1280; its accessible name and `title` name the programme
 *  (`sessionHeaderView`'s `goals.label`, review 1537 A10). It opens that programme's Goals page. */
export function GoalsDoor({ goals }: { goals: { readonly href: string; readonly label: string } }): ReactNode {
  return (
    <Door
      className="chat-coord-link chat-coord-goals" glyph={<Icon name="workflow" />} aria-label={goals.label} title={goals.label}
      onClick={() => navigate(goals.href)}
    >
      <span className="chat-coord-goals-word">Goals</span>
    </Door>
  );
}

/** Who this session works for — whose code, its programme and wave (a link to the run board) and its
 *  coordinator with its state (a link to that session). Under the name, before the meta row.
 *
 *  GOALS FROM INSIDE A SESSION (desktop-polish PL11, D-7986; spec §2, D30; review 1537 F1, ruled in fix round 1): `goals` is
 *  the Goals door of the programme this session is in (`sessionHeaderView`'s `goals`), drawn LAST on this line, the line that
 *  already names the programme, so the door takes no width from the title beside the header's doors, and the clauses before
 *  it keep their places. On a phone Refined's rail scrolls this line sideways. At a desk, last on a line that wraps, it costs
 *  the header at most its own row (review 1548, ruled in fix round 2); its word shows from 1280 (chat.css). `goals.slot` says
 *  where else it stands (`GoalsSlot`). The programme's own glyph, the one its box's kicker wears. `null`/absent: no door. */
export function SessionCoordination({ facts, coordination, goals = null }: {
  facts: SessionFactSet;
  coordination: Coordination | null;
  goals?: { readonly href: string; readonly label: string } | null;
}): ReactNode {
  const { workingOn, run, from } = coordinationClauses(facts, coordination);
  const coordinatorId = coordination?.coordinatorId ?? null;
  if (workingOn === null && run === null && from === null && goals === null) return null;
  return (
    <div className="chat-coord" title={coordination === null ? undefined : coordinationLine(coordination).title}>
      {/* Each clause its own box, with no separator glyph between them: a wrapped line can never start
          with, or hold, a lone `·` (#633's leftover). */}
      {workingOn !== null && <span className="chat-coord-part">{`works on ${workingOn}`}</span>}
      {run !== null && (
        <CoordLink glyph="≡" label={`Open the run board — ${programmeWave(run)}`} to={run.id === undefined ? '/runs' : runPath(run.id)}>
          {programmeWave(run)}
        </CoordLink>
      )}
      {from !== null && (coordinatorId !== null ? (
        <CoordLink glyph="⤴" label={`Open the coordinator — ${from}`} to={sessionPath(coordinatorId)}>
          {`coordinator ${from}${coordination?.coordinatorState == null ? '' : ` · ${coordination.coordinatorState}`}`}
        </CoordLink>
      ) : (
        <span className="chat-coord-part">{`coordinated from ${from}`}</span>
      ))}
      {goals !== null && <GoalsDoor goals={goals} />}
    </div>
  );
}

/** Everything else, in full. Always shown from 900px; behind one "details" door on a phone. */
export function SessionDetails({ facts, coordination }: {
  facts: SessionFactSet;
  coordination: Coordination | null;
}): ReactNode {
  const wide = useMediaQuery(DESK_QUERY);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const s = facts.session;
  const ctx = contextFact(facts);
  const run = ctx?.key === 'programme' ? (facts.heldRun ?? facts.activeRun) : null;
  const rows = detailRows(facts, coordination);
  const runId = rows.runId;
  // The row is drawn only when it has something to show (`detailsHaveFacts`, review 2963 F3 to F6): with nothing, no row and no door.
  const shown = detailsHaveFacts(facts, coordination);
  // Review 2995 F2: whether the details region is drawn, decided by THIS render, which every change of the facts makes. The
  // worktree controls read it when their row leaves holding the focus: a region that goes in the same commit (its last
  // worktree and its only other fact left together) cannot take the focus, so it goes to the header's title.
  const drawn = useRef(false);
  drawn.current = shown && (wide || open);
  const details = (
    <div className="chat-facts" id={detailsId} tabIndex={-1}>
      {rows.name !== null && <Detail title="this session's name">{rows.name}</Detail>}
      {runId !== null && <Detail title="the run this wave belongs to — the run board names it">{`run #${runId}`}</Detail>}
      {rows.held !== null && <Detail title="the hold, verbatim">{heldWords(rows.held)}</Detail>}
      {rows.pr !== null && <Detail>{`PR #${rows.pr}`}</Detail>}
      {rows.lane !== null && <Detail>{rows.lane}</Detail>}
      {rows.asks !== null && <Detail title="the question it is waiting on">{`asks: ${rows.asks}`}</Detail>}
      <SessionMeta
        facts={facts}
        mode="header"
        onOpenRun={run?.id !== undefined ? openRunAt(run.id) : runId !== null && s.held !== null ? openRunAt(runId) : null}
      />
      {/* The worktrees this session holds, each with its controls (D-8782: they moved here from the fleet list). */}
      <SessionWorktrees worktrees={facts.worktrees} project={s.project} detailsStay={() => drawn.current} />
    </div>
  );

  // On a phone, before the door is opened, the header still says at least what the CARD says (verifier round 1):
  // the card's one marker and its context fact, unless the coordination row (the programme) or the status word
  // (`waiting on you`, `with coordinator`) already does.
  const glance = cardFacts(facts);
  const liftMarker = glance.marker !== null && glance.marker.key !== 'needs-you' && glance.marker.key !== 'with-coordinator'
    ? glance.marker : null;
  const liftContext = glance.context !== null && glance.context.key !== 'programme' ? glance.context : null;
  const lifted = !wide && !open ? [
    ...(liftContext === null ? [] : [{ key: 'context', text: liftContext.text, title: liftContext.title }]),
    ...(liftMarker === null ? [] : [{
      key: liftMarker.key,
      text: liftMarker.key === 'spawn' ? `spawn: ${liftMarker.short ?? liftMarker.text}` : (liftMarker.short ?? liftMarker.text),
      title: liftMarker.title ?? liftMarker.text,
    }]),
  ] : [];
  return (
    <>
      {lifted.map((x) => (
        <span key={x.key} className="chat-fact chat-glance" data-glance={x.key} title={x.title}>{x.text}</span>
      ))}
      {!wide && shown && (
        <Door className="chat-details-toggle" glyph={open ? '▾' : '▸'}
          aria-label="Session details" aria-expanded={open} aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((v) => !v)}>
          details
        </Door>
      )}
      {shown && (wide || open) && details}
    </>
  );
}
