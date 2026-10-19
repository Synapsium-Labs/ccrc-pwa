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
  WORKFLOW_AGENTS_MAX,
  WORKFLOW_EVICT_MS,
  type WorkflowAgentState,
  type WorkflowAgentView,
  type WorkflowState,
  type WorkflowView,
} from '../../../shared/workflows.js';

/** Claude Code's run id, as measured: `wf_` + 8 hex + `-` + 3 hex. Anything
 *  else in the runs directory is not a run. */
export const RUN_ID_RE = /^wf_[0-9a-f]{8}-[0-9a-f]{3}$/;

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
function cutAgents<T extends { seq: number; view: WorkflowAgentView }>(all: T[]): { agents: WorkflowAgentView[]; omitted: number } {
  const ordered = [...all].sort((x, y) => x.seq - y.seq);
  if (ordered.length <= WORKFLOW_AGENTS_MAX) return { agents: ordered.map((a) => a.view), omitted: 0 };
  const urgent = ordered.filter((a) => a.view.state !== 'done');
  const done = ordered.filter((a) => a.view.state === 'done');
  const keep = new Set(urgent.slice(-WORKFLOW_AGENTS_MAX));
  for (let i = done.length - 1; i >= 0 && keep.size < WORKFLOW_AGENTS_MAX; i--) keep.add(done[i]!);
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
