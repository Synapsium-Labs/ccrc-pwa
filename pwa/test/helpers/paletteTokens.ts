// Resolves one palette's design tokens the way the document root would answer them (appearance continuity, Task 2;
// design 2026-11-18 §3). The reader's mapping table names tokens, and the scan must know what each token is in every
// palette and skin, so this reads `ui/src/styles/tokens.css` and `skins.css` and applies the cascade for ONE
// combination of palette, skin and pointer.
//
// What it does, and why `pwa/design/audit.mjs` cannot be reused (it keys the default palette `DARK`, reads only the first
// `:root` block, and never reads `skins.css` or `color-scheme`):
//   - both default blocks (`[data-theme='phosphor'], :root` and the second `:root`) are merged, and `phosphor` IS that
//     default: it has no block of its own, so a palette id of `phosphor` overlays nothing;
//   - another palette's `[data-theme='<id>']` block overlays the defaults;
//   - a skin's `:root[data-skin='<id>']` block overlays the palette (specificity 0,2,0 beats 0,1,0 whatever the file
//     order, which is how Instrument's `--elev-pop` wins in every palette), and so does the `(pointer: fine)` arm of
//     either file when the pointer is fine. Refined is `:root`'s own values and owns no block;
//   - `var()` chains are followed at the end, over the merged declarations, as a browser substitutes them on one
//     element: a token that reaches nothing is guaranteed-invalid and answers `''`, the same text `getPropertyValue`
//     answers for an unset custom property;
//   - `color-scheme` is read as the declaration it is (it is not a custom property, and carries no `var()`).
// Media other than `(pointer: fine)` (widths, reduced motion) are not applied: no token the reader maps depends on one,
// and the helper says so here rather than guessing a viewport. `widthMediaTokens()` lists what the width arms declare, so
// a test can red a mapped token that moves into one.
//
// It does not guess about spelling either. A selector naming `data-theme` or `data-skin` that is not one of the two
// recognised forms, and a media condition that is not `(pointer: fine)`, a width or reduced motion, THROWS, so a palette
// whose block is spelled differently is never silently measured as the default. `matchedBlocks` reports how many blocks of
// each kind a combination matched, for the assertions that every palette and skin matched its own.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const STYLES = path.join(import.meta.dirname, '..', '..', '..', 'ui', 'src', 'styles');

type Pointer = 'fine' | 'coarse';

type MediaKind = 'pointer-fine' | 'width' | 'motion';

/** A selector the helper understands: the default (`:root`), a palette block or a skin block. */
type Selector = { readonly kind: 'root' } | { readonly kind: 'theme'; readonly id: string } | { readonly kind: 'skin'; readonly id: string };

interface Block {
  /** The selectors of the rule, one per comma-separated entry, as the helper reads them (null: names no palette or skin). */
  readonly selectors: readonly (Selector | null)[];
  /** The `@media` condition the rule sits in, or null for a top-level rule. */
  readonly media: MediaKind | null;
  readonly decls: ReadonlyMap<string, string>;
  /** File order across both stylesheets, the cascade's tie-break. */
  readonly order: number;
}

/** The text of a stylesheet with its comments taken out. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The declarations of one rule body, split on top-level `;` (a `;` inside parentheses or quotes is not one). */
function parseDecls(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let quote = '';
  let start = 0;
  const flush = (end: number): void => {
    const decl = body.slice(start, end);
    const colon = decl.indexOf(':');
    if (colon > 0) {
      const name = decl.slice(0, colon).trim();
      if (name.startsWith('--') || name === 'color-scheme') out.set(name, decl.slice(colon + 1).trim());
    }
    start = end + 1;
  };
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (quote !== '') { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ';' && depth === 0) flush(i);
  }
  flush(body.length);
  return out;
}

/** What a selector names. A selector that mentions `data-theme` or `data-skin` and is not one of the two exact forms
 *  throws: it would otherwise be skipped, and its palette measured as the default. */
function classify(selector: string): Selector | null {
  if (selector === ':root') return { kind: 'root' };
  const theme = /^\[data-theme='([a-z0-9-]+)'\]$/.exec(selector);
  if (theme !== null) return theme[1] === 'phosphor' ? { kind: 'root' } : { kind: 'theme', id: theme[1] as string };
  const skin = /^:root\[data-skin='([a-z0-9-]+)'\]$/.exec(selector);
  if (skin !== null) return { kind: 'skin', id: skin[1] as string };
  if (/data-theme|data-skin/.test(selector)) throw new Error(`paletteTokens: a selector this helper cannot read: ${selector}`);
  return null;
}

/** The kind of an `@media` condition, or a throw for one this helper does not know (it would be skipped silently). */
function mediaKindOf(condition: string): MediaKind {
  const c = condition.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/g, ': ');
  if (c === '(pointer: fine)') return 'pointer-fine';
  if (/^\((min|max)-width: \d+px\)$/.test(c)) return 'width';
  if (/^\(prefers-reduced-motion: (reduce|no-preference)\)$/.test(c)) return 'motion';
  throw new Error(`paletteTokens: a media condition this helper cannot read: ${condition.trim()}`);
}

/** Every style rule of a stylesheet, with the `@media` condition it sits in (one level, which is all these files use). */
function parseBlocks(css: string, media: MediaKind | null, out: Omit<Block, 'order'>[]): void {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    // A statement with no body (`@custom-variant …;`) may sit before the next rule: a selector holds no `;`.
    const prelude = css.slice(i, open).split(';').pop()!.trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      const ch = css.charAt(j);
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude.startsWith('@media')) parseBlocks(body, mediaKindOf(prelude.slice('@media'.length)), out);
    else if (!prelude.startsWith('@')) {
      out.push({ selectors: prelude.split(',').map((s) => classify(s.trim())), media, decls: parseDecls(body) });
    }
    i = j;
  }
}

/** The rules of one stylesheet's text, in order. Throws on a selector or media condition it cannot read (see the header). */
export function blocksOf(css: string): Omit<Block, 'order'>[] {
  const out: Omit<Block, 'order'>[] = [];
  parseBlocks(stripComments(css), null, out);
  return out;
}

let blocksCache: readonly Block[] | undefined;
/** Both stylesheets, parsed once, in cascade file order (tokens.css, then skins.css). */
function blocks(): readonly Block[] {
  if (blocksCache === undefined) {
    const all = ['tokens.css', 'skins.css'].flatMap((file) => blocksOf(readFileSync(path.join(STYLES, file), 'utf8')));
    blocksCache = all.map((b, order) => ({ ...b, order }));
  }
  return blocksCache;
}

/** The specificity the cascade ranks a selector by, or null when the selector does not match this combination. */
function specificityOf(selector: Selector | null, themeId: string, skinId: string): number | null {
  if (selector === null) return null;
  if (selector.kind === 'root') return 1;
  // `phosphor` is applied by removing the attribute: its aliased selector was read as `root` already.
  if (selector.kind === 'theme') return selector.id === themeId ? 1 : null;
  return selector.id === skinId ? 2 : null;
}

/** `var(--name)` and `var(--name, fallback)` substituted in `value`, or null when a reference is guaranteed-invalid. */
function substitute(value: string, raw: ReadonlyMap<string, string>, seen: readonly string[]): string | null {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('var(', i);
    if (at < 0) { out += value.slice(i); break; }
    out += value.slice(i, at);
    let depth = 1;
    let j = at + 'var('.length;
    let comma = -1;
    while (j < value.length && depth > 0) {
      const ch = value.charAt(j);
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 1 && comma < 0) comma = j;
      j++;
    }
    const inner = value.slice(at + 'var('.length, j - 1);
    const name = (comma < 0 ? inner : value.slice(at + 'var('.length, comma)).trim();
    const fallback = comma < 0 ? null : value.slice(comma + 1, j - 1).trim();
    const referenced = seen.includes(name) ? null : resolveOne(name, raw, [...seen, name]);
    if (referenced !== null && referenced !== '') out += referenced;
    else if (fallback !== null) {
      const fb = substitute(fallback, raw, seen);
      if (fb === null) return null;
      out += fb;
    } else return null;
    i = j;
  }
  return out;
}

/** One token's computed text over the merged declarations, null when it is guaranteed-invalid. */
function resolveOne(name: string, raw: ReadonlyMap<string, string>, seen: readonly string[]): string | null {
  const value = raw.get(name);
  if (value === undefined) return null;
  const text = substitute(value, raw, seen);
  return text === null ? null : text.trim();
}

/** The blocks that apply to one combination, with the kind of each (a palette's own, a skin's own, or a pointer arm). */
function selectBlocks(themeId: string, skinId: string, pointer: Pointer) {
  const applied: { specificity: number; order: number; decls: ReadonlyMap<string, string>;
    kind: 'default' | 'theme' | 'skin' | 'skin-pointer-arm' | 'other' }[] = [];
  for (const block of blocks()) {
    if (block.media === 'width' || block.media === 'motion') continue;
    if (block.media === 'pointer-fine' && pointer !== 'fine') continue;
    const hits = block.selectors.map((s) => ({ s, specificity: specificityOf(s, themeId, skinId) }))
      .filter((h): h is { s: Selector; specificity: number } => h.specificity !== null);
    if (hits.length === 0) continue;
    const specificity = Math.max(...hits.map((h) => h.specificity));
    const top = hits.find((h) => h.specificity === specificity)?.s as Selector;
    const kind = top.kind === 'theme' ? 'theme' : top.kind === 'skin' ? (block.media === null ? 'skin' : 'skin-pointer-arm')
      : block.media === null ? 'default' : 'other';
    applied.push({ specificity, order: block.order, decls: block.decls, kind });
  }
  applied.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  return applied;
}

/** How many blocks of each kind one combination matched: the assertions that a palette and a skin are not silently the default. */
export function matchedBlocks(themeId: string, skinId: string, pointer: Pointer):
  { readonly theme: number; readonly skin: number; readonly skinPointerArm: number } {
  const applied = selectBlocks(themeId, skinId, pointer);
  const count = (k: string): number => applied.filter((a) => a.kind === k).length;
  return { theme: count('theme'), skin: count('skin'), skinPointerArm: count('skin-pointer-arm') };
}

/** The custom properties declared inside a width `@media` arm of either stylesheet, which `resolvePaletteTokens` does not apply. */
export function widthMediaTokens(): string[] {
  return blocks().filter((b) => b.media === 'width').flatMap((b) => [...b.decls.keys()]).filter((k) => k.startsWith('--'));
}

export function resolvePaletteTokens(
  themeId: string, skinId: string, pointer: Pointer,
): { readonly tokens: ReadonlyMap<string, string>; readonly colourScheme: string } {
  const raw = new Map<string, string>();
  for (const a of selectBlocks(themeId, skinId, pointer)) for (const [k, v] of a.decls) raw.set(k, v);
  const tokens = new Map<string, string>();
  for (const name of raw.keys()) {
    if (!name.startsWith('--')) continue;
    tokens.set(name, resolveOne(name, raw, [name]) ?? '');
  }
  return { tokens, colourScheme: raw.get('color-scheme') ?? '' };
}
