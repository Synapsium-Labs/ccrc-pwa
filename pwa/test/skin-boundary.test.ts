// THE IDENTITY CORE'S ELEMENT GUARD (D-5094's element half, W2 Task S4a).
//
// `skin-identity.test.ts` walls the token channel (`skins.css`). This file walls the structure channel: everything a
// skin writes under `pwa/src/skins/<id>/`, its parts and its own stylesheet (spec §4.4). A skin varies density,
// structure and chrome; the identity core (spec §3.1) is shared, so a skin PLACES it and never redraws it. Each case
// below is one way a skin file could redraw a piece of the core, or reach past the one data model, while every other
// suite stays green: a skin-local dot paints status the contrast gate never measured, a literal caret drifts from the
// wordmark's, a `display: none` under `@media` hides a door that jsdom still counts as present.
//
// THE CASES, one describe each, over every file under each skin directory in SKINS, comments stripped:
//   (a) each skin's bar modules render `Wordmark`; a skin still pending names the task that adds its bar, and a
//       pending skin that already renders one is stale (both ways);
//   (b) status is drawn only through `StatusDot`: no dot or lamp class and no status glyph;
//   (c) no colour literal (`colourLiteralsIn`, the token half's own predicate, by import);
//   (d) no `font-family`, no `font` shorthand whose family is not the Geist pair's token, no arbitrary family utility;
//   (e) every `box-shadow` is a `var(--elev-*)` or `var(--glow-*)` token, and no arbitrary shadow utility;
//   (f) no `❯`: the caret is `Wordmark`'s, `OptionRow`'s, the composer's and the page title's, all shared;
//   (g) no import of the other skin's directory or of `lib/api`, and no `fetch`, `WebSocket` or `EventSource`, in
//       every `.ts` and `.tsx` file;
//   (h) the scan is looking at something: at least one `.tsx` and one `.css` per skin directory;
//   (i) motion is tokened: durations and curves are `var(--dur-*)` and `var(--curve-*)`, never a literal time (inside
//       `calc()` included), and no arbitrary `duration-[…]` or `delay-[…]` utility;
//   (j) no skin stylesheet hides by width: no `display: none` or `visibility: hidden` inside `@media` or
//       `@container`. A width-gated part mounts through `useMediaQuery` (the plan's Global constraint), because jsdom
//       applies no media queries and would count a CSS-hidden door as present. A rule whose every selector is a
//       pseudo-element (`::-webkit-scrollbar`) is exempt: it hides no part and no door.
//
// EVERY CASE IS SHOWN LIVE, as in the token half: each runs against the real tree and against a planted copy of
// `pwa/src/skins`, and each planted case names the sentence the case must produce. The PR records the half of the
// mutation table that mutates this file's own predicates.
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INSTRUMENT, REFINED, SKINS } from '@ccrc/ui';
import { colourLiteralsIn, filesUnder, parseCss, stripCss, stripJs, type Decl } from './sourceScan';

const REPO = path.join(import.meta.dirname, '..', '..');
const SKIN_ROOT = 'pwa/src/skins';
const IDS: readonly string[] = SKINS.map((s) => s.id);

// ── reading a skin directory ───────────────────────────────────────────────

interface SkinFile {
  readonly skin: string;
  /** Repo-relative. */
  readonly rel: string;
  /** Relative to the skin's directory, as the registry names it. */
  readonly name: string;
  readonly css: boolean;
  /** The text with its comments stripped: `stripCss` or `stripJs`. */
  readonly code: string;
}

const SCANNED = /\.(?:tsx?|css)$/;

function skinFiles(tree: string, skin: string): SkinFile[] {
  const dir = `${SKIN_ROOT}/${skin}`;
  return filesUnder(tree, dir, (n) => SCANNED.test(n)).map((rel) => {
    const raw = readFileSync(path.join(tree, rel), 'utf8');
    const css = rel.endsWith('.css');
    return { skin, rel, name: rel.slice(dir.length + 1), css, code: css ? stripCss(raw) : stripJs(raw) };
  });
}

const allFiles = (tree: string): SkinFile[] => IDS.flatMap((id) => skinFiles(tree, id));

const decls = (f: SkinFile): readonly Decl[] => parseCss(f.code).decls;

/** The string literals of a TS/TSX file, quotes dropped: a class name, a utility and an inline value are all here. */
function stringLiterals(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/** The rule's own selector: the last prelude of its chain that is not an at-rule. */
const selectorOf = (d: Decl): string => [...d.chain].reverse().find((p) => !p.startsWith('@')) ?? '';

// ── (a) the bar renders the wordmark ───────────────────────────────────────

/** Each skin's bar modules, relative to its directory, or the plan task that adds its bar while none exists. S4b
 *  replaces Refined's entry with `['AppBar.tsx']`, S5 adds `PhoneHeader.tsx`, S9 replaces Instrument's with
 *  `['TopBar.tsx']`, S11 adds `PhoneTopBar.tsx`. */
type BarRegistry = Readonly<Record<string, string | readonly string[]>>;

const BAR_MODULES: BarRegistry = { [REFINED]: ['AppBar.tsx', 'PhoneHeader.tsx'], [INSTRUMENT]: ['TopBar.tsx'] };

const RENDERS_WORDMARK = /<Wordmark\b/;

function wordmark(tree: string, registry: BarRegistry = BAR_MODULES): string[] {
  const out: string[] = [];
  for (const id of IDS) if (!(id in registry)) out.push(`${id} has no bar entry: list its bar modules or the task that adds them`);
  for (const id of Object.keys(registry)) if (!IDS.includes(id)) out.push(`the bar registry names ${id}, which is not a skin in SKINS`);
  for (const id of IDS) {
    const entry = registry[id];
    if (entry === undefined) continue;
    const files = skinFiles(tree, id).filter((f) => !f.css);
    if (typeof entry === 'string') {
      for (const f of files) {
        if (RENDERS_WORDMARK.test(f.code)) {
          out.push(`${id} is pending on ${entry}, but ${f.name} renders Wordmark: the entry is stale, list the module`);
        }
      }
      continue;
    }
    for (const name of entry) {
      const f = files.find((x) => x.name === name);
      if (f === undefined) out.push(`${id}/${name} is listed as a bar module and does not exist`);
      else if (!RENDERS_WORDMARK.test(f.code)) out.push(`${id}/${name} is listed as a bar module and renders no Wordmark`);
    }
  }
  return out;
}

// ── (b) status only through StatusDot ──────────────────────────────────────

const DOT_CLASS = /(^|[-_ ])(dot|lamp)([-_ ]|$)/;
const STATUS_GLYPHS: readonly string[] = ['✓', '✕', '♻', '○', '●', '▲', '⑂', '⟳', '⇡', '⤺'];

function statusDrawing(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    for (const g of STATUS_GLYPHS) if (f.code.includes(g)) out.push(`${f.rel} draws the status glyph ${g}: status is StatusDot's`);
    const classes = f.css
      ? parseCss(f.code).chains.flatMap((c) => [...(c[c.length - 1] ?? '').matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? ''))
      : stringLiterals(f.code).flatMap((s) => s.split(/\s+/));
    for (const c of classes) if (DOT_CLASS.test(c)) out.push(`${f.rel} names the class ${c}: a dot or a lamp is StatusDot's`);
  }
  return out;
}

// ── (c) no colour literal ──────────────────────────────────────────────────

function colourLiterals(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    // A value is scanned alone, never with its property: `background` is a system colour's name.
    const values: (readonly [shown: string, value: string])[] = f.css
      ? [...decls(f).map((d) => [`${d.prop}: ${d.value}`, d.value] as const), ...parseCss(f.code).stray.map((s) => [s, s] as const)]
      : stringLiterals(f.code).map((s) => [s, s] as const);
    for (const [shown, v] of values) for (const hit of colourLiteralsIn(v)) out.push(`${f.rel}: "${shown}" carries the colour literal ${hit}`);
  }
  return out;
}

// ── (d) the Geist pair, never a family of the skin's own ───────────────────

const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/;
const PAIR_LAST = /var\(--family-(?:ui|mono)\)$/;

function families(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    if (f.css) {
      for (const d of decls(f)) {
        if (d.prop === 'font-family') out.push(`${f.rel}: font-family: ${d.value} declares a family: the pair is the core's`);
        if (d.prop === 'font' && !CSS_WIDE.test(d.value) && !PAIR_LAST.test(d.value)) {
          out.push(`${f.rel}: font: ${d.value} names a family other than var(--family-ui) or var(--family-mono)`);
        }
      }
      continue;
    }
    if (/\bfontFamily\b/.test(f.code)) out.push(`${f.rel} sets fontFamily inline`);
    for (const s of stringLiterals(f.code)) if (/(?:^|[\s:])font-\[/.test(s)) out.push(`${f.rel}: "${s}" is an arbitrary family utility`);
  }
  return out;
}

// ── (e) shadows are elevation or glow tokens ───────────────────────────────

/** Top-level commas only: a comma inside `var(…, fallback)` never splits. */
function commaItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let buf = '';
  for (const c of value) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      items.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  items.push(buf.trim());
  return items;
}

const SHADOW_TOKEN = /^var\(--(?:elev|glow)-[\w-]+\)$/;

function shadows(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    if (f.css) {
      for (const d of decls(f)) {
        if (d.prop !== 'box-shadow' || d.value === 'none' || CSS_WIDE.test(d.value)) continue;
        if (!commaItems(d.value).every((i) => SHADOW_TOKEN.test(i))) {
          out.push(`${f.rel}: box-shadow: ${d.value} is not a var(--elev-*) or var(--glow-*) token`);
        }
      }
      continue;
    }
    if (/\bboxShadow\b/.test(f.code)) out.push(`${f.rel} sets boxShadow inline`);
    for (const s of stringLiterals(f.code)) if (/(?:^|[\s:])shadow-\[/.test(s)) out.push(`${f.rel}: "${s}" is an arbitrary shadow utility`);
  }
  return out;
}

// ── (f) the caret is shared ────────────────────────────────────────────────

function carets(tree: string): string[] {
  return allFiles(tree)
    .filter((f) => f.code.includes('❯'))
    .map((f) => `${f.rel} draws ❯: the caret is Wordmark's, OptionRow's, the composer's and the page title's`);
}

// ── (g) one data model ─────────────────────────────────────────────────────

const SPECIFIER = /\b(?:from|import|require)\s*\(?\s*(['"])([^'"]+)\1/g;
const NETWORK: readonly (readonly [string, RegExp])[] = [
  ['fetch', /\bfetch\s*\(/],
  ['WebSocket', /\bWebSocket\b/],
  ['EventSource', /\bEventSource\b/],
];

function reach(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    if (f.css) continue;
    for (const m of f.code.matchAll(SPECIFIER)) {
      const spec = m[2] ?? '';
      if (!spec.startsWith('.')) continue;
      const target = path.posix.join(path.posix.dirname(f.rel), spec);
      for (const other of IDS.filter((id) => id !== f.skin)) {
        const dir = `${SKIN_ROOT}/${other}`;
        if (target === dir || target.startsWith(`${dir}/`)) out.push(`${f.rel} imports ${spec}, inside the ${other} skin's directory`);
      }
      if (/^pwa\/src\/lib\/api(?:$|[/.])/.test(target)) out.push(`${f.rel} imports ${spec}: a skin never reaches lib/api`);
    }
    for (const [name, re] of NETWORK) if (re.test(f.code)) out.push(`${f.rel} calls ${name}: a skin never calls the network`);
  }
  return out;
}

// ── (h) the scan sees something ────────────────────────────────────────────

function vacuity(tree: string): string[] {
  const out: string[] = [];
  for (const id of IDS) {
    const files = skinFiles(tree, id);
    if (!files.some((f) => f.name.endsWith('.tsx'))) out.push(`${id} has no .tsx file: the scan sees nothing`);
    if (!files.some((f) => f.css)) out.push(`${id} has no .css file: the scan sees nothing`);
  }
  return out;
}

// ── (i) motion is tokened ──────────────────────────────────────────────────

const TIME_LITERAL = /(?<![\w-])(?:\d+\.?\d*|\.\d+)m?s(?![\w-])/;
const SHORTHANDS: ReadonlySet<string> = new Set(['transition', 'animation']);
const TIMES: ReadonlySet<string> = new Set(['transition-duration', 'transition-delay', 'animation-duration', 'animation-delay']);
const CURVES: ReadonlySet<string> = new Set(['transition-timing-function', 'animation-timing-function']);

function motion(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    if (!f.css) {
      for (const s of stringLiterals(f.code)) {
        if (/(?:^|[\s:])(?:duration|delay)-\[/.test(s)) out.push(`${f.rel}: "${s}" is an arbitrary duration utility`);
      }
      continue;
    }
    for (const d of decls(f)) {
      if (!SHORTHANDS.has(d.prop) && !TIMES.has(d.prop) && !CURVES.has(d.prop)) continue;
      const at = `${f.rel}: ${d.prop}: ${d.value}`;
      if (TIME_LITERAL.test(d.value)) {
        out.push(`${at} carries a literal time: durations are var(--dur-*)`);
        continue;
      }
      if (d.value === 'none' || CSS_WIDE.test(d.value)) continue;
      for (const item of commaItems(d.value)) {
        if (SHORTHANDS.has(d.prop) && !(/var\(--dur-/.test(item) && /var\(--curve-/.test(item))) {
          out.push(`${at}: "${item}" is not timed by var(--dur-*) and var(--curve-*)`);
        }
        if (TIMES.has(d.prop) && !/^var\(--dur-[\w-]+\)$/.test(item)) out.push(`${at}: "${item}" is not a var(--dur-*)`);
        if (CURVES.has(d.prop) && !/^var\(--curve-[\w-]+\)$/.test(item)) out.push(`${at}: "${item}" is not a var(--curve-*)`);
      }
    }
  }
  return out;
}

// ── (j) no hiding by width ─────────────────────────────────────────────────

const WIDTH_BLOCK = /^@(?:media|container)\b/i;

/** Every selector in the list targets a pseudo-element: the rule hides no element, so no door. */
const pseudoOnly = (selector: string): boolean => commaItems(selector).every((s) => s.includes('::'));

function widthHiding(tree: string): string[] {
  const out: string[] = [];
  for (const f of allFiles(tree)) {
    if (!f.css) continue;
    for (const d of decls(f)) {
      const hides = (d.prop === 'display' && /^none\b/.test(d.value)) || (d.prop === 'visibility' && /^(?:hidden|collapse)\b/.test(d.value));
      if (!hides || !d.chain.some((p) => WIDTH_BLOCK.test(p)) || pseudoOnly(selectorOf(d))) continue;
      out.push(`${f.rel}: ${d.chain.join(' { ')} { ${d.prop}: ${d.value} } hides by width: mount through useMediaQuery`);
    }
  }
  return out;
}

// ── planted copies ─────────────────────────────────────────────────────────

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the skin directories, at the same repo-relative paths. */
function plantedTree(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'skin-boundary-'));
  made.push(dir);
  mkdirSync(path.join(dir, path.dirname(SKIN_ROOT)), { recursive: true });
  cpSync(path.join(REPO, SKIN_ROOT), path.join(dir, SKIN_ROOT), { recursive: true });
  return dir;
}

/** A copy of the skins with one file's whole text replaced: a module that exists cannot lose a line by appending. */
function rewritten(rel: string, text: string): string {
  const tree = plantedTree();
  writeFileSync(path.join(tree, SKIN_ROOT, rel), text);
  return tree;
}

/** Append to a file in the copy (creating it), refusing a plant that changed nothing. */
function append(tree: string, rel: string, text: string): string {
  const p = path.join(tree, SKIN_ROOT, rel);
  let before = '';
  try {
    before = readFileSync(p, 'utf8');
  } catch {
    mkdirSync(path.dirname(p), { recursive: true });
  }
  const after = `${before}\n${text}\n`;
  writeFileSync(p, after);
  return tree;
}

const planted = (rel: string, text: string): string => append(plantedTree(), rel, text);

const REF_CSS = `${REFINED}/refined.css`;
const REF_PARTS = `${REFINED}/parts.tsx`;

// ── the cases ──────────────────────────────────────────────────────────────

describe('(a) each skin bar renders Wordmark (D-5094)', () => {
  it('holds on the real tree', () => {
    expect(wordmark(REPO)).toEqual([]);
  });
  it('a listed bar module that renders no Wordmark is red', () => {
    const tree = rewritten(`${REFINED}/AppBar.tsx`, 'export function AppBar() { return <div className="ref-bar" />; }');
    expect(wordmark(tree)).toContain(`${REFINED}/AppBar.tsx is listed as a bar module and renders no Wordmark`);
  });
  it('a listed bar module that is missing is red', () => {
    expect(wordmark(REPO, { ...BAR_MODULES, [REFINED]: ['AppBar.tsx', 'PhoneHeader.tsx', 'NoSuchBar.tsx'] }))
      .toContain(`${REFINED}/NoSuchBar.tsx is listed as a bar module and does not exist`);
  });
  it('a pending skin that renders Wordmark is stale', () => {
    // Both skins list their bars now (S4b, S9), so the case pends one in the registry against the real tree.
    expect(wordmark(REPO, { ...BAR_MODULES, [INSTRUMENT]: 'S9' }))
      .toContain(`${INSTRUMENT} is pending on S9, but TopBar.tsx renders Wordmark: the entry is stale, list the module`);
    expect(wordmark(REPO, BAR_MODULES)).toEqual([]);
  });
  it('a Wordmark in a comment counts for nothing', () => {
    const tree = rewritten(`${REFINED}/AppBar.tsx`, '// renders <Wordmark /> one day\nexport const AppBar = null;');
    expect(wordmark(tree))
      .toContain(`${REFINED}/AppBar.tsx is listed as a bar module and renders no Wordmark`);
  });
  it('the registry and SKINS agree both ways', () => {
    expect(wordmark(REPO, { [REFINED]: ['AppBar.tsx'] })).toContain(`${INSTRUMENT} has no bar entry: list its bar modules or the task that adds them`);
    expect(wordmark(REPO, { ...BAR_MODULES, retro: 'S99' })).toContain('the bar registry names retro, which is not a skin in SKINS');
  });
});

describe('(b) status is drawn only through StatusDot', () => {
  it('holds on the real tree', () => {
    expect(statusDrawing(REPO)).toEqual([]);
  });
  it('a dot class in a part is red', () => {
    const tree = planted(REF_PARTS, 'export const D = () => <span className="sess-dot" />;');
    expect(statusDrawing(tree)).toContain(`${SKIN_ROOT}/${REF_PARTS} names the class sess-dot: a dot or a lamp is StatusDot's`);
  });
  it('a lamp class in a skin stylesheet is red', () => {
    const tree = planted(REF_CSS, '.ref-lamp { width: var(--sp-2) }');
    expect(statusDrawing(tree)).toContain(`${SKIN_ROOT}/${REF_CSS} names the class ref-lamp: a dot or a lamp is StatusDot's`);
  });
  it('a status glyph is red', () => {
    const tree = planted(REF_CSS, ".ref-x::before { content: '●' }");
    expect(statusDrawing(tree)).toContain(`${SKIN_ROOT}/${REF_CSS} draws the status glyph ●: status is StatusDot's`);
  });
  it('a word that only contains dot is not a dot class', () => {
    const tree = planted(REF_PARTS, 'export const D = () => <span className="ref-dotted ref-anecdote" />;');
    expect(statusDrawing(tree)).toEqual([]);
  });
});

describe('(c) no colour literal in a skin file', () => {
  it('holds on the real tree', () => {
    expect(colourLiterals(REPO)).toEqual([]);
  });
  it('a hex in a skin stylesheet is red', () => {
    const tree = planted(REF_CSS, '.ref-x { color: #000 }');
    expect(colourLiterals(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: "color: #000" carries the colour literal #000`);
  });
  it('a colour function is red, not only a hex', () => {
    const tree = planted(REF_CSS, '.ref-x { color: rgb(0 0 0) }');
    expect(colourLiterals(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: "color: rgb(0 0 0)" carries the colour literal rgb()`);
  });
  it('a colour in a part is red', () => {
    const tree = planted(REF_PARTS, "export const C = () => <span className=\"text-[#ff0000]\" style={{ color: 'red' }} />;");
    expect(colourLiterals(tree)).toEqual(expect.arrayContaining([
      `${SKIN_ROOT}/${REF_PARTS}: "text-[#ff0000]" carries the colour literal #ff0000`,
      `${SKIN_ROOT}/${REF_PARTS}: "red" carries the colour literal red`,
    ]));
  });
});

describe('(d) no font family of a skin\'s own', () => {
  it('holds on the real tree', () => {
    expect(families(REPO)).toEqual([]);
  });
  it('a font-family declaration is red', () => {
    const tree = planted(REF_CSS, '.ref-x { font-family: serif }');
    expect(families(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: font-family: serif declares a family: the pair is the core's`);
  });
  it('a font shorthand naming a family literal is red; the pair token is not', () => {
    const tree = planted(REF_CSS, '.ref-x { font: 400 12px / 1 Georgia }\n.ref-y { font: var(--weight-regular) var(--fs-meta) / 1 var(--family-ui) }');
    expect(families(tree)).toEqual([`${SKIN_ROOT}/${REF_CSS}: font: 400 12px / 1 Georgia names a family other than var(--family-ui) or var(--family-mono)`]);
  });
  it('a font shorthand whose pair token is not last is red', () => {
    const tree = planted(REF_CSS, '.ref-x { font: 12px var(--family-ui), Georgia }');
    expect(families(tree)).toEqual([`${SKIN_ROOT}/${REF_CSS}: font: 12px var(--family-ui), Georgia names a family other than var(--family-ui) or var(--family-mono)`]);
  });
  it('an arbitrary family utility and an inline family are red', () => {
    const tree = planted(REF_PARTS, "export const F = () => <span className=\"font-['Comic_Sans']\" style={{ fontFamily: 'x' }} />;");
    expect(families(tree)).toEqual(expect.arrayContaining([
      `${SKIN_ROOT}/${REF_PARTS} sets fontFamily inline`,
      `${SKIN_ROOT}/${REF_PARTS}: "font-['Comic_Sans']" is an arbitrary family utility`,
    ]));
  });
});

describe('(e) every box-shadow is an elevation or a glow token', () => {
  it('holds on the real tree', () => {
    expect(shadows(REPO)).toEqual([]);
  });
  it('a shadow of the skin\'s own is red', () => {
    const tree = planted(REF_CSS, '.ref-x { box-shadow: 0 0 8px var(--accent) }');
    expect(shadows(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: box-shadow: 0 0 8px var(--accent) is not a var(--elev-*) or var(--glow-*) token`);
  });
  it('a token inside a shadow of the skin\'s own is still red', () => {
    const tree = planted(REF_CSS, '.ref-x { box-shadow: 0 0 8px var(--elev-card) }');
    expect(shadows(tree)).toEqual([`${SKIN_ROOT}/${REF_CSS}: box-shadow: 0 0 8px var(--elev-card) is not a var(--elev-*) or var(--glow-*) token`]);
  });
  it('tokens, a list of tokens and none pass', () => {
    const tree = planted(REF_CSS, '.ref-x { box-shadow: var(--elev-card) }\n.ref-y { box-shadow: var(--elev-card), var(--glow-busy) }\n.ref-z { box-shadow: none }');
    expect(shadows(tree)).toEqual([]);
  });
  it('an arbitrary shadow utility is red', () => {
    const tree = planted(REF_PARTS, 'export const S = () => <span className="shadow-[0_0_8px_black]" />;');
    expect(shadows(tree)).toContain(`${SKIN_ROOT}/${REF_PARTS}: "shadow-[0_0_8px_black]" is an arbitrary shadow utility`);
  });
});

describe('(f) no caret in a skin file', () => {
  it('holds on the real tree', () => {
    expect(carets(REPO)).toEqual([]);
  });
  it('a caret in a part is red', () => {
    const tree = planted(REF_PARTS, "export const caret = '❯';");
    expect(carets(tree)).toContain(`${SKIN_ROOT}/${REF_PARTS} draws ❯: the caret is Wordmark's, OptionRow's, the composer's and the page title's`);
  });
});

describe('(g) one data model: no other skin, no lib/api, no network', () => {
  it('holds on the real tree', () => {
    expect(reach(REPO)).toEqual([]);
  });
  it('a .ts helper importing lib/api is red', () => {
    const tree = planted(`${REFINED}/helper.ts`, "import { api } from '../../lib/api';\nexport const h = api;");
    expect(reach(tree)).toContain(`${SKIN_ROOT}/${REFINED}/helper.ts imports ../../lib/api: a skin never reaches lib/api`);
  });
  it('importing the other skin\'s directory is red', () => {
    const tree = planted(REF_PARTS, "import { INSTRUMENT_SET } from '../instrument/parts';");
    expect(reach(tree)).toContain(`${SKIN_ROOT}/${REF_PARTS} imports ../instrument/parts, inside the ${INSTRUMENT} skin's directory`);
  });
  it('the network is red, each way', () => {
    const tree = planted(`${INSTRUMENT}/net.ts`, "export const a = () => fetch('/x');\nexport const b = () => new WebSocket('/y');\nexport const c = () => new EventSource('/z');");
    const rel = `${SKIN_ROOT}/${INSTRUMENT}/net.ts`;
    expect(reach(tree)).toEqual(expect.arrayContaining([
      `${rel} calls fetch: a skin never calls the network`,
      `${rel} calls WebSocket: a skin never calls the network`,
      `${rel} calls EventSource: a skin never calls the network`,
    ]));
  });
});

describe('(h) the scan is looking at something', () => {
  it('holds on the real tree', () => {
    expect(vacuity(REPO)).toEqual([]);
  });
  it('an empty skin directory is red', () => {
    const tree = plantedTree();
    rmSync(path.join(tree, SKIN_ROOT, INSTRUMENT), { recursive: true });
    mkdirSync(path.join(tree, SKIN_ROOT, INSTRUMENT));
    expect(vacuity(tree)).toEqual([
      `${INSTRUMENT} has no .tsx file: the scan sees nothing`,
      `${INSTRUMENT} has no .css file: the scan sees nothing`,
    ]);
  });
  it('a .ts helper does not stand in for the .tsx', () => {
    const tree = plantedTree();
    rmSync(path.join(tree, SKIN_ROOT, INSTRUMENT), { recursive: true });
    append(tree, `${INSTRUMENT}/helper.ts`, 'export const h = 1;');
    append(tree, `${INSTRUMENT}/instrument.css`, '.ins-x { margin: 0 }');
    expect(vacuity(tree)).toEqual([`${INSTRUMENT} has no .tsx file: the scan sees nothing`]);
  });
});

describe('(i) motion is tokened', () => {
  it('holds on the real tree', () => {
    expect(motion(REPO)).toEqual([]);
  });
  it('a literal time is red', () => {
    const tree = planted(REF_CSS, '.ref-x { transition: opacity 200ms }');
    expect(motion(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: transition: opacity 200ms carries a literal time: durations are var(--dur-*)`);
  });
  it('a literal time inside calc() is red', () => {
    const tree = planted(REF_CSS, '.ref-x { transition: opacity var(--dur-base) var(--curve-swift) calc(200ms * 1) }');
    expect(motion(tree)).toEqual([
      `${SKIN_ROOT}/${REF_CSS}: transition: opacity var(--dur-base) var(--curve-swift) calc(200ms * 1) carries a literal time: durations are var(--dur-*)`,
    ]);
  });
  it('a shorthand without its curve token is red', () => {
    const tree = planted(REF_CSS, '.ref-x { transition: opacity var(--dur-base) ease-in }');
    expect(motion(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: transition: opacity var(--dur-base) ease-in: "opacity var(--dur-base) ease-in" is not timed by var(--dur-*) and var(--curve-*)`);
  });
  it('an arbitrary duration utility is red', () => {
    const tree = planted(REF_PARTS, 'export const M = () => <span className="transition duration-[250ms]" />;');
    expect(motion(tree)).toContain(`${SKIN_ROOT}/${REF_PARTS}: "transition duration-[250ms]" is an arbitrary duration utility`);
  });
  it('an arbitrary delay utility is red', () => {
    const tree = planted(REF_PARTS, 'export const M = () => <span className="delay-[100ms]" />;');
    expect(motion(tree)).toEqual([`${SKIN_ROOT}/${REF_PARTS}: "delay-[100ms]" is an arbitrary duration utility`]);
  });
  it('a curve longhand that is not a token is red', () => {
    const tree = planted(REF_CSS, '.ref-x { transition-timing-function: ease-in }');
    expect(motion(tree)).toEqual([`${SKIN_ROOT}/${REF_CSS}: transition-timing-function: ease-in: "ease-in" is not a var(--curve-*)`]);
  });
});

describe('(j) no skin stylesheet hides by width', () => {
  it('holds on the real tree', () => {
    expect(widthHiding(REPO)).toEqual([]);
  });
  it('a door hidden by display: none under @media is red', () => {
    const tree = planted(REF_CSS, '@media (max-width: 899px) { .ref-fab { display: none } }');
    expect(widthHiding(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: @media (max-width: 899px) { .ref-fab { display: none } hides by width: mount through useMediaQuery`);
  });
  it('visibility: hidden under @media is red', () => {
    const tree = planted(REF_CSS, '@media (min-width: 900px) { .ref-fab { visibility: hidden } }');
    expect(widthHiding(tree)).toContain(`${SKIN_ROOT}/${REF_CSS}: @media (min-width: 900px) { .ref-fab { visibility: hidden } hides by width: mount through useMediaQuery`);
  });
  it('display: none under @container is red', () => {
    const tree = planted(REF_CSS, '@container (max-width: 400px) { .ref-fab { display: none } }');
    expect(widthHiding(tree)).toEqual([`${SKIN_ROOT}/${REF_CSS}: @container (max-width: 400px) { .ref-fab { display: none } hides by width: mount through useMediaQuery`]);
  });
  it('a pseudo-element is exempt, but not when an element shares its selector list', () => {
    const tree = planted(REF_CSS, '@media (max-width: 899px) { .ref-rail::-webkit-scrollbar { display: none } .ref-fab, .ref-rail::after { display: none } }');
    expect(widthHiding(tree)).toEqual([
      `${SKIN_ROOT}/${REF_CSS}: @media (max-width: 899px) { .ref-fab, .ref-rail::after { display: none } hides by width: mount through useMediaQuery`,
    ]);
  });
  it('hiding outside a width block is not this case\'s', () => {
    const tree = planted(REF_CSS, '.ref-x[hidden] { display: none }');
    expect(widthHiding(tree)).toEqual([]);
  });
});
