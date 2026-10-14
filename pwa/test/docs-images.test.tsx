// Docs W5 part 1, Task 7: the docs image policy (spec 2026-10-01 4.11, 5.4, 5.5; M4.U1, M4.U2, M4.U5, M4.U6; spec 2
// row 66). `imagePinFor` is the one pin rule; `DocImage` is the only thing that puts an image `src` in the DOM, and
// that `src` is only ever an object URL of verified raster bytes (`rasterObjectUrl`, revoked on unmount and on
// replacement) or an SVG's `data:image/svg+xml;base64,` URL (never a `blob:`), loaded through the page's queue
// (concurrency 2) from an image the pin rule admits. Everything else is a refused span with its reason. Every page is
// a placeholder (`demo`, `main`, `example-org/example-repo`, `https://evil.example`, `https://a.example`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Root as HastRoot } from 'hast';
import {
  DOCS_CLASS_CAP, DOCS_MAX_IMAGES_PER_PAGE, DOCS_RASTER_TYPES, docsPageUrl,
  type DocPin, type DocsEntry, type DocsPageLocation, type DocsTreeOk,
} from '../../shared/docs';
import { SHARED_COMPONENTS } from '../src/lib/markdown';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import { DocImage, DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { DocLink, DocLinkContext, type DocLinkContextValue } from '../src/docs/DocLink';
import { detachUrls, docsLocation, imagePinFor, type ImagePin } from '../src/docs/docsLinks';
import {
  DOC_IMAGE_REFUSED_SENTENCE, DOC_IMAGE_TEXT, DOCS_SHOW_NOT_SVG, failureSentence, fillSentence, kib, slotSentence,
  type DocImageRefusal,
} from '../src/docs/docsText';
import { DOCS_PWA_FETCH_CONCURRENCY, createFetchQueue, type FetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsLoaders, DocsRasterAnswer } from '../src/docs/failures';
import { COMMIT_A, COMMIT_B, SERVED, draftOf, entry, failedAnswer, fileResponse, holder, pageAt, treeOk } from './docsFixtures';

const FP_2 = 'e'.repeat(64);

beforeEach(() => {
  vi.mocked(URL.createObjectURL).mockClear();
  vi.mocked(URL.revokeObjectURL).mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

/** A PNG's own magic from L0's table (never spelled here) and two bytes of body. */
const pngBytes = (): Uint8Array<ArrayBuffer> =>
  new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);

const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>';
const SVG_DATA = 'data:image/svg+xml;base64,' + btoa(SVG_TEXT);

function okSvg(text = SVG_TEXT): DocsFileAnswer {
  const r = fileResponse(text);
  return { s: 'ok', value: { ...r, contentClass: 'svg', show: { ...r.show, path: 'd.svg' } } };
}

interface Assets {
  readonly raster: ReturnType<typeof vi.fn<DocsLoaders['raster']>>;
  readonly file: ReturnType<typeof vi.fn<DocsLoaders['file']>>;
  readonly onDraftAsset: ReturnType<typeof vi.fn<(count: number) => void>>;
  readonly queue: FetchQueue;
  readonly value: DocsAssetContextValue;
}

function fakeAssets(): Assets {
  const raster = vi.fn<DocsLoaders['raster']>(async (): Promise<DocsRasterAnswer> =>
    ({ s: 'ok', value: { bytes: pngBytes(), mime: 'image/png' } }));
  const file = vi.fn<DocsLoaders['file']>(async (): Promise<DocsFileAnswer> => okSvg());
  const onDraftAsset = vi.fn<(count: number) => void>();
  const queue = createFetchQueue();
  return { raster, file, onDraftAsset, queue, value: { loaders: { raster, file }, queue, onDraftAsset } };
}

type Leaf = Extract<DocsPageLocation, { kind: 'path' }>;
const leafAt = (url: string): Leaf => {
  const p = pageAt(url);
  if (p.kind !== 'path') throw new Error(`${url} is not a leaf`);
  return p;
};

const treeOf = (src: string): HastRoot => {
  const o = parseMarkdown(src, 'docs');
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${o.kind}`);
  return o.tree;
};

/** One `<p><img src alt="x"></p>`, the source exactly as given (the parse would rewrite some of these). */
const imgTree = (src: string): HastRoot => ({
  type: 'root',
  children: [{
    type: 'element', tagName: 'p', properties: {},
    children: [{ type: 'element', tagName: 'img', properties: { src, alt: 'x' }, children: [] }],
  }],
});

interface DocOpts {
  readonly url?: string;
  readonly tree?: DocsTreeOk;
  readonly assets?: Assets;
}

/** `src` (Markdown, or a hast tree as is) detached and rendered as a Docs page body with `DocLink` and `DocImage`. */
function docUi(src: string | HastRoot, o: DocOpts = {}) {
  const page = leafAt(o.url ?? '/docs/demo/specs/a.md');
  const tree = o.tree ?? treeOk();
  const d = detachUrls(typeof src === 'string' ? treeOf(src) : src);
  const assets = o.assets ?? fakeAssets();
  const ctx: DocLinkContextValue = {
    project: page.project, pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree,
    pageSource: 'committed', urls: d.urls, onFragment: vi.fn(),
  };
  const ui = (
    <article>
      <DocLinkContext value={ctx}>
        <DocsAssetContext value={assets.value}>
          {renderHast(d.tree, { components: { ...SHARED_COMPONENTS, a: DocLink, img: DocImage } })}
        </DocsAssetContext>
      </DocLinkContext>
    </article>
  );
  return { ui, assets, page, tree };
}

function renderDoc(src: string | HastRoot, o: DocOpts = {}) {
  const u = docUi(src, o);
  return { ...render(u.ui), ...u };
}

const refusedText = (why: DocImageRefusal, fields: Record<string, string> = {}): string =>
  fillSentence(DOC_IMAGE_TEXT.refused, { reason: fillSentence(DOC_IMAGE_REFUSED_SENTENCE[why], fields) });

const committedPin = (path: string, commit = COMMIT_A): DocPin =>
  ({ kind: 'committed', commit, servedRef: SERVED, section: 'specs', path });

/** The page `specs/a.md` and an image `specs/i.png`, with the drafts and per-entry overrides a case needs. */
function withImage(img: Partial<DocsEntry> = {}, pageEntry: Partial<DocsEntry> = {}, drafts = holder()): DocsTreeOk {
  return treeOk({ entries: [entry('specs', 'a.md', pageEntry), entry('specs', 'i.png', img)], drafts });
}

const imgs = (c: HTMLElement): HTMLImageElement[] => [...c.querySelectorAll('img')];
const loadedSrcs = (c: HTMLElement): string[] => imgs(c).map((i) => i.getAttribute('src') ?? '');
const chips = (c: HTMLElement): string[] => [...c.querySelectorAll('.doc-img-chip')].map((s) => s.textContent ?? '');

describe('imagePinFor: the one pin rule (spec 4.11; M4.U2, row 66)', () => {
  const DEFAULT = leafAt('/docs/demo/specs/a.md');
  const REF = leafAt('/docs/demo/specs/a.md?ref=main');
  const REF_COMMITTED = leafAt('/docs/demo/specs/a.md?ref=main&view=committed');
  const drafted = draftOf('modified', { fp: FP_2 });
  const img = (over: Partial<DocsEntry> = {}): DocsEntry => entry('specs', 'i.png', over);
  const draftPage = (imgOver: Partial<DocsEntry> = {}) =>
    withImage(imgOver, { draft: draftOf('modified') });

  it('no entry at the resolved path is absent, on every page', () => {
    for (const page of [DEFAULT, REF]) expect(imagePinFor(undefined, draftPage(), page)).toEqual({ ok: false, why: 'absent' });
  });

  it('a committed page takes CommittedPin(C, served) for a committed file or exec', () => {
    const t = withImage();
    for (const kind of ['file', 'exec'] as const) {
      expect(imagePinFor(img({ committed: { kind, blob: '1'.repeat(40), size: 10 } }), t, DEFAULT)).toEqual(
        { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: false });
    }
  });

  it('a committed page refuses a committed symlink, a submodule, and nothing committed as absent', () => {
    const t = withImage();
    for (const committed of [
      { kind: 'symlink', blob: '1'.repeat(40), size: 10 }, { kind: 'submodule', blob: COMMIT_B, size: null }, null,
    ] as const) {
      expect(imagePinFor(img({ committed, draft: null }), t, DEFAULT)).toEqual({ ok: false, why: 'absent' });
    }
  });

  it('the default view never resolves a draft and never says "uncommitted change not shown", even on a drafted leaf', () => {
    const t = draftPage({ draft: drafted });
    expect(imagePinFor(t.entries[1], t, DEFAULT)).toEqual(
      { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: false });
  });

  it('a ref-view page that opens committed shows committed bytes of a drafted image, and says so', () => {
    const t = withImage({ draft: drafted });
    expect(imagePinFor(t.entries[1], t, REF)).toEqual(
      { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: true });
  });

  it('view=committed on a draft leaf is a committed page: committed bytes, and the note', () => {
    const t = draftPage({ draft: drafted });
    expect(imagePinFor(t.entries[1], t, REF_COMMITTED)).toEqual(
      { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: true });
  });

  it('a ref view whose holder is not at the served commit overlays nothing: committed, no note', () => {
    const t = withImage({ draft: drafted }, { draft: draftOf('modified') }, holder(COMMIT_B, false));
    expect(imagePinFor(t.entries[1], t, REF)).toEqual(
      { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: false });
  });

  it('a draft page takes DraftPin(branch, head, fp) for a drafted regular file, and marks it draft', () => {
    const t = draftPage({ draft: drafted });
    const want: ImagePin = {
      ok: true, draft: true, uncommittedNotShown: false,
      pin: { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'i.png', fp: FP_2 },
    };
    expect(imagePinFor(t.entries[1], t, REF)).toEqual(want);
    const fresh = draftPage({ committed: null, draft: draftOf('untracked', { fp: FP_2 }) });
    expect(imagePinFor(fresh.entries[1], fresh, REF)).toEqual(want);
  });

  it('a draft page takes the committed side of an image with no draft, under the same file condition', () => {
    const t = draftPage();
    expect(imagePinFor(t.entries[1], t, REF)).toEqual(
      { ok: true, pin: committedPin('i.png'), draft: false, uncommittedNotShown: false });
    const link = draftPage({ committed: { kind: 'symlink', blob: '1'.repeat(40), size: 4 } });
    expect(imagePinFor(link.entries[1], link, REF)).toEqual({ ok: false, why: 'absent' });
  });

  it('a draft page refuses a deleted draft as deleted-in-worktree', () => {
    const t = draftPage({ draft: draftOf('deleted', { kind: 'absent', fp: null, size: null }) });
    expect(imagePinFor(t.entries[1], t, REF)).toEqual({ ok: false, why: 'deleted-in-worktree' });
  });

  it('a draft page refuses a withheld or type-changed draft, never falling back to the committed bytes', () => {
    for (const d of [
      draftOf('modified', { fp: null }), draftOf('modified', { kind: 'symlink', fp: null }),
      draftOf('typechange', { kind: 'symlink', fp: null }), draftOf('modified', { kind: 'unreadable', fp: null }),
    ]) {
      const t = draftPage({ draft: d });
      expect(imagePinFor(t.entries[1], t, REF)).toEqual({ ok: false, why: 'draft-withheld' });
    }
  });
});

describe('M4.U1: nothing hostile becomes src, and nothing is fetched for it', () => {
  const CASES: readonly (readonly [string, string, DocImageRefusal])[] = [
    ['a root-relative API path', '/api/example/x', 'root-relative'],
    ['a protocol-relative host', '//evil.example/x.png', 'protocol-relative'],
    ['an https image', 'https://evil.example/x.png', 'external'],
    ['a data: image', 'data:image/png;base64,AAAA', 'data'],
    ['a blob: URL', 'blob:https://a.example/x', 'blob'],
    ['a javascript: URL', 'javascript:alert(1)', 'scheme'],
    ['a leading control character (trimmed as a browser would, then no such entry)', String.fromCharCode(1) + 'x.png', 'absent'],
    ['a backslash form', '\\\\evil.example\\x.png', 'malformed'],
    ['a climb above the repository', '../../../../x.png', 'above-root'],
    ['an in-repo file outside the sections', '../../README.png', 'repo'],
    ['an empty source', '', 'empty'],
    ['a mailto: URL', 'mailto:you@example.com', 'scheme'],
    ['a fragment', '#fn-1', 'fragment'],
  ];

  it.each(CASES)('%s (%j): no img, no loader call, one refused span with its reason', async (_name, src, why) => {
    const { container, assets } = renderDoc(imgTree(src));
    await act(async () => {});
    expect(imgs(container)).toHaveLength(0);
    expect(container.querySelectorAll('[src]')).toHaveLength(0);
    expect(assets.raster).not.toHaveBeenCalled();
    expect(assets.file).not.toHaveBeenCalled();
    const refused = container.querySelectorAll('span.doc-img-refused');
    expect(refused).toHaveLength(1);
    expect(refused[0]!.getAttribute('role')).toBe('img');
    expect(refused[0]!.getAttribute('aria-label')).toBe('x');
    expect(refused[0]!.textContent).toBe(refusedText(why));
  });

  it('control: the same tree undetached, with the intrinsic img, would put the API path in the DOM', () => {
    const { container } = render(<>{renderHast(imgTree('/api/example/x'), { components: SHARED_COMPONENTS })}</>);
    expect(container.querySelector('img[src="/api/example/x"]')).not.toBeNull();
  });

  it('an https image offers "Open image externally", which opens it on tap only', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { getByRole } = renderDoc(imgTree('https://evil.example/x.png'));
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(getByRole('button', { name: DOC_IMAGE_TEXT.openExternal }));
    expect(open).toHaveBeenCalledWith('https://evil.example/x.png', '_blank', 'noopener,noreferrer');
  });

  it('a document that is not an image is refused not-image; an html one offers "Open in viewer" onto its leaf', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'm.html'), entry('specs', 'b.md')] });
    const { container, getByRole, queryAllByRole, assets } = renderDoc('![m](m.html) ![b](b.md)',
      { tree, url: '/docs/demo/specs/a.md?ref=main' });
    await act(async () => {});
    const refused = [...container.querySelectorAll('span.doc-img-refused')].map((s) => s.textContent);
    expect(refused).toEqual([refusedText('not-image'), refusedText('not-image')]);
    expect(queryAllByRole('button', { name: DOC_IMAGE_TEXT.openViewer })).toHaveLength(1);
    fireEvent.click(getByRole('button', { name: DOC_IMAGE_TEXT.openViewer }));
    expect(location.pathname + location.search).toBe('/docs/demo/specs/m.html?ref=main');
    expect(assets.raster).not.toHaveBeenCalled();
    expect(assets.file).not.toHaveBeenCalled();
  });

  it('an image listed over its class cap is refused too-large before any fetch; at the cap it loads', async () => {
    const cap = DOCS_CLASS_CAP.raster;
    const big = renderDoc('![i](i.png)', { tree: withImage({ committed: { kind: 'file', blob: '1'.repeat(40), size: cap + 1 } }) });
    await act(async () => {});
    expect(big.container.querySelector('span.doc-img-refused')?.textContent)
      .toBe(refusedText('too-large', { size: kib(cap + 1), cap: kib(cap) }));
    expect(big.assets.raster).not.toHaveBeenCalled();
    cleanup();
    const atCap = renderDoc('![i](i.png)', { tree: withImage({ committed: { kind: 'file', blob: '1'.repeat(40), size: cap } }) });
    await waitFor(() => expect(imgs(atCap.container)).toHaveLength(1));
  });

  it('outside a Docs page every image is refused, and nothing is fetched', () => {
    const d = detachUrls(treeOf('![i](i.png)'));
    const bare = render(<>{renderHast(d.tree, { components: { ...SHARED_COMPONENTS, img: DocImage } })}</>);
    expect(bare.container.querySelector('span.doc-img-refused')?.textContent).toBe(refusedText('outside-page'));
    cleanup();
    const page = leafAt('/docs/demo/specs/a.md');
    const ctx: DocLinkContextValue = {
      project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: withImage(),
      pageSource: 'committed', urls: d.urls, onFragment: vi.fn(),
    };
    const noAssets = render(
      <DocLinkContext value={ctx}>{renderHast(d.tree, { components: { ...SHARED_COMPONENTS, img: DocImage } })}</DocLinkContext>);
    expect(page.kind).toBe('path');
    expect(imgs(noAssets.container)).toHaveLength(0);
    expect(noAssets.container.querySelector('span.doc-img-refused')?.textContent).toBe(refusedText('outside-page'));
  });
});

describe('M4.U2 and row 66: each page loads exactly the pin the rule gives', () => {
  it('a default-view page loads CommittedPin(C, served) and never requests a DraftPin, even with drafts on both', async () => {
    const tree = withImage({ draft: draftOf('modified', { fp: FP_2 }) }, { draft: draftOf('modified') });
    const { container, assets } = renderDoc('![i](i.png)', { tree });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    expect(assets.raster).toHaveBeenCalledTimes(1);
    expect(assets.raster.mock.calls[0]?.slice(0, 2)).toEqual(['demo', committedPin('i.png')]);
    expect(assets.raster.mock.calls.some(([, pin]) => pin.kind === 'draft')).toBe(false);
    expect(chips(container)).toEqual([]);
    expect(assets.onDraftAsset).not.toHaveBeenCalled();
  });

  it('a draft page loads the DraftPin bytes, wears the draft chip, and counts one embed (and uncounts it on unmount)', async () => {
    const tree = withImage({ draft: draftOf('modified', { fp: FP_2 }) }, { draft: draftOf('modified') });
    const r = renderDoc('![i](i.png)', { tree, url: '/docs/demo/specs/a.md?ref=main' });
    await waitFor(() => expect(imgs(r.container)).toHaveLength(1));
    expect(r.assets.raster.mock.calls[0]?.slice(0, 2)).toEqual(
      ['demo', { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'i.png', fp: FP_2 }]);
    expect(chips(r.container)).toEqual([DOC_IMAGE_TEXT.draft]);
    expect(r.assets.onDraftAsset.mock.calls).toEqual([[1]]);
    r.unmount();
    expect(r.assets.onDraftAsset.mock.calls).toEqual([[1], [-1]]);
  });

  it('a committed page whose image has a modified draft loads the committed bytes and says "uncommitted change not shown"', async () => {
    const tree = withImage({ draft: draftOf('modified', { fp: FP_2 }) });
    const { container, assets } = renderDoc('![i](i.png)', { tree, url: '/docs/demo/specs/a.md?ref=main' });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    expect(assets.raster.mock.calls[0]?.slice(0, 2)).toEqual(['demo', committedPin('i.png')]);
    expect(chips(container)).toEqual([DOC_IMAGE_TEXT.uncommittedNotShown]);
    expect(assets.onDraftAsset).not.toHaveBeenCalled();
  });

  it('a draft page refuses a deleted image and a withheld one with their reasons, and fetches neither', async () => {
    const tree = treeOk({
      drafts: holder(),
      entries: [
        entry('specs', 'a.md', { draft: draftOf('modified') }),
        entry('specs', 'gone.png', { draft: draftOf('deleted', { kind: 'absent', fp: null, size: null }) }),
        entry('specs', 'big.png', { draft: draftOf('modified', { fp: null }) }),
      ],
    });
    const { container, assets } = renderDoc('![g](gone.png) ![b](big.png)', { tree, url: '/docs/demo/specs/a.md?ref=main' });
    await act(async () => {});
    expect([...container.querySelectorAll('span.doc-img-refused')].map((s) => s.textContent)).toEqual(
      [refusedText('deleted-in-worktree'), refusedText('draft-withheld')]);
    expect(assets.raster).not.toHaveBeenCalled();
    expect(imgs(container)).toHaveLength(0);
  });

  it('tapping a loaded image opens its own leaf in-app at the page ref, never /api/', async () => {
    const { container } = renderDoc('![i](i.png)', { tree: withImage(), url: '/docs/demo/specs/a.md?ref=main' });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    const button = container.querySelector('button.doc-img-link');
    expect(button).not.toBeNull();
    expect(button!.querySelector('img.msg-img')).not.toBeNull();
    fireEvent.click(button!);
    const here = leafAt('/docs/demo/specs/a.md?ref=main');
    expect(location.pathname + location.search).toBe(
      docsPageUrl(docsLocation(here, { kind: 'path', section: 'specs', path: 'i.png', dirSlash: false })));
    expect(location.pathname.startsWith('/api/')).toBe(false);
  });
});

describe('loading: raster object URLs, SVG data: URLs, failures (spec 4.11, 5.4, 5.5)', () => {
  it('a raster becomes an object URL of its table type: the img src is that URL and nothing else', async () => {
    const { container } = renderDoc('![i](i.png)', { tree: withImage() });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    const created = vi.mocked(URL.createObjectURL).mock.results.map((r) => r.value as string);
    expect(created).toHaveLength(1);
    expect(loadedSrcs(container)).toEqual(created);
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(imgs(container)[0]!.getAttribute('alt')).toBe('i');
  });

  it('an SVG goes through loaders.file and becomes a data:image/svg+xml;base64 URL, never blob: and never /api/', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd.svg')] });
    const { container, assets } = renderDoc('![d](d.svg)', { tree });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    expect(assets.file.mock.calls[0]?.slice(0, 2)).toEqual(['demo', committedPin('d.svg')]);
    expect(assets.raster).not.toHaveBeenCalled();
    expect(loadedSrcs(container)).toEqual([SVG_DATA]);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('a base64 SVG answer gives the same data: URL', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd.svg')] });
    const assets = fakeAssets();
    const r = fileResponse('');
    assets.file.mockResolvedValue({
      s: 'ok', value: { ...r, contentClass: 'svg', show: { ...r.show, encoding: 'base64', text: undefined, b64: btoa(SVG_TEXT) } },
    });
    const { container } = renderDoc('![d](d.svg)', { tree, assets });
    await waitFor(() => expect(imgs(container)).toHaveLength(1));
    expect(loadedSrcs(container)).toEqual([SVG_DATA]);
  });

  it('an SVG path answered as another class is a failure chip, not an image', async () => {
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'd.svg')] });
    const assets = fakeAssets();
    assets.file.mockResolvedValue({ s: 'ok', value: fileResponse('<x>') });
    const { container } = renderDoc('![d](d.svg)', { tree, assets });
    await waitFor(() => expect(container.querySelector('span.doc-img-failed')).not.toBeNull());
    expect(container.querySelector('span.doc-img-failed')!.textContent).toBe(
      failureSentence({ ok: false, failure: 'malformed-answer', why: DOCS_SHOW_NOT_SVG }));
    expect(imgs(container)).toHaveLength(0);
  });

  it.each([
    ['a docs word', failedAnswer('absent-path')],
    ['an unexpected response', { s: 'unexpected-response', status: 200, contentType: 'text/html' }],
    ['an unreachable server', { s: 'unreachable' }],
    ['a lost sign-in', { s: 'auth' }],
  ] as const)('%s is a per-image chip with its own sentence', async (_name, answer) => {
    const assets = fakeAssets();
    assets.raster.mockResolvedValue(answer);
    const { container } = renderDoc('![i](i.png)', { tree: withImage(), assets });
    await waitFor(() => expect(container.querySelector('span.doc-img-failed')).not.toBeNull());
    const want = answer.s === 'failed' ? failureSentence(answer.body) : slotSentence(answer);
    expect(container.querySelector('span.doc-img-failed')!.textContent).toBe(want);
    expect(container.querySelector('span.doc-img-failed')!.getAttribute('aria-label')).toBe('i');
    expect(imgs(container)).toHaveLength(0);
  });

  it('a loader that rejects is a chip naming the error', async () => {
    const assets = fakeAssets();
    assets.raster.mockRejectedValue(new Error('boom'));
    const { container } = renderDoc('![i](i.png)', { tree: withImage(), assets });
    await waitFor(() => expect(container.querySelector('span.doc-img-failed')).not.toBeNull());
    expect(container.querySelector('span.doc-img-failed')!.textContent).toBe(
      fillSentence(DOC_IMAGE_TEXT.loaderFailed, { error: 'boom' }));
  });
});

describe('M4.U5: the image cap', () => {
  it(`${DOCS_MAX_IMAGES_PER_PAGE + 1} pinned images make ${DOCS_MAX_IMAGES_PER_PAGE} loader calls; the last is Load image, whose tap loads it`, async () => {
    const n = DOCS_MAX_IMAGES_PER_PAGE + 1;
    const names = Array.from({ length: n }, (_, i) => `i${i}.png`);
    const tree = treeOk({ entries: [entry('specs', 'a.md'), ...names.map((p) => entry('specs', p))] });
    const { container, assets, getAllByRole } = renderDoc(names.map((p) => `![${p}](${p})`).join('\n\n'), { tree });
    await waitFor(() => expect(imgs(container)).toHaveLength(DOCS_MAX_IMAGES_PER_PAGE));
    expect(assets.raster).toHaveBeenCalledTimes(DOCS_MAX_IMAGES_PER_PAGE);
    expect(assets.raster.mock.calls.map(([, pin]) => pin.path)).toEqual(names.slice(0, DOCS_MAX_IMAGES_PER_PAGE));
    const load = getAllByRole('button', { name: DOC_IMAGE_TEXT.load });
    expect(load).toHaveLength(1);
    fireEvent.click(load[0]!);
    await waitFor(() => expect(imgs(container)).toHaveLength(n));
    expect(assets.raster).toHaveBeenCalledTimes(n);
    expect(assets.raster.mock.calls[n - 1]?.[1].path).toBe(names[n - 1]);
  });
});

describe('M4.U6: object URLs are revoked', () => {
  it('unmount revokes the URL it created', async () => {
    const r = renderDoc('![i](i.png)', { tree: withImage() });
    await waitFor(() => expect(imgs(r.container)).toHaveLength(1));
    const created = vi.mocked(URL.createObjectURL).mock.results[0]!.value as string;
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    r.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(created);
  });

  it('a replaced image revokes the old URL and shows only the new one', async () => {
    const assets = fakeAssets();
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'i.png'), entry('specs', 'j.png')] });
    const r = renderDoc('![i](i.png)', { tree, assets });
    await waitFor(() => expect(imgs(r.container)).toHaveLength(1));
    const first = vi.mocked(URL.createObjectURL).mock.results[0]!.value as string;
    r.rerender(docUi('![i](j.png)', { tree, assets }).ui);
    await waitFor(() => expect(vi.mocked(URL.createObjectURL).mock.results).toHaveLength(2));
    const second = vi.mocked(URL.createObjectURL).mock.results[1]!.value as string;
    await waitFor(() => expect(loadedSrcs(r.container)).toEqual([second]));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(second);
  });

  it('a raster whose loader resolves after unmount, ignoring its signal, makes no object URL', async () => {
    const assets = fakeAssets();
    let release: () => void = () => {};
    assets.raster.mockImplementation(() => new Promise<DocsRasterAnswer>((resolve) => {
      release = () => resolve({ s: 'ok', value: { bytes: pngBytes(), mime: 'image/png' } });
    }));
    const r = renderDoc('![i](i.png)', { tree: withImage(), assets });
    await act(async () => {});
    expect(assets.raster).toHaveBeenCalledTimes(1);
    r.unmount();
    await act(async () => { release(); });
    await act(async () => {});
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('a replaced image shows Loading, never the old image, until its new bytes arrive', async () => {
    const assets = fakeAssets();
    const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'i.png'), entry('specs', 'j.png')] });
    const r = renderDoc('![i](i.png)', { tree, assets });
    await waitFor(() => expect(imgs(r.container)).toHaveLength(1));
    let release: () => void = () => {};
    assets.raster.mockImplementationOnce(() => new Promise<DocsRasterAnswer>((resolve) => {
      release = () => resolve({ s: 'ok', value: { bytes: pngBytes(), mime: 'image/png' } });
    }));
    r.rerender(docUi('![i](j.png)', { tree, assets }).ui);
    await act(async () => {});
    expect(assets.raster).toHaveBeenCalledTimes(2);
    expect(imgs(r.container)).toHaveLength(0);
    expect(r.container.querySelectorAll('.doc-img-loading')).toHaveLength(1);
    await act(async () => { release(); });
    await waitFor(() => expect(vi.mocked(URL.createObjectURL).mock.results).toHaveLength(2));
    const second = vi.mocked(URL.createObjectURL).mock.results[1]!.value as string;
    await waitFor(() => expect(loadedSrcs(r.container)).toEqual([second]));
  });
});

describe('the per-screen fetch queue (spec 4.11: concurrency 2)', () => {
  /** A job that waits until `release(i)`; `started` lists the jobs that began, in order. */
  function gate() {
    const started: number[] = [];
    const releases = new Map<number, () => void>();
    const job = (i: number) => (signal: AbortSignal) => new Promise<number>((resolve, reject) => {
      started.push(i);
      releases.set(i, () => resolve(i));
      signal.addEventListener('abort', () => reject(signal.reason));
    });
    return { started, job, release: (i: number) => releases.get(i)!() };
  }

  it('runs two at a time by default, in order, and starts the next when one settles', async () => {
    expect(DOCS_PWA_FETCH_CONCURRENCY).toBe(2);
    const q = createFetchQueue();
    const g = gate();
    const done = [0, 1, 2, 3].map((i) => q.run(g.job(i)));
    await act(async () => {});
    expect(g.started).toEqual([0, 1]);
    g.release(1);
    await expect(done[1]).resolves.toBe(1);
    expect(g.started).toEqual([0, 1, 2]);
    g.release(0);
    await expect(done[0]).resolves.toBe(0);
    expect(g.started).toEqual([0, 1, 2, 3]);
  });

  it('a failed job frees its slot', async () => {
    const q = createFetchQueue(1);
    const ran: string[] = [];
    const a = q.run(async () => { ran.push('a'); throw new Error('x'); });
    const b = q.run(async () => { ran.push('b'); return 'b'; });
    await expect(a).rejects.toThrow('x');
    await expect(b).resolves.toBe('b');
    expect(ran).toEqual(['a', 'b']);
  });

  it('a waiting job whose signal aborts never runs and rejects with the reason; the next one runs', async () => {
    const q = createFetchQueue(1);
    const g = gate();
    const first = q.run(g.job(0));
    const ctl = new AbortController();
    const second = q.run(g.job(1), ctl.signal);
    const third = q.run(g.job(2));
    ctl.abort(new Error('gone'));
    await expect(second).rejects.toThrow('gone');
    g.release(0);
    await first;
    await act(async () => {});
    expect(g.started).toEqual([0, 2]);
    g.release(2);
    await expect(third).resolves.toBe(2);
  });

  it('a job whose signal is already aborted never starts and rejects with its reason', async () => {
    const q = createFetchQueue();
    const g = gate();
    const ctl = new AbortController();
    ctl.abort(new Error('gone'));
    const p = q.run(g.job(0), ctl.signal);
    expect(g.started).toEqual([]);
    await expect(p).rejects.toThrow('gone');
  });

  it('a running job sees its caller abort through its own signal', async () => {
    const q = createFetchQueue();
    const g = gate();
    const ctl = new AbortController();
    const p = q.run(g.job(0), ctl.signal);
    await act(async () => {});
    ctl.abort(new Error('stop'));
    await expect(p).rejects.toThrow('stop');
  });

  it('dispose aborts what runs, rejects what waits, and refuses later jobs', async () => {
    const q = createFetchQueue(1);
    const g = gate();
    const running = q.run(g.job(0));
    const waiting = q.run(g.job(1));
    await act(async () => {});
    q.dispose();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    await expect(q.run(g.job(2))).rejects.toMatchObject({ name: 'AbortError' });
    expect(g.started).toEqual([0]);
  });

  it('refuses a concurrency that is not a positive integer', () => {
    for (const c of [0, -1, 1.5, Number.NaN]) expect(() => createFetchQueue(c)).toThrow(RangeError);
  });

  it('three images with held loaders load two at a time', async () => {
    const assets = fakeAssets();
    const holds: (() => void)[] = [];
    assets.raster.mockImplementation((_project, _pin, signal) => new Promise<DocsRasterAnswer>((resolve) => {
      holds.push(() => resolve({ s: 'ok', value: { bytes: pngBytes(), mime: 'image/png' } }));
      signal?.addEventListener('abort', () => resolve({ s: 'unreachable' }));
    }));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), ...['p.png', 'q.png', 'r.png'].map((p) => entry('specs', p))] });
    const { container } = renderDoc('![p](p.png) ![q](q.png) ![r](r.png)', { tree, assets });
    await act(async () => {});
    expect(assets.raster).toHaveBeenCalledTimes(2);
    await act(async () => { holds[0]!(); });
    await waitFor(() => expect(assets.raster).toHaveBeenCalledTimes(3));
    await act(async () => { holds[1]!(); holds[2]!(); });
    await waitFor(() => expect(imgs(container)).toHaveLength(3));
  });

  it('unmounting an image aborts its load: the loader\'s signal is aborted, and a waiting image never reaches its loader', async () => {
    const assets = fakeAssets();
    const signals: (AbortSignal | undefined)[] = [];
    assets.raster.mockImplementation((_project, _pin, signal) => new Promise<DocsRasterAnswer>((resolve) => {
      signals.push(signal);
      signal?.addEventListener('abort', () => resolve({ s: 'unreachable' }));
    }));
    const tree = treeOk({ entries: [entry('specs', 'a.md'), ...['p.png', 'q.png', 'r.png'].map((p) => entry('specs', p))] });
    const r = renderDoc('![p](p.png) ![q](q.png) ![r](r.png)', { tree, assets });
    await act(async () => {});
    expect(assets.raster).toHaveBeenCalledTimes(2);
    r.unmount();
    await act(async () => {});
    expect(signals.map((s) => s?.aborted)).toEqual([true, true]);
    expect(assets.raster).toHaveBeenCalledTimes(2);
  });
});

describe('the DOM: no src except a created object URL or an SVG data: URL', () => {
  it('a page mixing every arm puts only blob:mock and data:image/svg+xml URLs in src, and no attribute names /api/', async () => {
    const tree = treeOk({
      entries: [entry('specs', 'a.md'), entry('specs', 'i.png'), entry('specs', 'd.svg'), entry('specs', 'm.html')],
    });
    const src = '![i](i.png) ![d](d.svg) ![m](m.html) ![e](https://evil.example/x.png) ![a](/api/example/x) [l](b.md)';
    const { container } = renderDoc(src, { tree });
    await waitFor(() => expect(imgs(container)).toHaveLength(2));
    for (const s of loadedSrcs(container)) expect(/^(blob:mock\/\d+|data:image\/svg\+xml;base64,)/.test(s)).toBe(true);
    const all = [...container.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.value));
    expect(all.some((v) => v.includes('/api/'))).toBe(false);
    expect(container.querySelectorAll('[src]')).toHaveLength(2);
  });
});
