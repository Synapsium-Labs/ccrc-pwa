// THE IDENTITY CORE'S TOKEN GUARD (D-5094).
//
// One identity is fixed across skins (spec §3.1): the `❯ ccrc` wordmark and
// caret, the phosphor accent, glow-means-life, lamp dots that pair a glyph and
// a word, dark wells, the Geist pair, the lane hues, the twelve palettes, the
// rule of voice and the accessibility floors. A skin varies density, structure
// and chrome, and it reaches the page through exactly two channels (§4.4): the
// token channel, `ui/src/styles/skins.css`, and from W2 its own components.
// This file is the token channel's wall, plus the three censuses that keep the
// skin out of everything else. The element half (`skin-boundary.test.ts`)
// lands with W2's shells and cites the same number.
//
// WHY A WALL AND NOT A REVIEW NOTE. A skin block is (0,2,0) and outranks every
// palette, so one colour in it makes the contrast gate's verdict false for one
// skin while the gate stays green, because the gate measures each palette once.
// A `--dur-*` outside `no-preference` outranks `:root`'s reduced-motion block
// and re-animates the app for a reader who asked for stillness. A dense row
// outside `(pointer: fine)` puts 32px targets under a thumb. Each of those
// renders, compiles and passes every other suite.
//
// THE RULES, one describe each:
//   (a)  every declaration sits in a `:root[data-skin='<id>']` block, optionally
//        inside @media, for a non-default skin in SKINS;
//   (b)  every declared property is a SKIN_TOKENS member;
//   (c)  every member has a default in tokens.css's top-level `:root`;
//   (d)  no colour literal;
//   (d2) no colour by reference: every var() inside its class's allowlist, and
//        no currentColor;
//   (e)  choose, never mint: a type role names a step of its own scale, in
//        skins.css and in Refined's own `:root` (D-5243);
//   (f)  motion only under `prefers-reduced-motion: no-preference`;
//   (f2) the tap floor: no tap-bearing token below --tap-min outside
//        `(pointer: fine)`, in skins.css or in tokens.css (D-5243);
//   (g)  no palette block declares a skin token of a class it does not share;
//   (h)  no !important;
//   (i)  the contrast gate's stylesheet walk lists skins.css by its exact path;
//   (j)  the scan sees something;
// and three censuses: (k) `data-skin` in stylesheets, (l) the skin attribute in
// source, (m) `useSkin`, with (n) their own vacuity check.
//
// EVERY RULE IS SHOWN LIVE. Each is run against the real tree and against a
// planted copy (`plantedTree()`: ui/src, ui/.storybook, pwa/src, pwa/index.html
// and pwa/design, copied to a temp dir and then edited). Each planted case names
// the sentence the rule must produce for it. These planted cases are the
// in-suite half of the mutation table. The PR records the half that mutates
// this file's own predicates.
//
// A 30 s TIMEOUT ON EVERY BLOCK, for `audit-refusals.test.ts`'s reason: each
// planted case copies about 270 files, and the default 5 s assumes a unit test.
import { afterEach, describe, expect, it } from 'vitest';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PHOSPHOR, REFINED, SKINS, SKIN_TOKENS, THEMES, type SkinToken, type SkinTokenClass,
} from '@ccrc/ui';
import { stylesheets } from '../design/audit.mjs';

const REPO = path.join(import.meta.dirname, '..', '..');
const SKINS_CSS = 'ui/src/styles/skins.css';
const TOKENS_CSS = 'ui/src/styles/tokens.css';

// ── the catalogue, as the guard reads it ───────────────────────────────────

type Tokens = { readonly [C in SkinTokenClass]: readonly SkinToken[] };

interface Catalogue {
  /** The skins that own a block: every id in SKINS but the default. */
  readonly ids: readonly string[];
  readonly tokens: Tokens;
}

/** The catalogue is passed in, never read inside a check, so a planted case
 *  can add a member without editing the real module. */
const REAL: Catalogue = {
  ids: SKINS.map((s) => s.id).filter((id) => id !== REFINED),
  tokens: SKIN_TOKENS,
};

const CLASSES = Object.keys(SKIN_TOKENS) as SkinTokenClass[];

const classOf = (cat: Catalogue, prop: string): SkinTokenClass | undefined =>
  CLASSES.find((c) => cat.tokens[c].some((t) => t.name === prop));

const memberNames = (cat: Catalogue): Set<string> =>
  new Set(CLASSES.flatMap((c) => cat.tokens[c].map((t) => t.name)));

/** WHAT A SKIN VALUE MAY REFER TO, by class (D-5094, spec §3.2). The rule is
 *  this guard's own statement, so it lives here and not in skins.ts: a list
 *  that the guarded file could widen would guard nothing. skins.ts documents
 *  the same rule beside each class. */
const VAR_ALLOWLIST: { readonly [C in SkinTokenClass]: readonly (string | RegExp)[] } = {
  // Elevation carries shadow colour, so it is the one class that may name a
  // colour token, and only the two hairlines: depth comes from an edge, never
  // from a glow (glow means life, and only busy and attention emit light).
  elevation: ['--edge-subtle', '--edge-strong'],
  type: [/^--fs-/, /^--ls-/, /^--weight-/, '--family-ui', '--family-mono'],
  density: [/^--sp-/],
  // Lengths, counts and durations. Nothing to refer to.
  radius: [],
  meter: [],
  motion: [],
};

const allowedVar = (cls: SkinTokenClass | undefined, name: string): boolean =>
  cls !== undefined && VAR_ALLOWLIST[cls].some((a) => (typeof a === 'string' ? a === name : a.test(name)));

/** Every CSS named colour (CSS Color 4), `transparent`, and the system colours,
 *  deprecated ones included, since a browser still paints them. `currentColor`
 *  is deliberately NOT here: it has its own check (d2), and a second copy would
 *  let either check be deleted unnoticed. */
const NAMED_COLOURS: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black',
  'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse',
  'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue', 'darkcyan',
  'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise',
  'mediumvioletred', 'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen',
  'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum',
  'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue',
  'slategray', 'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato',
  'turquoise', 'violet', 'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
  'transparent',
  'accentcolor', 'accentcolortext', 'activetext', 'buttonborder', 'buttonface', 'buttontext',
  'canvas', 'canvastext', 'field', 'fieldtext', 'graytext', 'highlight', 'highlighttext',
  'linktext', 'mark', 'marktext', 'selecteditem', 'selecteditemtext', 'visitedtext',
  'activeborder', 'activecaption', 'appworkspace', 'background', 'buttonhighlight',
  'buttonshadow', 'captiontext', 'inactiveborder', 'inactivecaption', 'inactivecaptiontext',
  'infobackground', 'infotext', 'menu', 'menutext', 'scrollbar', 'threeddarkshadow',
  'threedface', 'threedhighlight', 'threedlightshadow', 'threedshadow', 'window', 'windowframe',
  'windowtext',
]);

// ── reading a stylesheet ────────────────────────────────────────────────────

const read = (tree: string, rel: string): string => readFileSync(path.join(tree, rel), 'utf8');

/** Comments blanked, as `design/audit.mjs`'s `readCss` does: a comment is
 *  never a declaration, and skins.css's own header names the hazards it
 *  guards against. */
const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

const squash = (s: string): string => s.trim().replace(/\s+/g, ' ');

interface Decl {
  readonly prop: string;
  readonly value: string;
  /** Every enclosing prelude, outermost first: `['@media (pointer: fine)',
   *  ":root[data-skin='instrument']"]`. */
  readonly chain: readonly string[];
}

interface Parsed {
  readonly decls: readonly Decl[];
  /** Every block's chain, its own prelude last. */
  readonly chains: readonly (readonly string[])[];
  /** Statements outside every block (an `@import`, a bare declaration). */
  readonly stray: readonly string[];
}

/** A brace walk, not a lazy regex: a regex stops at a nested rule's closing
 *  brace and sees half a media block. Quotes and parentheses are tracked, so
 *  a `;` inside either never splits a declaration. Unbalanced braces throw,
 *  which reds the case that read the file. */
function parseCss(text: string): Parsed {
  const src = stripCss(text);
  const decls: Decl[] = [];
  const chains: string[][] = [];
  const stray: string[] = [];
  const stack: string[] = [];
  let buf = '';
  let paren = 0;
  let quote = '';
  const flush = (): void => {
    const t = squash(buf);
    buf = '';
    if (t === '') return;
    if (stack.length === 0) {
      stray.push(t);
      return;
    }
    const colon = t.indexOf(':');
    decls.push(colon < 0
      ? { prop: t, value: '', chain: [...stack] }
      : { prop: t.slice(0, colon).trim(), value: t.slice(colon + 1).trim(), chain: [...stack] });
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i] as string;
    if (quote !== '') {
      buf += c;
      if (c === '\\') buf += src[(i += 1)] ?? '';
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    if (paren > 0) {
      buf += c;
      continue;
    }
    if (c === '{') {
      stack.push(squash(buf));
      chains.push([...stack]);
      buf = '';
    } else if (c === '}') {
      flush();
      if (stack.pop() === undefined) throw new Error('an unbalanced } in the stylesheet');
    } else if (c === ';') {
      flush();
    } else {
      buf += c;
    }
  }
  flush();
  if (stack.length > 0) throw new Error(`an unclosed { after "${stack.join(' { ')}"`);
  return { decls, chains, stray };
}

const sheet = (tree: string, rel: string): Parsed => parseCss(read(tree, rel));

const chainText = (chain: readonly string[]): string => (chain.length === 0 ? 'no block' : chain.join(' { '));

const isMedia = (prelude: string): boolean => /^@media\b/i.test(prelude);

/** The id a `:root[data-skin='<id>']` prelude names, in any quote style a
 *  formatter may write, or undefined when the prelude is anything else
 *  (a descendant, a list, a different element). */
function skinIdOf(prelude: string): string | undefined {
  const m = /^:root\[data-skin=(['"]?)([\w-]+)\1\]$/i.exec(prelude.replace(/\s+/g, ''));
  return m?.[2];
}

const isSkinBlock = (cat: Catalogue, prelude: string): boolean => {
  const id = skinIdOf(prelude);
  return id !== undefined && cat.ids.includes(id);
};

/** Whether an `@media` prelude REQUIRES `feature`: the feature is one of its
 *  `and` conjuncts, so the block can never apply without it. A comma (or), an
 *  `or`, or a `not` could let it apply without the feature, so any of those
 *  fails, toward the safe side. `feature` is spelled without spaces. */
function mediaRequires(prelude: string, feature: string): boolean {
  const m = /^@media\s+([\s\S]*)$/i.exec(prelude);
  if (m === null) return false;
  const query = (m[1] ?? '').toLowerCase();
  if (/,|\bnot\b|\bor\b/.test(query)) return false;
  return query.split(/\band\b/).some((part) => part.replace(/\s+/g, '') === feature);
}

const NO_PREFERENCE = '(prefers-reduced-motion:no-preference)';
const FINE_POINTER = '(pointer:fine)';

/** The top-level `:root` block's declarations: the defaults every role and
 *  scale step resolves to. Media-wrapped `:root` blocks are not defaults. */
function rootValues(tree: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const d of sheet(tree, TOKENS_CSS).decls) {
    if (d.chain.length === 1 && (d.chain[0] ?? '').toLowerCase() === ':root') out.set(d.prop, d.value);
  }
  return out;
}

/** `:root`, at the top level or inside @media only: where a role's value is
 *  set for Refined. */
const isRootChain = (chain: readonly string[]): boolean =>
  chain.length > 0
  && (chain[chain.length - 1] ?? '').toLowerCase() === ':root'
  && chain.slice(0, -1).every(isMedia);

/** A value in px: a literal, or a var() that resolves through `:root` to one.
 *  Anything else (calc, rem, a missing token) is null: unmeasurable. */
function px(value: string, root: ReadonlyMap<string, string>, depth = 0): number | null {
  const v = value.trim();
  const lit = /^(\d+(?:\.\d+)?)px$/i.exec(v);
  if (lit !== null) return Number(lit[1]);
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(v);
  if (ref === null || depth > 8) return null;
  const next = root.get(ref[1] ?? '');
  return next === undefined ? null : px(next, root, depth + 1);
}

// ── the rules ───────────────────────────────────────────────────────────────

/** (a) */
function blockShape(tree: string, cat: Catalogue): string[] {
  const css = sheet(tree, SKINS_CSS);
  const out: string[] = [];
  for (const chain of css.chains) {
    const last = chain.length - 1;
    if (!chain.every((p, i) => isMedia(p) || (i === last && isSkinBlock(cat, p)))) {
      out.push(`skins.css: "${chainText(chain)}" is neither @media nor a :root[data-skin='<id>'] block for a skin in SKINS`);
    }
  }
  for (const d of css.decls) {
    if (!isSkinBlock(cat, d.chain[d.chain.length - 1] ?? '')) {
      out.push(`skins.css: ${d.prop} sits outside a :root[data-skin='<id>'] block (in "${chainText(d.chain)}")`);
    }
  }
  for (const s of css.stray) out.push(`skins.css: "${s}" stands outside every block`);
  return out;
}

/** (b) */
function membership(tree: string, cat: Catalogue): string[] {
  const names = memberNames(cat);
  return sheet(tree, SKINS_CSS).decls
    .filter((d) => !names.has(d.prop))
    .map((d) => `skins.css: ${d.prop} is not a SKIN_TOKENS member`);
}

/** (c) */
function defaults(tree: string, cat: Catalogue): string[] {
  const root = rootValues(tree);
  return [...memberNames(cat)]
    .filter((name) => !root.has(name))
    .map((name) => `tokens.css: ${name} is a SKIN_TOKENS member with no default in the top-level :root block`);
}

/** Every colour literal in one value: hex, a colour function, a named colour.
 *  An identifier counts only standing alone, never inside a custom property's
 *  name (`--edge-strong`) or as a function's name. */
function colourLiteralsIn(value: string): string[] {
  const hits: string[] = [];
  for (const m of value.matchAll(/#[0-9a-f]{3,8}\b/gi)) hits.push(m[0]);
  for (const m of value.matchAll(
    /(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|device-cmyk)\s*\(/gi,
  )) hits.push(`${m[1] ?? ''}()`);
  for (const m of value.matchAll(/(?<![\w-])([a-z]+)(?![\w(-])/gi)) {
    const word = m[1] ?? '';
    if (NAMED_COLOURS.has(word.toLowerCase())) hits.push(word);
  }
  return hits;
}

/** (d) */
function colourLiterals(tree: string): string[] {
  const css = sheet(tree, SKINS_CSS);
  const out: string[] = [];
  for (const d of css.decls) {
    for (const hit of colourLiteralsIn(d.value)) out.push(`skins.css: ${d.prop}: ${d.value} carries the colour literal ${hit}`);
  }
  for (const s of css.stray) {
    for (const hit of colourLiteralsIn(s)) out.push(`skins.css: "${s}" carries the colour literal ${hit}`);
  }
  return out;
}

/** (d2) */
function colourByReference(tree: string, cat: Catalogue): string[] {
  const out: string[] = [];
  for (const d of sheet(tree, SKINS_CSS).decls) {
    const cls = classOf(cat, d.prop);
    for (const m of d.value.matchAll(/(?<![\w-])var\(\s*(--[\w-]+)/gi)) {
      const name = m[1] ?? '';
      if (!allowedVar(cls, name)) {
        out.push(`skins.css: ${d.prop} (${cls ?? 'no class'}) reads var(${name}), outside its class's allowlist`);
      }
    }
    if (/currentcolor/i.test(d.value)) out.push(`skins.css: ${d.prop}: ${d.value} names currentColor`);
  }
  return out;
}

const FAMILY_PAIR: readonly string[] = ['var(--family-ui)', 'var(--family-mono)'];
const SCALE_PREFIXES: readonly string[] = ['--fs-', '--weight-', '--ls-'];

/** (e) Choose, never mint. A type role named on a scale (`--fs-*`,
 *  `--weight-*`, `--ls-*`) is exactly `var()` of a STEP of that scale: a token
 *  `:root` declares that is not itself a skin token, so a role cannot point at
 *  another role and inherit a value nobody chose. A family role is one of the
 *  Geist pair. Judged in every block of skins.css and in every `:root` block
 *  of tokens.css, top level or inside @media alike, because Refined's values
 *  are roles too.
 *
 *  D-5243: the plan's (e) and spec §3.2 read skins.css and name the `--fs-*`
 *  roles only. This rule also judges Refined's `:root` values, covers the
 *  `--weight-*` and `--ls-*` roles, and refuses a role pointed at a role. */
function scaleChoice(tree: string, cat: Catalogue): string[] {
  const root = rootValues(tree);
  const members = memberNames(cat);
  const out: string[] = [];
  const judge = (file: string, d: Decl): void => {
    if (classOf(cat, d.prop) !== 'type') return;
    if (d.prop.startsWith('--family-')) {
      if (!FAMILY_PAIR.includes(d.value.replace(/\s+/g, ''))) {
        out.push(`${file}: ${d.prop}: ${d.value} is neither var(--family-ui) nor var(--family-mono)`);
      }
      return;
    }
    const prefix = SCALE_PREFIXES.find((p) => d.prop.startsWith(p));
    if (prefix === undefined) return; // `--case-section`: a keyword, with no scale to choose from
    const target = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(d.value)?.[1];
    if (target === undefined || !target.startsWith(prefix) || !root.has(target) || members.has(target)) {
      out.push(`${file}: ${d.prop}: ${d.value} is not var() of a step on the ${prefix}* scale`);
    }
  };
  for (const d of sheet(tree, SKINS_CSS).decls) judge('skins.css', d);
  for (const d of sheet(tree, TOKENS_CSS).decls) if (isRootChain(d.chain)) judge('tokens.css', d);
  return out;
}

const isMotion = (cat: Catalogue, prop: string): boolean =>
  prop.startsWith('--dur-') || classOf(cat, prop) === 'motion';

/** (f) */
function motionScope(tree: string, cat: Catalogue): string[] {
  return sheet(tree, SKINS_CSS).decls
    .filter((d) => isMotion(cat, d.prop) && !d.chain.some((p) => mediaRequires(p, NO_PREFERENCE)))
    .map((d) => `skins.css: ${d.prop} is declared outside @media (prefers-reduced-motion: no-preference) (in "${chainText(d.chain)}")`);
}

const tapBearing = (cat: Catalogue): Set<string> =>
  new Set(CLASSES.flatMap((c) => cat.tokens[c].filter((t) => t.tapBearing === true).map((t) => t.name)));

/** (f2) Read from both files: Refined's `:root` value is a tap target too.
 *  D-5243: the plan's (f2) reads skins.css only; tokens.css is judged too. */
function tapFloor(tree: string, cat: Catalogue): string[] {
  const root = rootValues(tree);
  const floor = px(root.get('--tap-min') ?? '', root);
  if (floor === null) return ['tokens.css: --tap-min is not a px length, so no row can be held to it'];
  const bearing = tapBearing(cat);
  const out: string[] = [];
  for (const [file, rel] of [['skins.css', SKINS_CSS], ['tokens.css', TOKENS_CSS]] as const) {
    for (const d of sheet(tree, rel).decls) {
      if (!bearing.has(d.prop) || d.chain.some((p) => mediaRequires(p, FINE_POINTER))) continue;
      const v = px(d.value, root);
      if (v === null) {
        out.push(`${file}: ${d.prop}: ${d.value} cannot be measured against --tap-min, outside @media (pointer: fine)`);
      } else if (v < floor) {
        out.push(`${file}: ${d.prop}: ${d.value} is below --tap-min (${floor}px) outside @media (pointer: fine)`);
      }
    }
  }
  return out;
}

/** (g) Elevation is the one class a palette shares with a skin: its values
 *  carry shadow colour, so every palette declares `--elev-card` itself. */
function paletteBlocks(tree: string, cat: Catalogue): string[] {
  const out: string[] = [];
  for (const d of sheet(tree, TOKENS_CSS).decls) {
    const palette = d.chain.find((p) => /\[data-theme\b/i.test(p));
    if (palette === undefined) continue;
    const cls = classOf(cat, d.prop);
    if (cls !== undefined && cls !== 'elevation') out.push(`tokens.css: ${palette} declares ${d.prop}, a ${cls} skin token`);
  }
  return out;
}

/** (h) */
function important(tree: string): string[] {
  const n = [...stripCss(read(tree, SKINS_CSS)).matchAll(/!\s*important/gi)].length;
  return n === 0 ? [] : [`skins.css carries !important (${n})`];
}

/** (i) The gate's own walk, its own export, compared as a repo-relative path
 *  and never as a basename: a skins.css somewhere else is not the file the
 *  guard reads. */
function walkLists(tree: string): string[] {
  const pwa = path.join(tree, 'pwa');
  const listed = stylesheets(pwa).map((rel) => path.relative(tree, path.join(pwa, rel)).split(path.sep).join('/'));
  return listed.includes(SKINS_CSS)
    ? []
    : [`design/audit.mjs's stylesheet walk does not list ${SKINS_CSS}, so the contrast gate would not measure a rule planted there`];
}

// ── the censuses ────────────────────────────────────────────────────────────

interface Census {
  readonly problems: readonly string[];
  /** Every file the census read, for (n). */
  readonly read: readonly string[];
}

/** Every file under `root` whose name `keep` accepts, repo-relative, sorted. */
function filesUnder(tree: string, root: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(path.join(tree, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(rel);
      } else if (e.isFile() && keep(e.name)) {
        out.push(rel);
      }
    }
  };
  if (existsSync(path.join(tree, root))) walk(root);
  return out.sort();
}

/** Tests and stories are excluded: they stamp the attribute on purpose, to
 *  show a skin. */
const notTestOrStory = (name: string): boolean => !/\.(?:test|test-d|stories)\.[^.]+$/.test(name);

/** JS and TS with their comments blanked, and their strings, template
 *  literals and regex literals kept verbatim. Not a regex replace: the tree
 *  holds `'image/*'` and `/^\/*\/` (a string and a regex), and a bare
 *  block-comment regex opens a "comment" at either and swallows real code up
 *  to the next `*\/`, hiding whatever it holds. */
function stripJs(src: string): string {
  let out = '';
  let i = 0;
  let last = ''; // the last significant character of code
  const closes: number[] = []; // the brace depth each open `${` closes at
  let depth = 0;
  const regexMayStart = (): boolean =>
    last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last)
    || /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new|throw)$/.test(out.slice(-16).trimEnd());
  const template = (): void => {
    while (i < src.length) {
      const c = src[i] as string;
      if (c === '\\') {
        out += src.slice(i, i + 2);
        i += 2;
      } else if (c === '`') {
        out += c;
        i += 1;
        last = c;
        return;
      } else if (c === '$' && src[i + 1] === '{') {
        out += '${';
        i += 2;
        closes.push(depth);
        depth += 1;
        last = '{';
        return;
      } else {
        out += c;
        i += 1;
      }
    }
  };
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      last = c;
    } else if (c === '`') {
      out += c;
      i += 1;
      template();
    } else if (c === '/' && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        const r = src[j];
        if (r === '\\') {
          j += 2;
          continue;
        }
        if (r === '[') inClass = true;
        else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
        j += 1;
      }
      out += src.slice(i, j + 1);
      i = j + 1;
      last = '/';
    } else {
      if (c === '{') depth += 1;
      if (c === '}') {
        depth -= 1;
        if (closes.length > 0 && closes[closes.length - 1] === depth) {
          closes.pop();
          out += c;
          i += 1;
          template();
          continue;
        }
      }
      out += c;
      i += 1;
      if (!/\s/.test(c)) last = c;
    }
  }
  return out;
}

/** HTML with its `<!-- -->` comments removed, by index rather than by regex.
 *  JS comments inside an inline script are left in: a mention there counts,
 *  which errs toward red. */
function stripHtmlComments(src: string): string {
  let out = '';
  let i = 0;
  for (;;) {
    const open = src.indexOf('<!--', i);
    if (open < 0) return out + src.slice(i);
    out += src.slice(i, open);
    const close = src.indexOf('-->', open + 4);
    if (close < 0) return out;
    i = close + 3;
  }
}

const sourceText = (tree: string, rel: string): string =>
  (rel.endsWith('.html') ? stripHtmlComments(read(tree, rel)) : stripJs(read(tree, rel)));

/** (k) The registry: the one stylesheet a skin may select on. Both ways. */
const SHEET_REGISTRY: readonly string[] = [SKINS_CSS];
const SHEET_ROOTS: readonly string[] = ['pwa/src', 'ui/src'];

function sheetCensus(tree: string, registry: readonly string[] = SHEET_REGISTRY): Census {
  const files = SHEET_ROOTS.flatMap((root) => filesUnder(tree, root, (n) => n.endsWith('.css')));
  // Case-insensitive: an HTML attribute selector matches `[DATA-SKIN]` too.
  const hits = files.filter((f) => /data-skin/i.test(stripCss(read(tree, f))));
  return {
    problems: [
      ...hits.filter((f) => !registry.includes(f)).map((f) => `${f} selects on data-skin: only skins.css may`),
      ...registry.filter((f) => !hits.includes(f)).map((f) => `${f} is registered for data-skin but names none`),
    ],
    read: files,
  };
}

/** (l) The registry: the files that may reach the attribute. ONE way: a
 *  registered file with no hit is not red, because `pwa/src/lib/skin.ts`
 *  reaches the attribute only through `applySkin`. A registered path that no
 *  longer exists is red. */
const SOURCE_REGISTRY: readonly string[] = ['ui/src/styles/skins.ts', 'pwa/src/lib/skin.ts', 'pwa/index.html'];
const SOURCE_ROOTS: readonly string[] = ['pwa/src', 'ui/src', 'ui/.storybook'];
const SOURCE_FILES: readonly string[] = ['pwa/index.html'];

const SKIN_ATTRIBUTE: readonly (readonly [spelling: string, re: RegExp])[] = [
  ['data-skin', /data-skin/i],
  ['dataset.skin', /\bdataset\s*(?:\?\.|\.)\s*skin\b/],
  ["dataset['skin']", /\bdataset\s*(?:\?\.)?\s*\[\s*(['"`])skin\1\s*\]/],
];

const isSource = (name: string): boolean => /\.(?:tsx?|jsx?|mjs|cjs|html)$/.test(name) && notTestOrStory(name);

function sourceCensus(tree: string, registry: readonly string[] = SOURCE_REGISTRY): Census {
  const files = [
    ...SOURCE_ROOTS.flatMap((root) => filesUnder(tree, root, isSource)),
    ...SOURCE_FILES.filter((f) => existsSync(path.join(tree, f))),
  ];
  const problems: string[] = [];
  for (const f of files) {
    if (registry.includes(f)) continue;
    const text = sourceText(tree, f);
    for (const [spelling, re] of SKIN_ATTRIBUTE) {
      if (re.test(text)) problems.push(`${f} reaches the skin attribute (${spelling}) outside the registry`);
    }
  }
  for (const f of registry) if (!existsSync(path.join(tree, f))) problems.push(`${f} is registered but does not exist`);
  return { problems, read: files };
}

/** (m) The registry: the files that may reach `useSkin`. Empty in W0; Task 12b
 *  adds the picker and W2 adds `app.tsx`'s one branch and the skin
 *  directories. Both ways. The hook's own file is its definition, not a
 *  caller. Any mention counts, a call or an import, so an aliased import
 *  (`useSkin as useLayout`) is seen too. */
const HOOK_REGISTRY: readonly string[] = [];
const HOOK_DEFINITION = 'pwa/src/lib/skin.ts';

function hookCensus(tree: string, registry: readonly string[] = HOOK_REGISTRY): Census {
  const files = filesUnder(tree, 'pwa/src', (n) => /\.(?:tsx?|jsx?|mjs)$/.test(n) && notTestOrStory(n));
  const callers = files.filter((f) => f !== HOOK_DEFINITION && /\buseSkin\b/.test(stripJs(read(tree, f))));
  return {
    problems: [
      ...callers.filter((f) => !registry.includes(f)).map((f) => `${f} reaches useSkin outside the registry`),
      ...registry.filter((f) => !callers.includes(f)).map((f) => `${f} is registered for useSkin but never reaches it`),
    ],
    read: files,
  };
}

// ── planted copies ─────────────────────────────────────────────────────────

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

const PLANTED: readonly string[] = ['ui/src', 'ui/.storybook', 'pwa/src', 'pwa/index.html', 'pwa/design'];

/** A copy of everything this guard reads, at the same repo-relative paths. */
function plantedTree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'skin-identity-'));
  made.push(dir);
  for (const rel of PLANTED) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(path.join(REPO, rel), dest, { recursive: true });
  }
  return dir;
}

/** Rewrite one file in the copy, refusing a plant that changed nothing: a
 *  missed anchor would turn a planted case into a vacuous one. */
function plant(tree: string, rel: string, fn: (s: string) => string): string {
  const p = path.join(tree, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`the plant in ${rel} changed nothing: its anchor moved`);
  writeFileSync(p, after);
  return tree;
}

const append = (tree: string, rel: string, text: string): string => plant(tree, rel, (s) => `${s}\n${text}\n`);

/** One replacement, and only where the anchor is: a regex that matched twice
 *  would plant in a block the case is not about. */
function replaceOnce(tree: string, rel: string, from: string, to: string): string {
  return plant(tree, rel, (s) => {
    if (s.split(from).length !== 2) throw new Error(`"${from}" is not exactly once in ${rel}`);
    return s.replace(from, to);
  });
}

/** Instrument's bare block, by its exact text: the plant lands there and
 *  nowhere else. */
const INSTRUMENT_BLOCK = ":root[data-skin='instrument'] {\n  /* type";

/** Instrument's block inside its ≥900px width query, by its exact text. */
const INSTRUMENT_WIDE_BLOCK = "@media (min-width: 900px) {\n  :root[data-skin='instrument'] {";

// ── the token channel ───────────────────────────────────────────────────────

describe('(a) every declaration sits in a skin block', () => {
  it('holds on the tree', () => {
    expect(blockShape(REPO, REAL)).toEqual([]);
  });

  it('reds a bare rule, a refined block and an @supports wrapper planted in skins.css', () => {
    const bare = append(plantedTree(), SKINS_CSS, '.x { --r-md: 1px }');
    expect(blockShape(bare, REAL)).toContain('skins.css: --r-md sits outside a :root[data-skin=\'<id>\'] block (in ".x")');

    // Refined IS :root; a block of its own is not a block for a skin in SKINS'
    // non-default set.
    const refined = append(plantedTree(), SKINS_CSS, ":root[data-skin='refined'] { --r-md: 1px }");
    expect(blockShape(refined, REAL)).toContain(
      "skins.css: --r-md sits outside a :root[data-skin='<id>'] block (in \":root[data-skin='refined']\")");

    const supports = append(plantedTree(), SKINS_CSS,
      "@supports (display: grid) { :root[data-skin='instrument'] { --r-md: 1px } }");
    expect(blockShape(supports, REAL)).toContain(
      "skins.css: \"@supports (display: grid) { :root[data-skin='instrument']\" is neither @media nor a :root[data-skin='<id>'] block for a skin in SKINS");
  });

  it('reds a declaration planted at the top level, outside every block', () => {
    // No block encloses it, so it has no chain, and only the stray-statement
    // check sees it.
    const tree = append(plantedTree(), SKINS_CSS, '--r-md: 1px;');
    expect(blockShape(tree, REAL)).toEqual(['skins.css: "--r-md: 1px" stands outside every block']);
  });
}, 30_000);

describe('(b) every declared property is a SKIN_TOKENS member', () => {
  it('holds on the tree', () => {
    expect(membership(REPO, REAL)).toEqual([]);
  });

  it('reds a palette token and a plain property planted in the skin block', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, INSTRUMENT_BLOCK,
      ":root[data-skin='instrument'] {\n  --accent: inherit;\n  color: inherit;\n  /* type");
    const problems = membership(tree, REAL);
    expect(problems).toContain('skins.css: --accent is not a SKIN_TOKENS member');
    expect(problems).toContain('skins.css: color is not a SKIN_TOKENS member');
  });

  it("reds a palette token planted inside one of Instrument's @media blocks", () => {
    // Three of Instrument's four blocks sit inside @media (width, pointer,
    // motion), so the rule must read a nested block as closely as the bare one.
    const tree = replaceOnce(plantedTree(), SKINS_CSS, INSTRUMENT_WIDE_BLOCK,
      `${INSTRUMENT_WIDE_BLOCK}\n    --accent: inherit;`);
    expect(membership(tree, REAL)).toEqual(['skins.css: --accent is not a SKIN_TOKENS member']);
  });
}, 30_000);

describe('(c) every SKIN_TOKENS member has a :root default in tokens.css', () => {
  it('holds on the tree', () => {
    expect(defaults(REPO, REAL)).toEqual([]);
  });

  it('reds a default removed from :root, and a member added with none', () => {
    const removed = replaceOnce(plantedTree(), TOKENS_CSS,
      '  --gap-section: var(--sp-8);     /* between a page\'s sections */\n', '');
    expect(defaults(removed, REAL)).toEqual([
      'tokens.css: --gap-section is a SKIN_TOKENS member with no default in the top-level :root block']);

    const added: Catalogue = { ...REAL, tokens: { ...SKIN_TOKENS, density: [...SKIN_TOKENS.density, { name: '--nowhere' }] } };
    expect(defaults(REPO, added)).toEqual([
      'tokens.css: --nowhere is a SKIN_TOKENS member with no default in the top-level :root block']);
  });

  it('a default inside a width block is not a default', () => {
    // `--measure-chat` moved into the ≥1600 block only: a phone would read
    // the property unset.
    const tree = replaceOnce(plantedTree(), TOKENS_CSS,
      '  --measure-chat:  780px;         /* the transcript\'s reading column (820 at ≥1600) */\n', '');
    expect(defaults(tree, REAL)).toEqual([
      'tokens.css: --measure-chat is a SKIN_TOKENS member with no default in the top-level :root block']);
  });
}, 30_000);

describe('(d) skins.css holds no colour literal', () => {
  it('holds on the tree', () => {
    expect(colourLiterals(REPO)).toEqual([]);
  });

  it.each([
    ['a hex', '0 1px 2px #000', '#000'],
    ['a named colour', '0 1px 2px black', 'black'],
    ['rgba()', '0 1px 2px rgba(0, 0, 0, 0.3)', 'rgba()'],
    ['oklch()', '0 0 0 1px oklch(0.5 0.1 140)', 'oklch()'],
    ['color-mix()', '0 0 0 1px color-mix(in srgb, var(--edge-strong) 50%, white)', 'color-mix()'],
    ['transparent', '0 0 0 1px transparent', 'transparent'],
    ['a system colour', '0 0 0 1px CanvasText', 'CanvasText'],
  ])('reds %s planted as --elev-card', (_what, value, hit) => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;', `--elev-card: ${value};`);
    expect(colourLiterals(tree)).toContain(`skins.css: --elev-card: ${value} carries the colour literal ${hit}`);
  });

  it("reds a hex planted inside one of Instrument's @media blocks: a desktop-only shadow", () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, INSTRUMENT_WIDE_BLOCK,
      `${INSTRUMENT_WIDE_BLOCK}\n    --elev-card: 0 1px 2px #000;`);
    expect(colourLiterals(tree)).toEqual(['skins.css: --elev-card: 0 1px 2px #000 carries the colour literal #000']);
  });

  it('reads no colour into a token name, a keyword or a length', () => {
    // The real tree already holds `var(--edge-strong)`-shaped names in other
    // sheets; here, the words a skin value legitimately carries.
    expect(colourLiteralsIn('0 0 0 1px var(--edge-strong)')).toEqual([]);
    expect(colourLiteralsIn('uppercase')).toEqual([]);
    expect(colourLiteralsIn('var(--fs-2xs)')).toEqual([]);
    expect(colourLiteralsIn('tan(45deg)')).toEqual([]);
  });
}, 30_000);

describe('(d2) no colour by reference', () => {
  it('holds on the tree', () => {
    expect(colourByReference(REPO, REAL)).toEqual([]);
  });

  it('reds a glow on every card: --elev-card reading var(--accent)', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;', '--elev-card: 0 0 8px var(--accent);');
    expect(colourByReference(tree, REAL)).toContain(
      "skins.css: --elev-card (elevation) reads var(--accent), outside its class's allowlist");
  });

  it('reds --elev-card painted in currentColor', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;', '--elev-card: 0 0 0 1px currentColor;');
    expect(colourByReference(tree, REAL)).toContain('skins.css: --elev-card: 0 0 0 1px currentColor names currentColor');
  });

  it('reds a density role pointed at a floor: --gutter reading var(--tap-min)', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--gutter:      var(--sp-3);', '--gutter:      var(--tap-min);');
    expect(colourByReference(tree, REAL)).toContain(
      "skins.css: --gutter (density) reads var(--tap-min), outside its class's allowlist");
  });

  it('reds a var() in a class whose allowlist is empty, and in a fallback', () => {
    const radius = replaceOnce(plantedTree(), SKINS_CSS, '--r-sm: 3px;', '--r-sm: var(--sp-1);');
    expect(colourByReference(radius, REAL)).toContain(
      "skins.css: --r-sm (radius) reads var(--sp-1), outside its class's allowlist");
    const fallback = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;',
      '--elev-card: 0 0 0 1px var(--edge-strong, var(--accent));');
    expect(colourByReference(fallback, REAL)).toEqual([
      "skins.css: --elev-card (elevation) reads var(--accent), outside its class's allowlist"]);
  });

  it("reds a glow planted inside one of Instrument's @media blocks", () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, INSTRUMENT_WIDE_BLOCK,
      `${INSTRUMENT_WIDE_BLOCK}\n    --elev-card: 0 0 8px var(--accent);`);
    expect(colourByReference(tree, REAL)).toEqual([
      "skins.css: --elev-card (elevation) reads var(--accent), outside its class's allowlist"]);
  });

  it('passes the recipe the allowlist exists for: a hairline on var(--edge-strong)', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;', '--elev-card: 0 0 0 1px var(--edge-strong);');
    expect(colourByReference(tree, REAL)).toEqual([]);
    expect(colourLiterals(tree)).toEqual([]);
  });
}, 30_000);

describe('(e) type roles choose a step on their scale, and family roles one of the pair', () => {
  it('holds on the tree, in skins.css and in tokens.css', () => {
    expect(scaleChoice(REPO, REAL)).toEqual([]);
  });

  it('reds a minted size: --fs-ui: 13px', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--fs-ui:      var(--fs-base);      /* 15 below 900 */',
      '--fs-ui:      13px;');
    expect(scaleChoice(tree, REAL)).toContain('skins.css: --fs-ui: 13px is not var() of a step on the --fs-* scale');
  });

  it("reds a minted size inside Instrument's ≥900px block", () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--fs-ui:     var(--fs-sm);', '--fs-ui:     13px;');
    expect(scaleChoice(tree, REAL)).toEqual(['skins.css: --fs-ui: 13px is not var() of a step on the --fs-* scale']);
  });

  it('reds a role pointed at another role, a minted weight, a minted tracking and a third family', () => {
    // D-5243: the --weight-* and --ls-* roles and the role-to-role refusal
    // are this guard's widening of the plan's (e).
    const tree = plantedTree();
    replaceOnce(tree, SKINS_CSS, '--fs-page:    var(--fs-md);', '--fs-page:    var(--fs-meta);');
    replaceOnce(tree, SKINS_CSS, '--weight-section: var(--weight-medium);', '--weight-section: 650;');
    replaceOnce(tree, SKINS_CSS, '--ls-section:     var(--ls-caps);', '--ls-section:     0.08em;');
    replaceOnce(tree, SKINS_CSS, '--family-section: var(--family-mono);', '--family-section: Georgia, serif;');
    const problems = scaleChoice(tree, REAL);
    expect(problems).toContain('skins.css: --fs-page: var(--fs-meta) is not var() of a step on the --fs-* scale');
    expect(problems).toContain('skins.css: --weight-section: 650 is not var() of a step on the --weight-* scale');
    expect(problems).toContain('skins.css: --ls-section: 0.08em is not var() of a step on the --ls-* scale');
    expect(problems).toContain('skins.css: --family-section: Georgia, serif is neither var(--family-ui) nor var(--family-mono)');
  });

  it("reds a minted size in Refined's own :root (D-5243)", () => {
    const tree = replaceOnce(plantedTree(), TOKENS_CSS, '--fs-meta:    var(--fs-xs);', '--fs-meta:    12px;');
    expect(scaleChoice(tree, REAL)).toEqual(['tokens.css: --fs-meta: 12px is not var() of a step on the --fs-* scale']);
  });

  it("reds a minted size in Refined's ≥900px :root (D-5243)", () => {
    const tree = replaceOnce(plantedTree(), TOKENS_CSS, '--fs-page: var(--fs-2xl);', '--fs-page: 26px;');
    expect(scaleChoice(tree, REAL)).toEqual(['tokens.css: --fs-page: 26px is not var() of a step on the --fs-* scale']);
  });
}, 30_000);

describe('(f) motion only under prefers-reduced-motion: no-preference', () => {
  it('holds on the tree', () => {
    expect(motionScope(REPO, REAL)).toEqual([]);
  });

  it('reds a duration in the bare block', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--elev-card: none;', '--elev-card: none;\n  --dur-base: 120ms;');
    expect(motionScope(tree, REAL)).toContain(
      'skins.css: --dur-base is declared outside @media (prefers-reduced-motion: no-preference) (in ":root[data-skin=\'instrument\']")');
  });

  it('reds a duration under any other @media', () => {
    const other = append(plantedTree(), SKINS_CSS,
      "@media (min-width: 0) { :root[data-skin='instrument'] { --dur-base: 120ms; } }");
    expect(motionScope(other, REAL)).toContain(
      'skins.css: --dur-base is declared outside @media (prefers-reduced-motion: no-preference) (in "@media (min-width: 0) { :root[data-skin=\'instrument\']")');
  });

  it('reds a query that names the preference but applies without it: a list, and a not', () => {
    // `screen, print and (…)` applies on every screen, whatever the reader
    // asked for; `not print and (…)` negates the whole query. Each still has
    // the preference as an `and` conjunct, so only the comma and the `not`
    // rules catch them.
    const list = replaceOnce(plantedTree(), SKINS_CSS, '@media (prefers-reduced-motion: no-preference) {',
      '@media screen, print and (prefers-reduced-motion: no-preference) {');
    expect(motionScope(list, REAL)).toEqual(['--dur-fast', '--dur-base', '--dur-slow'].map((t) =>
      `skins.css: ${t} is declared outside @media (prefers-reduced-motion: no-preference) (in "@media screen, print and (prefers-reduced-motion: no-preference) { :root[data-skin='instrument']")`));
    const not = replaceOnce(plantedTree(), SKINS_CSS, '@media (prefers-reduced-motion: no-preference) {',
      '@media not print and (prefers-reduced-motion: no-preference) {');
    expect(motionScope(not, REAL)).toHaveLength(3);
  });

  it('passes a conjunction that keeps the preference', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '@media (prefers-reduced-motion: no-preference) {',
      '@media screen and (prefers-reduced-motion: no-preference) {');
    expect(motionScope(tree, REAL)).toEqual([]);
  });
}, 30_000);

describe('(f2) no tap-bearing density token below --tap-min outside (pointer: fine)', () => {
  it('holds on the tree, and the catalogue marks --row-h', () => {
    expect(tapBearing(REAL)).toContain('--row-h');
    expect(tapFloor(REPO, REAL)).toEqual([]);
  });

  it('reds the dense row in the bare block', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--row-h:       44px;', '--row-h:       32px;');
    expect(tapFloor(tree, REAL)).toEqual([
      'skins.css: --row-h: 32px is below --tap-min (44px) outside @media (pointer: fine)']);
  });

  it('reds the dense row under (pointer: coarse)', () => {
    const coarse = replaceOnce(plantedTree(), SKINS_CSS, '@media (pointer: fine) {', '@media (pointer: coarse) {');
    expect(tapFloor(coarse, REAL)).toEqual([
      'skins.css: --row-h: 32px is below --tap-min (44px) outside @media (pointer: fine)']);
  });

  it('reds the dense row under a query that names a fine pointer but applies without one: a list, and a not', () => {
    const list = replaceOnce(plantedTree(), SKINS_CSS, '@media (pointer: fine) {', '@media all, print and (pointer: fine) {');
    expect(tapFloor(list, REAL)).toEqual([
      'skins.css: --row-h: 32px is below --tap-min (44px) outside @media (pointer: fine)']);
    const negated = replaceOnce(plantedTree(), SKINS_CSS, '@media (pointer: fine) {', '@media not all and (pointer: fine) {');
    expect(tapFloor(negated, REAL)).toEqual([
      'skins.css: --row-h: 32px is below --tap-min (44px) outside @media (pointer: fine)']);
  });

  it("reds a short row in Refined's :root (D-5243), and a value it cannot measure", () => {
    const refined = replaceOnce(plantedTree(), TOKENS_CSS, '--row-h:       52px;', '--row-h:       40px;');
    expect(tapFloor(refined, REAL)).toEqual([
      'tokens.css: --row-h: 40px is below --tap-min (44px) outside @media (pointer: fine)']);
    const calc = replaceOnce(plantedTree(), SKINS_CSS, '--row-h:       44px;', '--row-h:       calc(var(--sp-8) + 0px);');
    expect(tapFloor(calc, REAL)).toEqual([
      'skins.css: --row-h: calc(var(--sp-8) + 0px) cannot be measured against --tap-min, outside @media (pointer: fine)']);
  });

  it('resolves a scale step: var(--sp-12) clears the floor and var(--sp-8) does not', () => {
    const clears = replaceOnce(plantedTree(), SKINS_CSS, '--row-h:       44px;', '--row-h:       var(--sp-12);');
    expect(tapFloor(clears, REAL)).toEqual([]);
    const short = replaceOnce(plantedTree(), SKINS_CSS, '--row-h:       44px;', '--row-h:       var(--sp-8);');
    expect(tapFloor(short, REAL)).toEqual([
      'skins.css: --row-h: var(--sp-8) is below --tap-min (44px) outside @media (pointer: fine)']);
  });
}, 30_000);

describe('(g) no palette block declares a type, density, radius, meter or motion skin token', () => {
  it('holds on the tree, reading every palette block', () => {
    expect(paletteBlocks(REPO, REAL)).toEqual([]);
    // Phosphor & Ink is :root; every other palette is one [data-theme] block.
    const seen = new Set(sheet(REPO, TOKENS_CSS).chains.flat().filter((p) => /\[data-theme\b/i.test(p)));
    expect(seen.size).toBe(THEMES.filter((t) => t.id !== PHOSPHOR).length);
  });

  it("reds a radius in the first palette block (Phosphor Daylight's), the first generated one (Nord's) and the last (Catppuccin Latte's)", () => {
    // In file order the hand-written [data-theme='light'] comes first, then
    // the generated blocks, Nord first and Catppuccin Latte last.
    const light = replaceOnce(plantedTree(), TOKENS_CSS, "[data-theme='light'] {", "[data-theme='light'] {\n  --r-md: 2px;");
    expect(paletteBlocks(light, REAL)).toEqual(["tokens.css: [data-theme='light'] declares --r-md, a radius skin token"]);
    const nord = replaceOnce(plantedTree(), TOKENS_CSS, "[data-theme='nord'] {", "[data-theme='nord'] {\n  --r-md: 2px;");
    expect(paletteBlocks(nord, REAL)).toEqual(["tokens.css: [data-theme='nord'] declares --r-md, a radius skin token"]);
    const latte = replaceOnce(plantedTree(), TOKENS_CSS, "[data-theme='catppuccin-latte'] {",
      "[data-theme='catppuccin-latte'] {\n  --r-md: 2px;");
    expect(paletteBlocks(latte, REAL)).toEqual([
      "tokens.css: [data-theme='catppuccin-latte'] declares --r-md, a radius skin token"]);
  });

  it('lets a palette declare elevation, the one shared class', () => {
    expect(sheet(REPO, TOKENS_CSS).decls.some((d) => d.prop === '--elev-card' && d.chain.some((p) => p.includes('data-theme'))))
      .toBe(true);
  });
}, 30_000);

describe('(h) no !important', () => {
  it('holds on the tree', () => {
    expect(important(REPO)).toEqual([]);
  });

  it('reds an !important planted on a radius', () => {
    const tree = replaceOnce(plantedTree(), SKINS_CSS, '--r-md: 5px;', '--r-md: 5px ! important;');
    expect(important(tree)).toEqual(['skins.css carries !important (1)']);
  });
}, 30_000);

describe("(i) the contrast gate's stylesheet walk lists skins.css by its exact path", () => {
  it('holds on the tree', () => {
    expect(walkLists(REPO)).toEqual([]);
  });

  it('reds skins.css moved to ui/src/skins.css, with theme.css importing it there', () => {
    // A coherent move: the app would still load it, and the walk would still
    // list A skins.css. Only the exact path tells it is not the file this
    // guard reads.
    const tree = plantedTree();
    renameSync(path.join(tree, SKINS_CSS), path.join(tree, 'ui/src/skins.css'));
    replaceOnce(tree, 'ui/src/styles/theme.css', "@import './skins.css';", "@import '../skins.css';");
    expect(walkLists(tree)).toEqual([
      `design/audit.mjs's stylesheet walk does not list ${SKINS_CSS}, so the contrast gate would not measure a rule planted there`]);
  });
}, 30_000);

describe('(j) the scan is looking at something', () => {
  it('reads at least one skin block and eight declarations, against a catalogue with a skin', () => {
    const css = sheet(REPO, SKINS_CSS);
    expect(REAL.ids.length).toBeGreaterThan(0);
    expect(css.chains.filter((c) => isSkinBlock(REAL, c[c.length - 1] ?? '')).length).toBeGreaterThanOrEqual(1);
    expect(css.decls.length).toBeGreaterThanOrEqual(8);
    // The defaults the rules resolve through are really there.
    expect(rootValues(REPO).size).toBeGreaterThan(100);
  });
});

// ── the censuses ────────────────────────────────────────────────────────────

describe('(k) data-skin appears in no stylesheet but skins.css', () => {
  it('holds on the tree, both ways', () => {
    expect(sheetCensus(REPO).problems).toEqual([]);
  });

  it('reds a lamp squared from fleet.css, and an upper-case selector in a ui stylesheet', () => {
    const fleet = append(plantedTree(), 'pwa/src/fleet/fleet.css', "[data-skin='instrument'] .dot { border-radius: 2px }");
    expect(sheetCensus(fleet).problems).toEqual(['pwa/src/fleet/fleet.css selects on data-skin: only skins.css may']);
    const ui = append(plantedTree(), 'ui/src/primitives/option-row.css', "[DATA-SKIN='instrument'] .x { gap: 0 }");
    expect(sheetCensus(ui).problems).toEqual(['ui/src/primitives/option-row.css selects on data-skin: only skins.css may']);
  });

  it('reads a mention in a comment as no mention', () => {
    const tree = append(plantedTree(), 'pwa/src/fleet/fleet.css', "/* never [data-skin='instrument'] here */");
    expect(sheetCensus(tree).problems).toEqual([]);
  });

  it('reds a registered stylesheet that no longer names data-skin', () => {
    const tree = plant(plantedTree(), SKINS_CSS, (s) => s.replaceAll('data-skin', 'data-layout'));
    expect(sheetCensus(tree).problems).toEqual([`${SKINS_CSS} is registered for data-skin but names none`]);
  });
}, 30_000);

describe('(l) the skin attribute appears in no source but the registry', () => {
  it('holds on the tree', () => {
    expect(sourceCensus(REPO).problems).toEqual([]);
  });

  it('reds dataset.skin read in a fleet component', () => {
    const tree = append(plantedTree(), 'pwa/src/fleet/FleetHead.tsx',
      "export const dense = (): boolean => document.documentElement.dataset.skin === 'instrument';");
    expect(sourceCensus(tree).problems).toEqual([
      'pwa/src/fleet/FleetHead.tsx reaches the skin attribute (dataset.skin) outside the registry']);
  });

  it("reds getAttribute('data-skin') in a ui primitive, and dataset['skin'] in Storybook's preview", () => {
    const tree = plantedTree();
    append(tree, 'ui/src/primitives/chip.tsx', "export const skinOf = (): string | null => document.documentElement.getAttribute('data-skin');");
    append(tree, 'ui/.storybook/preview.ts', "export const skinNow = document.documentElement.dataset['skin'];");
    expect(sourceCensus(tree).problems).toEqual([
      'ui/src/primitives/chip.tsx reaches the skin attribute (data-skin) outside the registry',
      'ui/.storybook/preview.ts reaches the skin attribute (dataset[\'skin\']) outside the registry',
    ]);
  });

  it('sees a hit after a string that holds /* — the comment strip does not swallow it', () => {
    const tree = append(plantedTree(), 'pwa/src/fleet/FleetHead.tsx', [
      "export const accept = 'image/*';",
      "export const dense = (): boolean => document.documentElement.dataset.skin === 'instrument';",
      '/* a later comment, which a bare block-comment regex would close the string\'s "comment" on */',
    ].join('\n'));
    expect(sourceCensus(tree).problems).toEqual([
      'pwa/src/fleet/FleetHead.tsx reaches the skin attribute (dataset.skin) outside the registry']);
  });

  it('reads a mention in a comment as no mention', () => {
    const tree = append(plantedTree(), 'pwa/src/fleet/FleetHead.tsx',
      '// never read data-skin here\n/* nor dataset.skin */');
    expect(sourceCensus(tree).problems).toEqual([]);
  });

  it('reds a registered path that no longer exists', () => {
    expect(sourceCensus(REPO, [...SOURCE_REGISTRY, 'pwa/src/lib/gone.ts']).problems).toEqual([
      'pwa/src/lib/gone.ts is registered but does not exist']);
  });
}, 30_000);

describe('(m) useSkin is reached in no file under pwa/src but the registry', () => {
  it('holds on the tree, both ways, and the definition is where the census says', () => {
    expect(hookCensus(REPO).problems).toEqual([]);
    expect(stripJs(read(REPO, HOOK_DEFINITION))).toMatch(/export function useSkin\s*\(/);
  });

  it('reds a useSkin() call in SessionLine.tsx', () => {
    const tree = append(plantedTree(), 'pwa/src/fleet/SessionLine.tsx',
      "export const denseLine = (): boolean => useSkin() === 'instrument';");
    expect(hookCensus(tree).problems).toEqual(['pwa/src/fleet/SessionLine.tsx reaches useSkin outside the registry']);
  });

  it('reds an aliased import', () => {
    const tree = plant(plantedTree(), 'pwa/src/screens/MailScreen.tsx',
      (s) => `import { useSkin as useLayout } from '../lib/skin';\n${s}`);
    expect(hookCensus(tree).problems).toEqual(['pwa/src/screens/MailScreen.tsx reaches useSkin outside the registry']);
  });

  it('reds a registered file that never reaches useSkin', () => {
    expect(hookCensus(REPO, ['pwa/src/fleet/SessionLine.tsx']).problems).toEqual([
      'pwa/src/fleet/SessionLine.tsx is registered for useSkin but never reaches it']);
  });
}, 30_000);

describe('(n) the censuses are looking at something', () => {
  it('(k) read the four app sheets and the ui styles; (l) and (m) read at least 100 source files', () => {
    const sheets = sheetCensus(REPO).read;
    for (const f of [
      'pwa/src/fleet/fleet.css', 'pwa/src/session/chat.css', 'pwa/src/styles/base.css', 'pwa/src/styles/shell.css',
      'ui/src/styles/reset.css', 'ui/src/styles/theme.css', TOKENS_CSS, SKINS_CSS,
    ]) expect(sheets).toContain(f);
    const sources = sourceCensus(REPO).read;
    expect(sources.length).toBeGreaterThanOrEqual(100);
    for (const f of [...SOURCE_REGISTRY, 'ui/.storybook/preview.ts']) expect(sources).toContain(f);
    expect(hookCensus(REPO).read.length).toBeGreaterThanOrEqual(100);
  });
});
