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
//    size changed, at most `AGENT_READS_PER_TICK` per tick across all runs,
//    shared so no run's start, labels or done agents wait behind another's
//    busy agents (`read`);
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
/** Of AGENT_READS_PER_TICK, what the one-time reads (labels, done agents) always get. */
export const ONE_TIME_RESERVE = 8;
/** How many READ_FROM_MAX_BYTES chunks a done agent's read walks back past its tail. */
export const WALKBACK_CHUNKS = 4;

const rotate = <T>(xs: readonly T[], by: number): T[] => {
  const k = xs.length === 0 ? 0 : by % xs.length;
  return [...xs.slice(k), ...xs.slice(0, k)];
};

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
  /** The tick this run was last stat'ed on (the first one minus `stagger`). */
  statTick: number;
  /** Ticks this quiet run's re-stat is brought forward, so a session's quiet
   *  runs re-stat spread over RESTAT_EVERY ticks instead of all on one. */
  stagger: number;
  /** Where the next tick's round of running agents starts (`readAgents`). */
  cursor: number;
  view: WorkflowView | null;
}

const newRun = (): RunCache => ({
  offset: 0, carry: emptyCarry(), fold: emptyFold(), journalMtime: null, summaryMtime: null,
  summary: undefined, summaryReadAt: null, tokens: new Map(), activity: new Map(), starts: new Map(),
  meta: new Map(), metaTried: new Set(), phases: undefined, decision: null, statTick: -Infinity, stagger: 0, cursor: 0, view: null,
});

export class SessionWorkflows {
  private readonly runs = new Map<string, RunCache>();
  private tick = 0;
  private scripts: readonly string[] | null = null;
  private scriptsTick = -Infinity;
  /** Which running run's tail share comes first this tick. */
  private runCursor = 0;
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
    const running: Array<{ id: string; run: RunCache; unread: boolean }> = [];
    // A few runs at a time: a session's first read can list ~300 run dirs (the
    // measured maximum), two stats each, and in remote mode each is a round trip.
    for (let i = 0; i < ids.length; i += RUNS_IN_PARALLEL) {
      const batch = ids.slice(i, i + RUNS_IN_PARALLEL).map(async (id, j) => {
        let run = this.runs.get(id);
        if (run === undefined) {
          run = newRun();
          // Staggered: the quiet runs' re-stats spread over RESTAT_EVERY ticks
          // instead of all landing on the same one.
          run.stagger = (i + j) % RESTAT_EVERY;
          this.runs.set(id, run);
        }
        return { id, run, r: await this.decideAndFold(id, run, proc, now) };
      });
      for (const { id, run, r } of await Promise.all(batch)) {
        if (r.kind === 'view') { if (r.view !== null) views.push(r.view); } else running.push({ id, run, unread: r.unread });
      }
    }
    if (running.length > 0) {
      // The agent budget, in an order that starves nobody (D-5561):
      //  1. each running run's start — one cached stat, read once;
      //  2. running agents' tails, a fair share per run, rotated across ticks
      //     when there are more runs than shares;
      //  3. the one-time reads (labels for old builds, done agents' last
      //     tokens) with the rest, never less than ONE_TIME_RESERVE.
      const startedAt = new Map<string, number | null>();
      for (const r of running) startedAt.set(r.id, await this.startOf(r.id, r.run));
      const order = rotate(running, this.runCursor);
      const tailBudget = Math.max(0, this.budget - ONE_TIME_RESERVE);
      const share = Math.max(2, Math.floor(tailBudget / running.length));
      let tailLeft = tailBudget;
      let served = 0;
      for (const r of order) {
        if (tailLeft < 2) break;
        const quota = Math.min(share, tailLeft);
        const spent = await this.readRunningTails(r.id, r.run, quota);
        tailLeft -= spent;
        this.budget -= spent;
        served++;
      }
      this.runCursor = (this.runCursor + Math.max(1, served)) % running.length;
      for (const r of order) await this.readMetas(r.id, r.run);
      for (const r of order) await this.readDoneAgents(r.id, r.run);
      for (const r of running) {
        const { id, run } = r;
        const name = await this.nameOf(id, run);
        const phases = await this.phasesOf(id, run);
        run.view = runningView({
          id, name, fold: run.fold, phases, startedAt: startedAt.get(id) ?? null, meta: run.meta, unread: r.unread,
          tokens: new Map([...run.tokens].map(([a, t]) => [a, t.tokens])),
        });
        views.push(run.view);
      }
    }
    return { kind: 'read', workflows: selectRows(views, now) };
  }

  /** The cheap verdicts and the journal; a running run is finished by `read`. */
  private async decideAndFold(id: string, run: RunCache, proc: Proc, now: number): Promise<{ kind: 'view'; view: WorkflowView | null } | { kind: 'running'; unread: boolean }> {
    const held = (view: WorkflowView | null) => ({ kind: 'view' as const, view });
    // A run already ruled finished-and-dropped or interrupted is not re-read
    // every tick: only every RESTAT_EVERY-th, to catch a resume in place. An
    // never-decided one waits on the same cadence while the process stays unmeasured.
    const quiet = run.decision === 'interrupted' || (run.decision === 'undecided' && proc.kind === 'unmeasured')
      || (run.decision === 'finished' && run.view === null);
    if (quiet && this.tick - run.statTick < RESTAT_EVERY) return held(run.view);
    run.statTick = this.tick - run.stagger; // brought forward once, then every RESTAT_EVERY
    run.stagger = 0;

    const [journal, summary] = await Promise.all([
      this.io.statMeasured(path.join(this.runDir(id), 'journal.jsonl')),
      this.io.statMeasured(this.summaryPath(id)),
    ]);
    // A stat that did not answer measured nothing: hold what this run showed.
    if (!journal.ok) return held(journal.reason === 'absent' ? null : run.view);
    if (!summary.ok && summary.reason === 'unreadable') return held(run.view);
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
    if (decision === 'undecided') {
      // Only a run never decided is quieted: one already showing keeps being
      // asked every tick, so its row moves again the moment the process answers.
      if (run.decision === null) run.decision = 'undecided';
      return held(run.view);
    }
    run.decision = decision;
    if (decision === 'interrupted') { run.view = null; return held(null); }
    if (decision === 'finished') { run.view = await this.finishedView(id, run, now); return held(run.view); }

    // Running: read what was appended.
    const unread = !(await this.readJournal(id, run, journal.size));
    // A chunk that did not read this pass: the row this run showed stands (a
    // dropped round trip must not flicker the counts); a run never shown says
    // its counts are unread instead of drawing zeros.
    if (unread && run.view !== null && run.view.state === 'running') return held(run.view);
    return { kind: 'running', unread };
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

  /** Running agents' tokens and activity, at most `quota` reads; returns the
   *  reads spent. Taken ROUND-ROBIN from where the last tick stopped: with
   *  more running agents than one share, a fixed order spent every tick on
   *  the same ones and left the rest unmeasured for the run's life. */
  private async readRunningTails(id: string, run: RunCache, quota: number): Promise<number> {
    const running = [...run.fold.keys.values()].filter((k) => k.last === 'started').sort((a, b) => a.seq - b.seq);
    if (running.length === 0) return 0;
    const from = run.cursor % running.length;
    let spent = 0;
    let visited = 0;
    for (const k of [...running.slice(from), ...running.slice(0, from)]) {
      if (quota - spent <= 0) break;
      visited++;
      const held = run.tokens.get(k.agentId);
      const file = path.join(this.runDir(id), `agent-${k.agentId}.jsonl`);
      const st = await this.io.statMeasured(file);
      spent++;
      if (!st.ok) continue;
      run.activity.set(k.agentId, st.mtimeMs);
      if (held !== undefined && held.size === st.size) continue;
      if (quota - spent <= 0) { visited--; break; } // the tail is next tick's, from this agent
      const offset = Math.max(0, st.size - TAIL_BYTES);
      const tail = await this.io.readFileFromBytesMeasured(file, offset, Math.max(1, Math.min(TAIL_BYTES, st.size - offset)));
      spent++;
      if (!tail.ok) continue;
      const measured = lastUsageTokens(new TextDecoder().decode(tail.bytes));
      // No usage line in the tail keeps the previous reading (an agent mid-tool
      // writes long tool results); there was none before → unmeasured.
      run.tokens.set(k.agentId, { size: st.size, tokens: measured ?? held?.tokens ?? null, final: false });
    }
    run.cursor = from + visited;
    return spent;
  }

  /** Labels for journal lines written before 2.1.265: one meta read each, ever. */
  private async readMetas(id: string, run: RunCache): Promise<void> {
    for (const k of run.fold.keys.values()) {
      if (this.budget <= 0) return;
      if (k.label !== null || run.metaTried.has(k.agentId)) continue;
      run.metaTried.add(k.agentId);
      const r = await this.io.readFileMeasured(path.join(this.runDir(id), `agent-${k.agentId}.meta.json`));
      this.budget--;
      const m = r.ok ? parseAgentMeta(r.content) : null;
      if (m !== null) run.meta.set(k.agentId, m);
    }
  }

  /** A done agent's last tokens, read once after its key ended (newest first).
   *  A 64 KB tail with no usage line walks back in capped chunks, at most
   *  WALKBACK_CHUNKS, before the agent is ruled unmeasurable. */
  private async readDoneAgents(id: string, run: RunCache): Promise<void> {
    const done = [...run.fold.keys.values()].filter((k) => k.last !== 'started').sort((a, b) => b.seq - a.seq);
    for (const k of done) {
      if (this.budget <= 0) return;
      const held = run.tokens.get(k.agentId);
      if (held?.final === true) continue;
      const file = path.join(this.runDir(id), `agent-${k.agentId}.jsonl`);
      const st = await this.io.statMeasured(file);
      this.budget--;
      if (!st.ok) continue;
      if (held !== undefined && held.size === st.size && held.tokens !== null) { held.final = true; continue; }
      const measured = await this.lastTokensOf(file, st.size);
      if (measured === undefined) return; // out of budget mid-read: this agent again next tick
      run.tokens.set(k.agentId, { size: st.size, tokens: measured ?? held?.tokens ?? null, final: true });
    }
  }

  /** The last usage line's tokens, walking back from EOF: null when there is
   *  none within the bound, undefined when the budget ran out first. */
  private async lastTokensOf(file: string, size: number): Promise<number | null | undefined> {
    let end = size;
    let head = new Uint8Array(0); // the cut first line of the segment read last
    for (let i = 0; i <= WALKBACK_CHUNKS && end > 0; i++) {
      if (this.budget <= 0) return undefined;
      const want = i === 0 ? TAIL_BYTES : READ_FROM_MAX_BYTES;
      const start = Math.max(0, end - want);
      const r = await this.io.readFileFromBytesMeasured(file, start, Math.max(1, end - start));
      this.budget--;
      if (!r.ok) return null;
      const bytes = new Uint8Array(r.bytes.length + head.length);
      bytes.set(r.bytes, 0);
      bytes.set(head, r.bytes.length);
      const measured = lastUsageTokens(new TextDecoder().decode(bytes));
      if (measured !== null) return measured;
      const nl = r.bytes.indexOf(10);
      head = nl < 0 ? bytes : bytes.slice(0, nl + 1);
      end = start;
    }
    return null;
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
