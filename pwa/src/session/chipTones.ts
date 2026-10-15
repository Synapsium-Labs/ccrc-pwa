// THE CHIP TONES THIS CONSOLE HAS, NAMED — and named HERE, in the app, which
// is the whole point of the file.
//
// A design-system audit asked for a typed `tone` axis on `@ccrc/ui`'s `Chip`
// and `Well`, on the observation that "the call sites already spell tones as
// free-form strings". The observation was right and the remedy was not, and
// both halves are measured in those components' own headers: `.chip--active`
// paints `--acct-active` on its tint (an ACCOUNT alias — ccrc routing
// vocabulary), `.chip--archived` is a contrast decision whose rule carries its
// own 3.17:1 measurement for the surface it sits on, and `.chip--repo` sets a
// font family and no colour at all. One `tone` prop would have to mean an
// account vocabulary, one screen's contrast argument and a typeface at once,
// and the design system would hold ccrc's words.
//
// WHAT WAS LEFT UNFIXED BY THAT REFUSAL is the half the audit actually
// complained about: `className="chip--activ"` compiles, renders an unskinned
// pill, and nothing says a word. The modifier is an APP decision, so the type
// that catches the typo belongs in the app — not in the package, and not
// nowhere.
//
// So: a `Record` keyed by a union. `chipTone('active')` is checked; a fifth
// name is a compile error until this file names it, and `markup-census`
// already refuses a fifth COPY of the string. Nothing about the rendering
// changes — these are the same four and three class strings chat.css has
// always skinned, which is why this file is types and no logic.

/** What a chip on the session header can be SAYING. Each one is a chat.css
 *  rule; the rule is where the colour argument lives. */
export type ChipTone = 'active' | 'repo' | 'archived';

/** The modifiers of the meta row's own pill. `model` and `ultra` are live
 *  choosers, `branch` is a label — which is the distinction `button.metachip`
 *  encodes by carrying the 44px floor that `.metachip` does not. */
export type MetaChipTone = 'model' | 'ultra' | 'branch' | 'plain';

const CHIP: Record<ChipTone, string> = {
  active: 'chip--active',
  repo: 'chip--repo',
  archived: 'chip--archived',
};

const METACHIP: Record<MetaChipTone, string> = {
  model: 'metachip metachip--model',
  ultra: 'metachip metachip--ultra',
  branch: 'metachip metachip--branch',
  // The effort chip with ultracode OFF wears the base alone. It is a tone in
  // the sense that matters here — a named state of one control — so it is in
  // the map rather than left as the one call site that still types a literal.
  plain: 'metachip',
};

/** The class for a `<Chip>`'s tone. */
export const chipTone = (tone: ChipTone): string => CHIP[tone];

/** The class for a meta-row pill's tone. */
export const metaChipTone = (tone: MetaChipTone): string => METACHIP[tone];

/** Every tone string this file can produce, for the guard that pins them
 *  against the stylesheet. Exported so the test reads the MAP rather than a
 *  second list of the same names. */
export const ALL_CHIP_TONES: readonly string[] = [
  ...Object.values(CHIP),
  ...Object.values(METACHIP),
];
