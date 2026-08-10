import { configDirFor, type CcrcConfig } from './config.js';
import type { Tmux } from './exec.js';
import type { FleetIO } from './io.js';
import { readRegistry, readSessionRecord } from './registry.js';
import type { SessionRecord } from './registry.js';
import { readLimits } from './limits.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import type { Statusline } from './pane/statusline.js';
import type { HookState } from './hookstate.js';
import type { FleetSession, PrState, SessionStatus, TaskProgress, Wrapper } from '../../shared/api.js';
// The ladder lives in `shared/` because `reviveFleetSession` is its second
// producer and the two must not be able to disagree — see its own docstring.
import { ACCOUNTS, sessionBucket } from '../../shared/api.js';

/** `FleetSession.askSummary`'s ceiling — a fleet card row, not a transcript. */
const ASK_SUMMARY_MAX_LEN = 80;

/**
 * The fleet card's one-line summary of a `waiting` hook state.
 *
 * `null` for anything that isn't an actively-waiting hook state WITH an ask
 * envelope: a hook can report `waiting` a beat before the ask write lands
 * (two separate writes, no lock between them), and that gap must read as
 * "nothing to summarize yet", never as an empty or fabricated line.
 *
 * Questions: the FIRST question's `header?.trim() || question` — the header
 * is the short form a human wrote for exactly this kind of glance, but an
 * EMPTY or whitespace-only header (a real shape: `session-hook.sh` copies
 * `tool_input.questions` verbatim, and a header is optional on the tool call
 * itself) must fall through to the question exactly like an absent one does
 * — `??` alone does not do that, since `''` is neither `null` nor
 * `undefined`. Approval: `` `${tool}: ${summary}` `` — the one pending tool
 * call and its own one-line description, unless BOTH are empty, which is
 * treated as no summary rather than emitting `": "`. Both clipped to
 * `ASK_SUMMARY_MAX_LEN`, and the whole thing is null rather than `''` on the
 * off chance every fallback above is itself empty — this line renders
 * unconditionally on a waiting card, so "no line" must never become a blank
 * one.
 */
export function hookAskSummary(hs: HookState | null): string | null {
  if (hs === null || hs.state !== 'waiting' || hs.ask === null) return null;
  let text: string | null;
  if ('questions' in hs.ask) {
    const q = hs.ask.questions[0];
    text = q ? (q.header?.trim() || q.question) : null;
  } else {
    const { tool, summary } = hs.ask.approval;
    text = tool === '' && summary === '' ? null : `${tool}: ${summary}`;
  }
  return text === null || text === '' ? null : text.slice(0, ASK_SUMMARY_MAX_LEN);
}

/** `ACCOUNTS`' wrappers, longest `idPrefix` first — computed once, since
 *  `ACCOUNTS` is static. `idHomeWrapper` walks this order so a prefix that is
 *  itself a prefix of a longer one (`'claude-'` inside `'claude-dev0-'` and
 *  `'claude-corp-'`) never wins first. */
const BY_ID_PREFIX_LENGTH_DESC: readonly Wrapper[] =
  (Object.keys(ACCOUNTS) as Wrapper[]).slice().sort((a, b) => ACCOUNTS[b].idPrefix.length - ACCOUNTS[a].idPrefix.length);

/**
 * Which account a session id belongs to, from the id alone — the fallback
 * `assembleFleet` uses when the registry has no explicit `home` written
 * (older sessions; ccd only started writing `home` recently).
 *
 * Longest-`idPrefix`-wins over `ACCOUNTS`, in `BY_ID_PREFIX_LENGTH_DESC`
 * order, replaces a hand-typed, unordered prefix array that did not even
 * MENTION `claude-dev0`, under which `claude-dev0-quiet-basin` would have
 * fallen through to the bare `'claude-'` branch and come back `claude` — a
 * session attributed to the wrong account.
 *
 * Prophylactic, not a fix for an observed misattribution: `claude-dev0-*`
 * cannot appear in the registry today. `ACCOUNTS['claude-dev0'].ccdValid`
 * is `false`, and the cross-language fixture test
 * (`wrapper-roster-fixture.test.ts`) pins that ccd's own `_is_valid_wrapper`
 * rejects `claude-dev0` — so nothing under `ccd/` can mint an id with that
 * prefix. What this ordering keeps true is that IF `claude-dev0` (or any
 * future wrapper whose `idPrefix` is a strict extension of another member's)
 * ever becomes ccd-valid, the longest match still wins rather than silently
 * reproducing the old bug. `fleet.test.ts:40` pins the corrected answer as a
 * regression guard, not as a record of a live incident.
 *
 * Falls back to `'claude'` for an id with no wrapper prefix at all — a main
 * checkout's id is the bare project name, never `<wrapper>-<slug>`.
 */
export function idHomeWrapper(id: string): Wrapper {
  for (const w of BY_ID_PREFIX_LENGTH_DESC) if (id.startsWith(ACCOUNTS[w].idPrefix)) return w;
  return 'claude';
}

/**
 * Authoritative live status for one session — the same signal the fleet uses:
 * dead if no tmux session, else busy/idle from the live status file. Used by the
 * interrupt route, since the --remote-control pane carries no busy marker.
 */
export async function liveStatus(io: FleetIO, cfg: CcrcConfig, tmux: Tmux, id: string): Promise<SessionStatus> {
  // C0.3: this only ever asks about ONE id — no uniqueness or subtraction
  // over the rest of the fleet — so it reads just that id's row rather than
  // the whole registry (readRegistry's 24-generation sweep, ~409 round trips
  // on a 24-session fleet in remote mode, for a question about one session).
  const read = await readSessionRecord(io, cfg, id);
  // A degraded row must never answer 'dead' — the interrupt route's own
  // "not busy" refusal reads THIS, and reporting dead-by-drop on a session
  // this read simply could not measure would let it refuse an interrupt on a
  // plainly busy one. `!read.found` (genuinely absent, or the whole
  // directory unlistable) is still 'dead': there is no pane to ask about
  // either way, the same answer this gave before the ladder existed.
  if (!read.found || !(await tmux.hasSession(id))) return 'dead';
  const rec = read.record;
  const pid = await tmux.panePid(id);
  // Unmeasured wrapper => 'idle', via the EXISTING `!cfgDir` fallback: a
  // degraded `rec.wrapper` is `''`, which `configDirFor` (an unknown wrapper
  // string) already answers `undefined` for — honest-but-blind, and it fails
  // TOWARD refusing an interrupt rather than granting one on a guess.
  const cfgDir = configDirFor(cfg.home, rec.wrapper);
  if (!pid || !cfgDir) return 'idle';
  const live = await readLiveState(io, cfgDir, pid);
  return live ? liveSessionStatus(live.status) : 'idle';
}

/** The PR state a session has WITHOUT a live sweep: whatever `ccd pr-state`
 *  last wrote into the registry. `unchecked` when it has never run. Null for a
 *  main checkout, which is the only session that gets no PR control at all.
 *  Deliberately NOT enriched — url/title/checks are not persisted, and
 *  inventing them here would put stale CI colour on screen with a fresh
 *  `checkedAt` beside it. */
function persistedPr(r: SessionRecord): PrState | null {
  if (r.workspace === null) return null;
  return {
    phase: r.prPhase ?? 'unchecked',
    number: r.prNumber, url: null, title: null,
    checks: null, checkNames: null, ahead: 0, reason: null,
    checkedAt: r.prCheckedAt, mergedAt: null,
    // The registry stores no backoff: it is per-process, per-project, in-memory.
    retryAt: null,
  };
}

export async function assembleFleet(
  io: FleetIO,
  cfg: CcrcConfig,
  tmux: Tmux,
  now = Math.floor(Date.now() / 1000),
  pendingDialogs?: Set<string>,
  statuslines?: Map<string, Statusline>,
  taskProgress?: Map<string, TaskProgress>,
  /** Last-swept PR state per session id (FleetWatcher's third lane). Absent on
   *  a cold start and in every existing test — which is exactly why the
   *  registry fallback below exists. */
  prStates?: Map<string, PrState>,
  /** Fresh per-session hook state (FleetWatcher's fifth lane), same pattern
   *  as `pendingDialogs`: absent on a cold start and in every existing test,
   *  which is exactly why every hook-derived field below defaults to null. */
  hookStates?: Map<string, HookState>,
  /**
   * The registry rows this assembly must describe, when the caller has
   * ALREADY read them — the same `records ?? await readRegistry(...)` idiom
   * `watch.ts`'s own `sweepTasks`/`archiveMerged` lanes use.
   *
   * Load-bearing for correctness, not just for the saved round trips
   * (bba5c09; restated here — blocking review finding 4 — on its REAL ground,
   * since the claim this comment used to make, "`FleetSession` carries no
   * `unmeasured` field", is false as of Task 2: `unmeasured: r.unmeasured` is
   * assigned into the returned session below). The actual reason a caller
   * MUST pass its own rows rather than let this function take a second,
   * independent read: `watch.ts`'s `tick()` derives its evidence — the
   * `unmeasuredIds` set its busy→idle "✓ Finished" push refuses to fire for —
   * straight off THIS call's own return value (`sessions[i].unmeasured`), not
   * off a separately-read set of `SessionRecord`s. If this function took its
   * OWN read instead of the rows `tick()` already has, that would be a
   * SEPARATE whole-fleet sweep, ~17 field reads per session, a few hundred ms
   * after the one `tick()` used for `sweepHookStates`/`detectDialogs` — and a
   * row that read clean in tick()'s sweep and degraded in THIS one would
   * still land in `sessions` with `unmeasured` empty (wrong), or vice versa.
   * Passing the rows in makes every lane inside one tick describe the
   * IDENTICAL observation, which is the only way they can never disagree —
   * the same reasoning `tick()`'s own comment states for why it shares this
   * read with `sweepHookStates`/`detectDialogs` in the first place.
   */
  records?: SessionRecord[],
): Promise<FleetSession[]> {
  const [recs, limits] = await Promise.all([records ?? readRegistry(io, cfg), readLimits(io, cfg, now)]);
  return Promise.all(recs.map(async (r): Promise<FleetSession> => {
    const alive = await tmux.hasSession(r.id);
    let status: SessionStatus = 'dead';
    let name: string | null = null, statusUpdatedAt: number | null = null, version: string | null = null;
    if (alive) {
      status = 'idle';
      const pid = await tmux.panePid(r.id);
      const cfgDir = configDirFor(cfg.home, r.wrapper);
      if (pid && cfgDir) {
        const live = await readLiveState(io, cfgDir, pid);
        if (live) {
          status = liveSessionStatus(live.status);
          // A derived name is Claude Code's session handle (`openclawhetzner-42`
          // — cwd basename plus a counter), never a description of the work, so
          // it is dropped HERE rather than shipped for the PWA to re-judge.
          // `name` on the wire therefore means "a name worth displaying", and
          // the fleet line's `name ?? branch ?? workspace ?? id` falls through
          // to the branch on its own. Only the exact string 'derived' rejects:
          // an absent nameSource is an older file whose name a human chose.
          name = live.nameSource === 'derived' ? null : live.name;
          statusUpdatedAt = live.statusUpdatedAt; version = live.version;
        }
      }
    }
    const acct = limits[r.wrapper];
    const sl = statuslines?.get(r.id);
    // A running Workflow leaves the orchestrator reporting idle while it waits
    // on subagents — surface it as busy so it doesn't read as finished.
    if (sl?.workflowActive && status === 'idle') status = 'busy';
    // STATUS IS FROZEN above this line: `hs` informs dialogPending and the
    // three hook-derived fields below, and MUST NOT feed back into `status` —
    // that derivation is done the moment this line runs.
    const hs = hookStates?.get(r.id) ?? null;
    const session: FleetSession = {
      id: r.id, wrapper: r.wrapper, home: r.home ?? idHomeWrapper(r.id),
      project: r.project, workdir: r.workdir, workspace: r.workspace, name, status, statusUpdatedAt,
      limits: acct ? { five: acct.five, seven: acct.seven } : null,
      // Either source can raise the flag: the pane detector sees an
      // AskUserQuestion/permission menu the hook never gets a write for
      // (older Claude Code, a hook that failed to install), and the hook sees
      // a waiting state before any menu ever paints (headless, or between the
      // hook write and the next pane capture).
      dialogPending: (pendingDialogs?.has(r.id) ?? false) || hs?.state === 'waiting', version,
      model: sl?.model ?? null, effort: sl?.effort ?? null,
      // The statusline wins: it is a live pane capture and knows about a manual
      // checkout. The registry fills the gap before the first capture lands.
      ultracode: sl?.ultracode ?? false, branch: sl?.branch ?? r.branch ?? null,
      tasks: taskProgress?.get(r.id) ?? null,
      pr: prStates?.get(r.id) ?? persistedPr(r),
      archivedAt: r.archivedAt,
      archivedBytes: r.archivedBytes,
      held: r.held,
      hookState: hs?.state ?? null,
      askSummary: hookAskSummary(hs),
      subagents: hs?.subagents ?? null,
      // Carried straight off the record — this IS the evidence `tick()`'s own
      // `unmeasuredIds` (watch.ts) now derives its Set from directly, one
      // field of these very rows (one derivation of one fact — blocking
      // review finding 4), shipped on the wire so the PWA (grey+reason,
      // SessionLine.tsx) and the offline/state-cache snapshots (Task 2) can
      // tell a degraded row from a measured one too.
      unmeasured: r.unmeasured,
      bucket: 'idle', bucketSince: null,   // replaced immediately below
    };
    // Computed FROM the assembled session, never from a second copy of the
    // same expressions: `dialogPending` in particular is an OR of two sources
    // and must be read once. STATUS IS STILL FROZEN — `sessionBucket` reads
    // `status`, it never writes it.
    return { ...session, ...sessionBucket(session, hs?.updatedAt ?? null) };
  }));
}
