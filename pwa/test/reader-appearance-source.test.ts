// The one-source scan for the reader's appearance (native Docs reader, appearance continuity, Task 2; design 2026-11-18
// §3 and §5). The catalogue of palettes and skins never leaves the design system: the reader holds only a slot-to-token
// map, and this file reds a second copy. Five parts: 1 slot coverage, 2 every palette resolves, 3 no second list, 4 no
// stylesheet crosses, and 5 the contrast gate over the library's own `APPEARANCE_PAIRS`.
//
// The source parts read files with TypeScript's parser (`ts.createSourceFile`), never a regular expression over text, so
// a comment that merely spells a form is not a hit. NOT EXHAUSTIVE: a list built at run time (`ids.map(…)`), a computed
// key and an id spelled in a template with a substitution are not seen; the contrast part and part 2 read the real
// stylesheets, which is where a palette that breaks the map shows.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_PAIRS, APPEARANCE_SLOTS } from '@synapsium-labs/pinax-lib/frame';
import { PHOSPHOR, REFINED, SKINS, THEMES } from '@ccrc/ui';
import { ts } from '../../server/test/scan/parse';
import { READER_APPEARANCE_MAP, readerAppearanceOf, type HostToken } from '../src/docs/reader/appearance';
import { parseTs } from './literalWalker';
import { blocksOf, matchedBlocks, resolvePaletteTokens, widthMediaTokens } from './helpers/paletteTokens';

const PWA = path.join(import.meta.dirname, '..');
const POINTERS = ['fine', 'coarse'] as const;
const THEME_IDS = THEMES.map((t) => t.id);
const SKIN_IDS = SKINS.map((s) => s.id);

/** Every palette, skin and pointer, with what the reader's adapter would build for it. */
function everyCombination(): { palette: string; skin: string; pointer: 'fine' | 'coarse'; tokens: ReadonlyMap<string, string>;
  colourScheme: string; outcome: ReturnType<typeof readerAppearanceOf> }[] {
  const out = [];
  for (const palette of THEME_IDS) for (const skin of SKIN_IDS) for (const pointer of POINTERS) {
    const { tokens, colourScheme } = resolvePaletteTokens(palette, skin, pointer);
    const outcome = readerAppearanceOf((t: HostToken) => tokens.get(t) ?? '', colourScheme);
    out.push({ palette, skin, pointer, tokens, colourScheme, outcome });
  }
  return out;
}

let combosCache: ReturnType<typeof everyCombination> | undefined;
/** The combinations, built once (they are pure and the cases below share them). */
const combinations = (): ReturnType<typeof everyCombination> => (combosCache ??= everyCombination());

const mappedTokens = (): HostToken[] =>
  [...new Set([...Object.values(READER_APPEARANCE_MAP.colour), ...Object.values(READER_APPEARANCE_MAP.skin)])];

// ───────────────────────────────── 1. coverage ─────────────────────────────────
describe('part 1: the mapping covers the library\'s slots', () => {
  it('the slot keys of READER_APPEARANCE_MAP equal APPEARANCE_SLOTS, in both directions', () => {
    expect(Object.keys(READER_APPEARANCE_MAP.colour).sort()).toEqual([...APPEARANCE_SLOTS.colour].sort());
    expect(Object.keys(READER_APPEARANCE_MAP.skin).sort()).toEqual([...APPEARANCE_SLOTS.skin].sort());
  });
});

// ───────────────────────────── 2. every palette resolves ─────────────────────────────
/** The slots a token feeds, so a refusal naming one of them is a refusal of that token. */
const slotsOfToken = (token: HostToken): string[] =>
  [...Object.entries(READER_APPEARANCE_MAP.colour), ...Object.entries(READER_APPEARANCE_MAP.skin)]
    .filter(([, t]) => t === token).map(([slot]) => slot);

describe('part 2: every mapped token resolves, in every palette, skin and pointer', () => {
  it('finds the catalogue at all (a loop over nothing passes)', () => {
    expect(THEME_IDS.length).toBeGreaterThanOrEqual(12);
    expect(SKIN_IDS.length).toBeGreaterThanOrEqual(2);
    expect(mappedTokens().length).toBeGreaterThan(30);
  });

  for (const palette of THEME_IDS) for (const skin of SKIN_IDS) for (const pointer of POINTERS) {
    it(`${palette} / ${skin} / ${pointer}: the library accepts all of it and the colour scheme is the palette's mode`, () => {
      const c = combinations().find((x) => x.palette === palette && x.skin === skin && x.pointer === pointer)!;
      const at = `${palette} / ${skin} / ${pointer}`;
      expect(c.outcome.dropped, `${at}: colour group dropped`).toBeNull();
      expect(c.outcome.refused, `${at}: refused by the library`).toEqual([]);
      const row = THEMES.find((t) => t.id === palette);
      expect(['light', 'dark']).toContain(c.colourScheme);
      expect(c.colourScheme, `${palette}: color-scheme against its THEMES row`).toBe(row?.mode);
      expect(c.outcome.value.mode).toBe(row?.mode);
      expect(Object.keys(c.outcome.value.colour ?? {})).toHaveLength(APPEARANCE_SLOTS.colour.length);
      expect(Object.keys(c.outcome.value.skin ?? {})).toHaveLength(APPEARANCE_SLOTS.skin.length);
    });

    for (const token of mappedTokens()) {
      it(`${palette} / ${skin} / ${pointer} / ${token}: resolves, and the verdict keeps every slot it feeds`, () => {
        const c = combinations().find((x) => x.palette === palette && x.skin === skin && x.pointer === pointer)!;
        expect(c.tokens.get(token) ?? '', `${palette} / ${skin} / ${pointer}: ${token} answers nothing`).not.toBe('');
        const fed = slotsOfToken(token);
        expect(fed.length).toBeGreaterThan(0);
        expect(c.outcome.dropped?.token).not.toBe(token);
        const refused = c.outcome.refused.filter((r) => fed.some((slot) => r.key === `colour.${slot}` || r.key === `skin.${slot}`));
        expect(refused, `${palette} / ${skin} / ${pointer}: ${token} refused`).toEqual([]);
      });
    }
  }

  // The helper must not measure a palette or skin as the default because its block was spelled in a form it skipped.
  it('every palette other than the default matched a block of its own, and every skin other than the default its skin block', () => {
    for (const id of THEME_IDS.filter((t) => t !== PHOSPHOR)) {
      expect(matchedBlocks(id, REFINED, 'coarse').theme, `palette ${id}: matched no [data-theme] block`).toBeGreaterThanOrEqual(1);
    }
    for (const id of SKIN_IDS.filter((k) => k !== REFINED)) {
      expect(matchedBlocks(PHOSPHOR, id, 'coarse').skin, `skin ${id}: matched no skin block`).toBeGreaterThanOrEqual(1);
    }
    // The default matches no block of its own: a palette or skin that did would be a second default.
    expect(matchedBlocks(PHOSPHOR, REFINED, 'fine')).toEqual({ theme: 0, skin: 0, skinPointerArm: 0 });
  });

  it('the (pointer: fine) arm matched for each skin that declares one, and only under a fine pointer', () => {
    const skinsCss = readFileSync(path.join(PWA, '..', 'ui', 'src', 'styles', 'skins.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let withArm = 0;
    for (const id of SKIN_IDS) {
      const declares = new RegExp(`@media\\s*\\(pointer:\\s*fine\\)\\s*\\{\\s*:root\\[data-skin='${id}'\\]`).test(skinsCss);
      if (declares) withArm++;
      expect(matchedBlocks(PHOSPHOR, id, 'fine').skinPointerArm >= 1, `skin ${id}: pointer arm under a fine pointer`).toBe(declares);
      expect(matchedBlocks(PHOSPHOR, id, 'coarse').skinPointerArm, `skin ${id}: pointer arm under a coarse pointer`).toBe(0);
    }
    // Guards the guard: the one skin with a dense row has one.
    expect(withArm).toBeGreaterThanOrEqual(1);
  });

  it('the helper throws on a selector or a media condition it cannot read, never skipping it', () => {
    expect(() => blocksOf(`[data-theme='x'] .y { --a: 1; }`)).toThrow(/selector/);
    expect(() => blocksOf(`:root[data-skin="instrument"] { --a: 1; }`)).toThrow(/selector/);
    expect(() => blocksOf(`:root[data-skin='a'][data-theme='b'] { --a: 1; }`)).toThrow(/selector/);
    expect(() => blocksOf(`@media (hover: hover) { :root { --a: 1; } }`)).toThrow(/media/);
    expect(() => blocksOf(`@media (pointer:fine) and (hover: hover) { :root { --a: 1; } }`)).toThrow(/media/);
    // The spellings it does read, whitespace aside.
    expect(blocksOf(`@media (pointer:fine) { :root { --a: 1; } }`)[0]?.media).toBe('pointer-fine');
    expect(blocksOf(`@media (min-width: 900px) { :root { --a: 1; } }`)[0]?.media).toBe('width');
  });

  it('no mapped token is declared inside a width @media arm, which the helper does not apply', () => {
    const arms = widthMediaTokens();
    // Guards the guard: both stylesheets have width arms, so a parser that finds none would pass the next line.
    expect(arms.length).toBeGreaterThan(0);
    const mapped = new Set<string>(mappedTokens());
    expect(arms.filter((t) => mapped.has(t))).toEqual([]);
  });
});

// ───────────────────────────────── 3. no second list ─────────────────────────────────
/** Every `.ts` and `.tsx` file at `root` (a file) or under it (a directory), sorted. */
function sourceFiles(root: string): string[] {
  if (statSync(root).isFile()) return [root];
  const out: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const p = path.join(root, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// The shared walker's parser (`literalWalker.ts`), not a second copy of it.
const parse = (source: string, file: string): ts.SourceFile => parseTs(file, source);

/** The text of every string-like literal in a file (string, no-substitution template, and a template's fixed parts). */
function literalTexts(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n)
      || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The names a file spells as an object key, quoted or not (`{ nord: 1 }`, `{ 'nord': 1 }`, `{ nord }`, a type member). */
function keyNames(sf: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isPropertyAssignment(n) || ts.isPropertySignature(n) || ts.isEnumMember(n)) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name))) {
      out.push(n.name.text);
    } else if (ts.isShorthandPropertyAssignment(n)) out.push(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The ids from `ids` a source holds, as string literals or as object keys. Two or more is a second list. */
function idsHeld(source: string, ids: readonly string[], file = 'probe.ts'): string[] {
  const sf = parse(source, file);
  const spelled = new Set([...literalTexts(sf), ...keyNames(sf)]);
  return ids.filter((id) => spelled.has(id));
}

/** A module specifier that reaches the design system's catalogue: the package, its source tree, or the two catalogue files. */
const DESIGN_SYSTEM = /^@ccrc\/ui$|(^|\/)ui\/src(\/|$)|\/styles\/(themes|skins)$/;

/** Which of `THEMES` and `SKINS` a source reaches, by any route: a named import or re-export (`import { THEMES as T }`), a
 *  namespace import read through (`import * as ui` then `ui.THEMES` or `ui['THEMES']`), a destructuring of it
 *  (`const { SKINS } = ui`), and a blanket `export * from` the design system, which re-exports both. */
function catalogueNames(sf: ts.SourceFile): string[] {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const note = (n: string): void => { if (n === 'THEMES' || n === 'SKINS') names.add(n); };
  const visit = (n: ts.Node): void => {
    if (ts.isImportSpecifier(n) || ts.isExportSpecifier(n)) note((n.propertyName ?? n.name).text);
    else if (ts.isNamespaceImport(n)) namespaces.add(n.name.text);
    else if (ts.isExportDeclaration(n) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)
      && (n.exportClause === undefined || ts.isNamespaceExport(n.exportClause)) && DESIGN_SYSTEM.test(n.moduleSpecifier.text)) {
      names.add('THEMES'); names.add('SKINS');
    } else if (ts.isBindingElement(n)) {
      const key = n.propertyName ?? n.name;
      if (ts.isIdentifier(key) || ts.isStringLiteral(key)) note(key.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Reads through a namespace: a second pass, once every namespace binding is known.
  const reads = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text)) note(n.name.text);
    else if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && namespaces.has(n.expression.text)
      && ts.isStringLiteral(n.argumentExpression)) note(n.argumentExpression.text);
    ts.forEachChild(n, reads);
  };
  reads(sf);
  return [...names].sort();
}

const rel = (file: string): string => path.relative(PWA, file).split(path.sep).join('/');

/** The roots part 3 covers: the Docs code, the reader lab, and the two files that own the stamp. Every one is REQUIRED. */
const SCAN_ROOTS = [
  path.join(PWA, 'src', 'docs'),
  path.join(PWA, 'src', 'readerLab'),
  path.join(PWA, 'src', 'lib', 'appearance.ts'),
  path.join(PWA, 'src', 'lib', 'appearanceStamp.ts'),
];
/** Every file under the roots. A root that is missing, or yields no file, throws naming it: a rename must red, not shrink the scan. */
const scannedFiles = (): string[] => SCAN_ROOTS.flatMap((root) => {
  if (!existsSync(root)) throw new Error(`part 3: the scan root ${rel(root)} does not exist`);
  const files = sourceFiles(root);
  if (files.length === 0) throw new Error(`part 3: the scan root ${rel(root)} holds no .ts or .tsx file`);
  return files;
});

describe('part 3: no second list of the catalogue', () => {
  it('scans every named root, and the reader\'s own module is among the files (a scan of nothing passes)', () => {
    const files = scannedFiles().map(rel);
    expect(files).toContain('src/docs/reader/appearance.ts');
    expect(files).toContain('src/lib/appearance.ts');
    expect(files).toContain('src/lib/appearanceStamp.ts');
    expect(files.some((f) => f.startsWith('src/readerLab/'))).toBe(true);
    expect(files.length).toBeGreaterThan(10);
  });

  it('the detector sees two ids as literals or keys, and one id alone is not a list', () => {
    expect(idsHeld(`const a = ['nord', 'dracula'];`, THEME_IDS)).toEqual(['nord', 'dracula']);
    expect(idsHeld(`const a = { nord: 1, 'tokyo-night': 2 };`, THEME_IDS)).toEqual(['nord', 'tokyo-night']);
    expect(idsHeld(`const a = { nord };`, THEME_IDS)).toEqual(['nord']);
    expect(idsHeld(`const a = 'refined'; const b = "instrument";`, SKIN_IDS)).toEqual(['refined', 'instrument']);
    expect(idsHeld(`const mode = 'light'; // nord and dracula, in a comment`, THEME_IDS)).toEqual(['light']);
  });

  it('the import rule sees a namespace read, a destructuring, a blanket re-export and a named import, and not an unrelated one', () => {
    const names = (src: string): string[] => catalogueNames(parse(src, 'probe.ts'));
    expect(names(`import * as ui from '@ccrc/ui'; const a = ui.THEMES;`)).toEqual(['THEMES']);
    expect(names(`import * as ui from '@ccrc/ui'; const a = ui['SKINS'];`)).toEqual(['SKINS']);
    expect(names(`import * as ui from '@ccrc/ui'; const { SKINS } = ui;`)).toEqual(['SKINS']);
    expect(names(`export * from '@ccrc/ui';`)).toEqual(['SKINS', 'THEMES']);
    expect(names(`export * from '../../../ui/src/styles/themes';`)).toEqual(['SKINS', 'THEMES']);
    expect(names(`import { THEMES as T } from '@ccrc/ui';`)).toEqual(['THEMES']);
    expect(names(`import * as ui from '@ccrc/ui'; const a = ui.Button; export * from './other';`)).toEqual([]);
  });

  it('no file holds two or more palette ids, or two or more skin ids, as string literals or object keys', () => {
    const lists: string[] = [];
    for (const file of scannedFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const [kind, ids] of [['palette', THEME_IDS], ['skin', SKIN_IDS]] as const) {
        const held = idsHeld(source, ids, file);
        if (held.length >= 2) lists.push(`${rel(file)}: ${kind} ids ${held.join(', ')}`);
      }
    }
    expect(lists).toEqual([]);
  });

  it('no file under src/docs/reader/ holds a hex colour literal', () => {
    const hits: string[] = [];
    for (const file of sourceFiles(path.join(PWA, 'src', 'docs', 'reader'))) {
      for (const text of literalTexts(parse(readFileSync(file, 'utf8'), file))) {
        if (/#[0-9A-Fa-f]{3,8}\b/.test(text)) hits.push(`${rel(file)}: ${text.slice(0, 40)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('only src/docs/ReaderFrame.tsx imports THEMES, and no file imports SKINS', () => {
    const themes: string[] = [];
    const skins: string[] = [];
    for (const file of scannedFiles()) {
      const names = catalogueNames(parse(readFileSync(file, 'utf8'), file));
      if (names.includes('THEMES')) themes.push(rel(file));
      if (names.includes('SKINS')) skins.push(rel(file));
    }
    expect(themes.filter((f) => f !== 'src/docs/ReaderFrame.tsx')).toEqual([]);
    expect(skins).toEqual([]);
  });
});

// ───────────────────────────── 4. no stylesheet crosses ─────────────────────────────
const FORBIDDEN = [';', '{', '}', 'url(', 'var('] as const;
const TOP_KEYS = ['mode', 'label', 'colour', 'skin'];

describe('part 4: no stylesheet crosses the bridge', () => {
  it('at run time, no string in any value readerAppearanceOf builds holds ; { } url( or var(, and every key is a slot', () => {
    const combos = everyCombination();
    expect(combos.length).toBe(THEME_IDS.length * SKIN_IDS.length * POINTERS.length);
    const bad: string[] = [];
    for (const { palette, skin, pointer, outcome } of combos) {
      const at = `${palette} / ${skin} / ${pointer}`;
      const value = outcome.value as unknown as Record<string, unknown>;
      for (const key of Object.keys(value)) if (!TOP_KEYS.includes(key)) bad.push(`${at}: top-level key ${key}`);
      for (const group of ['colour', 'skin'] as const) {
        const slots: readonly string[] = APPEARANCE_SLOTS[group];
        for (const key of Object.keys((value[group] as object | undefined) ?? {})) {
          if (!slots.includes(key)) bad.push(`${at}: ${group} key ${key}`);
        }
      }
      const strings: string[] = [];
      const walk = (x: unknown): void => {
        if (typeof x === 'string') strings.push(x);
        else if (typeof x === 'object' && x !== null) for (const [k, v] of Object.entries(x)) { strings.push(k); walk(v); }
      };
      walk(value);
      for (const s of strings) for (const f of FORBIDDEN) if (s.includes(f)) bad.push(`${at}: "${s}" holds ${f}`);
    }
    expect(bad).toEqual([]);
  });

  it('in source, appearance.ts holds no string with ; { } url( or var(', () => {
    const file = path.join(PWA, 'src', 'docs', 'reader', 'appearance.ts');
    const hits: string[] = [];
    for (const text of literalTexts(parse(readFileSync(file, 'utf8'), file))) {
      for (const f of FORBIDDEN) if (text.includes(f)) hits.push(`"${text}" holds ${f}`);
    }
    expect(hits).toEqual([]);
  });
});

// ───────────────────────────────── 5. contrast (spec §5) ─────────────────────────────────
type Rgb = readonly [number, number, number];

function rgbOf(hex: string): Rgb {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex.trim());
  if (m === null) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `color-mix(in srgb, a <share>, b)`, each channel rounded to 8 bits as a browser paints it. */
function mix(a: Rgb, share: number, b: Rgb): Rgb {
  const ch = (i: 0 | 1 | 2): number => Math.round(a[i] * share + b[i] * (1 - share));
  return [ch(0), ch(1), ch(2)];
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(x: Rgb, y: Rgb): number {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A pair operand: a colour slot, the library's derived `accent-hover` (`accent` 80% over `text`, as its stylesheet mixes it)
 * or `tint:<slot>@<ground>` (the slot at 4% over its ground). */
function colourOf(name: string, colour: Readonly<Record<string, string>>): Rgb {
  const slot = (s: string): Rgb => {
    const v = colour[s];
    if (v === undefined) throw new Error(`unknown colour slot in a pair: ${s}`);
    return rgbOf(v);
  };
  if (name === 'derived:accent-hover') return mix(slot('accent'), 0.8, slot('text'));
  const tint = /^tint:([a-z0-9-]+)@([a-z0-9-]+)$/.exec(name);
  if (tint !== null) return mix(slot(tint[1] as string), 0.04, slot(tint[2] as string));
  if (name.startsWith('derived:') || name.startsWith('tint:')) throw new Error(`a derived colour this test does not know: ${name}`);
  return slot(name);
}

interface Measured { readonly fg: string; readonly bg: string; readonly floor: number; readonly ratio: number }

function measure(colour: Readonly<Record<string, string>>): Measured[] {
  return APPEARANCE_PAIRS.map((p) => ({ fg: p.fg, bg: p.bg, floor: p.floor, ratio: ratio(colourOf(p.fg, colour), colourOf(p.bg, colour)) }));
}

const worstAt = (rows: readonly Measured[], floor: number): Measured | undefined =>
  rows.filter((r) => r.floor === floor).sort((a, b) => a.ratio - b.ratio)[0];
const pairName = (m: Measured | undefined): string => (m === undefined ? 'none' : `${m.fg} on ${m.bg} ${m.ratio.toFixed(2)}`);

describe('part 5: every pair of the library meets its floor under the map, in every palette', () => {
  let palettesChecked = 0;
  for (const palette of THEME_IDS) for (const skin of SKIN_IDS) {
    const { tokens, colourScheme } = resolvePaletteTokens(palette, skin, 'coarse');
    const outcome = readerAppearanceOf((t) => tokens.get(t) ?? '', colourScheme);
    const colour = outcome.value.colour;
    const rows = colour === undefined ? [] : measure(colour);
    const title = `${palette} / ${skin}: floor 4.5 worst ${pairName(worstAt(rows, 4.5))}; floor 3 worst ${pairName(worstAt(rows, 3))}`;
    it(title, () => {
      expect(colour, `${palette}: the mapped colours are accepted`).toBeDefined();
      expect(rows.length).toBe(APPEARANCE_PAIRS.length);
      const under = rows.filter((r) => r.ratio < r.floor).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(3)} < ${r.floor}`);
      expect(under, `${palette} / ${skin}: pairs under their floor`).toEqual([]);
      if (skin === SKIN_IDS[0]) palettesChecked++;
    });
  }

  it('checked every palette THEMES lists, read at run time', () => {
    expect(palettesChecked).toBe(THEMES.length);
  });

  it('the library\'s pairs hold both floors and a product of operands this test knows', () => {
    expect(new Set(APPEARANCE_PAIRS.map((p) => p.floor))).toEqual(new Set([3, 4.5]));
    const sample = Object.fromEntries(APPEARANCE_SLOTS.colour.map((s) => [s, '#808080']));
    expect(() => measure(sample)).not.toThrow();
  });
});
