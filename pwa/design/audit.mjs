// The contrast auditor. ONE implementation, shared by the gate
// (design/contrast-check.mjs, the command the plan and every review quote) and
// by the suite (test/contrast.test.ts). Both call `audit()`; neither owns a
// copy of anything.
//
// WHY THIS FILE EXISTS AT ALL
//
// The gate used to be a hand-typed table of token hexes measured against a
// hand-typed list of pairs. Every defect this round was opened for is a
// consequence of that shape:
//
//   * `.pr-body-preview` set --ink-secondary on --bg-well and measured 2.44 in
//     the light theme (floor 4.5) while the gate printed ALL 94 PASS, because
//     nobody had added that pair to the list. Two sibling rules had the same
//     defect (.dlg-reply-input 1.09 light, .msg-attach-gone 3.17 light).
//   * `.proj-archived-body .sess-line { opacity: 0.72 }` composited FIFTEEN
//     already-gated pairs below their floors. A token-pair checker cannot see
//     element opacity even in principle.
//   * The gate's D/Lt tables were a copy of tokens.css, and deviations 86/87
//     were both "the table and the stylesheet disagree".
//   * The first attempt to close all of the above put a *second* auditor in
//     test/contrast.test.ts with its own 15-entry DECLARED_PAIRS list — a
//     fresh unbound copy of the stylesheet. Ten of those fifteen were markdown
//     callouts written out as literals, so the exact blocker shape could be
//     reintroduced in a callout variant with the whole suite green.
//
// So: nothing here is typed twice. tokens.css is parsed. The stylesheets are
// DISCOVERED from disk (not listed — src/styles/base.css was missing from the
// list and was exempt from every audit). Pairs are read off the rules
// themselves. The only hand-written data left is the ground of a rule that
// does not name its own background, and each such entry carries its reason.
//
// WHAT IT MEASURES
//
// The organising question is ONE question, asked of every rule that sets a
// `color`: **can the ground be recovered from the stylesheets?** If yes, the
// pair is measured, whatever the rule looks like. If no, the rule is counted
// into the `uncovered` census that the gate PRINTS, so the blind spot is a
// number in the output rather than a paragraph in this comment. And if the
// ground can be found but not RESOLVED — a translucent tint with no GROUNDS
// entry, a gradient, an unknown token — that is a `problems` entry, i.e. a
// FAIL. An unparsed paint is a FAIL, never a skip; there is no fourth outcome.
//
// The ground is recoverable in four ways:
//
//   1. self-grounded rules — a rule that sets BOTH `color` and a ground of its
//      own (`background`, `background-color`, or a `background-image`, which is
//      recoverable-but-unresolvable and therefore a FAIL). The rule IS the pair.
//   2. variants — a rule whose SUBJECT restates a self-grounded rule's subject
//      (`variantSuffix`), across selector lists, ancestor chains and files. The
//      base rule is re-measured once per variant, with whatever the variant
//      changes: its `color`, its `background`, or a custom property the base
//      paints with.
//
//      Three rounds have each closed one SPELLING of "variant" here and left
//      the shape open. The check compared whole selector strings with
//      startsWith, so a grouped selector / an extra ancestor / an ancestor
//      qualifier each walked the 2.44:1 blocker past a green gate; then it
//      admitted only rules that REBOUND A CUSTOM PROPERTY, so a variant that
//      overrode `color` directly — `.code-block-copy:hover,
//      .code-block-copy[data-copied]`, shipping at 3.03:1 — was never measured
//      at all. What is claimed now is the shape: a variant is admitted iff it
//      changes one of the three inputs to the pair (ink, ground, or a property
//      the base resolves against), and variants that qualify the subject the
//      SAME way are merged, so splitting the ink across one rule and the ground
//      across another is not a hiding place either.
//   3. pseudo-element children — `X::before` / `X::placeholder` that set a
//      colour and no ground inherit X's, including each of X's variants.
//   4. named-ancestor descendants — a rule that sets a colour, has no ground of
//      its own, and NAMES a self-grounded ancestor in its own selector
//      (`.msg-assist .callout strong`). The closest named painter wins; the
//      pair is measured through every variant context of that painter. No DOM
//      knowledge is involved — the selector says where the element is.
//
// Plus two things a ratio cannot be read off directly:
//
//   5. element opacity — every static `opacity` strictly between 0 and 1, which
//      must be registered with the pairs it composites or a reason it
//      composites nothing.
//   6. keyframe troughs — every @keyframes opacity stop below 1, which must be
//      registered. Not gated on contrast (see KEYFRAME_TROUGHS); registered so
//      the list cannot drift, which it already had.
//
// INHERITED_GROUNDS is the escape valve for a load-bearing rule whose ground is
// genuinely only in the DOM: the ground is hand-written, the COLOUR is still
// read from the stylesheet.
//
// WHAT IT CANNOT MEASURE — enumerated, counted and printed, not described
//
//   * ~186 rules set a `color`, supply no ground, and name no painter in their
//     selector. Their ground comes from an ancestor the stylesheet never names,
//     which is DOM knowledge a parser cannot recover. `report.uncovered` is the
//     list, `counts.uncovered` the number, and `node design/contrast-check.mjs
//     --uncovered` prints it. This paragraph used to make the same claim about
//     ~230 rules and it was FALSE for 20 of them — the variants and the
//     named-ancestor descendants above, one of which was shipping below AA.
//   * a rule that restates a subject in a form that is not textually
//     base-subject-plus-qualifiers — `:is(.callout)[data-callout='x']`,
//     `[class~='callout'][data-x]` — is not seen as a variant. Closing that
//     needs a specificity-aware selector engine, not a parser. Spell variants
//     as the ones in chat.css do.
//   * CSS the audit does not model at all: `@media`/`@supports` preludes (the
//     inner rules ARE read, the condition is ignored), `!important` ordering
//     across rules, inline `style` attributes, and anything a script sets.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pwa package root — design/audit.mjs is one directory below it. Under
 *  `node`, which is how the GATE runs, that is the only correct answer and it
 *  is what makes a copied tree audit ITSELF. Under vitest the module is served
 *  over http and there is no file path to derive, so the suite passes an
 *  explicit root (`audit(process.cwd())`) and this falls back to the same
 *  place rather than throwing at import time. */
export const PWA_ROOT = (() => {
  try {
    return fileURLToPath(new URL('..', import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

// ── stylesheet discovery ────────────────────────────────────────────────────
// DISCOVERED, never listed. A hardcoded SHEETS array is how src/styles/base.css
// came to be exempt from every audit while looking covered.

function walkCss(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkCss(p, root, out);
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Every stylesheet under src/, relative to the package root, sorted. */
export function stylesheets(root = PWA_ROOT) {
  return walkCss(path.join(root, 'src'), root, []).sort();
}

const readCss = (root, rel) => stripComments(readFileSync(path.join(root, rel), 'utf8'));

// ── tokens.css ──────────────────────────────────────────────────────────────

/** Escape a literal for use inside a RegExp. */
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The brace-balanced body starting at the `{` at or after `from`. */
function balancedAt(src, from) {
  const start = src.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start + 1, i);
  }
  return null;
}

/** The brace-balanced body of the first `open …{ }` block. Comments are
 *  stripped BEFORE this runs: `:root` and `[data-theme='light']` both appear
 *  in tokens.css's own prose, and a naive indexOf lands on the comment.
 *
 *  The search is case-INSENSITIVE, like every other match in this file: `:ROOT`
 *  and `[DATA-THEME='light']` are selectors a browser matches, so an auditor
 *  that only finds the lowercase spelling reads a palette the page does not
 *  paint with. (The custom-property NAMES inside the block stay
 *  case-sensitive — those genuinely are, per CSS Variables 1.) */
export function blockBody(src, open) {
  const at = src.search(new RegExp(rx(open), 'i'));
  if (at < 0) throw new Error(`no ${open} block`);
  const body = balancedAt(src, at);
  if (body === null) throw new Error(`unbalanced braces after ${open}`);
  return body;
}

// Custom property names ARE case-sensitive (CSS Variables 1 §2): `--Foo` and
// `--foo` are two different properties. This is the one place in the file that
// must NOT fold case, and the reason declOf takes the distinction as an
// argument rather than a flag.
export const customProps = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/** Both theme palettes, parsed. The light theme is an OVERRIDE block, not a
 *  full palette: the wells, the syntax palette and every --syn-* value are
 *  declared once in :root and deliberately never re-declared. Spreading dark
 *  under light is what makes `[data-theme='light']` resolve the way a browser
 *  resolves it. */
export function loadThemes(root = PWA_ROOT) {
  const tokens = readCss(root, 'src/styles/tokens.css');
  const DARK = customProps(blockBody(tokens, ':root'));
  const LIGHT = { ...DARK, ...customProps(blockBody(tokens, "[data-theme='light']")) };
  return { DARK, LIGHT };
}

// ── WCAG 2.1 maths ──────────────────────────────────────────────────────────

const hexToRgba = (s) => {
  const m = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (!m) return null;
  const h = m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
};

/** Resolve a CSS colour expression to sRGB + alpha (NOT premultiplied).
 *  Handles #rrggbb, var() chains, rgb()/rgba(), color-mix(in srgb, A p%, B)
 *  and the `transparent` keyword. Anything else THROWS — an unparsed colour
 *  must fail the audit loudly, never pass by being skipped. */
export function resolveColor(expr, theme, depth = 0) {
  const e = String(expr).trim();
  if (depth > 12) throw new Error(`var() cycle resolving ${expr}`);
  if (/^transparent$/i.test(e)) return [0, 0, 0, 0];
  const hex = hexToRgba(e);
  if (hex) return hex;
  // Function names and keywords are ASCII case-insensitive (`VAR()`, `RGB()`,
  // `COLOR-MIX(IN SRGB, …)` all paint); the custom-property name inside is not.
  let m = /^var\(\s*(--[\w-]+)\s*\)$/i.exec(e);
  if (m) {
    const v = theme[m[1]];
    if (v === undefined) throw new Error(`unknown custom property ${m[1]}`);
    return resolveColor(v, theme, depth + 1);
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(e);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) throw new Error(`bad rgb(): ${e}`);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = /^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)\s*\)$/i.exec(e);
  if (m) {
    // CSS Color 5: mixing in a rectangular space is done in PREMULTIPLIED
    // alpha. Interpolating the raw channels instead (which the first auditor
    // did) makes `color-mix(in srgb, C 12%, transparent)` come out as 12% of
    // C's channels at 12% alpha — a colour 88% of the way to black — rather
    // than C at 12% alpha. It is the difference between a wash and a shadow,
    // and it is why --status-dead-tint could not be expressed as a mix.
    const a = resolveColor(m[1], theme, depth + 1);
    const b = resolveColor(m[3], theme, depth + 1);
    const p = Number(m[2]) / 100;
    const alpha = a[3] * p + b[3] * (1 - p);
    if (alpha === 0) return [0, 0, 0, 0];
    return [
      ...[0, 1, 2].map((i) => (a[i] * a[3] * p + b[i] * b[3] * (1 - p)) / alpha),
      alpha,
    ];
  }
  throw new Error(`unparsed colour expression: ${e}`);
}

/** Source-over composite of a (possibly translucent) fg onto an opaque bg. */
export const over = (fg, bg) =>
  [...[0, 1, 2].map((i) => fg[3] * fg[i] + (1 - fg[3]) * bg[i]), 1];

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (c) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);

export const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The ratio of `fg` (optionally faded by an inherited element `opacity`)
 *  against a background CHAIN, painted back to front: chain[0] is the opaque
 *  ground, each later entry is composited over the one before it. */
export function ratio(fgExpr, bgChain, theme, opacity = 1) {
  let bg = resolveColor(bgChain[0], theme);
  if (bg[3] !== 1) throw new Error(`background chain must start opaque, got ${bgChain[0]}`);
  for (const layer of bgChain.slice(1)) bg = over(resolveColor(layer, theme), bg);
  const raw = resolveColor(fgExpr, theme);
  return contrast(over([raw[0], raw[1], raw[2], raw[3] * opacity], bg), bg);
}

// ── rules ───────────────────────────────────────────────────────────────────

/** Every `selector { … }` in a stylesheet, including rules nested inside
 *  @media / @supports (the inner rule is what matches; the at-rule prelude is
 *  not a selector and never matches this pattern). */
export function rulesOf(root, rel) {
  const css = readCss(root, rel);
  const file = rel.split('/').pop();
  const found = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector === '' || selector.startsWith('@')) continue;
    found.push({ file, selector, body: m[2] });
  }
  return found;
}

export const ruleKey = (r) => `${r.file} ${r.selector}`;

/** The value a rule ends up with for `prop`, which is the value of its LAST
 *  declaration of it — the auditor used to take the FIRST, so any rule with a
 *  duplicated `color`, `background` or `opacity` was measured against a value
 *  the browser does not paint. `background: <fallback>; background: var(--x)`
 *  is the standard progressive-enhancement idiom, and both the reported 2.44:1
 *  blocker shape and an unregistered fade passed green through it.
 *
 *  Property names are matched case-INSENSITIVELY, because CSS matches them that
 *  way (Syntax 3 §3.1: ASCII case-insensitive). `COLOR:` / `BACKGROUND:` /
 *  `OPACITY:` are declarations a browser paints, and while this file was
 *  case-sensitive every one of them was invisible to it — the reported 2.44:1
 *  blocker shape forged the whole gate to ALL PASS just by being written in
 *  uppercase. CUSTOM properties are the documented exception (`--Foo` and
 *  `--foo` really are two properties), so the fold is switched off for them. */
export const declOf = (body, prop) => {
  const flags = prop.startsWith('--') ? 'g' : 'gi';
  let last = null;
  for (const m of body.matchAll(new RegExp(`(?:^|[;\\s])${rx(prop)}\\s*:\\s*([^;]+)`, flags))) last = m[1].trim();
  return last;
};

/** The background COLOUR a rule ends up with. `background` and
 *  `background-color` write the SAME cascaded value, so the answer is whichever
 *  is written last, not `background ?? background-color`:
 *  `background: none; background-color: var(--bg-well)` paints the well, and
 *  the auditor used to say it painted nothing. `background` here is the
 *  shorthand, so a value with more than a colour in it will not resolve — and
 *  must not: an unparsed paint is a FAIL, never a skip. Case-insensitive, for
 *  the reason declOf gives. */
export const bgOf = (body) => {
  let last = null;
  for (const m of body.matchAll(/(?:^|[;\s])background(?:-color)?\s*:\s*([^;]+)/gi)) last = m[1].trim();
  return last;
};

/** Every CSS value function that paints an IMAGE rather than a colour. */
const IMAGE_FN =
  /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(|\b(?:url|src|image|image-set|cross-fade|element|paint)\s*\(/i;

/** The background IMAGE a rule paints, or null.
 *
 *  `bgOf` reads only `background` / `background-color`, so a rule that painted
 *  its own opaque ground with `background-image: linear-gradient(…)` and put
 *  unreadable text on it was classified as "colour-only, ground unrecoverable"
 *  and SKIPPED — silently, and by a premise that was false for it. That
 *  directly contradicted this file's own claim that an unparsed paint is a FAIL
 *  and never a skip (final2-gates F3), and gradients are an idiom this design
 *  system already uses (`.attach-strip`'s scrim, `.md-table-wrap`'s fade,
 *  `.skel-line`'s shimmer).
 *
 *  An image cannot be reduced to one colour, so this exists to make the rule
 *  UNMEASURABLE-and-loud rather than unmeasured-and-quiet: the caller turns a
 *  non-null answer into a `problems` entry. Both spellings count — the
 *  `background-image` longhand and an image function inside the `background`
 *  shorthand — and the answer deliberately over-approximates: a longhand image
 *  that a later `background` shorthand would reset is still reported, because
 *  failing a rule that is fine costs a sentence in a registry while skipping a
 *  rule that is not is the entire defect class this file exists for. */
export const bgImageOf = (body) => {
  let longhand = null;
  for (const m of body.matchAll(/(?:^|[;\s])background-image\s*:\s*([^;]+)/gi)) longhand = m[1].trim();
  if (longhand !== null && isPaintValue(longhand)) return longhand;
  const short = bgOf(body);
  return short !== null && IMAGE_FN.test(short) ? short : null;
};

/** A `color` value that names an actual colour (rather than deferring to the
 *  cascade, which the auditor cannot follow). */
const isColourValue = (v) => v !== null && !/^(inherit|currentColor|unset|initial|revert)$/i.test(v);
/** A background value that paints something of its own. */
const isPaintValue = (v) => v !== null && !/^(none|inherit|unset|initial|revert)$/i.test(v);

/** What a rule paints its own element with: a colour, an image, or neither.
 *  `paints` is the question "does this rule supply a ground of its own" —
 *  answering it with `bgOf` alone is what made an image ground invisible. */
export const paintOf = (body) => {
  const colour = bgOf(body);
  const image = bgImageOf(body);
  return { colour, image, paints: isPaintValue(colour) || image !== null };
};

/** Custom properties a rule declares in its OWN body shadow the theme for that
 *  rule — `.msg-assist .callout` sets `--callout-tint` and then paints with
 *  it, so resolving against the bare theme would throw on an unknown token. */
const localVars = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

// `FROM` / `TO` are the same keyframe selectors as `from` / `to`.
const KEYFRAME_STOP = /^(from|to|[\d.]+%)$/i;
const isKeyframeStop = (r) => r.selector.split(',').every((s) => KEYFRAME_STOP.test(s.trim()));

/** Split a selector on separators that are at bracket/paren depth zero, so a
 *  comma inside `:is(a, b)` or a `~=` inside `[data-x~='y']` is not a split
 *  point. Empty pieces (`.a > .b` splits on both the space and the `>`) are
 *  dropped. */
function topLevel(sel, isSep) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && isSep(c)) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s !== '');
}

/** The individual selectors of a selector LIST. `rulesOf` stores a grouped
 *  rule whole (`.dot--busy, .dot--attention`), and a grouped rule is how
 *  anyone writes two variants that share a tint. */
export const selectorList = (sel) => topLevel(sel, (c) => c === ',');

/** The SUBJECT of a complex selector — the rightmost compound, i.e. the
 *  element the rule actually paints. `.msg-assist .md-body .callout[data-x]`
 *  paints `.callout[data-x]`; the ancestors only say when. */
export const compoundChain = (sel) =>
  topLevel(sel, (c) => c === ' ' || c === '>' || c === '+' || c === '~');

export const subjectCompound = (sel) => {
  const parts = compoundChain(sel);
  return parts[parts.length - 1] ?? sel;
};

/** A run of compound qualifiers on one element — `[data-callout='warning']`,
 *  `.is-open`, `:not(.x)`. */
const COMPOUND_SUFFIX = /^(?:\[[^\]]*\]|[.:#][A-Za-z][\w-]*(?:\([^)]*\))?)+$/;

/**
 * Is `sel` a rule that can restate `base`'s subject element with at least
 * base's specificity — i.e. a VARIANT whose custom properties the base rule
 * would paint with? Returns the qualifier suffix it adds (possibly `''`), or
 * null.
 *
 * This deliberately compares SUBJECTS and ignores the ancestor chains, because
 * every earlier spelling of this check compared whole selector strings with
 * `startsWith` and three ordinary spellings walked straight through it — each
 * reintroducing the reported 2.44:1 blocker with the gate printing ALL PASS:
 *
 *   .msg-assist .callout[data-callout='w'], .msg-assist .callout[…='c'] { … }
 *   .msg-assist .md-body .callout[data-callout='warning']               { … }
 *   .msg-assist[data-md]  .callout[data-callout='warning']              { … }
 *
 * Ignoring ancestors OVER-approximates: a variant that can only match under
 * some other ancestor is still measured through the base rule. That is the
 * safe direction for a gate — a context that cannot occur costs a measured row
 * that passes, while a context that CAN occur and is skipped is the defect
 * class this whole file exists for. What it does NOT catch is a rule that
 * restates the subject in a form that is not textually base's subject plus
 * qualifiers (`:is(.callout)[data-x]`, `[class~='callout'][data-x]`) — see the
 * disclosure in the file header.
 */
export function variantSuffix(sel, base) {
  const bases = selectorList(base).map(subjectCompound);
  for (const s of selectorList(sel)) {
    const ss = subjectCompound(s);
    if (ss.includes('::')) continue;
    for (const bs of bases) {
      if (!ss.startsWith(bs)) continue;
      const rest = ss.slice(bs.length);
      // Same subject, different ancestors: still a restatement, and a longer
      // ancestor chain wins the cascade.
      if (rest === '') {
        if (sel !== base) return '';
        continue;
      }
      if (COMPOUND_SUFFIX.test(rest)) return rest;
    }
  }
  return null;
}

// ── hand-written ground, one entry per rule that cannot name its own ────────

/** Rules whose `background` is not a self-sufficient opaque colour — a
 *  translucent tint, a gradient — need the ground they are painted on.
 *  `floor` defaults to the 4.5 body-text floor. */
export const GROUNDS = {
  // The EXIT pill's tint is 12% alpha and rides a tool/message card.
  'chat.css .exit-badge': { under: ['var(--bg-surface)'], why: 'card ground; the same pair the gate calls "EXIT-badge pill". Measured on all five plausible grounds: it clears on surface (4.81) and sheet (4.81) but reads 4.44 on page and 4.14 on raised, so this choice IS load-bearing — .toolcard (chat.css) and .tool-ask both set background: var(--bg-surface)' },
  // Markdown tables and the terminal keycaps use an ink-tinted transparent
  // wash over whatever they sit on.
  'chat.css .msg-assist thead th': { under: ['var(--bg-page)'], why: 'assistant messages have no fill of their own' },
  'chat.css .term-keys .keycap': { under: ['var(--bg-well)'], why: 'the terminal screen is the well' },
  // `background: transparent` rules — the border and the ink are the whole
  // treatment.
  'chat.css .pending-actions button': { under: ['var(--bg-page)'], why: 'ghost button in the message column; chat.css:16 paints the screen --bg-page. Clears on every plausible ground' },
  'chat.css .code-block-copy': { under: ['var(--well-bar-bg)'], why: 'the copy affordance sits in the code block BAR (.code-block-bar, background --well-bar-bg — 5% ink over the well), not on the bare well: MessageBubble.tsx renders it inside that div. The entry used to say --bg-well, which flattered every ratio here by ~0.3; the bar is the pixels behind it. Load-bearing either way — it reads 1.10-1.29 on page / surface / raised / sheet' },
  'chat.css .compaction-head': { under: ['var(--bg-page)'], why: 'a full-width divider in the message column. Clears on every plausible ground' },
  'primitives.css .btn-ghost': { under: ['var(--bg-sheet)'], why: 'the ghost button is a sheet/dialog control. Clears on every plausible ground' },
};

/** Rules exempt from the contrast audit, each with the reason. WCAG 1.4.3
 *  exempts disabled controls; nothing else here is exempt for convenience.
 *
 *  Keyed by rule, and honoured EVERYWHERE that rule is reached — as a
 *  self-grounded rule in its own right, as a variant context of one, or as the
 *  host of a descendant. It used to be consulted only on the first of those,
 *  which was invisible while the other two routes did not exist. */
export const SELF_GROUNDED_EXEMPT = {
  'chat.css .chat-head .keycap:disabled': 'WCAG 1.4.3 exempts inactive controls; --ink-disabled is documented sub-AA in tokens.css',
  'chat.css .send-btn:disabled': 'WCAG 1.4.3 exempts inactive controls',
  'primitives.css .btn-primary:disabled': 'WCAG 1.4.3 exempts inactive controls',
  // Measured, not assumed: --ink-disabled on the ghost button's sheet ground is
  // 2.85 dark / 2.63 light. It is the same --ink-disabled the three entries
  // above are exempt for; this one only became visible when variants that
  // override `color` DIRECTLY started being measured (final2-gates F1), and it
  // is exempt for the same clause, not a new judgement.
  'primitives.css .btn-ghost:disabled': 'WCAG 1.4.3 exempts inactive controls; --ink-disabled is 2.85 dark / 2.63 light here and is documented sub-AA in tokens.css',
  'chat.css .attach-strip': "the ground is the user's own image, so no ratio is computable; the rule IS the mitigation (a scrim gradient under --ink-on-well)",
};

/** Rules that set a colour and inherit their ground from the DOM. The GROUND
 *  is hand-written (a parser cannot recover it); the COLOUR is read from the
 *  stylesheet, so retinting the rule re-measures it. */
export const INHERITED_GROUNDS = {
  'chat.css .code-block-lang': {
    under: ['var(--well-bar-bg)'],
    why: "the language label is the copy affordance's sibling inside .code-block-bar (MessageBubble.tsx) and takes --syn-comment on the same 5%-ink-over-well fill. It sets no background of its own and its selector names no ancestor, so no route could ground it — it was in the uncovered census next to a rule that was shipping at 3.03:1",
  },
  'fleet.css .proj-archived-body .sess-line:not(.sess-line--active) .sess-label': {
    under: ['var(--bg-surface)'],
    why: 'the past-tense signal for an archived row is an ink STEP on the label, not element opacity (see the note above the rule). Its ground is the project card. :not(.sess-line--active) is load-bearing — the selected row inverts to background: var(--ink-primary), where --ink-secondary reads 1.81 dark / 2.24 light',
  },
  'fleet.css .sess-spawn': {
    under: ['var(--bg-surface)'],
    why: 'the spawn chip is a .sess-meta cell on an unselected .sess-line, whose ground is the project card. Its selector names no ancestor, so no route could ground it — without this entry it joins .sess-held/.sess-lifecycle in the uncovered census, which is exactly where the last unmeasured meta cell was shipping below AA. The SELECTED row is answered by the achromatic group (--edge-strong), pinned separately in fleet-css.test.ts',
  },
  'fleet.css .sheet-panel .proj-ready': {
    under: ['var(--bg-sheet)'],
    why: "the program-ready badge (F3) on a project row inside the start-a-program sheet. Its selector DOES name an ancestor — .sheet-panel — but that painter lives in components/primitives.css, and the descendant route only grounds against painters in the same stylesheet, so scoping it was not enough: all three of its rules were measured at nothing. Confirmed by running audit() before this entry existed, which is the only reason it is here rather than in the uncovered census looking scoped-and-safe",
  },
  "fleet.css .sheet-panel .proj-ready[data-verdict='ready']": {
    under: ['var(--bg-sheet)'],
    why: 'the green arm of the same badge. Registered separately for the reason the .auth-block-sub entry states: grounding only the base rule would leave HALF the badge measured, and the report would then LOOK covered while the two rules that actually carry colour went unmeasured. The SELECTED row (.proj-row--selected, background: var(--accent-tint)) is a different ground and is not claimed here',
  },
  "fleet.css .sheet-panel .proj-ready[data-verdict='blocked']": {
    under: ['var(--bg-sheet)'],
    why: 'the red arm of the same badge, same reasoning as the ready arm above. --status-dead-text is the ink the board already uses for a proven-bad state',
  },
  'fleet.css .sheet-panel .proj-ready-why': {
    under: ['var(--bg-sheet)'],
    why: 'the badge\'s reason line, same ground and same reason as the three .proj-ready entries above. Added WITH the rule rather than after it: the first draft of the reason line shipped uncovered, which is precisely the defect those three entries exist to record',
  },
  'fleet.css .auth-block-title': {
    under: ['var(--bg-surface)'],
    why: 'the heading of the .auth-block card two rules up in the same stylesheet, which sets background: var(--bg-surface). Its selector names no ancestor, so no route could ground it — and fleet.css claimed in a comment that "every child\'s ink pair is already vetted" against that ground while nothing measured it. Same shape as .sess-spawn below',
  },
  'fleet.css .auth-block-sub': {
    under: ['var(--bg-surface)'],
    why: 'the "Passkeys" eyebrow inside the same .auth-block card, one ink step down (--ink-tertiary). Grounding only the title would leave HALF the card measured, which is worse than neither: the report then LOOKS like the block is covered (the trap spelled out on the .sess-spawn variant entry below)',
  },
  "fleet.css .sess-spawn[data-spawn='expired'], .sess-spawn[data-spawn='unrecognised']": {
    under: ['var(--bg-surface)'],
    why: 'the two "we do not know" verdicts drop to --ink-tertiary, and an attribute variant recovers no ground from its selector any more than the base rule does — so grounding only the base would leave HALF a new cell measured. Same project-card ground, same unselected row; the selected row is again the achromatic group, which carries the [data-spawn] member for exactly this rule',
  },
};

// ── element opacity ─────────────────────────────────────────────────────────
// `opacity` composites over the ground and a token-pair gate cannot see it.
// Every static opacity strictly between 0 and 1 must appear here, either with
// the pairs it fades or with a reason it fades no coloured content.
//
// Keys are `<file> <selector> <value>` with the value NORMALISED to a number,
// so `opacity: 72%` and `opacity: 0.72 !important` are the same declaration as
// `opacity: 0.72` — all three used to slip past `Number(v)` as NaN and ship
// unregistered.

export const OPACITY_REGISTRY = {
  'fleet.css .bell 0.55': {
    noText: 'an emoji glyph button with an aria-label; it carries its own bitmap palette, no token colour composites here, and the meaningful state (.bell--on) is opacity 1',
  },
  'fleet.css .bell:disabled 0.35': { noText: 'WCAG 1.4.3 exempts inactive controls' },
  'chat.css .pending-actions .pending-send-it:disabled 0.6': {
    noText: 'WCAG 1.4.3 exempts inactive controls; the button is only disabled for the moment its own Enter is in flight',
  },
  "chat.css .attach-chip[data-state='uploading'] .attach-thumb 0.55": {
    noText: 'an <img> upload preview; the uploading state is also carried by the ::before ring',
  },
  'primitives.css .dot--busy, .dot--attention 0.85': {
    pairs: [
      ['busy dot on the lamp well', 'var(--status-busy)', ['var(--bg-well)'], 3],
      ['attention dot on the lamp well', 'var(--status-attention)', ['var(--bg-well)'], 3],
      ['busy dot on a card', 'var(--status-busy)', ['var(--bg-surface)'], 3],
      ['attention dot on a card', 'var(--status-attention)', ['var(--bg-surface)'], 3],
    ],
  },
  'chat.css .tool-dot--run 0.8': {
    pairs: [['running tool dot on a card', 'var(--status-busy)', ['var(--bg-surface)'], 3]],
  },
  'chat.css .task-mark--running 0.85': {
    pairs: [['the breathing task mark on a card', 'var(--status-busy-text)', ['var(--bg-surface)'], 4.5]],
  },
  'chat.css .term-overlay--connecting .term-overlay-word 0.8': {
    pairs: [[
      'the "attaching" word on the terminal scrim',
      'var(--ink-on-well)',
      ['var(--bg-well)', 'color-mix(in srgb, var(--bg-well) 78%, transparent)'],
      4.5,
    ]],
  },
  'shell.css .shell-placeholder-mark 0.6': {
    // Measured for the record: 2.93 dark / 2.42 light, under even the 3:1
    // large-text floor. Exempt because it is not content — app.tsx:64 marks it
    // aria-hidden="true" and the pane's actual message
    // (.shell-placeholder-copy, "Select a session") renders beside it at full
    // strength, --ink-secondary on the page.
    noText: 'purely decorative: aria-hidden="true" in app.tsx, and .shell-placeholder-copy carries the message unfaded',
  },
};

// ── @keyframes opacity troughs ──────────────────────────────────────────────
// A running animation dips below its steady state, and nothing measures the
// dip. This registry does NOT gate contrast at the trough — WCAG 2.1 states no
// per-frame requirement for an animating element, and every loop below reduces
// to a steady state under prefers-reduced-motion that IS measured above. What
// it gates is the LIST: the previous round disclosed "working-glyph .35,
// working-dot .25, tool-breathe .55, task-breathe .55" as the complete set of
// troughs, and it was already wrong — dot-breathe .55 (the fleet/chat status
// lamps, the most visible animation in the app) was missing from it. A
// hand-typed list of what the stylesheets contain is the drift class this
// whole file exists to close, so the list is discovered and this registry is
// checked against it.
//
// Open design question, deliberately NOT decided here (see fix3-ui-css.md):
// whether a breathing element should be floored at its trough. Doing so means
// retuning the "glow means life" motion language in DIRECTION.md, which is a
// design decision and not a defect fix.
export const KEYFRAME_TROUGHS = {
  'primitives.css dot-breathe 0.55': 'status lamps (.dot--busy, .dot--attention). Reduced motion: animation none, opacity 0.85 — registered and measured above',
  'primitives.css skel-shimmer 1': 'a background-position shimmer; the stops set no opacity below 1',
  'primitives.css toast-in 0': 'a one-shot entrance from opacity 0; the resting state is opacity 1',
  'chat.css task-breathe 0.55': 'the running task mark (.task-mark--running). Reduced motion: animation none, opacity 0.85 — registered and measured above',
  'chat.css jump-in 0': 'a one-shot entrance for the jump-to-latest button; the resting state is opacity 1',
  'chat.css caret-blink 0': 'the terminal caret, a step-end blink between 1 and 0. A caret is a cursor, not content',
  'chat.css working-glyph 0.35': 'the working indicator glyph (.msg-working-glyph). Reduced motion: animation none, opacity 1',
  'chat.css working-dot 0.25': 'the three working dots (.msg-working-dots i), 4px decorative pips beside a full-strength label. Reduced motion: animation none, opacity inherits 1',
  'chat.css tool-breathe 0.55': 'the running tool dot (.tool-dot--run) and the terminal "attaching" word. Reduced motion: animation none, opacity 0.8 for both — registered and measured above',
  'chat.css attach-spin 1': 'a rotation; the stops set no opacity',
};

/** Every @keyframes block, with the lowest opacity any of its stops sets. */
export function keyframeTroughs(root = PWA_ROOT) {
  const found = [];
  for (const rel of stylesheets(root)) {
    const css = readCss(root, rel);
    const file = rel.split('/').pop();
    // `@KEYFRAMES` is the same at-rule, and the body is taken from the MATCH
    // position rather than by re-finding the prelude by string — a re-find is
    // what made the case fold unsafe here.
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/gi)) {
      const body = balancedAt(css, m.index + m[0].length - 1);
      if (body === null) throw new Error(`unbalanced braces after @keyframes ${m[1]}`);
      const stops = [...body.matchAll(/(?:^|[;{\s])opacity\s*:\s*([^;}]+)/gi)].map((s) => opacityNumber(s[1]));
      if (stops.some((v) => v === null)) {
        found.push({ file, name: m[1], min: null, key: `${file} ${m[1]} ?` });
        continue;
      }
      const min = stops.length === 0 ? 1 : Math.min(...stops);
      found.push({ file, name: m[1], min, key: `${file} ${m[1]} ${min}` });
    }
  }
  return found.sort((a, b) => (a.key < b.key ? -1 : 1));
}

/** A static opacity as a number, or null if the declaration is not a literal.
 *  `72%`, `.72` and `0.72 !important` are the same declaration as `0.72`;
 *  treating any of them as NaN and dropping it (which is what the first
 *  auditor did) is how a fade ships unregistered and unmeasured. A null result
 *  is a PROBLEM, never a skip. */
export function opacityNumber(raw) {
  const v = String(raw).replace(/\s*!important\s*$/i, '').trim();
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)%$/.test(v)) return Number(v.slice(0, -1)) / 100;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(v)) return Number(v);
  return null;
}

// ── the audit ───────────────────────────────────────────────────────────────

/**
 * Measure everything. Returns a report; it never throws for a stylesheet
 * defect — a defect is a `problems` entry or a FAIL row, both of which fail
 * the gate and the suite.
 */
export function audit(root = PWA_ROOT) {
  const { DARK, LIGHT } = loadThemes(root);
  const THEMES = [['DARK ', DARK], ['LIGHT', LIGHT]];
  const sheets = stylesheets(root);
  const rules = sheets.flatMap((rel) => rulesOf(root, rel));

  const measured = [];
  const problems = [];
  const add = (label, theme, r, floor, detail) =>
    measured.push({ label: `${theme} ${label}`, ratio: r, floor, ok: r >= floor, detail });

  const isColour = isColourValue;
  const isPaint = isPaintValue;

  // A rule is self-grounded when it sets a colour AND supplies a ground of its
  // own — a background COLOUR or a background IMAGE. The image half is not
  // measurable, and that is exactly why it belongs in this set: outside it the
  // rule fell into the "colour-only, ground unrecoverable" bucket and was
  // skipped in silence.
  const selfGrounded = rules.filter(
    (r) => !isKeyframeStop(r) && isColour(declOf(r.body, 'color')) && paintOf(r.body).paints,
  );

  const selfGroundedKeys = new Set(selfGrounded.map(ruleKey));
  // By IDENTITY, not by key: two rules can share a `file selector` key (the
  // stylesheet declares the same selector twice) and only one of them be the
  // one that paints a ground. Keying this by ruleKey made the OTHER one — a
  // pure `color` override the browser cascades on top — invisible.
  const selfGroundedSet = new Set(selfGrounded);

  /** Every way the stylesheets can paint the element a self-grounded rule
   *  paints: the rule as written, plus once per VARIANT of it.
   *
   *  This used to admit exactly one kind of variant — one that rebinds a custom
   *  property the base paints WITH — and it did not even look for those unless
   *  the base declared custom properties of its own. A variant that simply
   *  overrode `color` was never measured, which is how
   *  `.code-block-copy:hover, .code-block-copy[data-copied]` shipped at 3.03:1
   *  with this gate printing ALL 234 PASS (final2-gates F1). Three rounds have
   *  now each closed one SPELLING of "variant"; the shape is what is closed
   *  here.
   *
   *  A variant is admitted when it changes any of the three inputs to the pair
   *  — the ink (`color`), the ground (`background`/`background-image`), or a
   *  custom property the base resolves against — and for no other reason, so
   *  `:active { transform: … }` still costs nothing.
   *
   *  Two exclusions, both because the rule is measured better elsewhere:
   *    * a variant that supplies BOTH ink and ground is itself self-grounded,
   *      so route 1 measures it with its own GROUNDS entry or exemption;
   *      re-measuring it through the base's ground is a second, wrong answer
   *      for the same pixels (`.term-keys .keycap` through `.chat-head
   *      .keycap`'s ground was exactly that, and threw);
   *    * a rule with a SELF_GROUNDED_EXEMPT reason is exempt wherever it is
   *      reached, not only when route 1 reaches it. */
  const contextsFor = (base) => {
    const vars = localVars(base.body);
    const out = [{ suffix: '', vars, rule: base }];
    // Each variant gets its own context, AND variants that qualify the base's
    // subject the same way additionally get a MERGED one. Both, not one or the
    // other: two rules with the same qualifier paint the same element in the
    // same state, so splitting the ink across one and the ground across the
    // other is one more way to have a pair nothing measures — but which of the
    // two wins a property they both set is decided by specificity, which this
    // parser does not compute. Measuring every rule alone and then all of them
    // together covers both outcomes, and over-approximating costs a measured
    // row that passes where under-approximating costs a shipped defect. (An
    // earlier draft merged INSTEAD of keeping the singles, and silently
    // re-opened the three variant spellings round 3 closed: a higher-specificity
    // forge written EARLIER in the file lost to a lower-specificity real rule
    // written later.)
    const groups = new Map();
    for (const v of rules) {
      if (v === base || isKeyframeStop(v)) continue;
      // `variantSuffix` answers null for a selector that is textually the base's
      // — it is written for "is this a NARROWER restatement". A SECOND rule with
      // the SAME selector is the widest restatement there is, and the browser
      // simply cascades the two together, so it is a context here.
      const suffix = v.selector === base.selector ? '' : variantSuffix(v.selector, base.selector);
      if (suffix === null) continue;
      if (selfGroundedSet.has(v)) continue;
      if (ruleKey(v) in SELF_GROUNDED_EXEMPT) continue;
      const vv = localVars(v.body);
      const colour = declOf(v.body, 'color');
      const paint = paintOf(v.body);
      const rebinds = Object.keys(vv).some((k) => k in vars);
      if (!rebinds && !isColour(colour) && !paint.paints) continue;
      // Cross-file variants are real (a component sheet retinting a primitive),
      // so the file is not a filter — but the label has to name it.
      const as = v.file === base.file ? v.selector : ruleKey(v);
      const one = {
        suffix: ` [as ${as}]`,
        vars: { ...vars, ...vv },
        colour: isColour(colour) ? colour : undefined,
        // Both rules match the SAME element, so a variant's background replaces
        // the base's in the cascade — it does not layer over it.
        paint: paint.paints ? paint : undefined,
        rule: v,
      };
      out.push(one);
      const g = groups.get(suffix) ?? { names: [], vars: { ...vars }, colour: undefined, paint: undefined, rule: v };
      g.names.push(as);
      Object.assign(g.vars, vv);
      if (one.colour !== undefined) g.colour = one.colour;
      if (one.paint !== undefined) g.paint = one.paint;
      g.rule = v;
      groups.set(suffix, g);
    }
    for (const g of groups.values()) {
      if (g.names.length > 1) out.push({ ...g, suffix: ` [as ${g.names.join(' + ')}]` });
    }
    return out;
  };

  /** Measure one ink against one ground, in both themes. The single place a
   *  `measured` row or an unmeasurable-paint problem is produced. */
  const measureOn = (label, fgExpr, paint, ground, tokenLayers) => {
    if (paint.image !== null) {
      // The header's standing claim is that an unparsed paint is a FAIL and
      // never a skip. `background-image` used not to be read at all, so a rule
      // that painted its own opaque ground with a gradient and put unreadable
      // text on it was skipped in silence (final2-gates F3). An image cannot be
      // reduced to one colour, so the only honest outcomes are a reason or a
      // different design.
      problems.push(
        `${label}: background-image ${paint.image} is a paint that cannot be reduced to a colour`
        + ' — an unparsed paint is a FAIL, never a skip: give the rule a reason in SELF_GROUNDED_EXEMPT'
        + ' (as .attach-strip has, for the scrim over a user image) or do not put text on it',
      );
      return;
    }
    const bgExpr = paint.colour;
    for (const [theme, palette] of THEMES) {
      const tokens = Object.assign({}, palette, ...tokenLayers);
      try {
        if (!isPaint(bgExpr)) throw new Error(`no ground to measure on (background ${bgExpr})`);
        const bg = resolveColor(bgExpr, tokens);
        if (bg[3] !== 1 && ground === undefined) {
          problems.push(`${theme} ${label}: background ${bgExpr} is translucent and has no GROUNDS entry`);
          continue;
        }
        const chain = bg[3] === 1 && ground === undefined ? [bgExpr] : [...(ground?.under ?? []), bgExpr];
        add(label, theme, ratio(fgExpr, chain, tokens), ground?.floor ?? 4.5, `${fgExpr} on ${bgExpr}`);
      } catch (e) {
        problems.push(`${theme} ${label}: ${e.message} — add a GROUNDS entry or an exemption with a reason`);
      }
    }
  };

  /** Measure `fg` on `host`'s ground, once per context of the host. `own` are
   *  custom properties declared by the rule being measured, which win over the
   *  host's (a pseudo-element or a descendant may retint locally). */
  const measureThrough = (host, fg, labelBase, own = {}, labelCtx = (s) => s) => {
    const ground = GROUNDS[ruleKey(host)];
    const hostPaint = paintOf(host.body);
    for (const ctx of contextsFor(host)) {
      measureOn(
        `${labelBase}${labelCtx(ctx.suffix)}`,
        fg,
        ctx.paint ?? hostPaint,
        ground,
        [ctx.vars, own],
      );
    }
  };

  // 1 + 2: self-grounded rules and their variants.
  for (const rule of selfGrounded) {
    const k = ruleKey(rule);
    if (k in SELF_GROUNDED_EXEMPT) continue;
    const ground = GROUNDS[k];
    const baseColour = declOf(rule.body, 'color');
    const basePaint = paintOf(rule.body);
    for (const ctx of contextsFor(rule)) {
      measureOn(`${k}${ctx.suffix}`, ctx.colour ?? baseColour, ctx.paint ?? basePaint, ground, [ctx.vars]);
    }
  }

  // 3: pseudo-element children of a self-grounded rule inherit its background,
  // in every one of its variant contexts.
  const byKey = new Map(selfGrounded.map((r) => [ruleKey(r), r]));
  let pseudoCount = 0;
  const pseudoKeys = new Set();
  for (const rule of rules) {
    if (isKeyframeStop(rule)) continue;
    const at = rule.selector.lastIndexOf('::');
    if (at <= 0) continue;
    const fg = declOf(rule.body, 'color');
    if (!isColour(fg) || paintOf(rule.body).paints) continue;
    // The host is the rule that paints the element this pseudo hangs off. An
    // exact key match only finds it when the pseudo spells its host EXACTLY as
    // the self-grounded rule does — the same string comparison that let three
    // variant spellings through contextsFor, one function up. So fall back to
    // the subject-compound match: `.msg-assist .md-body .callout::before` and
    // `.callout[data-callout='x']::before` both hang off `.msg-assist
    // .callout`, which paints them.
    const hostSel = rule.selector.slice(0, at);
    const host =
      byKey.get(`${rule.file} ${hostSel}`) ??
      selfGrounded.find((h) => h.selector === hostSel) ??
      selfGrounded.find((h) => variantSuffix(hostSel, h.selector) !== null);
    if (host === undefined) continue;
    if (`${rule.file} ${rule.selector}` in SELF_GROUNDED_EXEMPT) continue;
    if (ruleKey(host) in SELF_GROUNDED_EXEMPT) continue;
    pseudoCount++;
    pseudoKeys.add(ruleKey(rule));
    measureThrough(host, fg, ruleKey(rule), localVars(rule.body));
  }

  // 2b: DESCENDANTS. A rule that sets a colour, supplies no ground of its own,
  // and whose selector NAMES a self-grounded ancestor is painted on that
  // ancestor's ground — and the selector says so, so this needs no DOM
  // knowledge and no registration. `.msg-assist .callout strong` is painted on
  // the callout's tint, in every one of the callout's five variant contexts,
  // and nothing measured it.
  //
  // Only the CLOSEST named ancestor that paints is used per selector in the
  // list: a nearer ground occludes a farther one, and walking every ancestor
  // would measure grounds the element cannot see.
  const paintersBySubject = new Map();
  for (const h of selfGrounded) {
    for (const s of selectorList(h.selector)) {
      const sub = subjectCompound(s);
      if (!paintersBySubject.has(sub)) paintersBySubject.set(sub, []);
      paintersBySubject.get(sub).push(h);
    }
  }
  let descendantCount = 0;
  const descendantKeys = new Set();
  for (const rule of rules) {
    if (isKeyframeStop(rule)) continue;
    const fg = declOf(rule.body, 'color');
    if (!isColour(fg) || paintOf(rule.body).paints) continue;
    if (ruleKey(rule) in SELF_GROUNDED_EXEMPT) continue;
    const hosts = new Map();
    for (const s of selectorList(rule.selector)) {
      const chain = compoundChain(s);
      for (let i = chain.length - 2; i >= 0; i--) {
        const painters = (paintersBySubject.get(chain[i]) ?? []).filter(
          (h) => !(ruleKey(h) in SELF_GROUNDED_EXEMPT) && h !== rule,
        );
        if (painters.length === 0) continue;
        for (const h of painters) if (!hosts.has(ruleKey(h))) hosts.set(ruleKey(h), h);
        break;
      }
    }
    if (hosts.size === 0) continue;
    descendantCount++;
    descendantKeys.add(ruleKey(rule));
    const own = localVars(rule.body);
    for (const host of hosts.values()) {
      measureThrough(host, fg, `${ruleKey(rule)} [in ${ruleKey(host)}]`, own);
    }
  }

  // 4: hand-written ground, stylesheet colour.
  for (const [k, entry] of Object.entries(INHERITED_GROUNDS)) {
    const rule = rules.find((r) => ruleKey(r) === k);
    if (rule === undefined) {
      problems.push(`stale INHERITED_GROUNDS entry: no rule ${k}`);
      continue;
    }
    const fg = declOf(rule.body, 'color');
    if (!isColour(fg)) {
      problems.push(`INHERITED_GROUNDS ${k} sets no colour of its own`);
      continue;
    }
    for (const [theme, palette] of THEMES) {
      try {
        add(k, theme, ratio(fg, entry.under, { ...palette, ...localVars(rule.body) }), entry.floor ?? 4.5, `${fg} on ${entry.under.join(' / ')}`);
      } catch (e) {
        problems.push(`${theme} ${k}: ${e.message}`);
      }
    }
  }

  // 5: element opacity.
  const faded = [];
  for (const rule of rules) {
    if (isKeyframeStop(rule)) continue;
    const raw = declOf(rule.body, 'opacity');
    if (raw === null) continue;
    const n = opacityNumber(raw);
    if (n === null) {
      problems.push(`${ruleKey(rule)}: opacity "${raw}" is not a static value — it cannot be measured, so it cannot ship`);
      continue;
    }
    if (n <= 0 || n >= 1) continue;
    faded.push({ rule, value: n, k: `${ruleKey(rule)} ${n}` });
  }
  for (const f of faded) {
    const entry = OPACITY_REGISTRY[f.k];
    if (entry === undefined) {
      problems.push(`unregistered fade ${f.k} — add it to OPACITY_REGISTRY with the pairs it composites or a reason it composites no coloured content`);
      continue;
    }
    // An entry is EXACTLY one of the two legal shapes: the pairs it composites,
    // or a reason it composites no coloured content. This used to be
    // `if (!('pairs' in entry)) continue;`, so an entry carrying neither — a
    // `knownBelowFloor` again, say, the escape hatch this round deleted — was
    // silently skipped by the GATE while only the suite objected. Gate and
    // suite disagreeing about whether the hatch exists is worse than the hatch.
    const shape = Object.keys(entry).sort().join('+');
    if (shape !== 'pairs' && shape !== 'noText') {
      problems.push(`OPACITY_REGISTRY ${f.k} is {${shape}} — an entry must carry EXACTLY one of \`pairs\` (what it composites) or \`noText\` (why it composites no coloured content), and nothing else`);
      continue;
    }
    if (shape === 'noText') continue;
    for (const [label, fg, chain, floor] of entry.pairs) {
      for (const [theme, palette] of THEMES) {
        try {
          add(`${f.k} — ${label}`, theme, ratio(fg, chain, palette, f.value), floor, `${fg} at ${f.value}`);
        } catch (e) {
          problems.push(`${theme} ${f.k} — ${label}: ${e.message}`);
        }
      }
    }
  }

  // 6: keyframe troughs — the LIST is gated, not the ratio.
  const troughs = keyframeTroughs(root);
  for (const t of troughs) {
    if (t.min === null) {
      problems.push(`@keyframes ${t.file} ${t.name} has an opacity stop that is not a static value`);
      continue;
    }
    if (!(t.key in KEYFRAME_TROUGHS)) {
      problems.push(`unregistered keyframe trough ${t.key} — add it to KEYFRAME_TROUGHS with the elements it animates and their reduced-motion steady state`);
    }
  }

  // stale registry entries — a registry that outlives its rule is a comment
  // pretending to be a gate.
  const liveRules = new Set(rules.map(ruleKey));
  const liveSelfGrounded = new Set(selfGrounded.map(ruleKey));
  const liveFades = new Set(faded.map((f) => f.k));
  const liveTroughs = new Set(troughs.map((t) => t.key));
  const stale = {
    grounds: Object.keys(GROUNDS).filter((k) => !liveSelfGrounded.has(k)),
    exempt: Object.keys(SELF_GROUNDED_EXEMPT).filter((k) => !liveRules.has(k)),
    inherited: Object.keys(INHERITED_GROUNDS).filter((k) => !liveRules.has(k)),
    opacity: Object.keys(OPACITY_REGISTRY).filter((k) => !liveFades.has(k)),
    keyframes: Object.keys(KEYFRAME_TROUGHS).filter((k) => !liveTroughs.has(k)),
  };
  for (const [kind, keys] of Object.entries(stale)) {
    for (const k of keys) problems.push(`stale ${kind} registry entry: ${k} matches no rule in the stylesheets`);
  }

  // ── the census of what this auditor CANNOT measure ────────────────────────
  // Every round of this gate has been forged by the same move: it measures the
  // shapes someone thought of, and CSS has more shapes than that. So the audit
  // now also computes its own blind spot instead of describing it in prose —
  // every rule that sets a `color` and that NO route grounded. The gate prints
  // the count; the suite pins that the list is exactly the rules whose ground
  // is not recoverable from the selector, which is the only honest claim this
  // file can make about them.
  //
  // The header used to assert of this set that "their ground is inherited from
  // an arbitrary ancestor, which is DOM knowledge a stylesheet parser cannot
  // recover". That was false for the slice that named its ancestor in its own
  // selector, and false for every variant of a rule that DOES name its ground —
  // 20 rules between them, one of which was shipping at 3.03:1. Both are
  // measured now, so the sentence is finally true of what is left.
  const groundedKeys = new Set([
    ...selfGroundedKeys,
    ...pseudoKeys,
    ...descendantKeys,
    ...Object.keys(INHERITED_GROUNDS),
    ...Object.keys(SELF_GROUNDED_EXEMPT),
  ]);
  for (const base of selfGrounded) for (const ctx of contextsFor(base)) groundedKeys.add(ruleKey(ctx.rule));
  const uncovered = rules
    .filter((r) => !isKeyframeStop(r) && isColour(declOf(r.body, 'color')) && !groundedKeys.has(ruleKey(r)))
    .map(ruleKey);

  return {
    sheets,
    themes: { DARK, LIGHT },
    measured,
    problems,
    stale,
    uncovered,
    counts: {
      rules: rules.length,
      selfGrounded: selfGrounded.length,
      selfGroundedContexts: measured.length,
      pseudo: pseudoCount,
      descendant: descendantCount,
      inherited: Object.keys(INHERITED_GROUNDS).length,
      faded: faded.length,
      keyframes: troughs.length,
      uncovered: uncovered.length,
    },
    fades: faded.map((f) => ({ key: f.k, value: f.value })),
    troughs,
  };
}
