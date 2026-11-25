// Chat list — a bottom-anchored virtual list over the session's UI model.
// `buildChatItems` (chatItems.ts) derives that model from raw events: tool_use + matching
// tool_result merge into one ToolCard entry, timestamp dividers mark gaps in
// the conversation, and optimistic pending sends trail at the end. ChatList
// wraps react-virtuoso (sticks to the bottom unless the reader scrolled up —
// then a "jump to latest" pill); ChatListInner is the same renderer as a
// plain list, exported for jsdom tests.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { ChatEvent } from '../../../shared/api';
import { splitClipPaths } from '../../../shared/api';
import { MailCard, OlderEdge, OlderGap, TaskCard, ToolCard, askCardLines } from '@ccrc/ui';
import { RenderBoundary } from '../components/RenderBoundary';
import { MsgPlain } from '../lib/markdown';
import { onPageHidden } from '../lib/pageClock';
import { useFrameSet } from '../skins/frame';
import type { SkinSet } from '../skins/types';
import type { PendingSend } from '../stores/session';
import { MessageBubble, foldsAway, type MessageEvent } from './MessageBubble';
import { buildChatItems, type ChatItem } from './chatItems';
import {
  FALLBACK_ITEM_HEIGHT, NOMINAL_MEASURES, modelsOf, nominalLines, openingHeight, plainLines, rememberRows,
  rememberedRows, rowHeights, rowId, wellLines,
  type HeightBucket, type Measures, type MeasuredRow, type RowRecord, type RowShape,
} from './itemHeight';
import { PendingBubble } from './PendingBubble';
import { sameRowProps } from './sameRow';
import { renderToolWell } from './ToolWellText';
import { TAP_SETTLE_MS, footLeft, heightMove, holdShift, prependShift } from './footFollow';
import { NO_PAGING, isGapMarker, liveFromOf, type OlderPaging } from './olderPages';
import { keepOpenAcross, renamedAcross } from './stretchJoin';
import { foldToolActivity, rowScope, waitKey, waitOf, type LiveWait, type RowScope, type TranscriptItem } from './toolActivity';
import { ToolActivityRow } from './ToolActivityRow';
import { groupToolRun } from './toolSummary';
import { TranscriptRowContext, useExpansionMemo, type ExpansionMemo } from './transcriptRow';
import './chat.css';

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

function ChatItemBody({
  item,
  id,
  onRetry,
  onDiscard,
  askPending,
  askBelow,
  answerLabel,
  onAnswer,
  day,
  settled,
}: {
  item: ChatItem;
  /** Session id — threaded down to clip thumbnails (`clipUrl(id, name)`). */
  id: string;
  onRetry?: (key: string) => void;
  onDiscard?: (key: string) => void;
  askPending?: boolean;
  /** A tool call's turn is over (`RowScope.past`): one with no result is drawn as having none, never as running. */
  settled?: boolean;
  /** D-6326: an inline ask surface is mounted below the transcript (the desk), so a live ask card points at it. It also holds a
   *  failed bubble's Retry (R89, passed to `PendingBubble` as `sendHeld`): Retry is a send, deferred while the card is up. */
  askBelow?: boolean;
  /** The transcript's Answer control's word (decision `ask-answer-control-says-submit`). */
  answerLabel?: string;
  onAnswer?: () => void;
  /** The viewer's local day (`lib/clock.ts#dayKey`): a row whose words read the clock draws again when it changes. */
  day?: string;
}): ReactNode {
  switch (item.kind) {
    case 'divider':
      return <p className="ts-divider">{item.label}</p>;
    case 'message':
      // Wave 175: where an older page left records out, the store's local marker (`olderPages.ts#prependPage`).
      if (isGapMarker(item.event)) return <OlderGap />;
      return <MessageBubble event={item.event} id={id} streaming={item.streaming} day={day} />;
    case 'tool':
      return (
        <ToolCard
          use={item.use} result={item.result} settled={settled} renderWell={renderToolWell(item.use)}
          askPending={askPending} askBelow={askBelow} answerLabel={answerLabel} onAnswer={onAnswer}
        />
      );
    case 'mail':
      return <MailCard envelope={item.envelope} />;
    case 'task':
      return <TaskCard notification={item.notification} />;
    case 'pending':
      return <PendingBubble id={id} send={item.send} onRetry={onRetry} onDiscard={onDiscard} sendHeld={askBelow} />;
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

/** THE LIST THE TRANSCRIPT SHOWS (D-5475, W2 Task S13b; desktop polish wave 168). The set's declarative fields say
 *  how it folds: `toolActivity` folds each stretch of a turn's tool activity into one row (`foldToolActivity`), and
 *  `transcriptGrouping` folds runs of tool entries (`groupToolRun`) — at the top level, or inside each activity row when
 *  both are on. Applied BEFORE the list is handed to Virtuoso, because a fold changes the count, the indices and the
 *  seeded heights, which no per-item row can. Data, not logic: nothing here compares a skin id (D-5469), and outside a
 *  frame (most suites) nothing folds. */
function transcriptOf(
  set: SkinSet | null, items: ChatItem[], wait: LiveWait, busy: boolean, liveFrom = 0,
): TranscriptItem[] {
  const runs = set?.transcriptGrouping ?? 'none';
  // `liveFrom` (wave 175): the items before it are an older page's, display only (`olderPages.ts#liveFromOf`).
  if (set?.toolActivity === 'stretches') return foldToolActivity(items, { runs, wait, busy, liveFrom });
  return runs === 'tool-runs' ? groupToolRun(items) : items;
}

/** The items a list draws: the chat items, the older rows' boundary found, then folded (wave 175). */
function itemsOf(
  set: SkinSet | null, events: ChatEvent[], pending: PendingSend[], busy: boolean, wait: LiveWait, older: OlderPaging,
): TranscriptItem[] {
  const built = oneDividerAtGap(buildChatItems(events, pending, busy));
  return transcriptOf(set, built, wait, busy, liveFromOf(built, events, older));
}

/** A gap marker with nothing of its page above it (the page was only the record it skipped) is the first row its time
 *  divider is measured on, and the row below it is measured again from the same place, so the two draw the same divider
 *  (fix round 1, A4): the one below the marker goes. Every other gap marker draws none (`olderPages.ts#prependPage`). */
function oneDividerAtGap(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const it = items[i]!;
    const gapAt = out.length - 1;
    const gap = out[gapAt];
    const above = out[gapAt - 1];
    if (it.kind === 'divider' && gap?.kind === 'message' && isGapMarker(gap.event) && above?.kind === 'divider'
      && above.label === it.label) continue;
    out.push(it);
  }
  return out.length === items.length ? items : out;
}

/** The top of the chat while older messages are offered (wave 175): nothing at all when they are not (`none`), so the
 *  view is today's exactly. */
function OlderTop({ older, onLoadOlder }: { older: OlderPaging; onLoadOlder?: () => void }): ReactNode {
  if (older.edge === 'none' || onLoadOlder === undefined) return null;
  return <OlderEdge state={older.edge} onLoad={onLoadOlder} />;
}

/** What virtuoso hands its header: the list's own paging and loader. */
interface HeaderContext { older: OlderPaging; onLoadOlder?: () => void }
/** Virtuoso's header, a constant component reading the list's context, so the header is one element across renders and
 *  keeps the control's focus. */
const OlderHeader = ({ context }: { context: HeaderContext }): ReactNode => (
  <OlderTop older={context.older} onLoadOlder={context.onLoadOlder} />
);
const LIST_PARTS = { Header: OlderHeader };

/** What one transcript row is drawn from: the set, the row, the list's expansion memo, and every prop a plain item's
 *  body reads. */
type RowViewProps = Omit<Parameters<typeof ChatItemBody>[0], 'item' | 'settled'> & {
  set: SkinSet | null;
  item: TranscriptItem;
  expansion: ExpansionMemo;
  /** The tool-activity row this row is drawn inside, if any (`rowScope`). */
  scope?: RowScope;
};

/** The fallback of a row that threw while rendering. */
const rowFallback = (): ReactNode => <p className="msg-plain-note">This item could not be shown.</p>;

/** One transcript row, drawn through the set's `TranscriptRow` part when it has one. The part takes no props
 *  (D-5678): it reads its row from `TranscriptRowContext`, with the shared renderer for a plain item and for a row
 *  inside a tool-activity row. With no part, a plain item renders as it always has, a tool-activity row as the shared
 *  `ToolActivityRow`, and a group (which only a set with a row part asks for) as its entries. */
function TranscriptRowView({
  set,
  item,
  expansion,
  scope,
  ...rest
}: RowViewProps): ReactNode {
  // Inside a tool-activity row, its scope rules its cards (review 3478 F1, F4): the live wait's pending state reaches the
  // one call the fold singled out and no other, and a past stretch's calls are settled. Outside one, as before.
  const inner = item.kind === 'tool-activity' ? rowScope(item) : scope;
  const renderItem = (it: ChatItem): ReactNode => (
    <ChatItemView
      {...rest} item={it} settled={inner?.past === true}
      askPending={inner === undefined ? rest.askPending : rest.askPending === true && it.key === inner.asked}
    />
  );
  const renderRow = (it: TranscriptItem): ReactNode => (
    <TranscriptRowView {...rest} set={set} item={it} expansion={expansion} scope={inner} />
  );
  const Row = set?.TranscriptRow ?? null;
  let body: ReactNode;
  if (Row !== null) body = <Row />;
  else if (item.kind === 'tool-activity') body = <ToolActivityRow item={item} />;
  else if (item.kind === 'tool-group') return item.entries.map((e) => <div key={e.key}>{renderItem(e)}</div>);
  else return renderItem(item);
  return (
    <TranscriptRowContext.Provider
      value={{ item, renderItem, renderRow, expansion, answer: { onAnswer: rest.onAnswer, answerLabel: rest.answerLabel, askBelow: rest.askBelow } }}
    >
      <RenderBoundary where="chat item" resetKey={item.key} fallback={rowFallback}>
        {body}
      </RenderBoundary>
    </TranscriptRowContext.Provider>
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
  /** What the live wait is (`liveWaitOf` of the screen's `askSource`), which a tool-activity row ties to a call only when
   *  it identifies one (review 3478 F2). Absent, `askPending` alone says a wait that names no call. */
  askWait?: LiveWait;
  /** D-6326: the inline ask surface is mounted (the desk): a live ask card says where it is instead of offering Answer. It also
   *  holds a failed bubble's Retry (R89, `PendingBubble`'s `sendHeld`): Retry is a send, deferred while the card is up. */
  askBelow?: boolean;
  /** The transcript's Answer control's word (decision `ask-answer-control-says-submit`). */
  answerLabel?: string;
  /** Raise the answer sheet. The transcript never answers anything itself —
   *  `EnvelopeSheet` stays the one hardened sender. */
  onAnswer?: () => void;
  /** The viewer's local day (`lib/clock.ts#dayKey`), from the screen's own clock. The row barrier compares it only for a
   *  row whose words read the clock (`sameRow.ts#readsClock`, the usage-limit pill), so that row draws again at local
   *  midnight and no other row does (desktop polish Task C7, review 1128). */
  day?: string;
  /** Wave 175: the store's older pages (`olderPages.ts`). Absent, or `none`: no control, today's view. */
  older?: OlderPaging;
  /** Wave 175: ask for the next older page (`SessionState.loadOlder`). The control and the near-top load call it. */
  onLoadOlder?: () => void;
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
  askWait,
  askBelow,
  answerLabel,
  onAnswer,
  day,
  older = NO_PAGING,
  onLoadOlder,
}: ChatListProps): ReactNode {
  const set = useFrameSet();
  const items = itemsOf(set, events, pending, busy, waitOf(askWait, askPending === true), older);
  // The reader's open rows, for as long as this session's view is open.
  const expansion = useExpansionMemo(id);
  return (
    <div className="chat-inner">
      <OlderTop older={older} onLoadOlder={onLoadOlder} />
      {items.map((item) => (
        <div key={item.key} className="chat-item">
          <TranscriptRowView
            set={set}
            item={item}
            expansion={expansion}
            id={id}
            onRetry={onRetry}
            onDiscard={onDiscard}
            askPending={askPending} askBelow={askBelow} answerLabel={answerLabel}
            onAnswer={onAnswer}
            day={day}
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
export function shapeOf(item: TranscriptItem, m: Measures = NOMINAL_MEASURES): RowShape {
  switch (item.kind) {
    case 'divider': return { bucket: 'divider', lines: 1 };
    // One collapsed line, however many calls it folds (D-5475); open, it is never sampled (`inOpeningForm`).
    case 'tool-group': return { bucket: 'group', lines: 1 };
    // One collapsed line, and the first entry that wants the reader drawn under it as its own card (desktop polish
    // wave 168); open, it is never sampled (`inOpeningForm`).
    // A live wait's line is one line more.
    case 'tool-activity': {
      const first = item.attention[0];
      const card = first === undefined ? 0 : shapeOf(first.entry, m).lines;
      return { bucket: 'activity', lines: 1 + (item.waiting ? 1 : 0) + card };
    }
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

/** Wave 175: virtuoso's index of the first row the list opens with. Older pages lower it by the rows they put before it
 *  (`prependShift`); virtuoso wants it positive, and a session never pages anywhere near this many rows. */
const FIRST_INDEX = 1_000_000_000;

/** Wave 175: how many rows from the top of the view the hold remembers, in order, so a row the join replaced (a divider
 *  gone, a stretch that took the page's calls) is stood in for by the next one down. */
const ANCHOR_ROWS = 8;

/** Wave 175: how near the top, in screen heights, the reader is when the next older page is asked for. */
const NEAR_TOP_SCREENS = 1.5;

/** Wave 175: how many frames with no scroll and no height report of virtuoso's own make a prepend settled. */
const SETTLE_FRAMES = 2;

const keyOf = (item: TranscriptItem): string => item.key;

/** Fix round 1, F1: tell `wrote` where each of the list's own instant writes of `el` left it (virtuoso moves its scroller
 *  only through the element's `scrollTo` and `scrollBy`), or null for a smooth one, whose steps land wherever its easing
 *  puts them. The two methods are wrapped on this element alone; the returned undo puts them back. A measure, not a
 *  writer: every call goes through unchanged. */
function ownWrites(el: HTMLElement, wrote: (at: number | null) => void): () => void {
  const to = el.scrollTo as unknown;
  const by = el.scrollBy as unknown;
  if (typeof to !== 'function' || typeof by !== 'function') return () => undefined;
  const smooth = (a: unknown[]): boolean =>
    typeof a[0] === 'object' && a[0] !== null && (a[0] as ScrollToOptions).behavior === 'smooth';
  const wrap = (f: Function) => function (this: HTMLElement, ...a: unknown[]): void {
    f.apply(this, a);
    wrote(smooth(a) ? null : el.scrollTop);
  };
  el.scrollTo = wrap(to) as HTMLElement['scrollTo'];
  el.scrollBy = wrap(by) as HTMLElement['scrollBy'];
  return () => {
    el.scrollTo = to as HTMLElement['scrollTo'];
    el.scrollBy = by as HTMLElement['scrollBy'];
  };
}

/** The row virtuoso's index `i` names, given its first index (see `computeItemKey`). */
const rowAt = (i: number, first: number): number => (i >= first ? i - first : i);

/** What one visit opens with — computed ONCE per mount. */
interface Opening {
  /** The record as this visit found it: what every save of this visit adds to. */
  record: RowRecord;
  /** Virtuoso's `defaultItemHeight`. */
  height: number;
  /** Per-row priors for virtuoso's size tree, or null when there are none. */
  seed: { ranges: { startIndex: number; endIndex: number; size: number }[]; scrollTop: number } | null;
}

function openWith(items: readonly TranscriptItem[], m: Measures): Opening {
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
interface MeteredRow { item: TranscriptItem; session: string }

/** One rendered row, measured for as long as virtuoso keeps it mounted, and THE ROW BARRIER (desktop polish Task C7):
 *  it draws its row itself, from the row's own props, and is memoised on `sameRowProps`, so a list render that leaves
 *  a row's item the same (`sameTranscriptItem`: `buildChatItems` builds every item again over the same events) and
 *  every other prop the same value draws nothing in that row again. */
const MeasuredItem = memo(function MeasuredItem({ meter, ...row }: RowViewProps & { meter: RowMeter }): ReactNode {
  const { item, id: session } = row;
  const el = useRef<HTMLDivElement>(null);
  // The row at this key changes as events arrive (a streaming turn grows); a
  // measurement is paired with what the row is THEN, not when it mounted.
  const current = useRef<MeteredRow>({ item, session });
  useLayoutEffect(() => { current.current = { item, session }; });
  useLayoutEffect(() => {
    const node = el.current;
    return node === null ? undefined : meter.observe(node, () => current.current);
  }, [meter]);
  // `data-row-key`: the row's identity, by which the list holds the reader's place (`onHeight`), never by its index.
  return <div ref={el} className="chat-item" data-row-key={row.item.key}><TranscriptRowView {...row} /></div>;
}, sameRowProps);

/** Ordinary prose for the probe, so its average glyph is an ordinary one. */
const PROBE_TEXT = 'the parser reads each record and the cache keeps the result so a later call returns at once unless the entry is stale ';

/** No column holds fewer characters a line than this; a probe that reads
 *  fewer was not laid out the way the rows are. */
const MIN_MEASURE = 8;

/** THE BAND JUMP TO LATEST COVERS (the audit's B12; D-5464). `.jump-latest`
 *  sits `--sp-3` above the foot of the list and is at least `--tap-min` tall,
 *  so it covers whatever is in the bottom `--tap-min + --sp-3` of it. While the
 *  newest row's foot is inside that band, a failed send's Retry and Discard are
 *  under the pill: measured at 390, a reader 6-40px above the end had Retry
 *  covered. So the reader counts as AT the newest turn while within the band,
 *  and the pill shows only once the row has left it.
 *
 *  Not a Footer the pill's size, the plan's first remedy: added below the
 *  viewport it moves no row, and the row clears the pill only at the very end,
 *  where the pill already hides (measured, D-5464).
 *
 *  Read from the two tokens the pill's rule is drawn with
 *  (`jump-latest.test.tsx` binds the rule to them), never a copy of their
 *  values. A token that does not read as pixels leaves virtuoso's own
 *  threshold. */
export function pillBandOf(column: HTMLElement): number | undefined {
  // The tokens are `:root`'s (tokens.css; no skin redeclares either).
  const style = getComputedStyle(column.ownerDocument.documentElement);
  const px = (name: string): number => {
    const v = style.getPropertyValue(name).trim();
    return /^\d+(\.\d+)?px$/.test(v) ? Number.parseFloat(v) : Number.NaN;
  };
  const band = px('--tap-min') + px('--sp-3');
  return Number.isFinite(band) ? band : undefined;
}

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

  /** The band Jump to latest covers at the foot of the list (D-5464). */
  pillBand(): number | undefined {
    return this.el === null ? undefined : pillBandOf(this.el);
  }

  /** Whether the list is still moving on its own. */
  settling(): boolean {
    return performance.now() < this.settleUntil;
  }

  /** The rows re-wrap without the column changing width: a skin switch puts
   *  new type and density tokens on the same column (D-5466). Read the
   *  measures again now, in the switch's layout effect, under the new tokens,
   *  and settle, so a reader at the newest turn is put back. */
  resettle(): void {
    this.measured = this.el === null ? null : measuresOf(this.el);
    this.settleUntil = performance.now() + SETTLE_MS;
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
  // A SKIN SWITCH KEEPS THIS LIST MOUNTED (the frame's ladder never remounts,
  // D-5466, D-5679) but re-wraps its rows: a reader following a running turn is still
  // following once they re-measure. The set's identity is the signal, never
  // its id: nothing here branches on the skin (D-5469).
  const set = useFrameSet();
  const lastSet = useRef(set);
  useLayoutEffect(() => {
    if (lastSet.current === set) return;
    lastSet.current = set;
    column.resettle();
  }, [set, column]);
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
  askWait,
  askBelow,
  answerLabel,
  onAnswer,
  day,
  older = NO_PAGING,
  onLoadOlder,
  column,
}: ChatListProps & { column: Column }): ReactNode {
  // The FOLDED list when the set folds tool activity or tool runs (D-5475, desktop polish wave 168): every index below —
  // the count, the keys, the seeded sizes and Jump to latest's last item — is this list's, never the unfolded one's.
  const set = useFrameSet();
  // Keyed by the wait's words, not its object: a screen render hands over an equal wait in a new object.
  const wait = waitOf(askWait, askPending === true);
  const waitIs = waitKey(wait);
  const items = useMemo(
    () => itemsOf(set, events, pending, busy, wait, older),
    [events, pending, busy, set, waitIs, older], // `wait` is read through its key
  );
  // The reader's open tool-activity rows, for as long as this session's view is open: the list's, not a row's, because
  // virtuoso unmounts a row scrolled out of reach.
  const expansion = useExpansionMemo(id);
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
  /** Where the scroller stood when the reader was last measured at the foot (wave 175): a reader who leaves it moved up from
   *  here; null until first measured. Written by virtuoso's at-the-foot report, by a height report that finds the reader at
   *  the foot of the list before it, and by a scroll event that lands within the pill's band of the foot, never by one above it: this list's scroll listener runs before virtuoso reports the reader left, so writing it on
   *  every scroll moved it to where the reader went (measured: a reader scrolled up was then taken back by a view shrink). */
  const footTop = useRef<number | null>(null);
  /** Take the reader to the foot: the one writer of "stay at the foot" (`footFollow.ts#footLeft`). */
  const toFoot = useCallback((): void => { virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end' }); }, []);
  const onAtBottom = useCallback((bottom: boolean): void => {
    const el = scroller.current;
    if (bottom) {
      jumping.current = false;
      if (el !== null) footTop.current = el.scrollTop;
    } else if (pinned.current) {
      // With no scroller to measure, or no foot measured yet, nothing says the reader did not move: virtuoso's word stands.
      const left = footLeft({
        settling: column.settling(),
        movedUp: el === null || footTop.current === null || el.scrollTop < footTop.current - 1,
        sinceTap: lastTap.current === null ? null : performance.now() - lastTap.current,
      });
      if (left === 'foot') { toFoot(); return; }
    }
    pinned.current = bottom;
    setAtBottom(bottom);
  }, [column, toFoot]);


  // READ ONCE PER MOUNT, as a lazy initial state — storage is read and parsed
  // here and on no later render. Virtuoso takes `defaultItemHeight` and the
  // snapshot when it initialises; handing it different numbers later changes
  // nothing it reads. The NEXT visit gets the benefit of this one.
  const [opened] = useState(() => openWith(items, column.measures()));
  const [meter] = useState(() => new RowMeter(() => column.measures()));
  // The pill's band, read once per mount: no skin or palette moves either token.
  const [band] = useState(() => column.pillBand());

  // A HEIGHT CHANGE NO NEW ITEM EXPLAINS (review 3450 F5, review 3478 F5 and F6, review 3607 F1). `heightMove` decides
  // (why, and when which, is said there); this measures and acts. Measured here, for it:
  //  - the reader's taps on a disclosure in the list (anything with `aria-expanded`: a tool-activity row, a run group, a
  //    card);
  //  - the list MOVING, as the scroller itself reports it: the time of its last scroll event, whatever caused it (a
  //    wheel, a fling, a smooth scroll, a key, a drag, code), except the scroll event the hold's own write owes;
  //  - whether an item came or went at either end of the list since the last change (appends are the foot follow's,
  //    items added at the top the older-history work's);
  //  - the row crossing the top of the view, by its KEY (`data-row-key`), read a frame after every scroll but the hold's
  //    own and the list's own prepend adjustment, so a `hold` puts that row back where the reader last saw it, and a
  //    regrouped list can never make it hold another. With it the next rows down, in order: when an older page changes
  //    the row at the join (a divider goes, a stretch takes the page's calls, wave 175), the first of them still drawn
  //    is held instead.
  const scroller = useRef<HTMLElement | null>(null);
  const lastTap = useRef<number | null>(null);
  const lastMove = useRef<number | null>(null);
  /** Where the hold's own write left the scroller, until the scroll event it owes arrives. */
  const ownWrite = useRef<number | null>(null);
  const anchor = useRef<readonly { key: string; top: number; bottom: number }[]>([]);
  /** Where the row `key` stands, its top and its foot, from the scroller's top, or null when it is not drawn. */
  const edgesOf = useCallback((el: HTMLElement, key: string): { top: number; bottom: number } | null => {
    const row = el.querySelector(`[data-row-key="${CSS.escape(key)}"]`);
    if (row === null) return null;
    const at = el.getBoundingClientRect().top;
    const r = row.getBoundingClientRect();
    return { top: r.top - at, bottom: r.bottom - at };
  }, []);
  /** Fix round 1, F2: the stretches an older page's calls renamed since the anchor was read (`stretchJoin.ts`), old key to
   *  new. A renamed stretch grew at its top, so the hold keeps its FOOT where it was. Cleared when the anchor is read. */
  const renamed = useRef<ReadonlyMap<string, string>>(new Map());
  /** How far to scroll to put the reader's row back: the first anchor row still drawn, by its top, or a stretch renamed by
   *  a join, by its foot; null when none of them is drawn. */
  const heldShift = useCallback((el: HTMLElement, moved: boolean): number | null => {
    for (const a of anchor.current) {
      const now = edgesOf(el, a.key);
      if (now !== null) return holdShift(a.top, now.top, moved);
      // Followed across every join since the anchor was read (a page, then another, before the list settled).
      let to = renamed.current.get(a.key);
      for (let n = 0; to !== undefined && n < renamed.current.size; n += 1) {
        const grown = edgesOf(el, to);
        if (grown !== null) return holdShift(a.bottom, grown.bottom, moved);
        to = renamed.current.get(to);
      }
    }
    return null;
  }, [edgesOf]);
  const readAnchor = useCallback((): void => {
    const el = scroller.current;
    if (el === null) return;
    // Measured from the scroller's own top, so a move of the scroller itself (a strip or the inline card above or below
    // it changing) is never taken for a move of the rows inside it.
    const top = el.getBoundingClientRect().top;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-row-key]')];
    const first = rows.findIndex((r) => r.getBoundingClientRect().bottom > top);
    anchor.current = first < 0 ? [] : rows.slice(first, first + ANCHOR_ROWS).flatMap((r) => {
      const at = edgesOf(el, r.dataset.rowKey!);
      return at === null ? [] : [{ key: r.dataset.rowKey!, ...at }];
    });
    renamed.current = new Map();
  }, [edgesOf]);
  // Read a frame after a scroll, never in it: the list lays out the rows a scroll brings into reach after the scroll
  // event, and can move what is drawn by a pixel or two as it does (measured in Chrome).
  const readSoon = useRef(false);
  /** Wave 175: virtuoso is moving the scroller for rows just put before the first (its first index moved), from that
   *  render until the scroller has been quiet for SETTLE_FRAMES frames. Its scroll events and height reports then are the
   *  list's own: neither the reader moving nor a change to hold, and the place the reader had before the page came stays
   *  the place to hold (`settlePrepend`). Counted in `adjusted`, which the settle watches. */
  const adjusting = useRef(false);
  const adjusted = useRef(0);
  /** The reader's last wheel, touch, pointer press or key in the list, so a settle never sets back a reader who moved. */
  const readerAt = useRef<number | null>(null);
  /** Fix round 1, F1: where the list's own last instant write left the scroller (virtuoso's `scrollTo` and `scrollBy`,
   *  which `ownWrites` reads off the element), or null after a smooth one (Jump to latest) or before any. While a prepend
   *  settles, a scroll event that finds the scroller anywhere else is the list moving by something no input event says:
   *  a fling's momentum after the finger lifted, a scrollbar thumb dragged, a smooth scroll still running, the reader. */
  const listAt = useRef<number | null>(null);
  /** Fix round 1, F1: Jump to latest was pressed and its smooth scroll has not reached the foot. A page settling meanwhile
   *  ends at the foot (the reader asked for it): virtuoso's instant write for the page's rows can stop a smooth scroll
   *  where it is. Ended by reaching the foot, or by the reader's own input. */
  const jumping = useRef(false);
  /** The older paging and its loader as of this render, for the callbacks below. */
  const paging = useRef({ older, onLoadOlder });
  paging.current = { older, onLoadOlder };
  /** Wave 175: load the next older page when the reader nears the top: only from `more` (never a retry on its own), only
   *  for a reader who left the foot (a list too short to scroll offers the control instead), and only within
   *  NEAR_TOP_SCREENS of the top. */
  const nearTop = useCallback((): void => {
    const el = scroller.current;
    const { older: o, onLoadOlder: load } = paging.current;
    // Not while virtuoso settles a page: the scroller still stands where it was before the rows came (the settle asks).
    if (el === null || load === undefined || o.edge !== 'more' || pinned.current || adjusting.current) return;
    if (el.scrollTop <= el.clientHeight * NEAR_TOP_SCREENS) load();
  }, []);
  const onScroll = useCallback((): void => {
    const el = scroller.current;
    const own = ownWrite.current;
    ownWrite.current = null;
    // The scroll event the hold's own write owes is neither the list moving nor a new place to hold: the hold keeps the
    // place it put back as its baseline, so what it could not put back (under a pixel, a rounded position) is put back
    // with the next change rather than becoming the new zero (review 3607 A3). Only while the scroller is where the
    // write left it: a reader who moved it since owes an event of their own, and this one is theirs.
    if (el !== null && own !== null && Math.abs(el.scrollTop - own) < 1) return;
    if (adjusting.current) {
      adjusted.current += 1;
      const at = listAt.current;
      if (el !== null && prepend.current !== null && (at === null || Math.abs(el.scrollTop - at) >= 1)) {
        prepend.current.moved = true;
        lastMove.current = performance.now();
      }
      return;
    }
    // Where the foot stands, while the scroller is measured at it (within the pill's band): rows measuring under a reader at
    // the foot move it; a reader scrolling up leaves the band at their first event, and leaves this where the foot was.
    if (el !== null && el.scrollHeight - el.scrollTop - el.clientHeight <= (band ?? 0) + 1) footTop.current = el.scrollTop;
    lastMove.current = performance.now();
    if (readSoon.current) return;
    readSoon.current = true;
    requestAnimationFrame(() => {
      readSoon.current = false;
      readAnchor();
      nearTop();
    });
  }, [readAnchor, nearTop, band]);
  const onTap = useCallback((e: Event): void => {
    if (e.target instanceof Element && e.target.closest('[aria-expanded]') !== null) lastTap.current = performance.now();
  }, []);
  const onReader = useCallback((): void => { readerAt.current = performance.now(); jumping.current = false; }, []);
  const unwatch = useRef<(() => void) | null>(null);
  const onScroller = useCallback((el: HTMLElement | Window | null): void => {
    const old = scroller.current;
    unwatch.current?.();
    unwatch.current = null;
    old?.removeEventListener('click', onTap, true);
    old?.removeEventListener('scroll', onScroll);
    for (const type of READER_INPUT) old?.removeEventListener(type, onReader, true);
    scroller.current = el instanceof HTMLElement ? el : null;
    const now = scroller.current;
    now?.addEventListener('click', onTap, true);
    now?.addEventListener('scroll', onScroll, { passive: true });
    for (const type of READER_INPUT) now?.addEventListener(type, onReader, { capture: true, passive: true });
    if (now !== null) unwatch.current = ownWrites(now, (at) => { listAt.current = at; });
  }, [onTap, onScroll, onReader]);
  const lastHeight = useRef<number | null>(null);
  const edges = useRef<string | null>(null);
  const shown = useRef(items);
  shown.current = items;
  /** The prepend the list is settling, as it stood before the rows came: the reader's flag, the scroller and the list's
   *  height then, and a count that tells it from a later one. */
  const prepend = useRef<{
    n: number; at: number; pinned: boolean; scrollTop: number; clientHeight: number; before: number | null;
    /** The list moved since the page came, by anything but its own writes (fix round 1, F1). */
    moved: boolean;
  } | null>(null);

  // VIRTUOSO'S FIRST INDEX (wave 175). Rows put before the first are told to virtuoso by lowering its `firstItemIndex` in
  // the same render, by how far a row the reader can see moved (`prependShift`, by key): virtuoso then moves the scroller
  // itself, from its size estimates, over a few frames, and lands rows away from where they were (measured in Chrome: 451px
  // after a page of thirty records at 390px). So the hold stands aside while it does (`adjusting`: no read, no write), and
  // once the scroller is quiet, `settlePrepend` puts the reader's row back, by its key, in one write. Two writers that never
  // write in the same frame: virtuoso's while it moves, the hold's after. Decided here, in the render that hands virtuoso
  // the new rows, because virtuoso reads both together.
  const indexing = useRef({ items, first: FIRST_INDEX, settles: 0 });
  if (indexing.current.items !== items) {
    const was = indexing.current.items;
    const top = was.length > 0 && items.length > 0 && was[0]!.key !== items[0]!.key;
    const shift = top ? prependShift(was.map(keyOf), items.map(keyOf), anchor.current[0]?.key ?? null) : 0;
    // A stretch an older page's calls joined (fix round 1, F2): its open state follows it, and the hold reads its new key.
    const joins = top ? renamedAcross(was, items) : null;
    if (joins !== null && joins.size > 0) {
      keepOpenAcross(was, items, expansion);
      renamed.current = new Map([...renamed.current, ...joins]);
    }
    // A join that adds no row (a page of calls only, fix round 1, F2) settles exactly as a prepend does: virtuoso corrects
    // the stretch's new height over a frame or two, and the hold then keeps the reader's place by the stretch's foot.
    const settles = shift !== 0 || (joins !== null && joins.size > 0);
    if (settles) {
      const settling = adjusting.current;
      // Set in this render: virtuoso reports the new height in its own layout effect, before this list's effects run.
      adjusting.current = true;
      // Where the foot stood moves down by the rows put above it: unmeasured until the list measures it again (fix round
      // 1, A7: a stale one read a reader who moved up during the settle as still below the foot, and took them back).
      footTop.current = null;
      const el = scroller.current;
      prepend.current = {
        n: (prepend.current?.n ?? 0) + 1, at: performance.now(), pinned: pinned.current, scrollTop: el?.scrollTop ?? 0,
        clientHeight: el?.clientHeight ?? 0, before: lastHeight.current,
        // A later page while one still settles: the anchor is still the first's, and so is any move since it.
        moved: settling && prepend.current !== null ? prepend.current.moved : false,
      };
    }
    indexing.current = { items, first: indexing.current.first - shift, settles: indexing.current.settles + (settles ? 1 : 0) };
  }
  const firstIndex = indexing.current.first;
  const settles = indexing.current.settles;

  /** The prepend's one correction, once virtuoso is done (see VIRTUOSO'S FIRST INDEX). FIRST, a list that moved since the
   *  page came is left where it went, whoever was where then (fix round 1, F1 and A7): the list moving is the reader
   *  moving, measured by the scroller against where the list's own writes left it (`listAt`), and by the reader's input.
   *  Otherwise decided as any change above the reader (`heightMove`, with the place the reader had before the rows came):
   *  a reader at the foot is taken back to it, and anyone else has their row put back by its key. */
  const settlePrepend = useCallback((): void => {
    adjusting.current = false;
    const el = scroller.current;
    const p = prepend.current;
    prepend.current = null;
    if (el === null || p === null) return;
    if (jumping.current) {
      toFoot();
      return;
    }
    if (p.moved || (readerAt.current !== null && readerAt.current >= p.at)) {
      readAnchor();
      requestAnimationFrame(nearTop);
      return;
    }
    const move = heightMove({
      pinned: p.pinned, before: p.before, scrollTop: p.scrollTop, clientHeight: p.clientHeight, band: band ?? 0,
      sinceTap: null, sinceMove: null, newItem: true, prepended: true,
    });
    if (move === 'foot') {
      toFoot();
      return;
    }
    const shift = move === 'hold' ? heldShift(el, false) : null;
    if (shift !== null) {
      if (shift !== 0) {
        el.scrollTop += shift;
        ownWrite.current = el.scrollTop;
      }
    } else {
      readAnchor();
    }
    requestAnimationFrame(nearTop);
  }, [band, readAnchor, heldShift, nearTop, toFoot]);
  const lastSettles = useRef(settles);
  useLayoutEffect(() => {
    if (lastSettles.current === settles) return;
    lastSettles.current = settles;
    const mine = prepend.current?.n;
    let seen = adjusted.current;
    let quiet = 0;
    const tick = (): void => {
      if (prepend.current?.n !== mine) return; // a later prepend settles instead
      if (adjusted.current !== seen) { seen = adjusted.current; quiet = 0; } else quiet += 1;
      if (quiet >= SETTLE_FRAMES) settlePrepend(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [settles, settlePrepend]);

  const onHeight = useCallback((height: number): void => {
    const before = lastHeight.current;
    lastHeight.current = height;
    const list = shown.current;
    const now = `${list.length}:${list[0]?.key ?? ''}:${list[list.length - 1]?.key ?? ''}`;
    const newItem = edges.current !== null && edges.current !== now;
    edges.current = now;
    const el = scroller.current;
    if (el === null) return;
    // Virtuoso is settling a prepend: its height reports are its own, and the settle holds once it is done.
    if (adjusting.current) { adjusted.current += 1; return; }
    const at = performance.now();
    const from = el.scrollTop;
    // Where the foot stands, measured as `heightMove` measures it: against the list before this change.
    if (pinned.current && before !== null && before - el.scrollTop - el.clientHeight <= (band ?? 0) + 1) footTop.current = el.scrollTop;
    const sinceTap = lastTap.current === null ? null : at - lastTap.current;
    const move = heightMove({
      pinned: pinned.current, before, scrollTop: el.scrollTop, clientHeight: el.clientHeight, band: band ?? 0,
      sinceTap, sinceMove: lastMove.current === null ? null : at - lastMove.current,
      newItem, prepended: false,
    });
    if (move === 'foot') {
      toFoot();
      return;
    }
    // A frame later, after any correction of the list's own or the browser's: the hold compares where the row stood
    // before the change with where it stands now, so a change something else already put back is put back by nothing
    // more (one correction per change), and a list that moved in between is not set back (review 3607 F1). A `none`, or
    // a hold the list's movement cancelled, re-reads it, so the change it let through is the reader's new place.
    // A move is a scroll event since the change, or the scroller standing elsewhere than at the change with no event yet
    // (a smooth scroll's first step lands in the frame before its event, carried item 6 of wave 175).
    requestAnimationFrame(() => {
      // A tap that shrank the list and left the reader at its foot did not move them off it (fix round 1, A1: a reader at
      // the foot who closes the newest stretch): its window ends, so the next change at the foot is followed. A tap that
      // grew the list (a row opening under the reader) keeps it: they are no longer at the foot, by their own doing.
      if (sinceTap !== null && sinceTap < TAP_SETTLE_MS && before !== null && height < before
        && el.scrollHeight - el.scrollTop - el.clientHeight <= (band ?? 0) + 1) lastTap.current = null;
      if (move === 'hold') {
        const moved = (lastMove.current !== null && lastMove.current >= at) || Math.abs(el.scrollTop - from) >= 1;
        const shift = heldShift(el, moved);
        if (shift !== null) {
          if (shift !== 0) {
            el.scrollTop += shift;
            ownWrite.current = el.scrollTop;
          }
          if (!moved) return;
        }
      }
      readAnchor();
    });
  }, [band, readAnchor, heldShift]);

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
    const stopHidden = onPageHidden(onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      stopHidden();
      save();
    };
  }, [meter, opened]);

  // THE SAME TWO FUNCTIONS UNTIL WHAT THEY READ CHANGES (desktop polish Task C7): virtuoso calls `itemContent` again for
  // every rendered row when it is handed a new one, so a render of this list that changes nothing they read (a screen
  // render with the same events and the same callbacks) hands it the ones it has.
  // Virtuoso hands both its own index, which counts from its first index (wave 175). An index below the first index is
  // read as the row's own: no virtuoso sends one, and the suites' stand-in lists count rows from 0, as virtuoso does with
  // no first index.
  const computeItemKey = useCallback((i: number) => items[rowAt(i, firstIndex)]?.key ?? i, [items, firstIndex]);
  const itemContent = useCallback((i: number): ReactNode => {
    const item = items[rowAt(i, firstIndex)];
    if (!item) return null;
    return (
      <MeasuredItem
        meter={meter}
        set={set}
        item={item}
        expansion={expansion}
        id={id}
        onRetry={onRetry}
        onDiscard={onDiscard}
        askPending={askPending} askBelow={askBelow} answerLabel={answerLabel}
        onAnswer={onAnswer}
        day={day}
      />
    );
  }, [items, firstIndex, meter, set, expansion, id, onRetry, onDiscard, askPending, askBelow, answerLabel, onAnswer, day]);
  // The control's own press: the reader asked for the top, so the foot no longer holds them (a short list's reader is at
  // the foot when they press it), and the hold keeps the row they were reading in place as the page lands.
  const loadFromControl = useCallback((): void => {
    pinned.current = false;
    paging.current.onLoadOlder?.();
  }, []);
  const header = useMemo<HeaderContext>(
    () => ({ older, ...(onLoadOlder !== undefined ? { onLoadOlder: loadFromControl } : {}) }),
    [older, onLoadOlder, loadFromControl],
  );
  // A page answered while the reader is still near the top asks for the next one (only from `more`); and the list's word
  // that the reader left the foot can come after the scroll that took them up, so it asks too.
  useEffect(() => { nearTop(); }, [older.edge, older.pages, atBottom, nearTop]);

  return (
    <>
      <Virtuoso
        ref={virtuoso}
        className="chat-scroller"
        totalCount={items.length}
        firstItemIndex={firstIndex}
        computeItemKey={computeItemKey}
        itemContent={itemContent}
        components={LIST_PARTS}
        context={header}
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
        // Off (wave 175, carried item 6a): the list keeps a reader at the foot itself (`toFoot`, `footFollow.ts`). Virtuoso's
        // follow armed a 100ms window on every render in which a reader's tap was followed to the end.
        followOutput={false}
        atBottomStateChange={onAtBottom}
        totalListHeightChanged={onHeight}
        scrollerRef={onScroller}
        // At the newest turn while its foot is inside the pill's band, so Jump
        // to latest never sits on a failed send's Retry or Discard (D-5464).
        {...(band !== undefined ? { atBottomThreshold: band } : {})}
        initialTopMostItemIndex={OPEN_AT_NEWEST}
        alignToBottom
      />
      {!atBottom && (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            jumping.current = true;
            virtuoso.current?.scrollToIndex({ index: items.length - 1, behavior: 'smooth' });
          }}
        >
          Jump to latest <span aria-hidden="true">↓</span>
        </button>
      )}
    </>
  );
}
