// Fleet zustand store: mirrors the `/ws/fleet` stream — full session
// snapshots on every change plus fleet-wide notices (account swaps etc.).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { FLEET_PROTO, type FleetMsg, type FleetSession, type NotifyEvent, type RunSummary } from '../../../shared/api';
import { api } from '../lib/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../lib/offline';
import { applyCatchUp, loadMark } from '../lib/notifymark';
import { mergeBySeq } from '../lib/feed';
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
   *  `fleet` is: `reviveFleetSession`-grade revival for runs is PR J's problem
   *  when it has a renderer to protect. */
  runs: RunSummary[];
  connect(): void;
  disconnect(): void;
  dismissNotice(id: number): void;
  /** Union `events` into `feed` by record identity (`lib/feed.ts`'s
   *  `${at}:${seq}`, never `seq` alone — `seq` resets to 0 on an epoch
   *  rotation, so two different records can share one) — later wins a
   *  collision — and set `feedDropped` to `dropped`, the LAST read's count
   *  (its own docstring: not a running total; each read, including a
   *  re-mount of `/mail`, reports for itself). The one mutator both the
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
}

export type FleetStore = UseBoundStore<StoreApi<FleetState>>;

export function createFleetStore(deps: FleetStoreDeps = {}): FleetStore {
  let socket: ReconnectingSocket | null = null;
  let noticeSeq = 0;

  return create<FleetState>()((set, get) => {
    const nudge = (): void => socket?.nudge();
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') nudge();
    };

    return {
      // Hydrate from the last persisted snapshot (lib/offline.ts) so a cold
      // start renders the fleet instantly. conn stays 'connecting' — the
      // screen stale-marks everything until the socket opens and the live
      // snapshot replaces this one.
      sessions: loadFleetSnapshot()?.sessions ?? [],
      conn: 'connecting',
      notices: [],
      feed: [],
      feedDropped: 0,
      blocked: false,
      runs: [],

      connect() {
        if (socket) return;
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
        socket = new ReconnectingSocket({
          url: () => wsUrl('/ws/fleet'),
          onMessage: (m) => {
            const msg = asFleetMsg(m);
            if (!msg) return; // unknown frame — ignore
            if (msg.type === 'fleet') {
              saveFleetSnapshot(msg.sessions); // keep the offline snapshot fresh
              set({ sessions: msg.sessions });
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
              // `Array.isArray` check) — PR J's renderer is what needs
              // `reviveFleetSession`-grade per-row revival, once it exists to
              // protect.
              set({ runs: msg.runs });
            }
          },
          onState: (conn) => set({ conn }),
          onOpen: askCatchUp,
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
      },

      dismissNotice(id) {
        set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
      },

      mergeFeed(events, dropped = 0) {
        // NOT `s.feedDropped + dropped`: `feedDropped`'s own docstring says
        // "the last read", not a running total. `GET /api/feed` is an
        // idempotent, whole-source re-read — `/mail` calls this on every
        // mount — so re-reading the SAME permanently-unreadable rows on a
        // second visit must report the SAME count, not double it. Accumulating
        // here made three permanently-dropped rows read as "3" on the first
        // visit, "6" on the second, "9" on the third: a fabricated, ever-
        // growing loss count on the one screen whose job is to be a truthful
        // record.
        set((s) => ({ feed: mergeBySeq(s.feed, events), feedDropped: dropped }));
      },

      clearFeed() {
        set({ feed: [], feedDropped: 0 });
      },
    };
  });
}

export const useFleetStore: FleetStore = createFleetStore();
