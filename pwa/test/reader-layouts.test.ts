// The reader's layouts (native Docs parity, X2 P5.1, spec 2026-11-18 4.2, D-8762): the five layout names and the standalone
// `?variant=` map, the per-device choice and the one-visit override, the carry on doc links, the frame's srcdoc under its per-layout
// cap with the console's two faces, the bridge handing the library a layout's bundle and stylesheet, and the layout rule's pure
// decisions (`readerLayoutRemount`, `readerRemountDelayMs`, `readerMountLayout`; `readerModeOffered`'s `layout` and `rule` are
// `reader-mode-policy.test.ts`'s).
// The remount through the body and the head's Layout row are `reader-mode-mount.test.tsx`'s and `docs-layout-row.test.tsx`'s.
// Mutation rows M11.7 to M11.9 and X6.60 are named at their cases.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FRAME_MANIFEST, SEED_HTML_MAX_CHARS, frameCsp, frameDocument, maxSrcdocChars, type FrameAssets, type RenderInput,
} from '@synapsium-labs/pinax-lib/frame';
import type { DocFrame, HostAdapters, mountDocFrame } from '@synapsium-labs/pinax-lib/host';
import {
  DOCS_LAYOUT_VARIANT, DOCS_VARIANT_LAYOUT, docsLayoutVariant, docsPageUrl, docsVariantLayout, parseDocsPage, type DocsPageLocation,
} from '../../shared/docs';
import { loadReaderAssets, loadReaderFonts } from '../src/docs/reader/assets';
import { mountReader, type ReaderMountInput } from '../src/docs/reader/bridge';
import { chooseReaderLayout, onReaderLayout, readReaderLayout, readerLayoutChosenAt } from '../src/docs/reader/layoutPref';
import {
  READER_LAYOUTS, layoutFromVariant, readerLayoutOfPref, readerMountLayout, routeReaderLink, withLayoutInPref, withStoredLayoutKept,
} from '../src/docs/reader/policy';
import {
  READER_REMOUNT_QUIET_MS, readerLayoutChoice, readerLayoutRemount, readerLayoutRowDrawn, readerRemountDelayMs,
} from '../src/docs/reader/readerMode';
import { docLinkTarget } from '../src/docs/docLinkTarget';
import { linkBaseFor, pageAfterVariantEnded } from '../src/docs/docsLinkBase';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { treeOk } from './docsFixtures';

const PREFS_KEY = 'ccrc:reader:v1:pref:prefs';
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The page a URL parses to (the leaf's own location), as the screen holds it. */
function pageOf(url: string): Extract<DocsPageLocation, { kind: 'path' }> {
  const q = url.indexOf('?');
  const r = parseDocsPage(q < 0 ? url : url.slice(0, q), q < 0 ? '' : url.slice(q));
  if (!r.ok || r.loc.kind !== 'path') throw new Error(`not a path page: ${url}`);
  return r.loc;
}

/** The link context a leaf page gives its body's links, as `DocsLeaf` builds it from the page. */
function ctxOf(page: Extract<DocsPageLocation, { kind: 'path' }>): DocLinkContextValue {
  return { ...linkBaseFor(page, treeOk(), null, () => undefined, page.variant ?? null), urls: new WeakMap() };
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('the layouts and the standalone names', () => {
  it('layouts: variant names map', () => {
    // M11.7: the map's `B` entry set to `default` reds here.
    expect(layoutFromVariant('AB')).toBe('default');
    expect(layoutFromVariant('A')).toBe('editorial');
    expect(layoutFromVariant('B')).toBe('review');
    expect(layoutFromVariant('C')).toBe('guided');
    expect(layoutFromVariant('classic')).toBe('classic');
    // Anything else, and no variant at all, is the default layout.
    for (const v of [null, '', 'D', 'a', 'b', 'ab', 'Classic', 'default', 'review', 'AB ', 'B'.repeat(4096)]) {
      expect(layoutFromVariant(v), JSON.stringify(v)).toBe('default');
    }
    // The page grammar reads the one map: each name parses to the layout the policy gives it, and is written back as that name.
    for (const name of ['AB', 'A', 'B', 'C', 'classic']) {
      const page = pageOf(`/docs/demo/specs/a.md?variant=${name}`);
      expect(page.variant, name).toBe(layoutFromVariant(name));
      expect(docsPageUrl(page), name).toBe(`/docs/demo/specs/a.md?variant=${name}`);
      expect(docsLayoutVariant(layoutFromVariant(name)), name).toBe(name);
    }
    expect(docsVariantLayout('x')).toBeNull();
    expect(Object.keys(DOCS_VARIANT_LAYOUT).sort()).toEqual(['A', 'AB', 'B', 'C', 'classic']);
    // The five layouts, `default` first, each named by exactly one standalone name.
    expect(READER_LAYOUTS).toEqual(['default', 'classic', 'editorial', 'review', 'guided']);
    expect([...Object.values(DOCS_VARIANT_LAYOUT)].sort()).toEqual([...READER_LAYOUTS].sort());
  });

  it('layouts: the library names the same five layouts, in the same order', async () => {
    const { FRAME_LAYOUTS } = await import('@synapsium-labs/pinax-lib/frame');
    expect([...READER_LAYOUTS]).toEqual([...FRAME_LAYOUTS]);
  });
});

describe('the device\'s layout and the one visit\'s', () => {
  it('layouts: pref persists per device and ?variant overrides one visit', () => {
    // M11.8: a choice that writes no `layout` pref reds here.
    expect(readReaderLayout(), 'nothing stored: the default layout').toBe('default');
    chooseReaderLayout('review');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null'), 'the library\'s own prefs key holds it').toEqual({ layout: 'review' });
    // A later page load, with no listener of this one's: the device reads it back.
    expect(readReaderLayout()).toBe('review');
    expect(readerMountLayout({ pref: readReaderLayout(), visit: null, chosen: null, readingOn: false })).toBe('review');
    // One visit's `?variant=` beats it for that visit, and writes nothing.
    expect(readerMountLayout({
      pref: readReaderLayout(), visit: pageOf('/docs/demo/specs/a.md?variant=C').variant ?? null, chosen: null, readingOn: false,
    })).toBe('guided');
    expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"layout":"review"}');
    // A visit that names the default layout (`AB`) is the default, whatever the device holds.
    expect(readerMountLayout({ pref: 'review', visit: 'default', chosen: null, readingOn: false })).toBe('default');
  });

  it('layouts: a choice records the address it was made at, and a reload (a fresh module) has none', async () => {
    // I-2: the one owner of "a Layout choice ended the visit's variant at this address". Module state, so a reload clears it.
    window.history.replaceState(null, '', '/docs/demo/specs/a.md?variant=B');
    chooseReaderLayout('guided');
    expect(readerLayoutChosenAt()).toBe('/docs/demo/specs/a.md?variant=B');
    window.history.replaceState(null, '', '/docs/demo/specs/b.md');
    chooseReaderLayout('review');
    expect(readerLayoutChosenAt(), 'the latest choice names its own address').toBe('/docs/demo/specs/b.md');
    vi.resetModules();
    const reloaded = await import('../src/docs/reader/layoutPref');
    expect(reloaded.readerLayoutChosenAt(), 'a reload is a new visit').toBeNull();
    window.history.replaceState(null, '', '/');
  });

  it('layouts: the variant ends only on the address the choice was made at, and only on a leaf that names one', () => {
    const page = pageOf('/docs/demo/specs/a.md?variant=B');
    const here = '/docs/demo/specs/a.md?variant=B';
    expect(pageAfterVariantEnded(page, here, null), 'no choice: the page itself').toBe(page);
    expect(pageAfterVariantEnded(page, here, '/docs/demo/specs/b.md?variant=B'), 'a choice at another address').toBe(page);
    const ended = pageAfterVariantEnded(page, here, here);
    expect('variant' in ended, 'the page still names its variant').toBe(false);
    const { variant: _named, ...without } = page;
    expect(ended, 'every other field of the page is kept').toEqual(without);
    expect(docsPageUrl(ended)).toBe('/docs/demo/specs/a.md');
    // A page that names none, or is no leaf, is returned as it is, even where the choice was made.
    const plain = pageOf('/docs/demo/specs/a.md');
    expect(pageAfterVariantEnded(plain, '/docs/demo/specs/a.md', '/docs/demo/specs/a.md')).toBe(plain);
    const project: DocsPageLocation = { kind: 'project', project: 'demo', ref: null };
    expect(pageAfterVariantEnded(project, '/docs/demo', '/docs/demo')).toBe(project);
  });

  it('layouts: the page\'s own choice beats the visit\'s and the device\'s, and reader mode on still reads default', () => {
    // m-4: the precedence lives in `readerMountLayout` once; the body passes its choice in, not `chosenHere ?? ...`.
    for (const pref of READER_LAYOUTS) {
      for (const visit of [null, ...READER_LAYOUTS]) {
        for (const chosen of READER_LAYOUTS) {
          expect(readerMountLayout({ pref, visit, chosen, readingOn: false }), `${pref}/${String(visit)}/${chosen}`).toBe(chosen);
          expect(readerMountLayout({ pref, visit, chosen, readingOn: true }), `reading ${pref}/${String(visit)}/${chosen}`).toBe('default');
        }
      }
    }
  });

  it('layouts: an unknown stored layout mounts default', async () => {
    for (const raw of [
      '{"layout":"holographic"}', '{"layout":"AB"}', '{"layout":"B"}', '{"layout":7}', '{"layout":null}', '{}', '[]', 'null', '5', '"review"',
      'not json', '', '{"layout":"review"',
    ]) {
      expect(readerLayoutOfPref(raw), raw).toBe('default');
      window.localStorage.setItem(PREFS_KEY, raw);
      expect(readReaderLayout(), raw).toBe('default');
    }
    expect(readerLayoutOfPref(null)).toBe('default');
    expect(readerLayoutOfPref('{"layout":"editorial"}')).toBe('editorial');
    // The mount's texts are the default layout's: no layout stylesheet.
    window.localStorage.setItem(PREFS_KEY, '{"layout":"holographic"}');
    const assets = await loadReaderAssets(readReaderLayout());
    expect(Object.keys(assets).sort()).toEqual(['bootstrap', 'css', 'enhance', 'guard']);
  });

  it('layouts: the pref keeps the library\'s other fields', () => {
    const library = { theme: 'dark', width: 'wide', size: 'l', unknownFromANewerLibrary: { a: [1, 2, { b: null }] } };
    const raw = JSON.stringify(library);
    expect(JSON.parse(withLayoutInPref(raw, 'guided'))).toEqual({ ...library, layout: 'guided' });
    expect(JSON.parse(withLayoutInPref(JSON.stringify({ ...library, layout: 'review' }), 'classic'))).toEqual({ ...library, layout: 'classic' });
    // Text that is no object is replaced by an object holding the layout alone.
    for (const bad of [null, '', 'nope', '[1]', 'null', '7']) expect(withLayoutInPref(bad, 'editorial'), String(bad)).toBe('{"layout":"editorial"}');
    // Through the store: the other fields are kept as they were.
    window.localStorage.setItem(PREFS_KEY, raw);
    chooseReaderLayout('classic');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? 'null')).toEqual({ ...library, layout: 'classic' });
  });

  it('layouts: a choice writes the pref, then calls every listener in the order they came, in the same task', () => {
    const seen: string[] = [];
    const stops = [
      onReaderLayout((l) => { seen.push(`first ${l} stored ${window.localStorage.getItem(PREFS_KEY)}`); }),
      onReaderLayout((l) => { seen.push(`second ${l}`); }),
    ];
    chooseReaderLayout('editorial');
    expect(seen).toEqual(['first editorial stored {"layout":"editorial"}', 'second editorial']);
    stops[0]!();
    chooseReaderLayout('guided');
    expect(seen.slice(2)).toEqual(['second guided']);
    stops[1]!();
    chooseReaderLayout('classic');
    expect(seen).toHaveLength(3);
  });

  it('layouts: storage that refuses is read as default and written nowhere, and the listeners still run', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    const seen: string[] = [];
    const stop = onReaderLayout((l) => { seen.push(l); });
    expect(readReaderLayout()).toBe('default');
    expect(() => chooseReaderLayout('review')).not.toThrow();
    expect(seen).toEqual(['review']);
    stop();
  });
});

describe('?variant on doc links', () => {
  it('layouts: ?variant carries on doc links', () => {
    // M11.9: a doc link that drops the page's variant reds here.
    const page = pageOf('/docs/demo/specs/a.md?variant=B');
    expect(page.variant).toBe('review');
    const ctx = ctxOf(page);
    expect(ctx.pageVariant).toBe('review');
    expect(docLinkTarget(ctx, 'b.md')).toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md?variant=B', fragment: null });
    expect(docLinkTarget(ctx, 'sub/c.md#part')).toEqual({ kind: 'in-app', href: '/docs/demo/specs/sub/c.md?variant=B', fragment: 'part' });
    // Beside the ref and the version the page names, written last.
    const pinned = ctxOf(pageOf(`/docs/demo/specs/a.md?ref=ws/a&at=${'c'.repeat(40)}&variant=classic`));
    expect(docLinkTarget(pinned, 'b.md')).toEqual({
      kind: 'in-app', href: `/docs/demo/specs/b.md?ref=ws/a&at=${'c'.repeat(40)}&variant=classic`, fragment: null,
    });
    // The reader frame's own link route is the same decision.
    expect(routeReaderLink(ctx, { kind: 'relative', path: 'b.md', fragment: null }, 'x.example'))
      .toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md?variant=B', fragment: null });
    // A page that names no layout links to pages that name none.
    expect(docLinkTarget(ctxOf(pageOf('/docs/demo/specs/a.md')), 'b.md'))
      .toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md', fragment: null });
    // The default layout, named `AB`, is carried as a layout like the others.
    expect(docLinkTarget(ctxOf(pageOf('/docs/demo/specs/a.md?variant=AB')), 'b.md'))
      .toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md?variant=AB', fragment: null });
  });

  it('layouts: a link from a page with an unknown ?variant carries none', () => {
    for (const value of ['zzz', 'D', 'b', '', 'default', 'AB%20']) {
      const page = pageOf(`/docs/demo/specs/a.md?variant=${value}`);
      expect('variant' in page, value).toBe(false);
      const ctx = ctxOf(page);
      expect(ctx.pageVariant, value).toBeNull();
      expect(docLinkTarget(ctx, 'b.md'), value).toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md', fragment: null });
      // The page's own address is the canonical one: no variant key, so the screen replaces the URL it was given.
      expect(docsPageUrl(page), value).toBe('/docs/demo/specs/a.md');
    }
  });

  it('layouts: a ?variant longer than seven characters is never copied', () => {
    for (const value of ['classics', 'AB,B,C,A', 'B'.repeat(8), 'B'.repeat(4096), `classic${'x'.repeat(4000)}`]) {
      const url = `/docs/demo/specs/a.md?variant=${value}`;
      const parsed = parseDocsPage('/docs/demo/specs/a.md', `?variant=${value}`);
      expect(parsed.ok, value.slice(0, 12)).toBe(true);
      const page = pageOf(url);
      const ctx = ctxOf(page);
      // Nowhere in the location, the canonical address, the link context or a link built from it.
      const everything = JSON.stringify([parsed, page, { ...ctx, urls: null, tree: null }, docLinkTarget(ctx, 'b.md'), docsPageUrl(page)]);
      expect(everything, value.slice(0, 12)).not.toContain('BBBBBBBB');
      expect(everything, value.slice(0, 12)).not.toContain('xxxx');
      expect(everything, value.slice(0, 12)).not.toContain('variant');
      expect(docLinkTarget(ctx, 'b.md'), value.slice(0, 12)).toEqual({ kind: 'in-app', href: '/docs/demo/specs/b.md', fragment: null });
    }
  });
});

// ---- the srcdoc under each layout's cap, with the console's two faces ------------------------------------------------------------

describe('the frame\'s size under each layout', () => {
  it('layouts: each layout\'s srcdoc, with X1\'s fonts, stays under its cap', async () => {
    const doc: RenderInput = { result: { outcome: 'rendered', html: '<h1 id="t">T</h1><p>x</p>', meta: { title: 'T', frontList: null } } };
    const fonts = await loadReaderFonts();
    expect(fonts.sans.length).toBeGreaterThan(1000);
    expect(fonts.mono.length).toBeGreaterThan(1000);
    for (const layout of READER_LAYOUTS) {
      const assets: FrameAssets = { ...(await loadReaderAssets(layout)), fonts };
      const srcdoc = frameDocument(doc, { csp: frameCsp(layout), layout, nonce: '0'.repeat(32), assets });
      const cap = maxSrcdocChars(layout);
      expect(srcdoc.length, `${layout}: the srcdoc with both faces`).toBeLessThanOrEqual(cap);
      // The cap is derived per layout from what that layout's frame inlines, the faces' own cap included: a document at the seed's
      // html cap still fits beside this layout's texts and the console's two faces.
      expect(cap - srcdoc.length, `${layout}: room left for a document at the seed's cap`).toBeGreaterThanOrEqual(SEED_HTML_MAX_CHARS);
    }
  }, 60_000);

  it('layouts: each layout\'s texts are the manifest\'s own', async () => {
    const entries = {
      default: { enhance: FRAME_MANIFEST.enhance, css: null },
      classic: { enhance: FRAME_MANIFEST.enhanceClassic, css: FRAME_MANIFEST.cssClassic },
      editorial: { enhance: FRAME_MANIFEST.enhanceEditorial, css: FRAME_MANIFEST.cssEditorial },
      review: { enhance: FRAME_MANIFEST.enhanceReview, css: FRAME_MANIFEST.cssReview },
      guided: { enhance: FRAME_MANIFEST.enhanceGuided, css: FRAME_MANIFEST.cssGuided },
    } as const;
    for (const layout of READER_LAYOUTS) {
      const a = await loadReaderAssets(layout);
      expect(sha256(a.guard), layout).toBe(FRAME_MANIFEST.guard.sha256);
      expect(sha256(a.bootstrap), layout).toBe(FRAME_MANIFEST.bootstrap.sha256);
      expect(sha256(a.css), layout).toBe(FRAME_MANIFEST.css.sha256);
      expect(sha256(a.enhance), layout).toBe(entries[layout].enhance.sha256);
      expect(entries[layout].enhance.layout, layout).toBe(layout);
      const own = entries[layout].css;
      if (own === null) expect('layoutCss' in a, `${layout} has no stylesheet of its own`).toBe(false);
      else expect(sha256(a.layoutCss ?? ''), layout).toBe(own.sha256);
    }
    // The default call and the explicit one answer the same four texts.
    expect(await loadReaderAssets()).toEqual(await loadReaderAssets('default'));
  }, 60_000);
});

// ---- the bridge: the layout's texts and its name --------------------------------------------------------------------------------

interface Rig {
  readonly mount: ReturnType<typeof vi.fn>;
  readonly loads: string[];
  readonly adaptersAt: (n: number) => HostAdapters;
  readonly run: (input?: Partial<ReaderMountInput>) => ReturnType<typeof mountReader>;
}

function rig(): Rig {
  const loads: string[] = [];
  const mount = vi.fn(() => ({
    destroy: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn(), command: vi.fn(), closeOverlay: vi.fn(), goto: vi.fn(), setReading: vi.fn(),
  } as unknown as DocFrame));
  const el = document.createElement('div');
  document.body.append(el);
  const run = (over: Partial<ReaderMountInput> = {}): ReturnType<typeof mountReader> => mountReader(el, {
    document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
    bytes: 100, docKey: 'demo:specs:a.md', title: 'a.md', prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    ...over,
  }, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => null,
    assets: (layout) => {
      loads.push(layout);
      return Promise.resolve({
        guard: 'g', bootstrap: 'b', enhance: `enhance:${layout}`, css: 'c', ...(layout === 'default' ? {} : { layoutCss: `css:${layout}` }),
      });
    },
    mermaid: () => Promise.resolve('MERMAID'),
    e17: 'does-not-hold',
  });
  return { mount, loads, run, adaptersAt: (n) => (mount.mock.calls[n] as unknown as [HTMLElement, { adapters: HostAdapters }])[1].adapters };
}

describe('the bridge hands the library a layout', () => {
  it('layouts: the mount hands the layout\'s bundle and stylesheet and names the layout', async () => {
    for (const layout of READER_LAYOUTS.filter((l) => l !== 'default')) {
      const r = rig();
      const m = await r.run({ layout });
      expect(r.loads, layout).toEqual([layout]);
      const a = r.adaptersAt(0);
      expect(a.layout, layout).toBe(layout);
      expect(a.assets.enhance, layout).toBe(`enhance:${layout}`);
      expect(a.assets.layoutCss, layout).toBe(`css:${layout}`);
      expect(m.layout, layout).toBe(layout);
    }
    // The reader lab's mounts are always the default layout, whatever the input says.
    const lab = rig();
    await lab.run({ layout: 'review', profile: 'lab-draw' });
    expect(lab.loads).toEqual(['default']);
    expect(Object.keys(lab.adaptersAt(0))).not.toContain('layout');
  });

  // P5.1 leaves a default mount's adapters as they were; P5.4 adds the reading-layer flags (`features`) to every Docs mount, the
  // default's included, and nothing else.
  it('layouts: a default mount\'s adapters name no layout and carry no layout assets', async () => {
    for (const input of [{}, { layout: 'default' as const }]) {
      const r = rig();
      const m = await r.run(input);
      expect(r.loads).toEqual(['default']);
      const a = r.adaptersAt(0);
      expect(Object.keys(a)).not.toContain('layout');
      expect(Object.keys(a.assets).sort()).toEqual(['bootstrap', 'css', 'enhance', 'guard']);
      expect(m.layout).toBe('default');
      expect(Object.keys(a).sort()).toEqual(
        ['assets', 'copy', 'docKey', 'features', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'storePrefix', 'title', 'watchdogMs'].sort(),
      );
    }
  });
});

// ---- the layout rule's pure decisions --------------------------------------------------------------------------------------------

describe('reader mode and the layout rule', () => {
  // The `offered:` case (X6.60) is `reader-mode-policy.test.ts`'s.
  it('remount: which layout a change of reading remounts into', () => {
    const rule = 'remount' as const;
    // Entering: from the default layout, in place; from any other, into the default layout, whatever the reader chose.
    expect(readerLayoutRemount({ mounted: 'default', chosen: 'default', reading: 'screens', rule })).toBeNull();
    expect(readerLayoutRemount({ mounted: 'default', chosen: 'review', reading: 'scroll', rule })).toBeNull();
    for (const mounted of ['classic', 'editorial', 'review', 'guided'] as const) {
      expect(readerLayoutRemount({ mounted, chosen: mounted, reading: 'screens', rule }), mounted).toBe('default');
      expect(readerLayoutRemount({ mounted, chosen: 'guided', reading: 'scroll', rule }), mounted).toBe('default');
    }
    // Leaving: back to what the reader chose, when the mount is not in it; in place when it is.
    expect(readerLayoutRemount({ mounted: 'default', chosen: 'review', reading: 'off', rule })).toBe('review');
    expect(readerLayoutRemount({ mounted: 'default', chosen: 'default', reading: 'off', rule })).toBeNull();
    expect(readerLayoutRemount({ mounted: 'review', chosen: 'review', reading: 'off', rule })).toBeNull();
    // Under default-only nothing remounts for the layout.
    for (const reading of ['screens', 'scroll', 'off'] as const) {
      expect(readerLayoutRemount({ mounted: 'review', chosen: 'default', reading, rule: 'default-only' })).toBeNull();
      expect(readerLayoutRemount({ mounted: 'default', chosen: 'review', reading, rule: 'default-only' })).toBeNull();
    }
  });

  it('remount: the quiet wait is 400 ms after the last progress message, and none when it has passed or none came', () => {
    expect(READER_REMOUNT_QUIET_MS).toBe(400);
    expect(readerRemountDelayMs(1000, null)).toBe(0);
    expect(readerRemountDelayMs(1100, 1000)).toBe(300);
    expect(readerRemountDelayMs(1400, 1000)).toBe(0);
    expect(readerRemountDelayMs(5000, 1000)).toBe(0);
    expect(readerRemountDelayMs(1000, 1000)).toBe(400);
  });

  it('mount plan: reader mode on mounts in default, whatever the stored pref and the visit say, and off gives the visit\'s, then the pref\'s', () => {
    // X6.68's layout half: a `readerMountLayout` that ignores `readingOn` reds here.
    for (const pref of READER_LAYOUTS) {
      for (const visit of [null, ...READER_LAYOUTS]) {
        expect(readerMountLayout({ pref, visit, chosen: null, readingOn: true }), `${pref}/${String(visit)}`).toBe('default');
        expect(readerMountLayout({ pref, visit, chosen: null, readingOn: false }), `${pref}/${String(visit)}`).toBe(visit ?? pref);
      }
    }
  });

  it('layouts: a Layout choice is remounted at once, deferred while reader mode is on, or ignored, by one decider', () => {
    for (const mounted of READER_LAYOUTS) {
      for (const chosen of READER_LAYOUTS) {
        // Reader mode off: the layout the frame is in (or is on its way to) is nothing to do; any other is mounted at once.
        expect(readerLayoutChoice({ mounted, chosen, reading: 'off' }), `off ${mounted}->${chosen}`).toBe(mounted === chosen ? 'ignore' : 'remount');
        // Reader mode on: the frame stays where it is and the next exit gives the choice back; the same layout is nothing to do.
        for (const reading of ['screens', 'scroll'] as const) {
          expect(readerLayoutChoice({ mounted, chosen, reading }), `${reading} ${mounted}->${chosen}`).toBe(mounted === chosen ? 'ignore' : 'defer');
        }
      }
    }
  });

  it('layouts: the Layout row is drawn while a reader frame is ready, and never while reader mode is on', () => {
    expect(readerLayoutRowDrawn({ frameReady: true, plainView: false, readerModeOn: false })).toBe(true);
    expect(readerLayoutRowDrawn({ frameReady: false, plainView: false, readerModeOn: false }), 'a frame still loading').toBe(false);
    expect(readerLayoutRowDrawn({ frameReady: true, plainView: true, readerModeOn: false }), 'the plain view').toBe(false);
    expect(readerLayoutRowDrawn({ frameReady: true, plainView: false, readerModeOn: true }), 'reader mode on').toBe(false);
    expect(readerLayoutRowDrawn({ frameReady: false, plainView: true, readerModeOn: true })).toBe(false);
  });

  it('layouts: reader mode\'s policy file does not import its words file, so the two files make no import cycle', () => {
    // Only the words file reads the policy (`timeLeftMinutes`, `layoutAllowsReaderMode`); the policy takes no words (D-8975, I5).
    const policy = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'reader', 'readerMode.ts'), 'utf8');
    expect(/from\s+'\.\/readerModeWords'/.test(policy), 'readerMode.ts imports readerModeWords').toBe(false);
    const words = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'reader', 'readerModeWords.ts'), 'utf8');
    expect(/from\s+'\.\/readerMode'/.test(words), 'CONTROL: the words file reads the policy').toBe(true);
  });
});

describe('the layouts\' standalone names are one table in both directions', () => {
  it('layouts: every layout has exactly one standalone name, and the forward map is derived from the inverse', () => {
    // M8: the inverse is a total `Record<ReaderLayout, name>`; the forward map is its flip, so a layout with no name cannot compile.
    expect(Object.keys(DOCS_LAYOUT_VARIANT)).toEqual([...READER_LAYOUTS]);
    for (const layout of READER_LAYOUTS) {
      const name = DOCS_LAYOUT_VARIANT[layout];
      expect(DOCS_VARIANT_LAYOUT[name], layout).toBe(layout);
      expect(docsLayoutVariant(layout), layout).toBe(name);
    }
    expect(new Set(Object.values(DOCS_LAYOUT_VARIANT)).size).toBe(READER_LAYOUTS.length);
    expect(Object.keys(DOCS_VARIANT_LAYOUT).sort()).toEqual(Object.values(DOCS_LAYOUT_VARIANT).sort());
    // No fallback name survives in the source: a layout that had no name used to be written as `AB`.
    const src = readFileSync(path.join(import.meta.dirname, '..', '..', 'shared', 'docs.ts'), 'utf8');
    expect(src.includes("?? 'AB'"), 'a fallback name for a layout with none').toBe(false);
  });
});

// ---- the prefs write a frame makes (I1, I-3): the layout field has ONE writer, `layoutPref.ts`, behind the storage port --------------

describe('the prefs a frame writes back cannot put a layout over the stored one (I1, I-3)', () => {
  /** A bridge handed the page's own storage as its store, whose second layout's texts are held until `release()`; the mount spy reads
   *  the stored prefs at each mount and keeps each mount's adapters (the frame's own store port among them). */
  async function heldRig(): Promise<{
    readonly m: Awaited<ReturnType<typeof mountReader>>; readonly release: () => void; readonly storedAtMount: Array<string | null>;
    readonly events: string[]; readonly portAt: (n: number) => NonNullable<HostAdapters['store']>;
  }> {
    const storedAtMount: Array<string | null> = [];
    const events: string[] = [];
    const adapters: HostAdapters[] = [];
    let release: () => void = () => undefined;
    const el = document.createElement('div');
    document.body.append(el);
    const mount = vi.fn((_el: HTMLElement, o: { adapters: HostAdapters }) => {
      adapters.push(o.adapters);
      storedAtMount.push(window.localStorage.getItem(PREFS_KEY));
      events.push('mount');
      return { destroy: vi.fn(() => { events.push('destroy'); }), setPrefs: vi.fn(), setAppearance: vi.fn(), setReading: vi.fn() } as unknown as DocFrame;
    });
    const m = await mountReader(el, {
      document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
      bytes: 100, docKey: null, title: 'a.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    }, {
      mount: mount as unknown as typeof mountDocFrame, store: () => window.localStorage, mermaid: () => Promise.resolve('M'), e17: 'does-not-hold',
      assets: (layout) => (layout === 'default'
        ? Promise.resolve({ guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' })
        : new Promise((resolve) => { release = () => resolve({ guard: 'g', bootstrap: 'b', enhance: `e:${layout}`, css: 'c', layoutCss: `css:${layout}` }); })),
    });
    return {
      m, release: () => release(), storedAtMount, events,
      portAt: (n) => {
        const port = adapters[n]?.store;
        if (port === undefined) throw new Error(`mount ${n} was handed no store`);
        return port;
      },
    };
  }

  it('layouts: a stale prefs write during a pending layout load is overwritten before the new frame mounts', async () => {
    const { m, release, storedAtMount, events, portAt } = await heldRig();
    // A device in review chooses guided: the choice writes the pref and asks the bridge, whose chunk is still loading.
    window.localStorage.setItem(PREFS_KEY, '{"theme":"dark","layout":"review"}');
    chooseReaderLayout('guided');
    m.remount!({ layout: 'guided' });
    expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"theme":"dark","layout":"guided"}');
    // The old frame, still alive, writes its whole prefs snapshot back through the port it was handed (a theme `follow`, an Aa change):
    // the port keeps the stored `layout` as it is in storage, so the old layout does not go back.
    portAt(0).setItem(PREFS_KEY, '{"theme":"dark","layout":"review"}');
    expect(window.localStorage.getItem(PREFS_KEY), 'a stale write put the old layout back').toBe('{"theme":"dark","layout":"guided"}');
    release();
    await vi.waitFor(() => { expect(storedAtMount).toHaveLength(2); });
    // The new frame reads the pref as it mounts.
    expect(storedAtMount[1]).toBe('{"theme":"dark","layout":"guided"}');
    expect(events).toEqual(['mount', 'destroy', 'mount']);
  });

  it('layouts: a frame\'s prefs write after choosing the layout already shown keeps the stored choice', async () => {
    // I-3: on a `?variant` visit the desk stores the layout it shows by choosing it (the palette's Layout command for the layout already
    // shown). No remount follows, the frame stays, and it writes its mount-time snapshot (`layout: default`) back on its next change.
    const { portAt } = await heldRig();
    window.localStorage.setItem(PREFS_KEY, '{"theme":"light"}');
    chooseReaderLayout('review');
    portAt(0).setItem(PREFS_KEY, '{"theme":"dark","layout":"default"}');
    expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"theme":"dark","layout":"review"}');
  });

  it('layouts: a frame\'s prefs write when no layout is stored carries none', async () => {
    const { portAt } = await heldRig();
    window.localStorage.setItem(PREFS_KEY, '{"theme":"light"}');
    portAt(0).setItem(PREFS_KEY, '{"theme":"dark","layout":"default"}');
    expect(window.localStorage.getItem(PREFS_KEY), 'the frame wrote a layout nobody chose').toBe('{"theme":"dark"}');
    // Nothing stored at all, and a write that holds a layout of its own.
    window.localStorage.clear();
    portAt(0).setItem(PREFS_KEY, '{"theme":"dark","layout":"guided"}');
    expect(window.localStorage.getItem(PREFS_KEY)).toBe('{"theme":"dark"}');
  });

  it('layouts: the port passes every other key, every read and a prefs write that is no object unchanged', async () => {
    const { portAt } = await heldRig();
    const port = portAt(0);
    window.localStorage.setItem(PREFS_KEY, '{"layout":"review"}');
    expect(port.getItem(PREFS_KEY), 'a read').toBe('{"layout":"review"}');
    port.setItem('ccrc:reader:v1:doc:a', '{"layout":"classic"}');
    expect(window.localStorage.getItem('ccrc:reader:v1:doc:a'), 'another key keeps its layout field').toBe('{"layout":"classic"}');
    port.setItem(PREFS_KEY, 'not json');
    expect(window.localStorage.getItem(PREFS_KEY), 'a write that is no object').toBe('not json');
    port.removeItem('ccrc:reader:v1:doc:a');
    expect(window.localStorage.getItem('ccrc:reader:v1:doc:a')).toBeNull();
    expect(port.length).toBe(window.localStorage.length);
    expect(port.key(0)).toBe(window.localStorage.key(0));
  });

  it('layouts: a prefs write keeps the stored layout field as it is, and carries none when none is stored', () => {
    expect(withStoredLayoutKept('{"theme":"dark","layout":"default"}', '{"layout":"review"}')).toBe('{"theme":"dark","layout":"review"}');
    // A stored name no build knows is kept as it is, not read as default.
    expect(withStoredLayoutKept('{"theme":"dark","layout":"default"}', '{"layout":"holographic"}')).toBe('{"theme":"dark","layout":"holographic"}');
    // The write's own fields and their order stay; a layout the write lacks is appended.
    expect(withStoredLayoutKept('{"size":"l","theme":"dark"}', '{"theme":"light","layout":"guided"}')).toBe('{"size":"l","theme":"dark","layout":"guided"}');
    // None stored (absent, no field, not an object): the write's own layout goes, and a write with none is left as it is, byte for byte.
    for (const stored of [null, '', '{}', '{"theme":"light"}', '[1]', 'nope']) {
      expect(withStoredLayoutKept('{"theme":"dark","layout":"guided"}', stored), String(stored)).toBe('{"theme":"dark"}');
      expect(withStoredLayoutKept('{ "theme": "dark" }', stored), String(stored)).toBe('{ "theme": "dark" }');
    }
    // A write that is no object is nobody's prefs: unchanged.
    for (const value of ['not json', '[1]', 'null', '7']) expect(withStoredLayoutKept(value, '{"layout":"review"}'), value).toBe(value);
  });
});
