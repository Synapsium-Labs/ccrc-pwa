// One recorded reply of the Overlord in the chat (Overlord W1 chat, PR B, Task 5; spec §4.3, C67 and C69): L4. Its words are
// UNTRUSTED DATA, drawn as text (pre-wrapped, never markdown, never a link or a control: the Overlord narrates and never
// originates), with an off-the-record mark and a cut mark. Two things ride on it, both decided in `chatWords.ts` (L1):
//  - the `opened` receipt: a reply at least half visible for a second while the document is visible posts ONE receipt, once per
//    reply per page load, batched, at most one request a second (the queue below is module-level, so a remount of the part never
//    posts a reply again). `responses/useOpenedReceipt.ts` posts once per mount with the page's first render; a reply is opened
//    when SEEN, so that hook cannot serve, and this keeps its body shape (`nextReceiptBatch`) and its failure rule: a lost receipt
//    is shown nowhere and never retried (it reads `unmeasured`, never as no open);
//  - "I handled this elsewhere": offered only on a reply with a response row not yet handled (`replyHandledOffer`), one call to
//    the handled door with that row's id, its words `responses/responseWords.ts`'s. `HandledElsewhere` reads the response rows of
//    a message by ref (`responsesFor`) and marks all of them; a reply already carries its one row's id from the thread, so it
//    marks that row alone.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Button } from '@ccrc/ui';
import { api } from '../lib/api';
import { onPageHidden, onPageVisible } from '../lib/pageClock';
import { HANDLED_WORDS } from '../responses/responseWords';
import {
  CUT_WORDS, OFF_RECORD_WORDS, REPLY_DWELL_MS, REPLY_SEEN_STEPS, nextReceiptAt, nextReceiptBatch, replyHandledOffer, replyReceiptWatched, replySeenEnough,
  type ReplyEntry,
} from './chatWords';

const hidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

// ── the receipt queue: one per page load ───────────────────────────────────────────────────────────────────────────────────

/** Replies whose receipt went (or was tried: a lost receipt is never retried), and replies seen and waiting for the spacing. */
const posted = new Set<number>();
const waiting: number[] = [];
let lastSentAt: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopWaitingForVisible: (() => void) | null = null;

function flush(): void {
  timer = null;
  if (hidden()) {
    // Never while the document is hidden: hold what waits, and go when it is shown.
    stopWaitingForVisible ??= onPageVisible(() => { stopWaitingForVisible?.(); stopWaitingForVisible = null; schedule(); });
    return;
  }
  const { ids, receipts } = nextReceiptBatch(waiting, posted);
  const sent = new Set(ids);
  const rest = waiting.filter((id) => !sent.has(id) && !posted.has(id));
  waiting.length = 0;
  waiting.push(...rest);
  if (ids.length > 0) {
    for (const id of ids) posted.add(id);
    lastSentAt = Date.now();
    try { api.postResponseReceipts(receipts).catch(() => {}); } catch { /* a receipt never shows */ }
  }
  schedule();
}
function schedule(): void {
  if (timer !== null || waiting.length === 0) return;
  const now = Date.now();
  // Always a timer, even when due: replies whose second ended in the same moment are queued by then, and ride one request.
  timer = setTimeout(flush, Math.max(0, nextReceiptAt(lastSentAt, now) - now));
}
/** A reply has been seen long enough: queue its receipt, unless it went or is queued. */
function seen(id: number): void {
  if (posted.has(id) || waiting.includes(id)) return;
  waiting.push(id);
  schedule();
}

/** Forget what this page load posted (a test's seam: the queue is module-level by design). */
export function resetReplyReceipts(): void {
  posted.clear();
  waiting.length = 0;
  lastSentAt = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  stopWaitingForVisible?.();
  stopWaitingForVisible = null;
}

/** Watches `ref` and queues the reply's receipt once half of it has been visible for `REPLY_DWELL_MS` with the document
 *  visible. Nothing is watched for a reply that already posted, nor for one with no response row (`watched` false: F11), which a
 *  later read showing its row starts watching. A hidden document pauses the second; shown again, it starts over. */
function useReplySeen(id: number, ref: RefObject<HTMLElement | null>, watched: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!watched || el === null || typeof IntersectionObserver === 'undefined' || posted.has(id)) return;
    let inView = false;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    const stop = (): void => { if (dwell !== null) clearTimeout(dwell); dwell = null; };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        inView = replySeenEnough({ ratio: e.intersectionRatio, visibleHeight: e.intersectionRect.height, rootHeight: e.rootBounds?.height ?? window.innerHeight });
        if (inView) start(); else stop();
      }
    }, { threshold: [...REPLY_SEEN_STEPS] });
    function start(): void {
      if (dwell !== null || !inView || hidden()) return;
      dwell = setTimeout(() => {
        dwell = null;
        if (!inView || hidden()) return;
        seen(id);
        io.disconnect();
      }, REPLY_DWELL_MS);
    }
    io.observe(el);
    const offHidden = onPageHidden(stop);
    const offVisible = onPageVisible(start);
    return () => { io.disconnect(); offHidden(); offVisible(); stop(); };
  }, [id, ref, watched]);
}

// ── the handled control ─────────────────────────────────────────────────────────────────────────────────────────────────────

function ReplyHandled({ response }: { response: ReplyEntry['response'] }): ReactNode {
  const offer = replyHandledOffer(response);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const inFlight = useRef(false);
  if (offer.kind === 'none') return null;
  if (offer.kind === 'handled' || done) return <p className="oc-quiet oc-handled" data-handled="true">{HANDLED_WORDS.handled}</p>;
  const id = offer.id;
  const mark = (): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setRefused(false);
    api.markResponseHandled(id)
      .then(() => setDone(true))
      .catch(() => setRefused(true))
      .finally(() => { inFlight.current = false; setBusy(false); });
  };
  return (
    <div className="oc-handled-offer">
      <Button variant="ghost" size="fit" disabled={busy} onClick={mark}>{HANDLED_WORDS.button}</Button>
      {refused && <p className="oc-quiet" role="status">{HANDLED_WORDS.refused}</p>}
    </div>
  );
}

export function ChatReply({ entry }: { entry: ReplyEntry }): ReactNode {
  const { row, response } = entry;
  const ref = useRef<HTMLDivElement>(null);
  useReplySeen(row.id, ref, replyReceiptWatched(response));
  return (
    <div className="oc-reply" role="group" aria-label={`Overlord reply ${row.id}`} ref={ref}>
      <p className="oc-reply-text">{row.text}</p>
      {(row.cut || row.offRecord) && (
        <p className="oc-reply-marks">
          {row.offRecord && <span className="oc-mark">{OFF_RECORD_WORDS}</span>}
          {row.cut && <span className="oc-mark">{CUT_WORDS}</span>}
        </p>
      )}
      <ReplyHandled response={response} />
    </div>
  );
}
