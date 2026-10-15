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
// items from the catalogue rather than re-list them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SKINS, REFINED, INSTRUMENT, applySkin, resolveSkin } from '@ccrc/ui';

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

describe('the roles reach Tailwind', () => {
  it("theme.css maps every type and density role onto its token, inside @theme inline", () => {
    // A role nobody mapped is a utility Tailwind silently never emits: the
    // class is written, the element gets nothing, and no gate reads it.
    const css = stripCss(readFileSync(path.join(STYLES, 'theme.css'), 'utf8'));
    const bridge = css.slice(css.indexOf('@theme inline'));
    const ROLE_KEYS: [string, string][] = [
      ['--text-md', '--fs-md'],
      ['--text-ui', '--fs-ui'],
      ['--text-prose', '--fs-prose'],
      ['--text-meta', '--fs-meta'],
      ['--text-page', '--fs-page'],
      ['--text-section', '--fs-section'],
      ['--spacing-gutter', '--gutter'],
      ['--spacing-row', '--row-h'],
      ['--spacing-card', '--pad-card'],
      ['--spacing-section', '--gap-section'],
    ];
    for (const [key, token] of ROLE_KEYS) {
      expect(bridge, key).toMatch(new RegExp(`${key}:\\s*var\\(${token}\\);`));
    }
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
});
