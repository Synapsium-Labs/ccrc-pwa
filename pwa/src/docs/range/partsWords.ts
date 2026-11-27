// The words of the Markdown parts' bar while the rest of the text is still being read (X2 P6.1 Step 0b2, review round 2): the
// parts are final one by one, so the bar names the part ("Part 2") and has no "of n" until the whole text is cut. Through
// `fillSentence`, like the rest of the Docs reader's words (`docsText.ts`, which holds the bar once the cut is whole).
export const PARTS_WORDS = {
  /** The bar before the number of parts is known: `{k}` the part shown. */
  partOpen: 'Part {k}',
  /** Under the bar of a document above 2 MiB: Changes since and Export read the part on screen, not the whole text (spec 4.3). */
  actsOnPart: 'Changes since and Export act on this part.',
} as const;
