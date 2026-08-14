import type { Deps } from './server.js';
import type { Bus, Notice } from './bus.js';
import { configDirFor, type CcrcConfig } from './config.js';
import { measuredIdentity, readSessionRecord } from './registry.js';
import { liveSessionStatus, readLiveState } from './livestate.js';
import {
  rungRank, TranscriptResolver, type TranscriptResolution,
} from './transcript/resolve.js';
import { readBacklog, TranscriptTailer } from './transcript/tail.js';
import { paneState, parseDialog } from './pane/dialog.js';
import { alignAsk, readPendingAsk } from './transcript/ask.js';
import { readTasks } from './tasks/read.js';
import { readHookState } from './hookstate.js';
import { askKey } from './askkey.js';
import type { Dialog, DialogAsk, SessionStatus, SessionStreamMsg } from '../../shared/api.js';

const POLL_MS = 2000;
const BACKLOG_N = 50;

interface Resolved {
  uuid: string;
  file: string;
  /** The outcome `file` came off. §5.3's re-point rule compares RUNGS, not
   *  paths, and the backlog frame reports the account and the completeness —
   *  none of which a bare string can carry. */
  resolution: TranscriptResolution;
  cfgDir: string;
  status: SessionStatus;
  statusUpdatedAt: number | null;
}

/**
 * `resolve()`'s own three-way (registry ladder, Task 2) — same `ok`+`reason`
 * shape `SingleRead` (registry.ts) already draws, deliberately not a new
 * vocabulary. `ok: false, reason: 'unmeasurable'` covers BOTH of
 * `SingleRead`'s own `unlistable` (the whole-directory collapse — the LARGER
 * cousin of a degraded row, and just as much not proof this session is
 * gone) and a listed-but-degraded identity triple (`measuredIdentity`
 * answering null): in either case this read simply could not say, so the
 * client is told to wait, never that the session is unknown.
 * `ok: false, reason: 'absent'` covers a PROVEN absence (`SingleRead`'s own
 * `absent`) and the wrapper/config-dir mapping gap this function has always
 * folded into the same answer (see its own comment below) — neither is
 * registry-unmeasurable, so retrying this same 2 s poll can never heal
 * either one.
 */
type Resolution =
  | { ok: true; data: Resolved }
  | { ok: false; reason: 'unmeasurable' }
  | { ok: false; reason: 'absent' };

/**
 * One per-session websocket connection: sends the transcript backlog (or tails
 * from a `since` offset on resume), streams appended events, follows uuid
 * rotation (clear/compact/swap), reports status flips, and forwards bus
 * notices plus targeted `session:<id>` messages.
 */
export class SessionStream {
  private tailer: TranscriptTailer | null = null;
  private poll: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;
  private uuid: string | null = null;
  private status: SessionStatus | null = null;
  /** What the client last saw of the pane menu — see nextDialogFrame. */
  private seenDialog: DialogSeen = { id: null, ask: null };
  /** The transcript state that already failed to explain the menu on screen —
   *  see claimAskRead. */
  private askProbe: { file: string; id: string; size: number; mtimeMs: number } | null = null;
  /** Serialized last-sent task list — the change gate for the `tasks` frame. */
  private lastTasksJson: string | null = null;
  /** Serialized last-sent outstanding-mail list — the change gate for the
   *  `mail` frame. `undefined` (not `null`) until the first read, for the
   *  EXACT reason `lastAskJson` below is `undefined`: this instance is per
   *  CONNECTION, and a client can arrive already holding a stale `mail` list
   *  from before a drop — an automatic `ReconnectingSocket` reconnect never
   *  runs the PWA's own `disconnect()`, and even `disconnect()` never
   *  touched `mail` in the first place (fix round 1, findings 1/3). The
   *  scenario the old `null` sentinel missed: a client is shown one item,
   *  the socket drops, the session acks that delivery while the client is
   *  away, then a fresh `SessionStream` connects and its own first read is
   *  ALREADY `[]` — with the old `null` sentinel and its first-read-empty
   *  swallow (mirroring `checkTasks`'s own swallow), `null === null` never
   *  held (the JSON is `'[]'`, not `null`), but the SWALLOW clause itself
   *  (`lastMailJson === null && outstanding.length === 0`) matched and ate
   *  the send — the reconnecting client's stale one-item list was never
   *  corrected. `undefined` guarantees the first check always sends
   *  something explicit: an empty `{type:'mail', mail: []}` frame costs
   *  exactly what `ask_cleared` already costs on every connect, and it is
   *  the only way to confirm to a possibly-stale client that there is truly
   *  nothing outstanding. */
  private lastMailJson: string | null | undefined = undefined;
  /** Serialized last-sent hook ask envelope — the change gate for `ask` /
   *  `ask_cleared`. See `checkHookAsk`. `undefined` (not `null`) until the
   *  first read: this instance is per CONNECTION, and a client can arrive
   *  already holding a stale `ask` from before the drop (an automatic
   *  ReconnectingSocket reconnect never runs the PWA's own disconnect(),
   *  which nulls it there — see pwa/src/stores/session.ts). If this started
   *  at `null`, a brand-new connection whose hookstate is ALREADY absent
   *  would compare null === null on its very first check and send nothing —
   *  the exact silent-agreement-with-a-stale-client bug fix round 1 closed.
   *  `undefined` guarantees the first check always sends something explicit
   *  (fixing round 1, I1): `ask_cleared` at minimum, confirming to a
   *  possibly-stale client that there is truly nothing pending. */
  private lastAskJson: string | null | undefined = undefined;
  /** One memo per stream (§5.4): steady state is ONE stat per tick for this
   *  session, and a session with nothing at any exact address pays for a full
   *  search on a back-off rather than every two seconds. */
  private readonly transcripts: TranscriptResolver;
  /** The outcome the open tailer was built from — the left-hand side of
   *  §5.3's re-point comparison. Null until the first tailer exists. */
  private tailed: TranscriptResolution | null = null;

  private readonly onNotice = (n: Notice): void => this.send({ type: 'notice', message: n.message });
  // This stream detects dialogs itself (start + every tick), so it always
  // delivers a dialog that is ALREADY pending when the client connects — the
  // global watcher only emits on the appear/clear transition, which a
  // late-joining client would miss. Ignore the watcher's dialog bus events here
  // to avoid double-delivery; still forward its notices.
  //
  // A second channel runs the same way, alongside it: `checkHookAsk` reads
  // `~/.cc-sessions/<id>.hookstate.json` itself, on connect and every tick,
  // and sends `ask` / `ask_cleared` on its own change gate (`lastAskJson`) —
  // the hook-sourced envelope, entirely independent of the pane scrape above.
  // The two channels can disagree (a hook fires before the pane redraws, or
  // reports an ask the pane never shows) and NEITHER suppresses the other:
  // both are sent exactly as read. The client prefers the envelope when both
  // are present; the server never guesses which one is right.
  private readonly onSessionMsg = (m: SessionStreamMsg): void => {
    if (m.type === 'dialog' || m.type === 'dialog_cleared') return;
    this.send(m);
  };

  constructor(
    private readonly deps: Deps,
    private readonly bus: Bus,
    private readonly id: string,
    private readonly send: (m: SessionStreamMsg) => void,
    /** `file` is the transcript the client's `offset` was taken in (§5.3).
     *  OPTIONAL: a client from before this build names no file, and gets
     *  today's uuid-only resume — no worse than today, and Task 12 closes it. */
    private readonly since?: { uuid: string; offset: number; file?: string | null },
  ) {
    this.transcripts = new TranscriptResolver(deps.io);
  }

  async start(): Promise<void> {
    this.bus.on('notice', this.onNotice);
    this.bus.on(`session:${this.id}`, this.onSessionMsg);
    const r = await this.resolve();
    if (this.stopped) return;
    if (r.ok) {
      this.uuid = r.data.uuid;
      this.status = r.data.status;
      this.tailed = r.data.resolution;
      const echoed = this.since?.file ?? null;
      if (this.since && this.since.uuid === r.data.uuid && (echoed === null || echoed === r.data.file)) {
        // Resume — no backlog. A null echo is an older client (§5.3's honest
        // compatibility window); a MATCHING echo proves the offset belongs to
        // the file about to be tailed.
        this.startTailer(r.data.file, r.data.uuid, this.since.offset);
      } else {
        await this.sendBacklogAndTail(r.data);
      }
    } else if (r.reason === 'unmeasurable') {
      // DISTINCT from "unknown session" below (registry ladder, Task 2): the
      // registry proved nothing either way this pass, so the honest word is
      // "retrying", not "gone".
      this.send({ type: 'notice', message: `session ${this.id} is temporarily unreadable — retrying` });
    } else {
      this.send({ type: 'notice', message: `unknown session ${this.id}` });
    }
    if (this.stopped) return;
    await this.checkDialog(r.ok ? r.data.file : null); // deliver an already-pending dialog on connect
    if (this.stopped) return;
    if (r.ok) await this.checkTasks(r.data.cfgDir, r.data.uuid); // and the plan as it stands
    if (this.stopped) return;
    if (r.ok) await this.checkHookAsk(r.data.uuid); // and any hook ask already waiting
    if (this.stopped) return;
    if (r.ok) await this.checkMail(); // and any outstanding mail addressed to this session
    if (this.stopped) return;
    // `absent` is terminal for this connection: a proven-gone session id
    // does not un-absent itself by polling, and installing the retry timer
    // anyway would poll a dead end for the socket's whole lifetime. `ok` and
    // `unmeasurable` both keep polling — for `unmeasurable` that IS the
    // point of degrade-and-heal, and it is what lets `tick()`'s own
    // appeared-branch heal a stream that started life unable to prove the
    // session existed at all (`this.uuid` is still null on that first tick).
    if (r.ok || r.reason === 'unmeasurable') {
      this.poll = setInterval(() => { void this.tick(); }, POLL_MS);
      this.poll.unref();
    }
  }

  /** Capture the pane; send `dialog` when a menu appears/changes or first comes
   *  back enriched, and `dialog_cleared` when it vanishes — tracked per stream
   *  so a client that joins after the menu appeared still receives it.
   *
   *  `file` is the transcript being tailed, and WHICH file matters: after an
   *  account swap the same `<uuid>.jsonl` exists under several wrapper config
   *  dirs, and the ask has to come from the one this session is writing.
   *  null (unresolvable session) → the menu still ships, unenriched. */
  private async checkDialog(file: string | null): Promise<void> {
    if (this.stopped) return;
    const pane = await this.deps.tmux.capture(this.id);
    let dialog = pane !== null && paneState(pane) === 'menu' ? parseDialog(pane) : null;
    // Read the transcript only while this menu is still unexplained. Once its ask
    // is latched, re-reading costs a 256 KB tail every 2 s and can buy nothing:
    // nextDialogFrame would suppress the frame anyway. Menus that never latch are
    // held off by claimAskRead instead — they are the majority.
    const latched = dialog !== null && this.seenDialog.id === dialog.id && this.seenDialog.ask !== null;
    if (dialog?.parsed && file !== null && !latched) {
      const st = await this.deps.io.stat(file);
      if (this.stopped) return;
      if (this.claimAskRead(file, dialog.id, st)) {
        const questions = await readPendingAsk(this.deps.io, file);
        if (this.stopped) return;
        const ask = questions === null ? null : alignAsk(dialog.options, questions);
        // Enrichment rides ALONGSIDE the scraped options — it never rewrites them.
        // `id` stays a hash of the pane alone (answerDialog re-parses the pane to
        // check staleness) and the keystrokes an answer sends stay positional.
        if (ask !== null) dialog = { ...dialog, ask };
      }
    }
    // The probe is scoped to the PARSED menu on screen, so it dies with it. A
    // capture can miss a menu that is still there: tmux returns null, one stray
    // 'esc to interrupt' anywhere in the pane flips it to busy, or the grab lands
    // mid-redraw and comes back `unparsed` (a menu footer with its option rows
    // half-erased — dialog.ts:94). That last one is still a dialog, so testing
    // for null alone would keep the probe alive past the menu it was taken for.
    // On the way back the ask is unlatched but the transcript is untouched — the
    // agent is blocked awaiting the answer — so a surviving probe would decline
    // the read the reappearance needs and the menu would come back bare and stay
    // bare. Forgetting it costs nothing: the read above is gated on
    // `dialog?.parsed`, so an unparsed menu never spends one.
    if (dialog === null || !dialog.parsed) this.askProbe = null;
    const { seen, msg } = nextDialogFrame(this.seenDialog, dialog);
    this.seenDialog = seen;
    if (msg) this.send(msg);
  }

  /**
   * May we spend a transcript tail read on this menu? Records the state we read
   * at, so the next poll can tell whether anything could have changed.
   *
   * The ask latch above only closes on SUCCESS, and most menus never succeed:
   * permission prompts, /model, trust-folder carry no AskUserQuestion, and they
   * sit on screen until a human answers. Reading is the expensive half —
   * `readPendingAsk` pulls up to 256 KB, over the agent RPC in remote-fleet mode
   * (see transcript/tail.ts:6-11 for what reading whole transcripts once cost
   * us) — while a stat is cheap and settles it: byte-identical bytes cannot have
   * started explaining a menu they did not explain last time. A file that grows
   * (the tool_use line finally flushed) or a different menu re-opens the read.
   *
   * The cost: a read that failed for an IO reason rather than an absent ask is
   * indistinguishable here, so that menu stays unenriched until the transcript
   * next changes. It still ships, and it is still answerable from the raw sheet.
   */
  private claimAskRead(file: string, id: string, st: { size: number; mtimeMs: number } | null): boolean {
    if (st === null) {              // no transcript yet — nothing to read, nothing to remember
      this.askProbe = null;
      return false;
    }
    const p = this.askProbe;
    if (p !== null && p.file === file && p.id === id && p.size === st.size && p.mtimeMs === st.mtimeMs) return false;
    this.askProbe = { file, id, size: st.size, mtimeMs: st.mtimeMs };
    return true;
  }

  /** The io-bound half of §5.3's rule: the ONE fact `shouldRepoint` cannot
   *  measure itself, gated the same way its own docstring promises — a stat
   *  is spent ONLY when the answer actually differs, never on the common
   *  case (a same-rung, same-path answer, every tick of every healthy
   *  session). Fix round 1, Important #1: this used to re-implement
   *  `shouldRepoint`'s rule inline rather than calling it, so `shouldRepoint`'s
   *  own table tests were guarding a copy that never ran — three mutants
   *  (dropping the "file gone" fallback, `<` -> `<=`, `&&` -> `||`) survived
   *  the ENTIRE suite against the live path while dying instantly against
   *  `shouldRepoint` in isolation. Delegating here closes that gap: mutating
   *  `shouldRepoint` now mutates what `tick()` actually executes.
   *
   *  The pre-filter below is the one line that stayed outside that fix, and
   *  it is a half-copy of the same rule, so it needs its own pin (final
   *  review, Important #3): dropping its `cur.path === next.path` conjunct
   *  passed the whole suite while making a same-rung DIFFERENT-path answer
   *  unreachable — the stream would keep tailing a deleted transcript
   *  forever. `sessionws.test.ts`'s "follows a SAME-RUNG answer to a
   *  different path once the tailed file is gone" is that pin; it must fail
   *  if this line is ever weakened again. It cannot simply be deleted in
   *  favour of always calling `shouldRepoint`: skipping the stat on the
   *  same-rung/same-path case is what keeps a healthy tick free. */
  private async repointNeeded(next: TranscriptResolution): Promise<boolean> {
    const cur = this.tailed;
    if (cur === null) return false;
    if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;  // no stat
    return shouldRepoint(cur, next, (await this.deps.io.stat(cur.path)) !== null);
  }

  /** Read the session's task list and send it when it differs from what this
   *  client last saw. An empty list is a legitimate value — it's how the strip
   *  learns a plan was cleared — but the opening no-tasks read is swallowed by
   *  the initial `lastTasksJson === null` case below, so sessions that never
   *  keep a task list never send a frame at all. */
  private async checkTasks(cfgDir: string, uuid: string): Promise<void> {
    if (this.stopped) return;
    const tasks = await readTasks(this.deps.io, cfgDir, uuid);
    if (this.stopped) return;
    const json = JSON.stringify(tasks);
    if (json === this.lastTasksJson) return;
    if (this.lastTasksJson === null && tasks.length === 0) {
      this.lastTasksJson = json;
      return;
    }
    this.lastTasksJson = json;
    this.send({ type: 'tasks', tasks });
  }

  /**
   * This session's own outstanding mail (Build 7 Task 6, PR J) — read
   * directly off `CoordStore.outstandingMailFor`, the SAME in-process call
   * `readTasks` above is to the filesystem, and sent when it differs from
   * what this client last saw (see `lastMailJson`'s own comment for why the
   * gate is `undefined`, not `null`).
   *
   * Deliberately NOT a client of `GET /api/mail?to=` (`coord/routes.ts`):
   * that route is gated on the box token (`requireMailToken`) because it
   * answers the anonymous box->server ingress — a fleet-host coordinator
   * script authenticating itself, never a browser. This stream already
   * knows exactly which one client it is serving (`this.id`, the session the
   * socket was opened for), so there is no attribution left to check and no
   * token to hold: the same reasoning `queueSystemMail` gives for bypassing
   * `POST /api/mail`'s own ingress gate on the write side.
   *
   * `deps.coord` is optional exactly like every other coord-gated surface
   * (`server.ts`'s own `Deps.coord?`): a box with no coordination database
   * sends no `mail` frame at all, the same silent absence every route in
   * `coord/routes.ts` answers with 501 `not-configured`.
   *
   * `outstandingMailFor` puts the `queued`/`delivered` predicate in the
   * store's own WHERE clause (fix round 1, findings 2/4) rather than this
   * caller filtering `mailForRecipient`'s general-purpose, history-bounded
   * read AFTER its `LIMIT` — the earlier shape let an old unacked delivery
   * fall outside the newest-100-deliveries window and read as gone here
   * while `GET /api/runs`' `unreadMail` (store.ts's own `unreadMailCount`,
   * no `LIMIT` at all) still counted it. "Outstanding = queued|delivered, or
   * a replay-ceiling park nobody ever acked" (fix, review finding 2 —
   * `OUTSTANDING_OR_ABANDONED_SQL`) is the store's rule now, in one place,
   * not this caller's.
   *
   * `500`, not the bare default of 100 (fix, review finding 25): the default
   * is sized for a route argument nobody controls, but this caller is
   * in-process and every worker's mail resolves to the coordinator session
   * across every wave of a program (store.ts's own `outstandingMailFor`
   * docstring) — the run-of-the-mill victim of exactly this cap, and
   * `MailStrip.tsx` prints `mail.length` as its headline COUNT, not a
   * capped page of one, so a silent 100-row ceiling reads as a cap wearing
   * the clothes of a fact. `500` is `clampMailLimit`'s own hard ceiling
   * (store.ts) — the most this call could ever widen to, so this is "as
   * wide as the store allows," not an arbitrary bigger number.
   */
  private async checkMail(): Promise<void> {
    if (this.stopped || !this.deps.coord) return;
    const outstanding = this.deps.coord.outstandingMailFor(this.id, 500);
    const json = JSON.stringify(outstanding);
    if (json === this.lastMailJson) return;
    this.lastMailJson = json;
    this.send({ type: 'mail', mail: outstanding });
  }

  /** Read this session's hookstate and send `ask` / `ask_cleared` when the
   *  hook-sourced envelope appears, changes (JSON-compare), or goes away —
   *  null, stale, or the file itself missing all read the same here: nothing
   *  fresh to report. `readHookState` already gates freshness and identity
   *  (uuid match against the registry), so a null return covers all three
   *  uniformly — this frame just tracks the transition, not the reason. */
  private async checkHookAsk(uuid: string): Promise<void> {
    if (this.stopped) return;
    const hs = await readHookState(this.deps.io, this.deps.cfg.registryDir, this.id, uuid, Date.now());
    if (this.stopped) return;
    const ask = hs?.ask ?? null;
    const json = ask === null ? null : JSON.stringify(ask);
    if (json === this.lastAskJson) return;
    this.lastAskJson = json;
    this.send(ask === null ? { type: 'ask_cleared' } : { type: 'ask', ask, key: askKey(ask) });
  }

  stop(): void {
    this.stopped = true;
    this.bus.off('notice', this.onNotice);
    this.bus.off(`session:${this.id}`, this.onSessionMsg);
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
    this.tailer?.stop();
    this.tailer = null;
  }

  /** Registry record + live state → current uuid, transcript file, and status. */
  private async resolve(): Promise<Resolution> {
    // C0.3: one session's own row, not the whole registry — this stream only
    // ever asks about `this.id`, every 2 s, for as long as the socket is open.
    const read = await readSessionRecord(this.deps.io, this.deps.cfg, this.id);
    if (!read.found) {
      // `unlistable` is the SAME whole-fleet collapse `RegistryRead`'s own
      // `listed: false` types elsewhere in this build — it proves nothing
      // about whether THIS id exists, only that this read could not say.
      // Only a proven `absent` earns the terminal "unknown session".
      return read.reason === 'unlistable' ? { ok: false, reason: 'unmeasurable' } : { ok: false, reason: 'absent' };
    }
    // Display/connectivity — DEGRADE-AND-HEAL, not a refusal: a degraded
    // `uuid`/`workdir` would resolve `transcriptPath` against `''`, a path
    // that names nothing real, rather than this session's actual transcript.
    // `measuredIdentity` — the one door to the triple — is null the instant
    // ANY of the three is unmeasured; this poll re-runs every 2 s, so a
    // transient field read heals itself on the very next tick with no
    // special-casing beyond this early return. HONEST LIMIT: there is no
    // half-measure here — when `uuid` itself is unmeasured there is no
    // transcript path left to name, so this answers `unmeasurable` rather
    // than reaching for a REMEMBERED uuid (`this.uuid`, still holding the
    // last value this stream resolved) combined with a freshly-read cwd:
    // that path was never proven to belong to the same incarnation as the
    // uuid it would be built from, and is a guess wearing a real address.
    const identity = measuredIdentity(read.record);
    if (identity === null) return { ok: false, reason: 'unmeasurable' };
    const cfgDir = configDirFor(this.deps.cfg, identity.wrapper);
    if (!cfgDir) {
      // A deployment gap, not a registry-read failure: the registry's own
      // identity triple measured CLEAN, `configDirFor` (server/src/config.ts)
      // just does not recognise this wrapper — a typo'd registry write, or a
      // wrapper this box's roster (`~/.ccrc/accounts.json`) has not been taught
      // about yet. Retrying this same poll can never heal it without a fixed
      // roster and a restart (`loadConfig` reads it once, at boot), so
      // this is `absent`, not `unmeasurable`, even though identity itself was
      // fully measured — a session the registry knows, running under a
      // wrapper this build cannot map, while the fleet list still shows it
      // idle (`assembleFleet` never consults `configDirFor`). Say so once per
      // connect, naming the wrapper, so the next occurrence is a grep and not
      // an investigation. Not a throw: one unmapped account must not take
      // down the streams for the mapped ones.
      console.warn(`ccrc-server: session ${this.id} has wrapper "${identity.wrapper}" with no configured ` +
        'config dir — chat cannot resolve it (see config.ts\'s `configDirFor`); the client sees only ' +
        '"unknown session"');
      return { ok: false, reason: 'absent' };
    }
    let cwd = identity.workdir;
    let status: SessionStatus = 'dead';
    let statusUpdatedAt: number | null = null;
    if (await this.deps.tmux.hasSession(this.id)) {
      status = 'idle';
      const pid = await this.deps.tmux.panePid(this.id);
      if (pid) {
        const live = await readLiveState(this.deps.io, cfgDir, pid);
        if (live) {
          if (live.cwd) cwd = live.cwd;
          status = liveSessionStatus(live.status);
          statusUpdatedAt = live.statusUpdatedAt;
        }
      }
    }
    const resolution = await this.transcripts.resolve({
      configDir: cfgDir,
      dir: cwd,
      registryWorkdir: identity.workdir,
      uuid: identity.uuid,
      // Only this caller asks for rung 6: it is the one surface that can show
      // the operator a banner naming whose history it is rendering (§5.2).
      foreign: foreignConfigDirs(this.deps.cfg, identity.wrapper),
    });
    return {
      ok: true,
      data: { uuid: identity.uuid, file: resolution.path, resolution, cfgDir, status, statusUpdatedAt },
    };
  }

  /**
   * Send the last-N backlog (missing:true when the transcript doesn't exist
   * yet — the stream stays up and the tailer picks the file up on appearance),
   * then tail from the end of what the backlog covered.
   */
  private async sendBacklogAndTail(r: Resolved): Promise<void> {
    const missing = (await this.deps.io.stat(r.file)) === null;
    const { events, offset } = await readBacklog(this.deps.io, r.file, BACKLOG_N);
    if (this.stopped) return;
    this.tailed = r.resolution;
    this.send({
      type: 'backlog', uuid: r.uuid, events, offset, file: r.file, missing,
      foreignAccount: r.resolution.kind === 'found' ? r.resolution.account : null,
      searchComplete: r.resolution.kind === 'fallback' ? r.resolution.complete : true,
    });
    this.startTailer(r.file, r.uuid, offset);
  }

  private startTailer(file: string, uuid: string, fromOffset: number): void {
    if (this.stopped) return;
    this.tailer?.stop();
    const t = new TranscriptTailer(this.deps.io, file, fromOffset);
    this.tailer = t;
    t.on('events', (events, newOffset) => {
      this.send({ type: 'events', uuid, events, offset: newOffset });
    });
    t.on('rotated', () => { void this.onFileShrunk(); }); // truncation/rewrite — refetch
    t.start();
  }

  /** The tailed file shrank under us: treat as rotation — re-resolve, resend backlog.
   *  An unmeasurable or absent re-resolve here (rare — the file just rotated,
   *  so the registry read a moment ago plainly succeeded) leaves the OLD
   *  tailer alone rather than tearing it down on a guess; the next 2 s tick
   *  retries. */
  private async onFileShrunk(): Promise<void> {
    if (this.stopped) return;
    const r = await this.resolve();
    if (this.stopped || !r.ok) return;
    this.uuid = r.data.uuid;
    this.send({ type: 'rotated', uuid: r.data.uuid });
    await this.sendBacklogAndTail(r.data);
  }

  /** 2 s poll: uuid change → rotated + fresh backlog; status change → status msg. */
  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const r = await this.resolve();
      // Registry ladder, Task 2: `unmeasurable` returns EARLY, touching
      // NEITHER `this.uuid` NOR the tailer NOR `status` — the open tail keeps
      // streaming, no `rotated` frame fires, and a mid-stream blip is
      // invisible to the operator rather than announced as a rotation or a
      // status flip that never really happened. `absent` gets the identical
      // treatment (this was already true before this type existed: a null
      // `resolve()` was always a silent early return here) — a session that
      // was streaming and got reaped keeps its last frames on screen rather
      // than being yanked mid-read, and one that never resolved at all stays
      // quiet and keeps retrying via this same poll. HONEST LIMIT: neither
      // branch reaches for `this.uuid` to rebuild a transcript path — a
      // remembered uuid paired with whatever this pass DID manage to read is
      // not proven to be the same incarnation, and is a guess wearing a real
      // address (see `resolve()`'s own comment).
      if (this.stopped || !r.ok) return;
      const data = r.data;
      if (data.uuid !== this.uuid) {
        const appeared = this.uuid === null; // record was unknown/unmeasurable at start
        this.uuid = data.uuid;
        if (!appeared) this.send({ type: 'rotated', uuid: data.uuid });
        await this.sendBacklogAndTail(data);
      } else if (await this.repointNeeded(data.resolution)) {
        // §5.3: the uuid did not move but the ANSWER did — a swap landed, or
        // the file this stream was tailing is gone. Fix round 1, MY RULING
        // (Important #3): this is deliberately NOT `rotated`. That frame's
        // only PWA-side effect beyond `uuid`/`offset` bookkeeping is minting a
        // "Session context reset" divider (pwa/src/stores/session.ts) — true
        // for a real clear/compact/swap-onto-a-fresh-uuid, but false here: the
        // uuid did not change, nothing was reset, the stream simply followed
        // the SAME session's history to its new address. On the branch this
        // spec exists to fix — a swap correctly recovering history — telling
        // the operator their context was just reset is the single most
        // alarming false sentence this build could print. `backlog` alone is
        // self-describing (carries `file` and `offset`) and needs no frame
        // beside it; an older client with no `sinceFile` support still just
        // sees a fresh backlog, exactly as it does on first connect.
        await this.sendBacklogAndTail(data);
      }
      if (this.stopped) return;
      if (data.status !== this.status) {
        this.status = data.status;
        this.send({ type: 'status', status: data.status, statusUpdatedAt: data.statusUpdatedAt });
      }
      if (this.stopped) return;
      await this.checkDialog(data.file);
      if (this.stopped) return;
      await this.checkTasks(data.cfgDir, data.uuid);
      if (this.stopped) return;
      await this.checkHookAsk(data.uuid);
      if (this.stopped) return;
      await this.checkMail();
    } finally {
      this.ticking = false;
    }
  }
}

/** What a client has already been told about the pane menu: the dialog id it
 *  last saw, and the enrichment (if any) that rode along with it. */
export interface DialogSeen {
  id: string | null;
  ask: DialogAsk | null;
}

/**
 * The change gate for the `dialog` frame: given what the client last saw and
 * what the pane says now, what (if anything) do we send?
 *
 * It cannot be keyed on `dialog.id` alone. That id is deliberately pane-derived
 * only — `answerDialog` re-parses the pane to check staleness and the sheet keys
 * dismissal off it, so `ask` is excluded from the hash on purpose. But the menu
 * and the transcript that explains it are read by unrelated clocks, so the same
 * menu can be captured bare on one poll and enriched on the next: identical
 * labels, identical title, identical id. An id-only gate calls that a duplicate
 * and drops it, and the client renders scraped labels for the life of the menu.
 *
 * So: send on a new id OR on the first upgrade to an enriched dialog, and never
 * the other way round — a transient read miss must not strip descriptions off a
 * sheet the operator is already reading.
 */
export function nextDialogFrame(
  prev: DialogSeen,
  dialog: Dialog | null,
): { seen: DialogSeen; msg: SessionStreamMsg | null } {
  if (!dialog) {
    if (prev.id === null) return { seen: prev, msg: null };
    return { seen: { id: null, ask: null }, msg: { type: 'dialog_cleared' } };
  }
  const isNew = prev.id !== dialog.id;
  const latched = isNew ? null : prev.ask;       // a new menu forgets the old ask
  const ask = dialog.ask ?? latched;             // and a missed read never downgrades
  const upgraded = ask !== null && latched === null;
  if (!isNew && !upgraded) return { seen: prev, msg: null };
  return {
    seen: { id: dialog.id, ask },
    msg: { type: 'dialog', dialog: ask === null ? dialog : { ...dialog, ask } },
  };
}

/**
 * §5.3's re-point decision, pure: re-point when the answer CHANGED and either
 * the new rung is strictly better or the file being tailed is gone.
 *
 * "Better" is §5.1's rung order, which is why the rung travels in the union
 * rather than being recomputed here. A same-rung, same-path answer changes
 * nothing — the common case every tick — and a worse rung never drags a healthy
 * stream off an exact-address transcript that still exists.
 */
export function shouldRepoint(
  cur: TranscriptResolution, next: TranscriptResolution, tailedExists: boolean,
): boolean {
  if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
  if (rungRank(next) < rungRank(cur)) return true;
  return !tailedExists;
}

/**
 * Every OTHER account's config dir, in roster declaration order — rung 6's
 * input and its tiebreak (§5.1).
 *
 * Read off `cfg.roster.accounts`, which `loadConfig` DERIVES from
 * `~/.ccrc/accounts.json` (see `config.ts`'s own comment on why: a hand-typed
 * copy is how `claude-dev0` was missing for the account's entire life — and
 * `~/.claude-dev0` is precisely where the incident's recovered transcript
 * sits today). Never a literal list of account names in this module
 * (architecture rule (a): config is data).
 *
 * ONLY the session stream builds one. `watch.ts`'s name sweep and
 * `commands.ts` pass no `foreign` at all, because a derived name is written
 * into the row with no banner attached to it (§5.2).
 */
export function foreignConfigDirs(
  cfg: CcrcConfig, own: string,
): { account: string; configDir: string }[] {
  return cfg.roster.accounts
    .filter((a) => a.id !== own)
    .map((a) => ({ account: a.id, configDir: configDirFor(cfg, a.id)! }));
}

/** Parse `since=<uuid>:<offset>` plus its companion `sinceFile=<path>`;
 *  malformed `since` → undefined. The file rides its OWN parameter rather than
 *  a third colon-delimited field: a path may contain a colon, and the offset is
 *  parsed off the LAST one. An absent file is `null`, meaning "this client did
 *  not name one" — honored as today's uuid-only resume, never as a mismatch. */
export function parseSince(
  raw: string | undefined, rawFile?: string | undefined,
): { uuid: string; offset: number; file: string | null } | undefined {
  if (!raw) return undefined;
  const i = raw.lastIndexOf(':');
  if (i <= 0) return undefined;
  const uuid = raw.slice(0, i);
  const offset = Number(raw.slice(i + 1));
  if (!Number.isFinite(offset) || offset < 0) return undefined;
  return { uuid, offset, file: rawFile && rawFile !== '' ? rawFile : null };
}
