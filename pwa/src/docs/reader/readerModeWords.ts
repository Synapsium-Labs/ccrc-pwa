// Every sentence reader mode shows itself (native Docs reader, reader-mode plan Task XR1.1 as amended 2026-11-24, D-8975;
// the reader-mode spec's sections 3.3 and 6.3): the control names, the live announcement, the overlay's words (XR2.1) and the
// time left. Ring L1:
// strings and pure formatters, no I/O and no import. There is no menu word: the menu control is never built.

/** The words of reader mode's controls and its announcement. */
export const READER_MODE_TEXT = Object.freeze({
  enter: 'Reader mode',
  exit: 'Exit reader mode',
  /** The live-region announcement on entering. */
  live: 'Reader mode. Back or Exit leaves it.',
  toolbar: 'Reader mode',
  /** The overlay's Exit shows this word; its accessible name is `exit`. */
  exitShown: 'Exit',
  /** The overlay's Aa (X6 XR2.1, D-8803): the accessible name of the button that shows `aaShown` and opens the reader's settings. */
  aa: 'Reading settings',
  aaShown: 'Aa',
} as const);

/** The overlay's progress text for a share read (clamped to [0, 1]): the percentage, rounded, like `41%`. */
export function progressText(share: number): string {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return `${Math.round(s * 100)}%`;
}

/** The time left, for `timeLeftMinutes`' unrounded answer: `less than a minute left` below one minute, else
 *  `about N min left` with N rounded. */
export function timeLeftText(minutes: number): string {
  return minutes < 1 ? 'less than a minute left' : `about ${Math.round(minutes)} min left`;
}
