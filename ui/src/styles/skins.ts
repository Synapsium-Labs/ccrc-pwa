// The selectable skins, and the ONLY thing about them that is typed by hand
// (D-5093).
//
// A skin is the third axis beside the palette and light/dark: `data-skin` on
// `<html>`. It varies density, structure and chrome and NEVER colour — colour
// is the palette's axis, which the contrast gate measures once per palette.
// Its token values live in `skins.css` as `:root[data-skin='<id>']` blocks;
// `pwa/test/skin-catalogue.test.ts` binds the ids below to exactly those
// blocks, in both directions, the way `theme-catalogue.test.ts` binds THEMES
// to the palettes.
//
// REFINED IS `:root`, SO IT HAS NO BLOCK — but unlike Phosphor's palette it
// is still STAMPED. `applySkin` always writes the attribute: the boot path has
// to tell "no choice yet" from "Refined", and W2's skin stylesheets select on
// their own classes, never on the attribute's absence. An absent attribute
// still renders Refined (a page that runs no script, or paints before the
// bundle, is a correct Refined page), which is why Refined owns no block.
//
// `pwa/src/lib/skin.ts` is the app's half: the stored choice, the boot stamp
// and `useSkin()`. `pwa/index.html` stamps the stored value before first paint
// and is bound to SKIN_STORAGE_KEY, AUTO, DEVICE_QUERY, the two ids its device
// rule answers and Instrument's preview flag by `skin-boot.test.tsx`.
//
// THE FIRST-RUN DEFAULT FOLLOWS THE DEVICE, NOT THE WINDOW (D-5096). Nothing
// stored, `auto`, an unknown value or unreadable storage all mean AUTO ("Match
// this device"), which resolves by PRIMARY INPUT: a hover-and-fine pointer is a
// desk and gets Instrument; a phone or a tablet (coarse) gets Refined (spec §12,
// O1). Resizing never flips it, and the app reads the device ONCE per page load
// (O2). While Instrument is a `preview`, AUTO is Refined on every device: the
// rule exists in code from W0 and changes nobody's screen until the W2 PR that
// lands Instrument's shell sets the flag false.

/** Skin A: roomy and touch-first, today's console evolved. `:root`. */
export const REFINED = 'refined' as const;
/** Skin B: dense and keyboard-first. `:root[data-skin='instrument']`. */
export const INSTRUMENT = 'instrument' as const;

export type SkinId = typeof REFINED | typeof INSTRUMENT;

/** "Match this device": a stored CHOICE, never a skin. No block answers it and
 *  `resolveSkin` never returns it; it resolves by the device rule (D-5096). */
export const AUTO = 'auto' as const;

/** What a person can choose, and what the store remembers: a skin, or AUTO. */
export type SkinPreference = SkinId | typeof AUTO;

/** The device rule's one question, by PRIMARY input (D-5096): a pointer that
 *  can hover and is fine is a desk. A phone or a tablet points coarsely, and a
 *  stylus-first device points finely but cannot hover, so each is not a desk
 *  (spec §12, O1). Asked once per page load and never subscribed to (O2). The
 *  pre-paint snippet in `pwa/index.html` carries a bound copy. */
export const DEVICE_QUERY = '(hover: hover) and (pointer: fine)';

export interface SkinChoice {
  readonly id: SkinId;
  readonly label: string;
  /** One line on what it is, shown under the name. */
  readonly note: string;
  /** Selectable, but its shell has not landed: the picker says so, and the
   *  per-device default never chooses it (D-5096). W2 sets Instrument false. */
  readonly preview: boolean;
}

export const SKINS: readonly SkinChoice[] = [
  { id: REFINED, label: 'Refined', preview: false,
    note: 'Roomy and touch-first: cards, a reading column and a one-row phone header.' },
  { id: INSTRUMENT, label: 'Instrument', preview: true,
    note: 'Dense and keyboard-first: a rail, a grouped table, an inspector and a status bar.' },
];

/** Where the choice is remembered, per device. Read by the pre-paint snippet
 *  in index.html as well as by the app, so the key is exported rather than
 *  spelled twice — the snippet's one copy is bound by test. */
export const SKIN_STORAGE_KEY = 'ccrc-skin';

/** The classes of token a skin may override (spec §4.2, D-5094). */
export type SkinTokenClass = 'type' | 'density' | 'radius' | 'elevation' | 'meter' | 'motion';

export interface SkinToken {
  readonly name: `--${string}`;
  /** A density token people TAP. It is never declared below `--tap-min`
   *  outside an `@media (pointer: fine)` block, so a coarse device, or one
   *  that reports `pointer: none`, keeps the floor (D-5094's floor case). */
  readonly tapBearing?: true;
}

/** THE CLOSED LIST: the only custom properties `skins.css` may declare, each
 *  with a `:root` default in tokens.css. Every value a skin picks is a scale
 *  step, a length, `none`, or an elevation recipe on `var(--edge-*)` — never a
 *  colour, never a new size. Holds exactly what this task declares; later
 *  tasks append their own (the meter's in Task 5, `--elev-pop` with the
 *  sheet's desktop arm).
 *
 *  THE IDENTITY CORE'S TOKEN GUARD (D-5094) holds every rule written beside a
 *  class below: `pwa/test/skin-identity.test.ts`. For every class: declared
 *  only inside a `:root[data-skin='<id>']` block (optionally inside `@media`),
 *  no colour literal, no `currentColor`, no `!important`, and no `[data-theme]`
 *  palette block may declare one, elevation excepted. The `var()` each class
 *  may name is that test's allowlist, not a list kept here, so the file it
 *  guards cannot widen it. */
export const SKIN_TOKENS: { readonly [C in SkinTokenClass]: readonly SkinToken[] } = {
  // TYPE. Choose, never mint: a `--fs-*` role is exactly `var(--fs-<step>)`,
  // and a `--weight-*` or `--ls-*` role is a step of its own scale. A "step"
  // is a `:root` token that is not itself a skin token, so a role never points
  // at another role. A `--family-*` role is `var(--family-ui)` or
  // `var(--family-mono)`, the Geist pair, never a third face. `var()` may name
  // only `--fs-*`, `--ls-*`, `--weight-*` and those two families. Refined's
  // values in tokens.css obey the same rule (D-5243). `--case-section` is a
  // keyword.
  type: [
    { name: '--fs-ui' },
    { name: '--fs-prose' },
    { name: '--fs-meta' },
    { name: '--fs-page' },
    { name: '--fs-section' },
    { name: '--weight-section' },
    { name: '--family-section' },
    { name: '--case-section' },
    { name: '--ls-section' },
  ],
  // DENSITY. A length, `var(--sp-<step>)`, or a keyword such as `none`
  // (`--page-max-wide` in skins.css). The guard holds the reference half: a
  // `var()` may name only `--sp-*`, so never a floor (`--tap-min`) and never
  // another role, and no colour. It does not check that the rest is a length;
  // only a token marked `tapBearing` is measured. That one is never below
  // `--tap-min` outside an `@media (pointer: fine)` block, in skins.css or in
  // tokens.css (D-5243).
  density: [
    { name: '--gutter' },
    { name: '--row-h', tapBearing: true },
    { name: '--pad-card' },
    { name: '--gap-section' },
    { name: '--page-max' },
    { name: '--page-max-wide' },
    { name: '--measure-chat' },
  ],
  // RADIUS. A length, with no `var()`. `--r-full` is not here: lamps and pills
  // stay round in every skin.
  radius: [
    { name: '--r-sm' },
    { name: '--r-md' },
    { name: '--r-lg' },
    { name: '--r-xl' },
  ],
  // ELEVATION. The one class a palette shares, because its values carry
  // shadow colour: every palette block declares its own. A skin only REPLACES
  // one, with `none` or a hairline whose `var()` names `--edge-subtle` or
  // `--edge-strong` and nothing else. Never a glow: glow means life.
  elevation: [
    { name: '--elev-card' },
  ],
  // METER. Lengths and counts, with no `var()`.
  meter: [],
  // MOTION. Durations, with no `var()`, declared only inside
  // `@media (prefers-reduced-motion: no-preference)`. A skin block is (0,2,0)
  // and outranks tokens.css's reduced-motion `:root`, so a duration anywhere
  // else would re-animate the app for a reader who asked for stillness.
  motion: [
    { name: '--dur-fast' },
    { name: '--dur-base' },
    { name: '--dur-slow' },
  ],
};

/** What a stored value ASKS for — the choice a picker shows. A known id is
 *  itself. Anything else — nothing stored, an empty value, `auto`, a skin from
 *  a newer build, a hand-edited value — is AUTO (spec §7: "an unknown value
 *  means AUTO"). `skins` is injectable for tests; the app never passes it.
 *  The choice, kept apart from its resolution, is D-5246. */
export function skinPreference(
  stored: string | null | undefined,
  skins: readonly SkinChoice[] = SKINS,
): SkinPreference {
  const hit = skins.find((s) => s.id === stored);
  return hit === undefined ? AUTO : hit.id;
}

/** What a stored value means to THIS build, on THIS device: the skin to stamp.
 *
 *  An explicit id is itself, on every device. Everything else is AUTO, which
 *  is INSTRUMENT only on a desk (`deviceIsDesk`: DEVICE_QUERY's answer, read
 *  once per load by the caller) AND only once Instrument is no longer a
 *  preview; otherwise REFINED. So while Instrument is a preview AUTO is
 *  Refined everywhere, and the W2 flip of `preview` is the one change that
 *  turns the desktop default on. Leaving an unknown id stamped would render
 *  `:root` (no block answers it) while the app's own state claimed a skin it
 *  is not showing. Unreadable storage never reaches here: the caller catches
 *  the throw and passes nothing.
 *
 *  `deviceIsDesk` defaults to false — a caller that has not read the device
 *  (Storybook, whose toolbar names a skin explicitly) gets the touch answer.
 *  `skins` is injectable so a test can see the world W2's flip makes. Both
 *  are beyond the plan's two-argument shape (D-5246). */
export function resolveSkin(
  stored: string | null | undefined,
  deviceIsDesk = false,
  skins: readonly SkinChoice[] = SKINS,
): SkinId {
  const asked = skinPreference(stored, skins);
  if (asked !== AUTO) return asked;
  const instrument = skins.find((s) => s.id === INSTRUMENT);
  return deviceIsDesk && instrument !== undefined && !instrument.preview ? INSTRUMENT : REFINED;
}

/** Stamp a RESOLVED skin onto the document. Always writes the attribute,
 *  Refined included — see this file's header for why that departs from
 *  `applyTheme`. */
export function applySkin(id: SkinId, root: HTMLElement): void {
  root.setAttribute('data-skin', id);
}
