// L3 adapter (C3 Session Conversation): every read below calls the FleetIO port. Its imports alone (a type import of the
// port) would read L1, so this header says L3 (spec 2026-11-19-session-helpers-design Table 12; session helpers H1b, D-8862).
//
// The session's workflows, read where Claude Code keeps them (D-5561): one
// instance per session socket and session dir, holding what it has read so a
// 2 s tick costs a listing, a few stats and only the bytes appended since.
// Since H1b it reads the session's Agent helpers too (`SessionHelpers`, below), by id, in a tier of their own.
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
import { walkBack } from '../backread.js';
import { READ_FROM_MAX_BYTES } from '../../../shared/agent-protocol.js';
import { isFinalHelperState, isHelperId, type AgentHelperState, type HelperReportAnswer, type WorkflowView } from '../../../shared/workflows.js';
import type { HelperFact } from '../transcript/parse.js';
import {
  decideAgentHelpers,
  emptyHelperMemory,
  foldHelperFacts,
  boundReports,
  holdReports,
  isAgentHelper,
  isFinishedKept,
  keepWorkflows,
  reportAnswer,
  type HeldReport,
  isWorkflowAgentName,
  lastLineTime,
  parseHelperMeta,
  seenDrops,
  type AgentArm,
  type HelperIdFacts,
  type HelperMemory,
  type HelperMeta,
  type RosterInput,
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
  splitLines,
  summaryView,
  workflowLastActivity,
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
/** The reads of a done agent's walk: the tail, then WALKBACK_CHUNKS capped chunks. */
const WALK_SIZES: readonly number[] = [TAIL_BYTES, ...Array<number>(WALKBACK_CHUNKS).fill(READ_FROM_MAX_BYTES)];

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
  /** H2 (D-8872): finished runs with no readable end time already drawn once (`keepWorkflows`' memory). */
  private noEndShown: ReadonlySet<string> = new Set();

  /** H1b: the session's Agent helpers, read beside its workflows and rebuilt with them when the session dir changes. */
  private readonly helpers: SessionHelpers;

  constructor(private readonly io: FleetIO, readonly sessionDir: string) {
    this.helpers = new SessionHelpers(io, sessionDir);
  }

  /** One reading of the session's helpers (H1b, D-8862; spec §3.1): the workflow arm, whose missing directory answers
   *  `absent` at once, and the Agent arm, which runs regardless, each in its own budget. */
  async readAll(proc: Proc, now: number, agents: { roster: RosterInput; facts: readonly HelperFact[] }): Promise<{ workflows: WorkflowsRead; helpers: HelpersRead }> {
    const workflows = await this.read(proc, now);
    return { workflows, helpers: await this.helpers.read({ ...agents, proc, now }) };
  }

  /** H2 (D-8872): the answer to a `helper-report` request, from what the last reading held and drew. */
  reportOf(id: string): HelperReportAnswer | null { return this.helpers.reportOf(id); }

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
        run.view = {
          ...runningView({
            id, name, fold: run.fold, phases, startedAt: startedAt.get(id) ?? null, meta: run.meta, unread: r.unread,
            tokens: new Map([...run.tokens].map(([a, t]) => [a, t.tokens])),
          }),
          lastActivityAt: workflowLastActivity(run.journalMtime, run.fold, run.activity),
        };
        views.push(run.view);
      }
    }
    const kept = keepWorkflows(views, now, this.noEndShown);
    this.noEndShown = kept.noEndShown;
    return { kind: 'read', workflows: kept.rows };
  }

  /** The cheap verdicts and the journal; a running run is finished by `read`. */
  private async decideAndFold(id: string, run: RunCache, proc: Proc, now: number): Promise<{ kind: 'view'; view: WorkflowView | null } | { kind: 'running'; unread: boolean }> {
    const held = (view: WorkflowView | null) => ({ kind: 'view' as const, view });
    // A run already ruled finished (kept or dropped) or interrupted is not re-read
    // every tick: only every RESTAT_EVERY-th, to catch a resume in place. A kept
    // finished run is held as read, and `keepWorkflows` drops it at its end time
    // plus the keep, so it costs no stat per reading (H2, D-8872; review 2900 F5).
    // A never-decided one waits on the same cadence while the process stays unmeasured.
    const quiet = run.decision === 'interrupted' || (run.decision === 'undecided' && proc.kind === 'unmeasured')
      || run.decision === 'finished';
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
    const activity = workflowLastActivity(journal.mtimeMs, run.fold, run.activity);
    const decision = decideRun({ summaryMtime: run.summaryMtime, journalMtime: journal.mtimeMs, activityMtime: activity, proc });
    if (decision === 'undecided') {
      // Only a run never decided is quieted: one already showing keeps being
      // asked every tick, so its row moves again the moment the process answers.
      if (run.decision === null) run.decision = 'undecided';
      return held(run.view);
    }
    run.decision = decision;
    if (decision === 'interrupted') { run.view = null; return held(null); }
    if (decision === 'finished') {
      const view = await this.finishedView(id, run, now);
      run.view = view === null ? null : { ...view, lastActivityAt: activity };
      return held(run.view);
    }

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
    const walk = walkBack(this.io, file, size, WALK_SIZES);
    while (walk.more()) {
      if (this.budget <= 0) return undefined;
      const r = await walk.next();
      this.budget--;
      if (!r.ok) return null;
      const measured = lastUsageTokens(new TextDecoder().decode(r.segment.bytes));
      if (measured !== null) return measured;
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

  /** A finished run's row while the keep may still hold it; null after, and the summary is never read for a run that
   *  finished before that. The summary's mtime is never earlier than the end it records (it is written at the end), so a
   *  run `isFinishedKept` drops at its mtime is dropped at its end too: the keep's one clock decides (H2, D-8872), and
   *  `keepWorkflows` rules on the row's own end time. */
  private async finishedView(id: string, run: RunCache, now: number): Promise<WorkflowView | null> {
    const at = run.summaryMtime!;
    if (!isFinishedKept(at, now)) return null;
    const facts = await this.summaryOf(id, run);
    // A summary that is not one (torn mid-write, or a status outside the three)
    // has no state to show: the row waits for the next pass rather than guessing.
    if (facts === null) return null;
    return summaryView(id, facts, at, scriptNameFor(await this.scriptEntries(), id));
  }
}

// ---------------------------------------------------------------------------
// Session helpers H1b (D-8862; spec 2026-11-19-session-helpers-design §3.1, §5 "The helper tier").

/** The Agent helpers' read budget per reading, their own beside the workflows' `AGENT_READS_PER_TICK`, so neither starves
 *  the other. A stat and a read each count one. */
export const HELPER_READS_PER_TICK = 12;
/** The most helper facts a stream holds between two readings, the oldest dropped first (the fold keeps `HELPER_FACTS_MAX`
 *  ids; this bounds only a stream whose readings stopped while its tailer ran on). */
export const HELPER_FACTS_PENDING_MAX = 1024;

export interface HelperReadInput {
  roster: RosterInput;
  /** The helper facts the tailer and the backlog gave since the last reading. */
  facts: readonly HelperFact[];
  proc: Proc;
  now: number;
}

export interface HelpersRead {
  arm: AgentArm;
  /** The tier rotated: `refreshed` of the `of` helpers not final had their transcript looked at; null when every one was. */
  readEvery: { refreshed: number; of: number } | null;
}

interface HelperCache {
  /** The meta as last read: its facts, or null (absent, unreadable, or not a meta). */
  meta: ReturnType<typeof parseHelperMeta>;
  /** The meta file's size and mtime at its last stat, null until one; the reading of that read or stat. */
  metaStat: { size: number; mtimeMs: number } | null;
  /** A changed stat was measured but its read did not fit. Take that read before the next stat. */
  metaReadPending: boolean;
  metaTick: number;
  /** The transcript's size at its last read, null until one. */
  size: number | null;
  lastWriteAt: number | null;
  tokens: number | null;
  /** Its last write has been read since it last grew (or it could not be read): a `finished` meta may now decide (F10c). */
  lastWriteKnown: boolean;
}

/**
 * The session's Agent helpers, read BY ID: never a listing of `subagents/`, which piles up over a session's life. One
 * instance per session dir and stream, holding what it has read. Each reading spends at most `HELPER_READS_PER_TICK`, in
 * the spec's order (§5): (1) a meta read for each id first known (a roster entry named `workflow-subagent` is ruled out
 * without one); (2) a meta read for each drop this reader saw (`seenDrops`, the decision's own witness); (3) for each
 * helper not final, a stat of its transcript and, when it grew, a read of the new bytes, at most `TAIL_BYTES`, rotated so the
 * ones left unread come first next time; (4) a due meta stat or read, oldest first, also for a listed id still missing its
 * meta; (5) one attempt at the last write for a final helper or a `finished` meta. When due, steps 4 and 5 reserve one and
 * two calls. A changed meta stat without room to read is saved and the read is first in step 4 next time. A `finished` meta
 * is held until the last-write attempt (successful or not), so the row is not drawn without its time and then drawn again
 * (reviews 2961 F10c and 3014 F1/F2). `decideAgentHelpers` decides; this class measures and carries.
 */
export class SessionHelpers {
  private facts: Map<string, HelperIdFacts> = new Map();
  /** H2 (D-8872): the reports of the fold's own end facts (`model.ts#holdReports`), bounded by `boundReports`. */
  private reports: ReadonlyMap<string, HeldReport> = new Map();
  /** The rows the last reading drew: a report is answered only for one of them (`model.ts#reportAnswer`); null until this
   *  reader's first reading, when it has read no id yet. */
  private drawn: AgentArm['agents'] | null = null;
  private memory: HelperMemory = emptyHelperMemory();
  private readonly cache = new Map<string, HelperCache>();
  /** Each id's state at the last decision: what "not final" means for the tier. */
  private last = new Map<string, AgentHelperState>();
  private tick = 0;
  private cursor = 0;

  constructor(private readonly io: FleetIO, readonly sessionDir: string) {}

  private file(id: string, ext: '.meta.json' | '.jsonl'): string { return path.join(this.sessionDir, 'subagents', `agent-${id}${ext}`); }

  async read(i: HelperReadInput): Promise<HelpersRead> {
    this.tick++;
    let budget = HELPER_READS_PER_TICK;
    this.facts = foldHelperFacts(this.facts, i.facts);
    this.reports = holdReports(this.reports, i.facts, this.facts);
    const entries = i.roster.kind === 'usable' ? i.roster.entries : [];
    const nameOf = new Map<string, string>();
    for (const e of entries) if (isHelperId(e.id)) nameOf.set(e.id, e.name);
    const listed = [...nameOf].filter(([, name]) => !isWorkflowAgentName(name)).map(([id]) => id);
    const launched = [...this.facts].filter(([, f]) => f.launch !== null).map(([id]) => id);
    const noticed = [...this.facts.keys()];
    const isAgent = (id: string): boolean => isAgentHelper(this.facts.get(id), this.metaOf(id), nameOf.get(id));
    const isFinal = (id: string): boolean => {
      const was = this.last.get(id);
      if (was !== undefined) return isFinalHelperState(was);
      return this.facts.get(id)?.end != null || this.cache.get(id)?.meta?.finished === true;
    };

    const needsMeta = ([id, c]: [string, HelperCache]): boolean =>
      ((isAgent(id) && !isFinal(id)) || (c.meta === null && listed.includes(id)))
      && (c.metaReadPending || this.tick - c.metaTick >= RESTAT_EVERY);
    const needsLastWrite = ([id, c]: [string, HelperCache]): boolean =>
      !c.lastWriteKnown && isAgent(id) && (isFinal(id) || c.meta?.finished === true);
    const finalReserve = (): number => [...this.cache].some(needsLastWrite) ? 2 : 0;
    // Reserve a meta call and a final stat+range if already due; a burst of discoveries or drops cannot take them.
    const reserve = (metas: boolean): number => Number(metas) + finalReserve();
    const earlyReserve = reserve([...this.cache].some(needsMeta));
    // (1) the ids first known, the roster's first, then the launches', then any other id a fact names.
    for (const id of new Set([...listed, ...launched, ...noticed])) {
      if (budget <= earlyReserve) break;
      if (!isHelperId(id) || this.cache.has(id)) continue;
      await this.readMeta(id);
      budget--;
    }
    // (2) the drops this reading saw.
    for (const id of seenDrops(this.memory, i.roster, i.proc)) {
      if (budget <= earlyReserve) break;
      if (!this.cache.has(id) || isFinal(id)) continue;
      await this.readMeta(id);
      budget--;
    }
    // (3) the transcripts of the helpers not final, rotated. Newly discovered final work can reserve space too.
    const metaDue = [...this.cache].filter(needsMeta).sort(([, a], [, b]) =>
      Number(b.metaReadPending) - Number(a.metaReadPending) || a.metaTick - b.metaTick);
    const keepForFinal = finalReserve();
    const keepAfterOpen = Number(metaDue.length > 0) + keepForFinal;
    const open = [...this.cache].filter((entry) => isAgent(entry[0]) && !isFinal(entry[0]) && !needsLastWrite(entry)).map(([id]) => id);
    const from = open.length === 0 ? 0 : this.cursor % open.length;
    let refreshed = 0;
    let visited = 0;
    for (const id of [...open.slice(from), ...open.slice(0, from)]) {
      if (budget <= keepAfterOpen) break;
      visited++;
      const c = this.cache.get(id)!;
      const st = await this.io.statMeasured(this.file(id, '.jsonl'));
      budget--;
      if (!st.ok || st.size === c.size) { refreshed++; continue; }
      if (budget <= keepAfterOpen) { c.lastWriteKnown = false; visited--; break; } // its transcript leads next reading
      if (await this.readTail(id, c, st.size, false)) budget--;
      refreshed++;
    }
    this.cursor = from + visited;
    // (4) the metas of the helpers not final (and of a listed id whose meta was not there yet), every RESTAT_EVERY readings.
    for (const [id, c] of metaDue) {
      if (budget <= keepForFinal) break;
      if (!c.metaReadPending) {
        const st = await this.io.statMeasured(this.file(id, '.meta.json'));
        budget--;
        if (!st.ok || (c.metaStat !== null && c.metaStat.size === st.size && c.metaStat.mtimeMs === st.mtimeMs)) { c.metaTick = this.tick; continue; }
        c.metaStat = { size: st.size, mtimeMs: st.mtimeMs };
        c.metaReadPending = true;
        if (budget <= keepForFinal) break; // next reading goes straight to the read, not the same stat
      }
      await this.readMeta(id);
      budget--;
    }
    // (5) a final helper's last write, attempted once.
    for (const entry of this.cache) {
      if (budget < 2) break;
      if (!needsLastWrite(entry)) continue;
      const [id, c] = entry;
      const st = await this.io.statMeasured(this.file(id, '.jsonl'));
      budget--;
      if (!st.ok) { this.markLastWriteUnreadable(c); continue; }
      if (await this.readTail(id, c, st.size, true)) budget--;
    }

    const metas = new Map<string, HelperMeta>();
    for (const [id, c] of this.cache) {
      if (c.meta === null) continue;
      metas.set(id, {
        path: 'agent', agentType: c.meta.agentType, description: c.meta.description, model: c.meta.model, effort: c.meta.effort,
        finished: c.meta.finished && c.lastWriteKnown, // HELD while its last write is unread (F10c)
        lastWriteAt: c.lastWriteAt, tokens: c.tokens,
      });
    }
    const arm = decideAgentHelpers({ now: i.now, roster: i.roster, proc: i.proc, facts: this.facts, metas, memory: this.memory });
    this.memory = arm.memory;
    this.drawn = arm.agents;
    this.reports = boundReports(this.reports, arm.agents);
    this.last = new Map(arm.agents.map((a) => [a.id, a.state]));
    // Forget an id nothing names any more: not listed, no fact, no row.
    for (const id of [...this.cache.keys()]) if (!nameOf.has(id) && !this.facts.has(id) && !this.last.has(id)) this.cache.delete(id);
    return { arm, readEvery: refreshed < open.length ? { refreshed, of: open.length } : null };
  }

  /** H2 (D-8872): the answer to a `helper-report` request for `id`; null before this reader's first reading, when it has
   *  read no id and so cannot say one was lost (review 3072 F4): the stream then sends nothing, and the PWA asks again. */
  reportOf(id: string): HelperReportAnswer | null { return this.drawn === null ? null : reportAnswer(this.reports, this.drawn, id); }

  private metaOf(id: string): { path: 'agent'; agentType: string | null } | undefined {
    const m = this.cache.get(id)?.meta;
    return m == null ? undefined : { path: 'agent', agentType: m.agentType };
  }

  private async readMeta(id: string): Promise<void> {
    const r = await this.io.readFileMeasured(this.file(id, '.meta.json'));
    const meta = r.ok ? parseHelperMeta(r.content) : null;
    const c = this.cache.get(id);
    if (c === undefined) {
      this.cache.set(id, { meta, metaStat: null, metaReadPending: false, metaTick: this.tick, size: null, lastWriteAt: null, tokens: null, lastWriteKnown: false });
      return;
    }
    if (meta?.finished === true && c.meta?.finished !== true) c.lastWriteKnown = false;
    if (r.ok || r.reason === 'absent') c.meta = meta; // an unreadable re-read keeps what was read
    c.metaReadPending = false;
    c.metaTick = this.tick;
  }

  private markLastWriteUnreadable(c: HelperCache): void {
    c.lastWriteAt = null;
    c.lastWriteKnown = true;
  }

  /** The new bytes, at most `TAIL_BYTES` from the end (all of them after a shrink). Returns whether it spent a call. */
  private async readTail(id: string, c: HelperCache, size: number, finalAttempt: boolean): Promise<boolean> {
    const offset = c.size === null || size < c.size ? Math.max(0, size - TAIL_BYTES) : Math.max(c.size, size - TAIL_BYTES);
    if (size - offset <= 0) { c.size = size; c.lastWriteKnown = true; return false; }
    const r = await this.io.readFileFromBytesMeasured(this.file(id, '.jsonl'), offset, size - offset);
    if (r.ok) {
      const text = new TextDecoder().decode(r.bytes);
      c.lastWriteAt = lastLineTime(text) ?? c.lastWriteAt;
      c.tokens = lastUsageTokens(text) ?? c.tokens;
      c.size = size;
      c.lastWriteKnown = true;
    } else if (finalAttempt) this.markLastWriteUnreadable(c);
    return true;
  }
}
