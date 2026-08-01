import type { Deps } from './server.js';
import type { Bus } from './bus.js';
import { assembleFleet } from './fleet.js';
import { readRegistry } from './registry.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { parseStatusline, type Statusline } from './pane/statusline.js';
import { defaultCachePath, saveSnapshot } from './fleetstate.js';
import { readTasks, taskProgress } from './tasks/read.js';
import { CCD_ARGV, verbSupported } from './ccdargv.js';
import { isFullLine, parsePrLines, phaseFor, type CcdPrFailure } from './prstate.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import type { SessionRecord } from './registry.js';
import type { PrState, SessionStatus, TaskProgress } from '../../shared/api.js';

/** Task sweeps read every task file of every session, so they run on their own
 *  slower clock than the 2 s pane poll — a plan advances on the scale of
 *  minutes, and the fleet chip is a glance, not a readout. The open session's
 *  own stream reads its list every tick, so the screen you're looking at stays
 *  live regardless. */
const TASK_SWEEP_MS = 10_000;

/** The third lane. 8 projects x 1 call / 120 s is ~240 GraphQL calls an hour
 *  against a 5000/hr budget with ~4900 free — about 5%. Measured latency
 *  0.51-0.69 s per call. */
const PR_SWEEP_MS = 120_000;
const PR_SWEEP_ACTIVE_MS = 30_000;      // any project with an open PR whose checks are pending
const PR_BACKOFF_MAX_MS = 900_000;
/** How long one sweep may be in flight before the next is allowed to start
 *  anyway. In local mode `realRunner` passes NO timeout to `execFile`
 *  (`exec.ts:6-12`), so nothing bounds the awaited `ccd` call and a wedged `gh`
 *  would otherwise hold the single-flight latch for the process's lifetime —
 *  the cap would never update again and there would be no error anywhere to say
 *  why. Same 15 minutes as the backoff ceiling: far longer than any real sweep
 *  (measured 0.51-0.69 s per project call), short enough that wedged is not
 *  permanent. */
const PR_SWEEP_STUCK_MS = PR_BACKOFF_MAX_MS;

const UNCHECKED_PR: PrState = {
  phase: 'unchecked', number: null, url: null, title: null, checks: null, checkNames: null,
  ahead: 0, reason: null, checkedAt: null, mergedAt: null, retryAt: null,
};

/**
 * Polls the fleet: captures every registered pane to detect menu dialogs
 * (emitting `session:<id>` dialog / dialog_cleared messages on change), then
 * emits 'fleet' on the bus only when the assembled JSON changed.
 *
 * In remote mode, every poll taken while actually connected also persists a
 * snapshot to the degraded-mode cache (fleetstate.ts) — skipped while
 * disconnected so a stretch of empty/partial reads never clobbers the last
 * known good snapshot `/api/fleet` falls back to.
 */
export class FleetWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastJson: string | null = null;
  /** Last-reported dialog id per session id. */
  private dialogIds = new Map<string, string>();
  /** Last-seen model/effort/ultracode/branch per live session (from the pane). */
  private statuslines = new Map<string, Statusline>();
  /** Prior status per session — drives the busy→idle push. */
  private prevStatus = new Map<string, SessionStatus>();
  /** Last swept task progress per session id, and when the sweep ran. */
  private taskProgress = new Map<string, TaskProgress>();
  private lastTaskSweep = 0;
  /** Last-swept PR state per SESSION id. */
  private prStates = new Map<string, PrState>();
  /** Per-PROJECT backoff after a failed read: one repo failing must not slow
   *  or silence the other seven. */
  private prBackoff = new Map<string, { until: number; step: number }>();
  private lastPrSweep = 0;
  /** Epoch ms the in-flight sweep started, or 0 when none is. A TIMESTAMP, not
   *  a boolean: see `PR_SWEEP_STUCK_MS`. */
  private prSweepStartedAt = 0;
  /** The first tick primes dialog/status state WITHOUT firing pushes, so a ccrc
   *  restart doesn't notify for every already-pending dialog / idle session. */
  private primed = false;
  private readonly cachePath: string;

  constructor(private deps: Deps, private bus: Bus, private intervalMs = 2000, cachePath?: string) {
    this.cachePath = cachePath ?? deps.stateCachePath ?? defaultCachePath();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * The set of session ids that currently have a pending menu dialog. Exposed
   * so a one-shot fleet assembly (the /api/fleet REST + the initial /ws/fleet
   * push on connect) can reflect an ALREADY-pending dialog. Without this, a
   * dialog that appeared before a client connected shows no "needs you" marker
   * on the fleet overview: the initial push omits it and the watcher only
   * re-emits 'fleet' when the JSON *changes*, so an unchanged pending state is
   * never resent to the newcomer.
   */
  currentPending(): Set<string> {
    return new Set(this.dialogIds.keys());
  }

  /** Last-seen statuslines — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so model/effort/ultracode/branch show immediately,
   *  same reasoning as currentPending(). */
  currentStatuslines(): Map<string, Statusline> {
    return new Map(this.statuslines);
  }

  /** Last-swept plan progress — same reasoning as currentPending(). */
  currentTaskProgress(): Map<string, TaskProgress> {
    return new Map(this.taskProgress);
  }

  /** Last-swept PR state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so the cap is right immediately rather than two
   *  minutes late. Same reasoning as currentPending(). */
  currentPrStates(): Map<string, PrState> {
    return new Map(this.prStates);
  }

  async tick(): Promise<void> {
    const pending = await this.detectDialogs(this.primed);
    await this.sweepTasks();
    // NEVER awaited: it shells out over the network and `gh` has no
    // --timeout, so awaiting it would stall the dialog detector and the
    // busy->idle push behind GitHub's reachability.
    void this.sweepPr().catch(() => { /* one bad sweep must not kill the poll */ });
    const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines, this.taskProgress, this.prStates);
    // Push on a busy→idle finish (a session completed a turn). Skip the priming
    // tick — otherwise a restart notifies for every currently-idle session.
    if (this.primed && this.deps.push) {
      for (const s of sessions) {
        if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
          void this.deps.push.notify({ title: `✓ ${s.project}`, body: 'Finished — back to idle', sessionId: s.id, tag: `idle-${s.id}` });
        }
      }
    }
    for (const s of sessions) this.prevStatus.set(s.id, s.status);
    this.primed = true;
    if (this.deps.cfg.fleetMode === 'remote' && this.deps.fleetState?.connected) {
      try { await saveSnapshot(sessions, this.cachePath); } catch { /* best-effort cache — never blocks the poll */ }
    }
    const json = JSON.stringify(sessions);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.bus.emit('fleet', sessions);
  }

  /**
   * Refresh every session's plan progress, at most once per TASK_SWEEP_MS. The
   * map is rebuilt from the registry each sweep, so a de-registered session's
   * progress can't linger.
   */
  private async sweepTasks(): Promise<void> {
    const now = Date.now();
    if (this.lastTaskSweep !== 0 && now - this.lastTaskSweep < TASK_SWEEP_MS) return;
    this.lastTaskSweep = now;
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    const next = new Map<string, TaskProgress>();
    await Promise.all(
      records.map(async (r) => {
        const cfgDir = this.deps.cfg.wrappers[r.wrapper];
        if (!cfgDir) return;
        const p = taskProgress(await readTasks(this.deps.io, cfgDir, r.uuid));
        if (p) next.set(r.id, p);
      }),
    );
    this.taskProgress = next;
  }

  /**
   * One `ccd pr-state --project <p>` per project with at least one workspace,
   * then a LEVEL evaluation of the archive condition. Level, not edge: there
   * is no prevPhase file and no "did we see the transition" flag, because the
   * producer and the consumer are different processes on different boxes with
   * no acknowledgement — a partial sweep killed at the outer timeout, an agent
   * disconnect or a busy-skip would destroy the edge permanently and strand
   * the workspace in a state the UI claims was archived. `ws-archive` is
   * idempotent, so retrying every 120 s is free and self-healing.
   */
  private async sweepPr(): Promise<void> {
    const now = Date.now();
    // Single-flight, but never permanently. A sweep still running after
    // PR_SWEEP_STUCK_MS is abandoned — not cancelled, there is nothing to
    // cancel; it is simply no longer allowed to hold the lane shut.
    if (this.prSweepStartedAt !== 0 && now - this.prSweepStartedAt < PR_SWEEP_STUCK_MS) return;
    // The same guard tick() already applies before saveSnapshot: with the
    // agent down there is nothing to read and every state keeps its checkedAt.
    if (this.deps.cfg.fleetMode === 'remote' && !this.deps.fleetState?.connected) return;
    const anyPending = [...this.prStates.values()].some((s) => s.phase === 'open' && s.checks === 'pending');
    const due = anyPending ? PR_SWEEP_ACTIVE_MS : PR_SWEEP_MS;
    if (this.lastPrSweep !== 0 && now - this.lastPrSweep < due) return;
    this.lastPrSweep = now;
    const mySweep = now;
    this.prSweepStartedAt = mySweep;
    try {
      const records = await readRegistry(this.deps.io, this.deps.cfg);
      const projects = [...new Set(records.filter((r) => r.workspace !== null).map((r) => r.project))];
      for (const project of projects) {
        const back = this.prBackoff.get(project);
        if (back && now < back.until) continue;
        const argv = CCD_ARGV.prStateProject(project);
        if (!verbSupported(this.deps.fleetState, argv)) {
          for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
            // retryAt: null — an unsupported verb is not a scheduled retry, and a
            // stale `until` from an earlier backoff must not survive as a promise.
            this.prStates.set(r.id, { ...(this.prStates.get(r.id) ?? UNCHECKED_PR), phase: 'unknown', reason: 'unsupported', retryAt: null });
          }
          continue;
        }
        const res = await this.deps.runCcd(argv);
        if (!res.ok) { this.backoffPr(project, now, 'agent-down', records); continue; }
        const lines = parsePrLines(res.stdout);
        // A WHOLE-REPO failure — the id-less shape, emitted by `_gh_repo_slug`,
        // `_gh_pr_list`, and `_pr_py` for an unparseable rc-0 body — really
        // does mean every session of this repo is unreadable (each is one gh
        // answer for the whole repo), so it backs the project off. Note the
        // unparseable-body case emits one id-less object PER SESSION in a
        // --project sweep; `find` taking the first is correct because they all
        // describe the same repo-wide fact. A PER-SESSION failure
        // carries an `id` and must not: one workspace whose registry lost its
        // `branch` is one broken session, and §6's "Partial sweep" row promises
        // its seven siblings keep their own answers.
        const failure = lines.find((l) => !('id' in l)) as CcdPrFailure | undefined;
        if (failure !== undefined) { this.backoffPr(project, now, failure.reason, records); continue; }
        this.prBackoff.delete(project);
        for (const line of lines) {
          if (!isFullLine(line)) {
            // Greyed alone, and NEVER passed to phaseFor: it has no `rows`, so
            // `boundRow(undefined, …)` would throw inside this void-dispatched
            // sweep and lose every project after this one.
            //
            // The id-LESS shape already backed the project off and `continue`d
            // above, so anything reaching here carries an id — but the union
            // still admits CcdPrFailure, so NARROW rather than assert: a cast
            // here would be the same "trust the shape" move that made
            // discriminating on `id` wrong in the first place.
            if (!('id' in line)) continue;
            this.prStates.set(line.id, { ...(this.prStates.get(line.id) ?? UNCHECKED_PR), phase: 'unknown', reason: line.reason, retryAt: null });
            continue;
          }
          this.prStates.set(line.id, phaseFor(line));
        }
      }
      await this.archiveMerged(records);
    } finally {
      // Only the CURRENT sweep may clear the stamp. An abandoned sweep that
      // finally returns half an hour later must not unlatch the one that
      // replaced it — `lastPrSweep` gating makes two starts in the same
      // millisecond impossible, so the timestamp is a sufficient identity.
      if (this.prSweepStartedAt === mySweep) this.prSweepStartedAt = 0;
    }
  }

  /** A failed read never overwrites a good phase — only greys it — and an
   *  unauthenticated lane jumps straight to the ceiling, because retrying a
   *  revoked token every two minutes buys nothing. */
  private backoffPr(project: string, now: number, reason: PrState['reason'], records: SessionRecord[]): void {
    const prev = this.prBackoff.get(project);
    const step = reason === 'unauthenticated' || reason === 'rate-limit'
      ? PR_BACKOFF_MAX_MS
      : Math.min((prev?.step ?? PR_SWEEP_MS) * 2, PR_BACKOFF_MAX_MS);
    this.prBackoff.set(project, { until: now + step, step });
    for (const r of records.filter((x) => x.project === project && x.workspace !== null)) {
      const keep = this.prStates.get(r.id) ?? UNCHECKED_PR;
      // `retryAt` is `until` on the wire. §6's rate-limit row promises reason AND
      // retry time, and a 15-minute flat backoff with neither is indistinguishable
      // from a cap that has simply stopped working.
      this.prStates.set(r.id, { ...keep, phase: 'unknown', reason, retryAt: now + step });
    }
  }

  /**
   * `'ok' | 'busy' | 'attached' | 'unknown'`, and it MUST NOT collapse
   * `unknown` to idle. `liveStatus` answers `'idle'` when the pid or the
   * config dir is missing or the status file is unreadable, and in remote mode
   * both of those reads cross the agent WS — so a socket hiccup reads as "not
   * working". Archive needs an AFFIRMATIVE idle.
   */
  async archiveSafety(id: string): Promise<'ok' | 'busy' | 'attached' | 'unknown'> {
    if (this.bus.listenerCount(`session:${id}`) > 0) return 'attached';
    const rec = (await readRegistry(this.deps.io, this.deps.cfg)).find((r) => r.id === id);
    if (!rec) return 'unknown';
    if (!(await this.deps.tmux.hasSession(id))) return 'ok';   // no pane: nothing is running
    const pid = await this.deps.tmux.panePid(id);
    const cfgDir = this.deps.cfg.wrappers[rec.wrapper];
    if (!pid || !cfgDir) return 'unknown';
    const live = await readLiveState(this.deps.io, cfgDir, pid);
    if (!live) return 'unknown';
    return liveSessionStatus(live.status) === 'busy' ? 'busy' : 'ok';
  }

  private async archiveMerged(records: SessionRecord[]): Promise<void> {
    for (const r of records) {
      const pr = this.prStates.get(r.id);
      if (r.workspace === null || r.archivedAt !== null) continue;
      if (pr?.phase !== 'merged') continue;                 // unknown NEVER archives
      if ((await this.archiveSafety(r.id)) !== 'ok') continue;   // defers; the next sweep retries
      const res = await this.deps.runCcd(CCD_ARGV.wsArchive(r.id));
      if (!res.ok) continue;
      if (res.stdout.startsWith('already archived')) continue;   // idempotent re-fire: no second push
      // AFTER the fact, and it promises only navigation: PushPayload is
      // {title, body, sessionId?} and push-sw.js passes no actions[].
      void this.deps.push?.notify({
        title: `✓ merged · ${r.project} › ${r.workspace}`,
        body: `PR #${pr.number ?? '?'} merged; workspace archived, nothing deleted.`,
        sessionId: r.id, tag: `merged-${r.id}`,
      });
    }
  }

  /**
   * Capture each registered session's pane (dead panes capture as null); a menu
   * pane parses to a dialog. Emit `dialog` when the id changed since last tick,
   * `dialog_cleared` when a previously-reported dialog vanished. Returns the
   * set of session ids with a dialog pending, for the fleet assembly.
   *
   * The id alone is the right gate HERE, unlike the per-session stream's
   * (`nextDialogFrame`): this sweep only ever sees the bare pane parse, and its
   * `dialog` emission is consumed for the push notification and the fleet's
   * dialogPending flag — the open session's own stream owns the frame the client
   * renders, and drops these (`sessionws.ts` onSessionMsg). Enrich the parse here
   * and this gate needs the same upgrade path.
   */
  private async detectDialogs(notify: boolean): Promise<Set<string>> {
    const pending = new Set<string>();
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of records) {
      const pane = await this.deps.tmux.capture(r.id);
      // Same capture feeds the statusline read — no extra tmux call. A tick
      // whose pane has no statusline (a dialog/permission overlay covers it, or
      // the session is mid-render) must NOT blank the last-known model/branch —
      // only update when we actually parsed something; drop only on a dead pane.
      if (pane === null) this.statuslines.delete(r.id);
      else {
        const sl = parseStatusline(pane);
        if (sl.model || sl.branch || sl.effort) this.statuslines.set(r.id, sl);
      }
      const dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
      const last = this.dialogIds.get(r.id);
      if (dialog) {
        pending.add(r.id);
        if (last !== dialog.id) {
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
          if (notify && this.deps.push) {
            void this.deps.push.notify({
              title: `❓ ${r.project}`, body: dialog.title || 'Claude has a question',
              sessionId: r.id, tag: `dialog-${r.id}`,
            });
          }
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }
}
