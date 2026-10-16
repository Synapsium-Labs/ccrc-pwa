// Keyboard focus is the design system's, and it is a census.
//
// WHAT WAS WRONG. `@ccrc/ui` carried ZERO `:focus-visible` rules across every
// component it ships. The ring lived in one blanket rule in the app's
// `base.css`, which has two consequences a package should not accept: no
// component could show a focus state in Storybook (that stylesheet is not
// loaded there), so a design system shipping 24 components could neither
// demonstrate nor review keyboard focus for any of them; and no component
// could vary its ring, having none of its own.
//
// THIS CHANGED NO PIXELS, and the build proves it rather than the prose:
// `FOCUS_RING` compiles to `outline-style: var(--tw-outline-style)` (registered
// `initial-value: solid`), `outline-width: 2px`, `outline-color: var(--accent)`
// and `outline-offset: 2px` — which is exactly what base.css's
// `outline: 2px solid var(--accent); outline-offset: 2px` compiles to in the
// same bundle. In the app the unlayered blanket rule wins on cascade order and
// paints what it always painted; in Storybook these utilities are what draw.
//
// WHY A CENSUS AND NOT A LIST. Six components were given the ring first and
// SEVEN MORE still rendered a focusable control without one — measured, not
// guessed. A list would have frozen that half-done state; a census makes the
// next component that renders a `<button>` red until it joins.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import { loadThemes, ratio } from '../design/audit.mjs';
import * as ui from '@ccrc/ui';
import { BACK_BUTTON, BARE_ROW, DOOR, FOCUS_RING, LIST_ROW, SELECT, TEXT_INPUT } from '@ccrc/ui';

/** The ring, by any of its names. `FOCUS_RING` itself, or one of the shared
 *  class strings built from it — each of which is asserted to contain it
 *  below, so this list cannot drift into naming something that does not ring. */
const RINGED = /\b(FOCUS_RING|BARE_ROW|LIST_ROW|TEXT_INPUT|SELECT|BACK_BUTTON|DOOR)\b/;

const UI_SRC = path.join(import.meta.dirname, '..', '..', 'ui', 'src');
const BASE_CSS = readFileSync(
  path.join(import.meta.dirname, '..', 'src', 'styles', 'base.css'), 'utf8');

/** Component sources only — stories render whatever they like. */
function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...componentFiles(p));
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.stories.tsx')) out.push(p);
  }
  return out;
}

/** Comment-free source. A `<button>` named in prose is not a control, and
 *  `typed-label.tsx` describes one in its header — the reason this strip
 *  exists rather than a bare grep. */
const codeOnly = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');

/** `select` joined with Task 13: `Select` is a focusable primitive, and a
 *  census that never counted a `<select>` could not notice one losing its
 *  ring. Counting it was not enough on its own — see the per-control case. */
const RENDERS_CONTROL = /<(button|input|textarea|select)([\s>]|$)/;

const files = componentFiles(UI_SRC).map((f) => ({
  rel: path.relative(UI_SRC, f).split(path.sep).join('/'),
  code: codeOnly(readFileSync(f, 'utf8')),
}));

/** The index of the quote that closes the string or template literal opening
 *  at `i`. A template's `${…}` holes are skipped as code, so a backtick or a
 *  brace inside one does not end it. */
function closeQuote(code: string, i: number): number {
  const q = code[i];
  for (let j = i + 1; j < code.length; j += 1) {
    const ch = code[j];
    if (ch === '\\') j += 1;
    else if (q === '`' && ch === '$' && code[j + 1] === '{') j = stopAt(code, j + 2, '}');
    else if (ch === q) return j;
  }
  return code.length;
}

/** The index of the first `stops` character at bracket depth 0 from `from`,
 *  or of the bracket that closes the one `from` sits inside. Strings and
 *  templates are stepped over, so `=>` in an `onClick` never ends a tag and a
 *  `;` in a class string never ends a declaration. */
function stopAt(code: string, from: number, stops: string): number {
  let depth = 0;
  for (let j = from; j < code.length; j += 1) {
    const ch = code[j]!;
    if (ch === '"' || ch === "'" || ch === '`') j = closeQuote(code, j);
    else if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) { if (depth === 0) return j; depth -= 1; }
    else if (depth === 0 && stops.includes(ch)) return j;
  }
  return code.length;
}

/** A tag's `className` expression: the braces' contents, or the quoted text. */
function classNameOf(tag: string): string | null {
  const m = /\bclassName=/.exec(tag);
  if (m === null) return null;
  const at = m.index + m[0].length;
  if (tag[at] === '{') return tag.slice(at + 1, stopAt(tag, at + 1, '}'));
  if (tag[at] === '"' || tag[at] === "'") return tag.slice(at + 1, closeQuote(tag, at));
  return null;
}

/** Does this expression reach the ring? By a carrier's name, or through a
 *  constant this file declares whose initializer does — `KEYCAP`,
 *  `RADIO_INPUT`, `buttonVariants`, `OptionRow`'s `cls` — however deep. */
function reachesRing(code: string, expr: string, seen = new Set<string>()): boolean {
  if (RINGED.test(expr)) return true;
  for (const [id] of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const decl = new RegExp(`\\b(?:const|let)\\s+${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b\\s*(?::[^=]+)?=(?![=>])`).exec(code);
    if (decl === null) continue;
    const at = decl.index + decl[0].length;
    if (reachesRing(code, code.slice(at, stopAt(code, at, ';')), seen)) return true;
  }
  return false;
}

/** Every focusable control a component file renders, with its own tag.
 *  Named by its tag, not a line: the code is comment-free, so its line
 *  numbers are not the file's. */
const CONTROLS = files.flatMap((f) =>
  [...f.code.matchAll(/<(button|input|textarea|select)\b/g)].map((m) => {
    const tag = f.code.slice(m.index, stopAt(f.code, m.index + 1, '>') + 1);
    return { at: `${f.rel}: ${tag.replace(/\s+/g, ' ').slice(0, 120)}`, code: f.code, tag };
  }));

describe('every focusable control in @ccrc/ui carries the ring', () => {
  it('found controls to check — the census is not vacuously empty', () => {
    // Without this the suite passes by matching nothing, which is how a census
    // guard dies. Measured 17 component files rendering a control with Task 13.
    const controls = files.filter((f) => RENDERS_CONTROL.test(f.code));
    expect(controls.length).toBeGreaterThanOrEqual(12);
  });

  it('every carrier this census accepts really does carry the ring', () => {
    // Without this the regex above is a list of words. Each one must resolve
    // to a class string that contains the ring, or a component could join the
    // census by being named rather than by ringing anything.
    for (const [name, value] of Object.entries({
      BARE_ROW, LIST_ROW, TEXT_INPUT, SELECT, BACK_BUTTON, DOOR,
    })) {
      expect(value, name).toContain('focus-visible:outline-2');
      // `outline-phosphor`, not `outline-accent`: the brand hue's Tailwind KEY
      // was renamed when `accent` was freed for shadcn. The CSS variable it
      // resolves to is still `--accent`, which is what the rule comparison
      // below asserts — so this is a spelling change and not a colour one.
      expect(value, name).toContain('focus-visible:outline-phosphor');
    }
  });

  it('carries one FOCUS_RING per control, not one per FILE — read from the control\'s own className', () => {
    // PER CONTROL, and that distinction was measured rather than assumed. The
    // first spelling of this test asked only whether the file MENTIONED
    // FOCUS_RING; deleting the ring from one of tool-card's three buttons left
    // it green, because the other two still mentioned it. A census that counts
    // files cannot see a control regress inside a file that already passes.
    //
    // A control REMOVED FROM THE TAB ORDER needs no ring, and that is a rule
    // rather than an escape hatch: `tabIndex={-1}` means the thing cannot be
    // keyboard-focused, so a focus style on it would be dead code pretending
    // to be coverage. AttachButton's `<input type="file">` is the live case —
    // `display: none` AND `tabIndex={-1}`, clicked through a ref by the
    // visible button beside it.
    //
    // A control is ringed by naming FOCUS_RING, or by wearing a shared class
    // string that already carries it. The second arm arrived with
    // `CollapsibleStrip`, whose head became `<BareRow>`'s six utilities — the
    // ring among them — so the component stopped importing FOCUS_RING; the
    // fix is to accept the carriers, not to re-import a constant for the
    // census's benefit: a second spelling of the ring on one element is the
    // duplication the whole wave is removing.
    //
    // NOT BY COUNTING MENTIONS, which this case did until Task 13's review,
    // and twice it counted the wrong ones. First an IMPORT: when
    // `CollapsibleStrip` switched to `BARE_ROW` its import line counted as the
    // ring, and a mutation that removed the constant from the className while
    // leaving the import stayed green. The import was discounted. Then a
    // DEFINITION: `select.tsx` defines `SELECT = cn(TEXT_INPUT, 'px-2')`, and
    // `text-input.tsx` writes `${FOCUS_RING}` into `TEXT_INPUT` — two mentions
    // each, against one control. So `<select className={cn('w-full',
    // className)}>`, a Select with no ring, stayed green, and so did the same
    // TextInput (measured; the TextInput half predates Task 13). A file that
    // builds a carrier will always mention the ring more often than it renders
    // controls. So the census no longer counts: it reads each control's own
    // `className` and asks whether THAT reaches the ring — by a carrier's name
    // or through a constant the file declares (`reachesRing`). A control with
    // no className, or one that reaches the ring only through a prop, reds.
    const checked = CONTROLS.filter((c) => !/tabIndex=\{-1\}|tabindex="-1"|type="hidden"/.test(c.tag));
    // Measured with Task 13: 21 controls in 17 files, plus AttachButton's
    // file input, which is out of the tab order.
    expect(checked.length, 'the per-control read found nothing to check').toBeGreaterThanOrEqual(20);
    const bare = checked
      .filter((c) => { const cls = classNameOf(c.tag); return cls === null || !reachesRing(c.code, cls); })
      .map((c) => c.at);
    expect(
      bare,
      'every <button>/<input>/<select> a component renders owns a focus ring — import FOCUS_RING from lib/focus',
    ).toEqual([]);
  });

  it('is the ring base.css already drew, token for token', () => {
    // The two must not drift: the app's rule wins the cascade, so a FOCUS_RING
    // that said something else would be invisible in the app and WRONG in
    // Storybook — the worst shape, because only the design system would lie.
    expect(FOCUS_RING).toContain('focus-visible:outline-2');
    expect(FOCUS_RING).toContain('focus-visible:outline-phosphor');
    expect(FOCUS_RING).toContain('focus-visible:outline-offset-2');
    expect(FOCUS_RING).not.toContain('focus:');          // never a mouse press
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(BASE_CSS)?.[1] ?? '';
    expect(rule.replace(/\s+/g, ' ')).toContain('outline: 2px solid var(--accent)');
    expect(rule.replace(/\s+/g, ' ')).toContain('outline-offset: 2px');
  });

  it('a text field draws one focus cue: TEXT_INPUT carries FOCUS_RING and no `focus:border-*`', () => {
    // D-5101's focus clause. The field drew TWO cues at once — the phosphor
    // border (`focus:border-phosphor`) and the ring — and in the app it drew
    // both whatever the field said, because base.css's unlayered blanket
    // `:focus-visible` outline paints every focused element. Every other
    // control draws the ring alone; the field now does too.
    //
    // By UTILITY, and any focus state: a `focus-visible:border-*` or a
    // `focus-within:border-*` is the same second cue under another name.
    // `SELECT` is `cn(TEXT_INPUT, 'px-2')`, so it inherits the answer, and is
    // read here so a select-only border cannot come back either.
    for (const [name, value] of Object.entries({ TEXT_INPUT, SELECT })) {
      const classes = value.split(/\s+/);
      for (const ring of FOCUS_RING.split(/\s+/)) expect(classes, `${name} lost the ring`).toContain(ring);
      expect(classes.filter((c) => /^focus(-visible|-within)?:border-/.test(c)), `${name} draws a second cue`)
        .toEqual([]);
    }
  });

  it('clears WCAG 2.1 SC 1.4.11 (3:1) on every ground, in every palette', () => {
    // A focus indicator is a non-text contrast requirement. --accent is the
    // ring; --bg-page, --bg-surface and --bg-raised are what a focused control
    // sits on. Measured 4.57 at worst (GitHub Light, on raised).
    const { DARK, byName } = loadThemes(path.join(import.meta.dirname, '..'));
    const all: [string, Record<string, string>][] = [['DARK', DARK], ...Object.entries(byName)];
    const thin = all.flatMap(([name, theme]) =>
      ['var(--bg-page)', 'var(--bg-surface)', 'var(--bg-raised)']
        .map((ground) => ({ name, ground, r: ratio('var(--accent)', [ground], theme) }))
        .filter(({ r }) => r < 3)
        .map(({ ground, r }) => `${name} ring on ${ground} = ${r.toFixed(2)}`));
    expect(thin).toEqual([]);
  });
});

// ── the ring DRAWS, wherever @ccrc/ui is the only stylesheet ────────────────
//
// WHAT WAS WRONG (Task 13, review). Carrying the ring is not drawing it.
// `TEXT_INPUT` carried `FOCUS_RING` and ALSO `outline-none`, which Tailwind v4
// compiles to `--tw-outline-style: none; outline-style: none` — and the ring's
// `focus-visible:outline-2` takes its style FROM that variable
// (`outline-style: var(--tw-outline-style)`). So the ring resolved to `none`.
// In the app nobody saw it, because base.css's unlayered blanket
// `:focus-visible` outline paints over every layer; in Storybook, which loads
// only this package's CSS, a focused TextInput or Select drew NO cue at all
// once its phosphor border went (measured in a real Storybook build, the
// field focused and `:focus-visible`, `outline-style: none`). Every census
// above passed, because every one of them reads class NAMES.
//
// SO THIS ONE READS WHAT THE NAMES COMPILE TO. Each class in scope is built by
// the real Tailwind compiler against the package's own theme.css, and the
// question is asked of the CSS that comes out: on a ringed control, does
// anything but the ring write the outline, or paint under focus? A hand-kept
// list of "bad utilities" (`outline-none`, `outline-hidden`, `outline-0`,
// `[outline:none]`, `focus-visible:outline-transparent`, …) would be the next
// thing to go stale; the compiler already knows every spelling.
//
// SCOPE, and its limit, said once. (1) Every string the package exports that
// carries the ring, by VALUE — so `SELECT`, which is `cn(TEXT_INPUT, 'px-2')`
// and whose classes are not written in its own file, is read as it renders.
// (2) Every class written in a component file that renders a focusable
// control. The second is per FILE, not per element: a file that renders a
// ringed control may not spell an outline utility on any element. Stricter
// than the cascade — and today no such file needs one (the sheet panel's
// `outline-none` is in a file that renders no control).
const TW_ROOT = path.dirname(createRequire(import.meta.url).resolve('tailwindcss/package.json'));
const UI_STYLES = path.join(UI_SRC, 'styles');
const THEME_CSS = readFileSync(path.join(UI_STYLES, 'theme.css'), 'utf8');

/** theme.css's imports, resolved the way the build resolves them: the
 *  package's own sheets by path, Tailwind's from the installed package. */
async function loadStylesheet(id: string, base: string) {
  const p = id.startsWith('tailwindcss/')
    ? path.join(TW_ROOT, id.slice('tailwindcss/'.length))
    : path.resolve(base, id);
  return { path: p, base: path.dirname(p), content: readFileSync(p, 'utf8') };
}

/** The `@layer utilities` block of a build — the only part a class string
 *  contributes; the theme's variables and `@property` registrations are the
 *  same in every build and say nothing about the classes. */
function utilitiesOf(css: string): string {
  const head = /@layer utilities\s*\{/.exec(css);
  if (head === null) return '';
  let depth = 0;
  for (let i = head.index + head[0].length - 1; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(head.index + head[0].length, i);
  }
  throw new Error('unbalanced @layer utilities block');
}

/** A FRESH compiler per build: `build()` accumulates every candidate it has
 *  ever been given, so a shared one would attribute a class to the CSS of
 *  every class before it. Measured at about 5ms a compile. */
async function compiled(candidates: readonly string[]): Promise<string> {
  const compiler = await compile(THEME_CSS, { base: UI_STYLES, loadStylesheet });
  return utilitiesOf(compiler.build([...candidates]));
}

/** Writes the outline — any of the longhands the ring sets, the shorthand,
 *  or the variable the ring reads its style from. `outline-offset` is not
 *  here: moving the ring is not hiding it. */
const WRITES_OUTLINE = /(^|[\s;{])(outline(-style|-width|-color)?|--tw-outline-style)\s*:/;
/** Paints under focus: any rule whose selector reaches a focus state. */
const UNDER_FOCUS = /:focus/;

const RING = new Set(FOCUS_RING.split(/\s+/));

/** The classes among `tokens`, other than the ring's own three, whose
 *  compiled CSS matches `test`. One build of the whole set first; only a hit
 *  pays for the per-class builds that name the culprit. */
async function offenders(tokens: readonly string[], test: RegExp): Promise<string[]> {
  const rest = [...new Set(tokens)].filter((t) => t !== '' && !RING.has(t));
  if (!test.test(await compiled(rest))) return [];
  const out: string[] = [];
  for (const t of rest) if (test.test(await compiled([t]))) out.push(t);
  return out;
}

/** Every whitespace-separated word inside a string or template literal of
 *  comment-free code — a class string, wherever it is written. Template
 *  holes are dropped (they name constants, read by value in half 1). */
function literalWords(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const text = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    out.push(...text.split(/\s+/).filter((w) => w !== ''));
  }
  return out;
}

/** Half 1: every exported string that carries the ring, read as it renders. */
const CARRIERS = Object.entries(ui)
  .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].includes('focus-visible:outline-2'));
/** Half 2: every component file that renders a focusable control. */
const CONTROL_FILES = files.filter((f) => RENDERS_CONTROL.test(f.code));

describe('the ring draws: nothing on a ringed control hides it or adds a second cue', () => {
  it('found carriers and control files to compile — neither half is vacuous', () => {
    // Measured: FOCUS_RING and the eight carriers built from it, and the
    // control-rendering files the census above counts.
    expect(CARRIERS.map(([name]) => name)).toEqual(expect.arrayContaining(
      ['FOCUS_RING', 'TEXT_INPUT', 'SELECT', 'BARE_ROW', 'LIST_ROW', 'BACK_BUTTON', 'DOOR']));
    expect(CONTROL_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it('the compiler is really read: the ring writes the outline, `outline-none` does too', async () => {
    // The probe for the probe. Without it a build that came back empty — a
    // broken import, a renamed layer — would make both cases below pass by
    // seeing no CSS at all.
    expect(await compiled(['focus-visible:outline-2'])).toMatch(WRITES_OUTLINE);
    expect(await offenders(['outline-none', 'w-full'], WRITES_OUTLINE)).toEqual(['outline-none']);
    expect(await offenders(['focus:border-phosphor', 'w-full'], UNDER_FOCUS)).toEqual(['focus:border-phosphor']);
  });

  it('no carrier and no control file writes the outline but the ring', async () => {
    const hidden: string[] = [];
    for (const [name, value] of CARRIERS) {
      for (const c of await offenders(value.split(/\s+/), WRITES_OUTLINE)) hidden.push(`${name}: ${c}`);
    }
    for (const f of CONTROL_FILES) {
      for (const c of await offenders(literalWords(f.code), WRITES_OUTLINE)) hidden.push(`${f.rel}: ${c}`);
    }
    expect(hidden, 'a ringed control writes its own outline — in Storybook the ring then draws nothing').toEqual([]);
  });

  it('no carrier and no control file paints anything under focus but the ring (one cue)', async () => {
    // D-5101's focus clause, held for every composition rather than two
    // constants. The case above it read `TEXT_INPUT` and `SELECT` by name, so
    // a `focus:border-phosphor` added to `TEXT_INPUT_STACKED` — the stacked
    // fields' composition, and the one that still animates its border — stayed
    // green (measured). Read by compiled selector, so `focus:`,
    // `focus-visible:`, `focus-within:` and a `group-`/`peer-` focus variant
    // are one finding, and so is a ring of another kind (`focus-visible:ring-2`).
    const doubled: string[] = [];
    for (const [name, value] of CARRIERS) {
      for (const c of await offenders(value.split(/\s+/), UNDER_FOCUS)) doubled.push(`${name}: ${c}`);
    }
    for (const f of CONTROL_FILES) {
      for (const c of await offenders(literalWords(f.code), UNDER_FOCUS)) doubled.push(`${f.rel}: ${c}`);
    }
    expect(doubled, 'a ringed control draws a second focus cue').toEqual([]);
  });

  it('the app never redresses a control under focus', () => {
    // The other half of the same rule. A call site may PLACE a control and
    // never REDRESS it (ui-package-boundary.test.ts says so for stylesheets);
    // a `className` carrying `focus:border-…` onto a `TextInput` is the second
    // cue coming back from outside the package. Lexical, because a variant is
    // named in the class itself: any focus-state variant in a literal under
    // pwa/src is the finding.
    const APP_SRC = path.join(import.meta.dirname, '..', 'src');
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.tsx?$/.test(e.name) && !/\.(stories|test)\.tsx?$/.test(e.name) ? [p] : [];
    });
    const sources = walk(APP_SRC);
    expect(sources.length, 'the walk stopped seeing the app').toBeGreaterThan(50);
    const FOCUS_VARIANT = /^(?:[^\s:]+:)*(?:(?:group|peer|has|in)-)?focus(?:-visible|-within)?(?:\/[\w-]+)?:/;
    const found = sources.flatMap((abs) =>
      literalWords(codeOnly(readFileSync(abs, 'utf8')))
        .filter((w) => FOCUS_VARIANT.test(w))
        .map((w) => `${path.relative(APP_SRC, abs).split(path.sep).join('/')}: ${w}`));
    expect(found).toEqual([]);
  });
});
