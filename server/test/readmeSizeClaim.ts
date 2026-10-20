// The one definition of "a README line count stated in prose" (D-5892, #558). CLAUDE.md states no README size, and
// two tests hold that absence: `oss-metadata.test.ts` for the whole file, `pools-prose.test.ts` beside the bullet
// that once measured itself against it. Both read this pattern, so they cannot drift apart.
//
// Two shapes are caught, each within one clause (no `.` or `;` between the parts):
//   forward  — README named, then the count:  "README.md (~6702 lines)", "README is 6,300 lines"
//   reversed — the count, then README named:  "the 6702-line `README.md`", "6,300 lines of README"
const README_SIZE = new RegExp(
  [
    String.raw`README(?:\.md)?\x60?[^.;]{0,40}?\b\d[\d,]*\s+lines?\b`,
    String.raw`\b\d[\d,]*[- ]lines?\b[^.;]{0,40}?README`,
  ].join('|'),
  'i',
);

/** The first README line-count phrase in `text`, whitespace (line breaks included) collapsed to single spaces, or
 *  null when there is none. Returns the phrase itself, not the text, so a failing assertion prints only the
 *  offending words rather than the whole document. */
export function readmeSizeClaim(text: string): string | null {
  return text.replace(/\s+/g, ' ').match(README_SIZE)?.[0] ?? null;
}
