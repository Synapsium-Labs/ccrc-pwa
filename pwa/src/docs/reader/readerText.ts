// Every sentence the reader frame shows itself (native Docs reader, W8a Task 5; the rich-docs spec's (amended 2026-10-31)
// section 4.6 and M8.7, M8.19): the fixed fallback note and the words of the two sheets. Ring L1: strings and pure
// formatters, no I/O and no import. The library's own page chrome is the library's; only what ccrc's host shows
// lives here.

/** Shown in place of the rich view when it did not start (section 4.6's exact sentence). The reason is never shown:
 *  it goes to the console only. */
export const READER_FALLBACK_NOTE = 'The rich view did not start; shown in the plain view.';

/** One hidden or control character the copy sheet names: its index in the text, its code point and its name. */
export interface ReaderHiddenChar {
  readonly index: number;
  readonly codePoint: number;
  readonly name: string;
}

/** The words of the external-link sheet (M8.7) and the copy sheet (M8.19). */
export const READER_SHEET_TEXT = {
  linkTitle: 'Open this link?',
  /** The warning shown for a host other than the console's own (the W8a plan's refinement (h): any other host). */
  linkForeign: (host: string): string =>
    host === ''
      ? 'This link opens your mail app. Check the address before you open it.' // a mailto with no host to name
      : `This link leaves this console and goes to ${host}. Check the address before you open it.`,
  linkOpen: 'Open',
  linkCancel: 'Cancel',
  copyTitle: 'Copy with hidden characters?',
  copyWarning: 'This text holds characters that do not show, or is very long. Check it before you paste it anywhere.',
  /** One hidden character as the sheet writes it: the bracketed code point and name. */
  copyMarker: (h: ReaderHiddenChar): string =>
    `⟦U+${h.codePoint.toString(16).toUpperCase().padStart(4, '0')} ${h.name}⟧`,
  /** A hidden character past the sheet's cap of named markers: marked in place, with no name. */
  copyMarkerUnnamed: '⟦hidden⟧',
  /** The line saying how many hidden characters past the cap are marked without a name. */
  copyUnnamed: (n: number): string => `${n} more hidden characters are marked ⟦hidden⟧ without a name.`,
  copyAnyway: 'Copy anyway',
  copyCancel: 'Cancel',
  /** Shown in either copy sheet when the clipboard refused the write (it stays open). */
  copyFailed: 'The clipboard did not accept the text.',
  /** The sheet for clean text the clipboard refused: the text is shown so it can be copied by hand. */
  copyFailedTitle: 'The text was not copied',
  copyByHand: 'Select the text below and copy it yourself.',
  /** The same, on the hidden-characters sheet: what is shown has the markers, so a hand copy holds them too. */
  copyByHandMarked:
    'Select the text below and copy it yourself. Hidden characters are shown as markers here, so what you copy holds the markers, not the characters.',
  copyTryAgain: 'Try again',
  copyFailedClose: 'Close',
} as const;

/** The text the copy sheet shows: `text` with each LISTED hidden character replaced in place by its marker, so the
 *  reader sees where it sits. The first `namedMax` (in text order, whatever the list's order) get
 *  `READER_SHEET_TEXT.copyMarker`; the rest get `copyMarkerUnnamed`, and `unnamed` counts them. The host's list is
 *  trusted for a position and nothing more: an entry whose index is out of range, repeats an index already marked or
 *  does not name the character at that index is skipped, and what it pointed at stays as it is in the text. A hidden
 *  character the list leaves out stays as it is too; the list is the host's own scan of this text. */
export function markHiddenText(
  text: string, hidden: readonly ReaderHiddenChar[], namedMax: number,
): { readonly text: string; readonly unnamed: number } {
  const marks = [...hidden].sort((a, b) => a.index - b.index);
  let out = '';
  let at = 0;
  let named = 0;
  let unnamed = 0;
  for (const h of marks) {
    const width = h.codePoint > 0xffff ? 2 : 1;
    if (h.index < at || h.index + width > text.length || text.codePointAt(h.index) !== h.codePoint) continue;
    out += text.slice(at, h.index);
    if (named < namedMax) {
      out += READER_SHEET_TEXT.copyMarker(h);
      named += 1;
    } else {
      out += READER_SHEET_TEXT.copyMarkerUnnamed;
      unnamed += 1;
    }
    at = h.index + width;
  }
  return { text: out + text.slice(at), unnamed };
}
