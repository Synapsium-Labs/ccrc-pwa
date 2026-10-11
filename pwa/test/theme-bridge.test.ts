// The Tailwind theme bridge is checked, not merely commented.
//
// WHY THIS EXISTS. `ui/src/styles/theme.css` is the single file that maps
// ccrc's tokens into Tailwind's generated utilities, and until this test it
// was the most silent-failure-prone file in the design system with no guard of
// any kind. Its own header documents TWO bugs that shipped through it:
//
//   1. `@theme` without `inline` COPIES the value into the utility instead of
//      emitting the var() reference. The utility then bakes one theme's value
//      and never re-resolves under [data-theme]. The shadcn spike measured
//      exactly this as FAIL 3.73 LIGHT.
//   2. A self-referential alias — `--text-sm: var(--text-sm)` — is a circular
//      reference, which CSS drops, taking the token with it. Twelve of those
//      shipped at once; the cure was renaming six token families out of
//      Tailwind's reserved namespaces.
//
// Both are invisible: no warning, no build failure, and the contrast gate
// cannot see either one, because the gate parses stylesheet RULES and these
// are theme DECLARATIONS. A comment is a request; this is the mechanism.
//
// THE THIRD CLASS is prospective rather than historical, and it is the reason
// this file also carries SHADCN_RESERVED. Adopting shadcn's token names as
// aliases onto ccrc's — the "one day, nothing else changes" option — is
// destructive on arrival, and measurably so. `--color-accent` here means the
// PHOSPHOR, the primary button's fill at 75 render sites. In shadcn, `accent`
// is the muted hover surface and `primary` is the brand. The alias repaints
// `bg-accent` in all twelve palettes with no stylesheet rule for the gate to
// read and no test asserting a colour. `--radius-sm/md/lg/xl` collide the same
// way: ccrc maps them from `--r-*`, shadcn v4 derives them with calc() off a
// single `--radius`. Wave 1 already ruled on the principle when it RENAMED six
// families rather than aliasing them, "because an alias gives one value two
// names and the next reader cannot tell which is authoritative". This test is
// that ruling, enforced.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { THEMES } from '@ccrc/ui';
import path from 'node:path';

const UI_STYLES = path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles');
const themeCss = readFileSync(path.join(UI_STYLES, 'theme.css'), 'utf8');
const tokensCss = readFileSync(path.join(UI_STYLES, 'tokens.css'), 'utf8');

/** CSS comments carry example code — `--text-sm: var(--text-sm)` appears in
 *  theme.css's own header as the bug being described. Parsing them as
 *  declarations would red on the documentation of the thing this guards. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The `@theme` block's body, found by BALANCED BRACES rather than a lazy
 *  `[^}]*` — the block contains no nested braces today, but a future
 *  `@keyframes`-style entry would silently truncate the scan and this guard
 *  would then pass by seeing less, which is the worst failure a guard has. */
function themeBlock(css: string): { readonly head: string; readonly body: string } {
  const open = css.search(/@theme\b/);
  expect(open, 'theme.css declares no @theme block').toBeGreaterThanOrEqual(0);
  const brace = css.indexOf('{', open);
  const head = css.slice(open, brace).trim();
  let depth = 0;
  for (let i = brace; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return { head, body: css.slice(brace + 1, i) };
    }
  }
  throw new Error('@theme block is never closed');
}

/** `--key: value` pairs, in source order so a duplicate is visible as one. */
function declarations(body: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.push([m[1] ?? '', (m[2] ?? '').trim()]);
  }
  return out;
}

/** Every token `var(--x)` names, anywhere in a value. A value can hold several
 *  — `--animate-breathe` names a keyframe plus two tokens. */
const varsIn = (value: string): string[] =>
  [...value.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1] ?? '');

/** Tokens tokens.css declares in `:root`. The `:root` block specifically, not
 *  the file: a token declared ONLY under `[data-theme='x']` exists in one
 *  palette and is undefined in the other eleven, which is the same overloaded
 *  null `css-vars.test.ts` was written for, one layer up. */
function rootTokens(css: string): Set<string> {
  // Slice from AFTER the brace: the first `;`-segment would otherwise carry
  // the `:root {` prefix and its token would not match at the segment head —
  // which cost exactly one token, --bg-page, the page ground itself.
  const open = css.indexOf(':root {') + ':root {'.length;
  const close = css.indexOf('\n}', open);
  const body = css.slice(open, close);
  // SPLIT ON `;`, not on newlines. tokens.css packs the spacing ramp four to a
  // line (`--sp-1: 4px;   --sp-2: 8px;   …`), so a line-anchored scan sees
  // --sp-1 and misses --sp-2 through --sp-4 — which is how this guard first
  // ran, reporting seven of the app's own tokens as undeclared.
  return new Set(
    body.split(';')
      .map((seg) => /^(--[\w-]+)\s*:/.exec(seg.trim()))
      .flatMap((m) => (m === null ? [] : [m[1] ?? ''])),
  );
}

const { head, body } = themeBlock(stripComments(themeCss));
const decls = declarations(body);
const declared = rootTokens(stripComments(tokensCss));

describe('the @theme bridge resolves, and says inline', () => {
  it('parsed a block worth checking — the scan is not vacuously empty', () => {
    // Without this, every assertion below passes over an empty array if the
    // block moves or the brace walk breaks. Measured 125 declarations today.
    expect(decls.length).toBeGreaterThan(100);
  });

  it('says `@theme inline`, so every utility keeps the var() REFERENCE', () => {
    // Drop `inline` and `.bg-accent` bakes the dark hex. Twelve palettes then
    // render one palette's colours, and nothing reds: the utility is still
    // emitted, still valid CSS, still the right colour in exactly one theme.
    expect(head).toBe('@theme inline');
  });

  it('maps every entry onto a token tokens.css declares in :root', () => {
    const unresolved = decls.flatMap(([key, value]) =>
      varsIn(value).filter((t) => !declared.has(t)).map((t) => `${key}: var(${t})`));
    expect(unresolved).toEqual([]);
  });

  it('never maps a name onto itself', () => {
    // The circular-reference bug, which CSS resolves by dropping the
    // declaration — so the token does not fall back, it ceases to exist.
    const circular = decls
      .filter(([key, value]) => varsIn(value).includes(key))
      .map(([key]) => key);
    expect(circular).toEqual([]);
  });

  it('declares each name once', () => {
    const seen = new Set<string>();
    const twice = decls.map(([k]) => k).filter((k) => seen.has(k) || (seen.add(k), false));
    expect(twice).toEqual([]);
  });
});

// shadcn's token vocabulary, which this bridge must NOT adopt. These are not
// arbitrary: each is a name shadcn's own components reference, so once one is
// defined here a pasted component silently takes ccrc's value for a word that
// means something else in its own design language.
const SHADCN_RESERVED = [
  'background', 'foreground', 'card', 'card-foreground', 'popover',
  'popover-foreground', 'primary', 'primary-foreground', 'secondary',
  'secondary-foreground', 'muted', 'muted-foreground',
  // `accent` JOINED THIS LIST when the brand hue was renamed to `phosphor`.
  // It was ccrc's own key and therefore could not be reserved; now it is
  // free, and the point of freeing it was that shadcn may have it. ccrc
  // taking it back would re-create the collision the rename removed.
  'accent', 'accent-foreground',
  'destructive', 'destructive-foreground', 'border', 'input', 'ring',
];

describe('the bridge keeps ccrc vocabulary, not shadcn’s', () => {
  it('defines no shadcn colour name', () => {
    const keys = new Set(decls.map(([k]) => k));
    const collisions = SHADCN_RESERVED.filter((n) => keys.has(`--color-${n}`));
    expect(
      collisions,
      'aliasing shadcn token names gives one value two names — wave 1 renamed six '
      + 'families rather than alias them, for exactly this reason',
    ).toEqual([]);
  });

  it('calls the brand hue `phosphor`, and leaves `accent` free for shadcn', () => {
    // THE COLLISION IS GONE, which is what this wave did and all it did.
    // `--color-accent` used to mean ccrc's phosphor — the primary button's
    // fill — while every shadcn component writes `bg-accent` for a MUTED
    // HOVER SURFACE. One of the two had to give up the Tailwind key, and it
    // was cheaper here: FOUR utility call sites in `@ccrc/ui` and none in the
    // app, measured, against every shadcn component ever pasted.
    //
    // THE CSS VARIABLES DID NOT MOVE. `--accent`, `--accent-tint`,
    // `--accent-on-well` and `--ink-on-accent` are what twelve palettes bind
    // and what the stylesheets read; only the Tailwind KEY changed, so the
    // compiled colour is identical and the gate stayed at 3456.
    const theme = Object.fromEntries(decls);
    expect(theme['--color-phosphor']).toBe('var(--accent)');
    expect(theme['--color-phosphor-tint']).toBe('var(--accent-tint)');
    expect(theme['--color-phosphor-on-well']).toBe('var(--accent-on-well)');
    expect(theme['--color-ink-on-phosphor']).toBe('var(--ink-on-accent)');
    // And nothing re-takes the freed key — the reservation above says so for
    // every shadcn name, this says it for the one that used to be ours.
    expect(theme['--color-accent']).toBeUndefined();
  });

  it('still refuses the alias LAYER, which the rename did not authorise', () => {
    // WHAT THE RENAME DID NOT DO. The ruling this file enforces has two
    // halves, and only one of them was about `accent`:
    //
    //   1. the COLLISION — `bg-accent` meaning two different colours. Gone.
    //   2. the PRINCIPLE — "an alias gives one value two names and the next
    //      reader cannot tell which is authoritative", the reason wave 1
    //      RENAMED six families rather than aliasing them. UNTOUCHED.
    //
    // Mapping `--color-primary: var(--accent)` would satisfy (1) and break
    // (2): `phosphor` and `primary` would be two names for one value. That is
    // a design-system decision, not a refactor's, so the reservation above
    // still holds for all eighteen names and this test says why it holds even
    // now that the collision is gone.
    const keys = new Set(decls.map(([k]) => k));
    expect([...keys].filter((k) => SHADCN_RESERVED.some((n) => k === `--color-${n}`))).toEqual([]);
  });

  it('derives every radius from --r-*, not from a single shadcn --radius', () => {
    const radii = decls.filter(([k]) => /^--radius-/.test(k));
    expect(radii.length).toBeGreaterThan(0);
    for (const [key, value] of radii) {
      expect(value, `${key} should map a --r-* token`).toMatch(/^var\(--r-[\w-]+\)$/);
    }
  });
});

describe('the animation entries name keyframes that exist', () => {
  // `--animate-x` generates `.animate-x`, which references a @keyframes by
  // name. A typo there produces a utility that animates nothing, silently —
  // the same shape as the var() fallback css-vars.test.ts guards.
  const frames = new Set(
    [...stripComments(themeCss).matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1] ?? ''));

  it('every --animate-* resolves to a @keyframes in this file', () => {
    const animations = decls.filter(([k]) => k.startsWith('--animate-'));
    expect(animations.length).toBeGreaterThan(0);
    const missing = animations
      .map(([key, value]) => [key, (value.trim().split(/\s+/)[0] ?? '')] as const)
      .filter(([, frame]) => !frames.has(frame))
      .map(([key, frame]) => `${key} -> @keyframes ${frame}`);
    expect(missing).toEqual([]);
  });
});

describe('the @utility escapes resolve too', () => {
  // Named durations and z-indexes are declared as real utilities because
  // `duration-*` and `z-*` are NOT Tailwind namespaces — a --duration-press
  // theme key generates nothing at all. They sit outside the @theme block, so
  // the resolution check above never sees them.
  it('every var() in an @utility body names a declared token', () => {
    const bodies = [...stripComments(themeCss).matchAll(/@utility\s+([\w-]+)\s*\{([^}]*)\}/g)];
    expect(bodies.length).toBeGreaterThan(0);
    const unresolved = bodies.flatMap(([, name, decl]) =>
      varsIn(decl ?? '').filter((t) => !declared.has(t)).map((t) => `@utility ${name}: var(${t})`));
    expect(unresolved).toEqual([]);
  });
});

// ── THE `dark:` VARIANT ─────────────────────────────────────────────────────
//
// WHAT IT IS, and why it is not the alias layer the tests above refuse. A
// Tailwind VARIANT is a selector, not a token: it gives no value a second
// name, so the principle wave 1 ruled on — "an alias gives one value two
// names and the next reader cannot tell which is authoritative" — has nothing
// to say about it. What it does is make `dark:…` mean something here at all:
// ccrc's dark is the DEFAULT (`:root` is Phosphor & Ink), so Tailwind's own
// `dark` variant, which expects an opt-in `.dark` class or a
// `prefers-color-scheme` query, matches nothing on this console. A pasted
// shadcn component writes `dark:bg-muted` and would simply never see it.
//
// WHY IT IS GENERATED. `dark` here means "the root is not one of the LIGHT
// palettes", and that list is DATA: the hand-tuned `light` plus every seed
// whose own `dark` flag is false. Hand-writing it would be a FOURTH
// enumeration of the theme catalogue — `themes.ts`, the seeds and the
// generated `[data-theme]` blocks are the other three — so
// `design/make-themes.mjs` emits it and `npm run themes:check` refuses drift.
//
// WHAT THIS TEST ADDS that `themes:check` cannot: the generator and
// `themes.ts` are two files, and `themes:check` only ever compares the
// generator against its own output. A palette added to `themes.ts` and not to
// the seeds (or marked `light` in one and `dark` in the other) produces a
// variant that is wrong about a theme the picker offers, and neither the
// generator nor the gate would notice.
describe('the dark: variant means "not a light palette", and agrees with the picker', () => {
  /** Read INSIDE each test, not at module scope: a missing variant then reds
   *  one case with its own sentence instead of throwing during collection,
   *  where vitest reports "no tests" and the message is lost (measured). */
  const darkLine = (): string => {
    const m = /@custom-variant\s+dark\s*\(([^\n]*)\);/.exec(tokensCss);
    expect(m, 'tokens.css declares no `dark` custom variant — run `npm run themes`')
      .not.toBeNull();
    return m![1] ?? '';
  };

  /** The ids the variant EXCLUDES, read off the selector it generated. */
  const excludedIds = (line: string): string[] =>
    [...line.matchAll(/:not\(\[data-theme='([^']+)'\]\)/g)].map((m) => m[1] ?? '');

  it('excludes exactly the themes the catalogue calls light', () => {
    // `THEMES` is what the picker renders, so it is the list an operator can
    // actually reach. A variant that disagreed with it would be dark-styling
    // a palette the operator is reading as light.
    const light = THEMES.filter((t) => t.mode === 'light').map((t) => t.id);
    expect(excludedIds(darkLine()).sort(), 'the variant and the theme catalogue disagree')
      .toEqual([...light].sort());
  });

  it('scopes itself to :root, so it reads the stamp and not an element class', () => {
    // The stamp lives on the document element (`data-theme`), which is why the
    // condition is on `:root` and the subject is a descendant. A `.dark`-class
    // variant would need something to add that class, and nothing does.
    const line = darkLine();
    expect(line).toContain(':root');
    expect(line, 'a descendant selector is what lets any element carry the utility')
      .toMatch(/\*\s*\)?\s*$/);
    expect(line, 'Tailwind’s class strategy has no writer here').not.toContain('.dark');
  });

  it('is the ONLY custom variant, so there is one place to look', () => {
    const all = [...tokensCss.matchAll(/@custom-variant\s+([\w-]+)/g)].map((m) => m[1] ?? '');
    expect(all).toEqual(['dark']);
  });
});
