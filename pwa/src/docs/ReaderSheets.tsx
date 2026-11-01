// The reader frame's two sheets (native Docs reader, W8a Task 8; the 2026-10-31 reader-frame spec's M8.7 and M8.19).
// Ring L4 delivery over @ccrc/ui's `Sheet`: they show what `ReaderFrame` hands them and report the reader's choice,
// and they decide nothing. Their words are `readerText.ts`'s. The external-link sheet names the address and, for a host
// that is not the console's own, the foreign warning; the copy sheet marks each hidden character the host's scan found.
// Neither acts on its own: `window.open` and the clipboard write belong to `ReaderFrame`, run from the buttons here.
import type { ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { READER_SHEET_TEXT, type ReaderHiddenChar } from './reader/readerText';

/** What the external-link sheet asks about: the address as the document wrote it, its host, and whether that host is
 *  foreign to the console (`routeReaderLink`'s answer, shown and not recomputed here). */
export interface ReaderLinkAsk {
  readonly url: string;
  readonly host: string;
  readonly foreign: boolean;
}

/** What the copy sheet asks about: the exact text a Copy anyway writes, and the hidden characters to name. */
export interface ReaderCopyAsk {
  readonly text: string;
  readonly hidden: readonly ReaderHiddenChar[];
}

/** The ask before a link out of the document opens (M8.7). Nothing is open for `ask === null`. */
export function ReaderLinkSheet(p: {
  readonly ask: ReaderLinkAsk | null; readonly onOpen: (ask: ReaderLinkAsk) => void; readonly onCancel: () => void;
}): ReactNode {
  const { ask } = p;
  if (ask === null) return null;
  return (
    <Sheet
      open
      onClose={p.onCancel}
      title={READER_SHEET_TEXT.linkTitle}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" onClick={() => p.onOpen(ask)}>{READER_SHEET_TEXT.linkOpen}</Button>
          <Button variant="ghost" onClick={p.onCancel}>{READER_SHEET_TEXT.linkCancel}</Button>
        </div>
      }
    >
      <div className="docs-reader-sheet">
        <p className="docs-reader-sheet-url">{ask.url}</p>
        {ask.foreign && <p className="docs-reader-sheet-note">{READER_SHEET_TEXT.linkForeign(ask.host)}</p>}
      </div>
    </Sheet>
  );
}

/** The ask before text with hidden characters, or very long text, is copied (M8.19). Nothing is open for
 *  `ask === null`. */
export function ReaderCopySheet(p: {
  readonly ask: ReaderCopyAsk | null; readonly onCopy: (ask: ReaderCopyAsk) => void; readonly onCancel: () => void;
}): ReactNode {
  const { ask } = p;
  if (ask === null) return null;
  return (
    <Sheet
      open
      onClose={p.onCancel}
      title={READER_SHEET_TEXT.copyTitle}
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" onClick={() => p.onCopy(ask)}>{READER_SHEET_TEXT.copyAnyway}</Button>
          <Button variant="ghost" onClick={p.onCancel}>{READER_SHEET_TEXT.copyCancel}</Button>
        </div>
      }
    >
      <div className="docs-reader-sheet">
        <p className="docs-reader-sheet-note">{READER_SHEET_TEXT.copyWarning}</p>
        {ask.hidden.length > 0 && (
          <ul className="docs-reader-sheet-marks">
            {ask.hidden.map((h) => <li key={h.index}>{READER_SHEET_TEXT.copyMarker(h)}</li>)}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
