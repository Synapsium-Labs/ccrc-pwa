// Per-session zustand store: chat reducer over the `/ws/session/:id` stream
// plus optimistic prompt sends. The reducer (`applySessionMsg`) is pure and
// exported for unit tests; the store wraps it with connection wiring and the
// pending-send lifecycle.
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  composePrompt,
  type ChatEvent,
  type Dialog,
  type HookAsk,
  type SessionStatus,
  type SessionStreamMsg,
  type TaskItem,
} from '../../../shared/api';
import { api, ApiError, sendErrorText, type Api } from '../lib/api';
import { ReconnectingSocket, wsUrl } from '../lib/ws';

/** A staged image handed to send(). The path is what the server/dispatch see;
 *  the preview URL is carried only so the optimistic bubble can render the
 *  same thumbnail the composer chip did. */
export interface PendingAttachment {
  path: string;
  previewUrl?: string;
}

export interface PendingSend {
  key: string;
  text: string;
  state: 'sending' | 'failed';
  /** The sentence shown under the failed bubble. */
  error?: string;
  /** The server's own refusal token behind `error`. The bubble branches on
   *  this, never on the sentence. */
  code?: string;
  /** Captured server-side draft on a 409 draft-present failure (Composer sheet). */
  draft?: string;
  /** Remembered so retry() repeats the original call. */
  replaceDraft?: boolean;
  /** Staged images sent alongside text. Object-URL ownership lives here from
   *  send() until this pending is confirmed or explicitly abandoned (discard). */
  attachments?: PendingAttachment[];
}

export interface SessionState {
  events: ChatEvent[]; // deduped by uuid (tool_result keyed by toolId)
  offset: number;
  uuid: string | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  dialog: Dialog | null;
  /** The hook-sourced envelope (`session-hook.sh` via the `ask`/`ask_cleared`
   *  stream frames) — see DialogSheet's header comment for the full
   *  rationale and how it relates to (and takes display priority over)
   *  `dialog` above. */
  ask: HookAsk | null;
  tasks: TaskItem[]; // the session's task list, as the TUI's widget shows it
  missingFile: string | null; // backlog missing:true → the attempted transcript path
  pending: PendingSend[]; // optimistic sends
  conn: 'connecting' | 'open' | 'down';
  apply(msg: SessionStreamMsg): void;
  connect(): void;
  disconnect(): void;
  send(text: string, opts?: { replaceDraft?: boolean; attachments?: PendingAttachment[] }): Promise<void>;
  retry(key: string): void;
  /** Re-send a pending in place after a draft conflict — same record, so the
   *  attachments and their preview URLs survive. */
  resolve(key: string, text: string, opts: { replaceDraft: boolean }): void;
  discard(key: string): void;
}

export type SessionSnapshot = Pick<
  SessionState,
  'events' | 'offset' | 'uuid' | 'status' | 'statusUpdatedAt' | 'dialog' | 'ask' | 'tasks'
> & { missingFile: string | null };

// Locally minted system dividers (rotation markers, notices) — uuid-prefixed so
// the reducer can tell them apart from transcript events.
let localSeq = 0;
const localDivider = (text: string): ChatEvent => {
  localSeq += 1;
  return { kind: 'system', uuid: `local-${localSeq}`, ts: new Date().toISOString(), text };
};
const isLocalDivider = (e: ChatEvent): boolean =>
  e.kind === 'system' && e.uuid.startsWith('local-');

/** Append `incoming` to `existing`, skipping events already present. */
function dedupeAppend(existing: ChatEvent[], incoming: ChatEvent[]): ChatEvent[] {
  const uuids = new Set<string>();
  const resultIds = new Set<string>();
  for (const e of existing) {
    if (e.kind === 'tool_result') resultIds.add(e.toolId);
    else uuids.add(e.uuid);
  }
  const fresh: ChatEvent[] = [];
  for (const e of incoming) {
    if (e.kind === 'tool_result') {
      if (resultIds.has(e.toolId)) continue;
      resultIds.add(e.toolId);
    } else {
      if (uuids.has(e.uuid)) continue;
      uuids.add(e.uuid);
    }
    fresh.push(e);
  }
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** Pure reducer over the session stream — one message in, next snapshot out. */
export function applySessionMsg(s: SessionSnapshot, msg: SessionStreamMsg): SessionSnapshot {
  switch (msg.type) {
    case 'backlog': {
      // A rotation leaves only local divider(s) behind; the follow-up backlog
      // for the same uuid keeps them on top so "Session context reset" survives.
      const keep =
        msg.uuid === s.uuid && s.events.length > 0 && s.events.every(isLocalDivider)
          ? s.events
          : [];
      return {
        ...s,
        events: [...keep, ...msg.events],
        uuid: msg.uuid,
        offset: msg.offset,
        missingFile: msg.missing ? msg.file : null,
      };
    }
    case 'events':
      return {
        ...s,
        events: dedupeAppend(s.events, msg.events),
        uuid: msg.uuid,
        offset: msg.offset,
      };
    case 'status':
      return { ...s, status: msg.status, statusUpdatedAt: msg.statusUpdatedAt };
    case 'dialog':
      return { ...s, dialog: msg.dialog };
    case 'dialog_cleared':
      return { ...s, dialog: null };
    case 'tasks':
      return { ...s, tasks: msg.tasks };
    // The hook-sourced envelope (Task 8, PR C). It resets the exact same way
    // `dialog` does above: only its own `_cleared` message (and the store's
    // initial state) null it out — `rotated` below touches events/uuid/offset
    // only, because a transcript switch does not itself mean a live menu (or
    // the hook's envelope for one) went away.
    case 'ask':
      return { ...s, ask: msg.ask };
    case 'ask_cleared':
      return { ...s, ask: null };
    case 'rotated':
      return {
        ...s,
        events: [localDivider('Session context reset')],
        uuid: msg.uuid,
        offset: 0,
      };
    case 'notice':
      return { ...s, events: [...s.events, localDivider(msg.message)] };
  }
}

const snapshotOf = (s: SessionState): SessionSnapshot => ({
  events: s.events,
  offset: s.offset,
  uuid: s.uuid,
  status: s.status,
  statusUpdatedAt: s.statusUpdatedAt,
  dialog: s.dialog,
  ask: s.ask,
  tasks: s.tasks,
  missingFile: s.missingFile,
});

/** Bare paths for dispatch/api.prompt — the only place attachments narrow
 *  down from the full { path, previewUrl } shape. Takes anything with an
 *  `attachments` field (a PendingSend, or send()'s own opts) so every caller
 *  can share this one narrowing rule. */
const pathsOf = (p: { attachments?: PendingAttachment[] }): string[] | undefined =>
  p.attachments?.length ? p.attachments.map((a) => a.path) : undefined;

/** Object URLs die with the pending that owned them. */
const revoke = (p: PendingSend | undefined): void => {
  for (const a of p?.attachments ?? []) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
};

/** Drop 'sending' pendings whose composed text just arrived back as a real
 *  user event. The server injects composePrompt(text, paths), so matching on
 *  p.text alone would never fire for an attachment send. */
function clearConfirmed(pending: PendingSend[], msg: SessionStreamMsg): PendingSend[] {
  if (msg.type !== 'events' && msg.type !== 'backlog') return pending;
  let next = pending;
  for (const e of msg.events) {
    if (e.kind !== 'user') continue;
    const i = next.findIndex(
      (p) => p.state === 'sending' && composePrompt(p.text, pathsOf(p) ?? []) === e.text,
    );
    if (i >= 0) {
      revoke(next[i]);
      next = [...next.slice(0, i), ...next.slice(i + 1)];
    }
  }
  return next;
}

const failureOf = (e: unknown): { error: string; code?: string; draft?: string } => {
  if (e instanceof ApiError) {
    const body = e.body;
    if (typeof body === 'object' && body !== null) {
      const b = body as { error?: unknown; draft?: unknown };
      if (b.error === 'draft-present') {
        return { error: 'draft-present', code: 'draft-present', draft: typeof b.draft === 'string' ? b.draft : '' };
      }
    }
    // `error` is the SENTENCE and `code` the server's token. They are kept
    // separate because the bubble now branches on the token (only
    // `enter-ignored` earns a Send it button) while still rendering the
    // sentence — reading the branch off the humanised text would break the
    // moment someone rewords it.
    return { error: sendErrorText(e.message), code: e.message };
  }
  return { error: e instanceof Error ? e.message : 'send failed' };
};

export interface SessionStoreDeps {
  api?: Pick<Api, 'prompt'>;
  makeSocket?: (url: string) => WebSocket;
  /** How long a confirmed-by-api pending lingers waiting for its echo event. */
  confirmTimeoutMs?: number;
}

export type SessionStore = UseBoundStore<StoreApi<SessionState>>;

export function createSessionStore(id: string, deps: SessionStoreDeps = {}): SessionStore {
  const apiImpl = deps.api ?? api;
  const confirmTimeoutMs = deps.confirmTimeoutMs ?? 5_000;
  let socket: ReconnectingSocket | null = null;
  let keySeq = 0;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const store = create<SessionState>()((set, get) => {
    // Api accepted the prompt but no echo event arrived: clear after a grace
    // period so a text-mismatched echo can't strand the pending bubble.
    const expireConfirmed = (key: string): void => {
      timers.delete(key);
      set((s) => {
        const p = s.pending.find((x) => x.key === key);
        if (!p || p.state !== 'sending') return {};
        // Abandoning the pending abandons its object URLs with it — the same
        // rule clearConfirmed and discard follow. Without this the echo-mismatch
        // fallback leaked up to four full-size images every time it fired.
        revoke(p);
        return { pending: s.pending.filter((x) => x.key !== key) };
      });
    };

    const dispatch = async (
      key: string,
      text: string,
      opts: { replaceDraft?: boolean; attachments?: string[] } = {},
    ): Promise<void> => {
      try {
        await apiImpl.prompt(id, text, opts);
        timers.set(key, setTimeout(() => expireConfirmed(key), confirmTimeoutMs));
      } catch (e) {
        const { error, code, draft } = failureOf(e);
        set((s) => ({
          pending: s.pending.map((p) =>
            p.key === key ? { ...p, state: 'failed' as const, error, code, draft } : p,
          ),
        }));
      }
    };

    const nudge = (): void => socket?.nudge();

    /**
     * Tell the server whether this session is on the operator's screen, so it
     * can suppress notifications for it (`server/src/presence.ts`, read by the
     * watcher's `pushOne`). A notification for the pane you are looking at
     * teaches you to dismiss notifications.
     *
     * Best-effort by design: a frame that cannot be sent right now is dropped
     * rather than queued, because it is a claim about the present moment.
     * `onOpen` re-states the current truth on every connect.
     */
    const reportVisible = (visible = document.visibilityState === 'visible'): void => {
      socket?.send({ type: 'visible', visible });
    };

    const onVisible = (): void => {
      if (document.visibilityState === 'visible') nudge();
      reportVisible();
    };

    return {
      events: [],
      offset: 0,
      uuid: null,
      status: null,
      statusUpdatedAt: null,
      dialog: null,
      ask: null,
      tasks: [],
      missingFile: null,
      pending: [],
      conn: 'connecting',

      apply(msg) {
        set((s) => ({
          ...applySessionMsg(snapshotOf(s), msg),
          pending: clearConfirmed(s.pending, msg),
        }));
      },

      connect() {
        if (socket) return;
        socket = new ReconnectingSocket({
          url: () => {
            const { uuid, offset } = get();
            const base = wsUrl(`/ws/session/${encodeURIComponent(id)}`);
            return uuid === null
              ? base
              : `${base}?since=${encodeURIComponent(uuid)}:${offset}`;
          },
          onMessage: (m) => get().apply(m as SessionStreamMsg),
          onState: (conn) => set({ conn }),
          // Re-stated on EVERY open, automatic reconnects included: the
          // server's presence registry is keyed per connection, so a reconnect
          // starts with no claim at all and a session the operator is still
          // looking at would quietly start pushing notifications again.
          onOpen: () => reportVisible(),
          makeSocket: deps.makeSocket,
        });
        socket.start();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', nudge);
      },

      disconnect() {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', nudge);
        // Say so before the socket goes: leaving the session screen means the
        // operator is no longer looking at it, and a close alone would let the
        // server infer that only from the disconnect — true here, but not for
        // the automatic reconnects that share this code path's socket.
        reportVisible(false);
        socket?.stop();
        socket = null;
        // Fix round 1 (I1): a dropped connection must not leave a stale hook
        // ask sitting in the store forever. The server's own per-connection
        // sentinel (sessionws.ts's checkHookAsk) now guarantees an explicit
        // ask_cleared on every fresh connect when nothing is really pending,
        // but `ReconnectingSocket`'s automatic reconnects never call this
        // function — only an explicit teardown (leaving the session screen,
        // a swap/compact cycle) does. This is the belt to that fix's braces:
        // whatever the next connect delivers is authoritative, never a
        // leftover from before the drop. `dialog` is untouched — the scraped
        // channel has no analogous "was this fleet host still writing while
        // we were gone" gap, since the pane is re-scraped fresh every poll.
        set({ ask: null });
      },

      async send(text, opts = {}) {
        keySeq += 1;
        const key = `p${keySeq}`;
        set((s) => ({ pending: [...s.pending, {
          key, text, state: 'sending',
          replaceDraft: opts.replaceDraft, attachments: opts.attachments,
        }] }));
        await dispatch(key, text, { replaceDraft: opts.replaceDraft, attachments: pathsOf(opts) });
      },

      retry(key) {
        const p = get().pending.find((x) => x.key === key);
        if (!p || p.state !== 'failed') return;
        // Spread, never re-list: an object literal here is exactly why
        // `attachments` used to vanish on retry, and it would swallow every
        // field added after it too.
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key ? { ...x, state: 'sending' as const, error: undefined, code: undefined, draft: undefined } : x),
        }));
        void dispatch(key, p.text, { replaceDraft: p.replaceDraft, attachments: pathsOf(p) });
      },

      /** Re-send a pending in place after a draft conflict — same record, so the
       *  attachments and their preview URLs survive. Replaces the old
       *  discard-then-send, which dropped both. */
      resolve(key, text, opts) {
        const p = get().pending.find((x) => x.key === key);
        if (!p) return;
        set((s) => ({
          pending: s.pending.map((x) =>
            x.key === key
              ? { ...x, text, state: 'sending' as const, error: undefined, code: undefined, draft: undefined,
                  replaceDraft: opts.replaceDraft }
              : x),
        }));
        void dispatch(key, text, { replaceDraft: opts.replaceDraft, attachments: pathsOf(p) });
      },

      discard(key) {
        const t = timers.get(key);
        if (t !== undefined) {
          clearTimeout(t);
          timers.delete(key);
        }
        set((s) => {
          revoke(s.pending.find((x) => x.key === key));
          return { pending: s.pending.filter((x) => x.key !== key) };
        });
      },
    };
  });

  return store;
}

// One live store per session id — screens for the same session share state.
const stores = new Map<string, SessionStore>();

export function getSessionStore(id: string): SessionStore {
  let s = stores.get(id);
  if (!s) {
    s = createSessionStore(id);
    stores.set(id, s);
  }
  return s;
}

export function useSessionStore(id: string): SessionState;
export function useSessionStore<T>(id: string, selector: (s: SessionState) => T): T;
export function useSessionStore<T>(
  id: string,
  selector?: (s: SessionState) => T,
): SessionState | T {
  const store = getSessionStore(id);
  return selector ? store(selector) : store();
}
