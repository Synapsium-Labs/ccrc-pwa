// Docs W8a Task 6 (refinement (d); spec A7, section 4.3's Images row; base 4.11): the reader frame's images are
// `data:` URLs. `loadReaderImages` plans each `scanRefs` string with the plain view's own pin rule (`planImageRef`),
// loads the pinned, non-deferred ones through the plain view's own `fetchImage` and the screen's queue, and stops at
// the page's byte budget. Loaders and queue are injected; every page is a placeholder (`demo`, `https://a.example`).
import { describe, expect, it, vi } from 'vitest';
import type { Element as HastElement, Nodes as HastNode } from 'hast';
import { DOCS_MAX_IMAGES_PER_PAGE, DOCS_RASTER_TYPES, type DocsEntry, type DocsTreeOk } from '../../shared/docs';
import { planImageRef, type DocsAssetContextValue } from '../src/docs/DocImage';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsLoaders, DocsRasterAnswer } from '../src/docs/failures';
import { detachUrls } from '../src/docs/docsLinks';
import { loadReaderImages } from '../src/docs/reader/images';
import { codeLanguage, inMarkdownPageBudget, inScanPageBudget } from '../src/lib/markdown';
import { parseMarkdown } from '../src/lib/markdownParse';
import { READER_IMAGE_BUDGET_BYTES } from '../src/lib/readerLimits';
import { draftOf, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';

/** The library's image grammar, re-spelled from the spec's type list (the library's own pattern is internal). */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
const MIB = 1024 * 1024;

/** A PNG's own magic from L0's table (never spelled here), then zeros of body up to `size`. */
const pngOf = (size = 16): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(size);
  out.set(DOCS_RASTER_TYPES.png.magic[0][0].bytes);
  return out;
};

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const okSvg = (): DocsFileAnswer => {
  const r = fileResponse(SVG_TEXT);
  return { s: 'ok', value: { ...r, contentClass: 'svg', show: { ...r.show, path: 'd.svg' } } };
};

type Leaf = Extract<ReturnType<typeof pageAt>, { kind: 'path' }>;
const leafAt = (url: string): Leaf => {
  const p = pageAt(url);
  if (p.kind !== 'path') throw new Error('fixture page is not a leaf');
  return p;
};
const leaf = leafAt('/docs/demo/specs/a.md');

function ctxOf(tree: DocsTreeOk): DocLinkContextValue {
  return {
    project: leaf.project, pageRef: leaf.ref, view: leaf.view, section: leaf.section, path: leaf.path, tree,
    pageSource: 'committed', urls: new WeakMap(), onFragment: vi.fn(),
  };
}

const withImages = (names: readonly string[], over: Partial<DocsEntry> = {}): DocLinkContextValue =>
  ctxOf(treeOk({ entries: [entry('specs', 'a.md'), ...names.map((n) => entry('specs', n, over))] }));

interface Rig {
  readonly raster: ReturnType<typeof vi.fn<DocsLoaders['raster']>>;
  readonly file: ReturnType<typeof vi.fn<DocsLoaders['file']>>;
  readonly onDraftAsset: ReturnType<typeof vi.fn<(count: number) => void>>;
  readonly assets: DocsAssetContextValue;
}

function rig(raster?: DocsLoaders['raster'], concurrency?: number): Rig {
  const r = vi.fn<DocsLoaders['raster']>(raster ?? (async (): Promise<DocsRasterAnswer> =>
    ({ s: 'ok', value: { bytes: pngOf(), mime: 'image/png' } })));
  const file = vi.fn<DocsLoaders['file']>(async (): Promise<DocsFileAnswer> => okSvg());
  const onDraftAsset = vi.fn<(count: number) => void>();
  return {
    raster: r, file, onDraftAsset,
    assets: { loaders: { raster: r, file }, queue: createFetchQueue(concurrency), onDraftAsset },
  };
}

const run = (refs: readonly string[], ctx: DocLinkContextValue, a: Rig, signal = new AbortController().signal) =>
  loadReaderImages(refs, ctx, a.assets, signal);

describe('loadReaderImages: the reader frame\'s images as data: URLs (refinement (d))', () => {
  it('a raster becomes a data:image/png;base64 URL in the library\'s image grammar', async () => {
    const a = rig();
    const { urls } = await run(['i.png'], withImages(['i.png']), a);
    expect(Object.keys(urls)).toEqual(['i.png']);
    expect(urls['i.png']).toMatch(IMAGE_DATA_URL);
    expect(urls['i.png']!.startsWith('data:image/png;base64,')).toBe(true);
    expect(urls['i.png']!.startsWith('blob:')).toBe(false);
  });

  it('an SVG becomes a data:image/svg+xml;base64 URL', async () => {
    const a = rig();
    const { urls } = await run(['d.svg'], withImages(['d.svg']), a);
    expect(urls['d.svg']).toBe('data:image/svg+xml;base64,' + btoa(SVG_TEXT));
    expect(urls['d.svg']).toMatch(IMAGE_DATA_URL);
    expect(a.file).toHaveBeenCalledTimes(1);
  });

  it('external, refused and repo refs are absent from the map', async () => {
    const a = rig();
    const refs = ['https://a.example/x.png', '../../../x.png', '../../../../../../x.png', '#top', 'missing.png', 'a.md'];
    const out = await run(refs, withImages(['i.png']), a);
    expect(out.urls).toEqual({});
    expect(out.drafts).toBe(0);
    expect(a.raster).not.toHaveBeenCalled();
    expect(a.file).not.toHaveBeenCalled();
  });

  it('index 30 and later are absent', async () => {
    const names = Array.from({ length: DOCS_MAX_IMAGES_PER_PAGE + 1 }, (_, i) => `i${String(i)}.png`);
    const a = rig();
    const { urls } = await run(names, withImages(names), a);
    expect(Object.keys(urls)).toHaveLength(DOCS_MAX_IMAGES_PER_PAGE);
    expect(urls[names[DOCS_MAX_IMAGES_PER_PAGE]!]).toBeUndefined();
    expect(urls[names[DOCS_MAX_IMAGES_PER_PAGE - 1]!]).toBeDefined();
    expect(a.raster).toHaveBeenCalledTimes(DOCS_MAX_IMAGES_PER_PAGE);
  });

  it('the byte budget stops adding', async () => {
    const names = ['a.png', 'b.png', 'c.png'];
    const a = rig(async () => ({ s: 'ok', value: { bytes: pngOf(2 * MIB), mime: 'image/png' } }));
    expect(3 * 2 * MIB).toBeGreaterThan(READER_IMAGE_BUDGET_BYTES);
    const { urls } = await run(names, withImages(names), a);
    expect(Object.keys(urls)).toEqual(['a.png', 'b.png']);
  });

  it('a space-in-path ref in scanRefs\' encoded form pins like the plain view\'s own recorded src', () => {
    // The plain view's recorded src for a spaced path is already the encoded form (the parse encodes it), and the
    // raw spelling is refused as malformed, so the encoded ref is the one both views pin.
    const parsed = parseMarkdown('![i](<a b.png>)', 'docs');
    if (parsed.kind !== 'tree') throw new Error('expected a tree');
    const d = detachUrls(parsed.tree, { codeLanguage, inScanPageBudget, inMarkdownPageBudget });
    const img = (n: HastNode): HastElement | undefined =>
      n.type === 'element' && n.tagName === 'img' ? n : ('children' in n ? n.children.map(img).find(Boolean) : undefined);
    const node = img(d.tree);
    const recorded = node === undefined ? undefined : d.urls.get(node);
    expect(recorded?.attrs['src']).toBe('a%20b.png');
    const ctx = ctxOf(treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'a b.png')] }));
    const viaRef = planImageRef(ctx, 'a%20b.png', recorded?.imageIndex ?? null);
    expect(viaRef.kind).toBe('pinned');
    if (viaRef.kind === 'pinned') expect(viaRef.pin).toMatchObject({ kind: 'committed', section: 'specs', path: 'a b.png' });
    expect(planImageRef(ctx, 'a b.png', 0)).toMatchObject({ kind: 'refused', why: 'malformed' });
  });

  it('a failed load is left out and the rest load', async () => {
    const names = ['a.png', 'b.png', 'c.png', 'd.png'];
    let n = 0;
    const a = rig(async () => {
      n += 1;
      if (n === 2) return { s: 'unreachable' };
      if (n === 3) throw new Error('boom');
      return { s: 'ok', value: { bytes: pngOf(), mime: 'image/png' } };
    }, 1);
    const { urls } = await run(names, withImages(names), a);
    expect(Object.keys(urls)).toEqual(['a.png', 'd.png']);
  });

  it('an aborted signal stops further loads', async () => {
    const names = ['a.png', 'b.png', 'c.png'];
    const pre = new AbortController();
    pre.abort();
    const a = rig();
    expect((await run(names, withImages(names), a, pre.signal)).urls).toEqual({});
    expect(a.raster).not.toHaveBeenCalled();

    const ctl = new AbortController();
    const b = rig(async () => {
      ctl.abort();
      return { s: 'ok', value: { bytes: pngOf(), mime: 'image/png' } };
    }, 1);
    const { urls } = await run(names, withImages(names), b, ctl.signal);
    expect(b.raster).toHaveBeenCalledTimes(1);
    expect(Object.keys(urls)).not.toContain('c.png');
    expect(Object.keys(urls)).not.toContain('b.png');
  });

  it('drafts counts the loaded draft images, and no onDraftAsset is called', async () => {
    const entries = [
      entry('specs', 'a.md', { draft: draftOf('modified') }),
      entry('specs', 'd1.png', { draft: draftOf('modified') }),
      entry('specs', 'd2.png', { draft: draftOf('modified') }),
      entry('specs', 'c.png'),
    ];
    const refPage = leafAt('/docs/demo/specs/a.md?ref=main');
    const ctx: DocLinkContextValue = {
      ...ctxOf(treeOk({ entries, drafts: holder() })), pageRef: refPage.ref, view: refPage.view,
    };
    const a = rig();
    const out = await run(['d1.png', 'd2.png', 'c.png'], ctx, a);
    expect(Object.keys(out.urls)).toEqual(['d1.png', 'd2.png', 'c.png']);
    expect(out.drafts).toBe(2);
    expect(a.onDraftAsset).not.toHaveBeenCalled();
  });
});
