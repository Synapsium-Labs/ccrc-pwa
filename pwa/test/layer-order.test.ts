import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './cssRule';

// The cascade-layer order is fixed by the first `@layer` the document meets (D-7891). A built stylesheet that
// Vite links ahead of index.css (a chunk shared by the entry and a lazily loaded one, such as Export's builder,
// carrying @ccrc/ui's component rules) would otherwise open `@layer components` first and rank it BELOW base and
// utilities, so the reset's `border: 0 solid` and every utility beat each ui component rule. index.html's
// pre-paint <style> therefore states the order before any built sheet loads. Its first name is Tailwind 4's own
// `properties` layer, the first block the built entry sheet emits (the --tw-* defaults, which must stay lowest);
// fonts-built.test.ts measures that name in a production build. The rest is defined once, in
// ui/src/styles/theme.css's `@layer` statement; this file reads it there and never spells a layer name.

const REPO = path.resolve(__dirname, '../..');
const html = readFileSync(path.join(REPO, 'pwa', 'index.html'), 'utf8');
const themeCss = stripComments(readFileSync(path.join(REPO, 'ui', 'src', 'styles', 'theme.css'), 'utf8'));

/** `@layer a, b, c;` statements (an order, no block), each as its list of names. */
function layerStatements(css: string): string[][] {
  return [...css.matchAll(/@layer\s+([\w-]+(?:\s*,\s*[\w-]+)+)\s*;/g)].map((m) => (m[1] ?? '').split(/\s*,\s*/));
}

/** The text of index.html with its HTML and CSS comments blanked (offsets kept), so a comment never counts as a use. */
const source = html.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));

describe('the cascade-layer order is declared first, in index.html (D-7891)', () => {
  const theme = layerStatements(themeCss);

  it('theme.css declares the order in exactly one @layer statement', () => {
    expect(theme).toHaveLength(1);
    expect(theme[0]?.length ?? 0).toBeGreaterThan(1);
  });

  it("index.html's first <style> opens with one leading layer, then theme.css's statement, before any rule", () => {
    const first = /<style[^>]*>([\s\S]*?)<\/style>/.exec(source);
    expect(first, 'index.html has a pre-paint <style>').not.toBeNull();
    const css = stripComments(first?.[1] ?? '').trim();
    const lead = /^@layer\s+([\w-]+(?:\s*,\s*[\w-]+)+)\s*;/.exec(css);
    expect(lead, 'the <style> begins with an @layer statement').not.toBeNull();
    const names = (lead?.[1] ?? '').split(/\s*,\s*/);
    expect(names, 'one layer ahead of theme.css\'s list (the built sheet\'s first; fonts-built.test.ts)').toHaveLength((theme[0]?.length ?? 0) + 1);
    expect(names.slice(1)).toEqual(theme[0]);
    expect(theme[0] ?? []).not.toContain(names[0]);
  });

  // The source shell links no stylesheet (Vite injects them at build), so the order against the BUILT links is pinned on
  // a production build, in fonts-built.test.ts; here, the module entry Vite injects them beside.
  it('the statement comes before the module entry and every other @layer use', () => {
    const at = source.search(/@layer\s+[\w-]+\s*,/);
    expect(at).toBeGreaterThan(-1);
    const later = (re: RegExp): number[] => [...source.matchAll(re)].map((m) => m.index ?? 0);
    for (const i of later(/<script\b[^>]*\btype=["']module["']/gi)) expect(i).toBeGreaterThan(at);
    expect(later(/@layer\b/g).filter((i) => i !== at).every((i) => i > at)).toBe(true);
    expect(later(/<script\b[^>]*\btype=["']module["']/gi).length).toBeGreaterThan(0);
  });
});
