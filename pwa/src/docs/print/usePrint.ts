// Print from ccrc's own window (X2 P6.1 Step 1, part B; spec 4.6 "How" and "The tree is parsed ahead"). Ring L4: a hook the Docs screen
// calls with what the leaf's body published (`printSource.ts`) and the page it is on; it DRIVES: it owns the prepared trees for the
// visit, the two window listeners and the Print row's action. Every decision is `printPlan.ts`'s (what to draw, the banner, the link
// targets, the images, what is settled); the words are `printWords.ts`'s; the DOM node is `printMount.ts`'s.
//
// Prepared ahead, never in a handler. Once the published source is ready (a reader frame has reported `ready`; a Markdown text in
// parts once its cut is whole) the trees are asked of the worker in the background, one part at a time through `preparePartsPrint`
// (each under its parse budget, and let go after `PRINT_WAIT_MS`): the reader's own render job asked for its print tree
// (`print: true`). A text leaf and an image leaf are drawn from the console's own builders at the moment of printing
// (`leafPrintTree`: no worker). Nothing here parses on the main thread, and the `beforeprint` handler asks the worker for nothing:
// it mounts, synchronously, what is already prepared. A new source drops what the old one had prepared (the effect is keyed by the
// text, or by the parts' array, and aborts the old run).
//
// A part let go at its wait (the docs queue was busy) prints as plain text under `PRINT_NOT_READY`, and is NOT lost for the visit:
// the next press of the row asks the worker for it again (`runPrep` over just those parts), and waits for it.
//
// The listeners. `beforeprint` mounts the print view (`printMount.ts`) from what is prepared at that moment, and `afterprint`
// empties it; they are the only two events the hook listens to on `window`, and they are the browser's own Print menu and Ctrl+P
// as well as the row. With nothing published (a listing, a failure) the root is emptied and no view is mounted, so the browser
// prints the page as it is and a stale view never prints. The view: prepared trees; a part not prepared yet, beside prepared
// ones, as its plain text under `PRINT_NOT_READY`; with nothing prepared at all, the one line "Docs is preparing this page for
// print; print again in a moment."; a PDF or an HTML page, its own one line (PL4, PL5).
//
// The Print row's action (`PrintControl.press`). `flushSync` is refused inside a commit (it only schedules there), so the row never
// mounts or prints from an effect. Settled at the press: it mounts and calls `printWindow` (`window.print()` by default; a test
// fakes it) right in the tap, which also keeps the user's gesture. Not settled: it waits (`progress` says which part), and the
// wait ends from a timer TASK, so it mounts and prints outside React's commit: when everything is prepared, or at the deadline,
// which runs from the PRESS only (10 s a part once the source is ready, 10 s before it), so a source that republishes (the
// frame's images, its ready) never restarts it. For a PDF or an HTML page it starts the page's existing download of the file
// (`downloadDocFile`, the one `DocsLeaf.tsx#DownloadButton` calls) and says so below the row if it failed; where no download is
// reachable from the head (a file read by range) the row is off with the reason.
import { createContext, createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { DocsPageLocation, DocsTreeOk } from '../../../../shared/docs';
import { type DocLinkContextValue } from '../DocLink';
import { linkBaseFor } from '../docsLinkBase';
import { DOCS_VIEW_TEXT, failureSentence, fillSentence, slotSentence } from '../docsText';
import { leafName } from '../docsTree';
import type { ExportAssets } from '../export/exportAssets';
import type { DocsLoaders } from '../failures';
import { downloadDocFile } from '../objectUrls';
import { pinFor, type DocsVisit } from '../useDocsVisit';
import { preparePartsPrint, type PrintRender } from './preparePrint';
import { PrintView } from './PrintView';
import { loadedImageOf } from './printImages';
import { bannerFor, imagesFor, imgRefsOf, isNotReady, prepSettled, prepStarted, printLinkTarget, printPlanFor, printProgress, printTotal, type Prepared } from './printPlan';
import { clearPrint, mountPrint, unmountPrint } from './printMount';
import type { PrintSource } from './printSource';
import { PRINT_WAIT_MS, printOffer } from './printTree';
import { PRINT_ROW_TEXT } from './printWords';

/** What the Print row draws and does, handed to the head through `PrintControlContext`. */
export interface PrintControl {
  /** `print`: Print; `download-to-print`: a PDF or an HTML page, which print from their downloaded file. */
  readonly offer: 'print' | 'download-to-print';
  /** While Print waits for the trees: the part it prepares (1-based) and how many there are; else `null`. */
  readonly progress: { readonly k: number; readonly n: number } | null;
  /** Why the row is off (Download to print with no download reachable); `null`: it can be pressed. */
  readonly disabledWhy: string | null;
  /** A failed download, said under the row; `null`: none. */
  readonly note: string | null;
  /** Said under the row when the document is too long to print whole and Print prints the part on screen (`PRINT_TOO_LONG`); `null`: none. */
  readonly tooLong: string | null;
  readonly press: () => void;
}

/** `null`, the default, has one meaning: no Docs screen draws a Print row here. */
export const PrintControlContext = createContext<PrintControl | null>(null);

export interface UsePrintInput {
  /** What the leaf's body published; `null`: nothing. */
  readonly source: PrintSource | null;
  readonly page: DocsPageLocation | null;
  readonly tree: DocsTreeOk | null;
  readonly visit: Pick<DocsVisit, 'file' | 'rangeOpened'>;
  /** The reader's render job (the runner's `render`), asked for the print tree. */
  readonly render: PrintRender;
  /** The visit's image registry; `null`: none. */
  readonly assets: ExportAssets | null;
  /** The page's loaders, for the download of a PDF or an HTML page. */
  readonly loaders: Pick<DocsLoaders, 'file' | 'raster'> | undefined;
  /** What the row calls to print once the trees are in; `window.print()` by default. */
  readonly printWindow?: () => void;
}

const NO_PREPARED: Prepared = [];
const noop = (): void => {};

/** The link context the page's links and images are decided in: the leaf's own (`linkBaseFor`, the one owner of the formula), with an
 *  empty URL map (a printed tree names its URLs as targets and refs, not through the detached map). */
function linkContextOf(page: DocsPageLocation | null, tree: DocsTreeOk | null): DocLinkContextValue | null {
  if (page === null || tree === null || page.kind !== 'path') return null;
  return { ...linkBaseFor(page, tree, pinFor(tree, page), noop), urls: new WeakMap() };
}

export function usePrint(i: UsePrintInput): PrintControl | null {
  const { source } = i;
  // What the worker prepared, for the text (or the parts' array) it was asked about; a new one starts again.
  const prepKey: string | readonly string[] | null = source === null ? null
    : source.kind === 'markdown' ? (source.ready ? source.text : null)
      : source.kind === 'markdown-parts' ? (source.complete && source.parts.length > 0 ? source.parts : null) : null;
  const [state, setState] = useState<{ readonly key: string | readonly string[]; readonly prepared: Prepared } | null>(null);
  const prepared: Prepared = state !== null && state.key === prepKey ? state.prepared : NO_PREPARED;
  const latest = useRef(i);
  latest.current = i;
  const preparedRef = useRef<Prepared>(prepared);
  preparedRef.current = prepared;
  /** The run in flight for the live key: the background one, and a retry's, ended together when the key changes. */
  const runs = useRef<AbortController | null>(null);

  /** Asks the worker for the parts `todo` of `texts` (indices), one at a time, filling their slots as they land; the slots start empty. */
  const runPrep = (key: string | readonly string[], texts: readonly string[], todo: readonly number[], signal: AbortSignal): void => {
    setState((s) => ({
      key, prepared: texts.map((_, k) => (todo.includes(k) ? null : (s !== null && s.key === key ? s.prepared[k] ?? null : null))),
    }));
    const render: PrintRender = (src, o) => latest.current.render(src, o);
    preparePartsPrint(todo.map((k) => texts[k] as string), render, signal, (j, part) => {
      setState((s) => {
        const slots = s !== null && s.key === key ? [...s.prepared] : texts.map(() => null);
        slots[todo[j] as number] = part;
        return { key, prepared: slots };
      });
    }).catch(() => { /* an abort: the cleanup already ran */ });
  };

  useEffect(() => {
    if (prepKey === null) return undefined;
    const ac = new AbortController();
    runs.current = ac;
    const texts = typeof prepKey === 'string' ? [prepKey] : prepKey;
    runPrep(prepKey, texts, texts.map((_, k) => k), ac.signal);
    return () => { ac.abort(); if (runs.current === ac) runs.current = null; };
    // `runPrep` reads only refs and the stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepKey]);

  // The two listeners: mount from what is prepared now, and empty again afterwards. Inside an event handler or a timer task only.
  const mountNow = useRef(noop);
  mountNow.current = (): void => {
    const cur = latest.current;
    const plan = printPlanFor(cur.source, prepared);
    // Nothing published: no view. A view mounted before (no `afterprint` came) is emptied, so it can never print.
    if (plan === null) { unmountPrint(); return; }
    const link = linkContextOf(cur.page, cur.tree);
    const listed = cur.page !== null && cur.tree !== null ? pinFor(cur.tree, cur.page) : null;
    // The frame's own images; an image leaf's tree names the very URL the leaf shows (`leafPrintTree` keeps it as the image's ref).
    const frame = cur.source === null ? undefined
      : cur.source.kind === 'markdown' ? cur.source.images
        : cur.source.kind === 'image' ? { [cur.source.src]: cur.source.src } : undefined;
    mountPrint(createElement(PrintView, {
      parts: plan.parts, line: plan.line, notice: plan.notice, banner: plan.line === null ? bannerFor({ page: cur.page, tree: cur.tree, listed, visit: cur.visit }) : null,
      images: imagesFor(imgRefsOf(plan.parts), frame, loadedImageOf(link, cur.assets)),
      linkTarget: printLinkTarget(link, location.origin),
    }));
  };
  useEffect(() => {
    const before = (): void => mountNow.current();
    const after = (): void => unmountPrint();
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      clearPrint();
    };
  }, []);

  // The row's action.
  const [waiting, setWaiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** When the row was pressed: the deadline of its wait is measured from here and from nothing else. */
  const pressedAt = useRef(0);
  const done = source !== null && prepSettled(source, prepared);
  const started = source !== null && prepStarted(source);
  const total = source === null ? 0 : printTotal(source);
  const hasSource = source !== null;
  const printNow = (): void => {
    mountNow.current();
    (latest.current.printWindow ?? (() => window.print()))();
  };
  useEffect(() => {
    if (!waiting) return undefined;
    if (!hasSource) { setWaiting(false); return undefined; }
    // Everything is in: print from a task of its own, never from inside this commit. Else, at the deadline: 10 s from the press
    // for a source not ready yet, 10 s a part once it is, over the preparation's own per-part waits.
    const limit = PRINT_WAIT_MS * (started ? Math.max(1, total) : 1);
    const left = done ? 0 : Math.max(0, pressedAt.current + limit - Date.now());
    const t = setTimeout(() => { setWaiting(false); printNow(); }, left);
    return () => clearTimeout(t);
    // `printNow` reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, done, started, total, hasSource]);

  // The ceiling's sentence for the row: counted from what is prepared, once per change of it (not per render).
  const tooLong = useMemo(() => printPlanFor(source, prepared)?.notice ?? null, [source, prepared]);
  if (source === null) return null;
  const file = i.visit.file;
  const page = i.page;
  const download = source.kind === 'download-to-print' && file.s === 'ok' && page !== null && page.kind === 'path'
    ? () => {
      setNote(null);
      void downloadDocFile(page.project, file.pin, leafName(page.path), i.loaders).then((a) => {
        // The page's own Download sentence (`DOCS_VIEW_TEXT.downloadFailed`), so a failed download reads alike everywhere.
        if (a.s !== 'ok') setNote(fillSentence(DOCS_VIEW_TEXT.downloadFailed, { sentence: a.s === 'failed' ? failureSentence(a.body) : slotSentence(a) }));
      });
    }
    : null;
  const offer = source.kind === 'download-to-print' ? printOffer(source.cls) : 'print';
  return {
    offer,
    progress: waiting ? printProgress(source, prepared) : null,
    disabledWhy: offer === 'download-to-print' && download === null ? PRINT_ROW_TEXT.noDownload : null,
    note,
    tooLong,
    press: () => {
      if (offer === 'download-to-print') { download?.(); return; }
      const have = preparedRef.current;
      const stale = have.flatMap((p, k) => (isNotReady(p) ? [k] : []));
      if (stale.length === 0 && prepSettled(source, have)) { printNow(); return; }
      pressedAt.current = Date.now();
      setWaiting(true);
      // Parts let go at their wait are asked for again, now: the queue may be free.
      if (stale.length > 0 && prepKey !== null && runs.current !== null) {
        const texts = typeof prepKey === 'string' ? [prepKey] : prepKey;
        runPrep(prepKey, texts, stale, runs.current.signal);
      }
    },
  };
}
