// Every sentence reader mode shows itself (native Docs reader, reader-mode plan Task XR1.1 as amended 2026-11-24, D-8975;
// the reader-mode spec's sections 3.3 and 6.3): the control names, the live announcement and the time left. Ring L1:
// strings and pure formatters, no I/O and no import. There is no menu word: the menu control is never built.

/** The words of reader mode's controls and its announcement. */
export const READER_MODE_TEXT = Object.freeze({
  enter: 'Reader mode',
  exit: 'Exit reader mode',
  /** The live-region announcement on entering. */
  live: 'Reader mode. Back or Exit leaves it.',
  toolbar: 'Reader mode',
} as const);

/** The time left, for `timeLeftMinutes`' unrounded answer: `less than a minute left` below one minute, else
 *  `about N min left` with N rounded. */
export function timeLeftText(minutes: number): string {
  return minutes < 1 ? 'less than a minute left' : `about ${Math.round(minutes)} min left`;
}
