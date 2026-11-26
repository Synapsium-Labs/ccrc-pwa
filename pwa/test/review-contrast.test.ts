// The draft review page's OWN colour pairs, light and dark as the device chooses (native Docs draft review, X3, wave R2).
//
// WHY THIS PAGE HAS A ROW OF ITS OWN. `src/review/review.css` styles a separate document: `pwa/review.html`, served under its
// own header policy to a reader who has no console session and no skin setting. Its frame is a banner, a sentence and a
// button around bytes that carry their own look, and it never takes the console's palettes. So the console's design audit
// (`design/audit.mjs`) leaves it out, by exact path, with the reason, in `SEPARATE_DOCUMENTS`, and measuring it against the
// console's 13 palettes would be meaningless anyway (its `--review-*` properties are in none of them). An exemption alone
// would leave the page unmeasured, so this file measures the page's own pairs in both of its schemes, with the audit's own
// `contrast` and its own floors (`TEXT_FLOOR` for text, `UI_FLOOR` for a control's border and a focus ring), straight from
// the sheet on disk. A mutation row pushes one pair under its floor in each scheme and expects the measurement to go red, and
// a row proves both blocks and every variable the pairs use were found, so no row can pass by measuring nothing.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXT_FLOOR, UI_FLOOR, blockBody, contrast, customProps, resolveColor } from '../design/audit.mjs';

const CSS_PATH = path.join(import.meta.dirname, '..', 'src', 'review', 'review.css');
const css = readFileSync(CSS_PATH, 'utf8');

type Pair = { label: string; fg: string; bg: string; floor: number };

/** Every foreground the sheet paints on every ground it paints it on. Grounds: the page (`--review-bg`, the root and the body),
 *  the banner ground (`--review-banner-bg`: the banner, the restore note, a lab row, the lab result), and the accent (the
 *  pressed lab button). Each pair names the rule that paints it. Not measured here, and named with a reason in the census's
 *  exception lists below: `.review-lab-failure`'s white (it sits on the red `LAB_FAILURE_COLOUR` that `src/review/main.ts` sets
 *  itself, the reference of what a failed copy shows, not page palette) and borders that only decorate (`--review-line`). */
const PAIRS: readonly Pair[] = [
  // `body` { color: fg } on `body` / `:root` { background: bg }; also `.review-message`, `.review-lab-intro`, `.review-lab-status`.
  { label: 'body text: fg on bg', fg: '--review-fg', bg: '--review-bg', floor: TEXT_FLOOR },
  // `.review-banner`, `.review-restore-note`, `.review-lab-row` / `.review-lab-line`, `.review-lab-result`: fg inherited from body.
  { label: 'banner, restore note, lab row, result: fg on banner-bg', fg: '--review-fg', bg: '--review-banner-bg', floor: TEXT_FLOOR },
  // `.review-links h2` and `.review-lab-caption`: muted ink straight on the page.
  { label: 'links heading, lab caption: muted on bg', fg: '--review-muted', bg: '--review-bg', floor: TEXT_FLOOR },
  // `.review-lab-look` sits inside `.review-lab-row`, so its muted ink is on the banner ground. The disabled button's ink
  // (`button:disabled` colour muted) is on bg, which is the pair above.
  { label: 'lab look: muted on banner-bg', fg: '--review-muted', bg: '--review-banner-bg', floor: TEXT_FLOOR },
  // `button` text (colour accent on its own `background: bg`) and `.review-links a` (accent on the page).
  { label: 'button text, links: accent on bg', fg: '--review-accent', bg: '--review-bg', floor: TEXT_FLOOR },
  // `.review-lab-key` (accent) inside `.review-lab-line` inside `.review-lab-row`.
  { label: 'lab key: accent on banner-bg', fg: '--review-accent', bg: '--review-banner-bg', floor: TEXT_FLOOR },
  // `.review-lab-answers button[aria-pressed='true']`: colour bg on background accent.
  { label: 'pressed lab button: bg on accent', fg: '--review-bg', bg: '--review-accent', floor: TEXT_FLOOR },
  // UI pair: the button's `border: 1px solid accent` against the page ground.
  { label: 'button border: accent on bg (UI)', fg: '--review-accent', bg: '--review-bg', floor: UI_FLOOR },
  // UI pair: the focus ring (`button:focus-visible`, `a:focus-visible`: `outline: 2px solid accent`) on the banner ground, where
  // the lab's buttons sit; on the page it is the pair above.
  { label: 'focus ring in a lab row: accent on banner-bg (UI)', fg: '--review-accent', bg: '--review-banner-bg', floor: UI_FLOOR },
  // UI pair: `.review-lab-swatch`'s `border: 1px solid fg` on the page and on the banner ground (the swatch sits in a row).
  { label: 'lab swatch border: fg on banner-bg (UI)', fg: '--review-fg', bg: '--review-banner-bg', floor: UI_FLOOR },
  // UI pair: the pressed lab button's accent ground against the banner ground it sits on.
  { label: 'pressed lab button ground: accent on banner-bg (UI)', fg: '--review-accent', bg: '--review-banner-bg', floor: UI_FLOOR },
];

const VARS = [...new Set(PAIRS.flatMap((p) => [p.fg, p.bg]))].sort();

type Scheme = 'light' | 'dark';

/** The sheet's custom properties for one scheme, or null when its block is not in the text. */
function blockOf(text: string, scheme: Scheme): Record<string, string> | null {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  try {
    if (scheme === 'light') return customProps(blockBody(bare, ':root.review-page'));
    return customProps(blockBody(blockBody(bare, '@media (prefers-color-scheme: dark)'), ':root.review-page'));
  } catch {
    return null;
  }
}

/** Pure: css text in, the failures out (a pair under its floor, a missing block, a missing variable). Empty means every pair
 *  holds in both schemes. */
function measure(text: string): string[] {
  const failures: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const theme = blockOf(text, scheme);
    if (!theme) {
      failures.push(`${scheme}: the :root.review-page block is not in the sheet`);
      continue;
    }
    for (const p of PAIRS) {
      const missing = [p.fg, p.bg].filter((v) => theme[v] === undefined);
      if (missing.length) {
        failures.push(`${scheme} ${p.label}: ${missing.join(', ')} not defined`);
        continue;
      }
      const r = contrast(resolveColor(`var(${p.fg})`, theme), resolveColor(`var(${p.bg})`, theme));
      if (r < p.floor) failures.push(`${scheme} ${p.label}: ${r.toFixed(2)} is under ${p.floor}`);
    }
  }
  return failures;
}

// ── the census: no colour rule in the sheet goes unmeasured ─────────────────────────────────────────────────────────────
// PAIRS is a hand list, so a colour rule added to the sheet would be measured by nothing. This census reads every rule of the
// sheet and demands that each colour it paints is accounted for: a text colour as the foreground of a TEXT_FLOOR pair, a ground
// as a ground of some pair, an edge (border, outline, text-decoration-color, caret, accent, fill, stroke, column rule) as a
// UI_FLOOR pair or a named exception, a shadow as a UI_FLOOR pair with no exception, and a literal colour only as a named
// exception. A colour value the census cannot classify (a named colour, `transparent`, `currentcolor`, a variable outside
// `--review-*`) is reported too, so a colour never passes by being unrecognised.
//
// WHAT IT DOES NOT PROVE. It checks each colour on its own, not which colours MEET. A new rule that paints body text on the
// accent passes, because the accent is already the ground of some pair, and the pair (fg on accent) is only the one in PAIRS.
// The pairs list is the claim of which colours meet which; a reviewer reading a new colour rule still has to ask whether it
// makes a new combination. It also reads only the properties `classify()` names: a colour in `text-shadow`,
// `scrollbar-color`, `-webkit-text-fill-color` or an SVG paint property (`stop-color`, `flood-color`, `lighting-color`), or a
// border with no colour (which takes the text colour), passes it unseen. The sheet uses none of them today.

type Usage = { selector: string; prop: string; kind: 'text' | 'ground' | 'edge' | 'shadow' | 'unclassified'; value: string; literal: boolean };

/** Edges (border, outline) that are not a measured UI pair, each with the reason. Keyed by the variable. */
const EDGE_EXCEPTIONS: Record<string, string> = {
  '--review-line':
    'a decorative edge on a box whose ground (the banner ground) or whose frame already sets it apart, never the only cue to a control; '
    + "the disabled button's border is exempt as a disabled control",
};

/** Literal colours in the sheet, each with the reason. Keyed `<selector> | <property>` (the value is named in the reason, in
 *  words: a hex typed here would be one more hand-typed copy for contrast.test.ts's sweep to find). */
const LITERAL_EXCEPTIONS: Record<string, string> = {
  '.review-frame | background':
    'the frame holds the draft copy, a document that carries its own look; white is the neutral ground it is drawn on in both schemes, and no text of the page is painted over it',
  '.review-lab-failure | color':
    'the reference image of the canary block: drawn in the canary\'s exact colours (white on LAB_FAILURE_COLOUR, #ff0000, which src/review/main.ts sets itself) so the operator can compare; '
    + 'measured 4.0:1, under TEXT_FLOOR, and exempt by that reason',
};

const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)/gi;

/** CSS named colours, plus `transparent` and `currentcolor`: in a colour property's value each is a colour nothing measures. */
const NAMED_COLOURS = new Set(
  ('transparent currentcolor aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet '
    + 'brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod '
    + 'darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen '
    + 'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue '
    + 'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink '
    + 'indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
    + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray '
    + 'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '
    + 'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream '
    + 'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise '
    + 'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown '
    + 'salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan '
    + 'teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '),
);

/** Values that set no colour at all, so a colour-only property holding one is fine (`fill: none`, `accent-color: auto`). */
const NON_COLOUR_KEYWORDS = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'auto']);

const SIDES = '(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?';
const EDGE_COLOUR_ONLY = new RegExp(`^(?:border|outline)${SIDES}-color$|^(?:text-decoration|caret|accent|column-rule)-color$|^(?:fill|stroke)$`);
const EDGE_SHORTHAND = new RegExp(`^(?:border|outline)${SIDES}$|^(?:column-rule|text-decoration)$`);

/** Which property paints a colour: its kind, and whether its value is a bare colour (`colourOnly`) or a shorthand that may
 *  carry widths, styles and offsets beside it. Not a colour property (a width, a radius, an offset, a font): null. */
function classify(prop: string): { kind: Usage['kind']; colourOnly: boolean } | null {
  if (prop === 'color') return { kind: 'text', colourOnly: true };
  if (prop === 'background-color') return { kind: 'ground', colourOnly: true };
  if (prop === 'background') return { kind: 'ground', colourOnly: false };
  if (prop === 'box-shadow') return { kind: 'shadow', colourOnly: false };
  if (EDGE_COLOUR_ONLY.test(prop)) return { kind: 'edge', colourOnly: true };
  if (EDGE_SHORTHAND.test(prop)) return { kind: 'edge', colourOnly: false };
  return null;
}

/** Pure: css text in, every colour usage of the sheet out (custom-property definitions are the palette, not usages). A
 *  colour-bearing declaration's value is read in three parts: `var(--review-*)` and hex/rgb()/hsl() literals are usages the
 *  census can judge; whatever else is left is an `unclassified` usage when it could be a colour nothing measures (any other
 *  `var(`, a named colour, `transparent`, `currentcolor`; and for a bare-colour property, anything but a non-colour keyword). */
function usagesOf(text: string): Usage[] {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Usage[] = [];
  for (const m of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? '').trim().replace(/\s+/g, ' ');
    if (selector === '' || selector.startsWith('@')) continue;
    for (const decl of (m[2] ?? '').split(';')) {
      const at = decl.indexOf(':');
      if (at < 0) continue;
      const prop = decl.slice(0, at).trim().toLowerCase();
      const value = decl.slice(at + 1).replace(/!\s*important/i, '').trim();
      if (prop.startsWith('--')) continue;
      const c = classify(prop);
      if (c === null) continue;
      const { kind } = c;
      for (const v of value.matchAll(/var\((--review-[\w-]+)\)/g)) out.push({ selector, prop, kind, value: v[1] as string, literal: false });
      for (const l of value.matchAll(LITERAL)) out.push({ selector, prop, kind, value: l[0].toLowerCase(), literal: true });
      const rest = value.replace(/var\(--review-[\w-]+\)/g, ' ').replace(LITERAL, ' ').trim().toLowerCase();
      let odd: string | null = null;
      if (c.colourOnly) {
        if (rest !== '' && !NON_COLOUR_KEYWORDS.has(rest)) odd = rest;
      } else {
        const words = rest.match(/[a-z][a-z-]*/g) ?? [];
        const named = words.find((w) => NAMED_COLOURS.has(w));
        if (rest.includes('var(')) odd = rest;
        else if (named !== undefined) odd = named;
      }
      if (odd !== null) out.push({ selector, prop, kind: 'unclassified', value: odd, literal: false });
    }
  }
  return out;
}

/** Pure: css text in, the usages nothing measures out, each as a readable line. Empty means the sheet is fully accounted for. */
function unmeasured(text: string): string[] {
  const textFg = new Set(PAIRS.filter((p) => p.floor === TEXT_FLOOR).map((p) => p.fg));
  const grounds = new Set(PAIRS.map((p) => p.bg));
  // An edge is the pair's foreground: the border or ring colour is what is measured against the ground.
  const uiVars = new Set(PAIRS.filter((p) => p.floor === UI_FLOOR).map((p) => p.fg));
  const lines: string[] = [];
  for (const u of usagesOf(text)) {
    const where = `${u.selector} { ${u.prop}: ${u.value} }`;
    if (u.kind === 'unclassified') {
      lines.push(`${where}: a colour value the census cannot classify (a named colour, transparent, currentcolor or a variable outside --review-*)`);
    } else if (u.literal) {
      if (LITERAL_EXCEPTIONS[`${u.selector} | ${u.prop}`] === undefined) lines.push(`${where}: a literal colour with no named exception`);
    } else if (u.kind === 'text') {
      if (!textFg.has(u.value)) lines.push(`${where}: not the foreground of any TEXT_FLOOR pair`);
    } else if (u.kind === 'ground') {
      if (!grounds.has(u.value)) lines.push(`${where}: not the ground of any pair`);
    } else if (u.kind === 'shadow') {
      // No exception applies to a shadow: the decorative-edge reason is about a border, and a shadow can carry a cue alone.
      if (!uiVars.has(u.value)) lines.push(`${where}: a shadow colour in no UI_FLOOR pair`);
    } else if (!uiVars.has(u.value) && EDGE_EXCEPTIONS[u.value] === undefined) {
      lines.push(`${where}: an edge in no UI_FLOOR pair and no named exception`);
    }
  }
  return lines;
}

describe("the draft review page's own pairs (separate document, its own palette)", () => {
  it('the census: every colour the sheet paints is a measured pair or a named, reasoned exception', () => {
    expect(unmeasured(css)).toEqual([]);
    // Not vacuous: it found text, grounds, edges and the literals the exception list names.
    const found = usagesOf(css);
    for (const kind of ['text', 'ground', 'edge'] as const) expect(found.some((u) => u.kind === kind), kind).toBe(true);
    // Every exception is used (none is stale), and carries a real reason.
    for (const k of Object.keys(LITERAL_EXCEPTIONS)) {
      expect(found.some((u) => u.literal && `${u.selector} | ${u.prop}` === k), `stale literal exception ${k}`).toBe(true);
      expect(LITERAL_EXCEPTIONS[k]?.length, k).toBeGreaterThan(40);
    }
    for (const k of Object.keys(EDGE_EXCEPTIONS)) {
      expect(found.some((u) => !u.literal && u.kind === 'edge' && u.value === k), `stale edge exception ${k}`).toBe(true);
    }
  });

  it('a colour rule added to the sheet and measured by nothing is reported', () => {
    for (const rule of [
      '.review-x { color: var(--review-line); }',
      '.review-x { background: var(--review-line); }',
      '.review-x { border: 1px solid var(--review-muted); }',
      '.review-x { outline-color: var(--review-bg); }',
      '.review-x { background-color: #123456; }',
      '.review-x { color: rgb(1, 2, 3); }',
      '.review-x { color: white; }',
      '.review-x { background: transparent; }',
      '.review-x { background-color: currentColor; }',
      '.review-x { color: var(--ink-primary); }',
      '.review-x { border: 1px solid var(--ink-primary); }',
      '.review-x { fill: red; }',
      '.review-x { box-shadow: 0 0 0 2px var(--review-line); }',
    ]) {
      const lines = unmeasured(`${css}\n${rule}`);
      expect(lines.length, rule).toBeGreaterThan(0);
      expect(lines.every((l) => l.startsWith('.review-x {')), rule).toBe(true);
    }
    // A rule that only reuses a measured colour passes.
    expect(unmeasured(`${css}\n.review-x { color: var(--review-fg); background: var(--review-banner-bg); }`)).toEqual([]);
    // Declarations that set no colour are not flagged: widths, radii, offsets, `none` and a zero border.
    expect(unmeasured(`${css}\n.review-x { border: 0; outline: none; border-width: 2px; border-radius: 8px; outline-offset: 2px; box-shadow: none; fill: none; }`)).toEqual([]);
  });

  it('both blocks are found and each defines every variable the pairs use', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const theme = blockOf(css, scheme);
      expect(theme, `${scheme} block`).not.toBeNull();
      expect(Object.keys(theme ?? {}), scheme).toEqual(expect.arrayContaining(VARS));
    }
    expect(PAIRS.length, 'the row measures something').toBeGreaterThan(8);
    // The dark block differs from the light one, so the two reads are not the same block twice.
    expect(blockOf(css, 'dark')).not.toEqual(blockOf(css, 'light'));
  });

  it('every pair holds its floor in the light scheme and in the dark one', () => {
    expect(measure(css)).toEqual([]);
  });

  it('a light pair pushed under its floor goes red, naming the pair', () => {
    const mutated = css.replace('--review-muted: #4d5551;', '--review-muted: #d0d4d1;');
    expect(mutated, 'the mutation changed the sheet').not.toBe(css);
    const failures = measure(mutated);
    expect(failures.some((f) => f.startsWith('light links heading, lab caption: muted on bg'))).toBe(true);
    expect(failures.some((f) => f.startsWith('dark '))).toBe(false);
  });

  it('a dark pair pushed under its floor goes red, naming the pair', () => {
    const mutated = css.replace('--review-accent: #7bd4a6;', '--review-accent: #2a3a31;');
    expect(mutated, 'the mutation changed the sheet').not.toBe(css);
    const failures = measure(mutated);
    expect(failures.some((f) => f.startsWith('dark button text, links: accent on bg'))).toBe(true);
    expect(failures.some((f) => f.startsWith('light '))).toBe(false);
  });

  it('a missing block or variable is a failure, not a pass', () => {
    expect(measure(css.replace('--review-banner-bg: #151a17;', '')).some((f) => f.startsWith('dark ') && f.includes('not defined'))).toBe(true);
    expect(measure('body { color: red; }').length).toBeGreaterThan(0);
  });
});
