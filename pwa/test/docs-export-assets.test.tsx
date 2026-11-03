// Docs W5 Export, Task 4: images from memory (spec 2026-10-01 4.3 item 6, 4.17 "Images"; M4.EX3's registry half;
// refinement (g)). The registry holds what each `DocImage` already holds, under its pin's key, by reference, and forgets
// a key when the last image showing it goes; `settleExportAssets` waits for the keys still loading, at most its bound.
// The images load through injected loaders; nothing reaches a server. Placeholders only: project `demo`, `specs/...`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { Element as HastElement } from 'hast';
import { DOCS_RASTER_TYPES, docsApi, type DocsTreeOk } from '../../shared/docs';
import { DocImage, DocsAssetContext } from '../src/docs/DocImage';
import { DocLinkContext, type DocLinkContextValue } from '../src/docs/DocLink';
import type { DetachedUrls } from '../src/docs/docsLinks';
import {
  ASSET_FAILED, ASSET_LOADING, createExportAssets, settleExportAssets, type ExportAssets,
} from '../src/docs/export/exportAssets';
import { DOCS_EXPORT_IMAGE_WAIT_MS } from '../src/docs/export/policy';
import { createFetchQueue } from '../src/docs/fetchQueue';
import { pinFor } from '../src/docs/useDocsVisit';
import { COMMIT_A, SERVED, draftOf, entry, fakeLoaders, holder, pageAt, treeOk, type FakeLoaders } from './docsFixtures';

const PNG = new Uint8Array([...DOCS_RASTER_TYPES.png.magic[0][0].bytes, 0, 255]);
const KEY = docsApi.file('demo', { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'x.png' });

afterEach(() => {
  vi.useRealTimers();
});

/** One Markdown image (`src`) on the page `url` of `tree`, under the screen's two contexts, `assets` its registry. */
function image(tree: DocsTreeOk, f: FakeLoaders, assets: ExportAssets, url = '/docs/demo/specs/a.md', src = 'x.png') {
  const node: HastElement = { type: 'element', tagName: 'img', properties: {}, children: [] };
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error('fixture: not a leaf');
  const ui = (t: DocsTreeOk) => {
    const urls = new WeakMap<HastElement, DetachedUrls>([[node, { attrs: { src }, imageIndex: 0 }]]);
    const ctx: DocLinkContextValue = {
      project: 'demo', pageRef: page.ref, view: page.view, section: page.section, path: page.path, tree: t,
      pageSource: pinFor(t, page)?.kind === 'draft' ? 'draft' : 'committed', urls, onFragment: vi.fn(),
    };
    return (
      <DocsAssetContext value={{ loaders: f.loaders, queue, onDraftAsset: () => {}, exportAssets: assets }}>
        <DocLinkContext value={ctx}><DocImage node={node} alt="x" /></DocLinkContext>
      </DocsAssetContext>
    );
  };
  const queue = createFetchQueue();
  const view = render(ui(tree));
  return { ...view, rerenderAt: (t: DocsTreeOk) => view.rerender(ui(t)) };
}

describe('the ExportAssets registry (spec 4.3 item 6; refinement (g))', () => {
  it('holds a key while any image shows it, and forgets it with the last', () => {
    const assets = createExportAssets();
    const a = assets.track('k');
    const b = assets.track('k');
    a.report(ASSET_FAILED);
    expect(assets.get('k')).toBe(ASSET_FAILED);
    a.release();
    expect(assets.get('k')).toBe(ASSET_FAILED);
    b.release();
    expect(assets.get('k')).toBeUndefined();
  });

  it('ignores a report after its hold is released, and counts every change', () => {
    const assets = createExportAssets();
    const a = assets.track('k');
    const before = assets.version();
    a.release();
    a.report(ASSET_FAILED);
    expect(assets.get('k')).toBeUndefined();
    expect(assets.version()).toBe(before + 1);
  });

  it('settleExportAssets answers at once when no key is loading, and waits for a loading key until it settles', async () => {
    vi.useFakeTimers();
    const assets = createExportAssets();
    await expect(settleExportAssets(assets, ['k'], 10)).resolves.toBeUndefined();
    const hold = assets.track('k');
    hold.report(ASSET_LOADING);
    let done = false;
    void settleExportAssets(assets, ['k'], DOCS_EXPORT_IMAGE_WAIT_MS).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(DOCS_EXPORT_IMAGE_WAIT_MS - 1);
    expect(done).toBe(false);
    hold.report(ASSET_FAILED);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it('settleExportAssets gives up after its bound, leaving the key loading (M4.EX3)', async () => {
    vi.useFakeTimers();
    const assets = createExportAssets();
    assets.track('k').report(ASSET_LOADING);
    let done = false;
    void settleExportAssets(assets, ['k'], DOCS_EXPORT_IMAGE_WAIT_MS).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(DOCS_EXPORT_IMAGE_WAIT_MS);
    expect(done).toBe(true);
    expect(assets.get('k')).toBe(ASSET_LOADING);
  });
});

describe("DocImage reports what it holds into the page's registry (spec 4.11; M4.EX3)", () => {
  const TREE = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'x.png')] });

  it("a loaded raster reports its bytes, by reference, and its table MIME under its pin's key; the key goes with the image", async () => {
    const assets = createExportAssets();
    const f = fakeLoaders();
    f.raster.mockResolvedValue({ s: 'ok', value: { bytes: PNG, mime: DOCS_RASTER_TYPES.png.mime } });
    const view = image(TREE, f, assets);
    await waitFor(() => expect(assets.get(KEY)?.s).toBe('loaded'));
    const held = assets.get(KEY);
    if (held?.s !== 'loaded' || held.asset.kind !== 'raster') throw new Error('not a loaded raster');
    expect(held.asset.bytes).toBe(PNG);
    expect(held.asset.mime).toBe('image/png');
    view.unmount();
    expect(assets.get(KEY)).toBeUndefined();
  });

  it('a failed load reports failed', async () => {
    const assets = createExportAssets();
    image(TREE, fakeLoaders(), assets);
    await waitFor(() => expect(assets.get(KEY)).toBe(ASSET_FAILED));
  });

  it("an image whose fingerprint changed is another key, and the old key's bytes are forgotten (M4.EX3)", async () => {
    const drafted = (fp: string) => treeOk({
      entries: [entry('specs', 'a.md', { draft: draftOf('modified') }), entry('specs', 'x.png', { draft: draftOf('modified', { fp }) })],
      drafts: holder(),
    });
    const before = drafted('d'.repeat(64));
    const after = drafted('e'.repeat(64));
    const keyAt = (t: DocsTreeOk): string => {
      const e = t.entries[1]!;
      const d = t.drafts;
      if (d.state !== 'holder' || e.draft === null || e.draft.fp === null) throw new Error('fixture');
      return docsApi.file('demo', { kind: 'draft', branch: d.branch, head: d.worktree.head, section: 'specs', path: 'x.png', fp: e.draft.fp });
    };
    const assets = createExportAssets();
    const f = fakeLoaders();
    f.raster.mockResolvedValue({ s: 'ok', value: { bytes: PNG, mime: DOCS_RASTER_TYPES.png.mime } });
    const view = image(before, f, assets, '/docs/demo/specs/a.md?ref=main');
    await waitFor(() => expect(assets.get(keyAt(before))?.s).toBe('loaded'));
    view.rerenderAt(after);
    await waitFor(() => expect(assets.get(keyAt(after))?.s).toBe('loaded'));
    expect(assets.get(keyAt(before))).toBeUndefined();
  });
});
