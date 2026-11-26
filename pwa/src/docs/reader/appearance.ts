// The reader's appearance map (native Docs reader, appearance continuity, Task 2; design 2026-11-18 §2 and §3). Ring L1
// policy: pure, with no `document` and no `getComputedStyle`. The delivery side (`hostAppearance.ts`, Task 4) reads the
// computed value of each token named here off the document root and hands the text to `readerAppearanceOf`, which
// builds the library's raw contract from it and returns the library's own verdict.
//
// The one hand-kept artefact is `READER_APPEARANCE_MAP`: a slot-to-token mapping. It names no palette and no skin, so a
// new palette or a third skin reaches the reader with no change here (the catalogue never leaves the design system;
// `reader-appearance-source.test.ts` reds a second copy). The slot lists are the library's `APPEARANCE_SLOTS`, which this
// file never spells a second time except as the keys of the mapping, whose type is derived from them, so a slot the
// library adds is a compile error here until it is mapped.
//
// One bad-value rule, the library's: each value is the token's text exactly as `read` answers it (no trim, no case
// change, no unit change), and `parseAppearance` alone decides what is acceptable. Colour slots are all or nothing, so
// one unreadable or refused colour drops the whole colour group and the frame stays hosted in the library's colours for
// the mode (design §7). A skin slot and the label fall back one by one. Nothing here reads a range or a grammar.
import { parseAppearance } from '@synapsium-labs/pinax-lib/frame';
import type { APPEARANCE_SLOTS, Appearance } from '@synapsium-labs/pinax-lib/frame';

type AppearanceColourSlot = (typeof APPEARANCE_SLOTS.colour)[number];
type AppearanceSkinSlot = (typeof APPEARANCE_SLOTS.skin)[number];

/** A ccrc design token, spelled as the custom property the document root answers for. */
export type HostToken = `--${string}`;

/** Spec §3's table, slot for slot. Colour slots take ccrc's text variants for the semantic hues, never a fill. */
export const READER_APPEARANCE_MAP: {
  readonly colour: { readonly [S in AppearanceColourSlot]: HostToken };
  readonly skin: { readonly [S in AppearanceSkinSlot]: HostToken };
} = {
  colour: {
    bg: '--bg-page',
    surface: '--bg-surface',
    surface2: '--bg-raised',
    text: '--ink-primary',
    'text-muted': '--ink-secondary',
    'text-faint': '--ink-tertiary',
    border: '--edge-strong',
    rule: '--edge-subtle',
    accent: '--accent',
    'accent-ink': '--ink-on-accent',
    focus: '--accent',
    ok: '--status-done-text',
    wait: '--status-attention-text',
    no: '--status-dead-text',
    info: '--ink-secondary',
    chg: '--acct-magenta',
    term: '--acct-cyan',
    id: '--acct-blue',
    violet: '--acct-violet',
    path: '--ink-secondary',
    'code-block-bg': '--bg-well',
    'code-ink': '--ink-on-well',
    'syn-comment': '--syn-comment',
    'syn-keyword': '--syn-keyword',
    'syn-string': '--syn-string',
    'syn-number': '--syn-number',
    'syn-function': '--syn-function',
    'syn-type': '--syn-type',
    'syn-tag': '--syn-tag',
    'syn-attr': '--syn-attr',
    'syn-punct': '--syn-punct',
    'syn-deleted': '--syn-deleted',
    'syn-inserted': '--syn-inserted',
  },
  skin: {
    radius: '--r-md',
    radiusSmall: '--r-sm',
    radiusLarge: '--r-lg',
    controlRow: '--row-h',
    popShadow: '--elev-pop',
    // A role, not token text: compared with ccrc's two families below.
    sectionFamily: '--family-section',
    sectionSize: '--fs-section',
    sectionWeight: '--weight-section',
    sectionTracking: '--ls-section',
    sectionCase: '--case-section',
  },
};

/** The two families `--family-section` is compared with, to name a role. */
const FAMILY_ROLES: readonly (readonly [HostToken, 'mono' | 'sans'])[] = [
  ['--family-mono', 'mono'],
  ['--family-ui', 'sans'],
];

/** The contract versions ccrc supports. */
export const READER_APPEARANCE_CONTRACTS: readonly number[] = [1];

/** The one decision on contract support: `'none'` (1.1.0) and any number outside READER_APPEARANCE_CONTRACTS are false. */
export function readerAppearanceSupported(contract: number | 'none'): boolean {
  return contract !== 'none' && READER_APPEARANCE_CONTRACTS.includes(contract);
}

/** The contract's label, ruled copy (ask 594). */
export const READER_APPEARANCE_LABEL = 'Appearance follows ccrc Settings';

export interface ReaderAppearanceOutcome {
  readonly value: Appearance;
  /** The library verdict's own list: each key it left out, and why. */
  readonly refused: readonly { readonly key: string; readonly why: string }[];
  /** `null`: every colour applied. Otherwise the colour group was dropped (spec §7): a token read empty, a value the
   * verdict refused, or a colour scheme that is neither light nor dark. */
  readonly dropped: null | { readonly why: 'colour-unreadable' | 'colour-refused' | 'scheme-unreadable'; readonly token: string };
}

/** The key the library names a refused colour value by: `colour.<slot>`; the group itself is `colour`. */
const COLOUR_KEY = 'colour';

/** The raw contract `readerAppearanceOf` hands the validator: every leaf a string, no key the library does not name. */
interface RawContract {
  mode: string;
  label: string;
  colour?: Record<string, string>;
  skin?: Record<string, string>;
}

/** Called only on a hosted mount, after readerAppearanceSupported answered true, so it has no mode-only case. */
export function readerAppearanceOf(read: (token: HostToken) => string, colourScheme: string): ReaderAppearanceOutcome {
  const scheme = colourScheme.trim();
  const mode = scheme === 'light' || scheme === 'dark' ? scheme : 'auto';
  const raw: RawContract = { mode, label: READER_APPEARANCE_LABEL };
  let dropped: ReaderAppearanceOutcome['dropped'] = null;

  // Colours: the group is all or nothing, so one unreadable token (or a scheme that names no direction) leaves it out.
  if (mode === 'auto') {
    dropped = { why: 'scheme-unreadable', token: 'color-scheme' };
  } else {
    const colour: Record<string, string> = {};
    for (const slot of Object.keys(READER_APPEARANCE_MAP.colour) as AppearanceColourSlot[]) {
      const token = READER_APPEARANCE_MAP.colour[slot];
      const text = read(token);
      if (text === '') { dropped = { why: 'colour-unreadable', token }; break; }
      colour[slot] = text;
    }
    if (dropped === null) raw.colour = colour;
  }

  // Skin: one slot at a time, an unreadable token leaves only its slot out.
  const skin: Record<string, string> = {};
  for (const slot of Object.keys(READER_APPEARANCE_MAP.skin) as AppearanceSkinSlot[]) {
    const token = READER_APPEARANCE_MAP.skin[slot];
    const text = read(token);
    if (slot === 'sectionFamily') {
      const role = FAMILY_ROLES.find(([family]) => text !== '' && read(family) === text);
      if (role !== undefined) skin[slot] = role[1];
    } else if (text !== '') skin[slot] = text;
  }
  if (Object.keys(skin).length > 0) raw.skin = skin;

  const verdict = parseAppearance(raw);
  if (dropped === null && raw.colour !== undefined && verdict.appearance.colour === undefined) {
    // The verdict refused the group: name the first value it named, by the token that fed it.
    const hit = verdict.refused.find((r) => r.key === COLOUR_KEY || r.key.startsWith(`${COLOUR_KEY}.`));
    const slot = hit?.key.slice(COLOUR_KEY.length + 1) as AppearanceColourSlot | undefined;
    const token = slot === undefined ? undefined : READER_APPEARANCE_MAP.colour[slot];
    dropped = { why: 'colour-refused', token: token ?? hit?.key ?? COLOUR_KEY };
  }
  return { value: verdict.appearance, refused: verdict.refused, dropped };
}
