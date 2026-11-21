// The Helpers section's head and its two lists (session helpers H2, D-8872; spec 2026-11-19-session-helpers-design §4.1
// Table 4, §4.3 and §4.4). L1, C3: pure words over the frame the store holds, decided once here and drawn by the design
// system's `HelpersStrip` and `HelpersPanel` (`ui/src/components/workflow-strip.tsx`).
//
// THE HEAD SAYS EACH COUNT ONCE, AND EVERY "NOT KNOWN" ONCE. The rows never repeat a count, and never say a fact that was
// not measured: a row leaves it out and the head says it here, once, and only while a row it concerns is drawn. The
// workflow counts come from the rows themselves (null `tokens`, null `done`), so one fact has one carrier.
//
// ABSENCE DRAWS NOTHING, AND IT IS AMBIGUOUS (review 3014 F13). An older server's frame carries no `agents` member, and a
// current server's frame for a session with no Agent helper carries none either (Table 11: each member is present only
// when it says something). This module cannot tell the two apart and does not try: with no row and nothing unreadable it
// answers null and the section draws nothing, never a "none" or a "no helpers" that one of the two would make false.
import type { HelperItem } from '@ccrc/ui';
import { elapsedShort } from '@ccrc/ui';
import {
  AGENT_HELPER_STATE_WORDS, HELPER_REPORT_MAX_BYTES, isFinalHelperState,
  type AgentHelperView, type HelpersUnmeasured, type WorkflowView,
} from '../../../shared/workflows';

export interface HelpersWordsInput {
  readonly workflows: readonly WorkflowView[];
  readonly workflowsUnreadable: boolean;
  readonly agents: readonly AgentHelperView[];
  readonly agentsUnmeasured: HelpersUnmeasured | null;
  readonly readEvery: { readonly refreshed: number; readonly of: number } | null;
}

/** What the section draws: the head's counts and notes, and the main list and the finished fold. */
export interface HelpersWords {
  readonly count: string | null;
  readonly notes: string[];
  readonly main: HelperItem[];
  readonly finished: HelperItem[];
  readonly cutNote: string;
}

/** A cut report's note, with the cap the server cut it at (`HELPER_REPORT_MAX_BYTES`, one owner). */
const CUT_NOTE = `The report was cut at ${HELPER_REPORT_MAX_BYTES / 1024} KiB.`;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Table 4's live-state line for each reason the roster could not be used. */
function liveStateLine(u: HelpersUnmeasured): string {
  switch (u.why) {
    case 'stale': return `live state not known: no news from the session for ${elapsedShort(u.hookAgeMs) ?? 'under a minute'}`;
    case 'absent': return 'live state not known: this session reports nothing yet';
    case 'unreadable': return 'live state not known: the session\'s report could not be read';
    case 'foreign':
    case 'unregistered': return 'live state not known: the session\'s report is from an earlier run';
    case 'unseen': return `live state not known for ${plural(u.helpers, 'helper', 'helpers')}`;
  }
}

const isRunning = (it: HelperItem): boolean => (it.kind === 'agent' ? it.agent.state : it.workflow.state) === 'running';
const isFinal = (it: HelperItem): boolean => (it.kind === 'agent' ? isFinalHelperState(it.agent.state) : it.workflow.state !== 'running');
const startOf = (it: HelperItem): number => (it.kind === 'agent' ? it.agent.startedAt : it.workflow.startedAt) ?? Infinity;
const endOf = (it: HelperItem): number => (it.kind === 'agent' ? it.agent.endedAt : it.workflow.endedAt) ?? Infinity;

/**
 * The section's words, or null when there is nothing to draw (no row, and the workflow state not unreadable).
 *  - main: the running rows, oldest start first, then the other rows that claim no end (launched, state left out, no longer
 *    listed, session ended) in the order the server decided them; `no longer listed` and `session ended` never fold;
 *  - finished: every final row, Agent helper or workflow, newest end first (a row with no readable end is the newest);
 *  - count: `N running` while any row runs, else `N helpers` for the main list; then `M finished` for a non-empty fold;
 *  - notes, in Table 4's order: the live-state line (only while an Agent row's state is left out), tokens not known,
 *    progress not known (only for drawn workflows), the helper tier's rotation, and the workflow state not re-read.
 */
export function helpersView(i: HelpersWordsInput): HelpersWords | null {
  const items: HelperItem[] = [
    ...i.workflows.map((workflow): HelperItem => ({ kind: 'workflow', id: workflow.id, workflow })),
    ...i.agents.map((agent): HelperItem => ({ kind: 'agent', id: agent.id, agent, stateWord: AGENT_HELPER_STATE_WORDS[agent.state] })),
  ];
  if (items.length === 0 && !i.workflowsUnreadable) return null;
  const running = items.filter(isRunning).sort((a, b) => startOf(a) - startOf(b) || (a.id < b.id ? -1 : 1));
  const others = items.filter((it) => !isRunning(it) && !isFinal(it));
  const finished = items.filter(isFinal).sort((a, b) => endOf(b) - endOf(a) || (a.id < b.id ? -1 : 1));
  const main = [...running, ...others];

  const counts: string[] = [];
  if (running.length > 0) counts.push(`${running.length} running`);
  else if (main.length > 0) counts.push(plural(main.length, 'helper', 'helpers'));
  if (finished.length > 0) counts.push(`${finished.length} finished`);

  const notes: string[] = [];
  if (i.agentsUnmeasured !== null && i.agents.some((a) => a.state === 'unmeasured')) notes.push(liveStateLine(i.agentsUnmeasured));
  const noTokens = i.workflows.filter((w) => w.tokens === null).length;
  if (noTokens > 0) notes.push(`tokens not known for ${plural(noTokens, 'workflow', 'workflows')}`);
  const noProgress = i.workflows.filter((w) => w.done === null).length;
  if (noProgress > 0) notes.push(`progress not known for ${plural(noProgress, 'workflow', 'workflows')}`);
  if (i.readEvery !== null) {
    notes.push(`${i.readEvery.of} helpers: the busiest ${i.readEvery.refreshed} refresh every few seconds, the rest more slowly`);
  }
  if (i.workflowsUnreadable) notes.push(i.workflows.length > 0 ? 'workflow state not re-read: showing the last read' : 'workflow state could not be read');

  return { count: counts.length === 0 ? null : counts.join(' · '), notes, main, finished, cutNote: CUT_NOTE };
}
