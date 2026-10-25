// The share each tick-diet differential file runs (D-6767): which per-locale blocks of `ccdTickDietRunner.ts`'s
// `registerLocaleRows` a file registers. `ccd-tick-diet-equivalence.test.ts` once ran every block under `C` in one
// file, 638 s on a CI runner, and the planner never splits a file; it is now `-static` (the locale-free E0, E1, E2, E4
// and the static censuses) and one file per entry below: `-rows` (E3, E5 to E8, E10) and `-route` (E9, whose one batch
// is most of the old file's time and, being one `describe` block with one `beforeAll`, is as small as a split by
// `describe` gets). Measured in a Linux container on a loaded laptop: `-rows` 3 to 5 min, `-route` 4.5 to 6.5 min. The
// blocks are the runner's and keep their titles, so a full test name is the one it was before the split.
//
// The same rows under the UTF-8 locale, once `ccd-tick-diet-equivalence-utf8.test.ts` at 10.5 minutes, split the same
// way into `-utf8-limits` (E5, E7), `-utf8-registry` (E3, E6, E8, E10) and `-utf8-route` (E9), one file per entry of
// `TICK_DIET_UTF8_PARTS`.
//
// `TICK_DIET_C_PARTS` and `TICK_DIET_UTF8_PARTS` are each the whole of their locale's rows, once:
// `ccd-tick-diet-partsPin.test.ts` pins that each locale's files together register each block exactly once, so a block
// added to the runner and left out of every part reds.
import { LOCALES, registerLocaleRows } from './ccdTickDietRunner.js';

/** The per-locale blocks (E3, E5 to E10) of the runner, by the file part that runs them under `C`. */
export const TICK_DIET_C_PARTS = {
  rows: ['E3', 'E5', 'E6', 'E7', 'E8', 'E10'],
  route: ['E9'],
} as const;

/** Registers one part's blocks under `C`. A file calls this and nothing else. */
export function registerCParts(part: keyof typeof TICK_DIET_C_PARTS): void {
  registerLocaleRows(LOCALES[0], TICK_DIET_C_PARTS[part]);
}

/** The per-locale blocks (E3, E5 to E10) of the runner, by the file part that runs them under the UTF-8 locale. */
export const TICK_DIET_UTF8_PARTS = {
  limits: ['E5', 'E7'],
  registry: ['E3', 'E6', 'E8', 'E10'],
  route: ['E9'],
} as const;

/** Registers one part's blocks under the UTF-8 locale. A file calls this and nothing else. */
export function registerUtf8Parts(part: keyof typeof TICK_DIET_UTF8_PARTS): void {
  registerLocaleRows(LOCALES[1], TICK_DIET_UTF8_PARTS[part]);
}
