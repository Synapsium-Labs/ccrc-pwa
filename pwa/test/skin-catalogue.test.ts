// THE SKIN CATALOGUE AND THE SKIN STYLESHEET ARE BOUND TO EACH OTHER (D-5093).
//
// The skin is a third axis beside the palette and light/dark: `data-skin` on
// `<html>`. `ui/src/styles/skins.ts` is its one hand-typed enumeration (a label
// cannot be derived from a selector), and `ui/src/styles/skins.css` holds the
// token overrides. Refined is `:root`'s own values, so it has no block; every
// other skin is exactly one `:root[data-skin='<id>']` family of blocks.
//
// Unbound, both directions fail silently, the way `theme-catalogue.test.ts`
// argues for palettes: a catalogue entry with no block is a choice that stamps
// an attribute nothing answers (the page renders Refined while the toolbar says
// otherwise), and a block with no entry is a skin nobody can reach.
//
// Also here, because they are the same seam seen from its two consumers: the
// stamp itself (`applySkin`, which ALWAYS writes the attribute — the departure
// from `applyTheme`, which writes Phosphor by absence), the stylesheet's place
// in `theme.css`'s import order, and Storybook's toolbar, which must take its
// items from the catalogue rather than re-list them. And Storybook's half of
// D-5093's verification clause: the initial skin comes from `STORYBOOK_SKIN`
// through the catalogue, so a build made with it runs axe over every story in
// that skin, and the viewport presets are the widths every PR is checked at.
// And the per-device default's pure half (D-5096): what `AUTO` resolves to on
// which device, with the catalogue injected so the case can see the world W2's
// flag flip makes.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { compile } from 'tailwindcss';
import {
  SKINS, REFINED, INSTRUMENT, AUTO, DEVICE_QUERY, applySkin, resolveSkin, skinPreference, type SkinChoice,
} from '@ccrc/ui';

const UI = path.join(import.meta.dirname, '..', '..', 'ui');
const STYLES = path.join(UI, 'src', 'styles');

const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJs = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every skin id a `[data-skin='…']` selector in skins.css names, whatever
 *  else the selector carries. Read lazily, inside each case, so a missing file
 *  reds the case that needs it rather than the whole suite at import. */
function skinIdsInCss(): string[] {
  const css = stripCss(readFileSync(path.join(STYLES, 'skins.css'), 'utf8'));
  const ids = new Set<string>();
  for (const m of css.matchAll(/\[data-skin=(['"]?)([^'"\]]+)\1\]/g)) ids.add(m[2] as string);
  return [...ids].sort();
}

/** The selectors of skins.css's TOP-LEVEL rules — those outside any at-rule.
 *  A skin whose only blocks sit inside `@media` applies only conditionally, so
 *  "has a block" means a top-level one. Brace-walked rather than matched with a
 *  lazy regex, which would stop at a nested rule's closing brace. */
function topLevelSelectors(css: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    if (c === '{') {
      if (depth === 0) out.push(css.slice(start, i).trim());
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0) start = i + 1;
    } else if (c === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return out;
}

describe('the skin catalogue is bound to skins.css', () => {
  it("every non-default skin has a :root[data-skin='<id>'] block in skins.css, and refined has none", () => {
    const css = stripCss(readFileSync(path.join(STYLES, 'skins.css'), 'utf8'));
    const top = topLevelSelectors(css);
    for (const { id } of SKINS.filter((s) => s.id !== REFINED)) {
      expect(top, `no top-level :root[data-skin='${id}'] block`).toContain(`:root[data-skin='${id}']`);
    }
    // Refined IS :root. A block of its own would make the default an override
    // of itself, and an absent attribute (a page that runs no script) would
    // then render something other than what `data-skin='refined'` renders.
    expect(skinIdsInCss()).not.toContain(REFINED);
  });

  it("the catalogue's ids and skins.css's blocks are the same set, in both directions", () => {
    const catalogue = SKINS.map((s) => s.id).filter((id) => id !== REFINED).sort();
    expect(catalogue.length, 'the catalogue names no skin beyond the default').toBeGreaterThan(0);
    expect(skinIdsInCss()).toEqual(catalogue);
  });

  it('lists Refined first and Instrument as a labelled preview', () => {
    expect(SKINS.map((s) => s.id)).toEqual([REFINED, INSTRUMENT]);
    expect(SKINS.find((s) => s.id === INSTRUMENT)?.preview).toBe(true);
    expect(SKINS.find((s) => s.id === REFINED)?.preview).toBe(false);
    for (const s of SKINS) {
      expect(s.label.length, s.id).toBeGreaterThan(0);
      expect(s.note.length, s.id).toBeGreaterThan(20);
    }
  });
});

describe('resolving and stamping a skin', () => {
  it('resolveSkin answers refined for null, empty, an unknown id and a stale id; a known id answers itself', () => {
    // A stale id is one a different build could have written: mock C ("soft
    // glass") was never built, and a case variant is not the id. Honouring
    // either would stamp an attribute no block answers while the app's state
    // claims a skin it is not showing.
    for (const junk of [null, undefined, '', 'not-a-skin', 'soft-glass', 'Instrument', '../evil']) {
      expect(resolveSkin(junk), String(junk)).toBe(REFINED);
    }
    for (const s of SKINS) expect(resolveSkin(s.id)).toBe(s.id);
  });

  it('applySkin stamps data-skin for every id, refined included', () => {
    // ALWAYS stamped, unlike Phosphor's palette, which is stamped by absence:
    // the boot path must tell "no choice yet" from "Refined" (D-5093).
    for (const s of SKINS) {
      const el = document.createElement('html');
      applySkin(s.id, el);
      expect(el.getAttribute('data-skin'), s.id).toBe(s.id);
    }
    const el = document.createElement('html');
    applySkin(INSTRUMENT, el);
    applySkin(REFINED, el);
    expect(el.getAttribute('data-skin')).toBe(REFINED);
  });
});

/** The catalogue as the W2 PR that lands Instrument's shell will ship it:
 *  Instrument no longer a preview. INJECTED into `resolveSkin`, never
 *  committed — the shipped flag is what keeps `AUTO` on Refined today. */
const asW2Ships = (): readonly SkinChoice[] =>
  SKINS.map((s) => (s.id === INSTRUMENT ? { ...s, preview: false } : s));

/** Primary-input profiles (Media Queries 4, `hover` and `pointer`), each with
 *  the skin `AUTO` gives it once Instrument is no longer a preview. A tablet's
 *  primary pointer is coarse, so it is Refined (spec §12, O1). The rule is a
 *  CONJUNCTION, and each half has a row that only it decides:
 *  - a stylus-first device points finely but cannot hover, so it is a tablet
 *    too: that row tells the rule from `(pointer: fine)` alone;
 *  - a coarse pointer that can hover is not a desk either, because its
 *    pointer is coarse: that row tells the rule from `(hover: hover)` alone.
 *  So narrowing DEVICE_QUERY to either half — in skins.ts and the snippet
 *  together, which no binding between the two can see — reds here. */
const DEVICES: readonly { readonly name: string; readonly hover: string; readonly pointer: string; readonly skin: string }[] = [
  { name: 'a phone', hover: 'none', pointer: 'coarse', skin: REFINED },
  { name: 'a tablet', hover: 'none', pointer: 'coarse', skin: REFINED },
  { name: 'a stylus-first tablet', hover: 'none', pointer: 'fine', skin: REFINED },
  { name: 'a coarse pointer that can hover', hover: 'hover', pointer: 'coarse', skin: REFINED },
  { name: 'a device with no pointer', hover: 'none', pointer: 'none', skin: REFINED },
  { name: 'a desktop with a mouse', hover: 'hover', pointer: 'fine', skin: INSTRUMENT },
  { name: 'a touch laptop driven by its trackpad', hover: 'hover', pointer: 'fine', skin: INSTRUMENT },
];

/** Does `query` match a device with these primary-input features? Reads only
 *  the form DEVICE_QUERY may take — `(feature: value)` terms joined by `and` —
 *  and THROWS on anything else, so a query this cannot read reds the case
 *  rather than being read as something it is not. */
function matchesDevice(query: string, device: { readonly hover: string; readonly pointer: string }): boolean {
  const features: Record<string, string> = { hover: device.hover, pointer: device.pointer };
  return query.split(/\s+and\s+/).every((term) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([a-z-]+)\s*\)$/.exec(term.trim());
    if (m === null) throw new Error(`a DEVICE_QUERY term this case cannot read: ${term}`);
    const have = features[m[1] as string];
    if (have === undefined) throw new Error(`DEVICE_QUERY reads a feature no profile states: ${m[1]}`);
    return have === m[2];
  });
}

describe('the per-device default (D-5096)', () => {
  it('AUTO is a stored value, never a skin: no block, no catalogue entry, never a resolution', () => {
    expect(SKINS.map((s) => s.id)).not.toContain(AUTO);
    expect(skinIdsInCss()).not.toContain(AUTO);
    for (const catalogue of [SKINS, asW2Ships()]) {
      for (const desk of [true, false]) {
        expect(resolveSkin(AUTO, desk, catalogue)).not.toBe(AUTO);
      }
    }
  });

  it('skinPreference: a known id asks for itself, and anything else asks for AUTO', () => {
    // What the picker shows (Task 12b): an unreadable, missing, unknown or
    // stale value means "Match this device" (spec §7), never a pinned skin.
    for (const s of SKINS) expect(skinPreference(s.id)).toBe(s.id);
    for (const junk of [null, undefined, '', AUTO, 'soft-glass', 'Instrument']) {
      expect(skinPreference(junk), String(junk)).toBe(AUTO);
    }
  });

  it('AUTO on a hover-and-fine device resolves refined while Instrument is a preview, and instrument when it is not', () => {
    const desk = DEVICES.find((d) => d.name === 'a desktop with a mouse')!;
    expect(matchesDevice(DEVICE_QUERY, desk), 'a desktop is not a desk').toBe(true);
    // As shipped: Instrument is a preview, so nobody's screen changes (§7).
    expect(SKINS.find((s) => s.id === INSTRUMENT)?.preview).toBe(true);
    expect(resolveSkin(AUTO, true)).toBe(REFINED);
    expect(resolveSkin(AUTO, true, SKINS)).toBe(REFINED);
    // As W2 ships it: the same desk boots into Instrument.
    expect(resolveSkin(AUTO, true, asW2Ships())).toBe(INSTRUMENT);
    // Nothing stored, an empty value, an unknown one and a stale one all take
    // the device rule — "an unknown value means AUTO" — in both catalogues.
    for (const v of [AUTO, null, undefined, '', 'soft-glass']) {
      expect(resolveSkin(v, true), String(v)).toBe(REFINED);
      expect(resolveSkin(v, true, asW2Ships()), String(v)).toBe(INSTRUMENT);
      expect(resolveSkin(v, false, asW2Ships()), String(v)).toBe(REFINED);
    }
    // An explicit choice is itself on every device, in both catalogues.
    for (const catalogue of [SKINS, asW2Ships()]) {
      for (const d of [true, false]) {
        for (const s of SKINS) expect(resolveSkin(s.id, d, catalogue), `${s.id} desk=${d}`).toBe(s.id);
      }
    }
  });

  it('AUTO on a coarse device resolves refined (tablets, O1)', () => {
    // By primary input, never by width: the profiles carry no width at all.
    // Each is evaluated against DEVICE_QUERY itself, then resolved against the
    // catalogue W2 ships — the one in which the device rule decides anything.
    for (const d of DEVICES) {
      const isDesk = matchesDevice(DEVICE_QUERY, d);
      expect(resolveSkin(AUTO, isDesk, asW2Ships()), d.name).toBe(d.skin);
      expect(resolveSkin(AUTO, isDesk), `${d.name}, while Instrument is a preview`).toBe(REFINED);
    }
  });
});

describe('where skins.css sits', () => {
  it('theme.css imports skins.css after tokens.css and before any rule', () => {
    // After tokens.css so its blocks are read with `:root`'s already declared
    // (its specificity, not the order, decides a tie — but a reader looking
    // for the override should find it after the thing it overrides). Before
    // any rule because CSS drops an @import that follows one, silently.
    const css = stripCss(readFileSync(path.join(STYLES, 'theme.css'), 'utf8'));
    const tokens = css.indexOf("@import './tokens.css';");
    const skins = css.indexOf("@import './skins.css';");
    expect(tokens, 'theme.css no longer imports tokens.css').toBeGreaterThanOrEqual(0);
    expect(skins, 'theme.css does not import skins.css').toBeGreaterThan(tokens);
    expect(skins, 'skins.css is imported after a rule, so CSS drops it').toBeLessThan(css.indexOf('{'));
  });
});

/** The type and density roles' Tailwind keys, each onto its token. A key is
 *  the utility's SPELLING, and it shares a namespace with every other key
 *  Tailwind reads through the same utility — which is how a role can be
 *  claimed by a key that means something else (the census below). */
const ROLE_KEYS: readonly (readonly [key: string, token: string])[] = [
  ['--text-md', '--fs-md'],
  ['--text-ui', '--fs-ui'],
  ['--text-prose', '--fs-prose'],
  ['--text-meta', '--fs-meta'],
  // The page title's KEY is `title`, never `page`: `page` is already
  // `--color-page`'s key (the page ground), and Tailwind's `text-*` reads the
  // colours as well as the sizes, so `text-page` compiled to
  // `color: var(--bg-page)` — the page's own ground, invisible text — and
  // never to a size. The TOKEN keeps its name, as `--accent` kept its own
  // when its key became `phosphor` (theme.css): only the spelling moved.
  ['--text-title', '--fs-page'],
  ['--text-section', '--fs-section'],
  ['--spacing-gutter', '--gutter'],
  ['--spacing-row', '--row-h'],
  ['--spacing-card', '--pad-card'],
  ['--spacing-section', '--gap-section'],
  ['--spacing-head', '--head-h'],
];

/** Every namespace a key of this theme lives in — the bridge's, and the ones
 *  Tailwind's own default theme adds that a bridge root also reads — with the
 *  utilities that read it and the property each sets. Longest prefix first,
 *  so `--font-weight-` is never read as a `--font-` key.
 *
 *  A ROOT listed under two namespaces is where one key name, used in both,
 *  collides, and Tailwind then compiles whichever it tries first, silently:
 *  `text` reads sizes and colours, `font` families and weights, `w` and
 *  `max-w` spacing and Tailwind's containers (`md`, `lg`, `xl`…), `leading`
 *  line heights and spacing. Each side's property is the other side's
 *  forbidden one. The colours' shadow-tint spelling (`shadow-<colour>`) is
 *  deliberately not read: the bridge's elevations own `shadow-*` (`--shadow-
 *  sheet` sits beside `--color-sheet`, and `shadow-sheet` is the sheet's
 *  elevation, measured), and nothing in this tree tints a shadow with a
 *  palette colour. A bridge key under a prefix not listed here reds the census
 *  rather than going unchecked. */
const NAMESPACES: readonly { readonly prefix: string; readonly reads: readonly (readonly [root: string, prop: string])[] }[] = [
  { prefix: '--font-weight-', reads: [['font', 'font-weight']] },
  { prefix: '--font-', reads: [['font', 'font-family']] },
  { prefix: '--color-', reads: [['bg', 'background-color'], ['text', 'color']] },
  { prefix: '--text-', reads: [['text', 'font-size']] },
  { prefix: '--leading-', reads: [['leading', 'line-height']] },
  { prefix: '--tracking-', reads: [['tracking', 'letter-spacing']] },
  { prefix: '--spacing-', reads: [['p', 'padding'], ['px', 'padding-inline'], ['m', 'margin'], ['gap', 'gap'],
    ['h', 'height'], ['min-h', 'min-height'], ['w', 'width'], ['max-w', 'max-width'], ['size', 'width'],
    ['leading', 'line-height']] },
  { prefix: '--container-', reads: [['w', 'width'], ['max-w', 'max-width']] },
  { prefix: '--radius-', reads: [['rounded', 'border-radius']] },
  { prefix: '--shadow-', reads: [['shadow', '--tw-shadow']] },
  { prefix: '--ease-', reads: [['ease', 'transition-timing-function']] },
  { prefix: '--animate-', reads: [['animate', 'animation']] },
];

const namespaceOf = (key: string): (typeof NAMESPACES)[number] | undefined =>
  NAMESPACES.find((n) => key.startsWith(n.prefix) && key.length > n.prefix.length);

interface UtilityCheck { readonly key: string; readonly cls: string; readonly prop: string; readonly foreign: readonly string[] }

/** The utilities that read `key`'s namespace, each with the property it must
 *  set and the properties a same-rooted namespace would set instead. */
function utilitiesOf(key: string): UtilityCheck[] {
  const ns = namespaceOf(key)!;
  const name = key.slice(ns.prefix.length);
  return ns.reads.map(([root, prop]) => ({
    key, cls: `${root}-${name}`, prop,
    foreign: NAMESPACES.filter((o) => o !== ns)
      .flatMap((o) => o.reads.filter(([r]) => r === root).map(([, p]) => p))
      .filter((p) => p !== prop),
  }));
}

/** The `@theme inline` block's `--key: value` pairs, found by balanced braces. */
function bridgeDeclarations(): [string, string][] {
  const css = stripCss(readFileSync(path.join(STYLES, 'theme.css'), 'utf8'));
  const open = css.indexOf('{', css.indexOf('@theme inline'));
  let depth = 0;
  let close = open;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) { close = i; break; }
  }
  return [...css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map((m) => [m[1] as string, (m[2] as string).replace(/\s+/g, ' ').trim()]);
}

/** Resolve a stylesheet import the way the build does: relative to the
 *  importing sheet, and a bare `tailwindcss/…` from that sheet's own
 *  directory — so from ui's node_modules, as vite resolves it. */
async function loadStylesheet(id: string, base: string): Promise<{ path: string; base: string; content: string }> {
  const file = id.startsWith('.') ? path.resolve(base, id) : createRequire(path.join(base, 'theme.css')).resolve(id);
  return { path: file, base: path.dirname(file), content: readFileSync(file, 'utf8') };
}

/** Compile with Tailwind itself, the compiler the app's build runs, for
 *  exactly these candidates: `theme.css` as the app has it, or Tailwind's own
 *  theme and utilities ALONE — what a class means before this bridge. */
async function buildUtilities(sheet: 'bridge' | 'tailwind-alone', candidates: readonly string[]): Promise<string> {
  const css = sheet === 'bridge'
    ? readFileSync(path.join(STYLES, 'theme.css'), 'utf8')
    : "@layer theme, base, components, utilities;\n@import 'tailwindcss/theme.css' layer(theme);\n@import 'tailwindcss/utilities.css' layer(utilities);\n";
  const compiler = await compile(css, { base: STYLES, loadStylesheet });
  return compiler.build([...candidates]);
}

/** Each utility rule's OWN declarations, by class, from a build's
 *  `@layer utilities`. Brace-walked, so a nested `@supports` inside a rule is
 *  skipped rather than ending it, and a rule Tailwind did not emit is absent. */
function utilityDeclarations(built: string): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>();
  const open = built.indexOf('{', built.indexOf('@layer utilities'));
  let depth = 1;
  let buf = '';
  let rule: [string, string][] = [];
  const take = (): void => {
    const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(buf);
    if (m) rule.push([m[1] as string, (m[2] as string).replace(/\s+/g, ' ')]);
  };
  for (let i = open + 1; i < built.length && depth > 0; i += 1) {
    const c = built[i];
    if (c === '{') {
      if (depth === 1) {
        rule = [];
        out.set(buf.trim().replace(/^\./, '').replace(/\\(.)/g, '$1'), rule);
      }
      depth += 1;
      buf = '';
    } else if (c === '}') {
      if (depth === 2) take();
      depth -= 1;
      buf = '';
    } else if (c === ';' && depth === 2) {
      take();
      buf = '';
    } else {
      buf += c;
    }
  }
  return out;
}

const shown = (rule: [string, string][] | undefined): string =>
  rule === undefined ? 'nothing' : `{ ${rule.map(([p, v]) => `${p}: ${v}`).join('; ')} }`;

describe('the roles reach Tailwind', () => {
  it("theme.css maps every type and density role onto its token, inside @theme inline", () => {
    // A role nobody mapped is a utility Tailwind silently never emits: the
    // class is written, the element gets nothing, and no gate reads it.
    const bridge = new Map(bridgeDeclarations());
    for (const [key, token] of ROLE_KEYS) {
      expect(bridge.get(key), key).toBe(`var(${token})`);
    }
  });

  // THE KEY CENSUS, and why it compiles rather than reads. A key is only half
  // a utility's address; the other half is which namespaces its ROOT reads,
  // which is Tailwind's knowledge, not this tree's. `text-*` reads `--text-*`
  // AND `--color-*`, so the page-title role, first mapped as `--text-page`,
  // compiled to `color: var(--bg-page)` — `--color-page` is the page ground,
  // so the title would have been invisible — and never to a size, while
  // `cn()` merged it as a size and the README offered it as one. Every string
  // check in the tree passed. So both cases below ask the compiler. A
  // collision has two sides and either can lose, so there are two cases: the
  // bridge's keys keep their meaning, and Tailwind's own keys keep theirs.
  it('no key the bridge maps is claimed by another namespace: each compiles, through every utility that reads it, to its own property', async () => {
    // Every key, through every utility that reads its namespace, must emit its
    // own property with the bridge's own value, and none of the property a
    // same-rooted namespace would set. The roles are why this was written;
    // every key is checked because a palette key named like a role
    // (`--color-meta`) breaks the role, not the palette.
    const decls = bridgeDeclarations();
    const unknown = decls.filter(([key]) => namespaceOf(key) === undefined).map(([k]) => k);
    expect(unknown, 'a bridge namespace this census does not read — teach NAMESPACES its utilities').toEqual([]);

    const value = new Map(decls);
    const checks = decls.flatMap(([key]) => utilitiesOf(key));
    // Not vacuous: the whole bridge, and every role in it.
    expect(checks.length).toBeGreaterThan(300);
    for (const [key] of ROLE_KEYS) expect(checks.some((c) => c.key === key), key).toBe(true);

    const rules = utilityDeclarations(await buildUtilities('bridge', checks.map((c) => c.cls)));
    const claimed = checks.flatMap((c) => {
      const rule = rules.get(c.cls);
      const own = rule?.some(([p, v]) => p === c.prop && v === value.get(c.key)) ?? false;
      const stray = (rule ?? []).filter(([p]) => c.foreign.includes(p));
      return own && stray.length === 0 ? [] : [`${c.cls} (${c.key}: ${value.get(c.key)}) compiles to ${shown(rule)}`];
    });
    expect(claimed, 'a key Tailwind reads as another namespace\'s — rename the key, keep the token').toEqual([]);
  });

  it("and Tailwind's own keys keep theirs: each default key the bridge does not re-map compiles as it does without the bridge", async () => {
    // The other side of the same collision. The bridge sits on Tailwind's
    // default theme, whose keys are ccrc's vocabulary too (`max-w-md`,
    // `text-3xl`, `bg-red-500`). A bridge key that shares a name with one
    // through a shared root can WIN: `--spacing-md: var(--sp-4)` makes
    // `max-w-md` 16px instead of Tailwind's 28rem container (measured), and
    // the first case passes, because the bridge's own key compiled as it
    // should. So every
    // default key in a namespace above, through every utility that reads it,
    // must compile byte for byte as Tailwind's theme compiles it alone. A key
    // the bridge re-maps on purpose (`--text-xs`, `--radius-md`…) is the first
    // case's to check.
    const twTheme = stripCss(readFileSync(
      createRequire(path.join(STYLES, 'theme.css')).resolve('tailwindcss/theme.css'), 'utf8'));
    const remapped = new Set(bridgeDeclarations().map(([k]) => k));
    const defaults = [...new Set([...twTheme.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1] as string))]
      // a companion (`--text-xs--line-height`) is a property of its key, not a key
      .filter((k) => !remapped.has(k) && namespaceOf(k) !== undefined && !k.slice(namespaceOf(k)!.prefix.length).includes('--'));
    const checks = defaults.flatMap(utilitiesOf);
    expect(checks.length, 'read too little of Tailwind\'s theme to stand for it').toBeGreaterThan(500);
    for (const k of ['--container-md', '--color-red-500', '--text-3xl', '--font-weight-bold']) {
      expect(defaults, k).toContain(k);
    }

    const candidates = checks.map((c) => c.cls);
    const alone = utilityDeclarations(await buildUtilities('tailwind-alone', candidates));
    const here = utilityDeclarations(await buildUtilities('bridge', candidates));
    expect(checks.filter((c) => !alone.has(c.cls)).map((c) => c.cls), 'Tailwind emits nothing for these alone').toEqual([]);
    const moved = checks
      .filter((c) => JSON.stringify(here.get(c.cls)) !== JSON.stringify(alone.get(c.cls)))
      .map((c) => `${c.cls} (Tailwind's ${c.key}) compiles to ${shown(here.get(c.cls))}, not ${shown(alone.get(c.cls))}`);
    expect(moved, "a bridge key claims a class Tailwind's own theme defines — rename the bridge's key").toEqual([]);
  });
});

describe('Storybook', () => {
  it('the Storybook skin toolbar is derived from SKINS', () => {
    // The same discipline the theme toolbar documents: a skin added to the
    // catalogue appears with no edit, and the toolbar can never offer a skin
    // the app does not have.
    const src = stripJs(readFileSync(path.join(UI, '.storybook', 'preview.ts'), 'utf8'));
    expect(src).toMatch(/import\s*\{[^}]*\bSKINS\b[^}]*\}\s*from\s*'\.\.\/src\/styles\/skins'/);
    expect(src).toMatch(/\bskin:\s*\{[\s\S]*?items:\s*SKINS\.map\(/);
    expect(src).toMatch(/\bapplySkin\(/);
    for (const s of SKINS) {
      expect(src, `preview.ts spells the skin id '${s.id}' as a literal`)
        .not.toMatch(new RegExp(`(['"\`])${s.id}\\1`));
    }
  });

  /** The preview module as a build made with `STORYBOOK_SKIN=<value>` sees it:
   *  re-evaluated, because `initialGlobals` is read once, at import. Vitest's
   *  `import.meta.env` is the process environment, so a stub reaches the same
   *  read the vite build replaces statically. `undefined` is "not set". */
  async function previewBuiltWith(value: string | undefined): Promise<typeof import('../../ui/.storybook/preview').default> {
    vi.stubEnv('STORYBOOK_SKIN', value);
    vi.resetModules();
    try {
      return (await import('../../ui/.storybook/preview')).default;
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }

  it('the skin decorator is wired: the selected global stamps data-skin, and refined is the initial one when STORYBOOK_SKIN is unset', async () => {
    // RUN, not read. The source scan above sees `applySkin(` anywhere in the
    // file, so a decorator that is written but dropped from `decorators` — or
    // never calls it — passed it while every story rendered in whatever skin
    // the page last had. This runs the preview's own decorator chain the way
    // Storybook does, with a stub story, and reads the document.
    const preview = await previewBuiltWith(undefined);
    // Each decorator is called as Storybook calls it, with only what ours
    // read: a story to render and the context's globals.
    type Decorate = (story: () => null, context: { globals: Record<string, unknown> }) => unknown;
    const chain = [preview.decorators ?? []].flat() as unknown as Decorate[];
    const render = (globals: Record<string, unknown>): string | null => {
      document.documentElement.setAttribute('data-skin', 'not-stamped-by-a-decorator');
      for (const decorate of chain) decorate(() => null, { globals });
      return document.documentElement.getAttribute('data-skin');
    };
    expect(preview.initialGlobals?.['skin']).toBe(REFINED);
    for (const s of SKINS) expect(render({ skin: s.id }), s.id).toBe(s.id);
    // A stale global (a bookmarked URL from a newer build) stamps the default.
    expect(render({ skin: 'soft-glass' })).toBe(REFINED);
    expect(render({})).toBe(REFINED);
  });

  it("Storybook's initial skin comes from STORYBOOK_SKIN, validated against SKINS", async () => {
    // D-5093's verification clause: `STORYBOOK_SKIN=instrument npm run
    // build-storybook` is a build whose every story opens in Instrument, so
    // the a11y run over it is axe in that skin. Validated, because an
    // unvalidated value stamps an attribute no block answers: every story
    // would then render Refined while the run claimed to measure the other
    // skin — a green that measured nothing it said it did.
    //
    // READ, where the value enters: `initialGlobals.skin` is the catalogue's
    // own resolver over the variable, so no second spelling of the rule (or of
    // a skin id — the literal case above) lives in Storybook.
    const src = stripJs(readFileSync(path.join(UI, '.storybook', 'preview.ts'), 'utf8'));
    expect(src).toMatch(/\binitialGlobals:\s*\{[^}]*\bskin:\s*resolveSkin\(\s*import\.meta\.env\.STORYBOOK_SKIN\s*\)/);
    // RUN, for what the read cannot see: what each value actually becomes.
    for (const s of SKINS) expect((await previewBuiltWith(s.id)).initialGlobals?.['skin'], s.id).toBe(s.id);
    for (const junk of [undefined, '', 'soft-glass', 'Instrument', ' instrument']) {
      expect((await previewBuiltWith(junk)).initialGlobals?.['skin'], String(junk)).toBe(REFINED);
    }
  });

  it('the viewport presets are the verification widths', async () => {
    // Spec §9: every foundations PR is checked at phone 360, 390 and 438,
    // laptop 1280 and 1470, and wide 1920. The toolbar offers exactly those,
    // so a primitive is checked in Storybook at the widths its PR's matrix
    // names, and offers no preset between them (the 834 "tablet" these
    // replaced) that no PR is asked to sign for.
    const preview = await previewBuiltWith(undefined);
    const options = (preview.parameters?.['viewport'] as { options?: Record<string, { styles: { width: string; height: string } }> } | undefined)?.options ?? {};
    const px = (v: string): number => Number(/^(\d+)px$/.exec(v)?.[1] ?? Number.NaN);
    expect(Object.values(options).map((o) => px(o.styles.width)).sort((a, b) => a - b))
      .toEqual([360, 390, 438, 1280, 1470, 1920]);
    expect(Object.fromEntries(Object.entries(options).map(([k, o]) => [k, `${px(o.styles.width)}x${px(o.styles.height)}`])))
      .toEqual({
        'phone-sm': '360x780', phone: '390x844', 'phone-lg': '438x926',
        laptop: '1280x800', 'laptop-lg': '1470x920', wide: '1920x1080',
      });
  });
});
