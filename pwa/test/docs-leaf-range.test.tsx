// X2 P1 Tasks P1.4 and P1.5 (spec 4.3): the leaf's range read and Markdown in parts, as components. `RangeLeaf` reads
// a file above its class cap (or a draft with no fingerprint) by range, with progress and a Cancel, and says plainly when
// a file passes the range ceiling; `MarkdownParts` shows a text above the render gate one part at a time, and opens the
// part a link names, from the pre-pass's heading ids. Placeholders only (`demo`, `specs/...`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES, type DocListPin, type DocPin } from '../../shared/docs';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { DocsLeaf, RangeMarkdown, openedRangePin } from '../src/docs/DocsLeaf';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import { parseMarkdown } from '../src/lib/markdownParse';
import { BLOB_2, draftOf, entry, failedAnswer, fakeLoaders, holder, okTree, pageAt, servingLoader, treeOk } from './docsFixtures';
import { DOC_NOT_UTF8_NOTE } from '../src/docs/DocMarkdown';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsRasterAnswer } from '../src/docs/failures';
import { DOCS_RANGE_TEXT, DOCS_VIEW_TEXT, failureSentence, fillSentence } from '../src/docs/docsText';
import { MarkdownParts } from '../src/docs/range/MarkdownParts';
import { RangeImage, RangeLeaf, rangeReadKey } from '../src/docs/range/RangeLeaf';
import type { RangeLoader, RangeTarget } from '../src/docs/range/readRange';

afterEach(cleanup);

const COMMITTED: DocPin = { kind: 'committed', commit: 'a'.repeat(40), servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'big.bin' };
const target = (size: number): RangeTarget => ({ project: 'demo', pin: COMMITTED, range: { kind: 'blob', sha: 'b'.repeat(40) }, size });

/** A loader that records its calls and never answers a frame until `release` is called. */
function heldLoader() {
  const calls: string[] = [];
  let release: (() => void) | null = null;
  const loader: RangeLoader = {
    async prepare() {
      calls.push('prepare');
      return { s: 'ok', value: { snapshot: 's'.repeat(32), size: 3 * DOCS_RANGE_FRAME_BYTES, digest: 'd'.repeat(64) } };
    },
    frame(_t, _s, offset) {
      calls.push(`frame ${offset}`);
      return new Promise((resolve) => { release = () => resolve({ s: 'failed', body: { ok: false, failure: 'snapshot-gone' } }); });
    },
  };
  return { loader, calls, release: () => release?.() };
}

describe('RangeLeaf', () => {
  it('over ceiling: the sentence names the size and the ceiling, no Download offered', () => {
    const { loader, calls } = heldLoader();
    render(<RangeLeaf target={target(DOCS_RANGE_MAX_BYTES + 16 * 1048576)} cls="markdown" name="big.md" loader={loader}>{() => <p>view</p>}</RangeLeaf>);
    expect(screen.getByRole('status').textContent).toBe('This file is 80 MiB; Docs reads files up to 64 MiB.');
    expect(screen.queryByText('Download')).toBeNull();
    expect(calls, 'nothing is read past the ceiling').toEqual([]);
  });

  it('a file one byte over the ceiling never reads as the ceiling', () => {
    const { loader } = heldLoader();
    render(<RangeLeaf target={target(DOCS_RANGE_MAX_BYTES + 1)} cls="other" name="big.bin" loader={loader} />);
    expect(screen.getByRole('status').textContent).toBe('This file is 64.1 MiB; Docs reads files up to 64 MiB.');
  });

  it('a leaf with a view reads at once, shows its progress, and Cancel drops the read and says nothing was kept', async () => {
    const held = heldLoader();
    render(<RangeLeaf target={target(3 * DOCS_RANGE_FRAME_BYTES)} cls="markdown" name="big.md" loader={held.loader}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(held.calls).toEqual(['prepare', 'frame 0']));
    expect(screen.getByText('Reading 0 MiB of 1.5 MiB…')).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByRole('alert').textContent).toBe('Reading stopped. Nothing was kept.');
    await act(async () => { held.release(); });
    expect(held.calls, 'no request after the cancel').toEqual(['prepare', 'frame 0']);
    expect(screen.queryByText('view')).toBeNull();
  });

  it('a class with no view above its cap offers a Download and reads nothing until it is tapped', () => {
    const held = heldLoader();
    render(<RangeLeaf target={target(5 * 1048576)} cls="other" name="big.bin" loader={held.loader} />);
    expect(screen.getByText('This file is 5 MiB; Docs offers it as a Download.')).toBeTruthy();
    expect(held.calls).toEqual([]);
    fireEvent.click(screen.getByText('Download'));
    expect(screen.getByText('Cancel')).toBeTruthy();
  });
});

const BYTES = new Uint8Array(DOCS_RANGE_FRAME_BYTES + 77).map((_, i) => 65 + (i % 26));

describe('RangeLeaf: one read per read key', () => {
  it('a re-render with an equal but new target object reads nothing again, and the view stays', async () => {
    const s = servingLoader(BYTES);
    const view = (): React.ReactNode => <p>shown</p>;
    const { rerender } = render(<RangeLeaf target={{ ...target(BYTES.length) }} cls="markdown" name="a.md" loader={s.loader}>{view}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
    for (let i = 0; i < 3; i += 1) {
      rerender(<RangeLeaf target={{ ...target(BYTES.length) }} cls="markdown" name="a.md" loader={s.loader}>{() => <p>shown</p>}</RangeLeaf>);
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(s.prepares(), 'one prepare, whatever re-renders').toBe(1);
    expect(screen.getByText('shown')).toBeTruthy();
  });

  it('another doc is another read: keyed by rangeReadKey, a leaf never keeps the last file\'s bytes', async () => {
    const s = servingLoader(BYTES);
    const a = { ...target(BYTES.length) };
    const b: RangeTarget = { ...a, pin: { ...COMMITTED, path: 'b.bin' } };
    expect(rangeReadKey(a)).not.toBe(rangeReadKey(b));
    const { rerender } = render(<RangeLeaf key={rangeReadKey(a)} target={a} cls="markdown" name="a.md" loader={s.loader}>{() => <p>shown</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
    rerender(<RangeLeaf key={rangeReadKey(b)} target={b} cls="other" name="b.bin" loader={s.loader} />);
    expect(screen.getByText(/offers it as a Download/)).toBeTruthy();
  });

  it('Download on tap saves the bytes it read, under the leaf\'s own name', async () => {
    const s = servingLoader(BYTES);
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    try {
      render(<RangeLeaf target={target(BYTES.length)} cls="other" name="b.bin" loader={s.loader} />);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(clicks[0]!.download).toBe('b.bin');
      const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)![0] as Blob;
      expect(blob.size).toBe(BYTES.length);
    } finally {
      spy.mockRestore();
    }
  });

  it('a read that throws says so, never "nothing was kept" as a cancel does', async () => {
    const s = servingLoader(BYTES, { throws: true });
    render(<RangeLeaf target={target(BYTES.length)} cls="markdown" name="a.md" loader={s.loader}>{() => <p>shown</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(DOCS_RANGE_TEXT.threw));
  });
});

describe('RangeLeaf: a stale read re-lists once (X2 P1, review F2)', () => {
  /** The range side of the visit, which owns the one re-list rule: `stale` is what it answers to a failed read. */
  const fakeVisit = (stale: 'relist' | 'changing' | 'other') =>
    ({ rangeFailed: vi.fn((_word: string) => stale), rangeRead: vi.fn(), retryTree: vi.fn() });
  const failing = (word: string, commits: string[]): RangeLoader => ({
    async prepare(t) {
      commits.push(t.pin.kind === 'committed' ? t.pin.commit : '');
      return { s: 'failed', body: { ok: false, failure: word as 'draft-changed' } };
    },
    async frame() { throw new Error('no frame'); },
  });
  const withCommit = (c: string): RangeTarget => ({ ...target(5242880), pin: { ...COMMITTED, commit: c.repeat(40) } });
  const propsOf = (t: RangeTarget, loader: RangeLoader, visit: ReturnType<typeof fakeVisit>) =>
    ({ target: t, cls: 'markdown' as const, name: 'big.md', loader, visit });

  it.each(['draft-changed', 'unknown-commit', 'worktree-moved', 'worktree-gone'] as const)(
    'a %s answer is handed to the visit, and once its re-list gives a new pin the leaf reads it without a tap',
    async (word) => {
      // A committed doc re-listed after a force-push keeps its blob, so its read key does not move: the leaf starts the
      // read itself when the pin it was given changes while a re-list is pending.
      const commits: string[] = [];
      const visit = fakeVisit('relist');
      const loader = failing(word, commits);
      const { rerender } = render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(visit.rangeFailed).toHaveBeenCalledTimes(1);
      expect(visit.rangeFailed).toHaveBeenCalledWith(word);
      rerender(<RangeLeaf {...propsOf(withCommit('e'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
      await waitFor(() => expect(commits).toEqual(['a'.repeat(40), 'e'.repeat(40)]));
    },
  );

  it('once the visit has spent its re-list the failure says the listing changed, and Read it goes through the visit\'s retry', async () => {
    const commits: string[] = [];
    const visit = fakeVisit('changing');
    const loader = failing('draft-changed', commits);
    const { rerender } = render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(DOCS_VIEW_TEXT.changing));
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.readAgain));
    expect(visit.retryTree, 'the tap re-lists; it does not resend the stale pin').toHaveBeenCalledTimes(1);
    expect(commits).toEqual(['a'.repeat(40)]);
    rerender(<RangeLeaf {...propsOf(withCommit('e'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(commits).toEqual(['a'.repeat(40), 'e'.repeat(40)]));
  });

  it('a failure that is no re-list word keeps its own sentence, and Read it reads again at once', async () => {
    const commits: string[] = [];
    const visit = fakeVisit('other');
    const loader = failing('snapshot-gone', commits);
    render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).not.toBe(DOCS_VIEW_TEXT.changing);
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.readAgain));
    await waitFor(() => expect(commits).toHaveLength(2));
    expect(visit.retryTree).not.toHaveBeenCalled();
  });

  it('a read that succeeds tells the visit, which re-arms its one re-list', async () => {
    const s = servingLoader(BYTES);
    const visit = fakeVisit('relist');
    render(<RangeLeaf {...propsOf(target(BYTES.length), s.loader, visit)}>{() => <p>shown</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
    expect(visit.rangeRead).toHaveBeenCalledTimes(1);
    expect(visit.rangeFailed).not.toHaveBeenCalled();
  });
});

describe('DocsLeaf: a changing draft re-lists once (X2 P1, review F2)', () => {
  it('a draft that changes on every listing re-lists once and reads twice at most, then says the listing changed', async () => {
    let listings = 0;
    const MIB5 = 5 * 1048576;
    const treeAt = (n: number) => treeOk({
      drafts: holder(),
      entries: [entry('specs', 'big.md', {
        draft: draftOf('modified', { fp: null, size: MIB5, mtimeNs: String(1700000000000000000n + BigInt(n)) }),
      })],
    });
    const f = fakeLoaders();
    f.tree.mockImplementation(async () => { listings += 1; return okTree(treeAt(listings)); });
    const prepares: string[] = [];
    const rangeLoader: RangeLoader = {
      async prepare(t) { prepares.push(rangeReadKey(t)); return { s: 'failed', body: { ok: false, failure: 'draft-changed' } }; },
      async frame() { throw new Error('no frame'); },
    };
    const located = pageAt('/docs/demo/specs/big.md?ref=main');
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    const page = located;
    const parser = async (src: string) => parseMarkdown(src, 'docs');
    function Harness(): React.ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />;
    }
    render(<Harness />);
    await waitFor(() => expect(prepares.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(prepares.length, 'the first read, and the one read of the re-listed pin').toBeLessThanOrEqual(2);
    expect(listings, 'the visit\'s first listing and its one re-list').toBe(2);
    expect(screen.getByRole('alert').textContent).toBe(DOCS_VIEW_TEXT.changing);
  });
});

/** A PNG of `w` by `h` declared in its IHDR, nothing after it. */
function pngOf(w: number, h: number): Uint8Array<ArrayBuffer> {
  const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...be32(13), 73, 72, 68, 82, ...be32(w), ...be32(h), 8, 6, 0, 0, 0, 0, 0, 0, 0]);
}

describe('RangeImage', () => {
  it('a PNG within the image-view ceilings shows as one object URL of its type, held to the page width, revoked when it goes', async () => {
    const revoke = vi.mocked(URL.revokeObjectURL);
    const shown: DocPin[] = [];
    const { unmount } = render(<RangeImage bytes={pngOf(4000, 3000)} path="specs/p.png" name="p.png" openedPin={COMMITTED} onShown={(pin) => shown.push(pin)} />);
    const img = await screen.findByRole('img');
    expect(img.className).toBe('msg-img');
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(shown, 'the leaf image reports its pin, which Share waits for').toEqual([COMMITTED]);
    const url = img.getAttribute('src');
    unmount();
    expect(revoke.mock.calls.map((c) => c[0])).toContain(url);
  });

  it('an image wider than the side ceiling, or bytes that are not the declared type, show a sentence and no image', () => {
    render(<RangeImage bytes={pngOf(16385, 16)} path="specs/p.png" name="p.png" />);
    expect(screen.getByRole('status').textContent).toBe(fillSentence(DOCS_RANGE_TEXT.imageSide, { w: 16385, h: 16, side: 16384 }));
    expect(screen.queryByRole('img')).toBeNull();
    cleanup();
    render(<RangeImage bytes={pngOf(10, 10)} path="specs/p.gif" name="p.gif" />);
    expect(screen.getByRole('status').textContent).toBe(DOCS_RANGE_TEXT.imageMismatch);
  });
});

describe('RangeMarkdown', () => {
  it('bytes that are not UTF-8 show as the plain view with its note, never an empty page', () => {
    const entry = { section: 'specs' as const, path: 'big.md', committed: { kind: 'file' as const, blob: 'b'.repeat(40), size: 4 }, draft: null };
    const page = { kind: 'path', project: 'demo', ref: null, at: null, view: 'default', section: 'specs', path: 'big.md', dirSlash: false } as never;
    render(
      <RangeMarkdown
        read={{ bytes: new Uint8Array([0x23, 0x20, 0xff, 0x41]), digest: 'd'.repeat(64) }} entry={entry} pin={COMMITTED} page={page}
        link={{} as never} parser={(async () => ({ kind: 'threw' })) as never} reader={null} only={null}
        pendingFragment={null} onFragmentConsumed={() => undefined}
      />,
    );
    expect(screen.getByText(DOC_NOT_UTF8_NOTE)).toBeTruthy();
  });
});

describe('the page pin of a draft read by range', () => {
  it('md parts: a stat-pinned draft\'s page pin carries the snapshot digest as fp', () => {
    const listed: DocListPin = {
      kind: 'draft', branch: 'main', head: 'a'.repeat(40), section: 'specs', path: 'big.md', fp: null,
      stat: { size: 5242880, mtimeNs: '1795125141216123456' },
    };
    expect(openedRangePin(listed, 'e'.repeat(64))).toEqual({ ...listed, fp: 'e'.repeat(64) });
    const fp: DocPin = { kind: 'draft', branch: 'main', head: 'a'.repeat(40), section: 'specs', path: 'big.md', fp: 'f'.repeat(64) };
    expect(openedRangePin(fp, 'e'.repeat(64)), 'a fingerprinted draft keeps its own fp').toBe(fp);
    expect(openedRangePin(COMMITTED, 'e'.repeat(64))).toBe(COMMITTED);
  });
});

describe('MarkdownParts', () => {
  /** Three parts: three sections each a little under the gate, each with its own heading. */
  const section = (n: number): string => `## Part ${n}\n\n` + 'word '.repeat(Math.floor((DOCS_RENDER_GATE_BYTES - 64) / 5)) + '\n\n';
  const TEXT = section(1) + section(2) + section(3);
  const rendered = (ids: string[]): ReaderRenderOutcome => ({
    kind: 'rendered', mermaid: [] as never, images: [], imagesTruncated: false,
    result: { outcome: 'rendered', html: '', meta: { title: null, frontList: null, headings: ids.map((id) => ({ level: 2, id, text: id })), figures: 0, mermaidKinds: [] } },
  });
  const partOf = (src: string): number => Number(/## Part (\d)/.exec(src)?.[1] ?? '0');

  it('shows part 1 of 3 under its bar, and Next shows part 2', () => {
    const seen: number[] = [];
    render(<MarkdownParts text={TEXT} pre={null} fragment={null} renderPart={(part) => { seen.push(part.index); return <p>part {part.index + 1}</p>; }} />);
    expect(screen.getByText('Part 1 of 3')).toBeTruthy();
    expect(screen.getByText('part 1')).toBeTruthy();
    fireEvent.click(screen.getByText('Next part'));
    expect(screen.getByText('Part 2 of 3')).toBeTruthy();
    expect(screen.getByText('part 2')).toBeTruthy();
  });

  it('md parts: a link into part 3 opens part 3, with its fragment', async () => {
    const pre = async (src: string): Promise<ReaderRenderOutcome> => rendered([`part-${partOf(src)}`, partOf(src) === 3 ? 'deep' : 'x']);
    const got: { index: number; fragment: string | null }[] = [];
    render(<MarkdownParts text={TEXT} pre={pre} fragment="deep" renderPart={(part) => { got.push({ index: part.index, fragment: part.fragment }); return <p>part {part.index + 1}</p>; }} />);
    await waitFor(() => expect(screen.getByText('Part 3 of 3')).toBeTruthy());
    expect(screen.getByText('part 3')).toBeTruthy();
    expect(got.at(-1)).toEqual({ index: 2, fragment: 'deep' });
  });

  it('md parts: a part the budget refuses keeps its ids unknown and opens part 1 with a note', async () => {
    const pre = async (src: string): Promise<ReaderRenderOutcome> =>
      partOf(src) === 2 ? { kind: 'not-rendered', why: 'over-limit' } : rendered([`part-${partOf(src)}`]);
    render(<MarkdownParts text={TEXT} pre={pre} fragment="somewhere" renderPart={(part) => <p>part {part.index + 1}</p>} />);
    await waitFor(() => expect(screen.getByText('part 1')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toBe('The place this link names may be in a part Docs could not prepare, so the first part is shown.');
  });
});

// ---- A version page above its class cap reads by range (review Q4) -----------------------------------------------------
// On a version page (`?at=<commit>`) the listing's size is the served commit's, so the file route answers `too-large`,
// and that answer now names the blob of the path at THAT commit: the range read's pin. Without a blob (an older ccd) the
// class cap's sentence stays.
describe('a version page above its class cap reads by range (X2 P1, review Q4)', () => {
  const VERSION = '9'.repeat(40);
  const enc = new TextEncoder();
  const tooLarge = (size: number, blob?: string) => failedAnswer('too-large', { size, cap: 2097152, ...(blob === undefined ? {} : { blob }) });

  /** `url` opened as a leaf on a version page of a listing holding `path`; the file and raster routes answer `answer`, and
   *  every range target the leaf prepares is recorded. */
  function openVersion(path: string, src: Uint8Array<ArrayBuffer>, answer: (size: number) => DocsFileAnswer & DocsRasterAnswer,
    rangeFails: string | null = null) {
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', path)] })) });
    f.file.mockResolvedValue(answer(src.length));
    f.raster.mockResolvedValue(answer(src.length));
    const served = servingLoader(src);
    const targets: RangeTarget[] = [];
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) {
        targets.push(t);
        return rangeFails === null ? served.loader.prepare(t, signal) : failedAnswer(rangeFails);
      },
      frame: (t, snapshot, offset, length, signal) => served.loader.frame(t, snapshot, offset, length, signal),
    };
    const assets: DocsAssetContextValue = { loaders: { file: f.file, raster: f.raster }, queue: createFetchQueue(), onDraftAsset: () => undefined };
    const located = pageAt(`/docs/demo/specs/${path}?at=${VERSION}`);
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    const page = located;
    const parser = async (text: string) => parseMarkdown(text, 'docs');
    function Harness(): React.ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return (
        <DocsAssetContext value={assets}>
          <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />
        </DocsAssetContext>
      );
    }
    return { f, targets, ...render(<Harness />) };
  }

  const versionTarget = (size: number) => ({
    pin: { kind: 'committed', commit: VERSION, servedRef: 'refs/remotes/origin/main', section: 'specs', path: expect.any(String) },
    range: { kind: 'blob', sha: BLOB_2 }, size,
  });

  it('a Markdown page: read by range at the version\'s commit and the blob the answer named, then shown', async () => {
    const src = enc.encode('# Over the cap\n\nbody\n') as Uint8Array<ArrayBuffer>;
    const { targets } = openVersion('big.md', src, (n) => tooLarge(n, BLOB_2));
    expect(await screen.findByRole('heading', { name: 'Over the cap' })).toBeTruthy();
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject(versionTarget(src.length));
  });

  it('a text page: shown as source in parts', async () => {
    const src = enc.encode('abcdefghi\n'.repeat(314573)) as Uint8Array<ArrayBuffer>;
    const { targets, container } = openVersion('big.txt', src, (n) => tooLarge(n, BLOB_2));
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    expect(container.querySelector('pre.doc-plain')?.textContent?.startsWith('abcdefghi\n')).toBe(true);
    expect(targets[0]).toMatchObject(versionTarget(src.length));
  }, 60000);

  it('an image page: shown from the bytes read by range, the raster route asked once', async () => {
    const src = pngOf(4000, 3000);
    const { targets, f, container } = openVersion('big.png', src, (n) => tooLarge(n, BLOB_2));
    await waitFor(() => expect(container.querySelector('img.msg-img')).not.toBeNull());
    expect(container.querySelector('img.msg-img')?.getAttribute('src')).toMatch(/^blob:/);
    expect(f.raster).toHaveBeenCalledTimes(1);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject(versionTarget(src.length));
  });

  it('any other class: the Download, which the file route refused as too large, reads by range and saves the bytes', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    try {
      const { targets } = openVersion('big.bin', src, (n) => tooLarge(n, BLOB_2));
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      expect(targets, 'nothing is read until the Download is tapped').toHaveLength(0);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(clicks[0]!.download).toBe('big.bin');
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject(versionTarget(src.length));
    } finally {
      spy.mockRestore();
    }
  });

  it.each([['an older ccd (no blob)', undefined], ['a blob that is no full sha', 'nope']] as const)(
    '%s: the class cap\'s sentence stays and nothing is read by range', async (_label, blob) => {
      const src = enc.encode('# x\n') as Uint8Array<ArrayBuffer>;
      const answer = (n: number) => tooLarge(n, blob);
      const { targets, container } = openVersion('big.md', src, answer);
      await waitFor(() => expect(container.textContent).toContain(failureSentence(answer(src.length).body)));
      expect(targets).toHaveLength(0);
    });

  it('a refused range read on a version page never re-lists: the visit answers other, the sentence is the failure\'s own', async () => {
    const src = enc.encode('# x\n') as Uint8Array<ArrayBuffer>;
    const { targets, f, container } = openVersion('big.md', src, (n) => tooLarge(n, BLOB_2), 'unknown-commit');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(container.textContent).not.toContain(DOCS_VIEW_TEXT.changing);
    expect(f.tree, 'one listing').toHaveBeenCalledTimes(1);
    expect(targets).toHaveLength(1);
  });
});
