// Chat list — a bottom-anchored virtual list over the session's UI model.
// `buildChatItems` derives that model from raw events: tool_use + matching
// tool_result merge into one ToolCard entry, timestamp dividers mark gaps in
// the conversation, and optimistic pending sends trail at the end. ChatList
// wraps react-virtuoso (sticks to the bottom unless the reader scrolled up —
// then a "jump to latest" pill); ChatListInner is the same renderer as a
// plain list, exported for jsdom tests.
import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatEvent } from '../../../shared/api';
import { api, ApiError, apiErrorText, clipUrl, submitErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import type { PendingAttachment, PendingSend } from '../stores/session';
import { MessageBubble, timeOf, type MessageEvent } from './MessageBubble';
import { ToolCard, type ToolResultEvent, type ToolUseEvent } from './ToolCard';
import './chat.css';

const DIVIDER_GAP_MS = 10 * 60_000; // a new mono timestamp after 10 quiet minutes

export type ChatItem =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'message'; key: string; event: MessageEvent; streaming: boolean }
  | { kind: 'tool'; key: string; use: ToolUseEvent; result?: ToolResultEvent }
  | { kind: 'pending'; key: string; send: PendingSend }
  | { kind: 'working'; key: 'working' };

/** 'today · 14:02' (or '20 Jul · 14:02' across days) for a ts divider. */
function dividerLabel(ts: string): string | null {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const day = sameDay
    ? 'today'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${day} · ${timeOf(ts)}`;
}

/** Derive the render model: merge tool results, insert dividers, trail pending. */
export function buildChatItems(
  events: ChatEvent[],
  pending: PendingSend[],
  busy = false,
): ChatItem[] {
  const items: ChatItem[] = [];
  const toolByToolId = new Map<string, Extract<ChatItem, { kind: 'tool' }>>();
  let lastTs: number | null = null;

  for (const e of events) {
    if (e.kind === 'tool_result') {
      const tool = toolByToolId.get(e.toolId);
      if (tool) tool.result = e; // orphan results (use before backlog) are dropped
      continue;
    }

    const t = new Date(e.ts).getTime();
    if (Number.isFinite(t) && (lastTs === null || t - lastTs >= DIVIDER_GAP_MS)) {
      const label = dividerLabel(e.ts);
      if (label !== null) items.push({ kind: 'divider', key: `div-${e.uuid}`, label });
    }
    if (Number.isFinite(t)) lastTs = t;

    if (e.kind === 'tool_use') {
      const tool: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', key: e.toolId, use: e };
      toolByToolId.set(e.toolId, tool);
      items.push(tool);
    } else {
      items.push({ kind: 'message', key: e.uuid, event: e, streaming: false });
    }
  }

  // The block caret rides the last assistant turn while the session works.
  if (busy) {
    const last = items[items.length - 1];
    if (last && last.kind === 'message' && last.event.kind === 'assistant') {
      last.streaming = true;
    }
  }

  for (const p of pending) {
    items.push({ kind: 'pending', key: `pending-${p.key}`, send: p });
  }
  // Explicit "Claude is working this turn" indicator. The block caret above only
  // rides the last assistant message, so it's invisible when the last item is a
  // user message, a tool still crunching, or Claude is thinking with no text yet.
  // This trailing pulse makes the working state legible whatever the tail is.
  if (busy) items.push({ kind: 'working', key: 'working' });
  return items;
}

/** Animated "Claude is working this turn" pulse — mirrors the terminal's
 *  cogitating spinner so a reader always knows a turn is in flight. */
function WorkingIndicator(): ReactNode {
  return (
    <p className="msg-working" role="status" aria-label="Claude is working">
      <span className="msg-working-glyph" aria-hidden="true">❯</span>
      <span className="msg-working-label">working</span>
      <span className="msg-working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}

/** Optimistic-send thumbnails: rendered straight from the object URL the
 *  attach tray already created, so chip → pending never flickers empty
 *  waiting on a server round trip. Falls back to `clipUrl` if a pending ever
 *  arrives without one (e.g. rehydrated across a reload, where blob URLs
 *  don't survive). */
function PendingClipThumbs({ id, attachments }: { id: string; attachments: PendingAttachment[] }): ReactNode {
  return (
    <div className="msg-attach" data-count={Math.min(attachments.length, 2)}>
      {attachments.map((a) => {
        const name = a.path.slice(a.path.lastIndexOf('/') + 1);
        return (
          <img
            key={a.path}
            src={a.previewUrl ?? clipUrl(id, name)}
            alt={name}
            className="msg-attach-img"
          />
        );
      })}
    </div>
  );
}

/**
 * The rescue for `enter-ignored`: the server proved our text reached the input
 * box and then watched two Enters get swallowed, so it left the text there
 * rather than risk a misplaced keystroke. One more Enter is the whole fix, and
 * before this button the only way to press it was to open a terminal.
 *
 * `expect` is what makes the outcome attributable to THIS bubble. `POST
 * /submit` presses Enter on whatever the box holds, and the box is shared
 * mutable state: a second send that resolved the draft conflict with "Replace
 * draft" clears this text and types its own over it, and a second
 * `enter-ignored` leaves a DIFFERENT message sitting there — in both cases
 * this bubble is still on screen still offering its button. So the row the
 * server read at failure time is sent back with the tap, and the server
 * refuses `box-mismatch` unless the box still reads exactly that. The button
 * is not rendered at all when there is no such row to send.
 *
 * On success the pending is DISCARDED, not retried: the server proved OUR text
 * was in the box and then proved it left, so the message is in flight for real
 * and the transcript will carry it. Every refusal keeps the bubble — none of
 * them proves this message was sent, `nothing-to-submit` least of all (a box
 * emptied by someone else's `C-u` looks identical).
 */
function SendItButton({
  id,
  sendKey,
  expect,
  onSent,
}: {
  id: string;
  sendKey: string;
  /** The box row the failed send left behind — the correspondence claim. */
  expect: string;
  onSent?: (key: string) => void;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const press = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.submit(id, expect);
      onSent?.(sendKey);
    } catch (e) {
      // A coded refusal gets its own sentence; anything else (the network, a
      // restarting server) gets `apiErrorText`'s floor — `submitErrorText('')`
      // is the empty string, which ToastHost renders as a wordless red box
      // that leaves the tap's outcome entirely unstated.
      toast(e instanceof ApiError ? submitErrorText(e.message) : apiErrorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="pending-send-it" disabled={busy} onClick={() => void press()}>
      Send it
    </button>
  );
}

/** Optimistic send bubble: sending `◌` → (confirmed events replace it) →
 *  failed red `!` with the error and Retry/Discard. */
function PendingBubble({
  id,
  send,
  onRetry,
  onDiscard,
}: {
  id: string;
  send: PendingSend;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
}): ReactNode {
  const attachments = send.attachments;
  if (send.state === 'sending') {
    return (
      <>
        {attachments && attachments.length > 0 && (
          <PendingClipThumbs id={id} attachments={attachments} />
        )}
        <div className="msg-user">{send.text}</div>
        <p className="msg-receipt">
          <span aria-hidden="true">◌</span> sending
        </p>
      </>
    );
  }
  return (
    <>
      {attachments && attachments.length > 0 && (
        <PendingClipThumbs id={id} attachments={attachments} />
      )}
      <div className="msg-user msg-user--failed">{send.text}</div>
      <p className="msg-receipt msg-receipt--failed">
        <span aria-hidden="true">!</span> not sent
      </p>
      {send.error !== undefined && send.error !== 'draft-present' && (
        <p className="pending-error">{send.error}</p>
      )}
      <div className="pending-actions">
        {/* Only for `enter-ignored`, and that narrowness is the point: it is
            the one refusal where the server has PROVEN the text is sitting in
            the box and both of `sendPrompt`'s Enters were swallowed. Retry
            would re-type a message that is already there; Send it presses one
            more Enter. Every other failure leaves nothing to submit.

            AND only when that refusal carried the box row it read. Without it
            there is nothing to prove the box still holds this message rather
            than a later one, and a button that submits an unproven box is the
            hazard this whole route is gated against — so the operator gets the
            sentence and the terminal, not a tap that might send someone else's
            text. (The row is blank exactly when the message's own first line
            was blank; `blank-first-row` is the server's name for that pane.) */}
        {send.code === 'enter-ignored' && send.draft !== undefined && send.draft.trim() !== '' && (
          <SendItButton id={id} sendKey={send.key} expect={send.draft} onSent={onDiscard} />
        )}
        <button type="button" className="pending-retry" onClick={() => onRetry?.(send.key)}>
          Retry
        </button>
        <button type="button" onClick={() => onDiscard?.(send.key)}>
          Discard
        </button>
      </div>
    </>
  );
}

function ChatItemView({
  item,
  id,
  onRetry,
  onDiscard,
}: {
  item: ChatItem;
  /** Session id — threaded down to clip thumbnails (`clipUrl(id, name)`). */
  id: string;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
}): ReactNode {
  switch (item.kind) {
    case 'divider':
      return <p className="ts-divider">{item.label}</p>;
    case 'message':
      return <MessageBubble event={item.event} id={id} streaming={item.streaming} />;
    case 'tool':
      return <ToolCard use={item.use} result={item.result} />;
    case 'pending':
      return <PendingBubble id={id} send={item.send} onRetry={onRetry} onDiscard={onDiscard} />;
    case 'working':
      return <WorkingIndicator />;
  }
}

export interface ChatListProps {
  /** Session id — clip thumbnails resolve against `clipUrl(id, name)`. */
  id: string;
  events: ChatEvent[];
  pending: PendingSend[];
  /** Session is mid-turn — the last assistant bubble wears the caret. */
  busy?: boolean;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
}

/** Plain-list renderer — the virtual list's item model without the viewport
 *  machinery. Used directly by unit tests (Virtuoso can't measure in jsdom). */
export function ChatListInner({
  id,
  events,
  pending,
  busy = false,
  onRetry,
  onDiscard,
}: ChatListProps): ReactNode {
  const items = buildChatItems(events, pending, busy);
  return (
    <div className="chat-inner">
      {items.map((item) => (
        <div key={item.key} className="chat-item">
          <ChatItemView item={item} id={id} onRetry={onRetry} onDiscard={onDiscard} />
        </div>
      ))}
    </div>
  );
}

export function ChatList({
  id,
  events,
  pending,
  busy = false,
  onRetry,
  onDiscard,
}: ChatListProps): ReactNode {
  const items = useMemo(
    () => buildChatItems(events, pending, busy),
    [events, pending, busy],
  );
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  return (
    <div className="chat-list">
      <Virtuoso
        ref={virtuoso}
        className="chat-scroller"
        totalCount={items.length}
        computeItemKey={(i) => items[i]?.key ?? i}
        itemContent={(i) => {
          const item = items[i];
          if (!item) return null;
          return (
            <div className="chat-item">
              <ChatItemView item={item} id={id} onRetry={onRetry} onDiscard={onDiscard} />
            </div>
          );
        }}
        // Stick to the bottom while the reader is there; never yank them back.
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={setAtBottom}
        initialTopMostItemIndex={Math.max(0, items.length - 1)}
        alignToBottom
      />
      {!atBottom && (
        <button
          type="button"
          className="jump-latest"
          onClick={() =>
            virtuoso.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth' })
          }
        >
          Jump to latest <span aria-hidden="true">↓</span>
        </button>
      )}
    </div>
  );
}
