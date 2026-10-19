import path from 'node:path';
import { wireHookAsk } from './fleet.js';
import type { Deps } from './server.js';
import type { Bus, Notice } from './bus.js';
import { configDirFor, type CcrcConfig } from './config.js';
import { measuredIdentity, readSessionRecord } from './registry.js';
import { liveSessionStatus, readLiveStateMeasured } from './livestate.js';
import {
  continuesInto, resumedPastMarker, rungRank, TranscriptResolver, type TranscriptResolution,
} from './transcript/resolve.js';
import { readBacklog, TranscriptTailer } from './transcript/tail.js';
import { hasMenu, parseDialog } from './pane/dialog.js';
import { alignAsk, readPendingAsk } from './transcript/ask.js';
import { readTasks } from './tasks/read.js';
import { SessionWorkflows, sessionDirOf } from './workflows/read.js';
import { workflowsFrame, type Proc } from './workflows/model.js';
import { readHookState } from './hookstate.js';
import { askKey } from './askkey.js';
import type { Dialog, DialogAsk, SessionStatus, SessionStreamMsg } from '../../shared/api.js';
import { reviewRows } from '../../shared/ask-menu.js';

const POLL_MS = 2000;
/** Failed captures in a row after which the menu the client holds is cleared (decision `ask-failed-capture-holds`):
 *  three polls, at least 6 s of the pane unreadable. One or two are the blips a slow remote call produces. */
const FAILED_CAPTURES_CLEAR = 3;
const BACKLOG_N = 50;
const SGR = /\x1b\[[0-9;]*m/g; // same idiom as inject/send.ts:80 — see checkDialog's own comment

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
  /** D-5561: the session's Claude Code process as this resolve measured it —
   *  the workflow reader's orphan rule needs `gone` apart from `unknown` (a
   *  substrate fault is not a dead process) and the live file's `startedAt`.
   *  `status` above keeps its own deliberate fold (D-309). */
  proc: Proc;
}

/**
 * `resolve()`'s own three-way (registry ladder, Task 2) — `SingleRead`'s
 * (registry.ts) answers folded into this stream's `ok`+`reason`, deliberately
 * not a new vocabulary. `ok: false, reason: 'unmeasurable'` covers BOTH of
 * `SingleRead`'s own `unlistable` (the whole-directory collapse — the LARGER
 * cousin of a degraded row, and just as much not proof this session is
 * gone) and a listed-but-degraded identity triple (`measuredIdentity`
 * answering null): in either case this read simply could not say, so the
 * client is told to wait, never that the session is unknown.
 * `ok: false, reason: 'absent'` covers a PROVEN absence (`SingleRead`'s own
 * `absent`), an id `isRegistryId` refuses (`SingleRead`'s `bad-id`, spec
 * §2.3), and the wrapper/config-dir mapping gap this function has always
 * folded into the same answer (see its own comment below) — none is
 * registry-unmeasurable, so retrying this same 2 s poll can never heal
 * any of them.
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
  /** When the running poll started (`tick`), for the frame log's `tick=`; null between polls. */
  private tickStartedAt: number | null = null;
  private uuid: string | null = null;
  private status: SessionStatus | null = null;
  /** What the client last saw of the pane menu — see nextDialogFrame. */
  private seenDialog: DialogSeen = { id: null, ask: null, raw: null };
  /** Failed captures in a row since the last reading of the pane (decision `ask-failed-capture-holds`). */
  private failedCaptures = 0;
  /** Bumped on every `answered:<id>` this stream handles; a poll reading taken under an older value read the pane
   *  from before that answer and is dropped (decision `ask-stale-poll-dropped`). */
  private answeredGen = 0;
  /** The transcript state that already failed to explain the menu on screen —
   *  see claimAskRead. */
  private askProbe: { file: string; id: string; size: number; mtimeMs: number } | null = null;
  /** Serialized last-sent task list — the change gate for the `tasks` frame. */
  private lastTasksJson: string | null = null;
  /** D-5560: the workflow reader for the session dir now being tailed (a new
   *  one when the transcript moves: /clear, compaction, an account swap), the
   *  rows the client was last sent, and the change gate for the `workflows`
   *  frame. `undefined` until the first read, for `lastMailJson`'s reason: a
   *  `ReconnectingSocket` reconnect keeps the client's rows, so a workflow that
   *  finished while it was away would stay on screen as running if an empty
   *  first read were swallowed — so a session that HAS a workflow directory
   *  states its first read, empty included. The one first read swallowed is
   *  `absent` with no witness: this session dir never had a workflow, so a
   *  client can hold no rows from it: the client drops its rows on every
   *  `backlog` (`pwa/src/stores/session.ts`) — the frame that comes whenever the
   *  session dir can have changed (a /clear, a swap, a reconnect onto another
   *  file) — and `sendBacklogAndTail` resets this gate with it. */
  private workflows: SessionWorkflows | null = null;
  private shownWorkflows: SessionStreamMsg & { type: 'workflows' } = { type: 'workflows', workflows: [] };
  private lastWorkflowsJson: string | undefined = undefined;
  /** Whether this connection has sent a `workflows` frame yet (see above). */
  private sentWorkflows = false;
  /** The hook's last fresh Stop listed a `workflow` among its background kinds
   *  (D-5231's pair, read by `checkHookAsk`). The one witness that a workflow
   *  exists when its directory does not — see `checkWorkflows`. */
  private hookWorkflowBackground = false;
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
   *  §5.3's re-point comparison. Null until the first tailer exists.
   *
   *  KEPT CURRENT for the file it names (D-4947): a later answer for the SAME
   *  path at the same rung replaces it (`tick`'s no-move arm) — keeping a
   *  decline that a later FAILED read could not see again — because what a
   *  re-ladder learns about that file — the successor its marker names
   *  (`declinedTo`), a tail it could not read — is exactly what
   *  `registryCaughtUp` must see when `ccd` moves the registry. The tailer
   *  itself is untouched: same file, same offset.
   *
   *  And one fact only the STREAM can add (#189 re-review, SV-2): when the
   *  registry moves onto a successor this file leads to but nothing has
   *  been written to yet, `keepsTailer` keeps this file on screen and names
   *  that successor in `declinedTo` — the stream declined it, exactly as a
   *  walk declines an empty successor — so `shouldRepoint` can move forward
   *  to it once it has content. */
  private tailed: TranscriptResolution | null = null;

  /** Predecessor answers whose tail `repointFacts` MEASURED as not resumed
   *  (`resumedPastMarker` -> `not-shown`), held by IDENTITY. The resolver's
   *  memo hands back the same answer object for as long as that file's stamp
   *  holds, and a new one once its walk re-runs. So a predecessor served
   *  clean tick after tick (its window holds no deciding line) is read once,
   *  not every 2 s, and one that changes is read again as soon as the memo
   *  re-walks it. Only "not shown" is kept: it can delay an un-follow by the
   *  memo's two-poll gate, never cause one. */
  private readonly notResumed = new WeakSet<TranscriptResolution>();

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

  /** Decision `ask-answer-returns-next-screen`: an answer route saw the pane move to `next` (null: no menu). It goes
   *  through the same gate as a poll's reading (`nextDialogFrame`), so this stream's record of what its client saw stays
   *  true, and a later poll that finds the screen gone still says so. Every open stream of the session gets it, so a
   *  second tab moves with the one that answered. */
  private readonly onAnswered = (next: Dialog | null): void => {
    if (this.stopped) return;
    this.answeredGen += 1;
    this.frame(next, 'answer');
  };

  /** Send what `dialog` (a reading of the pane, or null for no menu) changes for the client, if anything, and log it. */
  private frame(dialog: Dialog | null, from: 'poll' | 'answer'): void {
    const { seen, msg } = nextDialogFrame(this.seenDialog, dialog);
    this.seenDialog = seen;
    if (!msg) return;
    console.log(dialogFrameLine(this.id, msg, from, this.tickStartedAt === null ? null : Date.now() - this.tickStartedAt));
    this.send(msg);
  }

  constructor(
    private readonly deps: Deps,
    private readonly bus: Bus,
    private readonly id: string,
    private readonly send: (m: SessionStreamMsg) => void,
    /** `file` is the transcript the client's `offset` was taken in (§5.3).
     *
     *  OPTIONAL, and the omission is a REAL exposure, not a shrug. A client
     *  that names no file gets the uuid-only resume, and since §5.1's ladder
     *  a uuid can resolve to several files — so this build honours a byte
     *  offset against whatever the ladder answers NOW. Before the ladder one
     *  uuid meant one file and that was safe; the ladder is what made it
     *  unsafe, so "no worse than before" would be false. What it costs when
     *  it goes wrong was measured: a resume at byte 6620 of a different file
     *  stitches the tail of the carried copy onto the head of the stranded
     *  one, in one continuous conversation, with the real messages before it
     *  silently absent. It self-heals only when the new file is SMALLER than
     *  the stale offset (the tailer's truncation check); a growing
     *  conversation goes through in silence.
     *
     *  The PWA sends it (`pwa/src/stores/session.ts`'s `connect()`), so the
     *  exposure was a browser holding a build from before that — one reload
     *  wide — and `start()` below refuses to trust a bare uuid match when the
     *  echo is present and disagrees. An earlier version of this comment said
     *  "Task 12 closes it": Task 12 is the PWA task on this branch, its brief
     *  never mentioned `sinceFile`, and it shipped without it. Nothing closed
     *  it until the final review found the client half missing.
     *
     *  THAT WINDOW IS NOW CLOSED TOO, by the offset rather than by the echo:
     *  `start()` honours a null echo only at offset 0, the only offset either
     *  legitimate no-file moment can carry. A stale build's non-zero offset
     *  gets the backlog. This is why the parameter is still optional and why
     *  its absence is still not a mismatch — a client with no file is a real
     *  state, and it is a state with no offset to protect. */
    private readonly since?: { uuid: string; offset: number; file?: string | null },
  ) {
    this.transcripts = new TranscriptResolver(deps.io);
  }

  async start(): Promise<void> {
    this.bus.on('notice', this.onNotice);
    this.bus.on(`session:${this.id}`, this.onSessionMsg);
    this.bus.on(`answered:${this.id}`, this.onAnswered);
    const r = await this.resolve();
    if (this.stopped) return;
    if (r.ok) {
      this.uuid = r.data.uuid;
      this.status = r.data.status;
      this.tailed = r.data.resolution;
      const echoed = this.since?.file ?? null;
      if (this.since && this.since.uuid === r.data.uuid
        && (echoed === null ? this.since.offset === 0 : echoed === r.data.file)) {
        // Resume — no backlog. A MATCHING echo proves the offset belongs to the
        // file about to be tailed; a NULL echo is trusted only at offset 0,
        // which is what closes §5.3's compatibility window rather than
        // disclosing it (see the `since` parameter above). `parseSince` cannot
        // tell "the parameter was absent" from "this client has no file" —
        // both are `file: null` — but the two moments a client legitimately
        // has none are both offset 0: before its first backlog there is no
        // `since` at all, and between a `rotated` and its backlog the offset
        // was reset to 0 and the server sends that backlog on its very next
        // statement. So a non-zero offset with no file named is a client that
        // HAD one and cannot say so — a stale build — and it gets the full
        // backlog instead of an offset honoured against a file nobody agreed
        // on. It costs a current client nothing.
        this.startTailer(r.data.file, r.data.uuid, this.since.offset);
      } else {
        await this.sendBacklogAndTail(r.data);
      }
      if (this.stopped) return;
      // THE OPENING STATEMENT of a channel that otherwise only reports change.
      // `tick()` below speaks when the reading MOVES, against the seed two
      // branches up — a seed the client cannot see. So every reconnect used to
      // reseed this side silently while the PWA kept whatever status a
      // PREVIOUS connection had left in its store (one store per session id,
      // for the life of the tab: `pwa/src/stores/session.ts`'s
      // `getSessionStore`, written by this frame and nothing else).
      //
      // MEASURED 2026-09-10 on `expoAI-assistant-warm-cove`: a lane swap left
      // the pane gone for 4.8s, the client watching it was told `dead`, and
      // the socket that would have corrected it on its next poll was replaced
      // rather than kept (the screen reopened, the phone woke, the agent
      // restarted — every exec unmeasurable, D-309's collapse to dead). The
      // operator then read "Not running — the chat is read-only" over a
      // disabled composer for 50 minutes, in the same view that was streaming
      // that session's live transcript.
      //
      // "It heals on the next change" is no answer, and the same measurement
      // says why: that pane's reading sat at `busy` from 10:20:23 to 11:24:00
      // — 63 minutes — because the session was inside ONE turn (a verification
      // battery). Nothing about that is particular to a lane or a wrapper; any
      // long turn is an hour in which this channel has nothing to say.
      //
      // Every sibling channel on this socket already cold-starts — backlog,
      // dialog, tasks, hook ask, mail — and `/ws/fleet` sends a whole snapshot
      // per connection (server.ts). This is the one that did not.
      //
      // AFTER the backlog, and only on `ok`. The transcript is what the screen
      // was opened for, and the two degraded arms below have no reading to
      // state: `status`'s own default is `dead`, so cold-starting it from an
      // unmeasured resolve would paint the read-only banner over a session
      // this box merely failed to read — the same defect, inverted.
      this.send({ type: 'status', status: r.data.status, statusUpdatedAt: r.data.statusUpdatedAt });
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
    if (r.ok) await this.checkWorkflows(r.data.file, r.data.proc); // and the workflows running now
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
    // Decision `ask-stale-poll-dropped`: the generation this capture started under. An answer handled while it (or the
    // transcript read below) was in flight already told the client where the pane went, from a later look than this
    // one; framing this reading would send the answered screen back over it.
    const gen = this.answeredGen;
    const pane = await this.deps.tmux.capture(this.id);
    if (this.stopped || gen !== this.answeredGen) return;
    // Decision `ask-failed-capture-holds`: a failed capture (tmux, or the remote call behind it, returned nothing) is
    // NO READING, not "no menu". Clearing on it is what put the 2026-10-16 sheet on "Open terminal to answer" with the
    // review still on the pane. Nothing is framed and `seenDialog` is kept, so the menu the client holds stays and a
    // later reading of the same menu sends nothing. Only FAILED_CAPTURES_CLEAR failures in a row clear it: a pane tmux
    // can no longer read at all is not offering a menu (an answer to it is refused `not-alive`), and the sheet must not
    // hold one forever. A session the registry reports gone never reaches here (`tick` returns early).
    if (pane === null) {
      this.failedCaptures += 1;
      if (this.failedCaptures >= FAILED_CAPTURES_CLEAR) {
        this.askProbe = null;
        this.frame(null, 'poll');
      }
      return;
    }
    this.failedCaptures = 0;
    // hasMenu, not paneState() === 'menu': paneState tests BUSY_RE across the
    // WHOLE pane, and an RC-off pane renders the busy marker WHILE a dialog is
    // painted below it (fleet.ts's liveStatus doc) — so paneState would answer
    // 'busy' here and this call site would suppress the parse forever. hasMenu
    // is deliberately independent of the busy check for exactly that reason
    // (pane/dialog.ts:42-54); it's the same idiom send.ts:320 uses to decide
    // whether a menu owns the keyboard. SGR strip mirrors that idiom, though
    // tmux.capture() (-p, no -e) carries no escape codes to strip today, unlike
    // captureAnsi().
    let dialog = hasMenu(pane.replace(SGR, '')) ? parseDialog(pane) : null;
    // Read the transcript only while this menu is still unexplained. Once its ask
    // is latched, re-reading costs a 256 KB tail every 2 s and can buy nothing:
    // nextDialogFrame would suppress the frame anyway. Menus that never latch are
    // held off by claimAskRead instead — they are the majority.
    const latched = dialog !== null && this.seenDialog.id === dialog.id && this.seenDialog.ask !== null;
    if (dialog?.parsed && file !== null && !latched) {
      const st = await this.deps.io.stat(file);
      if (this.stopped || gen !== this.answeredGen) return;
      if (this.claimAskRead(file, dialog.id, st)) {
        const questions = await readPendingAsk(this.deps.io, file);
        if (this.stopped || gen !== this.answeredGen) return;
        const ask = questions === null ? null : alignAsk(dialog.options, questions);
        // Enrichment rides ALONGSIDE the scraped options — it never rewrites them.
        // `id` stays a hash of the pane alone (answerDialog re-parses the pane to
        // check staleness) and the keystrokes an answer sends stay positional.
        if (ask !== null) dialog = { ...dialog, ask };
      }
    }
    // The probe is scoped to the PARSED menu on screen, so it dies with it. A
    // capture can miss a menu that is still there: tmux returns null (held above,
    // so the probe survives it until FAILED_CAPTURES_CLEAR), one stray
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
    this.frame(dialog, 'poll');
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
   *  same-rung/same-path case is what keeps a healthy tick free.
   *
   *  "GONE" MEANS A PROVEN ENOENT, NOTHING LESS (D-4946). The folded `stat`
   *  answered one `null` for "absent" and for "this stat failed", and
   *  `shouldRepoint`'s last clause re-points away from a file that is gone —
   *  so one unreadable stat of a successor the stream was already reading
   *  (one agent RPC timing out, in remote mode) re-pointed it onto the best
   *  file the re-ladder had left: the frozen pre-fork transcript, backwards.
   *  An unmeasured file is still there as far as anyone knows; the next tick
   *  asks again.
   *
   *  The fork clauses' two facts (`RepointFacts`) are measured here too, each
   *  ONLY when its clause is the one deciding — a predecessor answer that is
   *  clean (one read of its tail, once per answer: `notResumed`), or the
   *  successor the tailed file declined (one stat) — so neither costs a
   *  healthy tick anything. */
  private async repointNeeded(next: TranscriptResolution): Promise<boolean> {
    const cur = this.tailed;
    if (cur === null) return false;
    if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;  // no stat
    const st = await this.deps.io.statMeasured(cur.path);
    return shouldRepoint(cur, next, st.ok || st.reason !== 'absent', await this.repointFacts(cur, next));
  }

  /** `shouldRepoint`'s io-bound facts, for exactly the shapes its fork
   *  clauses decide (see `RepointFacts`). */
  private async repointFacts(cur: TranscriptResolution, next: TranscriptResolution): Promise<RepointFacts> {
    if (cur.kind !== 'found' || next.kind !== 'found' || cur.uuid === next.uuid) return {};
    if (cur.followedFrom?.includes(next.uuid) === true) {
      // An answer that could not read the predecessor, or that read its
      // marker and declined, is not one that says it was resumed.
      if (next.tailUnmeasured === true || next.declinedTo !== undefined) return {};
      if (this.notResumed.has(next)) return {};
      const v = await resumedPastMarker(this.deps.io, next.path, next.uuid);
      if (v === 'not-shown') this.notResumed.add(next);
      return { predecessorResumed: v === 'resumed' };
    }
    if (cur.declinedTo === next.uuid) return { successorHasContent: await this.hasContent(next.path) };
    return {};
  }

  /** A MEASURED non-empty file. Unreadable is not "has content". */
  private async hasContent(file: string): Promise<boolean> {
    const st = await this.deps.io.statMeasured(file);
    return st.ok && st.size > 0;
  }

  /** Read the session's task list and send it when it differs from what this
   *  client last saw. An empty list is a legitimate value — it's how the strip
   *  learns a plan was cleared — but the opening no-tasks read is swallowed by
   *  the initial `lastTasksJson === null` case below, so sessions that never
   *  keep a task list never send a frame at all.
   *
   *  `read.unmeasured` (D-115) is deliberately NOT carried onto the wire here,
   *  and this is the one of `readTasks`' three call sites where the count has
   *  nothing to spend itself on. The `tasks` frame is ROWS — `TaskStrip`
   *  renders one line per `TaskItem` and tallies "2 running · 1 left · 4 ✓"
   *  from them — and a file whose bytes never arrived has no subject, no
   *  status and no activeForm, so there is no row to send and no honest count
   *  to fold into a summary built out of rows. The surface that DOES show a
   *  denominator is the fleet card's `done/total`, and that one comes from
   *  `taskProgress` in `watch.ts`, where the count lands. Additive-only means
   *  a new field is allowed, not that an unrendered one earns its place: the
   *  one field added since, `touchedAt` (D-5372), is rendered — it is how the
   *  strip tells a live plan from one left open days ago. */
  private async checkTasks(cfgDir: string, uuid: string): Promise<void> {
    if (this.stopped) return;
    // D-5372: `touchedAt` rides the frame (optional) and joins the dedupe key,
    // so a rewrite that leaves the rows equal still refreshes the strip's age.
    const { tasks, touchedAt } = await readTasks(this.deps.io, cfgDir, uuid, { touchedAt: true });
    if (this.stopped) return;
    const json = JSON.stringify([tasks, touchedAt ?? null]);
    if (json === this.lastTasksJson) return;
    if (this.lastTasksJson === null && tasks.length === 0) {
      this.lastTasksJson = json;
      return;
    }
    this.lastTasksJson = json;
    this.send({ type: 'tasks', tasks, ...(typeof touchedAt === 'number' ? { touchedAt } : {}) });
  }

  /** D-5560/D-5561: read the session's workflows (`workflows/read.ts`) and
   *  send them when they differ from what this client last saw. What a read
   *  becomes is `workflowsFrame`'s decision (model.ts) — absent, unreadable and
   *  read are three frames, never folded; this method only carries it.
   *  Read-only: nothing here starts, stops or changes a workflow. */
  private async checkWorkflows(file: string, proc: Proc): Promise<void> {
    if (this.stopped) return;
    const dir = sessionDirOf(file);
    if (this.workflows?.sessionDir !== dir) {
      this.workflows = new SessionWorkflows(this.deps.io, dir);
      this.shownWorkflows = { type: 'workflows', workflows: [] };
    }
    const read = await this.workflows.read(proc, Date.now());
    if (this.stopped) return;
    const decided = workflowsFrame(read, this.hookWorkflowBackground, this.shownWorkflows.workflows);
    const frame: SessionStreamMsg & { type: 'workflows' } = decided.unreadable
      ? { type: 'workflows', workflows: decided.workflows, unreadable: true }
      : { type: 'workflows', workflows: decided.workflows };
    const json = JSON.stringify(frame);
    if (json === this.lastWorkflowsJson) return;
    const neverHad = read.kind === 'absent' && !decided.unreadable;
    this.lastWorkflowsJson = json;
    if (neverHad && this.sentWorkflows === false) return;
    this.sentWorkflows = true;
    if (frame.unreadable !== true) this.shownWorkflows = frame;
    this.send(frame);
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
    this.hookWorkflowBackground = hs?.background?.kinds.includes('workflow') === true;
    const ask = hs?.ask ?? null;
    const json = ask === null ? null : JSON.stringify(ask);
    if (json === this.lastAskJson) return;
    this.lastAskJson = json;
    // D-5298 (spec §6.7): an approval's summary leaves redacted (`wireHookAsk`); the key is the envelope's own.
    this.send(ask === null ? { type: 'ask_cleared' } : { type: 'ask', ask: wireHookAsk(ask), key: askKey(ask) });
  }

  stop(): void {
    this.stopped = true;
    this.bus.off('notice', this.onNotice);
    this.bus.off(`session:${this.id}`, this.onSessionMsg);
    this.bus.off(`answered:${this.id}`, this.onAnswered);
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
    switch (read.kind) {
      case 'found': break;
      // `unlistable` is the SAME whole-fleet collapse `RegistryRead`'s own
      // `listed: false` types elsewhere in this build — it proves nothing
      // about whether THIS id exists, only that this read could not say.
      // Only a proven `absent` earns the terminal "unknown session".
      case 'unlistable': return { ok: false, reason: 'unmeasurable' };
      case 'absent': return { ok: false, reason: 'absent' };
      // An id `isRegistryId` refuses (spec §2.3) is terminal too: it never
      // heals by polling, so no poll is installed. It answers exactly as
      // `absent` does, by design, so folding it there changes nothing
      // observable; its pin is `readSessionRecord`'s zero-listing case.
      case 'bad-id': return { ok: false, reason: 'absent' };
      default: {
        const _x: never = read;
        return _x;
      }
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
    // D-5561: one `has-session`, as before — its verdict kept, because the
    // workflow reader must not read a substrate fault (`unknown`) as a process
    // that died mid-run. `status` folds it exactly as `hasSession` did.
    const verdict = (await this.deps.tmux.sessionVerdict(this.id)).verdict;
    let proc: Proc = verdict === 'gone' ? { kind: 'gone' } : { kind: 'unmeasured' };
    // D-309 (was D-B8-13): `unknown` deliberately reads as not-alive here, so the chat
    // header shows 'dead' during a substrate fault — display-only, and the
    // same deferred product decision as assembleFleet's (see fleet.ts).
    if (verdict === 'live') {
      status = 'idle';
      const pid = await this.deps.tmux.panePid(this.id);
      if (pid === null) {
        // D-5275: mirror `assembleFleet` (D-5234). The pane is alive and its
        // pid read FAILED, which measured nothing about the session; the card
        // paints that `busy`, so the header does too — the D-115 mirror rule
        // below. `statusUpdatedAt` stays null and `cwd` at the registry's.
        status = 'busy';
      } else {
        // D-115, the chat half of the same fix `assembleFleet` takes (see its
        // block in fleet.ts for the full argument). The folded read answered
        // ONE null for four conditions and this block spent it as "leave
        // `status` at the `alive` default" — `'idle'` — so the header over an
        // open transcript said the session was at rest when the truth was
        // that its `<pid>.json` could not be read at all.
        //
        // MIRRORED RATHER THAN INVENTED HERE: these two surfaces are two
        // renderings of one measurement, and a fleet card reading `busy`
        // beside a chat header reading `idle` for the same session in the
        // same second is worse than either answer on its own — the operator
        // has no way to tell which one to believe.
        const read = await readLiveStateMeasured(this.deps.io, cfgDir, pid);
        if (read.ok) {
          if (read.state.cwd) cwd = read.state.cwd;
          status = liveSessionStatus(read.state.status);
          statusUpdatedAt = read.state.statusUpdatedAt;
          proc = { kind: 'live', startedAt: read.state.startedAt };
        } else if (read.reason === 'unmeasured') {
          // `status` ALONE moves. `cwd` stays at the registry's `workdir` and
          // `statusUpdatedAt` stays null: an unmeasured read has no fields to
          // report, and `statusUpdatedAt` is what the header renders as the
          // `· 1m ago` beside the word — a fabricated one would put a fresh
          // timestamp under a status nobody measured. `no-state` (absent, or a
          // well-formed record naming no session — a torn body is unmeasured
          // since D-5234) still leaves this at `idle`,
          // which is the ordinary shape for a pane that has published
          // nothing yet.
          status = 'busy';
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
      data: { uuid: identity.uuid, file: resolution.path, resolution, cfgDir, status, statusUpdatedAt, proc },
    };
  }

  /**
   * Send the last-N backlog (missing:true when the transcript doesn't exist
   * yet — the stream stays up and the tailer picks the file up on appearance),
   * then tail from the end of what the backlog covered.
   */
  private async sendBacklogAndTail(r: Resolved): Promise<void> {
    // ONE stat, not two (D-1399). `missing` used to come from a second
    // `io.stat` right here, so this method and `readBacklog` could stat the
    // same path a moment apart and disagree; and that stat's `null` asserted
    // absence for conditions nobody measured (D-114).
    const { events, offset, missing, measured } = await readBacklog(this.deps.io, r.file, BACKLOG_N);
    if (this.stopped) return;
    this.tailed = r.resolution;
    // D-5560: the client drops its workflow rows on every backlog (a backlog is
    // where the session dir can change under it), so the next workflows read
    // is a FIRST read again and is stated — see `lastWorkflowsJson`.
    this.lastWorkflowsJson = undefined;
    this.sentWorkflows = false;
    this.send({
      type: 'backlog', uuid: r.uuid, events, offset, file: r.file, missing,
      fileMeasured: measured,
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

  /** Does the tailed file's own `continued-in` chain lead to `uuid`? The
   *  witness `tick` asks when the registry moves and `registryCaughtUp` has
   *  no held fact for it (D-4947). A tailed fallback has no file to ask. */
  private async tailedContinuesInto(uuid: string, next: TranscriptResolution): Promise<boolean> {
    const cur = this.tailed;
    if (cur === null || cur.kind !== 'found') return false;
    return continuesInto(this.deps.io, cur, uuid, next.kind === 'found' ? [path.dirname(next.path)] : []);
  }

  /**
   * A registry move `tick` already called a continuation: keep the open tailer
   * rather than open `next`? Yes, while the tailed file still exists (only a
   * proven ENOENT is gone, D-4946), when `next` is:
   *
   *   - a link BEHIND the tailed file — a uuid it was followed FROM (SV-1).
   *     `ccd` advances one hop per quiescence, so a stream that followed
   *     A->B->C sees the registry land on B, and a walk from B that cannot
   *     read B's tail answers B. That is `shouldRepoint`'s backward refusal,
   *     which this branch skipped. A B that was really resumed past its
   *     marker is re-pointed to on the next tick, by that same rule.
   *   - a `fallback`, or a file with NO CONTENT — empty, or not measured
   *     (SV-2). `ccd`'s resume path could name a successor a live background
   *     job holds but has not written (D-4944); the walk itself never trades
   *     a file with content for that, and a backlog of it replaced the whole
   *     conversation with an empty chat.
   *
   * When the registry's uuid is DOWNSTREAM of the tailed file (the move was
   * explained by its decline or its marker chain, not by a link it was
   * followed through), the kept answer records it as `declinedTo`: that
   * successor's later answer comes off its own ladder with no `followedFrom`,
   * and the decline is what lets `shouldRepoint` move forward to it once it
   * has content. The stream's frames keep the uuid the tailer was opened
   * under until the next backlog; a reconnect in that window is answered
   * with a backlog, never a stitched offset.
   *
   * Paid only on a registry move this stream already calls a continuation:
   * at most one stat of `next` and one of the tailed file. A keep onto a link
   * BEHIND has a tail too: the memo serves that link's flagged answer for its
   * back-off, and `repointNeeded` stats the tailed file on each of those
   * ticks — one `statMeasured` per tick, for at most `RESOLVER_BACKOFF_MS`
   * (measured; the base sent the link's backlog instead and tailed it).
   */
  private async keepsTailer(registryUuid: string, next: TranscriptResolution): Promise<boolean> {
    const cur = this.tailed;
    if (cur === null || cur.kind !== 'found' || cur.path === next.path) return false;
    const behind = next.kind === 'found' && next.uuid !== cur.uuid && cur.followedFrom?.includes(next.uuid) === true;
    if (!behind && next.kind === 'found' && await this.hasContent(next.path)) return false;
    const st = await this.deps.io.statMeasured(cur.path);
    if (!st.ok && st.reason === 'absent') return false;
    const downstream = registryUuid !== cur.uuid && cur.followedFrom?.includes(registryUuid) !== true;
    if (downstream) this.tailed = { ...cur, declinedTo: registryUuid };
    return true;
  }

  /** 2 s poll: uuid change → rotated + fresh backlog; status change → status msg. */
  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    this.tickStartedAt = Date.now();
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
        // THE REGISTRY CATCHING UP IS NOT A RESET (whole-branch review, F2).
        // This branch fires on the REGISTRY uuid, and the registry is not
        // where a fork is first seen: `resolveTranscript` followed the
        // `continued-in` pointer the moment the successor had a byte in it,
        // so this stream may already be tailing that successor's file while
        // `$REG/<id>.uuid` still names the transcript it was forked from
        // (`resolveTranscript`'s own docstring states that asymmetry). `ccd`
        // then walks the same pointer at ONE HOP PER QUIESCENCE — so a
        // two-hop chain A->B->C moves the registry twice over ~20 seconds,
        // and each move lands here.
        //
        // Without this test each of those moves sends `rotated`, and
        // `rotated`'s only PWA-side effect beyond uuid/offset bookkeeping is
        // minting a "Session context reset" divider that the following
        // backlog deliberately keeps on top (pwa/src/stores/session.ts) — so
        // the operator's just-recovered conversation collects one to three
        // false reset dividers, seconds after the follow correctly healed it.
        // The spec calls that the most alarming false sentence this build
        // could print, and the re-point branch below already refuses it for
        // the same reason.
        //
        // The discriminator is the TRANSCRIPT, not the uuid: when the newly
        // resolved path is the one already being tailed, nothing moved and
        // nothing was reset — the registry merely agreed with a supersession
        // this stream had already followed. Send the backlog alone, exactly
        // as the re-point branch does; it carries `uuid`, `file` and `offset`
        // and is self-describing. A registry uuid that moves to a DIFFERENT
        // file is still a real rotation (a `/clear`, a compaction, a swap
        // onto a fresh uuid) and still says so.
        //
        // AND THE TRANSCRIPT IS NOT THE ONLY WITNESS (D-4947). The path test
        // only sees the order where this stream followed FIRST. Measured
        // (#189 review, S2): when the successor is written a few seconds after
        // the marker, this stream's re-ladder declines it and waits out its
        // 30 s back-off, `ccd` reads the file meanwhile and moves the
        // registry FIRST — and the path test called that a rotation. So did a
        // chain longer than `MAX_CONTINUATION_HOPS`, where this stream stops
        // hops AHEAD of the registry and the registry's own walk lands one
        // file further. `registryCaughtUp` asks the answer being tailed
        // whether the registry's new uuid is on its own chain.
        //
        // AND WHEN NOTHING HELD EXPLAINS THE MOVE, THE TAILED FILE IS ASKED
        // (#189 fix-forward, probes P2early/P2twohop). The registry can read a
        // marker before this stream does — a delayed tick (a loaded box,
        // remote mode) lets `ccd` move first, so `tailed` predates the marker
        // and names no decline — or move twice in one gap, past the decline
        // it does name. The marker on the tailed file, followed within the
        // hop bound, is the witness both cases leave; `continuesInto` reads
        // it. Paid only on a move no held fact explains, which is otherwise a
        // real rotation: one stat and one tail read of a file with no marker.
        //
        // AND A CONTINUATION NEVER TRADES THE FILE ON SCREEN FOR LESS (#189
        // re-review, SV-1/SV-2). Catching up is not the same as having
        // something better to show, and this branch used to open whatever the
        // registry's new uuid resolved to the moment the move was called a
        // continuation — a link BEHIND the followed file whose tail read
        // failed this once, or a successor with nothing written yet.
        // `keepsTailer` decides, by the re-point rule's own terms.
        const caughtUp = registryCaughtUp(this.tailed, data.uuid, data.resolution)
          || (!appeared && await this.tailedContinuesInto(data.uuid, data.resolution));
        if (this.stopped) return;
        const keep = !appeared && caughtUp && await this.keepsTailer(data.uuid, data.resolution);
        if (this.stopped) return;
        this.uuid = data.uuid;
        if (!appeared && !caughtUp) this.send({ type: 'rotated', uuid: data.uuid });
        if (!keep) await this.sendBacklogAndTail(data);
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
      } else if (this.tailed !== null && this.tailed.path === data.resolution.path
        && rungRank(this.tailed) === rungRank(data.resolution)) {
        // Nothing moved — same file, same rung, same tailer — but the answer
        // may know more about that file than the one it replaces: the
        // successor its marker names, or that its tail could not be read
        // (D-4947, see `tailed`). Without this, `tailed` kept the answer from
        // BEFORE the fork, and a registry move onto the declined successor
        // was judged against a file that had never been seen to carry a marker.
        //
        // A DECLINE OUTLIVES A READ THAT FAILED (#189 fix-forward, probe R1).
        // An answer that could not read the file's tail knows LESS than one
        // that read its marker, not something different: a decline learned
        // from a MEASURED read stays true until a later measured read says
        // otherwise. Replacing `tailed` outright threw that away — after the
        // back-off the re-walk's read of A failed, A{tailUnmeasured}
        // overwrote A{declinedTo B}, and ccd's move onto B then sent
        // `rotated`. A MEASURED answer still replaces it whole: a file that
        // was resumed past its marker (a finished turn after it, D-4940)
        // really has stopped naming it.
        const held = this.tailed;
        const next = data.resolution;
        this.tailed = next.kind === 'found' && next.tailUnmeasured === true && next.declinedTo === undefined
          && held.kind === 'found' && held.declinedTo !== undefined
          ? { ...next, declinedTo: held.declinedTo }
          : next;
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
      await this.checkWorkflows(data.file, data.proc);
      if (this.stopped) return;
      await this.checkMail();
    } finally {
      this.ticking = false;
      this.tickStartedAt = null;
    }
  }
}

/**
 * The journal line for one `dialog`/`dialog_cleared` frame a session stream sends (decision `dialog-frame-log`). Until
 * it, nothing on either box recorded what the sheet was told, so the 2026-10-16 report could only be settled by asking
 * the operator what the sheet showed. One line per frame actually sent, never per poll:
 * `ccrc-server: dialog-frame <session> <kind> <id8> from=<poll|answer> tick=<ms|->`.
 * - `kind`: `cleared`, `review` (`reviewRows`), `multi` (`Dialog.multi`), `unparsed`, or `question`;
 * - `tick`: how far into its poll the stream was when it sent the frame (`-` for an answer's frame, sent between polls).
 * Ids and kinds only: no pane text, no labels.
 */
export function dialogFrameLine(id: string, msg: SessionStreamMsg, from: 'poll' | 'answer', tickMs: number | null): string {
  let kind = 'cleared';
  let short = '-';
  if (msg.type === 'dialog') {
    const d = msg.dialog;
    short = d.id.slice(0, 8);
    kind = reviewRows(d) !== null ? 'review' : d.multi !== undefined ? 'multi' : d.parsed ? 'question' : 'unparsed';
  }
  return `ccrc-server: dialog-frame ${id} ${kind} ${short} from=${from} tick=${tickMs === null ? '-' : String(tickMs)}`;
}

/** What a client has already been told about the pane menu: the dialog id it
 *  last saw, the enrichment (if any) that rode along with it, and — for an
 *  UNPARSED dialog only, null otherwise — the raw pane it was sent. */
export interface DialogSeen {
  id: string | null;
  ask: DialogAsk | null;
  raw: string | null;
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
 *
 * And send again when an UNPARSED dialog repaints under the same id. Its raw
 * pane is the only picture of it the phone has (`DialogSheet.tsx` shows it in
 * a well), and a multi-select keeps one id while its boxes are ticked at the
 * terminal (`parseDialog`: that id is what the push edge-triggers on), so an
 * id-only gate froze the well at its first capture with every box unticked.
 * The phone replaces its dialog on every frame and keys dismissal on the id,
 * so the refresh never re-opens a sheet the operator closed.
 */
export function nextDialogFrame(
  prev: DialogSeen,
  dialog: Dialog | null,
): { seen: DialogSeen; msg: SessionStreamMsg | null } {
  if (!dialog) {
    if (prev.id === null) return { seen: prev, msg: null };
    return { seen: { id: null, ask: null, raw: null }, msg: { type: 'dialog_cleared' } };
  }
  const isNew = prev.id !== dialog.id;
  const latched = isNew ? null : prev.ask;       // a new menu forgets the old ask
  const ask = dialog.ask ?? latched;             // and a missed read never downgrades
  const upgraded = ask !== null && latched === null;
  const repainted = !dialog.parsed && prev.raw !== dialog.raw;
  if (!isNew && !upgraded && !repainted) return { seen: prev, msg: null };
  return {
    seen: { id: dialog.id, ask, raw: dialog.parsed ? null : dialog.raw },
    msg: { type: 'dialog', dialog: ask === null ? dialog : { ...dialog, ask } },
  };
}

/**
 * §5.3's re-point decision, pure: re-point when the answer CHANGED and either
 * it names a different transcript session, the new rung is strictly better, or
 * the file being tailed is gone.
 *
 * "Better" is §5.1's rung order, which is why the rung travels in the union
 * rather than being recomputed here. A same-rung, same-path answer changes
 * nothing — the common case every tick.
 *
 * THE UUID CLAUSE IS NOT A RUNG QUESTION. A transcript that Claude Code
 * superseded (`continued-in`) resolves at the SAME rung, to a DIFFERENT path,
 * while the old file is still on disk — frozen, not deleted — so all three of
 * the original clauses decline it and the stream would tail a dead file for
 * ever. Supersession is not a better ADDRESS for the same thing; it is a
 * different thing, and rung order was never asked to rank it. A fallback
 * carries no uuid and needs none: it always ranks last, so a fallback on
 * either side is already decided by rank.
 *
 * `facts` are the two the fork clauses need that only io can give, MEASURED
 * by the caller only when that clause is the one deciding (`repointNeeded`).
 * Absent, each answers "not shown": neither ever re-points on a guess.
 */
export interface RepointFacts {
  /** `next` is a uuid `cur` was followed FROM, and the newest deciding line
   *  of its own tail, read at the moment of this decision, is a FINISHED
   *  TURN (`resumedPastMarker` -> `resumed`): it was resumed past its
   *  marker. A window with no deciding line is not that. */
  readonly predecessorResumed?: boolean;
  /** `next` is the successor `cur` declined, and its file measured non-empty. */
  readonly successorHasContent?: boolean;
}

export function shouldRepoint(
  cur: TranscriptResolution, next: TranscriptResolution, tailedExists: boolean, facts: RepointFacts = {},
): boolean {
  // SUPERSESSION RUNS ONE WAY (D-4946). A different uuid re-points only when
  // the new answer's walk passed THROUGH the uuid being tailed — it is that
  // file's successor, or a successor of it. This clause used to fire on ANY
  // difference, and the backward case is real: the registry keeps naming the
  // predecessor until `ccd` moves it, so every re-ladder starts from there,
  // and one that cannot read the predecessor's tail (or stat the successor)
  // answers the predecessor. Measured (#189 review, S1): that re-pointed a
  // stream already reading the fork back onto the frozen pre-fork file, whose
  // backlog replaced the chat. Any other uuid difference falls through to the
  // address clauses below, so a successor that is genuinely GONE still gives
  // way to the best file left.
  if (cur.kind === 'found' && next.kind === 'found' && cur.uuid !== next.uuid
    && next.followedFrom?.includes(cur.uuid) === true) return true;
  // NOR BACKWARDS BY ADDRESS (D-4946, #189 fix-forward). The clause above no
  // longer runs backwards, but the RUNG clause below still could: a
  // `<pid>.json` read that comes back unmeasured makes the stream resolve
  // from the registry workdir instead of the live cwd — another memo KEY —
  // and under that key the predecessor sits at a better rung (a symlinked
  // workdir's resolved spelling), served stale from a blip before the fork or
  // answered fresh when its tail read fails. Measured (probes E2/E2b): one
  // `backlog` of the pre-fork file, then one of the fork on the next tick — a
  // 2 s flap of the whole chat on every such blip. A predecessor this answer
  // was followed FROM is never a better address for it while it is still
  // there; once it is gone, the address rules below decide as before.
  //
  // UNLESS IT IS THE CONVERSATION AGAIN (#189 re-review, server lens). An
  // explicit `claude --resume <pre-fork id>` never checks the marker, so a
  // supervisor that resumes the predecessor (one not yet moved to this
  // build, or a head `ccd` cannot see) puts the operator's prompts in it
  // while this stream shows the fork. Its tail then ends in a finished turn,
  // and Claude Code's own reader answers "not continued" for exactly that
  // (D-4940). The answer alone cannot say so — a clean predecessor is also
  // what a stale memo entry serves (E2b) — so the caller reads the
  // predecessor's tail at this moment (`predecessorResumed`), and only a
  // MEASURED finished turn re-points back. Not the walk's "no successor":
  // an 8 KiB window with no deciding line in it (records that are not turns
  // piled after the marker) is one Claude Code, reading 64 KiB back, still
  // calls continued — and re-pointing on it sent the stream back to the
  // frozen pre-fork file (#189 re-review, verifier probe FALSE-UNFOLLOW).
  if (cur.kind === 'found' && next.kind === 'found' && cur.uuid !== next.uuid
    && cur.followedFrom?.includes(next.uuid) === true) {
    if (facts.predecessorResumed === true) return true;
    if (tailedExists) return false;
  }
  // AND A SUCCESSOR THE TAILED FILE DECLINED IS DOWNSTREAM TOO (#189
  // re-review, SV-2). When the registry moves onto a successor with nothing
  // written yet, `tick` keeps the file on screen and records the successor
  // as declined; its later answer comes off its own ladder, with no
  // `followedFrom`, so the decline is the only thing that says it continues
  // this file. It re-points once its file has content — the walk's own rule:
  // following may only improve the answer — and never onto it empty while
  // the tailed file is still there.
  if (cur.kind === 'found' && next.kind === 'found' && cur.uuid !== next.uuid && cur.declinedTo === next.uuid) {
    if (facts.successorHasContent === true) return true;
    if (tailedExists) return false;
  }
  if (cur.path === next.path && rungRank(cur) === rungRank(next)) return false;
  if (rungRank(next) < rungRank(cur)) return true;
  return !tailedExists;
}

/**
 * The registry's uuid moved: is that THIS stream's conversation continuing,
 * or a reset? Pure, for the same reason `shouldRepoint` is (D-4947).
 *
 * The registry is not where a fork is first seen, and it is not seen there in
 * step with this stream: `ccd` walks the same `continued-in` pointer ONE HOP
 * PER QUIESCENCE, sometimes before this stream has followed it and sometimes
 * after. A move is a continuation when the answer being tailed already says
 * so, in any of four ways:
 *
 *   - the newly resolved path IS the tailed path (whole-branch review, F2: the
 *     stream followed first and the registry agreed);
 *   - the registry now names the uuid being tailed, at another address;
 *   - the registry now names the successor the tailed file's marker names but
 *     the walk declined (`declinedTo`) — `ccd` read the file after the
 *     successor was written, while this stream waited out its back-off
 *     (#189 review, S2);
 *   - the registry now names a uuid the tailed answer was followed THROUGH
 *     (`followedFrom`) — a chain longer than `MAX_CONTINUATION_HOPS` leaves
 *     this stream hops ahead of the registry (#189 review, server lens).
 *
 * Anything else is decided by the tailed file itself: `tick` reads its
 * marker chain (`continuesInto`) before calling the move a rotation — that
 * covers a registry that moved before this stream read the marker at all,
 * and one that moved TWO hops past a declined successor between two ticks.
 * What is left is a real rotation — a `/clear`, a compaction, a swap onto a
 * fresh uuid — and still says so. HONEST LIMIT: a tailed file whose tail
 * cannot be read at that moment either, with no decline already learned,
 * is still announced as a rotation, since nobody knows what it named; that
 * costs one false divider over a backlog that is right, never a lost event.
 *
 * Every clause has a table row of its own in `sessionws.test.ts` that no
 * other clause also satisfies — the path clause's row is a tailed answer
 * with no `followedFrom` and a registry naming its predecessor.
 */
export function registryCaughtUp(
  tailed: TranscriptResolution | null, registryUuid: string, next: TranscriptResolution,
): boolean {
  if (tailed === null) return false;
  if (tailed.path === next.path) return true;
  if (tailed.kind !== 'found') return false;
  return tailed.uuid === registryUuid
    || tailed.declinedTo === registryUuid
    || tailed.followedFrom?.includes(registryUuid) === true;
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
