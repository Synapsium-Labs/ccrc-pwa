// The unmeasured registry's SENTENCE, said once (D-7570). L1: the chip's title and the session row's
// `unreadable` marker both read it here, so the session facts never import the chip component file.
/** The unmeasured registry's sentence — ONE spelling for `chips.tsx#UnmeasuredChip` and the row's `unreadable` marker (D-5545). */
export const unmeasuredTitle = (fields: readonly string[]): string =>
  `registry ${fields.join('/')} temporarily unreadable — retrying`;
