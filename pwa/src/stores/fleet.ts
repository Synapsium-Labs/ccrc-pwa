// Fleet zustand store: mirrors the `/ws/fleet` stream — full session
// snapshots on every change plus fleet-wide notices (account swaps etc.).
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { FleetSession, NotifyEvent } from '../../../shared/api';
import { api } from '../lib/api';
import { loadFleetSnapshot, saveFleetSnapshot } from '../lib/offline';
import { applyCatchUp, loadMark } from '../lib/notifymark';
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

// Wire shape of the fleet stream (server.ts /ws/fleet) — local to this store;
// the shared types only cover the per-session stream.
type FleetMsg =
  | { type: 'fleet'; sessions: FleetSession[] }
  | { type: 'notice'; message: string };

const asFleetMsg = (m: unknown): FleetMsg | null => {
  if (typeof m !== 'object' || m === null) return null;
  const t = (m as { type?: unknown }).type;
  if (t === 'fleet' && Array.isArray((m as { sessions?: unknown }).sessions)) {
    return m as FleetMsg;
  }
  if (t === 'notice' && typeof (m as { message?: unknown }).message === 'string') {
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

  return create<FleetState>()((set) => {
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
            } else {
              noticeSeq += 1;
              const notice: FleetNotice = { id: noticeSeq, message: msg.message };
              set((s) => ({ notices: [...s.notices, notice] }));
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

      clearMissed() {
        set({ missed: [] });
      },
    };
  });
}

export const useFleetStore: FleetStore = createFleetStore();
