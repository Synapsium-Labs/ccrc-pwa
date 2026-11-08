/**
 * D-6048 (Task C0k; ARCH-12 (#552)), held in D-6045's shape (ARCH-04 (#545)): the exported literal unions in
 * `shared/*.ts` that have no runtime list yet, keyed `file:Name`. The set started at the merge-day count (31) minus
 * the three lists ARCH-12 added; it may only shrink. Each entry gives its reason in one line and the day it was
 * written; `exemption-age.data.ts` stamps the set's size, so a set left unchanged for 60 days goes red. #2371 drained
 * the other 27 merge-day entries with a sibling map each; the one left cannot hold a value in its file.
 */
import type { EntrySet } from './exemptions.js';

export const WIRE_TOTALITY_EXEMPTIONS: EntrySet = {
  'base-url.ts:BaseUrlRefusal': {
    reason: 'must stay: base-url.ts is the typed re-export of base-url.mjs and defines no value (D-7307, pinned in '
      + 'base-url.test.ts), so no sibling map or guard can live beside the union; base-url.mjs alone builds the words',
    since: '2026-11-07',
  },
};
