// Every sentence reader mode shows itself (native Docs reader, reader-mode plan Task XR1.1 as amended 2026-11-24, D-8975;
// the reader-mode spec's sections 3.3 and 6.3): the control names, the live announcement, the overlay's words (XR2.1) and the
// time left. Ring L1:
// strings and pure formatters, no I/O, and no import but the decider's own pure `timeLeftMinutes` and `layoutAllowsReaderMode`
// (this file reads the decider; the decider imports no words, so the two make no cycle). There is no menu word: the menu
// control is never built.

import type { ReaderLayout } from '../../../../shared/docs';
import { layoutAllowsReaderMode, timeLeftMinutes, type ReaderLayoutRule } from './readerMode';

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
  /** The turn setting (X6 XR2.2): the radio group's accessible name, and the two radios' words (each says what it chooses; the checked
   *  one is the way the reader turns now). */
  turn: 'Turning',
  turnScreens: 'Pages',
  turnScroll: 'Scroll',
} as const);

/** Each layout's name as the reader picks it, in the layouts' own order (`default` first): the one list the Layout row's options and
 *  the palette's Layout commands both read. */
const LAYOUT_NAMES = Object.freeze({
  default: 'Default', classic: 'Classic', editorial: 'Editorial', review: 'Review', guided: 'Guided',
} as const);

/** The palette's command for a layout (D-9180): `Layout: <name>`, the name from the one list. */
export function readerLayoutCommandTitle(layout: ReaderLayout): string {
  return `Layout: ${LAYOUT_NAMES[layout]}`;
}

/** The Layout row in Page details (X2 P5.1): its label, each layout's name as the reader picks it (the `<select>`'s options, in
 *  the layouts' own order, `default` first), and the note when the layout rule keeps reader mode from the layout in use
 *  (`readerModeLayoutNote`, below), in two texts: `note` beside the Layout row in Page details, and `deskNote` on the desk, whose head
 *  has no Layout control (D-9180) and names the palette command that gives the default layout back. */
export const READER_LAYOUT_TEXT = Object.freeze({
  label: 'Layout',
  note: 'Reader mode reads in the default layout. Choose it here to use reader mode.',
  deskNote: `Reader mode reads in the default layout. Choose ${readerLayoutCommandTitle('default')} in the command palette to use reader mode.`,
  names: LAYOUT_NAMES,
} as const);

/** The sentence the head says when the rule keeps reader mode from `layout` (X2 P5.1): under `default-only`, outside the default
 *  layout. `place` is where it is said: `details` (Page details, beside the Layout row; the default) or `desk` (a line under the desk
 *  head's row). `null` has one meaning: reader mode is offered in this layout, so there is nothing to say. The words are
 *  `READER_LAYOUT_TEXT`'s; whether the layout is allowed is the decider's (`layoutAllowsReaderMode`), the one rule for both places. */
export function readerModeLayoutNote(input: { layout: ReaderLayout; rule: ReaderLayoutRule; place?: 'details' | 'desk' }): string | null {
  if (layoutAllowsReaderMode(input.layout, input.rule)) return null;
  return input.place === 'desk' ? READER_LAYOUT_TEXT.deskNote : READER_LAYOUT_TEXT.note;
}

/** Reader mode's one key, `r` with no modifier (spec 2026-11-20 3.2): the console's registry row and its key-holding check both
 *  read this, so the key is spelled once. */
export const READER_MODE_KEY = 'r';

/** The overlay's progress text for a share read (clamped to [0, 1]): the percentage, rounded, like `41%`. */
export function progressText(share: number): string {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return `${Math.round(s * 100)}%`;
}

/** The overlay's whole progress text (X6 XR2.2), the one owner of its rules: the percentage of `share`, and after it the time left
 *  at that same share (`41% · about 12 min left`). The percentage stands alone when the document has no usable reading time:
 *  absent, not finite, or 0 or less (the library's 0 is "no text", for which "less than a minute left" would be false). A share
 *  that is not a finite number reads as 0 in both halves, so the two never disagree and neither says `NaN`. */
export function overlayProgressText(share: number, readingMinutes: number | undefined): string {
  const percent = progressText(share);
  if (readingMinutes === undefined || !Number.isFinite(readingMinutes) || readingMinutes <= 0) return percent;
  return `${percent} · ${timeLeftText(timeLeftMinutes(readingMinutes, share))}`;
}

/** The time left, for `timeLeftMinutes`' unrounded answer: `less than a minute left` below one minute, else
 *  `about N min left` with N rounded. */
export function timeLeftText(minutes: number): string {
  return minutes < 1 ? 'less than a minute left' : `about ${Math.round(minutes)} min left`;
}
