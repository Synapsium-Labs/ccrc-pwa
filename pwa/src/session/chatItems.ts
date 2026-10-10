// The chat's UI MODEL — raw events in, renderable items out.
//
// WHY IT IS ITS OWN FILE. `ChatList.tsx` is a virtual list; this is the
// derivation it renders, and it is pure: a `tool_use` and its matching
// `tool_result` merge into one card, a quiet gap becomes a timestamp
// divider, an envelope that fails to parse is dropped rather than guessed
// at, and optimistic pending sends trail the end. Three test files already
// call `buildChatItems` directly — they now reach it without going through
// the list that renders it.
import type { ChatEvent, MailEnvelope, TaskNotification } from '../../../shared/api';
import { parseFetchedMailEnvelope, parseMailEnvelope, parseTaskNotification } from '../../../shared/api';
import type { ToolResultEvent, ToolUseEvent } from '@ccrc/ui';
import type { PendingSend } from '../stores/session';
import { timeOf, type MessageEvent } from './MessageBubble';

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
    if (Number.isFinite(t)) lastTs = t;

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
