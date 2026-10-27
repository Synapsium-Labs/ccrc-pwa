// The class chooser's words (T3a, D-6331). Two choosers offer the same unset choice: the fleet column's class filter
// (`FleetScreen`) and the New session sheet's class field (`NewSessionSheet`). It is one decision, so it is written
// once; the literal census (`literal-census.test.ts`) reds on a sentence spelled in two files.

/** The unset choice: no class is sent, so the routing matrix picks one. */
export const AUTOMATIC_CLASS: Readonly<Record<'word' | 'title', string>> = {
  word: 'Automatic',
  title: 'The routing matrix picks the class',
};
