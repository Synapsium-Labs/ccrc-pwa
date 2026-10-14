// Chat list — a bottom-anchored virtual list over the session's UI model.
// `buildChatItems` derives that model from raw events: tool_use + matching
// tool_result merge into one ToolCard entry, timestamp dividers mark gaps in
// the conversation, and optimistic pending sends trail at the end. ChatList
// wraps react-virtuoso (sticks to the bottom unless the reader scrolled up —
// then a "jump to latest" pill); ChatListInner is the same renderer as a
// plain list, exported for jsdom tests.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatEvent, MailEnvelope, TaskNotification } from '../../../shared/api';
import {
  isImageClip, parseFetchedMailEnvelope, parseMailEnvelope, parseTaskNotification, splitClipPaths,
} from '../../../shared/api';
import { api, ApiError, apiErrorText, clipUrl, submitErrorText } from '../lib/api';
import { toast } from '../components/Toast';
import { RenderBoundary } from '../components/RenderBoundary';
import { MsgPlain } from '../lib/markdown';
import { isLocalDivider, type PendingAttachment, type PendingSend } from '../stores/session';
import { MailCard } from './MailCard';
import { TaskCard } from './TaskCard';
import { MessageBubble, foldsAway, timeOf, type MessageEvent } from './MessageBubble';
import {
  FALLBACK_ITEM_HEIGHT, NOMINAL_MEASURES, modelsOf, nominalLines, openingHeight, plainLines, rememberRows,
  rememberedRows, rowHeights, rowId, wellLines,
  type HeightBucket, type Measures, type MeasuredRow, type RowRecord, type RowShape,
} from './itemHeight';
import { ToolCard, askCardLines, type ToolResultEvent, type ToolUseEvent } from './ToolCard';
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
   *  (W-1 / D-296 (was D-B4-23)): a `user` turn is the LEGACY lane (mail typed into the
   *  pane, before 43b2737), and a `tool_result` is the LIVE one (the worker's
   *  own `GET /api/mail/:id`). Which door a card came through is a real
   *  question about it, so the item carries the answer rather than discarding
   *  it. */
  | { kind: 'mail'; key: string; envelope: MailEnvelope; event: MessageEvent | ToolResultEvent }
  /** The harness's report of a finished background task. DERIVED at render
   *  time from a `system` event already in the store, exactly as `mail` is —
   *  nothing is minted into `s.events`, so the revival discipline needs no new
   *  clause and a reconnect re-derives the same card from the same bytes.
   *
   *  A `ChatItem` kind, NOT a `ChatEvent` kind: the ban in `shared/api.ts` is
   *  on the latter, because an unknown `ChatEvent` kind reaches an older PWA
   *  over the wire and renders as a broken bubble. This type is local to the
   *  render and crosses nothing. */
  | { kind: 'task'; key: string; notification: TaskNotification; event: MessageEvent }
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

      // THE LIVE MAIL LANE (W-1 / D-296). Spec §2.1's fact 2 measured a
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
    // The NEWEST time seen, never rewound: transcript order is not time order.
    // An absorbed mid-turn message (D-4950) carries its ENQUEUE time but is
    // written where the model took it, minutes of records later, so measuring
    // the next gap from it drew a divider under a turn that never went quiet.
    // TRANSCRIPT time only: a local divider (a rotation's "Session context
    // reset", a notice) is stamped with the PHONE's clock at "now", so
    // counting it pinned this never-rewound clock above every replayed event
    // and erased each quiet-gap divider after it.
    if (Number.isFinite(t) && !isLocalDivider(e) && (lastTs === null || t > lastTs)) lastTs = t;

    if (e.kind === 'tool_use') {
      const tool: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', key: e.toolId, use: e };
      toolByToolId.set(e.toolId, tool);
      items.push(tool);
    } else {
      if (e.kind === 'system') {
        // The harness's own background-task report. `parse.ts` has already
        // ruled it is not the operator speaking; this reads what it SAYS, and
        // a refusal falls through to the ordinary system row below — spec
        // §2.4's degradation, never a half-populated card.
        const task = parseTaskNotification(e.text);
        if (task.ok) {
          items.push({ kind: 'task', key: e.uuid, notification: task.notification, event: e });
          continue;
        }
      }
      if (e.kind === 'user') {
        // Only when the WHOLE turn is one fenced ccrc-mail block —
        // `parseMailEnvelope` enforces that itself, so this file holds no
        // second copy of the rule (the PWA holds no rule the server does not
        // also hold; the grammar is one definition in `shared/`). A refusal of
        // either kind — `not-mail` or `malformed` — falls through to the
        // ordinary bubble below, which is spec §2.4's stated degradation:
        // never a half-populated card.
        //
        // THE LEGACY LANE (corrected, W-1 / D-296). This arm used to claim
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
 *  don't survive).
 *
 *  A DOCUMENT has no object URL by construction (the tray mints none) and
 *  nothing to draw if it did, so it takes the same name chip the confirmed
 *  bubble gives it — the two must agree, or every send would visibly change
 *  shape the moment it confirms. */
function PendingClipThumbs({ id, attachments }: { id: string; attachments: PendingAttachment[] }): ReactNode {
  return (
    <div className="msg-attach" data-count={Math.min(attachments.length, 2)}>
      {attachments.map((a) => {
        const name = a.path.slice(a.path.lastIndexOf('/') + 1);
        if (!isImageClip(name)) {
          return <span key={a.path} className="msg-attach-doc">{name}</span>;
        }
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
            correspondence claim, and the row is blank when the BOX's marker
            row is empty. After Task 402 that can no longer come from our own
            message — `composePrompt` strips leading blank lines before
            anything is typed — so a human pressing Enter in the box first, or
            a pre-402 client, is what produces it now. `blank-first-row` is the
            server's name for that pane. */}
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

function ChatItemBody({
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
    case 'task':
      return <TaskCard notification={item.notification} />;
    case 'pending':
      return <PendingBubble id={id} send={item.send} onRetry={onRetry} onDiscard={onDiscard} />;
    case 'working':
      return <WorkingIndicator />;
  }
}

/** The note under a message whose bubble threw while rendering (design 2026-10-01 section 4.12). */
const ITEM_MESSAGE_NOTE = 'This message could not render; shown as plain text.';

/** One chat item behind its own RenderBoundary (design 2026-10-01 section 4.12), so an item that throws while
 *  rendering costs that item alone. A message falls back to its raw text (`MsgPlain`: `<pre className="msg-plain">`,
 *  then the note) and is keyed by its text, so a streaming message that threw on one chunk is tried again on the
 *  next; every other kind says "This item could not be shown." and is keyed by its item key. `ChatListInner` and the
 *  virtualised `ChatList` both render through here. */
function ChatItemView(props: Parameters<typeof ChatItemBody>[0]): ReactNode {
  const { item } = props;
  return (
    <RenderBoundary
      where="chat item"
      resetKey={item.kind === 'message' ? item.event.text : item.key}
      fallback={() => item.kind === 'message'
        ? <MsgPlain text={item.event.text} note={ITEM_MESSAGE_NOTE} />
        : <p className="msg-plain-note">This item could not be shown.</p>}
    >
      <ChatItemBody {...props} />
    </RenderBoundary>
  );
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

/** Rows of the attachment grid: one clip fills a single column
 *  (`.msg-attach[data-count='1']`), two or more sit two-up. */
function thumbRows(clips: number): number {
  return clips <= 0 ? 0 : clips === 1 ? 1 : Math.ceil(clips / 2);
}

/** A message row, by the form `MessageBubble` draws it in. */
function messageShape(event: MessageEvent, m: Measures): RowShape {
  if (foldsAway(event)) return { bucket: 'folded', lines: 0 };
  switch (event.kind) {
    case 'system':
      // A pill. The harness's own rows (`origin`) carry fixed one-line copy.
      return { bucket: 'system', lines: event.origin === undefined ? plainLines(event.text, m.prose) : 1 };
    case 'user': {
      // `pre-wrap` prose with the clip paths taken out — they are drawn as a
      // grid of thumbnails above the bubble, not as lines of text.
      const { paths, rest } = splitClipPaths(event.text);
      return { bucket: 'user', lines: plainLines(rest, m.bubble), attach: thumbRows(paths.length) };
    }
    case 'assistant':
      return { bucket: 'assistant', lines: nominalLines(event.text, m.prose) };
  }
}

/**
 * What the list knows about a row before it has rendered one: the population
 * it is sized with, and the length of what it SHOWS — the predictor the
 * learned line is a line in. The list holds every row's source at mount, which
 * is the whole reason a per-row estimate is possible at all.
 *
 * WHAT IT SHOWS, NOT WHAT IT CARRIES (review 191, F2). Where the renderer
 * draws something other than the row's text, the row is priced by the drawing:
 *
 *   - a /compact recap or a multi-line system row renders as ONE folded card
 *     (`foldsAway`) — priced by its text, a recap of a few hundred lines was
 *     thousands of px for a 47px row, and a post-compaction session opened
 *     at +95% to +394% of its true length, measured in a browser;
 *   - a tool call renders as ONE collapsed row, its input ellipsized
 *     (`.tool-sum` is `nowrap`) — priced by its JSON, a capped Write input was
 *     67 lines;
 *   - an ask card draws its questions and answers (`askCardLines`), not the
 *     options in its JSON;
 *   - attachments are a grid of thumbnails, a term of their own (`attach`),
 *     not a line of text each;
 *   - a user bubble, a pill and a mail body are drawn as they are written, so
 *     they are counted plainly (`plainLines`, `wellLines`) — only an assistant
 *     turn is Markdown, with its saturating fences (`nominalLines`).
 *
 * IN LINES OF THE COLUMN IT IS DRAWN IN: `m` is how many characters a line
 * holds there (`measuresOf`) — a bubble's at a bubble's width, the rest at a
 * paragraph's.
 */
export function shapeOf(item: ChatItem, m: Measures = NOMINAL_MEASURES): RowShape {
  switch (item.kind) {
    case 'divider': return { bucket: 'divider', lines: 1 };
    case 'message': return messageShape(item.event, m);
    case 'tool': {
      const ask = askCardLines(item.use, item.result);
      return { bucket: 'tool', lines: ask === null ? 1 : ask.reduce((n, row) => n + plainLines(row, m.prose), 0) };
    }
    case 'mail':
      // Sender row, meta row, one row per artifact path, then the body's well.
      return { bucket: 'mail', lines: 2 + item.envelope.artifacts.length + wellLines(item.envelope.body) };
    case 'task':
      // The summary row, and the "n more" toggle when there are details — closed.
      return { bucket: 'task', lines: item.notification.fields.length > 0 ? 2 : 1 };
    case 'pending':
      return {
        bucket: 'pending',
        lines: plainLines(item.send.text, m.bubble),
        attach: thumbRows(item.send.attachments?.length ?? 0),
      };
    case 'working': return { bucket: 'working', lines: 0 };
  }
}

/** Virtuoso takes its seeded sizes as RUNS that share a size, so identical
 *  neighbours — eighteen tool cards in a row — cost one entry, not eighteen. */
export function sizeRanges(px: readonly number[]): { startIndex: number; endIndex: number; size: number }[] {
  const out: { startIndex: number; endIndex: number; size: number }[] = [];
  for (let i = 0; i < px.length; i += 1) {
    const size = px[i] ?? 0;
    const last = out[out.length - 1];
    if (last !== undefined && last.size === size) last.endIndex = i;
    else out.push({ startIndex: i, endIndex: i, size });
  }
  return out;
}

/** Open at the newest turn. A module constant, not a per-render object: the
 *  prop is read once, and a fresh identity on every render is a needless
 *  invitation for the list to re-run its initial positioning. `'LAST'` +
 *  `align: 'end'` is virtuoso's own way to say "start at the bottom"; the
 *  number this replaced said "put the last item at the TOP" and then leaned on
 *  `alignToBottom` to undo it. */
const OPEN_AT_NEWEST = { index: 'LAST', align: 'end' } as const;

/** What one visit opens with — computed ONCE per mount. */
interface Opening {
  /** The record as this visit found it: what every save of this visit adds to. */
  record: RowRecord;
  /** Virtuoso's `defaultItemHeight`. */
  height: number;
  /** Per-row priors for virtuoso's size tree, or null when there are none. */
  seed: { ranges: { startIndex: number; endIndex: number; size: number }[]; scrollTop: number } | null;
}

function openWith(items: readonly ChatItem[], m: Measures): Opening {
  const record = rememberedRows();
  const models = modelsOf(record);
  // EVERY ROW GETS ITS OWN ESTIMATE, from what it shows. It can: the screen
  // gates this list behind `loading`, so the backlog has already arrived when
  // we first render. A kind this browser has not measured enough of takes the
  // fallback, substituted here and never stored.
  const shapes = items.map((item) => shapeOf(item, m));
  const px = rowHeights(shapes, models, FALLBACK_ITEM_HEIGHT);
  // WHY SEED AT ALL, when `defaultItemHeight` already exists. That prop is ONE
  // number for every row virtuoso has not measured, so it can be right when
  // nothing is measured or right when half is, never both: open the list with
  // the correct total and the moment the giants at the bottom are measured the
  // remaining small rows are still priced at the mean, and the total swings
  // the other way. Seeded sizes are a per-row PRIOR in virtuoso's own size
  // tree, and real measurements land in the same tree and overwrite them.
  //
  // `scrollTop` is the bottom UNDER THIS MODEL, which is where
  // `initialTopMostItemIndex` independently says to open. Virtuoso routes a
  // restored snapshot through that same prop, so the two must agree or they
  // would fight over the opening position; both say "the newest turn".
  //
  // A SEED MADE ENTIRELY OF GUESSES IS NOT INFORMATION, and seeding it is
  // worse than not seeding at all: with nothing learned every row is priced at
  // the same fallback, and saying "n rows of 96px" before the first render
  // FREEZES that total. Measured in a browser on a cold profile: seeding there
  // opened at -53% against the truth. Unseeded, a cold list prices every row
  // it has not measured at `defaultItemHeight` — the fallback — and corrects
  // as rows render. So: seed when at least one kind on screen has been learned.
  const anyLearned = shapes.some((r) => models[r.bucket] !== null);
  return {
    record,
    height: openingHeight(shapes, models, FALLBACK_ITEM_HEIGHT),
    seed: px.length === 0 || !anyLearned ? null : {
      ranges: sizeRanges(px),
      scrollTop: px.reduce((a, b) => a + b, 0),
    },
  };
}

/**
 * THE VISIT'S MEASUREMENTS — what each row really rendered at, read off the
 * row's OWN element by a ResizeObserver.
 *
 * NOT virtuoso's `itemsRendered().size`, which this used to read, and which is
 * the defect this replaces (review 191, F1). For a row virtuoso has not
 * measured yet, that size is its own ESTIMATE from the size tree — on a cold
 * profile the 96px fallback, on a warm one the model's own prediction; it is
 * never 0 while `defaultItemHeight` is set. A save that ran before the real
 * sizes arrived stored the fallback as learned, a reload ran no cleanup to
 * replace it, and the next visit opened seeded with it and saved it again — a
 * fixed point. Measured in headless Chromium with the real virtuoso: every
 * kind stored as `{a: 96, b: 0}`, and the next session opened 21% short of
 * its true length and 34px off the bottom.
 *
 * The height is the row's border box, rounded as virtuoso rounds its own
 * measurement of the wrapper around it (`.chat-item` is that wrapper's only
 * child and carries no margin), so a sample predicts exactly what virtuoso
 * will measure.
 *
 * Keyed by the ROW'S KEY: a row measured again is still one sample, and the
 * last measurement wins — a streaming turn is as tall as it ended up — and a
 * row keeps its sample after it scrolls out of the rendered window. The sample
 * carries the row's number (`rowId`, from the session and the key), which is
 * how the record knows the row again on the NEXT visit.
 */
class RowMeter {
  private observer: ResizeObserver | null = null;
  private readonly rows = new Map<Element, () => MeteredRow>();
  private readonly taken = new Map<string, { bucket: HeightBucket; sample: MeasuredRow }>();

  /** The column's measures AS THEY ARE when a row reports: a row re-wrapped
   *  by a turned phone is counted in the new column's lines. */
  private readonly measures: () => Measures;

  constructor(measures: () => Measures) {
    this.measures = measures;
  }

  /** Measure `el` as the row `row()` is at the time; the return stops it. */
  observe(el: Element, row: () => MeteredRow): () => void {
    if (typeof ResizeObserver === 'undefined') return () => {};
    this.observer ??= new ResizeObserver((entries) => { for (const e of entries) this.take(e); });
    this.rows.set(el, row);
    this.observer.observe(el);
    return () => {
      this.rows.delete(el);
      this.observer?.unobserve(el);
    };
  }

  /** Everything this visit measured, by bucket. */
  visit(): Map<HeightBucket, MeasuredRow[]> {
    const out = new Map<HeightBucket, MeasuredRow[]>();
    for (const { bucket, sample } of this.taken.values()) {
      const list = out.get(bucket);
      if (list === undefined) out.set(bucket, [sample]);
      else list.push(sample);
    }
    return out;
  }

  private take(entry: ResizeObserverEntry): void {
    const row = this.rows.get(entry.target)?.();
    if (row === undefined) return;
    const { item, session } = row;
    const el = entry.target;
    const box = entry.borderBoxSize?.[0];
    const px = Math.round(box === undefined ? el.getBoundingClientRect().height : box.blockSize);
    // A row that is not laid out — the screen hidden behind another — measures
    // 0, which is a measurement of nothing.
    if (!(px > 0) || !inOpeningForm(el)) return;
    const shape = shapeOf(item, this.measures());
    const thumbs = shape.attach ?? 0;
    // The thumbnails are their own term: the bubble's sample is the row
    // without them, and the grid's height is a sample of `attach`.
    const grid = thumbs > 0 ? el.querySelector('.msg-attach') : null;
    const gridPx = grid === null ? 0 : Math.round(grid.getBoundingClientRect().height);
    // One row, one number: the grid is the same row, in its own bucket.
    const id = rowId(session, item.key);
    this.taken.set(item.key, { bucket: shape.bucket, sample: { lines: shape.lines, px: px - gridPx, id } });
    if (gridPx > 0) {
      this.taken.set(`${item.key}\u0000thumbs`, { bucket: 'attach', sample: { lines: thumbs, px: gridPx, id } });
    }
  }
}

/** Whether a row shows the form the NEXT visit will open it in, finished. A
 *  disclosure the reader opened — a tool card's input, a folded recap, a
 *  task's details — is not that form: every row opens closed. An image still
 *  loading is not finished, and reports again when it is. Neither is a sample
 *  of anything the model will be asked about, so the row's last measurement in
 *  its opening form stands. */
function inOpeningForm(el: Element): boolean {
  if (el.querySelector('[aria-expanded="true"]') !== null) return false;
  for (const img of el.querySelectorAll('img')) if (!img.complete) return false;
  return true;
}

/** What the meter needs of a row when it measures one: the row as it is now,
 *  and the session it belongs to. */
interface MeteredRow { item: ChatItem; session: string }

/** One rendered row, measured for as long as virtuoso keeps it mounted. */
function MeasuredItem({
  item,
  session,
  meter,
  children,
}: {
  item: ChatItem;
  session: string;
  meter: RowMeter;
  children: ReactNode;
}): ReactNode {
  const el = useRef<HTMLDivElement>(null);
  // The row at this key changes as events arrive (a streaming turn grows); a
  // measurement is paired with what the row is THEN, not when it mounted.
  const current = useRef<MeteredRow>({ item, session });
  useLayoutEffect(() => { current.current = { item, session }; });
  useLayoutEffect(() => {
    const node = el.current;
    return node === null ? undefined : meter.observe(node, () => current.current);
  }, [meter]);
  return <div ref={el} className="chat-item">{children}</div>;
}

/** Ordinary prose for the probe, so its average glyph is an ordinary one. */
const PROBE_TEXT = 'the parser reads each record and the cache keeps the result so a later call returns at once unless the entry is stale ';

/** No column holds fewer characters a line than this; a probe that reads
 *  fewer was not laid out the way the rows are. */
const MIN_MEASURE = 8;

/**
 * THE COLUMN'S MEASURES (`Measures`), read the only way they can be: by laying
 * out, hidden, one assistant paragraph and one user bubble in the live column,
 * and dividing each one's width by the width of an average glyph of the same
 * text — so whatever the font, the reading measure or the column, a line in
 * the predictor is a line on the screen.
 *
 * In a frame laid over the column that SCROLLS as virtuoso's scroller does, so
 * the probe's rows are exactly as wide as the real ones, scrollbar gutter and
 * all. A column that is not laid out — a screen hidden behind another — reads
 * 0, and is taken to hold the nominal measure.
 */
export function measuresOf(column: HTMLElement): Measures {
  const doc = column.ownerDocument;
  const make = (tag: string, className: string | null, probe: string | null, text: string | null): HTMLElement => {
    const el = doc.createElement(tag);
    if (className !== null) el.className = className;
    if (probe !== null) el.dataset.probe = probe;
    if (text !== null) el.textContent = text;
    return el;
  };
  const frame = make('div', null, null, null);
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;inset:0;overflow-y:scroll;visibility:hidden;pointer-events:none;contain:strict';
  const row = make('div', 'chat-item', null, null);
  const assist = make('div', 'msg-assist', null, null);
  const para = make('p', null, 'prose', PROBE_TEXT.repeat(8));
  // One line that never wraps, to weigh the average glyph: `.msg-assist` is a
  // grid, so it must not stretch to the column either.
  const glyphs = make('span', null, 'glyphs', PROBE_TEXT.repeat(2));
  glyphs.style.cssText = 'white-space:nowrap;width:max-content;justify-self:start';
  const bubble = make('div', 'msg-user', 'bubble', PROBE_TEXT.repeat(8));
  assist.append(para, glyphs);
  row.append(assist, bubble);
  frame.append(row);
  column.append(frame);
  try {
    const glyph = glyphs.getBoundingClientRect().width / (glyphs.textContent ?? '').length;
    const prose = para.getBoundingClientRect().width;
    // The bubble's text runs inside its padding and border.
    const cs = getComputedStyle(bubble);
    const inset = [cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth]
      .reduce((n, v) => n + (parseFloat(v) || 0), 0);
    const inBubble = bubble.getBoundingClientRect().width - inset;
    if (!(glyph > 0) || !(prose > 0) || !(inBubble > 0)) return NOMINAL_MEASURES;
    return {
      prose: Math.max(MIN_MEASURE, Math.floor(prose / glyph)),
      bubble: Math.max(MIN_MEASURE, Math.floor(inBubble / glyph)),
    };
  } finally {
    frame.remove();
  }
}

/** How long after it opens, or after its column changes width, the list may
 *  still be moving on its own: re-wrapping and re-measuring the rows it has
 *  rendered, and virtuoso moving the scroll position to keep them steady. */
const SETTLE_MS = 1000;

/** What a reader does to move the list themselves. Any of them ends the
 *  settling at once: from then on, what the list does is the reader's doing. */
const READER_INPUT = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/**
 * THE COLUMN THE ROWS ARE DRAWN IN: its measures, read again whenever its width
 * changes, and whether the list is SETTLING — moving on its own, as it opens
 * or as its rows re-wrap to a new width, rather than by the reader's hand.
 *
 * A width change is read off the column's own ResizeObserver, created before
 * the list and so before any of virtuoso's or the rows' observers: the browser
 * delivers observers in the order they were made, so the column knows it
 * changed before any row re-wrapped to it reports, and before virtuoso moves
 * the scroll position for it.
 */
class Column {
  private el: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private measured: Measures | null = null;
  private width = 0;
  private settleUntil = Number.NEGATIVE_INFINITY;
  private readonly release = (): void => { this.settleUntil = Number.NEGATIVE_INFINITY; };

  attach(el: HTMLElement): void {
    this.el = el;
    this.measured = measuresOf(el);
    // The width it opens at — not the observer's first report, which a column
    // not laid out yet (0 wide) never makes.
    this.width = el.getBoundingClientRect().width;
    this.settleUntil = performance.now() + SETTLE_MS;
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => {
        for (const e of entries) this.resized(e.contentBoxSize?.[0]?.inlineSize ?? e.contentRect.width);
      });
      this.observer.observe(el);
    }
    for (const type of READER_INPUT) el.addEventListener(type, this.release, { capture: true, passive: true });
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const type of READER_INPUT) this.el?.removeEventListener(type, this.release, { capture: true });
  }

  /** What a line holds in this column now — read when it is attached, and
   *  again on the first ask after its width changes. */
  measures(): Measures {
    if (this.el === null) return NOMINAL_MEASURES;
    return (this.measured ??= measuresOf(this.el));
  }

  /** Whether the list is still moving on its own. */
  settling(): boolean {
    return performance.now() < this.settleUntil;
  }

  private resized(width: number): void {
    if (width !== this.width) {
      this.measured = null;
      this.settleUntil = performance.now() + SETTLE_MS;
    }
    this.width = width;
  }
}

export function ChatList(props: ChatListProps): ReactNode {
  // THE COLUMN IS READ BEFORE THE LIST OPENS: its measures price every row the
  // list opens with, so it must be laid out first. This renders the empty
  // column, reads it in a layout effect, and renders the list into it — React
  // re-renders synchronously from a layout effect, so the list still lands
  // before the first paint.
  const ref = useRef<HTMLDivElement>(null);
  const [column] = useState(() => new Column());
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return undefined;
    column.attach(el);
    setReady(true);
    return () => column.detach();
  }, [column]);
  return (
    <div className="chat-list" ref={ref}>
      {ready && <ChatScroller {...props} column={column} />}
    </div>
  );
}

function ChatScroller({
  id,
  events,
  pending,
  busy = false,
  onRetry,
  onDiscard,
  askPending,
  onAnswer,
  column,
}: ChatListProps & { column: Column }): ReactNode {
  const items = useMemo(
    () => buildChatItems(events, pending, busy),
    [events, pending, busy],
  );
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  // A READER AT THE NEWEST TURN STAYS THERE WHILE THE LIST MOVES ON ITS OWN.
  // Turning a phone or dragging a window re-wraps every rendered row, and
  // virtuoso keeps what is in view steady by moving the scroll position; with
  // rows rendered ABOVE the viewport (the overscan below) that move carried a
  // reader who was at the newest turn away from it — measured in headless
  // Chromium with the real virtuoso, 475-1675px above it with the pill up,
  // where main stayed at 0. The same happens as a cold list opens and its rows
  // measure taller than the fallback priced them. `followOutput` only answers
  // NEW items. So while the column is settling (`Column.settling`), leaving the
  // bottom is the list's doing, not the reader's: a reader who was there is
  // put back. A reader who had scrolled up is not pinned and is never moved;
  // a wheel, a touch or a key ends the settling at once.
  const pinned = useRef(true);
  const onAtBottom = useCallback((bottom: boolean): void => {
    if (!bottom && pinned.current && column.settling()) {
      virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end' });
      return;
    }
    pinned.current = bottom;
    setAtBottom(bottom);
  }, [column]);

  // READ ONCE PER MOUNT, as a lazy initial state — storage is read and parsed
  // here and on no later render. Virtuoso takes `defaultItemHeight` and the
  // snapshot when it initialises; handing it different numbers later changes
  // nothing it reads. The NEXT visit gets the benefit of this one.
  const [opened] = useState(() => openWith(items, column.measures()));
  const [meter] = useState(() => new RowMeter(() => column.measures()));

  // THE SNAPSHOT GOES TO VIRTUOSO ON THE MOUNT RENDER ONLY. Virtuoso reads it
  // once, on mount, but re-publishes every prop it is handed on every render,
  // and each re-publish of a snapshot rewrites `initialTopMostItemIndex` twice
  // over. Measured in headless Chromium with the real virtuoso: 104 list
  // recomputations over twenty streamed chunks against 62 without, and the
  // same opening (same total, no gap to the bottom). Omitted after the mount
  // render, it is simply not re-published.
  //
  // Not `heightEstimates`, virtuoso's own per-row prop: it is applied only
  // while the size tree is EMPTY, and `defaultItemHeight` is published first
  // and fills it, so passing both silently drops the estimates.
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);

  // WHEN A VISIT SAVES: whenever the page is hidden, and on leaving the
  // session. A reload, a closed tab or a PWA the system kills runs no React
  // cleanup, and a backgrounded PWA may never be foregrounded again — `pagehide`
  // and a `hidden` visibility are the last moments a page is promised. Every
  // save adds this visit's rows to the record the visit OPENED with, so
  // saving again is idempotent rather than a second vote.
  useEffect(() => {
    const save = (): void => rememberRows(meter.visit(), opened.record);
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      save();
    };
  }, [meter, opened]);

  return (
    <>
      <Virtuoso
        ref={virtuoso}
        className="chat-scroller"
        totalCount={items.length}
        computeItemKey={(i) => items[i]?.key ?? i}
        itemContent={(i) => {
          const item = items[i];
          if (!item) return null;
          return (
            <MeasuredItem item={item} session={id} meter={meter}>
              <ChatItemView
                item={item}
                id={id}
                onRetry={onRetry}
                onDiscard={onDiscard}
                askPending={askPending}
                onAnswer={onAnswer}
              />
            </MeasuredItem>
          );
        }}
        defaultItemHeight={opened.height}
        // Per-row priors. A row that arrives LATER, while the session tails,
        // is past the seeded range and falls back to `defaultItemHeight`.
        {...(opened.seed !== null && !mounted.current ? { restoreStateFrom: opened.seed } : {})}
        // Render well beyond the viewport in both directions. Two properties,
        // because they answer two different failures: the pixel budget covers
        // ordinary scrolling, and the ITEM-COUNT floor covers the case
        // virtuoso's own docs single out — "items with dynamic or very tall
        // content, where the pixel-based `increaseViewportBy` may not be
        // sufficient to prevent empty areas". A transcript whose items are
        // markdown tables is exactly that case, and an empty area here is the
        // whole chat going blank mid-scroll.
        increaseViewportBy={{ top: 1200, bottom: 1200 }}
        minOverscanItemCount={{ top: 4, bottom: 4 }}
        // Stick to the bottom while the reader is there; never yank them back.
        followOutput={(isAtBottom) => (isAtBottom ? 'smooth' : false)}
        atBottomStateChange={onAtBottom}
        initialTopMostItemIndex={OPEN_AT_NEWEST}
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
    </>
  );
}
