// The Docs page grammar and the one docs API URL builder (spec 2026-10-01 3.1-3.2; mutation rows M3.1-M3.3).
// The page parser is L0 (`shared/docs.ts`) and is run here, on the server side, so one file pins the grammar
// for both of its consumers: the PWA's router and the server's own reading of the same constants.
import { describe, it, expect } from 'vitest';
import {
  DOCS_API_PREFIX, DOCS_PAGE_KEYS, DOCS_PAGE_PREFIX, DOCS_PIN_KEYS, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE,
  docsApi, docsPageUrl, parseDocsPage, type DocPin, type DocsPageLocation, type DocsPageParseFailure,
} from '../../shared/docs.js';

const C40 = 'a'.repeat(40);
const H40 = 'b'.repeat(40);
const F64 = 'c'.repeat(64);

/** Split a URL the way the PWA hands it over: `location.pathname` and `location.search`. */
const split = (url: string): [string, string] => {
  const q = url.indexOf('?');
  return q < 0 ? [url, ''] : [url.slice(0, q), url.slice(q)];
};
const parse = (url: string) => parseDocsPage(...split(url));
const why = (url: string): DocsPageParseFailure | 'ok' => {
  const r = parse(url);
  return r.ok ? 'ok' : r.why;
};

const leaf = (path: string, over: Partial<Extract<DocsPageLocation, { kind: 'path' }>> = {}): DocsPageLocation => ({
  kind: 'path', project: 'demo', section: 'specs', path, dirSlash: false, ref: null, view: 'effective', frame: 'inline',
  ...over,
});

/** Canonical URLs and the location each one means. Every row must round-trip in both directions. */
const CANONICAL: readonly (readonly [string, DocsPageLocation])[] = [
  ['/docs', { kind: 'index' }],
  ['/docs/demo', { kind: 'project', project: 'demo', ref: null }],
  ['/docs/example-project?ref=ws/a', { kind: 'project', project: 'example-project', ref: { kind: 'bare', name: 'ws/a' } }],
  ['/docs/demo/specs', { kind: 'section', project: 'demo', section: 'specs', ref: null }],
  ['/docs/demo/product-design?ref=refs/remotes/origin/ws/a',
    { kind: 'section', project: 'demo', section: 'product-design',
      ref: { kind: 'qualified', ref: 'refs/remotes/origin/ws/a' } }],
  ['/docs/demo/plans/sub/', leaf('sub', { section: 'plans', dirSlash: true })],
  ['/docs/demo/conventions/a/b/', leaf('a/b', { section: 'conventions', dirSlash: true })],
  ['/docs/demo/specs/a.md', leaf('a.md')],
  ['/docs/demo/specs/a/b.md', leaf('a/b.md')],
  ['/docs/demo/specs/a.md?ref=ws/a', leaf('a.md', { ref: { kind: 'bare', name: 'ws/a' } })],
  ['/docs/demo/specs/a.md?ref=refs/heads/ws/a&view=committed',
    leaf('a.md', { ref: { kind: 'qualified', ref: 'refs/heads/ws/a' }, view: 'committed' })],
  ['/docs/demo/specs/m.html?frame=full', leaf('m.html', { frame: 'full' })],
  ['/docs/demo/specs/m.html?ref=ws/a&view=committed&frame=full',
    leaf('m.html', { ref: { kind: 'bare', name: 'ws/a' }, view: 'committed', frame: 'full' })],
  ['/docs/demo/specs/a%20b/%C3%A9.md', leaf('a b/' + String.fromCodePoint(0xe9) + '.md')],
  ['/docs/demo/specs/x%2By.md', leaf('x+y.md')],
];

describe('M3.1: canonical page URLs round-trip', () => {
  it.each(CANONICAL)('%s', (url, loc) => {
    const r = parse(url);
    expect(r).toEqual({ ok: true, loc, canonical: url });
    expect(docsPageUrl(loc)).toBe(url);
    const again = parseDocsPage(...split(docsPageUrl(loc)));
    expect(again.ok && again.loc).toEqual(loc);
  });

  it('accepts a ref whose slash arrives as %2F (either case) and writes it back verbatim', () => {
    expect(parse('/docs/demo?ref=ws%2Fa')).toEqual({
      ok: true, loc: { kind: 'project', project: 'demo', ref: { kind: 'bare', name: 'ws/a' } },
      canonical: '/docs/demo?ref=ws/a',
    });
    expect(parse('/docs/demo/specs/a.md?ref=refs%2fheads%2fws%2fa'))
      .toMatchObject({ ok: true, canonical: '/docs/demo/specs/a.md?ref=refs/heads/ws/a' });
  });

  it('reads `search` with or without its leading ?, and an empty query as none', () => {
    expect(parseDocsPage('/docs/demo', 'ref=ws/a')).toMatchObject({ ok: true, canonical: '/docs/demo?ref=ws/a' });
    expect(parseDocsPage('/docs/demo', '?')).toMatchObject({ ok: true, canonical: '/docs/demo' });
    expect(parseDocsPage('/docs/demo', '')).toMatchObject({ ok: true, canonical: '/docs/demo' });
  });

  it.each([
    ['/docs/', '/docs'],
    ['/docs/demo/', '/docs/demo'],
    ['/docs/demo/specs/', '/docs/demo/specs'],
    ['/docs/demo/specs/?ref=ws/a', '/docs/demo/specs?ref=ws/a'],
  ])('%s canonicalises without its trailing slash', (url, canonical) => {
    const r = parse(url);
    expect(r.ok && r.canonical).toBe(canonical);
  });

  it('decodes a needlessly escaped segment and canonicalises it to one spelling', () => {
    expect(parse('/docs/%64emo/%73pecs/a.md')).toMatchObject({ ok: true, canonical: '/docs/demo/specs/a.md' });
    expect(parse('/docs/demo/specs/a+b.md'))
      .toMatchObject({ ok: true, loc: { path: 'a+b.md' }, canonical: '/docs/demo/specs/a%2Bb.md' });
  });

  it.each([
    ['/doc', 'not-docs'],
    ['/docsy', 'not-docs'],
    ['/', 'not-docs'],
    ['/api/docs/demo/tree', 'not-docs'],
    ['/docs/demo/specs/a%2Fb.md', 'encoded-slash'],
    ['/docs/demo/specs/a%2fb.md', 'encoded-slash'],
    ['/docs/demo%2Fx/specs', 'encoded-slash'],
    ['/docs/demo/specs/%zz.md', 'bad-escape'],
    ['/docs/demo/specs/a%.md', 'bad-escape'],
    ['/docs/demo/specs/%C3.md', 'bad-escape'],
    ['/docs/@x', 'reserved-node'],
    ['/docs/@x/specs/a.md', 'reserved-node'],
    ['/docs/%40x', 'reserved-node'],
    ['/docs/-x', 'bad-project'],
    ['/docs/.git', 'bad-project'],
    ['/docs/..', 'bad-project'],
    ['/docs//', 'bad-project'],
    ['/docs/a b', 'bad-project'],
    ['/docs/' + 'p'.repeat(101), 'bad-project'],
    ['/docs/demo/programs', 'bad-section'],
    ['/docs/demo/Specs', 'bad-section'],
    ['/docs/demo//a.md', 'bad-section'],
    ['/docs/demo/specs/a//b.md', 'bad-path'],
    ['/docs/demo/specs//', 'bad-path'],
    ['/docs/demo/specs/a/..', 'bad-path'],
    ['/docs/demo/specs/./a.md', 'bad-path'],
    ['/docs/demo/specs/a%E2%80%8Bb.md', 'bad-path'],
    ['/docs/demo/specs/a%00b.md', 'bad-path'],
  ] as const)('%s is refused: %s', (url, word) => {
    expect(why(url)).toBe(word);
  });

  it.each([
    ['/docs/demo/specs/a%2Fb/%zz.md', 'bad-escape', 'every segment decodes before any is checked for a slash'],
    ['/docs/@x/%zz', 'bad-escape', 'decoding comes before the reserved-node check'],
    ['/docs/@x%2Fy', 'encoded-slash', 'an encoded slash comes before the reserved-node check'],
    ['/docs/-x/programs', 'bad-project', 'the project comes before the section'],
    ['/docs/demo/programs/a//b', 'bad-section', 'the section comes before the path'],
    ['/docs/demo/specs/a//b?commit=x', 'bad-path', 'the path comes before the query'],
  ] as const)('check order: %s gives %s (%s)', (url, word, reason) => {
    expect(why(url), reason).toBe(word);
  });
});

describe('M3.2: a page URL never carries a commit', () => {
  // Transcribed from spec 3.1, not read from the module: a list derived from DOCS_PIN_KEYS would shrink with it.
  const PINS = ['commit', 'servedRef', 'branch', 'head', 'fp'] as const;

  it('declares the pin keys and the page keys exactly', () => {
    expect(DOCS_PIN_KEYS).toEqual(PINS);
    expect(DOCS_PAGE_KEYS).toEqual(['ref', 'view', 'frame']);
  });

  it.each(PINS)('%s gives commit-in-page on every page kind, ahead of every other query word', (k) => {
    expect(why(`/docs/demo/specs/a.md?${k}=${C40}`)).toBe('commit-in-page');
    expect(why(`/docs/demo/specs/a.md?ref=ws/a&${k}=${C40}`)).toBe('commit-in-page');
    expect(why(`/docs/demo/specs/a.md?${k}=`)).toBe('commit-in-page');
    expect(why(`/docs/demo/specs/a.md?zz=1&${k}=x`), 'ahead of unknown-param').toBe('commit-in-page');
    expect(why(`/docs/demo/specs/a.md?ref=ws/a&ref=ws/b&${k}=x`), 'ahead of repeated-param').toBe('commit-in-page');
    expect(why(`/docs/demo/specs/a.md?view=x&${k}=x`), 'ahead of bad-view').toBe('commit-in-page');
    expect(why(`/docs?${k}=x`), 'on the index').toBe('commit-in-page');
    expect(why(`/docs/demo?${k}=x`), 'on a project').toBe('commit-in-page');
  });

  it('an escaped pin key is still a pin key', () => {
    expect(why('/docs/demo/specs/a.md?%63ommit=x')).toBe('commit-in-page');
  });
});

describe('M3.3: view and frame canonicalisation; unknown and repeated keys', () => {
  it('drops view=committed without ref', () => {
    expect(parse('/docs/demo/specs/a.md?view=committed'))
      .toEqual({ ok: true, loc: leaf('a.md'), canonical: '/docs/demo/specs/a.md' });
  });

  it('keeps view=committed with ref, written after it whatever the arrival order', () => {
    const r = parse('/docs/demo/specs/a.md?view=committed&ref=ws/a');
    expect(r.ok && r.canonical).toBe('/docs/demo/specs/a.md?ref=ws/a&view=committed');
    expect(r.ok && r.loc).toEqual(leaf('a.md', { ref: { kind: 'bare', name: 'ws/a' }, view: 'committed' }));
  });

  it('drops frame=full on a .md and keeps it on a .html', () => {
    expect(parse('/docs/demo/specs/a.md?frame=full'))
      .toEqual({ ok: true, loc: leaf('a.md'), canonical: '/docs/demo/specs/a.md' });
    expect(parse('/docs/demo/specs/m.html?frame=full')).toEqual({
      ok: true, loc: leaf('m.html', { frame: 'full' }), canonical: '/docs/demo/specs/m.html?frame=full',
    });
  });

  it('drops view and frame on a directory URL: a trailing slash marks a directory, which is not a leaf', () => {
    const r = parse('/docs/demo/specs/d.html/?ref=ws/a&view=committed&frame=full');
    expect(r).toEqual({
      ok: true, loc: leaf('d.html', { dirSlash: true, ref: { kind: 'bare', name: 'ws/a' } }),
      canonical: '/docs/demo/specs/d.html/?ref=ws/a',
    });
  });

  it('docsPageUrl never writes a redundant key, whatever the location asks for', () => {
    expect(docsPageUrl(leaf('a.md', { view: 'committed' }))).toBe('/docs/demo/specs/a.md');
    expect(docsPageUrl(leaf('a.md', { frame: 'full' }))).toBe('/docs/demo/specs/a.md');
    expect(docsPageUrl(leaf('d', { dirSlash: true, ref: { kind: 'bare', name: 'b' }, view: 'committed' })))
      .toBe('/docs/demo/specs/d/?ref=b');
  });

  it.each([
    ['/docs/demo/specs/a.md?ref=ws/a&view=x', 'bad-view'],
    ['/docs/demo/specs/a.md?ref=ws/a&view=effective', 'bad-view'],
    ['/docs/demo/specs/a.md?ref=ws/a&view', 'bad-view'],
    ['/docs/demo/specs/m.html?frame=x', 'bad-frame'],
    ['/docs/demo/specs/m.html?frame=inline', 'bad-frame'],
    ['/docs/demo?ref=-x', 'bad-ref'],
    ['/docs/demo?ref=main~1', 'bad-ref'],
    ['/docs/demo?ref=refs/tags/v1', 'bad-ref'],
    ['/docs/demo?ref=', 'bad-ref'],
    ['/docs/demo?ref=%zz', 'bad-escape'],
    ['/docs/demo?%zz=1', 'bad-escape'],
    ['/docs/demo/specs/a.md?zz=1', 'unknown-param'],
    ['/docs/demo/specs/a.md?Ref=ws/a', 'unknown-param'],
    ['/docs/demo/specs/a.md?ref=ws/a&', 'unknown-param'],
    ['/docs?ref=ws/a', 'unknown-param'],
    ['/docs?view=committed', 'unknown-param'],
    ['/docs/demo?view=committed', 'unknown-param'],
    ['/docs/demo/specs?frame=full', 'unknown-param'],
    ['/docs/demo/specs/a.md?ref=ws/a&ref=ws/a', 'repeated-param'],
    ['/docs/demo/specs/a.md?view=committed&view=committed', 'repeated-param'],
    ['/docs/demo/specs/a.md?zz=1&zz=1', 'repeated-param'],
    ['/docs?ref=a&ref=b', 'repeated-param'],
    ['/docs/demo/specs/a.md?zz=1&view=x', 'unknown-param'],
  ] as const)('%s gives %s', (url, word) => {
    expect(why(url)).toBe(word);
  });
});

describe('the docs API URL builder', () => {
  it('declares the prefixes and the marker header', () => {
    expect(DOCS_PAGE_PREFIX).toBe('/docs');
    expect(DOCS_API_PREFIX).toBe('/api/docs');
    expect(DOCS_REQUEST_HEADER).toBe('x-ccrc-docs');
    expect(DOCS_REQUEST_HEADER_VALUE).toBe('1');
  });

  it('writes the four routes under the API prefix', () => {
    expect(docsApi.projects()).toBe('/api/docs/projects');
    expect(docsApi.tree('demo', null)).toBe('/api/docs/demo/tree');
    expect(docsApi.refresh('example-project')).toBe('/api/docs/example-project/refresh');
  });

  it('writes the ref text, bare or qualified, through encodeURIComponent', () => {
    expect(docsApi.tree('demo', { kind: 'bare', name: 'ws/a' })).toBe('/api/docs/demo/tree?ref=ws%2Fa');
    expect(docsApi.tree('demo', { kind: 'qualified', ref: 'refs/remotes/origin/ws/a' }))
      .toBe('/api/docs/demo/tree?ref=refs%2Fremotes%2Forigin%2Fws%2Fa');
  });

  // Each pin is spelled with its fields in REVERSE order, so a builder that walked the object's own key order
  // would write them reversed.
  const committed: DocPin = {
    path: 'a b/c+d.md', section: 'specs', servedRef: 'refs/remotes/origin/main', commit: C40, kind: 'committed',
  };
  const draft: DocPin = { fp: F64, path: 'x.md', section: 'plans', head: H40, branch: 'ws/a', kind: 'draft' };

  it('writes a committed pin as commit, servedRef, section, path', () => {
    expect(docsApi.file('demo', committed)).toBe(
      `/api/docs/demo/file?commit=${C40}&servedRef=refs%2Fremotes%2Forigin%2Fmain&section=specs&path=a%20b%2Fc%2Bd.md`);
  });

  it('writes a draft pin as branch, head, section, path, fp', () => {
    expect(docsApi.file('demo', draft)).toBe(
      `/api/docs/demo/file?branch=ws%2Fa&head=${H40}&section=plans&path=x.md&fp=${F64}`);
  });

  it('every value survives a form-style query decoder unchanged, a plus included', () => {
    const q = new URLSearchParams(docsApi.file('demo', committed).split('?')[1]);
    expect([...q.keys()]).toEqual(['commit', 'servedRef', 'section', 'path']);
    expect(q.get('path')).toBe('a b/c+d.md');
    expect(q.get('servedRef')).toBe('refs/remotes/origin/main');
    const d = new URLSearchParams(docsApi.file('demo', draft).split('?')[1]);
    expect([...d.keys()]).toEqual(['branch', 'head', 'section', 'path', 'fp']);
    expect(d.get('branch')).toBe('ws/a');
  });

  it('every builder answer lies under DOCS_API_PREFIX, and no page URL does', () => {
    const urls = [docsApi.projects(), docsApi.tree('demo', null), docsApi.file('demo', committed), docsApi.refresh('demo')];
    for (const u of urls) expect(u.startsWith(DOCS_API_PREFIX + '/')).toBe(true);
    for (const [u] of CANONICAL) expect(u.startsWith(DOCS_API_PREFIX)).toBe(false);
  });
});
