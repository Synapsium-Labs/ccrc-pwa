// The session page's workflow rows (D-5560), as the `workflows` frame carries
// them. One row per dynamic workflow Claude Code is running in the session —
// the same facts its own terminal row prints, `○ name ▰▰▰▱ 19/20 · 3h15m ·
// ↓ 2.5m tokens` — read from the files Claude Code itself keeps
// (`server/src/workflows/`, D-5561). L0: imports nothing.
//
// EVERY NUMBER HAS ONE NULL, AND IT MEANS "NOT MEASURED". A count that could
// not be read is never a zero: a journal this box failed to read has no
// `done` and no `total`, and the row says so instead of drawing `0/0`.

/** Where a row stands. `running` is decided by the read rule in
 *  `server/src/workflows/model.ts` (`decideRun`), never by a recency timeout;
 *  the three final words are Claude Code's own summary `status`. */
export type WorkflowState = 'running' | 'completed' | 'failed' | 'killed';

/** An agent's state, from its key's LAST journal line: `started` → running,
 *  `result` → done, `failed` → failed. */
export type WorkflowAgentState = 'running' | 'done' | 'failed';

export interface WorkflowAgentView {
  /** The label the script gave the agent; null when neither the journal line
   *  nor the agent's meta file carried one (builds before 2.1.265, unread). */
  label: string | null;
  /** The agent's phase title; null for a script that declares no phases. */
  phase: string | null;
  state: WorkflowAgentState;
}

export interface WorkflowView {
  /** Claude Code's run id (`wf_…`). Stable for the run's life, resumes included. */
  id: string;
  /** The script's `meta.name`; null when no source named it yet. */
  name: string | null;
  state: WorkflowState;
  /** Agents whose last journal line is a result. Null: the journal was not read. */
  done: number | null;
  /** Agents whose last journal line is a failure. Null exactly when `done` is. */
  failed: number | null;
  /** Agents scheduled so far (distinct journal keys) — the denominator grows as
   *  the script schedules, as Claude Code's own does. Null exactly when `done` is. */
  total: number | null;
  /** The phase of the newest running agent (else of the newest agent). */
  phase: string | null;
  /** Every phase the script declares, in order; null when unreadable (no
   *  script file — a `scriptPath` launch — or a script this reader cannot parse). */
  phases: string[] | null;
  /** When the run (or its latest resume) started, epoch ms; null unmeasured. */
  startedAt: number | null;
  /** When it reached its final state, epoch ms; null while running. */
  endedAt: number | null;
  /** Σ over agents of each one's current context (the input side of its
   *  latest API call) — what Claude Code's `↓ N tokens` sums. Null when no
   *  agent's usage was measured. */
  tokens: number | null;
  /** Agents whose usage has not been read (yet), so `tokens` is a floor. */
  tokensUnmeasured: number;
  /** Per agent, newest-scheduled last, running and failed kept first when the
   *  list is cut at `WORKFLOW_AGENTS_MAX`. */
  agents: WorkflowAgentView[];
  /** Agents left out of `agents` by that cut — said, never silently dropped. */
  agentsOmitted: number;
}

/** A finished row stays this long after its end, then drops off — Claude Code
 *  2.1.302's own `evictAfter = endTime + 30000`. */
export const WORKFLOW_EVICT_MS = 30_000;

/** The most agents one row carries on the wire; a run measured up to 629. */
export const WORKFLOW_AGENTS_MAX = 120;
