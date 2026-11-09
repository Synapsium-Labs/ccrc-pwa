// The session header's FULL SET of facts (D-5545): a superset of the fleet card.
//
// The card is a glance — name, state, one context fact, one marker, the
// cross-project chip — and everything else it used to cram onto one truncating
// line lives HERE, each fact in full: who this session works for (its
// programme and wave and its coordinator, each a link, with the coordinator's
// state), whose code it works on, the run number, the verbatim hold, the role,
// the waiting question, the task tally, the subagents (a disclosure), the last
// spawn, the graph counters, and EVERY attention marker, not just the first.
// The facts come from `sessionFacts` — the same model the card reads — so the
// header can never know less than the card.
//
// At every width every fact stays reachable: from 900px up the details row is
// always shown; on a phone it folds behind one "details" door beside the
// coordination row, so the header stays short until it is asked.
import { useCallback, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Door, Icon, elapsedShort } from '@ccrc/ui';
import { navigate } from '../lib/router';
import { runPath, sessionPath } from '../lib/routes';
import { DESK_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { SessionMeta } from '../fleet/SessionMeta';
import { WorkLine } from '../fleet/WorkLine';
import { cardFacts, contextFact, COORDINATOR_ROLE_TITLE, COORDINATOR_WORD, heldWords, type SessionFactSet } from '../fleet/sessionFacts';
import { programmeWave } from '../fleet/runWords';
import { openRunAt } from '../fleet/openers';
import { coordinationLine, type Coordination } from '../fleet/fleetTree';
import { coordinationClauses } from './sessionHeaderView';

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

/** D-7784 (review 1424 F2; review 1431 F): bring the entry list the operator just opened into view, sideways only. On
 *  a phone Refined draws the header's facts as one sideways rail, which the operator has swiped to reach the toggle; the
 *  list opens on a line of its own at the rail's start (refined.css), so without this it opens scrolled off to the left.
 *  Only the nearest ancestor that scrolls sideways (`overflow-x` auto or scroll, with something to scroll) moves, and only
 *  sideways: never a page, a pane or an `overflow: hidden` box. Where none scrolls (the shared header, the desk) nothing
 *  moves. */
const bringIntoRail = (el: HTMLElement): void => {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const x = getComputedStyle(p).overflowX;
    if ((x === 'auto' || x === 'scroll') && p.scrollWidth > p.clientWidth) {
      p.scrollLeft += el.getBoundingClientRect().left - p.getBoundingClientRect().left;
      return;
    }
  }
};

/** Everything else, in full. Always shown from 900px; behind one "details" door on a phone. */
export function SessionDetails({ facts, coordination }: {
  facts: SessionFactSet;
  coordination: Coordination | null;
}): ReactNode {
  const wide = useMediaQuery(DESK_QUERY);
  const [open, setOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const subagentsId = useId();
  const [delegatedOpen, setDelegatedOpen] = useState(false);
  // Set by the tap that opens the list and spent by the list's first mount after it, so a remount (a withdrawn frame
  // coming back while the disclosure is still open) never scrolls anything (review 1431 F).
  const openedByTap = useRef(false);
  const showEntries = useCallback((el: HTMLElement | null): void => {
    if (el === null || !openedByTap.current) return;
    openedByTap.current = false;
    bringIntoRail(el);
  }, []);
  // Derived from the subagent list's id, never a `useId` of its own: the header adds a `useState`, a `useRef` and a
  // `useCallback`, and no `useId`, so React's id counter numbers every later id as before.
  const delegatedId = `${subagentsId}-entries`;
  const detailsId = useId();
  const s = facts.session;
  const ctx = contextFact(facts);
  const run = ctx?.key === 'programme' ? (facts.heldRun ?? facts.activeRun) : null;
  const runId = coordination?.run?.id ?? null;
  const asking = !facts.dead && s.hookState === 'waiting' && s.askSummary !== null && s.askSummary !== '';
  const subagents = facts.subagents ?? [];
  const details = (
    <div className="chat-facts" id={detailsId}>
      {/* A main checkout's heading is its project; the name the card leads with is here. */}
      {s.workspace === null && s.name !== null && <Detail title="this session's name">{s.name}</Detail>}
      {runId !== null && <Detail title="the run this wave belongs to — the run board names it">{`run #${runId}`}</Detail>}
      {facts.coordinatorRole && <Detail title={COORDINATOR_ROLE_TITLE}>{COORDINATOR_WORD}</Detail>}
      {s.held !== null && ctx?.key === 'programme' && <Detail title="the hold, verbatim">{heldWords(s.held)}</Detail>}
      {s.pr?.number != null && <Detail>{`PR #${s.pr.number}`}</Detail>}
      {facts.lane.away && facts.offPool === null && facts.lane.label !== undefined && <Detail>{facts.lane.label}</Detail>}
      {asking && <Detail title="the question it is waiting on">{`asks: ${s.askSummary ?? ''}`}</Detail>}
      <SessionMeta
        facts={facts}
        mode="header"
        onOpenRun={run?.id !== undefined ? openRunAt(run.id) : runId !== null && s.held !== null ? openRunAt(runId) : null}
        subagentsOpen={subagentsOpen}
        subagentsId={subagentsId}
        onToggleSubagents={() => setSubagentsOpen((v) => !v)}
        delegatedOpen={delegatedOpen}
        delegatedId={delegatedId}
        onToggleDelegated={() => { openedByTap.current = !delegatedOpen; setDelegatedOpen(!delegatedOpen); }}
      />
      {/* The subagent disclosure's content: name and elapsed time, nothing else (the hooks hand over no more). */}
      {subagentsOpen && subagents.length > 0 && (
        <ul id={subagentsId} className="sess-subagent-list">
          {subagents.map((sa) => (
            <li key={`${sa.name}-${sa.startedAt}`} className="sess-subagent-row">
              <span className="sess-subagent-name" title={sa.name}>{sa.name}</span>
              <span className="sess-subagent-elapsed">{elapsedShort(Date.now() - sa.startedAt) ?? '<1m'}</span>
            </li>
          ))}
        </ul>
      )}
      {/* The recorded entries this session started, each in its row's words, under the description the words module
          gives (`facts.delegated.note`). Drawn only while the disclosure is open. */}
      {delegatedOpen && facts.delegated !== null && (
        <div id={delegatedId} className="sess-entries" ref={showEntries}>
          <span className="chat-fact sess-entries-note">{facts.delegated.note}</span>
          {facts.delegated.rows.map((r) => <WorkLine key={r.key} parts={r.parts} title={r.title} nameAt={r.nameAt} />)}
        </div>
      )}
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
      {!wide && (
        <Door className="chat-details-toggle" glyph={open ? '▾' : '▸'}
          aria-label="Session details" aria-expanded={open} aria-controls={open ? detailsId : undefined}
          onClick={() => setOpen((v) => !v)}>
          details
        </Door>
      )}
      {(wide || open) && details}
    </>
  );
}
