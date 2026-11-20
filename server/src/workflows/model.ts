// The session's dynamic workflows, decided from the files Claude Code keeps for
// them (D-5560, D-5561). L1: pure decisions over bytes and numbers the reader
// (`read.ts`) measured. No `fs`, no clock, no I/O.
//
// THE SOURCE, MEASURED 2026-10-18 on 2.1.203-2.1.302 (plan
// `docs/superpowers/plans/2026-10-18-session-workflows-view.md` §Measured
// source). Under the session dir `S` (its transcript path minus `.jsonl`):
//
//   S/subagents/workflows/<runId>/journal.jsonl     appended: launched, started,
//                                                   result, failed (no timestamps)
//   S/subagents/workflows/<runId>/agent-<id>.jsonl  the agent's own transcript
//   S/subagents/workflows/<runId>/agent-<id>.meta.json  written once at its start
//   S/workflows/<runId>.json                        the summary, written at a
//                                                   final status (and again if a
//                                                   resumed run ends again)
//   S/workflows/scripts/<name>-<runId>.js           inline-script launches only
//
// Each displayed fact is computed the way Claude Code's own row computes it
// where the disk allows, and where it does not the field is null and the row
// says so (`shared/workflows.ts`).
import {
  HELPER_DESCRIPTION_MAX,
  HELPER_FACTS_MAX,
  HELPER_FINISHED_KEEP_MS,
  HELPER_KEPT_MAX,
  HELPER_LABEL_MAX,
  HELPER_LISTED_MAX,
  HELPER_NONFINAL_MAX,
  HELPER_SUMMARY_MAX_BYTES,
  WORKFLOW_AGENTS_MAX,
  WORKFLOW_AGENT_TYPE,
  WORKFLOW_EVICT_MS,
  WORKFLOW_KEPT_AGENTS_MAX,
  isFinalHelperState,
  isHelperId,
  type AgentHelperState,
  type AgentHelperView,
  type HelpersUnmeasured,
  type WorkflowAgentState,
  type WorkflowAgentView,
  type WorkflowState,
  type WorkflowView,
} from '../../../shared/workflows.js';
import type { HelperFact } from '../transcript/parse.js';

/** Claude Code's run id, as measured: `wf_` + 8 hex + `-` + 3 hex. Anything
 *  else in the runs directory is not a run. Defined once in `shared/workflow-ids.mjs`
 *  (W4 addendum P10), so ccrc history's lib reads the same grammar. */
export { RUN_ID_RE } from '../../../shared/workflow-ids.mjs';

/** The agent-call key every journal line names (`v<n>:<sha256 hex>`). */
const KEY_RE = /^v\d+:[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Framing: the journal is read as appended BYTES, in bounded chunks.

/** How much of ONE unfinished line the carry keeps. A `result` line holds the
 *  agent's whole return value (journals measured to 2.7 MB), and the counts
 *  need only its head — `type`, `key`, `agentId` come first in every measured
 *  line — so a longer line keeps its first 64 KB and is read from that. */
export const LINE_KEEP_BYTES = 65_536;

export interface Carry {
  /** Bytes of the line not yet ended, at most `LINE_KEEP_BYTES`. */
  bytes: Uint8Array;
  /** The line ran past `LINE_KEEP_BYTES`; `bytes` is its head. */
  cut: boolean;
}

export const emptyCarry = (): Carry => ({ bytes: new Uint8Array(0), cut: false });

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

const decode = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: false }).decode(b);

/** Frame appended bytes into whole lines, carrying the unfinished one. Lines
 *  end at `\n` (0x0a never occurs inside a UTF-8 multi-byte sequence, so a
 *  character cut across two chunks is reassembled in the carry). */
export function splitLines(carry: Carry, chunk: Uint8Array): { lines: string[]; carry: Carry } {
  const lines: string[] = [];
  let start = 0;
  let head = carry.bytes;
  let cut = carry.cut;
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] !== 0x0a) continue;
    const piece = chunk.subarray(start, i);
    const whole = cut ? head : concat(head, piece);
    const text = decode(cut || whole.length <= LINE_KEEP_BYTES ? whole : whole.subarray(0, LINE_KEEP_BYTES));
    if (text.trim() !== '') lines.push(text);
    head = new Uint8Array(0);
    cut = false;
    start = i + 1;
  }
  const rest = chunk.subarray(start);
  if (!cut) {
    const joined = concat(head, rest);
    if (joined.length > LINE_KEEP_BYTES) return { lines, carry: { bytes: joined.slice(0, LINE_KEEP_BYTES), cut: true } };
    return { lines, carry: { bytes: joined, cut: false } };
  }
  return { lines, carry: { bytes: head, cut: true } };
}

// ---------------------------------------------------------------------------
// The journal fold.

export interface KeyState {
  /** The key's latest attempt — a retry writes a new `started` with the same
   *  key and a new agentId, and Claude Code shows that one. */
  agentId: string;
  last: 'started' | 'result' | 'failed';
  label: string | null;
  phase: string | null;
  /** Schedule order: the order the key was FIRST started. */
  seq: number;
}

export interface JournalFold {
  keys: Map<string, KeyState>;
  /** Every `started` agentId in journal order, retries included — the agents
   *  whose start times say when the run (or a resume of it) began. */
  starts: string[];
}

export const emptyFold = (): JournalFold => ({ keys: new Map(), starts: [] });

type JournalLine = { type: string; key: string; agentId: string; label: string | null; phase: string | null };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** One line → its counting facts; null for a line that counts nothing (the
 *  `launched` line, the unobserved `restoring`/`restored`/`resumed`, a line
 *  that is not JSON). A line cut at `LINE_KEEP_BYTES` is not JSON either, so
 *  its head is searched for the three fields. */
function parseLine(text: string): JournalLine | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    const type = /"type"\s*:\s*"(started|result|failed)"/.exec(text)?.[1];
    const key = /"key"\s*:\s*"(v\d+:[0-9a-f]{64})"/.exec(text)?.[1];
    const agentId = /"agentId"\s*:\s*"([^"\\]*)"/.exec(text)?.[1];
    if (type === undefined || key === undefined || agentId === undefined) return null;
    const label = /"label"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
    return { type, key, agentId, label: label === undefined ? null : label, phase: null };
  }
  if (o === null || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const type = str(r.type);
  const key = str(r.key);
  if (type === null || key === null || !KEY_RE.test(key)) return null;
  return { type, key, agentId: str(r.agentId) ?? '', label: str(r.label), phase: str(r.phase) };
}

/** Fold whole journal lines into the per-key state. Mutates and returns `fold`. */
export function foldJournal(fold: JournalFold, lines: readonly string[]): JournalFold {
  for (const text of lines) {
    const l = parseLine(text);
    if (l === null) continue;
    const prev = fold.keys.get(l.key);
    if (l.type === 'started') {
      fold.starts.push(l.agentId);
      fold.keys.set(l.key, {
        agentId: l.agentId,
        last: 'started',
        label: l.label ?? prev?.label ?? null,
        phase: l.phase ?? prev?.phase ?? null,
        seq: prev?.seq ?? fold.keys.size,
      });
    } else if (l.type === 'result' || l.type === 'failed') {
      // A result whose `started` this read never saw (a journal cut before the
      // reader's window — not a measured shape, but cheap to survive) still
      // makes the key exist: it was scheduled.
      fold.keys.set(l.key, {
        agentId: prev?.agentId ?? l.agentId,
        last: l.type,
        label: prev?.label ?? null,
        phase: prev?.phase ?? null,
        seq: prev?.seq ?? fold.keys.size,
      });
    }
  }
  return fold;
}

// ---------------------------------------------------------------------------
// Agent transcripts.

/** The agent's current context: `input + cache_read + cache_creation` of the
 *  last assistant line with a non-zero input side — what Claude Code's per-agent
 *  `tokens` holds (minus the first stream event's output count, which is not on
 *  disk: measured +2..+24 tokens off). Null: no usage line in `text`.
 *
 *  A TAIL read starts mid-line, and that fragment needs no special case: every
 *  transcript line is one JSON object, and no proper suffix of one parses (its
 *  braces cannot balance), so the fragment is skipped like any line that does
 *  not parse. (A mutation that kept a `complete` flag for it survived the
 *  table: the flag guarded nothing.) */
export function lastUsageTokens(text: string): number | null {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!;
    if (!t.includes('"usage"')) continue;
    let o: unknown;
    try {
      o = JSON.parse(t);
    } catch {
      continue;
    }
    const msg = (o as { type?: unknown; message?: { usage?: Record<string, unknown> } } | null);
    if (msg?.type !== 'assistant') continue;
    const u = msg.message?.usage;
    if (u === undefined || u === null || typeof u !== 'object') continue;
    const n = (k: string): number => (typeof u[k] === 'number' && Number.isFinite(u[k]) ? (u[k] as number) : 0);
    const sum = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens');
    if (sum > 0) return sum;
  }
  return null;
}

/** The agent's label and phase from its meta file — the source for journal
 *  lines written before 2.1.265, which carry neither. */
export function parseAgentMeta(raw: string): { label: string | null; phase: string | null } | null {
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (o === null || typeof o !== 'object') return null;
    const label = str(o.description);
    const phase = str(o.workflowPhase);
    return { label: label === '' ? null : label, phase: phase === '' ? null : phase };
  } catch {
    return null;
  }
}

/** When the run began: the first agent, in journal order, whose start (its
 *  meta file's mtime, written once as it starts) is after `floor`. `floor` is
 *  the summary's mtime for a run resumed in place — Claude Code resets its
 *  clock to the resume — and null otherwise. `need` names the next agent whose
 *  start is not measured yet; the reader stats it and asks again. */
export function firstAgentAfter(
  fold: JournalFold,
  starts: ReadonlyMap<string, number | null>,
  floor: number | null,
): { at: number | null } | { need: string } {
  for (const agentId of fold.starts) {
    if (!starts.has(agentId)) return { need: agentId };
    const at = starts.get(agentId)!;
    if (at === null) continue; // its meta could not be stat'ed: not this one's start to give
    if (floor === null || at > floor) return { at };
  }
  return { at: null };
}

// ---------------------------------------------------------------------------
// Running vs finished.

/** The session's Claude Code process, as the session stream measured it. */
export type Proc =
  | { kind: 'live'; startedAt: number | null }
  | { kind: 'gone' }
  | { kind: 'unmeasured' };

export type RunDecision = 'finished' | 'running' | 'interrupted' | 'undecided';

/**
 * The measured rule (D-5561). Two traps decide its shape: a run with no
 * summary is NOT necessarily running (169 orphans of dead or swapped sessions
 * on the fleet, 3 live), and a run WITH one is not necessarily finished (a
 * killed run resumed in place keeps its runId, its dir and its old summary).
 * No recency timeout: a running workflow can go 30 min without a write.
 */
export function decideRun(a: {
  summaryMtime: number | null;
  journalMtime: number;
  /** The newest write the reader knows of: the journal, or a running agent's transcript. */
  activityMtime: number;
  proc: Proc;
}): RunDecision {
  if (a.summaryMtime !== null && a.journalMtime <= a.summaryMtime) return 'finished';
  if (a.proc.kind === 'gone') return 'interrupted';
  if (a.proc.kind === 'unmeasured') return 'undecided';
  if (a.proc.startedAt !== null && a.activityMtime < a.proc.startedAt) return 'interrupted';
  return 'running';
}

// ---------------------------------------------------------------------------
// Rows.

const AGENT_STATE: Record<KeyState['last'], WorkflowAgentState> = { started: 'running', result: 'done', failed: 'failed' };

/** The wire cut: every running and failed agent first (the ones a reader is
 *  looking for), then the newest done; shown back in schedule order. */
function cutAgents<T extends { seq: number; view: WorkflowAgentView }>(
  all: T[],
  max: number = WORKFLOW_AGENTS_MAX,
): { agents: WorkflowAgentView[]; omitted: number } {
  const ordered = [...all].sort((x, y) => x.seq - y.seq);
  if (ordered.length <= max) return { agents: ordered.map((a) => a.view), omitted: 0 };
  const urgent = ordered.filter((a) => a.view.state !== 'done');
  const done = ordered.filter((a) => a.view.state === 'done');
  const keep = new Set(urgent.slice(-max));
  for (let i = done.length - 1; i >= 0 && keep.size < max; i--) keep.add(done[i]!);
  const agents = ordered.filter((a) => keep.has(a)).map((a) => a.view);
  return { agents, omitted: ordered.length - agents.length };
}

export interface RunningInput {
  id: string;
  name: string | null;
  fold: JournalFold;
  /** Per agentId: its measured context tokens; null or missing = not measured. */
  tokens: ReadonlyMap<string, number | null>;
  /** Labels/phases from meta files, for keys whose journal lines carry none. */
  meta?: ReadonlyMap<string, { label: string | null; phase: string | null }>;
  phases: string[] | null;
  startedAt: number | null;
  /** `null` when the journal could not be read this pass: the counts are then null too. */
  unread?: boolean;
}

/** A running workflow's row, from its journal fold. */
export function runningView(r: RunningInput): WorkflowView {
  const keys = [...r.fold.keys.values()];
  let tokens = 0;
  let measured = 0;
  let unmeasured = 0;
  const rows = keys.map((k) => {
    const t = r.tokens.get(k.agentId);
    if (typeof t === 'number') { tokens += t; measured++; } else unmeasured++;
    const m = r.meta?.get(k.agentId);
    return { seq: k.seq, view: { label: k.label ?? m?.label ?? null, phase: k.phase ?? m?.phase ?? null, state: AGENT_STATE[k.last] } };
  });
  const bySeq = [...rows].sort((x, y) => x.seq - y.seq);
  const newestRunning = [...bySeq].reverse().find((a) => a.view.state === 'running');
  const phase = (newestRunning ?? bySeq.at(-1))?.view.phase ?? null;
  const { agents, omitted } = cutAgents(rows);
  const unread = r.unread === true;
  return {
    id: r.id,
    name: r.name,
    state: 'running',
    done: unread ? null : keys.filter((k) => k.last === 'result').length,
    failed: unread ? null : keys.filter((k) => k.last === 'failed').length,
    total: unread ? null : keys.length,
    phase,
    phases: r.phases,
    startedAt: r.startedAt,
    endedAt: null,
    tokens: measured > 0 ? tokens : null,
    tokensUnmeasured: unmeasured,
    agents: unread ? [] : agents,
    agentsOmitted: unread ? 0 : omitted,
  };
}

export interface SummaryFacts {
  status: Exclude<WorkflowState, 'running'>;
  workflowName: string | null;
  startTime: number | null;
  durationMs: number | null;
  totalTokens: number | null;
  agentCount: number | null;
  phases: string[] | null;
  agents: Array<{ index: number; view: WorkflowAgentView }>;
}

const FINAL: readonly string[] = ['completed', 'failed', 'killed'];
const SUMMARY_AGENT_STATE: Record<string, WorkflowAgentState> = { done: 'done', error: 'failed', progress: 'running', start: 'running' };
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The summary (`S/workflows/<runId>.json`) → its facts; null when the bytes
 *  are not a summary in a final status. */
export function parseSummary(raw: string): SummaryFacts | null {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (o === null || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const status = str(s.status);
  if (status === null || !FINAL.includes(status)) return null;
  const phases = Array.isArray(s.phases)
    ? s.phases.map((p) => str((p as { title?: unknown } | null)?.title)).filter((t): t is string => t !== null)
    : null;
  const agents: SummaryFacts['agents'] = [];
  if (Array.isArray(s.workflowProgress)) {
    for (const e of s.workflowProgress as Array<Record<string, unknown> | null>) {
      if (e === null || typeof e !== 'object' || e.type !== 'workflow_agent') continue;
      const state = SUMMARY_AGENT_STATE[str(e.state) ?? ''];
      if (state === undefined) continue;
      agents.push({ index: num(e.index) ?? agents.length, view: { label: str(e.label), phase: str(e.phaseTitle), state } });
    }
  }
  return {
    status: status as SummaryFacts['status'],
    workflowName: str(s.workflowName),
    startTime: num(s.startTime),
    durationMs: num(s.durationMs),
    totalTokens: num(s.totalTokens),
    agentCount: num(s.agentCount),
    phases,
    agents,
  };
}

/** A finished workflow's row, from its summary. `summaryMtime` ends a summary
 *  that carries no start or duration. Claude Code's own total is
 *  `max(agentCount, entries)` (2.1.302's `e6e`). */
export function summaryView(id: string, f: SummaryFacts, summaryMtime: number, nameFallback: string | null = null): WorkflowView {
  const views = f.agents.map((a) => ({ seq: a.index, view: a.view }));
  const { agents, omitted } = cutAgents(views);
  const endedAt = f.startTime !== null && f.durationMs !== null ? f.startTime + f.durationMs : summaryMtime;
  return {
    id,
    name: f.workflowName ?? nameFallback,
    state: f.status,
    done: f.agents.filter((a) => a.view.state === 'done').length,
    failed: f.agents.filter((a) => a.view.state === 'failed').length,
    total: Math.max(f.agentCount ?? 0, f.agents.length),
    phase: f.agents.at(-1)?.view.phase ?? null,
    phases: f.phases,
    startedAt: f.startTime,
    endedAt,
    tokens: f.totalTokens,
    tokensUnmeasured: 0,
    agents,
    agentsOmitted: omitted,
  };
}

/** The rows to show at `now`: every running one, and a finished one until
 *  `WORKFLOW_EVICT_MS` after its end — oldest start first, unknown starts last. */
export function selectRows(views: readonly WorkflowView[], now: number): WorkflowView[] {
  return views
    .filter((v) => v.state === 'running' || (v.endedAt !== null && now - v.endedAt < WORKFLOW_EVICT_MS))
    .sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Names and phases.

/** Claude Code's own match of a script file to a run (2.1.302: `^[a-z0-9_-]+\.js$`
 *  and `endsWith('-' + runId + '.js')`); the prefix is the launch-time name. */
export function scriptNameFor(entries: readonly string[], runId: string): string | null {
  const suffix = `-${runId}.js`;
  for (const e of entries) {
    if (!/^[a-z0-9_-]+\.js$/.test(e) || !e.endsWith(suffix)) continue;
    const name = e.slice(0, -suffix.length);
    if (name !== '') return name;
  }
  return null;
}

/** `meta.phases` titles from a script's SOURCE — matched, never evaluated.
 *  Null when the script declares no `phases` array this can read. */
export function parseScriptPhases(src: string): string[] | null {
  const m = /\bphases\s*:\s*\[([\s\S]*?)\]/.exec(src);
  if (m === null) return null;
  const titles: string[] = [];
  const re = /\btitle\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  for (let t = re.exec(m[1]!); t !== null; t = re.exec(m[1]!)) titles.push(t[2]!);
  return titles;
}

// ---------------------------------------------------------------------------
// The frame.

export type WorkflowsRead =
  /** No runs directory: this session has never run a workflow — or its
   *  workflow state is not where every measured build keeps it. */
  | { kind: 'absent' }
  /** The runs directory would not list (EACCES, a dropped agent round trip): NOT "none". */
  | { kind: 'unreadable' }
  | { kind: 'read'; workflows: WorkflowView[] };

/**
 * What the session socket sends for one read (D-5560). Three reads, never folded:
 *  - `read`: the rows;
 *  - `absent`: no rows — UNLESS the hook's last fresh Stop listed a background
 *    `workflow` (`hookSaysWorkflow`). Then a workflow exists whose state is not
 *    in these files (from 2.1.287 Claude Code routes the writes through a
 *    storage interface; every measured install wrote them here), and that is
 *    `unreadable`, not "no workflows";
 *  - `unreadable`: the rows last read stand, flagged as not re-read.
 */
export function workflowsFrame(
  read: WorkflowsRead,
  hookSaysWorkflow: boolean,
  lastRead: readonly WorkflowView[],
): { workflows: WorkflowView[]; unreadable: boolean } {
  if (read.kind === 'read') return { workflows: read.workflows, unreadable: false };
  if (read.kind === 'absent' && !hookSaysWorkflow) return { workflows: [], unreadable: false };
  return { workflows: [...lastRead], unreadable: true };
}

/**
 * Whether the frame is due (D-5560): the gate H1b MOVES here. H1a states it and nothing calls it yet, so until H1b deletes
 * `checkWorkflows`'s inline copy (`sessionws.ts`) there are two copies of one decision, and H1b pins in a characterization
 * case that the two agree on today's inputs (review 2961 F9). "Never had": the session has
 * no workflows directory, no known Agent helper id, and no frame was ever sent — a session that never ran a helper gets
 * no frame. An absent read made `unreadable` by the hook's word, an unreadable read, a read and a known helper are all
 * due, and so is any frame after one was sent (its rows must be cleared). Whether the JSON changed is delivery's.
 */
export function frameDue(a: {
  workflows: WorkflowsRead['kind'];
  unreadable: boolean;
  /** `AgentArm.known` of this reading. */
  knownHelpers: number;
  sentBefore: boolean;
}): boolean {
  const neverHad = a.workflows === 'absent' && !a.unreadable && a.knownHelpers === 0;
  return !(neverHad && !a.sentBefore);
}

// ---------------------------------------------------------------------------
// Agent helpers (desktop polish C49, H1a, D-8829; spec 2026-11-19-session-helpers-design §3.2, Figure 2).
//
// An Agent helper's state is decided HERE, from measured facts only, strongest first:
//   a final task notification or a completed launch result (unless the roster lists the id with a LATER start: a continued
//   helper), the meta's `finished` marker, a session process that is
//   gone, a roster that cannot be used (state left out), a roster that lists the id (running), a roster read before the
//   launch result (launched), a drop this reader SAW (no longer listed), else the state is left out.
// Nothing is ever inferred to be running, and dropping off the roster is never called an end. No fs, no clock: every
// time (`now`, the roster's read time) is an input.

/** What a workflow's agents are called on the roster: no Agent row. */
export const isWorkflowAgentName = (name: string): boolean => name === WORKFLOW_AGENT_TYPE;

/** The facts of one id, folded from the transcript's `HelperFact`s. `launch` is the Agent launch result's; `end` is the
 *  final task notification, or a foreground launch's completed result (`from`). */
export interface HelperIdFacts {
  launch: { at: number | null; model: string | null; async: boolean; durationMs: number | null } | null;
  end: { outcome: 'done' | 'failed' | 'stopped'; at: number | null; summary: string | null; hasReport: boolean; from: 'notification' | 'launch' } | null;
}

const HELPER_OUTCOME = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' } as const;
type HelperEnd = NonNullable<HelperIdFacts['end']>;
type HelperLaunch = NonNullable<HelperIdFacts['launch']>;

/** A tie of two ends at one time is told by outcome, so a backwards scan and a forward tail agree (review 2961 F10). */
const OUTCOME_RANK = { done: 0, stopped: 1, failed: 2 } as const;
/** The later of two ends, by their own times; an end with a time beats one with none; a tie goes to the more telling outcome
 *  (failed, then stopped, then done), and between two of one outcome to the newer read. */
function laterEnd(a: HelperEnd | null, b: HelperEnd): HelperEnd {
  if (a === null) return b;
  if (a.at === null) return b;
  if (b.at === null) return a;
  if (b.at !== a.at) return b.at > a.at ? b : a;
  return OUTCOME_RANK[b.outcome] >= OUTCOME_RANK[a.outcome] ? b : a;
}
/** The earlier of two launches, one with a time beating one with none. */
function earlierLaunch(a: HelperLaunch | null, b: HelperLaunch): HelperLaunch {
  if (a === null) return b;
  if (a.at === null) return b.at === null ? a : b;
  return b.at !== null && b.at < a.at ? b : a;
}

/**
 * Fold `facts` into a copy of `prev`, per id, in either order of arrival. At most `HELPER_FACTS_MAX` ids are kept, the
 * least recently touched evicted first (a notification for a task that is no Agent helper — a workflow's, a shell's — is a
 * fact too, and nothing here can tell it from one). `prev` is never mutated.
 */
export function foldHelperFacts(prev: ReadonlyMap<string, HelperIdFacts>, facts: readonly HelperFact[]): Map<string, HelperIdFacts> {
  const out = new Map(prev);
  for (const f of facts) {
    const cur = out.get(f.id) ?? { launch: null, end: null };
    let { launch, end } = cur;
    if (f.source === 'launch') {
      launch = earlierLaunch(launch, { at: f.at, model: f.model, async: f.status === 'async_launched', durationMs: f.durationMs });
    }
    if (f.status !== 'async_launched') {
      end = laterEnd(end, {
        outcome: HELPER_OUTCOME[f.status],
        at: f.at,
        summary: f.summary,
        hasReport: f.report !== null && f.report !== '',
        from: f.source,
      });
    }
    out.delete(f.id);
    out.set(f.id, { launch, end });
  }
  while (out.size > HELPER_FACTS_MAX) out.delete(out.keys().next().value as string);
  return out;
}

/** What one Agent helper's meta file and transcript say, as the reader measured them. */
export interface HelperMeta {
  /** Where the meta sits: `subagents/agent-<id>.meta.json` (`agent`) or under a workflow's run directory (`workflow`). */
  path: 'agent' | 'workflow';
  agentType: string | null;
  description: string | null;
  model: string | null;
  effort: string | null;
  /** The meta's own `finished` marker, the only on-disk end marker. */
  finished: boolean;
  /** The helper transcript's last line's `timestamp`, epoch ms: its last write, and a `finished` row's end time. */
  lastWriteAt: number | null;
  tokens: number | null;
}

/** Why the roster cannot be used: `HelpersUnmeasured` less the one case this decision itself finds. */
export type RosterUnusable = Exclude<HelpersUnmeasured, { why: 'unseen' }>;

/** The hook's roster as the stream's raw read gave it. `at` is the published copy's READ time (`HookReading.at`), not the
 *  hook state's `updatedAt`, which SubagentStart and Stop leave alone (review 2900 F6). */
export type RosterInput =
  | { kind: 'usable'; at: number; entries: ReadonlyArray<{ id: string | null; name: string; startedAt: number | null }> }
  | { kind: 'unusable'; why: RosterUnusable };

/** What one reading hands the next: the roster it saw, and the drops it has seen. Immutable by convention: the decision
 *  returns a new one and never edits the one it was given. */
export interface HelperMemory {
  /** The ids on the last USABLE roster IN THE ROSTER'S OWN ORDER (a Set keeps insertion order, and the witness reads it,
   *  review 2961 F2); null when the last reading's was not usable (nothing to compare with). */
  listed: ReadonlySet<string> | null;
  /** That roster held `HELPER_LISTED_MAX` entries: the cap evicts, so an absence is not a stop. */
  listedFull: boolean;
  /** The last `Proc.live.startedAt` measured, carried across a reading that does not measure it live (review 2961 F11);
   *  null until one was. */
  procStartedAt: number | null;
  /** Ids this reader saw drop, still absent: they read "no longer listed" while the roster stays usable. */
  dropped: ReadonlySet<string>;
  /** Final rows with no readable end time that were already drawn once: they leave with the next reading. */
  noEndShown: ReadonlySet<string>;
}
export const emptyHelperMemory = (): HelperMemory => ({ listed: null, listedFull: false, procStartedAt: null, dropped: new Set(), noEndShown: new Set() });

export interface AgentArmInput {
  now: number;
  roster: RosterInput;
  proc: Proc;
  facts: ReadonlyMap<string, HelperIdFacts>;
  metas: ReadonlyMap<string, HelperMeta>;
  memory: HelperMemory;
}

export interface AgentArm {
  /** The rows, at most `HELPER_LISTED_MAX + HELPER_NONFINAL_MAX + HELPER_KEPT_MAX` (84): running first, the rest of the main list by state, finished last. */
  agents: AgentHelperView[];
  /** Rows the three bounds evicted (a finished row that merely aged out of the keep is not one). */
  omitted: number;
  /** Sent only while a known helper's state was left out (§8): the roster's own reason, else the drops this reader did not see. */
  unmeasured: HelpersUnmeasured | null;
  /** The Agent helper ids known this reading (the frame gate's `knownHelpers`), before any bound or keep. */
  known: number;
  memory: HelperMemory;
}

/** Whether a finished helper or workflow is still kept, by its END TIME (review 2900 F5): the keep's one owner. An end
 *  time that cannot be read is not kept HERE. The rule that a final row with no readable end time is drawn once and leaves
 *  with the next reading is not this function's: for an Agent row it is `decideAgentHelpers`'s `noEndShown` memory, and H2,
 *  which moves the workflow keep onto this function, applies the same draw-once rule to a finished workflow (spec §4.3;
 *  review 2961 F8). */
export const isFinishedKept = (endedAt: number | null, now: number): boolean => endedAt !== null && now - endedAt < HELPER_FINISHED_KEEP_MS;

/** A kept (finished) workflow carries at most `WORKFLOW_KEPT_AGENTS_MAX` agents, running and failed first, and says what it left out. */
export function capKeptWorkflow(v: WorkflowView): WorkflowView {
  if (v.agents.length <= WORKFLOW_KEPT_AGENTS_MAX) return v;
  const cut = cutAgents(v.agents.map((view, seq) => ({ seq, view })), WORKFLOW_KEPT_AGENTS_MAX);
  return { ...v, agents: cut.agents, agentsOmitted: v.agentsOmitted + cut.omitted };
}

const capChars = (s: string | null, max: number): string | null => {
  if (s === null) return null;
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const last = cut.charCodeAt(max - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut; // never half a surrogate pair
};
const capBytes = (s: string | null, max: number): string | null => {
  if (s === null) return null;
  let bytes = 0;
  let out = '';
  for (const ch of s) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > max) break;
    bytes += n;
    out += ch;
  }
  return out;
};

/** A state's place in the main list: running first, the unfinished and the undecided below it. */
const STATE_RANK: Record<AgentHelperState, number> = { running: 0, launched: 1, unmeasured: 2, unlisted: 3, gone: 4, done: 5, failed: 5, stopped: 5, finished: 5 };
const byStart = (a: AgentHelperView, b: AgentHelperView): number =>
  (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** The newest `max` by start time (an unknown start is the oldest), and how many were evicted. */
function newestStarted(rows: AgentHelperView[], max: number): { kept: AgentHelperView[]; evicted: number } {
  if (rows.length <= max) return { kept: rows, evicted: 0 };
  const newest = [...rows].sort((a, b) => (b.startedAt ?? -Infinity) - (a.startedAt ?? -Infinity) || (a.id < b.id ? -1 : 1)).slice(0, max);
  return { kept: newest, evicted: rows.length - max };
}
const newestEnded = (rows: AgentHelperView[], max: number): { kept: AgentHelperView[]; evicted: number } => {
  // a row drawn once for want of an end time is the newest decision there is
  const rank = (r: AgentHelperView): number => r.endedAt ?? Infinity;
  const sorted = [...rows].sort((a, b) => (rank(a) === rank(b) ? (a.id < b.id ? -1 : 1) : rank(b) - rank(a)));
  return { kept: sorted.slice(0, max), evicted: Math.max(0, sorted.length - max) };
};

/** Bound a memory set: the newest `HELPER_FACTS_MAX` entries. */
const boundedSet = (s: Iterable<string>): ReadonlySet<string> => {
  const all = [...s];
  return new Set(all.length > HELPER_FACTS_MAX ? all.slice(-HELPER_FACTS_MAX) : all);
};

/** The roster's listed ids, in the roster's order, one per id; an entry with no id (or one that is no agent id) lists none. */
function rosterIds(entries: ReadonlyArray<{ id: string | null }>): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) if (isHelperId(e.id)) ids.add(e.id);
  return ids;
}

/**
 * The drops this reading SAW, which only the reader can ask before the decision runs (it re-reads a seen drop's meta at
 * once, review 2961 F13) and which the decision itself uses, so there is one witness and no second writer. An id of the last
 * usable roster that this roster no longer lists is a seen drop when nothing else could have taken it: both rosters have
 * room (fewer than `HELPER_LISTED_MAX` ENTRIES, counting those with no id, as the hook's cap does), the process did not
 * restart between the readings (`Proc.live.startedAt` changed), and an id that sat BEFORE it in the last roster is still
 * listed. A reset empties the roster whole and the cap evicts the OLDEST entries first, so a surviving older id proves
 * neither happened. The cost is recorded: a real stop of the oldest entry is left out, as is the last listed id's.
 */
export function seenDrops(memory: HelperMemory, roster: RosterInput, proc: Proc): ReadonlySet<string> {
  const none: ReadonlySet<string> = new Set();
  if (roster.kind !== 'usable' || memory.listed === null || memory.listedFull || roster.entries.length >= HELPER_LISTED_MAX) return none;
  if (proc.kind === 'live' && proc.startedAt !== null && memory.procStartedAt !== null && proc.startedAt !== memory.procStartedAt) return none;
  const now = rosterIds(roster.entries);
  const out = new Set<string>();
  let olderSurvivor = false;
  for (const id of memory.listed) {
    if (now.has(id)) olderSurvivor = true;
    else if (olderSurvivor) out.add(id);
  }
  return out;
}

/**
 * Decide every known Agent helper's state, row and bound from one reading's measured inputs (Figure 2), and hand back the
 * memory the next reading compares against. Pure: nothing here reads a clock, a file or a socket.
 *
 * THE WITNESS OF A DROP (review 2900 F13, review 2961 F2 and F11): `seenDrops`, above. `no longer listed` needs a drop this
 * reader SAW. A SessionStart (a `clear` or an in-session `resume`, which Claude Code does without a new process) empties the
 * roster, and nothing the reader receives says one happened, so the witness is the roster's own CONTINUITY: an older id still
 * listed, which a reset or the cap's eviction of the oldest entries cannot leave; the process start time is a veto when it
 * was measured in both readings, and it is carried across a reading that does not measure it. RESIDUAL: the oldest entry's
 * real Stop, and the last listed id's, look exactly like the cap and a reset, so their state is left out (counted as
 * `unseen`) rather than called a drop.
 *
 * A HELPER CONTINUED AFTER ITS END (review 2961 F3, measured: a continued agent fires a new SubagentStart, 116 of 3,323
 * started ids on this box did, and the hook then lists it with a later start). A usable roster that lists the id with a
 * start LATER than the final notification's own time is positive evidence that it runs again, and ranks above the end and
 * the meta's `finished` marker (which stays true while it runs). Nothing is inferred: it is listed. With no end fact to
 * compare a start with, the marker alone stays `finished` beside a listing (a recorded residual).
 */
export function decideAgentHelpers(i: AgentArmInput): AgentArm {
  const usable = i.roster.kind === 'usable' ? i.roster : null;
  const entries = usable?.entries ?? [];
  const listedIds = rosterIds(entries);
  const entryById = new Map<string, (typeof entries)[number]>();
  for (const e of entries) if (isHelperId(e.id) && !entryById.has(e.id)) entryById.set(e.id, e);
  const listedFull = entries.length >= HELPER_LISTED_MAX;

  // Which ids are Agent helpers. A launch result names one (positive evidence); else its meta sits at the Agent path with
  // another type than a workflow's, and the roster does not call it a workflow's agent.
  const isAgent = (id: string): boolean => {
    if (i.facts.get(id)?.launch != null) return true;
    const m = i.metas.get(id);
    if (m === undefined || m.path !== 'agent' || m.agentType === WORKFLOW_AGENT_TYPE) return false;
    const e = entryById.get(id);
    return !(e !== undefined && isWorkflowAgentName(e.name));
  };
  const ids = new Set<string>();
  for (const [id, f] of i.facts) if (isHelperId(id) && f.launch !== null && isAgent(id)) ids.add(id);
  for (const id of i.metas.keys()) if (isHelperId(id) && isAgent(id)) ids.add(id);

  const prev = i.memory;
  const seen = seenDrops(prev, i.roster, i.proc);
  const droppedNow = new Set<string>();
  /** Whether the roster lists `id` with a start later than the time `endAt` a final fact gave: it runs again. */
  const continuedAfter = (id: string, endAt: number | null): boolean => {
    const start = usable === null || i.proc.kind === 'gone' ? null : entryById.get(id)?.startedAt ?? null;
    return endAt !== null && start !== null && start > endAt;
  };

  const rows: AgentHelperView[] = [];
  const shownNoEnd = new Set<string>();
  for (const id of ids) {
    const f = i.facts.get(id);
    const m = i.metas.get(id) ?? null;
    const launch = f?.launch ?? null;
    const endFact = f?.end ?? null;
    let state: AgentHelperState;
    let endedAt: number | null = null;
    const continued = endFact !== null && continuedAfter(id, endFact.at);
    /** The end fact the row shows: none for a helper that runs again. */
    const shownEnd = continued ? null : endFact;
    if (continued) state = 'running';
    else if (endFact !== null) {
      state = endFact.outcome;
      endedAt = endFact.at;
    } else if (m?.finished === true) {
      state = 'finished';
      endedAt = m.lastWriteAt;
    } else if (i.proc.kind === 'gone') state = 'gone';
    else if (usable === null) state = 'unmeasured';
    else if (listedIds.has(id)) state = 'running';
    else if (launch !== null && launch.at !== null && usable.at < launch.at) state = 'launched';
    else if (seen.has(id)) { state = 'unlisted'; droppedNow.add(id); }
    else if (prev.dropped.has(id)) state = 'unlisted';
    else state = 'unmeasured';

    if (isFinalHelperState(state)) {
      if (endedAt === null) {
        if (prev.noEndShown.has(id)) continue; // drawn once already: it leaves with this reading
        shownNoEnd.add(id);
      } else if (!isFinishedKept(endedAt, i.now)) continue;
    }

    const fromLaunch = launch === null ? null : launch.async ? launch.at : launch.at !== null && launch.durationMs !== null ? launch.at - launch.durationMs : null;
    rows.push({
      id,
      description: capChars(m?.description ?? null, HELPER_DESCRIPTION_MAX),
      agentType: capChars(m?.agentType ?? null, HELPER_LABEL_MAX),
      model: capChars(m?.model ?? launch?.model ?? null, HELPER_LABEL_MAX),
      effort: capChars(m?.effort ?? null, HELPER_LABEL_MAX),
      state,
      startedAt: fromLaunch ?? entryById.get(id)?.startedAt ?? null,
      endedAt, // only a final branch above sets it
      lastActivityAt: m?.lastWriteAt ?? null,
      tokens: m?.tokens ?? null,
      summary: capBytes(shownEnd?.summary ?? null, HELPER_SUMMARY_MAX_BYTES),
      hasReport: shownEnd?.hasReport ?? false,
    });
  }

  // THE BOUNDS (review 2900 F9): the listed, the other non-final, and the finished each have their own cap.
  const running = newestStarted(rows.filter((r) => r.state === 'running'), HELPER_LISTED_MAX);
  const others = newestStarted(rows.filter((r) => r.state !== 'running' && !isFinalHelperState(r.state)), HELPER_NONFINAL_MAX);
  const finals = newestEnded(rows.filter((r) => isFinalHelperState(r.state)), HELPER_KEPT_MAX);
  const agents = [
    ...running.kept.sort(byStart),
    ...others.kept.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || byStart(a, b)),
    ...finals.kept,
  ];
  const shown = new Set(agents.map((r) => r.id));
  const left = agents.filter((r) => r.state === 'unmeasured').length;

  const nowDropped = usable === null ? [] : [...prev.dropped, ...droppedNow].filter((id) => !listedIds.has(id) && ids.has(id));
  return {
    agents,
    omitted: running.evicted + others.evicted + finals.evicted,
    unmeasured: left === 0 ? null : i.roster.kind === 'unusable' ? i.roster.why : { why: 'unseen', helpers: left },
    known: ids.size,
    memory: {
      listed: usable === null ? null : listedIds,
      listedFull: usable !== null && listedFull,
      procStartedAt: i.proc.kind === 'live' && i.proc.startedAt !== null ? i.proc.startedAt : prev.procStartedAt,
      dropped: boundedSet(nowDropped),
      noEndShown: boundedSet([...prev.noEndShown, ...[...shownNoEnd].filter((id) => shown.has(id))]),
    },
  };
}
