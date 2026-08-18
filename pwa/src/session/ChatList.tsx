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
import type { ChatEvent, MailEnvelope } from '../../../shared/api';
import { parseFetchedMailEnvelope, parseMailEnvelope } from '../../../shared/api';
import { api, ApiError, apiErrorText, clipUrl, submitErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import type { PendingAttachment, PendingSend } from '../stores/session';
import { MailCard } from './MailCard';
import { MessageBubble, timeOf, type MessageEvent } from './MessageBubble';
import { ToolCard, type ToolResultEvent, type ToolUseEvent } from './ToolCard';
import './chat.css';

const DIVIDER_GAP_MS = 10 * 60_000; // a new mono timestamp after 10 quiet minutes

export type ChatItem =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'message'; key: string; event: MessageEvent; streaming: boolean }
  | { kind: 'tool'; key: string; use: ToolUseEvent; result?: ToolResultEvent }
  /** Delivered agent-to-agent mail (Build 4 Task 17, spec §2.3). EXACTLY ONE
   *  new member, and it is DERIVED at render time from an event that is
   *  already in the store — nothing is minted into `s.events`, so the revival
   *  discipline (`stores/session.ts`) needs no new clause and a reconnect
   *  re-derives the same card from the same JSONL bytes. That is the whole
   *  reason to build mail attribution this way rather than as a synthesized
   *  row.
   *
   *  `event` is the PROVENANCE, and it is a union because there are two doors
   *  (W-1 / D-B4-23): a `user` turn is the LEGACY lane (mail typed into the
   *  pane, before 43b2737), and a `tool_result` is the LIVE one (the worker's
   *  own `GET /api/mail/:id`). Which door a card came through is a real
   *  question about it, so the item carries the answer rather than discarding
   *  it. */
  | { kind: 'mail'; key: string; envelope: MailEnvelope; event: MessageEvent | ToolResultEvent }
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

      // THE LIVE MAIL LANE (W-1 / D-B4-23). Spec §2.1's fact 2 measured a
      // delivery lane that typed the whole envelope into the recipient's pane;
      // 43b2737 — shipped mid-program, before this wave's base — replaced it
      // with a one-line nudge, so an envelope now reaches a transcript only as
      // the output of the worker's own `GET /api/mail/:id`. That is a
      // `tool_result`, and without this arm the card below has no live
      // producer at all.
      //
      // ADDED, NEVER SUBSTITUTED: the result is attached to its tool card
      // above first, or the fetch would render as a call still crunching,
      // forever. The card joins the fetch in transcript order; it does not
      // replace it.
      //
      // TWO GUARDS, both about what a card CLAIMS:
      //  - `isError` — a fetch that did not come back cleanly returned no
      //    envelope, whatever is in its buffer.
      //  - `truncatedBytes > 0` — the server has told us it cut this result,
      //    and a card asserting "this is what was said" cannot rest on a
      //    fragment (spec §2.4 bans the half-populated card). The parse would
      //    refuse MOST truncated envelopes unaided, since the closing fence is
      //    the last line and the cut takes the tail — but "most" is not a
      //    property to build a claim on. ABSENT is not zero: an older server
      //    did not report, which is every transcript written before Task 16,
      //    and refusing those would make this whole path dead for them.
      if (!e.isError && (e.truncatedBytes === undefined || e.truncatedBytes === 0)) {
        const fetched = parseFetchedMailEnvelope(e.text);
        if (fetched.ok) {
          // Keyed on the API's own call id — the same identity the tool card
          // keys on, in a distinct namespace so the two cannot collide. TWO
          // FETCHES OF ONE DELIVERY MAKE TWO CARDS, deliberately: the card
          // answers "what was said, and WHEN, relative to what the session did
          // next", and two fetches are two things the session did.
          // De-duplicating would need cross-item state keyed on envelope id —
          // the reconciliation problem spec §2.2 refused a second frame over —
          // and would break the derived-from-one-event property that lets the
          // revival discipline stay unchanged.
          items.push({ kind: 'mail', key: `mail-${e.toolId}`, envelope: fetched.envelope, event: e });
        }
      }
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
      if (e.kind === 'user') {
        // Only when the WHOLE turn is one fenced ccrc-mail block —
        // `parseMailEnvelope` enforces that itself, so this file holds no
        // second copy of the rule (the PWA holds no rule the server does not
        // also hold; the grammar is one definition in `shared/`). A refusal of
        // either kind — `not-mail` or `malformed` — falls through to the
        // ordinary bubble below, which is spec §2.4's stated degradation:
        // never a half-populated card.
        //
        // THE LEGACY LANE (corrected, W-1 / D-B4-23). This arm used to claim
        // that "the delivery lane types the envelope into the recipient's
        // INPUT BOX, so delivered mail can only ever arrive as a user turn".
        // That was true when spec §2.1 measured it and false by the time this
        // shipped: 43b2737 replaced the typed envelope with a one-line nudge,
        // and `watch.ts` now says so in its own words. Mail delivered TODAY
        // arrives as the `tool_result` of the worker's own fetch, handled in
        // the branch above.
        //
        // This arm stays, and is not vestigial: transcripts written before
        // that commit hold real fenced envelopes as user turns, and they still
        // render as cards. `user` only — an assistant turn quoting an envelope
        // is the agent's own words about mail, not mail. It is also the
        // narrower of the two doors, and deliberately not widened to the fetch
        // shapes: a typed envelope is never a JSON response.
        const parsed = parseMailEnvelope(e.text);
        if (parsed.ok) {
          items.push({ kind: 'mail', key: e.uuid, envelope: parsed.envelope, event: e });
          continue;
        }
      }
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
 * The rescue for a refusal the server marked `submittable`: it proved our text
 * reached the input box and then watched two Enters get swallowed, so it left
 * the text there rather than risk a misplaced keystroke. One more Enter is the
 * whole fix, and before this button the only way to press it was to open a
 * terminal. (`enter-ignored` is the only arm that earns the flag today; the
 * caller gates on the flag rather than the code — see the gate's own comment.)
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
        {/* Gated on the server's PROOF, not on the code — and that distinction
            is the whole design.

            The rule this comment used to state was "only `enter-ignored`,
            because it is the one refusal where the server has PROVEN the text
            is in the box", and it warned that a button submitting an unproven
            box is the hazard this route exists to be gated against. That
            warning is still exactly right, and it is why the condition below
            is NOT widened on `code`: the attachment path's `verify-failed`
            also carries a `draft`, but that draft is what a FAILED clear left
            behind — a FRAGMENT of the message. `POST /submit`'s correspondence
            gate cannot catch it, because the fragment IS what the box reads,
            so it matches and Enter submits the fragment.

            `submittable` is the server's answer to that objection: it is set
            only where the server watched the text echo into the box and then
            fail to leave, so the row is the whole message and one Enter would
            send exactly it. An older server never sends it — no button,
            today's behaviour, the safe direction.

            THE `verify-failed` LIMB IS DORMANT ON TODAY'S SERVER, deliberately
            and not by oversight: `SendResult.submittable` sets the flag on
            `enter-ignored` alone, and states why neither `verify-failed` arm
            can honestly claim it (an empty box, somebody else's words, or a
            partial render of our own text — all three fragments or foreign).
            It is written here anyway because the gate belongs on the proof: a
            server arm that ever earns the flag needs no client change, and
            until one does, this limb renders nothing. A downstream gate
            patching an upstream lie is the shape this build removes.

            `draft` is still required and still non-blank: it is the
            correspondence claim, and the row is blank exactly when the
            message's own first line was blank (`blank-first-row`). After
            Task 402 that no longer comes from `composePrompt` — a human
            pressing Enter in the box first, or a pre-402 client, is what
            produces it now. */}
        {(send.code === 'enter-ignored' || send.code === 'verify-failed')
          && send.submittable === true
          && send.draft !== undefined && send.draft.trim() !== '' && (
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
  askPending,
  onAnswer,
}: {
  item: ChatItem;
  /** Session id — threaded down to clip thumbnails (`clipUrl(id, name)`). */
  id: string;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
  askPending?: boolean;
  onAnswer?: () => void;
}): ReactNode {
  switch (item.kind) {
    case 'divider':
      return <p className="ts-divider">{item.label}</p>;
    case 'message':
      return <MessageBubble event={item.event} id={id} streaming={item.streaming} />;
    case 'tool':
      return (
        <ToolCard use={item.use} result={item.result} askPending={askPending} onAnswer={onAnswer} />
      );
    case 'mail':
      return <MailCard envelope={item.envelope} />;
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
  /** The session is holding a live `ask` OR `dialog` (spec §2.3). One of the
   *  two sources the ask card's state axis is derived from; the other is the
   *  card's own `tool_result`. */
  askPending?: boolean;
  /** Raise the answer sheet. The transcript never answers anything itself —
   *  `EnvelopeSheet` stays the one hardened sender. */
  onAnswer?: () => void;
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
  askPending,
  onAnswer,
}: ChatListProps): ReactNode {
  const items = buildChatItems(events, pending, busy);
  return (
    <div className="chat-inner">
      {items.map((item) => (
        <div key={item.key} className="chat-item">
          <ChatItemView
            item={item}
            id={id}
            onRetry={onRetry}
            onDiscard={onDiscard}
            askPending={askPending}
            onAnswer={onAnswer}
          />
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
  askPending,
  onAnswer,
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
              <ChatItemView
                item={item}
                id={id}
                onRetry={onRetry}
                onDiscard={onDiscard}
                askPending={askPending}
                onAnswer={onAnswer}
              />
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
