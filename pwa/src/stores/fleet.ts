// Fleet zustand store: mirrors the `/ws/fleet` stream — full session
// snapshots on every change plus fleet-wide notices (account swaps etc.).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { FLEET_PROTO, type FleetMsg, type FleetSession, type NotifyEvent } from '../../../shared/api';
import { api } from '../lib/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../lib/offline';
import { applyCatchUp, loadMark } from '../lib/notifymark';
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
   * Notifications the server RECORDED since this device last asked — i.e.
   * since the previous fleet-socket open, because that is the only moment the
   * watermark advances.
   *
   * Not "while this device was away", which is what this said and what nothing
   * here can prove: a phone connected, awake and pushed the whole time gets
   * exactly the same list, since the mark only moves on connect. Not "what
   * this device failed to receive" either — the log records what the server
   * DECIDED to raise, before delivery (`watch.ts`'s `pushOne`), so it can
   * legitimately name events that were delivered and read.
   *
   * Nothing renders this today. Whatever eventually does must not call it
   * missed, and must render it on receipt: `applyCatchUp` advances the durable
   * mark the moment the response lands, one-way, so these events are volatile
   * and can never be asked for again.
   *
   * Empty after a resync — see `lib/notifymark.ts` for why nothing is ever
   * surfaced retroactively in that case.
   */
  missed: NotifyEvent[];
  connect(): void;
  disconnect(): void;
  dismissNotice(id: number): void;
  clearMissed(): void;
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
      missed: [],
      blocked: false,

      connect() {
        if (socket) return;
        // What has the server recorded since we last asked? Asked once per
        // connect, including automatic reconnects — a phone that slept through
        // a question is exactly the case this exists for. Never awaited and
        // never allowed to reject: the fleet stream is the thing that matters,
        // and a catch-up that fails simply leaves `missed` empty, which is the
        // honest answer.
        //
        // SERIALISED, because the mark is one value with one owner. A
        // reconnect storm (backoff of 500 ms against a request that has not
        // answered yet) opens the socket again while the first catch-up is
        // still in flight; unchained, the second reads the same STALE mark,
        // asks for the same range, and whichever response lands last is what
        // gets persisted — so the mark can go BACKWARDS and `missed` can gain
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
              if (events.length > 0) set((s) => ({ missed: [...s.missed, ...events] }));
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
            }
            // else: `runs` (Build 7). This store gains its arm in the task
            // that lands the run board (docs/superpowers/plans/2026-08-08-
            // build7-core.md Task 10) — until then an already-deployed PWA
            // drops the frame silently, which is the additive-wire contract
            // FleetMsg's own docstring states.
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

      clearMissed() {
        set({ missed: [] });
      },
    };
  });
}

export const useFleetStore: FleetStore = createFleetStore();
