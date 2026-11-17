// The mockup viewer's decisions, tested at their module (native Docs reader, completion plan Task 8, C2, review I2;
// base spec 2026-10-01 5.6.5, 5.6.6, 5.6.7, 5.6.4's offer). `mockup/census.ts` is pure: it takes rows, a parsed Document,
// a hostname and a route builder, and answers; `MockupView.tsx` only draws what it answers (its own rendering tests are
// in `mockup-view.test.tsx`). Placeholders only (project `demo`, hosts `cdn.example`, `lib.example`).
import { describe, expect, it } from 'vitest';
import { docsApi, type DocPin, type DocSectionSlug } from '../../shared/docs';
import {
  capRows, censusCounts, censusOf, censusRefText, draftPinsOf, hasConservativeAdmission, linksOf, originsOf, pageHasScripts,
} from '../src/docs/mockup/census';
import { MOCKUP_CENSUS_REF_UNITS, MOCKUP_CENSUS_ROW_CAP } from '../src/docs/mockup/policy';
import type { MockupAssetRow, MockupRef, MockupRefVerdict, MockupSize } from '../src/docs/mockup/ports';
import type { MockupExtract } from '../src/docs/mockup/load';
import { DOC_IMAGE_REFUSED_SENTENCE, MOCKUP_VERDICT_SENTENCE } from '../src/docs/docsText';
import { COMMIT_A, FP_1 } from './docsFixtures';

const doc = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const routeOf = (section: DocSectionSlug, path: string): string => `/route/${section}/${path}`;

describe('MOCKUP_CENSUS_REF_UNITS (the 120 cut, one named constant)', () => {
  it('is exactly 120', () => {
    expect(MOCKUP_CENSUS_REF_UNITS).toBe(120);
  });

  it('cuts a reference at that many code units with an ellipsis and shows every non-ASCII character as U+XXXX', () => {
    expect(censusRefText('a'.repeat(MOCKUP_CENSUS_REF_UNITS))).toBe('a'.repeat(120));
    expect(censusRefText('a'.repeat(MOCKUP_CENSUS_REF_UNITS + 1))).toBe('a'.repeat(120) + '…');
    expect(censusRefText('é.png')).toBe('U+00E9.png');
    expect(censusRefText('\u{1F600}')).toBe('U+1F600');
    expect(censusRefText('b'.repeat(119) + 'é!')).toBe('b'.repeat(119) + 'U+00E9…');
  });

  it('shows a control character, a space\'s neighbours and DEL as code points, and printable ASCII as written', () => {
    expect(censusRefText('a b~')).toBe('a b~');
    expect(censusRefText('a\tb')).toBe('aU+0009b');
    expect(censusRefText('a\u007fb')).toBe('aU+007Fb');
    expect(censusRefText('\u0000')).toBe('U+0000');
  });
});

describe('MOCKUP_CENSUS_ROW_CAP and capRows (the on-screen folds list at most that many rows)', () => {
  const rowsOf = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it('is exactly 500', () => {
    expect(MOCKUP_CENSUS_ROW_CAP).toBe(500);
  });

  it('at or under the cap every row is shown and none is hidden', () => {
    expect(capRows([])).toEqual({ shown: [], more: 0 });
    expect(capRows(rowsOf(1))).toEqual({ shown: [0], more: 0 });
    expect(capRows(rowsOf(499)).more).toBe(0);
    expect(capRows(rowsOf(500)).shown).toHaveLength(500);
    expect(capRows(rowsOf(500)).more).toBe(0);
  });

  it('one over the cap hides exactly one: the first 500 in order, and more is 1', () => {
    const c = capRows(rowsOf(501));
    expect(c.shown).toHaveLength(500);
    expect(c.shown[0]).toBe(0);
    expect(c.shown[499]).toBe(499);
    expect(c.more).toBe(1);
  });

  it('far over the cap shows the cap and counts the rest', () => {
    const c = capRows(rowsOf(2500));
    expect(c.shown).toHaveLength(500);
    expect(c.more).toBe(2000);
  });

  it('answers with the rows it was given when none is hidden (no copy of a small list)', () => {
    const rows = rowsOf(3);
    expect(capRows(rows).shown).toBe(rows);
  });
});

describe('pageHasScripts (base 5.6.5: whether a script run would change anything)', () => {
  it.each([
    ['no scripts at all', '<p>a</p><a href="#x">x</a><img src="a.png">', false],
    ['a script element', '<script>1</script>', true],
    ['a script element in the body', '<p>a</p><script src="a.js"></script>', true],
    ['a script inside svg', '<svg><script>1</script></svg>', true],
    ['an on* attribute', '<p onclick="f()">a</p>', true],
    ['an on* attribute on svg', '<svg onload="f()"></svg>', true],
    ['an attribute that only contains "on"', '<p data-on="1" title="onclick">a</p>', false],
    ['a javascript: href', '<a href="javascript:f()">a</a>', true],
    ['a javascript: href in capitals', '<a href="JavaScript:f()">a</a>', true],
    ['a javascript: href with a leading control and space', '<a href="\u0001 javascript:f()">a</a>', true],
    ['a javascript: href with a tab and a newline inside the scheme', '<a href="java\tscr\nipt:f()">a</a>', true],
    ['a javascript: src', '<iframe src="javascript:f()"></iframe>', true],
    ['a javascript: form action', '<form action="javascript:f()"></form>', true],
    ['a javascript: formaction', '<form><button formaction="javascript:f()">b</button></form>', true],
    ['javascript: in another attribute', '<p title="javascript:f()">a</p>', false],
    ['javascript: that is not the start of the URL', '<a href="/x?javascript:f()">a</a>', false],
    ['a meta refresh', '<meta http-equiv="refresh" content="5">', true],
    ['a meta refresh in capitals with spaces', '<meta http-equiv=" Refresh " content="5">', true],
    ['another meta', '<meta http-equiv="content-type" content="text/html">', false],
  ])('%s', (_name, html, expected) => {
    expect(pageHasScripts(doc(html))).toBe(expected);
  });
});

describe('originsOf (base 5.6.4: what Load external offers and what it refuses)', () => {
  const external = (origin: string, key: string): MockupAssetRow => row(key, `${origin}/x.png`, { v: 'external', origin, via: 'src' });

  it('offers each distinct accepted origin once, src origins first (plan order), then the script-text ones', () => {
    const rows = [external('https://cdn.example', 'r1'), external('https://cdn.example', 'r2'), external('https://lib.example', 'r3')];
    const o = originsOf(rows, ['https://cdn.example', 'https://js.example'], 'console.example');
    expect(o.offered).toEqual([
      { origin: 'https://cdn.example', scriptText: false },
      { origin: 'https://lib.example', scriptText: false },
      { origin: 'https://js.example', scriptText: true },
    ]);
    expect(o.refused.size).toBe(0);
  });

  it('refuses the console\'s own host at any port, an IP literal, localhost and a plain-http origin, and offers none of them', () => {
    const rows = [
      external('https://console.example', 'a'), external('https://console.example:8443', 'b'), external('https://127.0.0.1', 'c'),
      external('https://localhost', 'd'), external('http://plain.example', 'e'), external('https://cdn.example', 'f'),
    ];
    const o = originsOf(rows, ['https://localhost'], 'console.example');
    expect(o.offered.map((x) => x.origin)).toEqual(['https://cdn.example']);
    expect([...o.refused].sort()).toEqual([
      'http://plain.example', 'https://127.0.0.1', 'https://console.example', 'https://console.example:8443', 'https://localhost',
    ]);
  });

  it('asks only `external` rows: another verdict naming an origin-like text offers nothing', () => {
    const rows = [row('a', 'https://cdn.example/a.png', { v: 'kept', why: 'self-contained' }), row('b', 'x.png', { v: 'refused', why: 'scheme' })];
    expect(originsOf(rows, [], 'console.example')).toEqual({ offered: [], refused: new Set() });
  });

  it('judges a script-text origin for the same host: the console\'s own one is refused there too', () => {
    const o = originsOf([], ['https://console.example'], 'console.example');
    expect(o.offered).toEqual([]);
    expect([...o.refused]).toEqual(['https://console.example']);
  });

  it('an origin seen first as a src origin keeps scriptText false when script text names it again', () => {
    const o = originsOf([external('https://cdn.example', 'r1')], ['https://cdn.example'], 'console.example');
    expect(o.offered).toEqual([{ origin: 'https://cdn.example', scriptText: false }]);
  });
});

describe('censusOf (base 5.6.7: one row per reference, in this order, with the verdict\'s sentence)', () => {
  const pin = (path: string, draft = false): DocPin => (draft
    ? { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp: FP_1 }
    : { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path });
  const inline = (path: string, draft = false): MockupRefVerdict => ({ v: 'inline', pin: pin(path, draft), kind: 'image', mime: 'image/png', size: 100, draft });
  const none: MockupExtract = { refs: [], unsupported: [], scriptTexts: [], dropped: [], apply: () => {} };
  const noOrigins = originsOf([], [], 'console.example');
  const census = (rows: MockupAssetRow[], extract: MockupExtract = none, scriptOrigins: string[] = [], host = 'console.example') =>
    censusOf(rows, extract, scriptOrigins, originsOf(rows, scriptOrigins, host), routeOf);

  it('an inline row: its ref, the target "<section>/<path>" linking in-app, the loaded sentence, a size, no chip', () => {
    const [r] = census([row('k1', 'a.png', inline('a.png'), { kind: 'listed', bytes: 2048 })]);
    expect(r).toEqual({
      key: 'k1', ref: 'a.png', target: 'specs/a.png', href: '/route/specs/a.png', sentence: MOCKUP_VERDICT_SENTENCE.inline, hint: false,
      size: '2 KiB', draft: false, scriptText: false, state: 'loaded',
    });
  });

  it('a draft inline row carries the draft mark', () => {
    const [r] = census([row('k1', 'a.png', inline('a.png', true))]);
    expect(r!.draft).toBe(true);
    expect(r!.state).toBe('loaded');
  });

  it('a class-cap reservation reads "up to {size}"; no reservation shows no size', () => {
    const [a, b] = census([
      row('k1', 'a.png', inline('a.png'), { kind: 'class-cap', bytes: 2 * 1024 * 1024 }), row('k2', 'b.png', inline('b.png'), null),
    ]);
    expect(a!.size).toBe('up to 2048 KiB');
    expect(b!.size).toBeNull();
  });

  it('a kept row is "kept" and has no target, no link', () => {
    const [r] = census([row('k1', '#top', { v: 'kept', why: 'fragment' })]);
    expect(r).toMatchObject({ target: null, href: null, sentence: MOCKUP_VERDICT_SENTENCE.kept.fragment, state: 'kept', hint: false });
  });

  it('an external row\'s target is its origin; offered, it takes the vendor hint, refused it takes the not-offered sentence', () => {
    const [offered, refused] = census([
      row('k1', 'https://cdn.example/a.png', { v: 'external', origin: 'https://cdn.example', via: 'src' }),
      row('k2', 'https://console.example/b.png', { v: 'external', origin: 'https://console.example', via: 'src' }),
    ]);
    expect(offered).toMatchObject({ target: 'https://cdn.example', href: null, sentence: MOCKUP_VERDICT_SENTENCE.external, hint: true, state: 'not-loaded' });
    expect(refused).toMatchObject({ target: 'https://console.example', href: null, sentence: MOCKUP_VERDICT_SENTENCE.refusedOrigin, hint: false, state: 'not-loaded' });
  });

  it('a non-inline row resolves its own reference: a doc in a section links (unless missing), a repo file is text, the rest has no target', () => {
    const rows = [
      row('k1', 'other.md', { v: 'missing', why: 'absent-at-commit' }),
      row('k2', 'other.md', { v: 'failed', failure: 'unreachable' }),
      row('k3', '../../../README.md', { v: 'refused', why: 'repo' }),
      row('k4', '../../../../README.md', { v: 'refused', why: 'above-root' }),
      row('k5', 'mailto:x@cdn.example', { v: 'refused', why: 'scheme' }),
    ];
    const out = census(rows);
    expect(out[0]).toMatchObject({ target: 'specs/other.md', href: null, state: 'not-loaded', sentence: DOC_IMAGE_REFUSED_SENTENCE.absent });
    expect(out[1]).toMatchObject({ target: 'specs/other.md', href: '/route/specs/other.md', state: 'not-loaded' });
    expect(out[1]!.sentence.startsWith('failed: ')).toBe(true);
    expect(out[2]).toMatchObject({ target: 'README.md', href: null, sentence: DOC_IMAGE_REFUSED_SENTENCE.repo });
    expect(out[3]).toMatchObject({ target: null, href: null });
    expect(out[4]).toMatchObject({ target: null, href: null, sentence: DOC_IMAGE_REFUSED_SENTENCE.scheme });
  });

  it('resolves a reference from the BASE it was written in (a stylesheet in a sibling directory), not from the page', () => {
    const [r] = census([row('k1', 'img/a.png', { v: 'failed', failure: 'unreachable' }, null, 'specs/css/s.css')]);
    expect(r).toMatchObject({ target: 'specs/css/img/a.png', href: '/route/specs/css/img/a.png' });
  });

  it('puts the plan\'s rows first, then the unsupported elements, then the dropped srcset candidates, then script-text origins', () => {
    const extract: MockupExtract = {
      ...none, unsupported: [{ key: 'u1', element: 'object' }], dropped: [{ element: 'img', text: 'bad 1x 2x' }, { element: 'img', text: 'worse' }],
    };
    const out = census([row('k1', 'a.png', inline('a.png'))], extract, ['https://lib.example', 'https://console.example']);
    expect(out.map((r) => r.key)).toEqual(['k1', 'u1', 'd0', 'd1', 's0', 's1']);
    expect(out[1]).toMatchObject({ ref: '<object>', target: null, sentence: MOCKUP_VERDICT_SENTENCE.unsupported.element, state: 'not-loaded', scriptText: false });
    expect(out[2]).toMatchObject({ ref: 'bad 1x 2x', sentence: MOCKUP_VERDICT_SENTENCE.dropped, state: 'not-loaded', hint: false });
    expect(out[3]!.ref).toBe('worse');
  });

  it('a script-text origin is marked, targets its origin, and reads offered or not-offered by the same rule', () => {
    const out = census([], none, ['https://lib.example', 'https://console.example']);
    expect(out[0]).toMatchObject({
      key: 's0', ref: 'https://lib.example', target: 'https://lib.example', href: null, sentence: MOCKUP_VERDICT_SENTENCE.external,
      hint: true, scriptText: true, state: 'not-loaded', size: null, draft: false,
    });
    expect(out[1]).toMatchObject({ key: 's1', sentence: MOCKUP_VERDICT_SENTENCE.refusedOrigin, hint: false, scriptText: true });
    expect(noOrigins.offered).toEqual([]);
  });

  it('cuts every shown reference (a row, an element, a dropped candidate, an origin) with the one cut', () => {
    const long = 'p'.repeat(130);
    const extract: MockupExtract = { ...none, dropped: [{ element: 'img', text: long }] };
    const out = census([row('k1', `${long}.png`, inline('a.png'))], extract);
    expect(out[0]!.ref).toBe('p'.repeat(120) + '…');
    expect(out[1]!.ref).toBe('p'.repeat(120) + '…');
  });

  it('every verdict kind yields a state: inline loaded, kept kept, anything else not-loaded', () => {
    const verdicts: MockupRefVerdict[] = [
      inline('a.png'), { v: 'kept', why: 'self-contained' }, { v: 'external', origin: 'https://cdn.example', via: 'src' }, { v: 'refused', why: 'scheme' },
      { v: 'missing', why: 'draft-withheld' }, { v: 'unsupported', why: 'kind' }, { v: 'skipped', why: 'over-budget' }, { v: 'failed', failure: 'auth' },
    ];
    expect(census(verdicts.map((v, i) => row(`k${i}`, 'a.png', v))).map((r) => r.state)).toEqual([
      'loaded', 'kept', 'not-loaded', 'not-loaded', 'not-loaded', 'not-loaded', 'not-loaded', 'not-loaded',
    ]);
  });
});

describe('censusCounts (the fold summary\'s two totals)', () => {
  it('counts loaded and not-loaded rows; a kept row is neither', () => {
    const base = { key: 'k', ref: 'r', target: null, href: null, sentence: 's', hint: false, size: null, draft: false, scriptText: false } as const;
    const rows = [
      { ...base, state: 'loaded' as const }, { ...base, state: 'loaded' as const }, { ...base, state: 'kept' as const },
      { ...base, state: 'not-loaded' as const },
    ];
    expect(censusCounts(rows)).toEqual({ loaded: 2, notLoaded: 1 });
    expect(censusCounts([])).toEqual({ loaded: 0, notLoaded: 0 });
  });
});

describe('hasConservativeAdmission (base 5.6.3: the note shows with a class-cap reservation AND an over-budget row)', () => {
  const cap: MockupSize = { kind: 'class-cap', bytes: 100 };
  const listed: MockupSize = { kind: 'listed', bytes: 100 };
  const over = (): MockupAssetRow => row('o', 'o.png', { v: 'skipped', why: 'over-budget' });
  const withSize = (size: MockupSize | null): MockupAssetRow => row('c', 'c.png', { v: 'failed', failure: 'auth' }, size);

  it('needs both', () => {
    expect(hasConservativeAdmission([withSize(cap), over()])).toBe(true);
    expect(hasConservativeAdmission([withSize(cap)])).toBe(false);
    expect(hasConservativeAdmission([over()])).toBe(false);
    expect(hasConservativeAdmission([withSize(listed), over()])).toBe(false);
    expect(hasConservativeAdmission([withSize(null), over()])).toBe(false);
    expect(hasConservativeAdmission([])).toBe(false);
  });

  it('only an over-budget skip counts: a too-large one does not', () => {
    expect(hasConservativeAdmission([withSize(cap), row('t', 't.png', { v: 'skipped', why: 'too-large' })])).toBe(false);
  });
});

describe('draftPinsOf (what the screen\'s banner counts)', () => {
  const draftRow = (key: string, path: string): MockupAssetRow =>
    row(key, path, { v: 'inline', pin: { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path, fp: FP_1 }, kind: 'image', mime: 'image/png', size: 1, draft: true });
  const committedRow = (key: string, path: string): MockupAssetRow =>
    row(key, path, { v: 'inline', pin: { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path }, kind: 'image', mime: 'image/png', size: 1, draft: false });

  it('counts DISTINCT draft pins by their API URL: one asset used twice is one', () => {
    expect(draftPinsOf([draftRow('a', 'a.png'), draftRow('b', 'a.png'), draftRow('c', 'b.png')], 'demo')).toBe(2);
  });

  it('counts no committed pin and no non-inline row', () => {
    expect(draftPinsOf([committedRow('a', 'a.png'), row('b', 'b.png', { v: 'failed', failure: 'auth' })], 'demo')).toBe(0);
    expect(draftPinsOf([], 'demo')).toBe(0);
  });

  it('identifies a pin by the project\'s own file URL', () => {
    // The same path in two projects would be two assets; the key is `docsApi.file(project, pin)`.
    const r = draftRow('a', 'a.png');
    expect(docsApi.file('demo', (r.verdict as { pin: DocPin }).pin)).not.toBe(docsApi.file('other', (r.verdict as { pin: DocPin }).pin));
    expect(draftPinsOf([r], 'demo')).toBe(1);
  });
});

describe('linksOf (base 5.6.6: the links list resolves each a[href] and area[href])', () => {
  const page = { section: 'specs' as const, path: 'm.html' };

  it('routes a doc link in-app, an http(s) link as external, and the rest as text, in document order', () => {
    const html = '<a href="other.md">o</a><a href="https://ext.example/p">e</a><a href="#top">f</a><a href="mailto:x@ext.example">m</a><area href="area.md">';
    expect(linksOf(doc(html), page, routeOf)).toEqual([
      { kind: 'doc', text: 'other.md', href: '/route/specs/other.md' },
      { kind: 'external', text: 'https://ext.example/p', url: 'https://ext.example/p' },
      { kind: 'text', text: '#top' },
      { kind: 'text', text: 'mailto:x@ext.example' },
      { kind: 'doc', text: 'area.md', href: '/route/specs/area.md' },
    ]);
  });

  it('a link to the page itself, an anchor without an href and a link in another section\'s path read as asked', () => {
    const out = linksOf(doc('<a href="m.html">self</a><a name="x">no href</a><a href="../plans/p.md">p</a>'), page, routeOf);
    expect(out).toEqual([
      { kind: 'text', text: 'm.html' },
      { kind: 'doc', text: '../plans/p.md', href: '/route/plans/p.md' },
    ]);
  });

  it('a repo file, a javascript: URL and a malformed one are text', () => {
    const out = linksOf(doc('<a href="../../../README.md">r</a><a href="javascript:f()">j</a><a href="a b">m</a>'), page, routeOf);
    expect(out.map((l) => l.kind)).toEqual(['text', 'text', 'text']);
  });

  it('cuts the shown text with the one cut', () => {
    const out = linksOf(doc(`<a href="${'x'.repeat(130)}.md">x</a>`), page, routeOf);
    expect(out[0]!.text).toBe('x'.repeat(120) + '…');
  });

  it('a page with no links lists none', () => {
    expect(linksOf(doc('<p>a</p>'), page, routeOf)).toEqual([]);
  });
});

function row(key: string, raw: string, verdict: MockupRefVerdict, size: MockupSize | null = null, basePath: MockupRef['basePath'] = 'specs/m.html'): MockupAssetRow {
  return { ref: { key, raw, basePath, kind: 'image', depth: 0 }, verdict, size };
}
