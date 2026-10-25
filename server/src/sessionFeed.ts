// The one source of a session's pane menu, task plan, hook ask and outstanding mail for its open streams (ARCH-52, #787;
// consolidation spec K13). Each open `SessionStream` used to read all four itself, every 2 s: two tabs on one session
// were two captures, two hookstate reads, two plan reads and two mail reads per tick. Now one `SessionFeed` per open
// session builds the reading and hands the same one to every stream subscribed to it; a stream keeps what is its own
// (its change gates, its client's idea of what it has seen, the transcript tail) and decides its frames from the
// reading, exactly as it decided them from its own read.
//
// The feed has no clock. The watcher already captures every registered pane and reads every hookstate on its tick, so
// the feed SUBSCRIBES to those two (`pane:<id>`, `hook:<id>` on the bus) and a published pane is what triggers a
// reading. It reads for itself only what the watcher does not hold in the stream's shape: the transcript (the ask's
// enrichment), the plan (the watcher keeps its counts, on a slower clock) and the mail; and it captures the pane or
// reads the hookstate itself only for the opening reading, when nothing fresh has been published (a connect owes its
// client the reading whatever the schedule).
//
// L4: it decides nothing about a frame: a stream does that from the reading, so a reading is the raw outcome of each
// read, not a verdict (`held` is the one thing it states about a capture, because the failed-capture count is a fact
// about consecutive looks at the pane, which only the reader of the pane has).
import type { Bus, HookReading, PaneReading } from './bus.js';
import type { Deps } from './server.js';
import type { Dialog } from '../../shared/api.js';
import { parseDialog } from './pane/dialog.js';
import { alignAsk, readPendingAsk } from './transcript/ask.js';
import { readTasks } from './tasks/read.js';
import { readHookStateRawMeasured, type HookStateRawRead } from './hookstate.js';

/** How old a published pane or hookstate may be and still be the reading. The watcher publishes every tick (2 s); past
 *  this the watcher is not publishing for this session (not registered yet, a stalled tick) and the feed looks itself. */
const PUBLISHED_FRESH_MS = 10_000;
/** Failed captures in a row after which the menu the client holds is cleared (decision `ask-failed-capture-holds`):
 *  three polls, at least 6 s of the pane unreadable. One or two are the blips a slow remote call produces. */
export const FAILED_CAPTURES_CLEAR = 3;
/** `outstandingMailFor`'s widest page: `clampMailLimit`'s own hard ceiling (store.ts), as the stream always asked. */
const MAIL_LIMIT = 500;

/** What a stream needs to know about the session to have its four things read: where its transcript is (the ask is
 *  enriched from it), its config dir and its uuid (the plan and the hookstate are keyed by them). */
export interface FeedFacts { readonly file: string; readonly cfgDir: string; readonly uuid: string }

/** One look at the pane. `held`: the capture failed and the failures are still under `FAILED_CAPTURES_CLEAR`, so there
 *  is NO READING and the menu the client holds stays. `dropped`: an answer route handled an answer while this look was
 *  in flight, so the look is older than what the client was told. `read`: the menu (or none), as parsed and, when its
 *  transcript explains it, enriched. Three failed captures in a row read as `read` with no menu. */
export type DialogReading =
  | { readonly kind: 'held' }
  | { readonly kind: 'dropped' }
  | { readonly kind: 'read'; readonly dialog: Dialog | null };

export type FeedTasks = Awaited<ReturnType<typeof readTasks>>;
export type FeedMail = ReturnType<NonNullable<Deps['coord']>['outstandingMailFor']>;

/** One tick's readings. `tasks`, `hook` and `mail` are null when there was nothing to read them from: the session did
 *  not resolve (no facts), or, for the mail, the box has no coordination database. */
export interface FeedReading {
  /** When the reading began, for the frame log's `tick=`. */
  readonly startedAt: number;
  /** The answer generation the pane was read under; a reading is stale for a stream once `answeredGen` moved past it. */
  readonly gen: number;
  readonly dialog: DialogReading;
  readonly tasks: FeedTasks | null;
  readonly hook: HookStateRawRead | null;
  readonly mail: FeedMail | null;
}

export interface FeedSubscriber {
  /** Handle one reading. The feed awaits it and logs, never rethrows, what it throws. */
  onReading(reading: FeedReading): Promise<void>;
}

/** The feeds of one bus, by session id: a stream finds the feed of its session, or starts it. */
const FEEDS = new WeakMap<Bus, Map<string, SessionFeed>>();

export function feedFor(deps: Deps, bus: Bus, id: string): SessionFeed {
  let byId = FEEDS.get(bus);
  if (!byId) { byId = new Map(); FEEDS.set(bus, byId); }
  let feed = byId.get(id);
  if (!feed) {
    const made = new SessionFeed(deps, bus, id, () => { if (byId!.get(id) === made) byId!.delete(id); });
    feed = made;
    byId.set(id, feed);
  }
  return feed;
}

export class SessionFeed {
  /** Every subscriber that has joined, with the facts it last stated (null: its session did not resolve). */
  private readonly facts = new Map<FeedSubscriber, FeedFacts | null>();
  /** The subscribers the poll fans out to: those whose join has been delivered its first reading. */
  private readonly ready = new Set<FeedSubscriber>();
  /** The watcher's latest look at the pane and read of the hookstate, as published. */
  private pane: PaneReading | null = null;
  private hookPub: HookReading | null = null;
  /** When the last answer was handled: a pane captured before it is older than what the client was told. */
  private answeredAt = 0;
  private inflight: Promise<FeedReading> | null = null;
  private polling = false;
  private gen = 0;
  private failedCaptures = 0;
  /** The transcript state that already failed to explain the menu on screen: see `claimAskRead`. */
  private askProbe: { file: string; id: string; size: number; mtimeMs: number } | null = null;
  /** The menu last read and the ask it carried: what the read-skip below is judged against, the way a stream's gate
   *  is judged against what its client was last told. */
  private shown: { id: string; ask: NonNullable<Dialog['ask']> | null } | null = null;

  /** Bumped on every `answered:<id>`: a pane look taken under an older value read the pane from before that answer
   *  (decision `ask-stale-poll-dropped`). */
  private readonly onAnswered = (): void => { this.gen += 1; this.answeredAt = Date.now(); };

  /** The watcher published its look at the pane: that is the tick. Readings are taken only while a subscriber is
   *  ready; one in flight is not doubled (`poll`). */
  private readonly onPane = (p: PaneReading): void => {
    this.pane = p;
    if (this.ready.size > 0) void this.poll();
  };
  private readonly onHook = (h: HookReading): void => { this.hookPub = h; };

  constructor(
    private readonly deps: Deps,
    private readonly bus: Bus,
    private readonly id: string,
    private readonly onEmpty: () => void,
  ) {
    this.bus.on(`answered:${id}`, this.onAnswered);
    this.bus.on(`pane:${id}`, this.onPane);
    this.bus.on(`hook:${id}`, this.onHook);
  }

  get answeredGen(): number { return this.gen; }

  /** Subscribe `sub` and hand it the reading it opens with (what a connecting client is owed whatever the schedule),
   *  then keep it on the watcher's ticks. `facts` null: the session did not resolve; only the pane is read for it. */
  async join(sub: FeedSubscriber, facts: FeedFacts | null): Promise<void> {
    this.facts.set(sub, facts);
    await this.deliver(sub, await this.take());
    if (!this.facts.has(sub)) return;       // it left while its opening reading was in flight
    this.ready.add(sub);
  }

  /** The facts `sub` now holds. Read on the next reading. */
  setFacts(sub: FeedSubscriber, facts: FeedFacts | null): void {
    if (this.facts.has(sub)) this.facts.set(sub, facts);
  }

  leave(sub: FeedSubscriber): void {
    this.facts.delete(sub);
    this.ready.delete(sub);
    if (this.facts.size > 0) return;
    this.bus.off(`answered:${this.id}`, this.onAnswered);
    this.bus.off(`pane:${this.id}`, this.onPane);
    this.bus.off(`hook:${this.id}`, this.onHook);
    this.onEmpty();
  }

  /** One tick: take the reading and hand it to every subscriber. A published pane calls this; so do the tests. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const reading = await this.take();
      await Promise.all([...this.ready].map((sub) => this.deliver(sub, reading)));
    } finally {
      this.polling = false;
    }
  }

  private async deliver(sub: FeedSubscriber, reading: FeedReading): Promise<void> {
    try {
      await sub.onReading(reading);
    } catch (err) {
      console.warn(`ccrc-server: session feed ${this.id}: a subscriber failed on a reading (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  /** The reading, shared: a request that arrives while one is in flight gets that one. */
  private take(): Promise<FeedReading> {
    this.inflight ??= this.read().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** The facts to read with: the latest-joined subscriber's that resolved. */
  private current(): FeedFacts | null {
    let found: FeedFacts | null = null;
    for (const f of this.facts.values()) if (f !== null) found = f;
    return found;
  }

  private async read(): Promise<FeedReading> {
    const startedAt = Date.now();
    const facts = this.current();
    const gen = this.gen;
    const dialog = await this.readDialog(facts?.file ?? null, gen, await this.paneLook(startedAt));
    const { io } = this.deps;
    const tasks = facts === null ? null : await readTasks(io, facts.cfgDir, facts.uuid, { touchedAt: true });
    const hook = facts === null ? null : await this.hookRead(facts.uuid, startedAt);
    const mail = facts === null || !this.deps.coord ? null : this.deps.coord.outstandingMailFor(this.id, MAIL_LIMIT);
    return { startedAt, gen, dialog, tasks, hook, mail };
  }

  /** The pane as the watcher published it, when that is fresh and was captured after the last answer; otherwise a
   *  capture of our own (the opening reading, or a watcher that is not publishing). */
  private async paneLook(now: number): Promise<string | null> {
    const p = this.pane;
    if (p !== null && now - p.at <= PUBLISHED_FRESH_MS && p.at >= this.answeredAt) return p.pane;
    return this.deps.tmux.capture(this.id);
  }

  /** The raw hookstate as the watcher published it for this identity, when fresh; otherwise our own read. */
  private async hookRead(uuid: string, now: number): Promise<HookStateRawRead> {
    const h = this.hookPub;
    if (h !== null && h.uuid === uuid && now - h.at <= PUBLISHED_FRESH_MS) return h.raw;
    return readHookStateRawMeasured(this.deps.io, this.deps.cfg.registryDir, this.id, uuid);
  }

  /** Read what menu `pane` (null: the capture failed) holds, enriched from the transcript `file` while the menu is
   *  still unexplained. null `file` (unresolvable session): the menu still ships, unenriched. */
  private async readDialog(file: string | null, gen: number, pane: string | null): Promise<DialogReading> {
    const stale = (): boolean => gen !== this.gen;
    if (stale()) return { kind: 'dropped' };
    // Decision `ask-failed-capture-holds`: a failed capture (tmux, or the remote call behind it, returned nothing) is
    // NO READING, not "no menu". Clearing on it is what put the 2026-10-16 sheet on "Open terminal to answer" with the
    // review still on the pane. Only FAILED_CAPTURES_CLEAR failures in a row clear it: a pane tmux can no longer read
    // at all is not offering a menu (an answer to it is refused `not-alive`), and the sheet must not hold one forever.
    if (pane === null) {
      this.failedCaptures += 1;
      if (this.failedCaptures < FAILED_CAPTURES_CLEAR) return { kind: 'held' };
      this.askProbe = null;
      this.shown = null;
      return { kind: 'read', dialog: null };
    }
    this.failedCaptures = 0;
    // parseDialog opens with the hasMenu gate (not paneState), so a busy marker painted beside a menu does not veto the parse (D-102).
    let dialog = parseDialog(pane);
    // Read the transcript only while this menu is still unexplained. Once its ask is latched, re-reading costs a
    // 256 KB tail every 2 s and can buy nothing: the stream's gate would suppress the frame anyway. Menus that never
    // latch are held off by claimAskRead instead — they are the majority.
    const latched = dialog !== null && this.shown !== null && this.shown.id === dialog.id && this.shown.ask !== null;
    if (dialog?.parsed && file !== null && !latched) {
      const st = await this.deps.io.stat(file);
      if (stale()) return { kind: 'dropped' };
      if (this.claimAskRead(file, dialog.id, st)) {
        const questions = await readPendingAsk(this.deps.io, file);
        if (stale()) return { kind: 'dropped' };
        const ask = questions === null ? null : alignAsk(dialog.options, questions);
        // Enrichment rides ALONGSIDE the scraped options — it never rewrites them.
        // `id` stays a hash of the pane alone (answerDialog re-parses the pane to
        // check staleness) and the keystrokes an answer sends stay positional.
        if (ask !== null) dialog = { ...dialog, ask };
      }
    }
    // The probe is scoped to the PARSED menu on screen, so it dies with it. A capture can miss a menu that is still
    // there: tmux returns null (held above, so the probe survives it until FAILED_CAPTURES_CLEAR), one stray
    // 'esc to interrupt' anywhere in the pane flips it to busy, or the grab lands mid-redraw and comes back
    // `unparsed` (a menu footer with its option rows half-erased — dialog.ts:94). That last one is still a dialog,
    // so testing for null alone would keep the probe alive past the menu it was taken for. On the way back the ask
    // is unlatched but the transcript is untouched — the agent is blocked awaiting the answer — so a surviving probe
    // would decline the read the reappearance needs and the menu would come back bare and stay bare. Forgetting it
    // costs nothing: the read above is gated on `dialog?.parsed`, so an unparsed menu never spends one.
    if (dialog === null || !dialog.parsed) this.askProbe = null;
    // A latched menu is handed on WITH its ask: a stream that joined after the menu was explained has never been
    // told it, and a stream that has been told it sees the same ask again and sends nothing.
    if (dialog !== null && latched && dialog.ask === undefined && this.shown!.ask !== null) dialog = { ...dialog, ask: this.shown!.ask };
    this.shown = dialog === null ? null : { id: dialog.id, ask: dialog.ask ?? (this.shown?.id === dialog.id ? this.shown.ask : null) };
    return { kind: 'read', dialog };
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
}
