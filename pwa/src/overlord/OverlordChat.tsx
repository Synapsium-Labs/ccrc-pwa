// The chat part of the Overlord place (Overlord W1, the chat, Task 4; plan `docs/superpowers/plans/2026-11-14-overlord-w1/
// w1-chat.md`; spec §4 Table 4a, part 7).
//
// Oldest first, scrolled to the newest: each generation's divider (with its earlier page once asked for), the record's
// messages as operator bubbles with their ticks and marks, the server's line under a message, the current generation's
// transcript rows merged with the record (`chatWords.ts#mergeLive`), every user turn drawn by its origin, a line for each part
// that could not be read (never an empty conversation), and the composer, with the off-the-record toggle before Send.
//
// THE RECORD IS THE ONLY SOURCE OF THE OPERATOR'S WORDS: only an `entry` row holding a `message` is drawn as an operator
// bubble. L4: every decision is `chatWords.ts`'s, every read and send `useOverlordChat`'s.
//
// What it takes as props, so it imports no file another part owns: the port (the shared client implements it in the chat's
// second stage), the current generation's transcript rows (`ChatItem`, `buildChatItems`'s rows, from the place's session
// stream), and that stream's frames through `subscribe`. The place mounts it.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionStreamMsg } from '../../../shared/api';
import type { ChatEntry } from '../../../shared/overlordChat';
import { Composer } from '../session/Composer';
import { ChatItemView } from '../session/ChatList';
import type { ChatItem } from '../session/chatItems';
import { ChatDivider } from './ChatDivider';
import { ChatServerLine } from './ChatServerLine';
import { ChatTicks } from './ChatTicks';
import { PaneTurn } from './PaneTurn';
import {
  CUT_WORDS, EARLIER_UNREACHABLE_WORDS, GENERATIONS_UNMEASURED_WORDS, MESSAGES_UNMEASURED_WORDS, NO_OVERLORD_WORDS, OFF_RECORD_WORDS,
  READ_CEILING_WORDS, READINESS_UNMEASURED_WORDS, READING_WORDS, THREAD_NO_ANSWER_WORDS, THREAD_OFF_SHAPE_WORDS, ccrcLineWords,
  mergeLive, messageLinkWords, type ChatRow,
} from './chatWords';
import { genKey, useOverlordChat, type EarlierState, type OverlordChatPort, type ThreadTrouble } from './useOverlordChat';
import './overlordChat.css';

export interface OverlordChatProps {
  readonly port: OverlordChatPort;
  /** The current generation's transcript rows, oldest first. */
  readonly live: readonly ChatItem[];
  /** The Overlord's session stream, frame by frame; the answer unsubscribes. Absent: only the timer and sends refresh. */
  readonly subscribe?: (onFrame: (msg: SessionStreamMsg) => void) => () => void;
}

const troubleWords = (t: ThreadTrouble): string =>
  t.kind === 'ceiling' ? READ_CEILING_WORDS
    : t.kind === 'refused' ? t.words
      : t.kind === 'no-answer' ? THREAD_NO_ANSWER_WORDS : THREAD_OFF_SHAPE_WORDS;

function Message({ entry }: { entry: Extract<ChatEntry, { kind: 'message' }> }): ReactNode {
  const { row, ticks } = entry;
  return (
    <article className="oc-msg" aria-label={`Operator message ${row.id}`}>
      <p className="oc-msg-text">{row.text}</p>
      {(row.cut || row.offRecord) && (
        <p className="oc-msg-marks">
          {row.offRecord && <span className="oc-mark">{OFF_RECORD_WORDS}</span>}
          {row.cut && <span className="oc-mark">{CUT_WORDS}</span>}
        </p>
      )}
      <ChatTicks ticks={ticks} />
    </article>
  );
}

function EarlierPage({ state, onMore, sessionId }: { state: EarlierState; onMore: () => void; sessionId: string }): ReactNode {
  return (
    <div className="oc-earlier">
      {state.kind === 'rows' && state.next !== null && (
        <button type="button" className="oc-divider-show" onClick={onMore}>Show earlier</button>
      )}
      {state.rows.map((r) => <Row key={r.key} row={r} sessionId={sessionId} />)}
      {state.kind === 'loading' && <p className="oc-quiet" role="status">{READING_WORDS}</p>}
      {state.kind === 'unreachable' && (
        <p className="oc-quiet" role="status">{EARLIER_UNREACHABLE_WORDS}{state.cause !== null ? ` (${state.cause})` : ''}</p>
      )}
    </div>
  );
}

/** One row that is not a divider. A divider is drawn by the part, which holds its earlier page. */
function Row({ row, sessionId }: { row: ChatRow; sessionId: string }): ReactNode {
  switch (row.kind) {
    case 'entry':
      if (row.entry.kind === 'message') return <Message entry={row.entry} />;
      if (row.entry.kind === 'server-line') return <ChatServerLine text={row.entry.text} />;
      return null;
    case 'live':
      return <ChatItemView item={row.item} id={sessionId} />;
    case 'pane-turn':
      return <PaneTurn text={row.text} />;
    case 'ccrc-line':
      return <p className="oc-quiet oc-ccrc-line">{ccrcLineWords(row.name)}</p>;
    case 'message-link':
      return <p className="oc-quiet oc-message-link">{messageLinkWords(row.id)}</p>;
    case 'history-text':
      return <p className="oc-history-text">{row.text}</p>;
    case 'untrusted-block':
      return <pre className="oc-untrusted">{row.text}</pre>;
  }
}

export function OverlordChat({ port, live, subscribe }: OverlordChatProps): ReactNode {
  const chat = useOverlordChat(port);
  const [offRecord, setOffRecord] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const { noteFrame } = chat;
  useEffect(() => subscribe?.(noteFrame), [subscribe, noteFrame]);

  const t = chat.thread;
  const designated = t !== null && t.designation === 'designated';
  const rows = t === null ? [] : mergeLive(t.entries, designated ? live : []);
  const sessionId = t?.sessionId ?? '';

  // Scrolled to the newest while the reader is at the foot; a reader who scrolled up stays where they are.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el !== null && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, chat.earlier]);
  const onScroll = (): void => {
    const el = scroller.current;
    if (el !== null) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const record = async (text: string): Promise<'clear' | 'keep'> => {
    const d = await chat.send(text, offRecord);
    if (d === 'clear') setOffRecord(false);
    return d;
  };

  const toggle = (
    <button type="button" className="oc-off-record" aria-pressed={offRecord} disabled={!designated}
      onClick={() => setOffRecord((v) => !v)}>
      Off the record
    </button>
  );

  return (
    <section className="oc-chat" aria-label="Chat with the Overlord">
      <div className="oc-thread" ref={scroller} onScroll={onScroll}>
        {t === null && chat.trouble === null && <p className="oc-quiet" role="status">{READING_WORDS}</p>}
        {t !== null && t.designation === 'none' && <p className="oc-quiet" role="status">{NO_OVERLORD_WORDS}</p>}
        {t !== null && t.generations.kind === 'unmeasured' && <p className="oc-unmeasured" role="status">{GENERATIONS_UNMEASURED_WORDS}</p>}
        {rows.map((r) => {
          if (r.kind === 'entry' && r.entry.kind === 'divider') {
            const d = r.entry;
            const state = chat.earlier.get(genKey(d.gen));
            return (
              <ChatDivider key={r.key} divider={d} busy={state?.kind === 'loading'}
                onShow={state === undefined || state.kind === 'unreachable' ? () => chat.showEarlier(d.gen) : undefined}>
                {state !== undefined && <EarlierPage state={state} sessionId={sessionId} onMore={() => chat.showEarlier(d.gen)} />}
              </ChatDivider>
            );
          }
          return <Row key={r.key} row={r} sessionId={sessionId} />;
        })}
        {t !== null && t.messages.kind === 'unmeasured' && <p className="oc-unmeasured" role="status">{MESSAGES_UNMEASURED_WORDS}</p>}
        {t !== null && t.readiness.kind === 'unmeasured' && <p className="oc-unmeasured" role="status">{READINESS_UNMEASURED_WORDS}</p>}
        {chat.trouble !== null && <p className="oc-quiet" role="status">{troubleWords(chat.trouble)}</p>}
      </div>
      {chat.notice !== null && <p className="oc-notice" role="status">{chat.notice}</p>}
      <div className="oc-composer">
        <Composer onRecord={record} pending={[]} placeholder="Message the Overlord" disabled={!designated} leading={toggle} />
      </div>
    </section>
  );
}
