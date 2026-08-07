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
import { readHookState, type HookState } from './hookstate.js';
import { askActions } from './askkey.js';
import type { SessionRecord } from './registry.js';
import type { NotifyEvent, PrState, SessionStatus, TaskProgress } from '../../shared/api.js';
import { UNCHECKED_PR } from '../../shared/api.js';
import type { PushPayload } from './push.js';

/** Task sweeps read every task file of every session, so they run on their own
 *  slower clock than the 2 s pane poll — a plan advances on the scale of
 *  minutes, and the fleet chip is a glance, not a readout. The open session's
 *  own stream reads its list every tick, so the screen you're looking at stays
 *  live regardless. */
const TASK_SWEEP_MS = 10_000;

/** The fourth lane. A ccd install is a deliberate act by a human who is
 *  waiting, so a minute is the longest anyone should have to wonder whether
 *  the fleet noticed — and the agent's stat gate means an unchanged ccd costs
 *  a stat, not a bash process. */
const CAPS_REFRESH_MS = 60_000;

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

// `UNCHECKED_PR` was a local copy of the literal `PrKeycap.tsx` and
// `prstate.ts` each also held — integration finding 6. One definition now, in
// `shared/api.ts`, which is the only module all three sides can import.

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
  /**
   * Session id → the dialog id of an ask push that went out with NO actions,
   * still pending an envelope.
   *
   * The ask push is edge-triggered on the dialog id, and `parseDialog`'s id is
   * a hash of the menu's labels and title — it does not change as the cursor
   * moves — so without this latch a question whose hookstate landed a beat
   * after its pane (see the ordering note in `tick()`) could NEVER become
   * answerable from the phone: the appear-edge is spent, and nothing else
   * produces `kind:'ask'`. With it, the first tick that can prove the envelope
   * re-raises the same notification, in the same tag, now carrying its
   * options.
   */
  private actionlessAsks = new Map<string, string>();
  /**
   * `id#prNumber` keys already told "merged, held, nothing archived" — so
   * `archiveMerged`'s held branch fires that push ONCE per (workspace, PR)
   * rather than on every 2-minute sweep for as long as the hold stands.
   *
   * IN-MEMORY BY DESIGN, not a gap: a server restart forgets the latch and
   * may repeat the push, but `pushOne`'s tag is `merged-<id>` — the SAME
   * collapse key the real archive push uses — so the repeat REPLACES the
   * prior notification on the phone rather than stacking a duplicate. The
   * cost of losing this latch on restart is one redundant, silently-replaced
   * notification; persisting it would buy nothing back for that price.
   */
  private heldMergedNotified = new Set<string>();
  /** Last-seen model/effort/ultracode/branch per live session (from the pane). */
  private statuslines = new Map<string, Statusline>();
  /** Prior status per session — drives the busy→idle push. */
  private prevStatus = new Map<string, SessionStatus>();
  /** Last swept task progress per session id, and when the sweep ran. */
  private taskProgress = new Map<string, TaskProgress>();
  private lastTaskSweep = 0;
  /** Last-swept PR state per SESSION id. */
  private prStates = new Map<string, PrState>();
  /** Last-read hook state per session id (the fifth lane) — rebuilt every
   *  tick, same cadence as dialog detection: `readHookState` is a single
   *  local JSON read per session, cheap enough not to need its own slower
   *  clock the way task/PR sweeps do. */
  private hookStates = new Map<string, HookState>();
  /** Per-PROJECT backoff after a failed read: one repo failing must not slow
   *  or silence the other seven. */
  private prBackoff = new Map<string, { until: number; step: number }>();
  private lastPrSweep = 0;
  /** The fourth lane's clock. Starts at 0 so the first tick after start
   *  always refreshes — which is what recovers a server that connected to an
   *  agent whose boot-time caps read had already failed. */
  private lastCapsAt = 0;
  /** Epoch ms the in-flight sweep started, or 0 when none is. A TIMESTAMP, not
   *  a boolean: see `PR_SWEEP_STUCK_MS`. */
  private prSweepStartedAt = 0;
  /** The first tick primes dialog/status state WITHOUT firing pushes, so a ccrc
   *  restart doesn't notify for every already-pending dialog / idle session. */
  private primed = false;
  private readonly cachePath: string;
  /** The set of projects with at least one non-dead session, as of the last
   *  completed `tick()` — feeds `pushOne`'s "name the project only when more
   *  than one is active" rule. `detectDialogs` and `sweepPr`/`archiveMerged`
   *  run on their own clocks (the pane sweep runs before this tick's own
   *  `assembleFleet`; the PR sweep is a `void`-dispatched lane that can still
   *  be in flight ticks later) and neither has the current tick's session list
   *  in scope, so both read this cached, at-most-one-tick-stale set rather
   *  than recomputing the fleet — which `sweepPr` deliberately never does,
   *  since it must not block on `gh`. A push firing with last tick's project
   *  count is the honest cheap answer; the alternative (a fresh fleet read
   *  inside a lane that promises never to block) is not on offer.
   */
  private activeProjects = new Set<string>();

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

  /** Last-read hook state — passed into a one-shot fleet assembly (REST +
   *  initial /ws/fleet push) so an already-waiting hook state shows
   *  immediately. Same reasoning as currentPending(). */
  currentHookStates(): Map<string, HookState> {
    return new Map(this.hookStates);
  }

  async tick(): Promise<void> {
    // Read once, share with the two lanes that would otherwise each read it
    // again on EVERY tick (detectDialogs, sweepHookStates) — in remote mode
    // every readRegistry() field is its own agent-WS round trip, so this is
    // the difference between one registry read and two, every 2s, forever.
    // sweepTasks/sweepPr below are NOT included: both throttle to their own
    // slower clock and skip the read entirely on most ticks already.
    const records = await readRegistry(this.deps.io, this.deps.cfg);
    // hook states FIRST, dialogs second — the order is load-bearing and there
    // is a test on it. `detectDialogs` composes the ask push, and the actions
    // it attaches come from `this.hookStates`; with the old ordering that map
    // was always one tick behind, so whether a question arrived answerable
    // from the notification depended on how the 2-second poll happened to
    // straddle the hook's write. Sweeping first costs nothing (both lanes
    // share the one `records` read below).
    //
    // It NARROWS that window; it does not close it. The sweep reads a
    // session's hookstate at time s and `detectDialogs` captures its pane at
    // time c, sequentially, each capture an agent round trip in remote mode —
    // so for the last session of eight, c-s is a couple of hundred ms of a
    // 2000 ms tick. A `session-hook.sh` write landing inside (s, c) still
    // yields a menu with no envelope, and therefore an action-less ask push.
    // What covers the residue is `actionlessAsks` in `detectDialogs` below:
    // the latch remembers that push and amends it when the envelope turns up.
    await this.sweepHookStates(records);
    const pending = await this.detectDialogs(this.primed, records);
    await this.sweepTasks();
    // NEVER awaited: it shells out over the network and `gh` has no
    // --timeout, so awaiting it would stall the dialog detector and the
    // busy->idle push behind GitHub's reachability.
    void this.sweepPr().catch(() => { /* one bad sweep must not kill the poll */ });
    if (this.deps.refreshCaps && Date.now() - this.lastCapsAt >= CAPS_REFRESH_MS) {
      this.lastCapsAt = Date.now();
      // NEVER awaited: same reasoning as sweepPr immediately above — caps()
      // swallows its own failures today, but a wedged-yet-connected agent
      // must not stall assembleFleet behind an up-to-15s request timeout,
      // and a future implementation that DOES reject must not become an
      // unhandled rejection via start()'s `void this.tick()`.
      void this.deps.refreshCaps().catch(() => { /* one bad refresh must not kill the poll */ });
    }
    const sessions = await assembleFleet(this.deps.io, this.deps.cfg, this.deps.tmux, undefined, pending, this.statuslines, this.taskProgress, this.prStates, this.hookStates);
    // The whole fleet is in scope right here, which is exactly what
    // `pushOne`'s copy rule needs and `detectDialogs`/`sweepPr` below don't
    // have on their own clocks — see `activeProjects`'s own comment.
    const projects = new Set(sessions.filter((s) => s.status !== 'dead').map((s) => s.project));
    // Push on a busy→idle finish (a session completed a turn). Skip the priming
    // tick — otherwise a restart notifies for every currently-idle session.
    if (this.primed) {
      for (const s of sessions) {
        if (this.prevStatus.get(s.id) === 'busy' && s.status === 'idle') {
          this.pushOne({ kind: 'done', sessionId: s.id, project: s.project, title: '✓ Finished', body: 'Finished — back to idle' }, projects);
        }
      }
    }
    for (const s of sessions) this.prevStatus.set(s.id, s.status);
    this.activeProjects = projects;
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
   * Every push goes through here, so the copy rules are stated once.
   *
   *  - Project context ONLY when more than one project is active. The server
   *    knows the whole fleet at push time, so it can tell — and "✓ ccrc-pwa"
   *    on a fleet running one project is noise dressed as information.
   *  - NOTHING fires for a session the operator is looking at right now. A
   *    notification for the pane on your screen trains you to dismiss
   *    notifications.
   *  - The log records what this method DECIDED to raise — after the presence
   *    gate, before delivery, and never corrected by delivery's outcome. It is
   *    not a record of what was sent: recording is unconditional while `push`
   *    is optional, so a reconnecting client's catch-up can and will list
   *    events no device ever received. `NotifyEvent`'s own docstring is the
   *    wire contract for that; keep the two saying the same thing.
   *
   *  `notifyLog` and `push` are independently optional, which is the reason
   *  above: the catch-up log is useful even on a box with no VAPID keys
   *  configured, so it is never gated on `push` being present.
   */
  private pushOne(e: { kind: NotifyEvent['kind']; sessionId: string; project: string; title: string; body: string; actions?: PushPayload['actions'] }, projects: Set<string>): void {
    if (this.deps.presence?.isVisible(e.sessionId)) return;
    const title = projects.size > 1 ? `${e.title} · ${e.project}` : e.title;
    this.deps.notifyLog?.record({ kind: e.kind, sessionId: e.sessionId, title, body: e.body });
    void this.deps.notifyLog?.flush();
    void this.deps.push?.notify({ title, body: e.body, sessionId: e.sessionId, tag: `${e.kind}-${e.sessionId}`, ...(e.actions ? { actions: e.actions } : {}) });
  }

  /**
   * Refresh every session's hook state, every tick — no slower clock of its
   * own, unlike sweepTasks/sweepPr below: `readHookState` is one local JSON
   * read per session and already gates its own freshness and identity, so
   * there is nothing to amortize by sampling it less often. The map is
   * rebuilt each tick, same discipline as sweepTasks, so a de-registered
   * session's state can't linger.
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here — see the comment in `tick()`. Optional (defaulting to its own
   * read) so this stays independently callable, same shape as
   * `detectDialogs` below.
   */
  private async sweepHookStates(records?: SessionRecord[]): Promise<void> {
    const now = Date.now();
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
    const next = new Map<string, HookState>();
    await Promise.all(
      recs.map(async (r) => {
        const hs = await readHookState(this.deps.io, this.deps.cfg.registryDir, r.id, r.uuid, now);
        if (hs) next.set(r.id, hs);
      }),
    );
    this.hookStates = next;
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
   *
   * IT ALSO CARRIES `held`, read from the SAME fresh registry read — fix-wave
   * findings 1/5. This is the only registry read that happens at the archive
   * DECISION POINT; `archiveMerged`'s own `records` argument is the snapshot
   * `sweepPr` took before it awaited one gh-bound `ccd pr-state` per project
   * (20 s budget each, and a sweep is only abandoned after PR_SWEEP_STUCK_MS =
   * 15 min), so a hold placed while the sweep is in flight is invisible there.
   * The wave boundary IS the modal instant for placing one — the merge that
   * ends wave N is what tells the orchestrator to hold for wave N+1 — so the
   * stale window is exactly the window the feature exists for, and
   * `ccd ws-archive` has no held rung of its own to catch what slips through
   * (deliberately: a by-hand archive of a held workspace must still work, see
   * README and PrSheet). This function already had the fresh record in hand
   * and threw the field away; now it returns it.
   *
   * `held` is null for the `attached` answer, which returns BEFORE the read:
   * that answer defers the archive anyway, so nothing can be destroyed by not
   * knowing — the only thing lost is the held-merged push, which the caller's
   * snapshot rung fires whenever the hold predates the sweep.
   */
  async archiveSafety(id: string): Promise<{ verdict: 'ok' | 'busy' | 'attached' | 'unknown'; held: string | null }> {
    if (this.bus.listenerCount(`session:${id}`) > 0) return { verdict: 'attached', held: null };
    const rec = (await readRegistry(this.deps.io, this.deps.cfg)).find((r) => r.id === id);
    if (!rec) return { verdict: 'unknown', held: null };
    const held = rec.held;
    if (!(await this.deps.tmux.hasSession(id))) return { verdict: 'ok', held };   // no pane: nothing is running
    const pid = await this.deps.tmux.panePid(id);
    const cfgDir = this.deps.cfg.wrappers[rec.wrapper];
    if (!pid || !cfgDir) return { verdict: 'unknown', held };
    const live = await readLiveState(this.deps.io, cfgDir, pid);
    if (!live) return { verdict: 'unknown', held };
    return { verdict: liveSessionStatus(live.status) === 'busy' ? 'busy' : 'ok', held };
  }

  /** The held-merged push: once per (workspace, PR), from whichever rung saw
   *  the hold — the snapshot's or `archiveSafety`'s fresh read. One latch key,
   *  so the two rungs can never both announce the same pair. */
  private notifyHeldMerged(r: SessionRecord, number: number | null, reason: string): void {
    const key = `${r.id}#${number ?? '?'}`;
    if (this.heldMergedNotified.has(key)) return;
    this.heldMergedNotified.add(key);
    this.pushOne({
      kind: 'merged', sessionId: r.id, project: r.project,
      title: `✓ merged › ${r.workspace}`,
      body: `PR #${number ?? '?'} merged — ${reason}; nothing archived.`,
    }, this.activeProjects);
  }

  private async archiveMerged(records: SessionRecord[]): Promise<void> {
    for (const r of records) {
      const pr = this.prStates.get(r.id);
      if (r.workspace === null || r.archivedAt !== null) continue;
      if (pr?.phase !== 'merged') continue;                 // unknown NEVER archives
      if (r.held !== null) {
        // A program claims this workspace: the merge is a WAVE boundary, not
        // the end. Archive nothing; say so once per (workspace, PR) — the
        // in-memory latch (see its own comment) means a server restart may
        // repeat the push, which the shared `merged-<id>` collapse tag turns
        // into a replace, not a stack. The bucket ladder is untouched: no
        // `archivedAt` is written, so the workspace stays in the live
        // buckets exactly as an ordinary session would.
        //
        // THE SNAPSHOT'S RUNG, and it is the fast one, not the authoritative
        // one: `records` was read at the top of `sweepPr`, before every
        // gh-bound round trip. It can only ever be a hold that ALREADY
        // existed then, so it can never be wrong in the destructive direction
        // — but it can be blind, and the `archiveSafety` rung below is the one
        // that answers for holds placed while this sweep was in flight.
        this.notifyHeldMerged(r, pr.number, r.held);
        continue;
      }
      // The FRESH answer, at the decision point: verdict and hold from one
      // registry read taken now, not from the snapshot above (findings 1/5).
      // The hold is checked FIRST because it is not a deferral of the same
      // kind — 'busy'/'attached' say "not yet", a hold says "not until a
      // human releases it", and the operator gets told which.
      const safety = await this.archiveSafety(r.id);
      if (safety.held !== null) {
        this.notifyHeldMerged(r, pr.number, safety.held);
        continue;
      }
      if (safety.verdict !== 'ok') continue;   // defers; the next sweep retries
      const argv = CCD_ARGV.wsArchive(r.id);
      // The same gate the `pr-state` sweep above and the `/archive` route
      // apply. Third instance of NF10's class, found in round 3: on a host
      // whose ccd predates `ws-archive` this call can only fail its usage
      // check, and being level-triggered it would re-fire for every merged
      // session on every sweep, forever. Skipping writes no state — the level
      // stays `merged`, so the archive happens on the first sweep after the
      // host is upgraded.
      if (!verbSupported(this.deps.fleetState, argv)) continue;
      const res = await this.deps.runCcd(argv);
      if (!res.ok) continue;
      if (res.stdout.startsWith('already archived')) continue;   // idempotent re-fire: no second push
      // AFTER the fact, and it promises only navigation: no `actions` here,
      // so an older service worker renders it exactly like every other push.
      // `this.activeProjects` — this sweep has no fleet list of its own in
      // scope (see the field's own comment) and must not block on `gh` to get
      // one.
      // `›`, not `·`: `pushOne` appends the project with `·` when more than
      // one is active, and reusing that separator here would render
      // "✓ merged · wt-foo · ccrc-pwa" with no way to tell workspace from
      // project. The old copy used `›` for exactly this reason.
      this.pushOne({
        kind: 'merged', sessionId: r.id, project: r.project,
        title: `✓ merged › ${r.workspace}`,
        body: `PR #${pr.number ?? '?'} merged; workspace archived, nothing deleted.`,
      }, this.activeProjects);
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
   *
   * `records` is `tick()`'s own registry read, passed in rather than fetched
   * again here (optional, defaulting to its own read, so this stays
   * independently callable) — same sharing as `sweepHookStates` above.
   */
  private async detectDialogs(notify: boolean, records?: SessionRecord[]): Promise<Set<string>> {
    const pending = new Set<string>();
    const recs = records ?? await readRegistry(this.deps.io, this.deps.cfg);
    for (const r of recs) {
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
        // The pane is what raises this push (`kind: 'ask'` has exactly one
        // producer, and it is this scrape), but the ANSWERABLE part comes from
        // the hook envelope: only it carries the option labels and the content
        // key `answerAsk` gates on. `askActions` returns null wherever that
        // route would refuse, so a notification never offers a button the
        // server has already decided it will not honour. `this.hookStates` is
        // this tick's — see the ordering note in `tick()`.
        const actions = askActions(this.hookStates.get(r.id) ?? null);
        const raise = (): void => {
          // `this.activeProjects` — this sweep runs BEFORE this tick's own
          // `assembleFleet` (see `tick()`), so the current fleet's project
          // set isn't computed yet; it reads last tick's, same reasoning as
          // `archiveMerged` above.
          this.pushOne({
            kind: 'ask', sessionId: r.id, project: r.project,
            title: '❓ Question', body: dialog.title || 'Claude has a question',
            ...(actions ? { actions } : {}),
          }, this.activeProjects);
          // Latched whenever this raise had no actions, cleared the moment one
          // has them — so the amendment below fires at most once per question.
          //
          // `notify` gates the CALL, not delivery: `pushOne` returns before
          // `push.notify` whenever presence says the operator is looking at
          // this session. So the latch can be set for a question whose push was
          // suppressed, and the amendment can then "replace" a notification
          // that was never shown. Harmless in both directions — a suppressed
          // amendment is suppressed too (same presence check), and a claim that
          // lapses in between produces one answerable notification, which is
          // the outcome we wanted anyway. What it must NOT be called is proof
          // that a push went out.
          if (actions) this.actionlessAsks.delete(r.id);
          else this.actionlessAsks.set(r.id, dialog.id);
        };
        if (last !== dialog.id) {
          this.dialogIds.set(r.id, dialog.id);
          this.bus.emit(`session:${r.id}`, { type: 'dialog', dialog });
          if (notify) raise();
        } else if (notify && actions && this.actionlessAsks.get(r.id) === dialog.id) {
          // The amendment. Same question, same tag — `push-sw.js` sets
          // `renotify` from the tag, so this REPLACES the un-answerable
          // notification in its slot rather than stacking a second one under
          // it. It is a second raise, so `pushOne` records a second event in
          // the catch-up ring: the ring is a record of what was raised, and
          // two really were, which is the honest cost of not leaving the
          // question un-answerable.
          raise();
        }
      } else if (last !== undefined) {
        this.dialogIds.delete(r.id);
        this.actionlessAsks.delete(r.id);
        this.bus.emit(`session:${r.id}`, { type: 'dialog_cleared' });
      }
    }
    return pending;
  }
}
