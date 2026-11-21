// The Helpers section (session helpers H2, D-8872; spec 2026-11-19-session-helpers-design §4 and §10): the session's
// subagents and dynamic workflows, one row each, with what each is doing, its kind, model and effort, its measured
// state, how long it has run and when it last wrote; a finished one kept ten minutes, folded, opening to its report.
// It replaces the workflow strip of D-5560 in place: a workflow row still carries Claude Code's own facts — name, bar,
// `7/12 agents`, `↓ 2.5m tokens` — and opens to its phases and agents.
//
// WHAT IS DECIDED ELSEWHERE. Which rows exist and their states are the server's (`server/src/workflows/model.ts`); the
// head's counts and its "not known" sentences, and which rows are in the main list and which in the fold, are the PWA's
// words module (`pwa/src/session/helpersWords.ts`), handed in as `HelpersView`. This file draws them and formats each
// row's own facts.
//
// EVERY FACT IS MEASURED OR LEFT OUT (§4.4). A row never says "not confirmed" or "unmeasured": a fact that is not known
// is left out of the row and said once in the head. A state left out draws a neutral glyph, never the running one
// (review 2900 F16). `no longer listed` and `session ended` claim no end and stay in the main list.
//
// Read-only. The only buttons are the head, the fold, a row that opens (a workflow's phases, a finished helper's report)
// and the report's Show all and Copy. Each is at least `--tap-min` high (review 2900 F18).
import { Fragment, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '../lib/focus';
import { elapsedShort } from '../lib/elapsed';
import { useNow } from '../lib/use-now';
import { CollapsibleStrip } from '../primitives/collapsible-strip';
import { Meter } from '../primitives/meter';
import type { AgentHelperState, AgentHelperView, WorkflowAgentView, WorkflowView } from '../../../shared/workflows';
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

/** One row of the section: an Agent helper, with its state's word as `helpersWords.ts` decided it, or a workflow. The
 *  words travel as data because this package takes types only from shared/ (`ui-package-boundary.test.ts`); a null word
 *  is a state whose word is left out. */
export type HelperItem =
  | { readonly kind: 'agent'; readonly id: string; readonly agent: AgentHelperView; readonly stateWord: string | null }
  | { readonly kind: 'workflow'; readonly id: string; readonly workflow: WorkflowView };

/** What `helpersWords.ts` decided for the section: the head's counts and its notes, said once, and the two lists. */
export interface HelpersView {
  readonly count: string | null;
  readonly notes: readonly string[];
  readonly main: readonly HelperItem[];
  readonly finished: readonly HelperItem[];
  /** What a cut report says under its text, with the cap in it. */
  readonly cutNote: string;
  /** The finished fold's label, with the keep's minutes in it; the strip adds the count. */
  readonly foldLabel: string;
}

/** The server's answer to one report request, as the store keeps it; absent while none came. */
export interface HelperReportView { readonly report: string | null; readonly cut: boolean }

/** How long ago a helper last wrote before the row says `quiet` instead of `active … ago` (spec Table 5). */
export const HELPER_QUIET_MS = 600_000;

/** The glyph each state draws, and its tone (review 2900 F16): only `running` draws the running glyph, in the busy tone; a
 *  state that claims no running and no end — launched, no longer listed, session ended, left out — is neutral. */
const AGENT_GLYPH: Record<AgentHelperState, { glyph: string; tone: Tone }> = {
  running: { glyph: '◆', tone: 'busy' },
  launched: { glyph: '◇', tone: 'neutral' },
  unlisted: { glyph: '◇', tone: 'neutral' },
  gone: { glyph: '◇', tone: 'neutral' },
  unmeasured: { glyph: '◇', tone: 'neutral' },
  done: { glyph: '✓', tone: 'done' },
  failed: { glyph: '✗', tone: 'dead' },
  stopped: { glyph: '■', tone: 'neutral' },
  finished: { glyph: '✓', tone: 'neutral' },
};
type Tone = 'busy' | 'done' | 'dead' | 'neutral';
/** A state outside the vocabulary (a newer server's, review 3072 F3) draws the neutral glyph: it claims no running and no
 *  end, and the row never throws for it. */
const UNKNOWN_GLYPH: { glyph: string; tone: Tone } = { glyph: '◇', tone: 'neutral' };
const WORKFLOW_GLYPH: Record<WorkflowView['state'], { glyph: string; tone: Tone }> = {
  running: { glyph: '▣', tone: 'busy' },
  completed: { glyph: '✓', tone: 'done' },
  failed: { glyph: '✗', tone: 'dead' },
  killed: { glyph: '■', tone: 'neutral' },
};
const glyphOf = (it: HelperItem): { glyph: string; tone: Tone } =>
  (it.kind === 'agent' ? AGENT_GLYPH[it.agent.state] : WORKFLOW_GLYPH[it.workflow.state]) ?? UNKNOWN_GLYPH;

const FINAL_WORD: Record<Exclude<WorkflowView['state'], 'running'>, string> = { completed: 'done', failed: 'failed', killed: 'stopped' };

/** `active 20s ago`, `active 3m ago`; past `HELPER_QUIET_MS`, `quiet 14m` (a fact, said in the muted ink, with no state change). */
export function activityWords(lastActivityAt: number | null | undefined, now: number): { text: string; quiet: boolean } | null {
  if (lastActivityAt === null || lastActivityAt === undefined) return null;
  const ms = Math.max(0, now - lastActivityAt);
  if (ms >= HELPER_QUIET_MS) return { text: `quiet ${elapsedShort(ms) ?? '10m'}`, quiet: true };
  const s = Math.floor(ms / 1000);
  return { text: `active ${s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`} ago`, quiet: false };
}

const duration = (from: number | null, to: number | null): string | null =>
  from === null || to === null ? null : formatElapsed(to - from);
const present = (xs: ReadonlyArray<string | null | false>): string[] => xs.filter((x): x is string => typeof x === 'string' && x !== '');

/** Line 1: what it is doing. */
const whatOf = (it: HelperItem): string =>
  it.kind === 'agent' ? it.agent.description ?? it.agent.agentType ?? 'subagent' : it.workflow.name ?? 'unnamed workflow';

/** Line 2's facts of a row in the main list (Table 5), each measured or left out, before its state and times; an Agent
 *  helper's state word is said with its times (`Line2`). */
export function mainFacts(it: HelperItem): string[] {
  if (it.kind === 'agent') {
    const a = it.agent;
    return present([a.agentType === null ? 'subagent' : `subagent · ${a.agentType}`, a.model, a.effort]);
  }
  return ['workflow'];
}

/** A row's state group before its times: an Agent helper's state word, and a workflow's `running` with its phase, progress
 *  and failures, so the state stays with its times (review 3099 F3). */
const mainState = (it: HelperItem): string[] => {
  if (it.kind === 'agent') return present([it.stateWord]);
  const w = it.workflow;
  return present([
    'running', w.phase !== null && `phase ${w.phase}`,
    w.done !== null && w.total !== null && `${w.done}/${w.total} agents`, (w.failed ?? 0) > 0 && `${w.failed} failed`,
  ]);
};

/** A finished row's one line (Table 6): its outcome with its duration as one group (a workflow's agents between them), then
 *  for an Agent helper the notification's summary (prose, which may wrap). */
export function finishedFacts(it: HelperItem): { state: string[]; facts: string[]; prose: string | null } {
  if (it.kind === 'agent') {
    const a = it.agent;
    return { state: present([it.stateWord, duration(a.startedAt, a.endedAt)]), facts: [], prose: a.summary };
  }
  const w = it.workflow;
  const word = w.state === 'running' ? 'running' : FINAL_WORD[w.state];
  return { state: present([word, w.done !== null && w.total !== null && `${w.done}/${w.total} agents`, duration(w.startedAt, w.endedAt)]), facts: [], prose: null };
}

function tokensOf(it: HelperItem): string | null {
  if (it.kind === 'agent') return it.agent.tokens === null ? null : `↓ ${formatTokens(it.agent.tokens)}`;
  const w = it.workflow;
  return w.tokens === null ? null : `↓ ${formatTokens(w.tokens)}${w.tokensUnmeasured > 0 ? '+' : ''} tokens`;
}

function meterOf(w: WorkflowView): { pct: number | null; band: 'ok' | 'warn' | 'crit' } {
  const band = w.state === 'failed' || w.state === 'killed' ? 'crit' : (w.failed ?? 0) > 0 ? 'warn' : 'ok';
  if (w.done === null || w.total === null) return { pct: null, band };
  return { pct: w.total === 0 ? 0 : (w.done / w.total) * 100, band };
}

function Glyph({ it }: { it: HelperItem }): ReactNode {
  const g = glyphOf(it);
  return <span className="helper-glyph" data-tone={g.tone} aria-hidden="true">{g.glyph}</span>;
}

const SEP = ' · ';
/** Inside the state group a no-break space goes before each `·`, so a separator ends a line and never starts one (F2). */
const GSEP = '\u00A0· ';
/** The state with its times: one line-2 group (`.helper-fact`) that the cases find as `.helper-state`. */
const STATE_GROUP = 'helper-fact helper-state';

/** Line 2 (spec §10, review 3072 F7): each fact one group, then the state with its times as one more (the state word, the
 *  elapsed time, which only the phone layout draws here, and the activity, muted when quiet), then a prose fact that may
 *  wrap, then the tokens, which the phone layout leaves out. The ` · ` separators are the break points: a group moves to
 *  the next line whole, and only a group wider than a whole line (the state with its times in the rail) breaks, between
 *  its words. A separator that leads a part the width can hide is inside that part, so nothing dangles at either width. */
function Line2({ facts, state, elapsed, activity, prose, tokens }: {
  facts: string[]; state: string[]; elapsed: string | null;
  activity: { text: string; quiet: boolean } | null; prose: string | null; tokens: string | null;
}): ReactNode {
  const out: ReactNode[] = facts.map((f, i) => <Fragment key={`f${i}`}>{i > 0 ? SEP : ''}<span className="helper-fact">{f}</span></Fragment>);
  const lead = facts.length > 0 ? SEP : '';
  const steady = state.length > 0 || activity !== null; // the group has a part every width draws
  if (steady) {
    const inner: ReactNode[] = state.map((w, i) => <Fragment key={`s${i}`}>{i > 0 ? GSEP : ''}<span className="helper-word">{w}</span></Fragment>);
    if (elapsed !== null) {
      inner.push(
        <span key="e" className="helper-elapsed-inline">
          {state.length > 0 ? GSEP : ''}<span className="helper-word">{elapsed}</span>{state.length === 0 ? GSEP : ''}
        </span>,
      );
    }
    if (activity !== null) {
      inner.push(
        <Fragment key="a">
          {state.length > 0 ? GSEP : ''}
          <span className="helper-word helper-activity" data-quiet={activity.quiet ? '' : undefined}>{activity.text}</span>
        </Fragment>,
      );
    }
    out.push(<Fragment key="g">{lead}<span className={STATE_GROUP}>{inner}</span></Fragment>);
  } else if (elapsed !== null) {
    out.push(<span key="g" className="helper-elapsed-inline">{lead}<span className={STATE_GROUP}>{elapsed}</span></span>);
  }
  const before = facts.length > 0 || steady;
  if (prose !== null && prose !== '') out.push(<Fragment key="p">{before ? SEP : ''}<span className="helper-prose">{prose}</span></Fragment>);
  if (tokens !== null) out.push(<span key="t" className="helper-tokens">{before || (prose !== null && prose !== '') ? SEP : ''}{tokens}</span>);
  return <span className="helper-facts">{out}</span>;
}

const AGENT_STATE_GLYPH: Record<WorkflowAgentView['state'], string> = { running: '■', done: '✓', failed: '✗' };
const agentStateGlyph = (state: WorkflowAgentView['state']): string => AGENT_STATE_GLYPH[state] ?? '◇'; // F3: an unknown state

/** One phase of a workflow's detail: its agents, the done ones folded behind one button that stays put (D-5560). */
function PhaseGroup({ w, phase, agents }: { w: WorkflowView; phase: string | null; agents: WorkflowAgentView[] }): ReactNode {
  const [showDone, setShowDone] = useState(false);
  const done = agents.filter((a) => a.state === 'done');
  const open = agents.filter((a) => a.state !== 'done');
  const current = w.state === 'running' && phase !== null && phase === w.phase;
  const stopped = w.state !== 'running';
  const agentRow = (a: WorkflowAgentView, key: string): ReactNode => {
    const cut = stopped && a.state === 'running';
    return (
      <li key={key} className="helper-phase-agent" data-state={cut ? 'stopped' : a.state}>
        <span className="helper-phase-agent-glyph" aria-hidden="true">{cut ? '◌' : agentStateGlyph(a.state)}</span>
        <span className="helper-phase-agent-label">{a.label ?? 'unlabelled agent'}</span>
        <span className="helper-phase-agent-state">{cut ? 'stopped' : a.state}</span>
      </li>
    );
  };
  return (
    <li className="helper-phase" data-current={current ? '' : undefined}>
      <span className="helper-phase-title">
        {phase ?? 'Agents'}
        <span className="helper-phase-count">
          {agents.length === 0 ? (w.state === 'running' ? 'not started' : 'none ran') : `${done.length}/${agents.length}`}{current ? ' · now' : ''}
        </span>
      </span>
      {agents.length > 0 && (
        <ul className="helper-phase-agents">
          {open.map((a, i) => agentRow(a, `o${i}`))}
          {done.length > 0 && (
            <li key="fold" className="helper-phase-agent">
              <button type="button" className={`helper-phase-fold ${FOCUS_RING}`} aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                {showDone ? `fold ${done.length} done` : `… +${done.length} done`}
              </button>
            </li>
          )}
          {showDone && done.map((a, i) => agentRow(a, `d${i}`))}
        </ul>
      )}
    </li>
  );
}

/** A workflow's phases and agents (D-5560's detail), in the script's phase order where it is known. */
function WorkflowDetail({ w }: { w: WorkflowView }): ReactNode {
  const order: Array<string | null> = [...(w.phases ?? [])];
  for (const a of w.agents) if (!order.includes(a.phase)) order.push(a.phase);
  if (w.done === null) return <p className="helper-note">Its journal could not be read this pass, so no agent is listed.</p>;
  return (
    <>
      <ol className="helper-phases">
        {order.map((phase) => <PhaseGroup key={phase ?? '\u0000'} w={w} phase={phase} agents={w.agents.filter((a) => a.phase === phase)} />)}
      </ol>
      {w.state === 'running' && w.phases === null && <p className="helper-note">Phases still to come are not readable for this run.</p>}
      {w.agentsOmitted > 0 && <p className="helper-note">… +{w.agentsOmitted} more agents not listed</p>}
    </>
  );
}

/** The report a finished helper opens to (§4.3): its first `REPORT_LINES` lines, then Show all and Copy. */
const REPORT_LINES = 4;
function Report({ answer, cutNote }: { answer: HelperReportView | undefined; cutNote: string }): ReactNode {
  const [all, setAll] = useState(false);
  if (answer === undefined) return <div className="helper-report" />; // asked, and no answer yet (an older server never gives one)
  if (answer.report === null) return <div className="helper-report"><p className="helper-note">This report is no longer held: its row left the keep.</p></div>;
  const lines = answer.report.replace(/\n$/, '').split('\n'); // a closing newline ends the last line, it starts none (F13)
  const text = all ? answer.report : lines.slice(0, REPORT_LINES).join('\n');
  const copy = (): void => { void navigator.clipboard?.writeText(answer.report ?? '').catch(() => undefined); };
  return (
    <div className="helper-report">
      <pre className="helper-report-text">{text}</pre>
      <span className="helper-report-links">
        {!all && lines.length > REPORT_LINES && (
          <>
            <button type="button" className={`helper-report-link ${FOCUS_RING}`} onClick={() => setAll(true)}>{`Show all (${lines.length} lines)`}</button>
            <span className="helper-report-sep" aria-hidden="true">{SEP}</span>
          </>
        )}
        <button type="button" className={`helper-report-link ${FOCUS_RING}`} onClick={copy}>Copy</button>
      </span>
      {answer.cut && <p className="helper-note">{cutNote}</p>}
    </div>
  );
}

function HelperRow({ it, now, finished, cutNote, reports, onReport }: {
  it: HelperItem; now: number; finished: boolean; cutNote: string;
  reports: Readonly<Record<string, HelperReportView>>; onReport: (id: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const hasReport = finished && it.kind === 'agent' && it.agent.hasReport;
  const opens = hasReport || it.kind === 'workflow';
  const answer = reports[it.id];
  const agent = it.kind === 'agent' ? it.agent : null;
  // Open with no answer: ask. The store sends once per id and end on a stream and forgets an ask that could not be
  // answered yet, so this re-runs on each frame (a new `agent`) and asks again only when the store has forgotten
  // (review 3072 F2 and F4).
  useEffect(() => {
    if (open && hasReport && answer === undefined) onReport(it.id);
  }, [open, hasReport, answer, agent, it.id, onReport]);
  const w = it.kind === 'workflow' ? it.workflow : null;
  const start = it.kind === 'agent' ? it.agent.startedAt : it.workflow.startedAt;
  const elapsed = !finished && start !== null ? formatElapsed(now - start) : null;
  const tokens = finished ? null : tokensOf(it);
  const what = <span className="helper-what">{whatOf(it)}</span>;
  return (
    <li className="helper-row" data-helper-row={it.id} data-state={it.kind === 'agent' ? it.agent.state : it.workflow.state}>
      <Glyph it={it} />
      {opens ? (
        <button type="button" className={`helper-open ${FOCUS_RING}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{what}</button>
      ) : what}
      {elapsed !== null && <span className="helper-elapsed">{elapsed}</span>}
      {w !== null && w.state === 'running' && (
        <span className="helper-bar"><Meter {...meterOf(w)} /></span>
      )}
      <span className="helper-line2">
        {finished
          ? <Line2 {...finishedFacts(it)} elapsed={null} activity={null} tokens={null} />
          : (
            <Line2
              facts={mainFacts(it)} state={mainState(it)} elapsed={elapsed} prose={null} tokens={tokens}
              activity={activityWords(it.kind === 'agent' ? it.agent.lastActivityAt : it.workflow.lastActivityAt, now)}
            />
          )}
      </span>
      {open && w !== null && <div className="helper-detail"><WorkflowDetail w={w} /></div>}
      {open && hasReport && <Report answer={reports[it.id]} cutNote={cutNote} />}
    </li>
  );
}

/** The main list and the finished fold, as list items of the caller's `<ol>`: the strip's rows and the rail's list. */
export function HelpersList({ view, reports, onReport }: {
  view: HelpersView;
  reports: Readonly<Record<string, HelperReportView>>;
  onReport: (id: string) => void;
}): ReactNode {
  const [foldOpen, setFoldOpen] = useState(false);
  const ticking = view.main.length > 0;
  const now = useNow(1000, ticking);
  return (
    <>
      {view.main.length > 0 && (
        <li className="helpers-main-item">
          <ol className="helpers-main">
            {view.main.map((it) => <HelperRow key={`${it.kind}:${it.id}`} it={it} now={now} finished={false} cutNote={view.cutNote} reports={reports} onReport={onReport} />)}
          </ol>
        </li>
      )}
      {view.finished.length > 0 && (
        <li className="helpers-fold">
          <button type="button" className={`helpers-fold-toggle ${FOCUS_RING}`} aria-expanded={foldOpen} onClick={() => setFoldOpen((o) => !o)}>
            <span aria-hidden="true">{foldOpen ? '▾' : '▸'}</span> {`${view.foldLabel} (${view.finished.length})`}
          </button>
          {foldOpen && (
            <ol className="helpers-finished">
              {view.finished.map((it) => <HelperRow key={`${it.kind}:${it.id}`} it={it} now={now} finished cutNote={view.cutNote} reports={reports} onReport={onReport} />)}
            </ol>
          )}
        </li>
      )}
    </>
  );
}

/** The head's words: the title, the counts, then each "not known" line once. */
function Headline({ view }: { view: HelpersView }): ReactNode {
  return (
    <>
      <span className="helpers-title">Helpers</span>
      {view.count !== null && <span className="helpers-count">{` · ${view.count}`}</span>}
      {view.notes.map((n) => <span key={n} className="helpers-note">{` · ${n}`}</span>)}
    </>
  );
}

/** The collapsed glance (§10): line 1 of the first `GLANCE_MAX` running rows, each with its state word kept visible. */
export const GLANCE_MAX = 2;

/** The section under the transcript: collapsed to its head and a glance, open to its rows and the finished fold. */
export function HelpersStrip({ view, reports, onReport }: {
  view: HelpersView;
  reports: Readonly<Record<string, HelperReportView>>;
  onReport: (id: string) => void;
}): ReactNode {
  const running = view.main.filter((it) => (it.kind === 'agent' ? it.agent.state : it.workflow.state) === 'running').slice(0, GLANCE_MAX);
  return (
    <CollapsibleStrip
      root="helpers-strip"
      part="helpers"
      label="Helpers"
      mark={null}
      headline={<Headline view={view} />}
      summary={running.length === 0 ? undefined : (
        <span className="helpers-glance" role="list">
          {running.map((it) => (
            <span key={`${it.kind}:${it.id}`} className="helper-glance" role="listitem" data-helper-glance="">
              <Glyph it={it} />
              <span className="helper-glance-what">{whatOf(it)}</span>
              <span className="helper-glance-state">running</span>
            </span>
          ))}
        </span>
      )}
    >
      <HelpersList view={view} reports={reports} onReport={onReport} />
    </CollapsibleStrip>
  );
}

/** The same section in a column of its own (the inspector rail at 1600 px and up): always open, no head of its own (the
 *  rail's section heading is the title), the counts and notes as one line. */
export function HelpersPanel({ view, reports, onReport }: {
  view: HelpersView;
  reports: Readonly<Record<string, HelperReportView>>;
  onReport: (id: string) => void;
}): ReactNode {
  return (
    <div className="helpers-strip helpers-strip--panel">
      {(view.count !== null || view.notes.length > 0) && (
        <p className="helpers-panel-head">{[view.count, ...view.notes].filter((x) => x !== null).join(' · ')}</p>
      )}
      <ol className="helpers-rows">
        <HelpersList view={view} reports={reports} onReport={onReport} />
      </ol>
    </div>
  );
}
