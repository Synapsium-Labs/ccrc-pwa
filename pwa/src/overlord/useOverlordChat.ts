// The Overlord chat's hook (Overlord W1, the chat, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-chat.md`,
// questions 5, 9 and 10).
//
// L4: it reads the thread, refreshes it through ONE coalescer, reads earlier pages and sends. Every decision is
// `chatWords.ts`'s (L1): which stream frames ask for a read (`chatReadTrigger`), when the next read may run (`nextReadAt`),
// whether the timer reads at all (`awaitsPickUp`), and whether a send clears the draft (`draftAfterSend`).
//
// The port is declared HERE, by its consumer, for the three calls the chat makes. The shared client (`lib/api.ts`) gains the
// three functions that implement it in the chat's second stage; until then nothing outside a test builds one.
//
// The kept draft (question 5): a send carries a send key, 128 random bits in base64url, and the term of the thread it was
// composed in. The key and term are bound to the draft's text: a retry of the same text after no answer carries the same
// key and term, so the private store answers the first record again instead of recording twice; a recorded answer or an
// edited draft makes a new key, and `stale-designation` drops the binding, so the next send carries the new thread's term.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionStatus, SessionStreamMsg } from '../../../shared/api';
import type { ChatEarlierAnswer, ChatSendAnswer, ChatThread, GenerationKey } from '../../../shared/overlordChat';
import { ApiError } from '../lib/apiError';
import { apiErrorText, sendErrorText } from '../lib/api';
import { onPageVisible } from '../lib/pageClock';
import {
  awaitsPickUp, chatReadTrigger, chatRefusalRole, draftAfterSend, historyItemsToChat, nextReadAt, sendNotice, type ChatRow,
} from './chatWords';

/** The thread door's answer as the chat reads it. `no-answer` is a transport failure; `off-shape` a body in no shape known. */
export type ChatThreadRead =
  | { readonly kind: 'thread'; readonly thread: ChatThread }
  | { readonly kind: 'refused'; readonly error: string; readonly retryAfterS?: number }
  | { readonly kind: 'off-shape' }
  | { readonly kind: 'no-answer' };

/** The earlier door's answer, or why there is none. */
export type ChatEarlierRead = ChatEarlierAnswer | 'off-shape' | 'no-answer';

export interface ChatSendOpts { readonly offRecord: boolean; readonly sendKey: string; readonly overlordTerm: number }

/** The three calls the chat makes. Each answers; none throws on a refusal. A throw is read as no answer. */
export interface OverlordChatPort {
  thread(): Promise<ChatThreadRead>;
  earlier(gen: GenerationKey, around: string | null): Promise<ChatEarlierRead>;
  send(sessionId: string, text: string, opts: ChatSendOpts): Promise<ChatSendAnswer>;
}

/** Why the thread could not be read this time. The last thread read is kept beside it, never replaced by an empty one. */
export type ThreadTrouble =
  | { readonly kind: 'ceiling' }
  | { readonly kind: 'refused'; readonly words: string }
  | { readonly kind: 'no-answer' }
  | { readonly kind: 'off-shape' };

/** One earlier generation's page state. `next` is what "Show earlier" asks for, or null when there is no more. */
export type EarlierState =
  | { readonly kind: 'loading'; readonly rows: readonly ChatRow[] }
  | { readonly kind: 'rows'; readonly rows: readonly ChatRow[]; readonly next: string | null }
  | { readonly kind: 'unreachable'; readonly rows: readonly ChatRow[]; readonly cause: string | null };

export interface OverlordChat {
  /** The last thread read, or null before the first. */
  readonly thread: ChatThread | null;
  readonly trouble: ThreadTrouble | null;
  readonly earlier: ReadonlyMap<string, EarlierState>;
  /** What the chat says after the last send, or null. */
  readonly notice: string | null;
  readonly showEarlier: (gen: GenerationKey) => void;
  /** The composer's `onRecord`. */
  readonly send: (text: string, offRecord: boolean) => Promise<'clear' | 'keep'>;
  /** Every frame of the Overlord's session stream; the allow-list decides which read. */
  readonly noteFrame: (msg: SessionStreamMsg) => void;
}

export const genKey = (g: GenerationKey): string => `${g.term}:${g.n}`;

/** A send key: 128 random bits, base64url, 22 characters (`shared/operatorMessages.ts#isSendKey`'s grammar). */
export function newSendKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A refusal word in the operator's words: the send table's sentence where it has one, else `apiErrorText`'s. */
export function refusalWords(error: string): string {
  const sent = sendErrorText(error);
  return sent !== error ? sent : apiErrorText(new ApiError(0, { ok: false, error }));
}

const visible = (): boolean => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function useOverlordChat(port: OverlordChatPort): OverlordChat {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [trouble, setTrouble] = useState<ThreadTrouble | null>(null);
  const [earlier, setEarlier] = useState<ReadonlyMap<string, EarlierState>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);

  const portRef = useRef(port);
  portRef.current = port;
  const alive = useRef(true);
  const threadNow = useRef<ChatThread | null>(null);
  const lastReadAt = useRef<number | null>(null);
  const notBefore = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const stale = useRef(false);
  const status = useRef<SessionStatus | null>(null);
  const binding = useRef<{ text: string; key: string; term: number; sessionId: string } | null>(null);
  const earlierNow = useRef<Map<string, EarlierState>>(new Map());

  // One coalescer for every trigger (question 10): a read already waiting absorbs the next ask; a hidden tab reads
  // nothing and reads once when it is shown again.
  const ask = useRef<(now?: boolean) => void>(() => undefined);
  const read = useRef<() => Promise<void>>(async () => undefined);
  read.current = async (): Promise<void> => {
    if (inFlight.current) { again.current = true; return; }
    inFlight.current = true;
    lastReadAt.current = Date.now();
    let r: ChatThreadRead;
    try { r = await portRef.current.thread(); } catch { r = { kind: 'no-answer' }; }
    inFlight.current = false;
    if (!alive.current) return;
    if (r.kind === 'thread') {
      threadNow.current = r.thread;
      setThread(r.thread);
      setTrouble(null);
    } else if (r.kind === 'refused' && chatRefusalRole(r.error) === 'ceiling') {
      notBefore.current = Date.now() + (r.retryAfterS ?? 0) * 1000;
      setTrouble({ kind: 'ceiling' });
    } else {
      setTrouble(r.kind === 'refused' ? { kind: 'refused', words: refusalWords(r.error) } : { kind: r.kind });
    }
    const t = threadNow.current;
    if (again.current) { again.current = false; ask.current(); } else if (t !== null && awaitsPickUp(t)) ask.current();
  };
  // `soon`: past the spacing, never past a ceiling's wait. Only a `stale-designation` answer asks so, since the next send
  // must carry the new thread's term.
  ask.current = (soon = false): void => {
    if (timer.current !== null || !alive.current) return;
    if (!visible()) { stale.current = true; return; }
    if (inFlight.current) { again.current = true; return; }
    const now = Date.now();
    const at = nextReadAt(soon ? null : lastReadAt.current, now, notBefore.current);
    if (at <= now) { void read.current(); return; }
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!visible()) { stale.current = true; return; }
      void read.current();
    }, at - now);
  };

  useEffect(() => {
    alive.current = true;
    ask.current();
    const stop = onPageVisible(() => {
      if (!stale.current) return;
      stale.current = false;
      ask.current();
    });
    return () => {
      alive.current = false;
      stop();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, []);

  const noteFrame = useCallback((msg: SessionStreamMsg): void => {
    const was = status.current;
    if (msg.type === 'status') status.current = msg.status;
    if (chatReadTrigger(msg, was)) ask.current();
  }, []);

  const send = useCallback(async (text: string, offRecord: boolean): Promise<'clear' | 'keep'> => {
    const t = threadNow.current;
    let b = binding.current;
    if (b === null || b.text !== text) {
      if (t === null || t.designation !== 'designated' || t.sessionId === null || t.term === null) {
        setNotice('No Overlord is started, so there is nobody to send to.');
        return 'keep';
      }
      b = { text, key: newSendKey(), term: t.term, sessionId: t.sessionId };
      binding.current = b;
    }
    let a: ChatSendAnswer;
    try { a = await portRef.current.send(b.sessionId, text, { offRecord, sendKey: b.key, overlordTerm: b.term }); } catch {
      a = { kind: 'no-answer' };
    }
    if (!alive.current) return draftAfterSend(a);
    const moved = a.kind === 'refused' && chatRefusalRole(a.error) === 'moved';
    if (a.kind === 'recorded' || moved) binding.current = null;
    setNotice(sendNotice(a, offRecord) ?? (a.kind === 'refused' ? refusalWords(a.error) : null));
    if (a.kind !== 'no-answer') ask.current(moved);
    return draftAfterSend(a);
  }, []);

  const putEarlier = (key: string, s: EarlierState): void => {
    const next = new Map(earlierNow.current);
    next.set(key, s);
    earlierNow.current = next;
    setEarlier(next);
  };
  const showEarlier = useCallback((gen: GenerationKey): void => {
    const key = genKey(gen);
    const was = earlierNow.current.get(key);
    if (was?.kind === 'loading') return;
    const rows = was?.rows ?? [];
    const around = was?.kind === 'rows' ? was.next : null;
    putEarlier(key, { kind: 'loading', rows });
    void (async () => {
      let r: ChatEarlierRead;
      try { r = await portRef.current.earlier(gen, around); } catch { r = 'no-answer'; }
      if (!alive.current) return;
      if (r === 'off-shape' || r === 'no-answer') { putEarlier(key, { kind: 'unreachable', rows, cause: r }); return; }
      if (!r.ok) { putEarlier(key, { kind: 'unreachable', rows, cause: r.cause ?? r.detail ?? r.error }); return; }
      if (r.page.outcome !== 'rows') { putEarlier(key, { kind: 'unreachable', rows, cause: r.page.outcome }); return; }
      const items = r.page.items as readonly Readonly<Record<string, unknown>>[];
      const first = items[0]?.['uuid'];
      const more = r.page.shown < r.page.total && typeof first === 'string';
      putEarlier(key, { kind: 'rows', rows: [...historyItemsToChat(items), ...rows], next: more ? first : null });
    })();
  }, []);

  return { thread, trouble, earlier, notice, showEarlier, send, noteFrame };
}
