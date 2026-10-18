// Workflow strip — the dynamic workflows Claude Code is running in this session
// (D-5560), one line each, the facts its own terminal row prints:
// `○ name ▰▰▰▱ 19/20 · 3h15m · ↓ 2.5m tokens`. Collapsed, the first
// SUMMARY_LINES_MAX lines are the strip's summary and the head counts the
// rest, so the glance needs no tap and stays compact on a phone; open, the
// summary steps aside and each workflow's detail — its facts line, its
// phases and every agent's label and state — is one scroll body.
//
// Read-only. Nothing here starts, stops or changes a workflow: the only
// buttons are the head and the folds that reveal rows.
//
// EVERY UNMEASURED FACT SAYS SO. A row whose progress could not be read says
// "progress unreadable", never `0/0`; tokens no agent reported say "tokens
// unmeasured"; a floor (some agents not read yet) carries a `+`. A finished row
// stays for Claude Code's 30 s with its own last word — done, failed, stopped —
// and then the server stops sending it.
//
// No rows and nothing unreadable → nothing at all, so an ordinary session
// never pays a line for it.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '../lib/focus';
import { useNow } from '../lib/use-now';
import { CollapsibleStrip } from '../primitives/collapsible-strip';
import { Meter } from '../primitives/meter';
import type { WorkflowAgentView, WorkflowView } from '../../../shared/workflows';
import './workflow-strip.css';

/** `↓ 2.5m tokens`'s number, the way Claude Code writes it: 980, 12.4k, 2.5m. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  const [v, unit] = n < 1_000_000 ? [n / 1000, 'k'] : [n / 1_000_000, 'm'];
  const s = v >= 100 ? v.toFixed(0) : v.toFixed(1);
  return `${s.endsWith('.0') ? s.slice(0, -2) : s}${unit}`;
}

/** `3h15m`, `12m5s`, `42s`, `2d4h`. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60}m`;
  return `${Math.floor(h / 24)}d${h % 24}h`;
}

const FINAL_WORD: Record<Exclude<WorkflowView['state'], 'running'>, string> = {
  completed: 'done',
  failed: 'failed',
  killed: 'stopped',
};

/** The facts after the bar, in Claude Code's order: count · elapsed · tokens · last word. */
export function workflowFacts(w: WorkflowView, now: number): string {
  const parts: string[] = [];
  parts.push(w.done === null || w.total === null ? 'progress unreadable' : `${w.done}/${w.total}`);
  if (w.startedAt !== null) parts.push(formatElapsed((w.endedAt ?? now) - w.startedAt));
  parts.push(w.tokens === null ? 'tokens unmeasured' : `↓ ${formatTokens(w.tokens)}${w.tokensUnmeasured > 0 ? '+' : ''} tokens`);
  if (w.state !== 'running') parts.push(FINAL_WORD[w.state]);
  else if (w.failed !== null && w.failed > 0) parts.push(`${w.failed} failed`);
  return parts.join(' · ');
}

/** The head's sentence: what is running, and what just finished. */
export function workflowHeadline(workflows: readonly WorkflowView[], unreadable: boolean): string {
  if (workflows.length === 0) return unreadable ? 'Workflow state unreadable' : 'Workflows';
  const running = workflows.filter((w) => w.state === 'running').length;
  const finished = workflows.length - running;
  const noun = (n: number): string => (n === 1 ? 'workflow' : 'workflows');
  if (finished === 0) return `${running} ${noun(running)} running`;
  if (running === 0) return `${finished} ${noun(finished)} finished`;
  return `${running} running · ${finished} finished`;
}

function meterOf(w: WorkflowView): { pct: number | null; band: 'ok' | 'warn' | 'crit' } {
  const band = w.state === 'failed' || w.state === 'killed' ? 'crit' : (w.failed ?? 0) > 0 ? 'warn' : 'ok';
  if (w.done === null || w.total === null) return { pct: null, band };
  return { pct: w.total === 0 ? 0 : (w.done / w.total) * 100, band };
}

/** The collapsed strip's lines: a glance, so a few; the head counts them all
 *  and the open strip lists every one with the same facts. */
export const SUMMARY_LINES_MAX = 3;

function WorkflowLine({ w, now, item = false }: { w: WorkflowView; now: number; item?: boolean }): ReactNode {
  const { pct, band } = meterOf(w);
  return (
    <span className={`workflow-line workflow-line--${w.state}`} role={item ? 'listitem' : undefined}>
      <span className="workflow-bullet" aria-hidden="true">{w.state === 'running' ? '○' : '●'}</span>
      <span className="workflow-name">{w.name ?? 'unnamed workflow'}</span>
      <span className="workflow-bar">
        <Meter pct={pct} band={band} />
      </span>
      <span className="workflow-facts">
        {workflowFacts(w, now)}
        {/* The bullet is hidden from speech; a finished row's facts end in its
            last word, so a running one needs its own. */}
        {w.state === 'running' && <span className="sr-only"> · running</span>}
      </span>
    </span>
  );
}

const AGENT_GLYPH: Record<WorkflowAgentView['state'], string> = { running: '■', done: '✓', failed: '✗' };

/** The agents grouped by phase, in the script's phase order where it is known,
 *  else in the order the phases first appear. */
function groupByPhase(w: WorkflowView): Array<{ phase: string | null; agents: WorkflowAgentView[] }> {
  const order: Array<string | null> = [...(w.phases ?? [])];
  for (const a of w.agents) if (!order.includes(a.phase)) order.push(a.phase);
  return order.map((phase) => ({ phase, agents: w.agents.filter((a) => a.phase === phase) }));
}

function PhaseGroup({ w, phase, agents }: { w: WorkflowView; phase: string | null; agents: WorkflowAgentView[] }): ReactNode {
  const [showDone, setShowDone] = useState(false);
  const done = agents.filter((a) => a.state === 'done');
  const open = agents.filter((a) => a.state !== 'done');
  const current = w.state === 'running' && phase !== null && phase === w.phase;
  const stopped = w.state !== 'running';
  return (
    // State rides data attributes, as `Meter`'s `data-band` does: a computed
    // modifier CLASS is design-system vocabulary (`OWNED`), and these two are
    // only this strip's own styling hooks.
    <li className="workflow-phase" data-current={current ? '' : undefined}>
      <span className="workflow-phase-title">
        {phase ?? 'Agents'}
        <span className="workflow-phase-count">
          {agents.length === 0 ? (w.state === 'running' ? 'not started' : 'none ran') : `${done.length}/${agents.length}`}
          {current ? ' · now' : ''}
        </span>
      </span>
      {agents.length > 0 && (
        <ul className="workflow-agents">
          {open.map((a, i) => (
            <li key={`o${i}`} className={`workflow-agent workflow-agent--${a.state}`} data-stopped={stopped && a.state === 'running' ? '' : undefined}>
              <span className="workflow-agent-glyph" aria-hidden="true">{stopped && a.state === 'running' ? '◌' : AGENT_GLYPH[a.state]}</span>
              <span className="workflow-agent-label">{a.label ?? 'unlabelled agent'}</span>
              <span className="workflow-agent-state">{stopped && a.state === 'running' ? 'stopped' : a.state}</span>
            </li>
          ))}
          {/* One button that stays put and toggles, so focus stays on it and
              the done agents fold away again from the same place. */}
          {done.length > 0 && (
            <li key="fold" className="workflow-agent workflow-agent--fold">
              <button type="button" className={`workflow-fold ${FOCUS_RING}`} aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                {showDone ? `fold ${done.length} done` : `… +${done.length} done`}
              </button>
            </li>
          )}
          {showDone &&
            done.map((a, i) => (
              <li key={`d${i}`} className="workflow-agent workflow-agent--done">
                <span className="workflow-agent-glyph" aria-hidden="true">{AGENT_GLYPH.done}</span>
                <span className="workflow-agent-label">{a.label ?? 'unlabelled agent'}</span>
                <span className="workflow-agent-state">done</span>
              </li>
            ))}
        </ul>
      )}
    </li>
  );
}

function WorkflowDetail({ w, now }: { w: WorkflowView; now: number }): ReactNode {
  const groups = groupByPhase(w);
  return (
    <li className="workflow-detail">
      {/* The same facts line the collapsed summary shows: open, the summary
          steps aside (workflow-strip.css) and this is where every workflow's
          facts are, so the detail stays a superset of the glance. */}
      <span className="workflow-detail-line">
        <WorkflowLine w={w} now={now} />
      </span>
      {w.done === null ? (
        <p className="workflow-detail-note">Its journal could not be read this pass — no agent is listed rather than a guess.</p>
      ) : (
        <ol className="workflow-phases">
          {groups.map((g) => (
            <PhaseGroup key={g.phase ?? '\u0000'} w={w} phase={g.phase} agents={g.agents} />
          ))}
        </ol>
      )}
      {w.state === 'running' && w.phases === null && w.done !== null && (
        <p className="workflow-detail-note">Phases still to come are not readable for this run.</p>
      )}
      {w.agentsOmitted > 0 && (
        <p className="workflow-detail-note">… +{w.agentsOmitted} more agents not listed</p>
      )}
    </li>
  );
}

export function WorkflowStrip({
  workflows,
  unreadable = false,
}: {
  workflows: WorkflowView[];
  /** The server could not re-read the session's workflow state: `workflows`
   *  are the rows it last read (or none), and the strip says so. */
  unreadable?: boolean;
}): ReactNode {
  const ticking = workflows.some((w) => w.state === 'running' && w.startedAt !== null);
  // Ticks once a second while a running row has a start to count from.
  const now = useNow(1000, ticking);
  if (workflows.length === 0 && !unreadable) return null;
  // Running rows first: a finished one (gone in 30 s) never pushes a running
  // one behind the "+N more".
  const glance = [...workflows.filter((w) => w.state === 'running'), ...workflows.filter((w) => w.state !== 'running')]
    .slice(0, SUMMARY_LINES_MAX);
  return (
    <CollapsibleStrip
      root="workflow-strip"
      part="workflow"
      label="Workflows"
      // Neutral: each line's own bullet carries the running ink.
      mark="○"
      headline={workflowHeadline(workflows, unreadable)}
      summary={
        <>
          <span className="workflow-lines" role="list">
            {glance.map((w) => (
              <WorkflowLine key={w.id} w={w} now={now} item />
            ))}
          </span>
          {workflows.length > SUMMARY_LINES_MAX && (
            <span className="workflow-more">+{workflows.length - SUMMARY_LINES_MAX} more — open for all</span>
          )}
          {unreadable && workflows.length > 0 && (
            <span className="workflow-note">Could not re-read workflow state — showing the last read.</span>
          )}
        </>
      }
    >
      {workflows.length === 0 ? (
        <li className="workflow-detail">
          <p className="workflow-detail-note">This box could not read where Claude Code keeps this session&apos;s workflows.</p>
        </li>
      ) : (
        workflows.map((w) => <WorkflowDetail key={w.id} w={w} now={now} />)
      )}
    </CollapsibleStrip>
  );
}
