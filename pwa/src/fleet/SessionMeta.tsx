// A session's facts as a quiet flex row of cells — in TWO modes (D-5545).
//
// `card`: the fleet row's second line, a GLANCE — the state word, ONE context
// cell and at most ONE attention marker, exactly the facts `cardFacts` chose.
// `header`: the session header's details — every other fact the session has,
// each in full, so the header is a superset of the card. Which facts exist,
// what they say and which one the card keeps is decided ONCE, by the pure model
// in `sessionFacts.ts`; this file only draws its answer.
//
// WHY IT IS ITS OWN FILE. `SessionLine` was one component with a 660-line body;
// this row was 295 of it. The derivations that came here with it (the lifecycle
// qualifier, the ask chip, the spawn chip, context pressure and its wedge
// signature — D-2011, D-2016, D-5231 —, the swap and strand markers, the
// substrate fault, both graph counters — D-1251, D-1613 —, the account hue —
// D-5455 — and the off-pool claim) moved on again in D-5545, into
// `sessionFacts.ts`, so the card and the header read ONE derivation.
//
// THE MARKERS ARE ONE CELL. Every attention marker — the substrate fault, the
// dead coordinator, `needs you`, `with coordinator` (D-5296, D-5390), the
// lifecycle qualifier, the strand, the swap refusal, the wedge, the limit, the
// context pressure, the hibernated coordinator (D-5242), the recent restart
// (D-5237), the unmeasured registry and off-pool — renders through `Marker`,
// in its old cell's class, so its ink is the rule fleet.css already grounds
// (no new colour identity) and `data-marker` names which one it is.
//
// The classes stay `sess-*`. fleet.css grounds them there and `.sess-meta >
// *:not(:first-child)::before` punctuates this row's cells from the parent
// rule — the shape moves, the ground stays.
import type { CSSProperties, ReactNode } from 'react';
import { WARN_GLYPH } from '@ccrc/ui';
import { programmeWaveTail, type ChildRunContext } from './runWords';
import { GraphChip, LastSpawnChip } from './chips';
import {
  PROGRAMME_BUDGET, cardFacts, markers, shortenByToken, type Fact, type MarkerKey, type SessionFactSet,
} from './sessionFacts';
import './fleet.css';

/** Each marker's ink: the class of the cell it used to be, so fleet.css's existing colour rule paints it. */
const MARKER_CLASS: Record<MarkerKey, string> = {
  unreachable: 'sess-substrate',
  'coordinator-gone': 'sess-warn',
  'needs-you': 'sess-state--waiting',
  'with-coordinator': 'sess-ask-state',
  lifecycle: 'sess-lifecycle',
  stranded: 'sess-stranded',
  'swap-blocked': 'sess-swapblocked',
  spawn: 'sess-spawn',
  stalled: 'sess-ctxpressure',
  limit: 'sess-warn',
  ctx: 'sess-ctxpressure',
  'coordinator-hibernated': 'sess-state--asleep',
  restarted: 'sess-restart',
  unreadable: 'sess-unmeasured',
  'off-pool': 'sess-offpool',
};

/** One attention marker. `short` on the card, the full text in the header; the full text always in `title`. */
function Marker({ fact, full, title }: { fact: Fact; full: boolean; title?: string }): ReactNode {
  const key = fact.key as MarkerKey;
  const tip = title ?? fact.title ?? fact.text;
  return (
    <span
      className={`sess-marker ${MARKER_CLASS[key]}`}
      data-marker={key}
      {...(key === 'stalled' ? { 'data-wedge': true } : {})}
      title={tip}
    >
      {key === 'limit' && <span aria-hidden="true">{WARN_GLYPH} </span>}
      {full ? fact.text : (fact.short ?? fact.text)}
    </span>
  );
}

export interface SessionMetaProps {
  /** The session's facts, decided once by `sessionFacts` (D-5545). */
  facts: SessionFactSet;
  /** `card` draws the glance; `header` draws everything else, in full. */
  mode: 'card' | 'header';
  /** Where a tap on the hold opens the run board, or `null` for nowhere (Task 5). */
  onOpenRun: (() => void) | null;
  /** The subagent disclosure's state (header mode; the list renders beside the row). */
  subagentsOpen?: boolean;
  subagentsId?: string;
  onToggleSubagents?: () => void;
  /** The orphan marker's guidance — the run board reclaims a dead coordinator's programme. */
  markerTitle?: string;
}

export function SessionMeta({
  facts: f, mode, onOpenRun, subagentsOpen = false, subagentsId, onToggleSubagents, markerTitle,
}: SessionMetaProps): ReactNode {
  const card = mode === 'card';
  const session = f.session;
  const glance = cardFacts(f);
  const ctx = glance.context;
  const labelRun = f.heldRun ?? (f.childOf?.data === 'child' ? f.activeRun : null);
  const metaStyle = labelRun === null ? undefined
    : ({ '--pw-wave': `${programmeWaveTail(labelRun).length}ch` } as CSSProperties);

  // THE HOLD — two forms of one cell (Task 5): a real `<button>` when the caller has a run board to open, so
  // `.sess-body`'s click forwarder stands down on `closest('button')`, else an inert span. THE REASON STRING IS
  // DISPLAY-ONLY (`rundefs.ts`'s `holdReason`, `run-routes.test.ts`'s scan): the run is never read out of it —
  // the caller answers "is there a run to open" from the run rows. The card shows the hold's programme and wave
  // (shortened by token) or the word `held`; the header shows the programme and wave in full, and the verbatim
  // reason in `title` and in the details (`SessionDetails`).
  const heldBody = f.heldRun !== null ? <ProgrammeWave run={f.heldRun} short={card} />
    : card ? 'held' : session.held;
  const heldText = f.heldRun !== null ? (glance.context?.text ?? '') : (session.held ?? '');
  const held = session.held === null ? null : onOpenRun === null ? (
    <span className="sess-held" data-held="true" title={f.heldTitle ?? undefined}>
      {heldBody}
    </span>
  ) : (
    <button
      type="button"
      className="sess-held"
      data-held="true"
      data-open="true"
      title={f.heldTitle ?? undefined}
      aria-label={`Open the run board — ${heldText}`}
      onClick={onOpenRun}
    >
      {heldBody}
    </button>
  );

  // The child label (wave 5; worded by the operator's ruling of 2026-10-18): its programme and wave, or "run not
  // on the board", or "child marker unreadable" — a short, fixed fact; the full sentence lives in `title`.
  const childCell = f.childOf !== null && f.heldRun === null ? (
    <span className="sess-child" data-child={f.childOf.data} title={f.childOf.title}>
      {f.childOf.data === 'child' && f.activeRun !== null ? <ProgrammeWave run={f.activeRun} short={card} /> : f.childOf.text}
    </span>
  ) : null;

  if (card) {
    const context = ctx === null ? null
      : ctx.key === 'programme' || ctx.key === 'hold' ? (held ?? childCell)
      : ctx.key === 'child-marker' ? childCell
      : <ContextCell fact={ctx} />;
    // TWO lines, never one squeezed line: the state word and its one marker, then the context fact on a line
    // of its own. Measured at 360: the text column is 226px, ~34 characters — `working · terminal-drawer… ·
    // wave 3 of 5 · coordinator gone` cut three cells to an ellipsis on one line, and fits on two.
    return (
      <>
        <span className="sess-meta">
          <span className={`sess-state sess-state--${f.stateTone}`} title={glance.status.title}>{glance.status.text}</span>
          {glance.marker !== null && glance.marker.key === 'spawn' && <LastSpawnChip chip={f.spawn} />}
          {glance.marker !== null && glance.marker.key !== 'spawn' && (
            <Marker fact={glance.marker} full={false}
              {...(glance.marker.key === 'coordinator-gone' && markerTitle !== undefined ? { title: markerTitle } : {})} />
          )}
        </span>
        {context !== null && <span className="sess-meta sess-meta--context" style={metaStyle}>{context}</span>}
      </>
    );
  }

  const subagentList = f.subagents;
  return (
    <span className="sess-meta" style={metaStyle}>
      {/* The programme and wave are the coordination row's link in the header (`SessionCoordination`), so here
          the hold cell renders only for a hold no run explains, and the child cell only for its hedge. */}
      {ctx?.key === 'programme' ? null : held}
      {ctx?.key === 'child-marker' ? childCell : null}
      {/* The last spawn's verdict (spawnWords.ts). */}
      <LastSpawnChip chip={f.spawn} />
      {/* Task 19: the ask pre-emption lane's chip (design doc §2.8). Informational only. */}
      {f.askState !== null && (
        <span className="sess-ask-state" data-ask-state={f.askState.state} title={f.askState.title}>
          {f.askState.label}
        </span>
      )}
      {/* The cleanup bucket's merge facts: a merged PR's number and its reclaimable size, as two cells. */}
      {f.cleanup.map((fact, i) => (
        <span key={`${session.id}-cleanup-${i}`} className="sess-cleanup-fact">{fact}</span>
      ))}
      {f.tasks !== null && (
        <span className="sess-tally" title="tasks done of total">
          {f.tasks.done}/{f.tasks.total} tasks
        </span>
      )}
      {/* The read counter (R4) with the gate's suffix (R5, D-1613) — a measured zero is a finding. */}
      {f.graph !== null && <GraphChip reads={f.graph.reads} gated={f.graph.gated} />}
      {/* The subagent tally, a disclosure: a REAL `<button>`; `aria-controls` only while the list exists. */}
      {subagentList !== null && subagentList.length > 0 && (
        <button
          type="button"
          className="sess-subagents"
          aria-expanded={subagentsOpen}
          aria-controls={subagentsOpen ? subagentsId : undefined}
          aria-label={`${subagentList.length} subagent${subagentList.length === 1 ? '' : 's'}`}
          onClick={onToggleSubagents}
        >
          ⑂ {subagentList.length} subagent{subagentList.length === 1 ? '' : 's'}
        </button>
      )}
      {/* Every marker, in full — but the last spawn and the restart, which the header already draws (the spawn chip
          above, the header's own restart chip). */}
      {markers(f).filter((m) => m.key !== 'spawn' && m.key !== 'restarted').map((m) => (
        <Marker key={m.key} fact={m} full
          {...(m.key === 'coordinator-gone' && markerTitle !== undefined ? { title: markerTitle } : {})} />
      ))}
    </span>
  );
}

/** A plain context cell — a PR or a branch: its short form on the card, the full text in `title`. */
function ContextCell({ fact }: { fact: Fact }): ReactNode {
  return <span className="sess-context" data-context={fact.key} title={fact.title ?? fact.text}>{fact.short ?? fact.text}</span>;
}

/** `<programme> · wave 5 of 7` as two spans: the wave never shortens (D-5528), and on the card the programme
 *  slug is shortened by whole tokens (`shortenByToken`, D-5545) rather than cut by an ellipsis. The full text is
 *  `programmeWave`'s, character for character. */
function ProgrammeWave({ run, short }: { run: NonNullable<ChildRunContext['run']>; short: boolean }): ReactNode {
  return (
    <span className="sess-pw">
      <span className="sess-pw-prog">{short ? shortenByToken(run.program, PROGRAMME_BUDGET) : run.program}</span>
      <span className="sess-pw-wave">{programmeWaveTail(run)}</span>
    </span>
  );
}
