// The session's workflows, read where Claude Code keeps them (D-5561): one
// instance per session socket and session dir, holding what it has read so a
// 2 s tick costs a listing, a few stats and only the bytes appended since.
//
// Read-only: every call below is a FleetIO read. Nothing here writes, signals
// or starts anything, and the files it reads are under `<cfgDir>/projects/`,
// which the agent's read whitelist already admits (`.claude*` under home) — no
// new op, no new exec verb.
//
// BOUNDED, because the measured sizes say it must be (fleet, 2026-10-18):
// journals median 50 KB, p95 382 KB, max 2.7 MB; up to 292 run dirs in one
// session and 629 agents in one run; the last usage line in an agent transcript
// a median 10 KB from its end, p95 53 KB.
//  - the journal is read INCREMENTALLY from the last offset, at most
//    `JOURNAL_CHUNKS_PER_TICK` chunks of `READ_FROM_MAX_BYTES` per run per tick;
//  - an agent's tokens come from one `TAIL_BYTES` tail, re-read only when its
//    size changed, at most `AGENT_READS_PER_TICK` per tick across all runs;
//  - a finished, dropped or interrupted run is re-stat'ed only every
//    `RESTAT_EVERY` ticks (a resume in place grows its journal again).
import path from 'node:path';
import type { FleetIO } from '../io.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';
import { WORKFLOW_EVICT_MS, type WorkflowView } from '../../../shared/workflows.js';
import {
  decideRun,
  emptyCarry,
  emptyFold,
  firstAgentAfter,
  foldJournal,
  lastUsageTokens,
  parseAgentMeta,
  parseScriptPhases,
  parseSummary,
  runningView,
  RUN_ID_RE,
  scriptNameFor,
  selectRows,
  splitLines,
  summaryView,
  type Carry,
  type JournalFold,
  type Proc,
  type RunDecision,
  type SummaryFacts,
  type WorkflowsRead,
} from './model.js';

export type { WorkflowsRead };

export const JOURNAL_CHUNKS_PER_TICK = 16;
export const AGENT_READS_PER_TICK = 24;
export const TAIL_BYTES = 65_536;
export const RESTAT_EVERY = 15;
export const RUNS_IN_PARALLEL = 8;

/** The session dir `S`: the transcript path minus `.jsonl`. */
export function sessionDirOf(transcript: string): string {
  return transcript.endsWith('.jsonl') ? transcript.slice(0, -'.jsonl'.length) : transcript;
}


interface RunCache {
  offset: number;
  carry: Carry;
  fold: JournalFold;
  journalMtime: number | null;
  summaryMtime: number | null;
  /** The summary as parsed at `summaryReadAt`'s mtime; null = read and not a summary. */
  summary: SummaryFacts | null | undefined;
  summaryReadAt: number | null;
  /** agentId → transcript size at the last tail read, and what it measured. */
  /** `final`: read after the agent's key ended, so never read again. */
  tokens: Map<string, { size: number; tokens: number | null; final: boolean }>;
  /** agentId → the agent's newest transcript write (running agents only). */
  activity: Map<string, number>;
  /** agentId → its meta file's mtime (= its start), null if unstat-able. */
  starts: Map<string, number | null>;
  meta: Map<string, { label: string | null; phase: string | null }>;
  metaTried: Set<string>;
  phases: string[] | null | undefined;
  decision: RunDecision | null;
  /** The tick this run was last stat'ed on. */
  statTick: number;
  /** Where the next tick's round of running agents starts (`readAgents`). */
  cursor: number;
  view: WorkflowView | null;
}

const newRun = (): RunCache => ({
  offset: 0, carry: emptyCarry(), fold: emptyFold(), journalMtime: null, summaryMtime: null,
  summary: undefined, summaryReadAt: null, tokens: new Map(), activity: new Map(), starts: new Map(),
  meta: new Map(), metaTried: new Set(), phases: undefined, decision: null, statTick: -Infinity, cursor: 0, view: null,
});

export class SessionWorkflows {
  private readonly runs = new Map<string, RunCache>();
  private tick = 0;
  private scripts: readonly string[] | null = null;
  private scriptsTick = -Infinity;
  /** Agent reads left this tick (tails, metas, stats of starts). */
  private budget = 0;

  constructor(private readonly io: FleetIO, readonly sessionDir: string) {}

  private get runsDir(): string { return path.join(this.sessionDir, 'subagents', 'workflows'); }
  private summaryPath(runId: string): string { return path.join(this.sessionDir, 'workflows', `${runId}.json`); }
  private runDir(runId: string): string { return path.join(this.runsDir, runId); }

  async read(proc: Proc, now: number): Promise<WorkflowsRead> {
    this.tick++;
    this.budget = AGENT_READS_PER_TICK;
    const listing = await this.io.readdirMeasured(this.runsDir);
    if (!listing.ok) return listing.reason === 'absent' ? { kind: 'absent' } : { kind: 'unreadable' };
    const ids = listing.entries.filter((e) => RUN_ID_RE.test(e)).sort();
    for (const gone of [...this.runs.keys()]) if (!ids.includes(gone)) this.runs.delete(gone);
    const views: WorkflowView[] = [];
    // A few runs at a time: a session's first read can list ~300 run dirs (the
    // measured maximum), two stats each, and in remote mode each is a round trip.
    for (let i = 0; i < ids.length; i += RUNS_IN_PARALLEL) {
      const batch = ids.slice(i, i + RUNS_IN_PARALLEL).map((id) => {
        let run = this.runs.get(id);
        if (run === undefined) { run = newRun(); this.runs.set(id, run); }
        return this.readRun(id, run, proc, now);
      });
      for (const view of await Promise.all(batch)) if (view !== null) views.push(view);
    }
    return { kind: 'read', workflows: selectRows(views, now) };
  }

  private async readRun(id: string, run: RunCache, proc: Proc, now: number): Promise<WorkflowView | null> {
    // A run already ruled finished-and-dropped or interrupted is not re-read
    // every tick: only every RESTAT_EVERY-th, to catch a resume in place.
    const quiet = run.decision === 'interrupted' || (run.decision === 'finished' && run.view === null);
    if (quiet && this.tick - run.statTick < RESTAT_EVERY) return null;
    run.statTick = this.tick;

    const [journal, summary] = await Promise.all([
      this.io.statMeasured(path.join(this.runDir(id), 'journal.jsonl')),
      this.io.statMeasured(this.summaryPath(id)),
    ]);
    // A stat that did not answer measured nothing: hold what this run showed.
    if (!journal.ok) return journal.reason === 'absent' ? null : run.view;
    if (!summary.ok && summary.reason === 'unreadable') return run.view;
    run.summaryMtime = summary.ok ? summary.mtimeMs : null;
    run.journalMtime = journal.mtimeMs;

    // The cheap verdicts first, before any byte is read: a finished run, or an
    // orphan whose journal predates this process (no write since can be its).
    let activity = journal.mtimeMs;
    for (const k of run.fold.keys.values()) {
      const at = k.last === 'started' ? run.activity.get(k.agentId) : undefined;
      if (at !== undefined && at > activity) activity = at;
    }
    const decision = decideRun({ summaryMtime: run.summaryMtime, journalMtime: journal.mtimeMs, activityMtime: activity, proc });
    if (decision === 'undecided') return run.view;
    run.decision = decision;
    if (decision === 'interrupted') { run.view = null; return null; }
    if (decision === 'finished') { run.view = await this.finishedView(id, run, now); return run.view; }

    // Running: read what was appended, then the agents.
    const unread = !(await this.readJournal(id, run, journal.size));
    // A chunk that did not read this pass: the row this run showed stands (a
    // dropped round trip must not flicker the counts); a run never shown says
    // its counts are unread instead of drawing zeros.
    if (unread && run.view !== null && run.view.state === 'running') return run.view;
    await this.readAgents(id, run);
    const name = await this.nameOf(id, run);
    const phases = await this.phasesOf(id, run);
    const startedAt = await this.startOf(id, run);
    run.view = runningView({
      id, name, fold: run.fold, phases, startedAt, meta: run.meta, unread,
      tokens: new Map([...run.tokens].map(([a, t]) => [a, t.tokens])),
    });
    return run.view;
  }

  /** Append-read the journal from `run.offset`. False when a chunk would not
   *  read: the fold keeps what it had, and the row's counts are null this pass. */
  private async readJournal(id: string, run: RunCache, size: number): Promise<boolean> {
    if (size < run.offset) { run.offset = 0; run.carry = emptyCarry(); run.fold = emptyFold(); run.tokens.clear(); }
    const file = path.join(this.runDir(id), 'journal.jsonl');
    for (let i = 0; i < JOURNAL_CHUNKS_PER_TICK && run.offset < size; i++) {
      const r = await this.io.readFileFromBytesMeasured(file, run.offset, READ_FROM_MAX_BYTES);
      if (!r.ok) return false;
      if (r.bytes.length === 0) break;
      const framed = splitLines(run.carry, r.bytes);
      run.carry = framed.carry;
      foldJournal(run.fold, framed.lines);
      run.offset += r.bytes.length;
    }
    return true;
  }

  /** Tokens, activity and (for old builds) labels, within this tick's budget. */
  private async readAgents(id: string, run: RunCache): Promise<void> {
    const dir = this.runDir(id);
    // Running agents first: theirs is the number that moves. Taken ROUND-ROBIN
    // from where the last tick stopped: with more running agents than one
    // tick's budget, a fixed order spent every tick on the same ones and left
    // the rest unmeasured for the run's life (measured by the mutation table).
    const all = [...run.fold.keys.values()];
    const running = all.filter((k) => k.last === 'started').sort((a, b) => a.seq - b.seq);
    const from = running.length === 0 ? 0 : run.cursor % running.length;
    const keys = [...running.slice(from), ...running.slice(0, from), ...all.filter((k) => k.last !== 'started').sort((a, b) => b.seq - a.seq)];
    let visitedRunning = 0;
    for (const k of keys) {
      if (this.budget <= 0) break;
      if (k.last === 'started') visitedRunning++;
      const held = run.tokens.get(k.agentId);
      if (held?.final === true) continue; // a finished agent, read after it finished
      const file = path.join(dir, `agent-${k.agentId}.jsonl`);
      const st = await this.io.statMeasured(file);
      this.budget--;
      if (!st.ok) continue;
      if (k.last === 'started') run.activity.set(k.agentId, st.mtimeMs);
      if (held !== undefined && held.size === st.size) {
        if (k.last !== 'started') held.final = true;
        continue;
      }
      if (this.budget <= 0) break;
      const offset = Math.max(0, st.size - TAIL_BYTES);
      const tail = await this.io.readFileFromBytesMeasured(file, offset, Math.max(1, Math.min(TAIL_BYTES, st.size - offset)));
      this.budget--;
      if (!tail.ok) continue;
      const measured = lastUsageTokens(new TextDecoder().decode(tail.bytes));
      // No usage line in the tail keeps the previous reading (an agent mid-tool
      // writes long tool results); there was none before → unmeasured.
      run.tokens.set(k.agentId, { size: st.size, tokens: measured ?? held?.tokens ?? null, final: k.last !== 'started' });
    }
    run.cursor = from + visitedRunning;
    for (const k of keys) {
      if (this.budget <= 0) break;
      if (k.label !== null || run.metaTried.has(k.agentId)) continue;
      run.metaTried.add(k.agentId);
      const r = await this.io.readFileMeasured(path.join(dir, `agent-${k.agentId}.meta.json`));
      this.budget--;
      const m = r.ok ? parseAgentMeta(r.content) : null;
      if (m !== null) run.meta.set(k.agentId, m);
    }
  }

  /** When this run — or, resumed in place, its latest resume — started. */
  private async startOf(id: string, run: RunCache): Promise<number | null> {
    const floor = run.summaryMtime;
    for (;;) {
      const r = firstAgentAfter(run.fold, run.starts, floor);
      if ('at' in r) return r.at;
      if (this.budget <= 0) return null;
      const st = await this.io.statMeasured(path.join(this.runDir(id), `agent-${r.need}.meta.json`));
      this.budget--;
      run.starts.set(r.need, st.ok ? st.mtimeMs : null);
    }
  }

  /** The summary's name, else the script file's prefix, else null. */
  private async nameOf(id: string, run: RunCache): Promise<string | null> {
    if (run.summaryMtime !== null) {
      const s = await this.summaryOf(id, run);
      if (s?.workflowName) return s.workflowName;
    }
    return scriptNameFor(await this.scriptEntries(), id);
  }

  private async phasesOf(id: string, run: RunCache): Promise<string[] | null> {
    if (run.phases !== undefined) return run.phases;
    const name = scriptNameFor(await this.scriptEntries(), id);
    if (name === null) return null; // a scriptPath launch: not knowable, and asked again next tick
    const r = await this.io.readFileMeasured(path.join(this.sessionDir, 'workflows', 'scripts', `${name}-${id}.js`));
    if (!r.ok) return null;
    run.phases = parseScriptPhases(r.content);
    return run.phases;
  }

  /** The scripts listing, re-listed at most every RESTAT_EVERY ticks. */
  private async scriptEntries(): Promise<readonly string[]> {
    if (this.scripts !== null && this.tick - this.scriptsTick < RESTAT_EVERY) return this.scripts;
    const r = await this.io.readdirMeasured(path.join(this.sessionDir, 'workflows', 'scripts'));
    this.scriptsTick = this.tick;
    this.scripts = r.ok ? r.entries : [];
    return this.scripts;
  }

  private async summaryOf(id: string, run: RunCache): Promise<SummaryFacts | null> {
    if (run.summary !== undefined && run.summaryReadAt === run.summaryMtime) return run.summary;
    const r = await this.io.readFileMeasured(this.summaryPath(id));
    if (!r.ok) return null; // not cached: asked again next pass
    run.summary = parseSummary(r.content);
    run.summaryReadAt = run.summaryMtime;
    return run.summary;
  }

  /** A finished run's row while it is inside Claude Code's 30 s; null after,
   *  and the summary is never read for a run that finished before that. */
  private async finishedView(id: string, run: RunCache, now: number): Promise<WorkflowView | null> {
    const at = run.summaryMtime!;
    if (now - at >= WORKFLOW_EVICT_MS) return null;
    const facts = await this.summaryOf(id, run);
    // A summary that is not one (torn mid-write, or a status outside the three)
    // has no state to show: the row waits for the next pass rather than guessing.
    if (facts === null) return null;
    return summaryView(id, facts, at, scriptNameFor(await this.scriptEntries(), id));
  }
}
