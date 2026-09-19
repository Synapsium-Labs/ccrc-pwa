// Fleet zustand store: mirrors the `/ws/fleet` stream — full session
// snapshots on every change plus fleet-wide notices (account swaps etc.).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { FLEET_PROTO, type AccountsResponse, type CoordStatus, type FleetMsg, type FleetSession, type NotifyEvent, type ProjectPoolsWire, type RosterWire, type RunSummary } from '../../../shared/api';
import { api } from '../lib/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../lib/offline';
import { applyCatchUp, loadMark } from '../lib/notifymark';
import { mergeBySeq, reviveNotifyEvents } from '../lib/feed';
import { requestUpdate } from '../lib/swupdate';
import { ReconnectingSocket, wsUrl } from '../lib/ws';

export interface FleetNotice {
  id: number;
  message: string;
}

export interface FleetState {
  sessions: FleetSession[];
  conn: 'connecting' | 'open' | 'down';
  notices: FleetNotice[];
  /**
   * The account roster — `GET /api/accounts`'s `roster` field, id/label/hue/
   * homeAble only (never the server-only config `RosterWire` deliberately
   * omits). `pwa/src/lib/accounts.ts`'s `accountLabel`/`accountHue`/
   * `homeAbleLabelList` are pure projections over whatever array a caller
   * hands them; THIS is where every consumer but the three screens running
   * their own `/api/accounts` poll (AccountsStrip, AccountsScreen,
   * useProjectedHome) gets that array from.
   *
   * Threaded through the FLEET store, not a new one, because this store is
   * the one thing connected APP-WIDE (app.tsx), independent of which route
   * is mounted — SessionHeader, SessionLine, SessionActionsSheet and friends
   * all need a roster on `/s/:id` deep links that never mount FleetScreen's
   * own accounts poller. Default `[]`: the same "unarrived roster" state
   * `accountLabel`/`accountHue` already degrade gracefully for (raw wrapper
   * name, `--ink-tertiary`) — never a guessed account.
   */
  roster: readonly RosterWire[];
  /** The dormant protocol handshake (shared/api.ts's FLEET_PROTO_MIN): set on
   *  a `hello` this build cannot satisfy, CLEARED on a later compatible one —
   *  a reconnect to a fixed server must unblock, so this is never a one-way
   *  latch. Absence permits: a server that never sends `hello` (older build)
   *  leaves this false forever. Default false so every existing snapshot
   *  (offline-persisted, or a store that never saw a frame) reads as usable. */
  blocked: boolean;
  /**
   * The durable notification feed, rendered by `/mail` on receipt.
   *
   * Formerly `missed`, and the rename is the point: `applyCatchUp` advances
   * the durable mark ONE-WAY the moment its response lands, so these events
   * are volatile and can never be asked for again — `notifymark.ts`'s
   * docstring says whoever renders them first "must not call it missed, and
   * must render it on receipt". `/mail` ships in the same PR as this rename.
   *
   * Not "while this device was away": a phone connected, awake and pushed the
   * whole time gets exactly the same list, since the mark only moves on
   * connect. Not "what this device failed to receive" either — the log
   * records what the server DECIDED to raise, before delivery (`watch.ts`'s
   * `pushOne`), so it can legitimately name events that were delivered and
   * read.
   *
   * Two sources merged by record identity, not by `seq` alone (`lib/feed.ts`):
   * the catch-up tail on every socket open, and `GET /api/feed` when `/mail`
   * mounts (so the inbox is not empty after every deploy — the durable table
   * survives one, the 200-event in-memory ring never did). Capped at
   * FEED_CAP from the old end.
   *
   * Empty after a resync — see `lib/notifymark.ts` for why nothing is ever
   * surfaced retroactively in that case.
   */
  feed: NotifyEvent[];
  /** How many records the last read could not place at all (no seq/at) — the
   *  one case `reviveNotifyEvents` cannot degrade. Surfaced on the screen
   *  rather than swallowed: a feed that loses a record silently is the one
   *  failure this surface exists to prevent. */
  feedDropped: number;
  /** Build 7's run board reads this. PR I fills it; PR J renders it. Shape-
   *  validated only at the frame level (an array of runs), the same depth
   *  `fleet` is — per-row tolerance (a state this build's vocabulary has no
   *  key for, a row with no `items`) is the renderer's job now that one
   *  exists to protect: `pwa/src/fleet/runWords.ts`'s `runState`/`runItems`,
   *  never a cast at this boundary (fix round 1, task 5, finding 2). */
  runs: RunSummary[];
  /** Has `/ws/fleet` ever actually sent a `{type:'runs'}` frame THIS store
   *  instance's lifetime — never reset, including across a reconnect, the
   *  same "sticky until replaced" stance `runs`/`sessions` themselves take.
   *  `runs.length > 0` cannot answer this: an active-only frame legitimately
   *  broadcasts `[]` the moment the fleet's last open run closes, and that
   *  empty array is indistinguishable from "nothing has arrived yet" by
   *  content alone. `RunsScreen` needs the distinction to know whether `runs`
   *  is CURRENT truth (trust it, including empty) or simply unset (fall back
   *  to the cold `GET /api/runs` read instead) — without this flag, a run
   *  that closes gets resurrected by a stale cold snapshot the moment the
   *  live frame it should have deferred to says `[]` (fix round 1, task 5,
   *  findings 1 and 3). */
  runsFrameSeen: boolean;
  /** Has `/ws/fleet` ever actually sent a `{type:'fleet'}` frame THIS store
   *  instance's lifetime — `runsFrameSeen`'s own sticky idiom just above, for a
   *  sharper version of its own reason. `sessions.length > 0` cannot answer it
   *  in EITHER direction: an honestly empty fleet broadcasts `[]`, and a cold
   *  start hydrates `sessions` from the persisted snapshot (`loadFleetSnapshot`,
   *  below) before a socket exists at all — so a populated array is not evidence
   *  that anything has spoken. The resume door (`coordPresence`,
   *  `fleet/coordWords.ts`) is the consumer: without this it would read a
   *  claimant's absence from a STALE array as proof the coordinator is gone
   *  (D-1138). */
  fleetFrameSeen: boolean;
  /** Build 4, spec §4.2 (Task 11). The pause/mail marker readout, off the SAME
   *  `{type:'coord'}` frame `runs`/`runsFrameSeen` above are the precedent
   *  for. `null` means "no `coord` frame has ever arrived" — the CLIENT-side
   *  fourth state `CoordBanner` renders as nothing at all, never as "not
   *  paused" (a guess wearing the same typeface as a measurement). Once a
   *  frame has arrived this is sticky, same as `runs`/`sessions` themselves:
   *  the server only re-sends `coord` when the value actually changes
   *  (`server/src/watch.ts`'s `emitCoord`, byte-equality guarded), so holding
   *  the last value between emits is what makes it correct to read at all. */
  coord: CoordStatus | null;
  /** Has `/ws/fleet` ever actually sent a `{type:'coord'}` frame THIS store
   *  instance's lifetime — `runsFrameSeen`'s own idiom, for `runsFrameSeen`'s
   *  own stated reason: never reset, including across a reconnect. `coord !==
   *  null` would answer the same question today (both flip together, below),
   *  but this is the flag `CoordBanner` reads, for the same reason
   *  `RunsScreen` reads `runsFrameSeen` rather than inferring "has arrived"
   *  from the payload's own shape. */
  coordFrameSeen: boolean;
  /** Which pool each project is tagged into, off the fleet-level `pools` frame
   *  (spec §5.4.5). `null` means NO FRAME HAS ARRIVED — an older server, or a
   *  socket that has not spoken yet — and every surface renders NOTHING for
   *  it, never a "no pool" flag: absence is not a measurement.
   *
   *  DELIBERATELY NOT HYDRATED from `loadFleetSnapshot()` and deliberately not
   *  written by `saveFleetSnapshot` (spec §5.4.1: "Not persisted server-side …
   *  A cached tag rendered as live policy would lie"). `sessions` and `roster`
   *  survive a cold start because a stale session row reads as stale and a
   *  stale label is still that account's name; a stale POOL TAG is a claim
   *  about what the fleet is enforcing right now, which nothing on this device
   *  can stand behind. `FleetSnapshot` has no field for it, so the exclusion is
   *  structural rather than a line someone must remember not to add.
   *
   *  Sticky once it has arrived, like `runs`/`coord`: the watcher only re-emits
   *  when the value actually changes (`watch.ts`'s byte-equality guard), so
   *  holding the last value between emits is what makes it correct to read. */
  pools: ProjectPoolsWire | null;
  connect(): void;
  disconnect(): void;
  dismissNotice(id: number): void;
  /** Union `events` into `feed` by record identity (`lib/feed.ts`'s
   *  `${at}:${seq}`, never `seq` alone — `seq` resets to 0 on an epoch
   *  rotation, so two different records can share one) — later wins a
   *  collision — and, WHEN `dropped` is supplied, set `feedDropped` to it:
   *  the LAST read's count (its own docstring: not a running total; each
   *  read, including a re-mount of `/mail`, reports for itself).
   *
   *  `dropped` is OPTIONAL, not defaulted to 0, on purpose. The catch-up tail
   *  (`connect()`'s `askCatchUp`) calls this with events only — `applyCatchUp`
   *  silently drops unrevivable events without counting them, so it has no
   *  honest number to give, and 0 would assert "nothing was dropped" when the
   *  truth is "this source cannot say". Omitting the argument leaves
   *  `feedDropped` exactly as a prior `GET /api/feed` read left it, so a
   *  reconnect's catch-up can never fabricate a false all-clear over a real
   *  count `/mail`'s mount already surfaced. The one mutator both the
   *  catch-up tail and `GET /api/feed` go through, so the two sources can
   *  never diverge on merge policy. */
  mergeFeed(events: NotifyEvent[], dropped?: number): void;
  clearFeed(): void;
}

const asFleetMsg = (m: unknown): FleetMsg | null => {
  if (typeof m !== 'object' || m === null) return null;
  const t = (m as { type?: unknown }).type;
  if (t === 'fleet' && Array.isArray((m as { sessions?: unknown }).sessions)) {
    return m as FleetMsg;
  }
  if (t === 'notice' && typeof (m as { message?: unknown }).message === 'string') {
    return m as FleetMsg;
  }
  if (t === 'runs' && Array.isArray((m as { runs?: unknown }).runs)) {
    return m as FleetMsg;
  }
  // Frame-level only, same depth as `fleet`/`runs` above — per-MEMBER
  // tolerance (a `pause`/`mail` value this build has never heard of) is the
  // renderer's job, via `markerState` (`fleet/coordWords.ts`), exactly as
  // `runState`/`runItems` do for `runs`.
  if (t === 'coord' && typeof (m as { coord?: unknown }).coord === 'object' && (m as { coord?: unknown }).coord !== null) {
    return m as FleetMsg;
  }
  // Validate the envelope that makes `ProjectPoolsWire` safe to read, but not
  // its project members: a later member state belongs to that reader's additive
  // tolerance. A malformed envelope must leave the last live policy standing.
  if (t === 'pools') {
    const pools = (m as { pools?: unknown }).pools;
    // Array rejection is over-determined by the exact discriminants below, but
    // this keeps the neighboring envelope-narrowing idiom explicit. Unlike it,
    // the byProject array guard is load-bearing (stores.test.ts:1087).
    if (typeof pools !== 'object' || pools === null || Array.isArray(pools)) return null;
    const outer = pools as {
      listed?: unknown; enforcement?: unknown; byProject?: unknown;
      epoch?: unknown; observedEpoch?: unknown;
    };
    const validEnforcement = outer.enforcement === 'enforced'
      || outer.enforcement === 'unavailable'
      || outer.enforcement === 'unknown';
    const validByProject = typeof outer.byProject === 'object'
      && outer.byProject !== null
      && !Array.isArray(outer.byProject);
    // T9-R2: `epoch`/`observedEpoch` are FLEET-LEVEL scalars, siblings of
    // `enforcement` above (not per-project `byProject` members), so they get
    // the same envelope-level type gate rather than a downstream reader's
    // tolerance. THIS GATE MUST NOT RECONSTRUCT THE VALUE — the frame is
    // returned as `m as FleetMsg` below exactly as it arrived, so a key this
    // gate accepts (including a missing key) reaches the store completely
    // unchanged. That is what keeps THE THREE-VALUED RULE intact end to end:
    // absent stays absent, `null` stays `null`, and `0` — a real epoch and a
    // real observed epoch alike — is accepted here (`typeof === 'number'`),
    // never treated as falsy-absent. `epoch` has no `null` rung (the control
    // plane's epoch is a plain number once a coordinator exists); a present
    // `null` there is rejected, same as any other wrong-typed value.
    const validEpoch = outer.epoch === undefined || typeof outer.epoch === 'number';
    const validObservedEpoch = outer.observedEpoch === undefined
      || outer.observedEpoch === null
      || typeof outer.observedEpoch === 'number';
    if (
      validEnforcement && validEpoch && validObservedEpoch
      && (outer.listed === false || (outer.listed === true && validByProject))
    ) {
      return m as FleetMsg;
    }
  }
  // present-but-wrong-typed proto/min is rejected, not coerced — a `hello`
  // this parser cannot trust is exactly the kind of frame absence-permits
  // exists to be safe against, so it is dropped like any other unknown one.
  if (
    t === 'hello'
    && typeof (m as { proto?: unknown }).proto === 'number'
    && typeof (m as { min?: unknown }).min === 'number'
  ) {
    return m as FleetMsg;
  }
  return null;
};

export interface FleetStoreDeps {
  makeSocket?: (url: string) => WebSocket;
  /** Injectable so a test can drive the catch-up without a server. */
  catchUp?: (epoch: string | null, seq: number) => Promise<import('../../../shared/api').CatchUp>;
  /** Injectable so a test can drive the durable feed read without a server —
   *  same reason `catchUp` above is. Defaults to `api.feed`. */
  fetchFeed?: (limit: number) => Promise<{ events: import('../../../shared/api').NotifyEvent[] }>;
  /** Injectable so a test can drive the roster poll without a server — same
   *  reason `catchUp`/`fetchFeed` above are. Defaults to `api.accounts`. */
  fetchAccounts?: () => Promise<AccountsResponse>;
}

export type FleetStore = UseBoundStore<StoreApi<FleetState>>;

export function createFleetStore(deps: FleetStoreDeps = {}): FleetStore {
  let socket: ReconnectingSocket | null = null;
  let noticeSeq = 0;
  let rosterTimer: ReturnType<typeof setInterval> | null = null;

  return create<FleetState>()((set, get) => {
    const nudge = (): void => socket?.nudge();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') nudge();
    };

    // One read, not two (`sessions` and `roster` below both come off it) —
    // fix round 1, finding 3. Before this, a cold offline start hydrated
    // `sessions` from the snapshot but `roster` stayed at its bare `[]`
    // default, so every account rendered as its raw wrapper id
    // (`claude2`, `claude-corp`) instead of the jargon-free label this
    // whole module exists to restore — a real regression against the
    // compile-time roster this replaced, which never had an "unarrived"
    // state to begin with.
    const snapshot = loadFleetSnapshot();

    return {
      // Hydrate from the last persisted snapshot (lib/offline.ts) so a cold
      // start renders the fleet instantly. conn stays 'connecting' — the
      // screen stale-marks everything until the socket opens and the live
      // snapshot replaces this one.
      sessions: snapshot?.sessions ?? [],
      conn: 'connecting',
      notices: [],
      feed: [],
      feedDropped: 0,
      blocked: false,
      runs: [],
      runsFrameSeen: false,
      fleetFrameSeen: false,
      coord: null,
      coordFrameSeen: false,
      // NOT `snapshot?.pools` — there is no such field, and there must not be
      // one. See the field's own docstring.
      pools: null,
      roster: snapshot?.roster ?? [],

      connect() {
        if (socket) return;

        // The roster poll — independent of the `/ws/fleet` socket entirely
        // (it is a plain `GET /api/accounts` read, same endpoint
        // AccountsStrip/AccountsScreen/useProjectedHome already poll on
        // their own 20s cadence for `accounts`/`projected`). Duplicate
        // polling against a local endpoint reading two small JSON files
        // beats coupling every roster consumer to one mounted screen — the
        // same trade those hooks' own comments already make. Silent on
        // failure, and no state change on failure: an unarrived roster
        // degrades to `accountLabel`/`accountHue`'s own raw-name/neutral-ink
        // fallback rather than erroring.
        //
        // `Array.isArray`, not a bare `r.roster` trust: every `accountLabel`/
        // `accountHue` call site below does `roster.find(...)` unguarded, on
        // the strength of the store's own `readonly RosterWire[]` type — so
        // this is the one place that type is actually enforced against
        // untrusted JSON. A stub answering an unmatched route with bare `{}`
        // (AccountsStrip's own sibling comment names the exact shape: several
        // fixtures across this suite predate Task 7 and do exactly this for
        // every route they do not explicitly handle) hands back `r.roster ===
        // undefined`, and `set({ roster: undefined })` would corrupt every
        // consumer's next render into a `TypeError` — a shape no server
        // response can legitimately produce (`AccountsResponse.roster` is
        // never optional), but a bad JSON body can.
        const fetchAccounts = deps.fetchAccounts ?? (() => api.accounts());
        const pollRoster = (): void => {
          void fetchAccounts().then((r) => {
            // Preserves the last good roster on a malformed response — never
            // clobbers it with `[]` (fix round 1, finding 5): a transient bad
            // read must not un-teach every consumer the account labels it
            // already had.
            if (Array.isArray(r.roster)) { set({ roster: r.roster }); return; }
            // A genuine protocol break (a route answering the wrong shape) has
            // no other signal anywhere — every consumer just silently reverts
            // to raw wrapper ids, which reads as "nothing is wrong" (fix
            // round 1, finding 6).
            console.warn('ccrc: GET /api/accounts answered with a non-array roster; keeping the last known one.', r);
          }).catch(() => {});
        };
        pollRoster();
        rosterTimer = setInterval(pollRoster, 20_000);

        // What has the server recorded since we last asked? Asked once per
        // connect, including automatic reconnects — a phone that slept through
        // a question is exactly the case this exists for. Never awaited and
        // never allowed to reject: the fleet stream is the thing that matters,
        // and a catch-up that fails simply leaves `feed` unchanged, which is
        // the honest answer.
        //
        // SERIALISED, because the mark is one value with one owner. A
        // reconnect storm (backoff of 500 ms against a request that has not
        // answered yet) opens the socket again while the first catch-up is
        // still in flight; unchained, the second reads the same STALE mark,
        // asks for the same range, and whichever response lands last is what
        // gets persisted — so the mark can go BACKWARDS and `feed` can gain
        // duplicates. Chaining makes the second request read the mark the
        // first one wrote, which is both correct and what it would have asked
        // for anyway. `run` never rejects, so the chain cannot break.
        let chain: Promise<void> = Promise.resolve();
        const run = (): Promise<void> => {
          const mark = loadMark();
          const fetchCatchUp = deps.catchUp ?? ((e, s) => api.catchUp(e, s));
          return fetchCatchUp(mark?.epoch ?? null, mark?.seq ?? 0)
            .then((r) => {
              const events = applyCatchUp(r);
              if (events.length > 0) get().mergeFeed(events);
            })
            .catch(() => { /* offline, or an older server with no such route */ });
        };
        const askCatchUp = (): void => { chain = chain.then(run); };

        // The durable half of the unread-mail count (fix, review finding
        // 18): `feed` had exactly two producers before this — the catch-up
        // tail above, which is VOLATILE (the mark it reads advances one-way
        // at receipt, so a reload that lands after the tail already ran sees
        // nothing left to ask for), and `GET /api/feed` on `/mail`'s own
        // mount, which most sessions never open. Nothing hydrated `feed` at
        // boot, so a badge computed off it read real unread mail as "0" the
        // moment a reload or a PWA eviction intervened between the mark's
        // last advance and now — the ack watermark (`ccrc:feed`, durable,
        // localStorage) still knew better, but nothing asked the one OTHER
        // durable source that agrees with it. One `GET /api/feed` read, on
        // the FIRST successful connect only (`done` flips true only on
        // success, so a connect that opens offline still gets one on the
        // next reconnect) — `mergeFeed` (`lib/feed.ts`'s `mergeBySeq`) dedupes
        // it against the catch-up tail by record identity, so this can never
        // double-count.
        let durableFeedDone = false;
        const askDurableFeed = (): void => {
          if (durableFeedDone) return;
          const fetchFeed = deps.fetchFeed ?? ((n: number) => api.feed(n));
          void fetchFeed(100)
            .then((r) => {
              durableFeedDone = true;
              const { events, dropped } = reviveNotifyEvents(r.events);
              get().mergeFeed(events, dropped);
            })
            .catch(() => { /* offline, or an older server with no such route — retry next reconnect */ });
        };

        socket = new ReconnectingSocket({
          url: () => wsUrl('/ws/fleet'),
          onMessage: (m) => {
            const msg = asFleetMsg(m);
            if (!msg) return; // unknown frame — ignore
            if (msg.type === 'fleet') {
              // `get().roster`, not the bare sessions: the roster travels
              // independently (the poll above, not this socket), so the
              // snapshot's own roster has to be read off current state
              // rather than out of `msg` — a `fleet` frame carries none.
              saveFleetSnapshot(msg.sessions, get().roster); // keep the offline snapshot fresh
              // ONE `set`, so the array and the flag can never disagree (D-1138).
              set({ sessions: msg.sessions, fleetFrameSeen: true });
            } else if (msg.type === 'notice') {
              noticeSeq += 1;
              const notice: FleetNotice = { id: noticeSeq, message: msg.message };
              set((s) => ({ notices: [...s.notices, notice] }));
            } else if (msg.type === 'hello') {
              // the server's own protocol generation, restated on every
              // connect including reconnects. Blocking requires POSITIVE
              // evidence (min > this build's own PROTO) — the absence-permits
              // rule this pair shares with verbSupported. Fires the update
              // check only on the RISING edge (newly blocked), not on every
              // hello a still-blocked client keeps receiving from a server it
              // cannot talk to yet.
              const blocked = msg.min > FLEET_PROTO;
              if (blocked && !get().blocked) requestUpdate();
              set({ blocked });
            } else if (msg.type === 'runs') {
              // Shape-validated only at the frame level (`asFleetMsg`'s own
              // `Array.isArray` check) — RunsScreen's own `runWords.ts`
              // (`runState`/`runItems`) is where a malformed ROW degrades.
              // `runsFrameSeen` flips once and stays flipped: the frame has
              // now genuinely spoken, even the FIRST time it says `[]`.
              set({ runs: msg.runs, runsFrameSeen: true });
            } else if (msg.type === 'coord') {
              // Shape-validated only at the frame level (`asFleetMsg`'s own
              // `typeof … === 'object'` check) — `CoordBanner`'s own
              // `markerState` is where a malformed MEMBER degrades.
              // `coordFrameSeen` flips once and stays flipped, even the first
              // time the frame arrives.
              set({ coord: msg.coord, coordFrameSeen: true });
            } else if (msg.type === 'pools') {
              // No `poolsFrameSeen` twin: unlike `runs`/`coord`, the payload
              // itself is never an empty array whose emptiness could be
              // mistaken for silence — `null` and a `ProjectPoolsWire` are
              // already distinguishable, and `projectPoolOf` reads exactly
              // that distinction.
              set({ pools: msg.pools });
            }
          },
          onState: (conn) => set({ conn }),
          onOpen: () => { askCatchUp(); askDurableFeed(); },
          makeSocket: deps.makeSocket,
        });
        socket.start();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', nudge);
      },

      disconnect() {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', nudge);
        socket?.stop();
        socket = null;
        if (rosterTimer !== null) {
          clearInterval(rosterTimer);
          rosterTimer = null;
        }
      },

      dismissNotice(id) {
        set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
      },

      mergeFeed(events, dropped) {
        // NOT `s.feedDropped + dropped`: `feedDropped`'s own docstring says
        // "the last read", not a running total. `GET /api/feed` is an
        // idempotent, whole-source re-read — `/mail` calls this on every
        // mount — so re-reading the SAME permanently-unreadable rows on a
        // second visit must report the SAME count, not double it. Accumulating
        // here made three permanently-dropped rows read as "3" on the first
        // visit, "6" on the second, "9" on the third: a fabricated, ever-
        // growing loss count on the one screen whose job is to be a truthful
        // record.
        //
        // AND not a bare `dropped = 0` default either: the catch-up tail calls
        // this with no second argument at all, because `applyCatchUp` never
        // counts what it silently drops. Treating that omission as "0" would
        // fabricate an all-clear the moment a reconnect's catch-up landed,
        // overwriting whatever real count `GET /api/feed` had just reported.
        // `dropped === undefined` is the caller saying "I don't know" — the
        // only honest answer is to leave the field exactly as it was.
        set((s) => ({
          feed: mergeBySeq(s.feed, events),
          feedDropped: dropped === undefined ? s.feedDropped : dropped,
        }));
      },

      clearFeed() {
        set({ feed: [], feedDropped: 0 });
      },
    };
  });
}

export const useFleetStore: FleetStore = createFleetStore();
