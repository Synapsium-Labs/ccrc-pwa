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
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Door, elapsedShort } from '@ccrc/ui';
import { navigate } from '../lib/router';
import { useMediaQuery } from '../lib/useMediaQuery';
import { SessionMeta } from '../fleet/SessionMeta';
import { cardFacts, contextFact, heldWords, type SessionFactSet } from '../fleet/sessionFacts';
import { programmeWave } from '../fleet/runWords';
import { coordinationLine, type Coordination } from '../fleet/fleetTree';

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

/** Who this session works for — whose code, its programme and wave (a link to the run board) and its
 *  coordinator with its state (a link to that session). Under the name, before the meta row. */
export function SessionCoordination({ facts, coordination }: {
  facts: SessionFactSet;
  coordination: Coordination | null;
}): ReactNode {
  const ctx = contextFact(facts);
  const run = ctx?.key === 'programme' ? (facts.heldRun ?? facts.activeRun) : null;
  const workingOn = facts.workingOn ?? coordination?.workingOn ?? null;
  const coordinatorName = facts.coordinatorName ?? coordination?.coordinator ?? null;
  const coordinatorId = coordination?.coordinatorId ?? null;
  const from = coordinatorName ?? (coordination !== null && coordination.workingOn !== null ? coordination.card : null);
  if (workingOn === null && run === null && from === null) return null;
  return (
    <div className="chat-coord" title={coordination === null ? undefined : coordinationLine(coordination).title}>
      {/* Each clause its own box, with no separator glyph between them: a wrapped line can never start
          with, or hold, a lone `·` (#633's leftover). */}
      {workingOn !== null && <span className="chat-coord-part">{`works on ${workingOn}`}</span>}
      {run !== null && (
        <CoordLink glyph="≡" label={`Open the run board — ${programmeWave(run)}`} to="/runs">
          {programmeWave(run)}
        </CoordLink>
      )}
      {from !== null && (coordinatorId !== null ? (
        <CoordLink glyph="⤴" label={`Open the coordinator — ${from}`} to={`/s/${encodeURIComponent(coordinatorId)}`}>
          {`coordinator ${from}${coordination?.coordinatorState == null ? '' : ` · ${coordination.coordinatorState}`}`}
        </CoordLink>
      ) : (
        <span className="chat-coord-part">{`coordinated from ${from}`}</span>
      ))}
    </div>
  );
}

/** Everything else, in full. Always shown from 900px; behind one "details" door on a phone. */
export function SessionDetails({ facts, coordination }: {
  facts: SessionFactSet;
  coordination: Coordination | null;
}): ReactNode {
  const wide = useMediaQuery('(min-width: 900px)');
  const [open, setOpen] = useState(false);
  const [subagentsOpen, setSubagentsOpen] = useState(false);
  const subagentsId = useId();
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
      {facts.coordinatorRole && <Detail title="this session is its project's coordinator">coordinator</Detail>}
      {s.held !== null && ctx?.key === 'programme' && <Detail title="the hold, verbatim">{heldWords(s.held)}</Detail>}
      {s.pr?.number != null && <Detail>{`PR #${s.pr.number}`}</Detail>}
      {facts.lane.away && facts.offPool === null && facts.lane.label !== undefined && <Detail>{facts.lane.label}</Detail>}
      {asking && <Detail title="the question it is waiting on">{`asks: ${s.askSummary ?? ''}`}</Detail>}
      <SessionMeta
        facts={facts}
        mode="header"
        onOpenRun={run !== null || s.held !== null ? () => navigate('/runs') : null}
        subagentsOpen={subagentsOpen}
        subagentsId={subagentsId}
        onToggleSubagents={() => setSubagentsOpen((v) => !v)}
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
