// Native Docs reader, completion plan Task 7 (C1): the CSS scan and its nesting (`css.ts`, driven through the real loader;
// base spec 2026-10-01 5.6.3's CSS scanning and Budgets, row M5.12). The scan finds two patterns only, in TEXT order, and
// leaves everything else untouched; a stylesheet's discoveries are fed to the planner by the loader, never by a hand-fed
// list. Placeholders only (`demo`, `a.example`).
import { describe, expect, it } from 'vitest';
import type { DocPin, DocsEntry } from '../../shared/docs';
import { MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ASSETS } from '../src/docs/mockup/policy';
import { extractCssRefs, refsFromTokens, rewriteCss, rewriteCssBytes, scanCss, scanCssBytes } from '../src/docs/mockup/css';
import { loadMockupAssets } from '../src/docs/mockup/load';
import { planMockupAssets } from '../src/docs/mockup/plan';
import type { MockupAssetReader, MockupContext, MockupReadAnswer, MockupRef } from '../src/docs/mockup/ports';
import { COMMIT_A, SERVED, entry, holder, treeOk } from './docsFixtures';

const MIB = 1024 * 1024;
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

describe('scanCss: two patterns, in text order (M5.12)', () => {
  it('finds a url() with an unquoted, a single-quoted and a double-quoted argument, with exact spans', () => {
    const text = 'a{background:url(a.png)} b{background:url( \'b.png\' )} c{background:url("c.png")}';
    const tokens = scanCss(text);
    expect(tokens.map((t) => [t.raw, t.kind])).toEqual([['a.png', 'image'], ['b.png', 'image'], ['c.png', 'image']]);
    for (const t of tokens) expect(text.slice(t.start, t.end)).toBe(t.raw);
  });

  it('an @import followed by a quoted string is a css token; @import url(...) is the url pattern, classed as an import', () => {
    const tokens = scanCss('@import "a.css"; @import \'b.css\'; @import url(c.css); @import url("d.css") screen;');
    expect(tokens.map((t) => [t.raw, t.kind])).toEqual([['a.css', 'css'], ['b.css', 'css'], ['c.css', 'css'], ['d.css', 'css']]);
  });

  it('a url() inside an @font-face block is a font; every other url() is an image, and the block ends at its brace', () => {
    const text = '@font-face{font-family:x;src:url("f.woff2") format("woff2"), url(g.woff)} .a{background:url(i.png)}';
    expect(scanCss(text).map((t) => [t.raw, t.kind])).toEqual([['f.woff2', 'font'], ['g.woff', 'font'], ['i.png', 'image']]);
  });

  it('keeps TEXT order: font before image, and the reversed fixture image before font (never sorted by kind)', () => {
    const fontFirst = '@import "x.css"; @font-face { font-family: example; src: url("a.woff2") } .hero { background-image: url("a.png") }';
    const imageFirst = '@import "x.css"; .hero { background-image: url("a.png") } @font-face { font-family: example; src: url("a.woff2") }';
    expect(scanCss(fontFirst).map((t) => t.kind)).toEqual(['css', 'font', 'image']);
    expect(scanCss(imageFirst).map((t) => t.kind)).toEqual(['css', 'image', 'font']);
  });

  it('upper-case spellings are the same patterns', () => {
    expect(scanCss('@IMPORT "a.css"; .a{background:URL(b.png)} @FONT-FACE{src:Url(c.woff)}').map((t) => [t.raw, t.kind]))
      .toEqual([['a.css', 'css'], ['b.png', 'image'], ['c.woff', 'font']]);
  });

  it.each([
    ['an escape in an unquoted argument', 'a{background:url(a\\.png)}'],
    ['an escape in a quoted argument', 'a{background:url("a\\"b.png")}'],
    ['a comment inside the function name', 'a{background:u/**/rl(a.png)}'],
    ['an image-set string', 'a{background:image-set("a.png" 1x, "b.png" 2x)}'],
    ['a url() inside a string', 'a{content:"url(a.png)"}'],
    ['a url() inside a comment', '/* url(a.png) */ a{}'],
    ['a function that only ends in url', 'a{background:myurl(a.png)}'],
    ['an @import with no string', '@import foo; @import ;'],
    ['an unquoted argument with a space inside', 'a{background:url(a b.png)}'],
    ['an unterminated quoted argument', 'a{background:url("a.png}'],
    ['an empty argument', 'a{background:url(); background:url("")}'],
    ['a src() function', 'a{background:src("a.png")}'],
  ])('leaves %s untouched', (_name, text) => {
    expect(scanCss(text)).toEqual([]);
  });

  it('a quote in a comment does not start a string', () => {
    expect(scanCss("/* don't */ a{background:url(a.png)}").map((t) => t.raw)).toEqual(['a.png']);
  });
});

describe('rewriteCss: only the chosen spans change', () => {
  it('replaces the token spans a function names and nothing else, quotes and neighbours intact', () => {
    const text = '@import "a.css"; .a{background:url(b.png)} .b{background:url( \'c.png\' )}';
    const tokens = scanCss(text);
    const out = rewriteCss(text, tokens, (i) => (i === 1 ? 'data:image/png;base64,QQ==' : null));
    expect(out).toBe('@import "a.css"; .a{background:url(data:image/png;base64,QQ==)} .b{background:url( \'c.png\' )}');
    expect(rewriteCss(text, tokens, () => null)).toBe(text);
    expect(rewriteCss(text, [], () => 'x')).toBe(text);
  });
});

describe('extractCssRefs: a stylesheet\'s references (M5.12)', () => {
  const parent: MockupRef = { key: 'r3', raw: 'css/s.css', basePath: 'specs/m.html', kind: 'css', depth: 1 };

  it('keys are the parent key then the token index; depth is the parent\'s plus one; the base is the stylesheet\'s own path', () => {
    const refs = extractCssRefs('@import "n.css"; a{background:url(i.png)} @font-face{src:url(f.woff2)}', parent);
    expect(refs).toEqual([
      { key: 'r3>0', raw: 'n.css', basePath: 'specs/css/s.css', kind: 'css', depth: 2 },
      { key: 'r3>1', raw: 'i.png', basePath: 'specs/css/s.css', kind: 'image', depth: 2 },
      { key: 'r3>2', raw: 'f.woff2', basePath: 'specs/css/s.css', kind: 'font', depth: 2 },
    ]);
  });

  it('is deterministic: the same text gives the same keys', () => {
    const text = '@import "n.css"; a{background:url(i.png)}';
    expect(extractCssRefs(text, parent)).toEqual(extractCssRefs(text, parent));
  });

  it('refsFromTokens builds a page-level style\'s references with the caller\'s own keys', () => {
    const text = 'a{background:url(i.png)}';
    expect(refsFromTokens(scanCss(text), 'specs/m.html', 0, (i) => `s0:${i}`))
      .toEqual([{ key: 's0:0', raw: 'i.png', basePath: 'specs/m.html', kind: 'image', depth: 0 }]);
  });
});

describe('@namespace is not an asset reference', () => {
  it.each([
    ['an unquoted url()', '@namespace url(http://www.w3.org/1999/xhtml); a{background:url(a.png)}'],
    ['a prefixed, quoted url()', '@namespace svg url("http://www.w3.org/2000/svg"); a{background:url(a.png)}'],
    ['a string', '@namespace "http://www.w3.org/1999/xhtml"; a{background:url(a.png)}'],
    ['upper case, spaced', '@NAMESPACE   url( \'http://www.w3.org/1999/xhtml\' )  ;a{background:url(a.png)}'],
  ])('%s is skipped and the next rule\'s url() is still found', (_name, text) => {
    expect(scanCss(text).map((t) => [t.raw, t.kind])).toEqual([['a.png', 'image']]);
  });

  it('a block ends the at-rule: a url() in the next rule after `@namespace x {}` is still a reference', () => {
    expect(scanCss('@namespace x {} a{background:url(a.png)}').map((t) => [t.raw, t.kind])).toEqual([['a.png', 'image']]);
    expect(scanCss('@namespace x { } @namespace url(n); a{background:url(b.png)}').map((t) => t.raw)).toEqual(['b.png']);
  });

  it('an @import and an @font-face beside it are unaffected', () => {
    expect(scanCss('@namespace url(x.example); @import "i.css"; @font-face{src:url(f.woff2)}').map((t) => [t.raw, t.kind]))
      .toEqual([['i.css', 'css'], ['f.woff2', 'font']]);
  });
});

describe('the scan at byte level: spans are byte offsets, and the bytes outside them are copied', () => {
  const bytes = (...parts: Array<string | number[]>): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? Array.from(enc(p)) : p)));

  it('a multi-byte character before a token does not shift its span, and the raw is decoded as UTF-8', () => {
    const css = bytes('/* é€ */ a{background:url(', 'é.png', ')}');
    const tokens = scanCssBytes(css);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.raw).toBe('é.png');
    expect(new TextDecoder().decode(css.subarray(tokens[0]!.start, tokens[0]!.end))).toBe('é.png');
  });

  it('finds the same tokens, in the same order, as the text scan, whatever invalid bytes sit around them', () => {
    const clean = '@import "a.css"; .x{background:url(b.png)} @font-face{src:url(c.woff2)}';
    const dirty = bytes('/* ', [0xff, 0xc3], ' */ @import "a.css"; .x{content:"', [0xe9], '";background:url(b.png)} @font-face{src:url(c.woff2)}');
    expect(scanCssBytes(dirty).map((t) => [t.raw, t.kind])).toEqual(scanCss(clean).map((t) => [t.raw, t.kind]));
  });

  it('rewriteCssBytes replaces only the chosen spans and copies every other byte, invalid ones included', () => {
    const css = bytes('@charset "iso-8859-1";/*', [0xff, 0xe9], '*/ a{background:url(a.png)} b{background:url(b.png)}');
    const tokens = scanCssBytes(css);
    const out = rewriteCssBytes(css, tokens, (i) => (i === 1 ? 'data:x;base64,QQ==' : null));
    expect(Array.from(out)).toEqual(Array.from(bytes('@charset "iso-8859-1";/*', [0xff, 0xe9], '*/ a{background:url(a.png)} b{background:url(data:x;base64,QQ==)}')));
  });

  it('with no token chosen it returns the original bytes themselves', () => {
    const css = bytes('a{content:"', [0xff], '";background:url(a.png)}');
    expect(rewriteCssBytes(css, scanCssBytes(css), () => null)).toBe(css);
    expect(rewriteCssBytes(css, [], () => 'x')).toBe(css);
  });

  it('the loader discovers a stylesheet\'s references from its bytes: an invalid byte does not hide or move them', async () => {
    const css = bytes('/*', [0xff, 0xfe], '*/ a{background:url(i.png)}');
    const ctx = ctxOf([sized('s.css', css.length), sized('i.png', 10)]);
    const reader = recorder({ 's.css': css, 'i.png': 'PNG' });
    const result = await loadMockupAssets(planMockupAssets([rootRef('s.css')], ctx), reader, new AbortController().signal);
    expect(reader.calls).toEqual(['s.css', 'i.png']);
    expect(result.plan.rows.map((r) => r.verdict.v)).toEqual(['inline', 'inline']);
  });
});

describe('the scan is linear (a 2 MiB adversarial input scans well under a second)', () => {
  const shapes: Array<[string, string]> = [
    ['url( repeated', 'url('],
    ['url(" repeated', 'url("'],
    ['@import repeated', '@import '],
    ['an opening comment repeated', '/*'],
    ['@font-face { repeated', '@font-face{url('],
    ["a quote repeated", "'"],
    ['url(a  repeated with spaces', 'url(a    '],
  ];
  it.each(shapes)('%s', (_name, unit) => {
    const text = unit.repeat(Math.ceil((2 * MIB) / unit.length));
    expect(text.length).toBeGreaterThanOrEqual(2 * MIB);
    const t0 = performance.now();
    scanCss(text);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Nesting through the real loader: depth, cycles, budgets and the forms the scan leaves alone.
// ---------------------------------------------------------------------------------------------------------------
const PAGE = 'm.html';
const sized = (path: string, size: number, over: Partial<DocsEntry> = {}): DocsEntry =>
  entry('specs', path, { committed: { kind: 'file', blob: '1'.repeat(40), size }, ...over });

function ctxOf(entries: DocsEntry[]): MockupContext {
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: PAGE };
  return { project: 'demo', pin, tree: treeOk({ entries: [entry('specs', PAGE), ...entries], drafts: holder() }) };
}

function recorder(files: Record<string, string | Uint8Array<ArrayBuffer>>): MockupAssetReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    read: async (pin): Promise<MockupReadAnswer> => {
      calls.push(pin.path);
      const f = files[pin.path];
      return f === undefined ? { kind: 'failed', failure: 'not-found' } : { kind: 'ok', bytes: typeof f === 'string' ? enc(f) : f };
    },
  };
}

const rootRef = (raw: string, kind: MockupRef['kind'] = 'css'): MockupRef =>
  ({ key: `r:${raw}`, raw, basePath: 'specs/m.html', kind, depth: 0 });

describe('nested stylesheets through the real loader (M5.12)', () => {
  it('depth 3 is admitted and read; a depth 4 reference is unsupported:css-depth and never read', async () => {
    const files = {
      'a.css': '@import "b.css";',
      'b.css': '@import "c.css";',
      'c.css': '@import "d.css";',
      'd.css': 'x{background:url("deep.png")} y{background:url("too-deep.png")}',
      'deep.png': 'PNG',
      'too-deep.png': 'PNG',
    };
    const ctx = ctxOf(Object.entries(files).map(([p, b]) => sized(p, b.length)));
    // a.css is depth 0 (a page link), b 1, c 2, d 3: d's own references are depth 4.
    const reader = recorder(files);
    const result = await loadMockupAssets(planMockupAssets([rootRef('a.css')], ctx), reader, new AbortController().signal);
    const byRaw = new Map(result.plan.rows.map((r) => [r.ref.raw, r]));
    expect(byRaw.get('b.css')!.ref.depth).toBe(1);
    expect(byRaw.get('d.css')!.ref.depth).toBe(3);
    expect(byRaw.get('d.css')!.verdict.v).toBe('inline');
    expect(byRaw.get('deep.png')!.ref.depth).toBe(4);
    expect(byRaw.get('deep.png')!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    expect(byRaw.get('too-deep.png')!.verdict).toEqual({ v: 'unsupported', why: 'css-depth' });
    expect(reader.calls).toEqual(['a.css', 'b.css', 'c.css', 'd.css']);
  });

  it('an @import cycle (a imports b imports a) reads each once and ends', async () => {
    const files = { 'a.css': '@import "b.css";', 'b.css': '@import "a.css";' };
    const ctx = ctxOf([sized('a.css', 20), sized('b.css', 20)]);
    const reader = recorder(files);
    const result = await loadMockupAssets(planMockupAssets([rootRef('a.css')], ctx), reader, new AbortController().signal);
    expect([...reader.calls].sort()).toEqual(['a.css', 'b.css']);
    expect(result.plan.reservedBytes).toBe(40);
    expect(result.plan.rows.map((r) => r.verdict.v)).toEqual(['inline', 'inline', 'inline']);
  });

  it('a stylesheet in a subdirectory resolves its references relative to itself, not to the page', async () => {
    const files = { 'css/s.css': 'a{background:url(img/i.png)}', 'css/img/i.png': 'PNG', 'img/i.png': 'WRONG' };
    const ctx = ctxOf(Object.entries(files).map(([p, b]) => sized(p, b.length)));
    const reader = recorder(files);
    const result = await loadMockupAssets(planMockupAssets([rootRef('css/s.css')], ctx), reader, new AbortController().signal);
    expect(reader.calls).toEqual(['css/s.css', 'css/img/i.png']);
    expect(result.plan.rows[1]!.ref.basePath).toBe('specs/css/s.css');
  });

  it('budget failures stay explicit rows: the 64-asset count and the 5 MiB total each skip the next nested asset, with no read', async () => {
    const small = Array.from({ length: MOCKUP_MAX_ASSETS - 1 }, (_, i) => `p${i}.png`);
    const css = small.map((n) => `a{background:url(${n})}`).join('') + 'b{background:url(extra.png)}';
    const entries = [sized('s.css', css.length), ...small.map((n) => sized(n, 10)), sized('extra.png', 10)];
    const reader = recorder({ 's.css': css });
    const count = await loadMockupAssets(planMockupAssets([rootRef('s.css')], ctxOf(entries)), reader, new AbortController().signal);
    const extra = count.plan.rows.find((r) => r.ref.raw === 'extra.png')!;
    expect(extra.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(extra.size).toBeNull();
    expect(reader.calls).not.toContain('extra.png');

    const css2 = 'a{background:url(big1.png)} b{background:url(big2.png)} c{background:url(over.png)}';
    const entries2 = [sized('s.css', css2.length), sized('big1.png', 2 * MIB), sized('big2.png', 2 * MIB), sized('over.png', MIB)];
    const reader2 = recorder({ 's.css': css2, 'big1.png': 'x', 'big2.png': 'x' });
    const bytes = await loadMockupAssets(planMockupAssets([rootRef('s.css')], ctxOf(entries2)), reader2, new AbortController().signal);
    expect(bytes.plan.rows.map((r) => r.verdict.v)).toEqual(['inline', 'inline', 'inline', 'skipped']);
    expect(bytes.plan.rows[3]!.verdict).toEqual({ v: 'skipped', why: 'over-budget' });
    expect(reader2.calls).toEqual(['s.css', 'big1.png', 'big2.png']);
    expect(bytes.plan.reservedBytes).toBe(css2.length + 4 * MIB);
    expect(bytes.plan.reservedBytes + MIB).toBeGreaterThan(MOCKUP_MAX_ASSET_BYTES);
  });

  it('forms the scan leaves alone are never read: an image-set string, a comment-split url and a string', async () => {
    const css = 'a{background:image-set("set.png" 1x)} b{background:u/**/rl(split.png)} c{content:"url(str.png)"} d{background:url(real.png)}';
    const names = ['set.png', 'split.png', 'str.png', 'real.png'];
    const entries = [sized('s.css', css.length), ...names.map((n) => sized(n, 10))];
    const reader = recorder({ 's.css': css, 'real.png': 'PNG' });
    const result = await loadMockupAssets(planMockupAssets([rootRef('s.css')], ctxOf(entries)), reader, new AbortController().signal);
    expect(reader.calls).toEqual(['s.css', 'real.png']);
    expect(result.plan.rows.map((r) => r.ref.raw)).toEqual(['s.css', 'real.png']);
  });

  it('the class cap bounds a stylesheet reply: a css reply over its reservation is failed, never scanned', async () => {
    const css = 'a{background:url(i.png)}';
    const ctx = ctxOf([sized('s.css', css.length), sized('i.png', 10)]);
    const reader = recorder({ 's.css': css + ' '.repeat(10), 'i.png': 'PNG' });
    const result = await loadMockupAssets(planMockupAssets([rootRef('s.css')], ctx), reader, new AbortController().signal);
    expect(result.plan.rows[0]!.verdict).toEqual({ v: 'failed', failure: 'size-mismatch' });
    expect(result.plan.rows).toHaveLength(1);
    expect(reader.calls).toEqual(['s.css']);
    expect(result.actualBytes).toBe(css.length + 10);
  });
});
