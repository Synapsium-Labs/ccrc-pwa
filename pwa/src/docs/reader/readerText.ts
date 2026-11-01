// Every sentence the reader frame shows itself (native Docs reader, W8a Task 5; the 2026-10-31 reader-frame spec's
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
  /** The warning shown for a host other than the console's own (refinement (h): any other host). */
  linkForeign: (host: string): string =>
    `This link leaves this console and goes to ${host}. Check the address before you open it.`,
  linkOpen: 'Open',
  linkCancel: 'Cancel',
  copyTitle: 'Copy with hidden characters?',
  copyWarning: 'This text holds characters that do not show, or is very long. Check it before you paste it anywhere.',
  /** One hidden character as the sheet writes it: the bracketed code point and name. */
  copyMarker: (h: ReaderHiddenChar): string =>
    `⟦U+${h.codePoint.toString(16).toUpperCase().padStart(4, '0')} ${h.name}⟧`,
  copyAnyway: 'Copy anyway',
  copyCancel: 'Cancel',
} as const;
