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

/** D-6048 (ARCH-12): the runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom). */
const WORKFLOW_STATE_MAP: Record<WorkflowState, true> = { running: true, completed: true, failed: true, killed: true };
export const WORKFLOW_STATES: readonly WorkflowState[] = Object.keys(WORKFLOW_STATE_MAP) as WorkflowState[];

/** An agent's state, from its key's LAST journal line: `started` → running,
 *  `result` → done, `failed` → failed. */
export type WorkflowAgentState = 'running' | 'done' | 'failed';

/** D-6048 (ARCH-12): the runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom). */
const WORKFLOW_AGENT_STATE_MAP: Record<WorkflowAgentState, true> = { running: true, done: true, failed: true };
export const WORKFLOW_AGENT_STATES: readonly WorkflowAgentState[] =
  Object.keys(WORKFLOW_AGENT_STATE_MAP) as WorkflowAgentState[];

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

/** The workflow controls a run may offer (D-5935, #641), and only these three.
 *  Which of them a Claude Code version has, and how each is driven, is the
 *  server's measured table (`server/src/workflows/controls.ts`), never this
 *  bundle's: `shared/` ships in the PWA, so the table does not live here. */
export type WorkflowControlAct = 'stop-run' | 'stop-agent' | 'skip-agent';

/** D-6048 (ARCH-12): the runtime list, derived from the type (`SESSION_ROLE_MAP`'s idiom). */
const WORKFLOW_CONTROL_ACT_MAP: Record<WorkflowControlAct, true> = {
  'stop-run': true, 'stop-agent': true, 'skip-agent': true,
};
export const WORKFLOW_CONTROL_ACTS: readonly WorkflowControlAct[] =
  Object.keys(WORKFLOW_CONTROL_ACT_MAP) as WorkflowControlAct[];

// ---------------------------------------------------------------------------
// Session helpers (desktop polish C49, H1a, D-8829): the Agent arm of the same
// frame. An Agent helper's state is DECIDED in `server/src/workflows/model.ts`
// (`decideAgentHelpers`, spec 2026-11-19-session-helpers-design §3.2, Figure 2)
// from measured facts only; these are the types and bounds that decision and
// the wire share. Wire types live HERE, not in `shared/api.ts`, which is near
// its growth cap. Nothing is ever inferred to be running, and dropping off the
// hook's roster is never called an end.

/** Where an Agent helper stands. `done`, `failed`, `stopped` and `finished` are
 *  final; `unlisted` ("no longer listed") and `gone` ("session ended") claim no
 *  end and never enter the finished fold; `unmeasured` is the state LEFT OUT:
 *  the row says nothing about it and the frame's `agentsUnmeasured` says why,
 *  once. */
export type AgentHelperState =
  | 'launched' | 'running' | 'done' | 'failed' | 'stopped' | 'finished' | 'unlisted' | 'gone' | 'unmeasured';

/** The runtime list derives from this record, which also says which states are final (D-6048's idiom). */
const AGENT_HELPER_STATE_FINAL: Record<AgentHelperState, boolean> = {
  launched: false, running: false, done: true, failed: true, stopped: true, finished: true, unlisted: false, gone: false, unmeasured: false,
};
export const AGENT_HELPER_STATES: readonly AgentHelperState[] = Object.keys(AGENT_HELPER_STATE_FINAL) as AgentHelperState[];
export const isFinalHelperState = (s: AgentHelperState): boolean => AGENT_HELPER_STATE_FINAL[s];

/** The words a row says. `unmeasured` has none: a state left out is never drawn. */
export const AGENT_HELPER_STATE_WORDS: Record<AgentHelperState, string | null> = {
  launched: 'launched', running: 'running', done: 'done', failed: 'failed', stopped: 'stopped', finished: 'finished',
  unlisted: 'no longer listed', gone: 'session ended', unmeasured: null,
};

/** One Agent helper's row. EVERY NULL MEANS "NOT MEASURED", as in `WorkflowView`. */
export interface AgentHelperView {
  /** Claude Code's agent id (`[A-Za-z0-9_-]{1,64}`). */
  id: string;
  /** The launch's one line, from the meta, cut to `HELPER_DESCRIPTION_MAX`. */
  description: string | null;
  /** `subagent · <agentType>`: the meta's `agentType`, cut to `HELPER_LABEL_MAX`. */
  agentType: string | null;
  /** The meta's model, else the launch result's resolved one. */
  model: string | null;
  /** A missing effort is null, never guessed. */
  effort: string | null;
  state: AgentHelperState;
  /** The launch result's time, else the roster's `startedAt`; epoch ms. */
  startedAt: number | null;
  /** Only for a final state, from the end source's own time (Table 6); null while it is not final, and for a final row whose time cannot be read. */
  endedAt: number | null;
  /** The helper transcript's last line's time, epoch ms. */
  lastActivityAt: number | null;
  tokens: number | null;
  /** The notification's summary: one line of at most `HELPER_SUMMARY_MAX_BYTES` bytes. */
  summary: string | null;
  /** A report exists for the row to open (it travels on request, never in the frame). */
  hasReport: boolean;
}

/** Why the live state of Agent helpers is not known, read from the stream's raw hook read. Sent only while a known helper's state was left out. */
export type HelpersUnmeasured =
  | { why: 'stale'; hookAgeMs: number }
  | { why: 'absent' }
  | { why: 'unreadable' }   // a failed read, or a malformed file
  | { why: 'foreign' }      // the state of another run of this session
  | { why: 'unregistered' } // the session's identity is not registered yet
  | { why: 'unseen'; helpers: number }; // drops this reader did not see

/** A finished Agent helper or workflow stays this long after its end time, folded (the coordinator's ruling on review 2861, F5). */
export const HELPER_FINISHED_KEEP_MS = 600_000;
/** The most finished rows kept per arm, the newest. */
export const HELPER_KEPT_MAX = 20;

// THE BOUNDS OF THE AGENT ARM (review 2900 F9). The frame's Agent arm is at most
// HELPER_LISTED_MAX + HELPER_NONFINAL_MAX + HELPER_KEPT_MAX = 84 rows, each under 1 KiB.
/** The hook roster's own cap: the most `running` rows. */
export const HELPER_LISTED_MAX = 32;
/** The most rows that are not final and not listed (launched, no longer listed, session ended, state left out) together. */
export const HELPER_NONFINAL_MAX = 32;
/** The description's length, in characters. */
export const HELPER_DESCRIPTION_MAX = 200;
/** The agent type's, model's and effort's length, in characters. */
export const HELPER_LABEL_MAX = 64;
/** A summary is one line of at most this many bytes. */
export const HELPER_SUMMARY_MAX_BYTES = 200;
/** A report is at most this many bytes, and a cut one says so. */
export const HELPER_REPORT_MAX_BYTES = 16_384;
/** The most ids whose launch results and notifications the fold remembers, the oldest evicted first. */
export const HELPER_FACTS_MAX = 256;
/** A finished (kept) workflow carries at most this many agents, failed and running first. */
export const WORKFLOW_KEPT_AGENTS_MAX = 40;

/** What Claude Code names a workflow's agents, in the hook roster's `name` and in their meta's `agentType`: never an Agent row. */
export const WORKFLOW_AGENT_TYPE = 'workflow-subagent';

/** An agent id, as the hook's own rule has it (`[A-Za-z0-9_-]`, 1 to 64 characters). Defined once: the fact parser and the
 *  decision both read it, and an id that fails it is never a row. */
const HELPER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const isHelperId = (v: unknown): v is string => typeof v === 'string' && HELPER_ID_RE.test(v);
