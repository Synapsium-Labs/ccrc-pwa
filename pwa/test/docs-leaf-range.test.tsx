// X2 P1 Tasks P1.4 and P1.5 (spec 4.3): the leaf's range read and Markdown in parts, as components. `RangeLeaf` reads
// a file above its class cap (or a draft with no fingerprint) by range, with progress and a Cancel, and says plainly when
// a file passes the range ceiling; `MarkdownParts` shows a text above the render gate one part at a time, and opens the
// part a link names, from the pre-pass's heading ids. Placeholders only (`demo`, `specs/...`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { StrictMode, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES, type DocListPin, type DocPin } from '../../shared/docs';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { DocsLeaf, RangeMarkdown, openedRangePin } from '../src/docs/DocsLeaf';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import { parseMarkdown } from '../src/lib/markdownParse';
import {
  BLOB_2, NO_RANGE_VISIT, draftOf, entry, failedAnswer, fakeLoaders, holder, okTree, pageAt, recordingRejections, servingLoader, treeOk,
} from './docsFixtures';
import { DOC_NOT_UTF8_NOTE } from '../src/docs/DocMarkdown';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsRasterAnswer } from '../src/docs/failures';
import { DOCS_RANGE_TEXT, DOCS_VIEW_TEXT, failureSentence, fillSentence, mib } from '../src/docs/docsText';
import { MarkdownParts } from '../src/docs/range/MarkdownParts';
import { RangeImage, RangeLeaf as RangeLeafOf, rangeReadKey } from '../src/docs/range/RangeLeaf';
import type { RangeLoader, RangeTarget } from '../src/docs/range/readRange';

afterEach(cleanup);

/** `RangeLeaf` with a visit that does nothing about a stale read, unless a test gives one. */
function RangeLeaf(p: Omit<ComponentProps<typeof RangeLeafOf>, 'visit'> & { readonly visit?: ComponentProps<typeof RangeLeafOf>['visit'] }): React.ReactNode {
  return <RangeLeafOf {...p} visit={p.visit ?? NO_RANGE_VISIT} />;
}

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
    ({
      rangeFailed: vi.fn((_word: string) => stale), rangeRead: vi.fn(), rangeRetry: vi.fn(), rangeRelists: 0,
      rangeWaiting: false,
    });
  /** The same visit after a re-list that started after the failure has answered (its counter moved). */
  const afterRelist = (v: ReturnType<typeof fakeVisit>) => ({ ...v, rangeRelists: v.rangeRelists + 1 });
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
    'a %s answer is handed to the visit, the leaf loads while the re-list runs, and reads again when it answers with a new pin',
    async (word) => {
      // A committed doc re-listed after a force-push keeps its blob, so its read key does not move: the leaf starts the
      // read itself when the visit's counter says the re-list answered.
      const commits: string[] = [];
      const visit = fakeVisit('relist');
      const loader = failing(word, commits);
      const { rerender } = render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
      await waitFor(() => expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy());
      expect(screen.queryByRole('alert'), 'no "listing changed" while the re-list runs').toBeNull();
      expect(visit.rangeFailed).toHaveBeenCalledTimes(1);
      expect(visit.rangeFailed).toHaveBeenCalledWith(word);
      rerender(<RangeLeaf {...propsOf(withCommit('e'), loader, afterRelist(visit))}>{() => <p>view</p>}</RangeLeaf>);
      await waitFor(() => expect(commits).toEqual(['a'.repeat(40), 'e'.repeat(40)]));
    },
  );

  it('a re-list that answers with the SAME pin reads again too (a worktree that moved and came back)', async () => {
    const commits: string[] = [];
    const visit = fakeVisit('relist');
    const loader = failing('worktree-moved', commits);
    const { rerender } = render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy());
    rerender(<RangeLeaf {...propsOf(withCommit('a'), loader, afterRelist(visit))}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(commits).toEqual(['a'.repeat(40), 'a'.repeat(40)]));
  });

  it('once the visit has spent its re-list the failure says the listing changed, and Read it re-lists through the visit and waits', async () => {
    const commits: string[] = [];
    const visit = fakeVisit('changing');
    const loader = failing('draft-changed', commits);
    const { rerender } = render(<RangeLeaf {...propsOf(withCommit('a'), loader, visit)}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(DOCS_VIEW_TEXT.changing));
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.readAgain));
    expect(visit.rangeRetry, 'the tap re-lists; it does not resend the stale pin').toHaveBeenCalledTimes(1);
    expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy();
    expect(commits).toEqual(['a'.repeat(40)]);
    rerender(<RangeLeaf {...propsOf(withCommit('a'), loader, afterRelist(visit))}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(commits).toEqual(['a'.repeat(40), 'a'.repeat(40)]));
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
    expect(visit.rangeRetry).not.toHaveBeenCalled();
  });

  it('a read that succeeds tells the visit, which re-arms its one re-list', async () => {
    const s = servingLoader(BYTES);
    const visit = fakeVisit('relist');
    render(<RangeLeaf {...propsOf(target(BYTES.length), s.loader, visit)}>{() => <p>shown</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
    expect(visit.rangeRead).toHaveBeenCalledTimes(1);
    expect(visit.rangeFailed).not.toHaveBeenCalled();
  });

  /** A loader whose first prepares answer `words` (refusals), then serves `BYTES`; `calls` counts its prepares. */
  const refusesThenServes = (words: string[]) => {
    const s = servingLoader(BYTES);
    const calls: number[] = [];
    const loader: RangeLoader = {
      async prepare(t, signal) {
        const w = words[calls.length];
        calls.push(calls.length);
        return w !== undefined ? failedAnswer(w) : s.loader.prepare(t, signal);
      },
      frame: (t, snapshot, offset, length, signal) => s.loader.frame(t, snapshot, offset, length, signal),
    };
    return { loader, calls };
  };
  const saves = (): { clicks: HTMLAnchorElement[]; restore: () => void } => {
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    return { clicks, restore: () => spy.mockRestore() };
  };

  /** The note a Download a re-list interrupted shows: the fact, then the way on. */
  const AGAIN = DOCS_VIEW_TEXT.changing + ' ' + DOCS_VIEW_TEXT.tapDownloadAgain;

  it('a Download-only leaf whose read meets a re-list never saves on its own: the note and its Download show, and a new tap saves once', async () => {
    const { clicks, restore } = saves();
    try {
      const visit = fakeVisit('relist');
      const { loader, calls } = refusesThenServes(['unknown-commit']);
      const props = (v: typeof visit) => ({ target: target(BYTES.length), cls: 'other' as const, name: 'b.bin', loader, visit: v });
      const { rerender } = render(<RangeLeaf {...props(visit)} />);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy());
      rerender(<RangeLeaf {...props(afterRelist(visit))} />);
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(AGAIN));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(clicks, 'no unprompted save').toHaveLength(0);
      expect(calls, 'nothing read after the re-list').toHaveLength(1);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(clicks[0]!.download).toBe('b.bin');
      expect(calls).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('a leaf with a view whose Download tap meets a re-list reads again to show the document, never saves on its own, and a new tap saves once', async () => {
    const { clicks, restore } = saves();
    try {
      const visit = fakeVisit('other');
      visit.rangeFailed.mockReturnValueOnce('other').mockReturnValueOnce('relist');
      const { loader, calls } = refusesThenServes(['snapshot-gone', 'unknown-commit']);
      const props = (v: typeof visit) => ({ target: target(BYTES.length), cls: 'markdown' as const, name: 'a.md', loader, visit: v });
      const { rerender } = render(<RangeLeaf {...props(visit)}>{() => <p>shown</p>}</RangeLeaf>);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy());
      rerender(<RangeLeaf {...props(afterRelist(visit))}>{() => <p>shown</p>}</RangeLeaf>);
      await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(clicks, 'no unprompted save').toHaveLength(0);
      expect(calls).toHaveLength(3);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
    } finally {
      restore();
    }
  });

  it('saveOnOpen: a view-less leaf reads and saves as it opens, once even under StrictMode', async () => {
    const { clicks, restore } = saves();
    try {
      const { loader, calls } = refusesThenServes([]);
      render(<StrictMode><RangeLeaf target={target(BYTES.length)} cls="other" name="b.bin" loader={loader} saveOnOpen /></StrictMode>);
      await waitFor(() => expect(clicks).toHaveLength(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(clicks, 'saved once').toHaveLength(1);
      // StrictMode's first mount began a read that its cleanup aborted, and the second mount's read is the one that saved.
      expect(calls, 'two reads begun, one saved').toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('a Download tap while the page waits for a re-list waits, then shows the note and its Download without saving; a new tap saves once', async () => {
    const { clicks, restore } = saves();
    try {
      const visit = { ...fakeVisit('other'), rangeWaiting: true };
      const { loader, calls } = refusesThenServes([]);
      const props = (v: typeof visit) => ({ target: target(BYTES.length), cls: 'other' as const, name: 'b.bin', loader, visit: v });
      const { rerender } = render(<RangeLeaf {...props(visit)} />);
      fireEvent.click(screen.getByText('Download'));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(calls, 'the stale pin is not read').toHaveLength(0);
      expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy();
      rerender(<RangeLeaf {...props({ ...visit, rangeWaiting: false, rangeRelists: 1 })} />);
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(AGAIN));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(clicks, 'no unprompted save').toHaveLength(0);
      expect(calls).toHaveLength(0);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(calls).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('a leaf that mounts while its page has a re-list pending waits for it, and reads when it answers', async () => {
    const visit = { ...fakeVisit('other'), rangeWaiting: true };
    const { loader, calls } = refusesThenServes([]);
    const { rerender } = render(<RangeLeaf {...propsOf(target(BYTES.length), loader, visit)}>{() => <p>shown</p>}</RangeLeaf>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(calls, 'no read on the stale pin').toHaveLength(0);
    expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeTruthy();
    rerender(<RangeLeaf {...propsOf(target(BYTES.length), loader, { ...visit, rangeWaiting: false, rangeRelists: 1 })}>{() => <p>shown</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByText('shown')).toBeTruthy());
    expect(calls).toHaveLength(1);
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
    expect(prepares.length, 'the first read, and the one read of the re-listed pin').toBe(2);
    expect(listings, 'the visit\'s first listing and its one re-list').toBe(2);
    expect(screen.getByRole('alert').textContent).toBe(DOCS_VIEW_TEXT.changing);
  });

  it('a re-list that gives back the SAME pin reads again and shows the document (the worktree moved and came back)', async () => {
    // A stat-pinned draft of 20 bytes: the pin is branch, head, section, path and stat, so a re-list gives the same one.
    const text = '# Title\n\nbody words\n';
    const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
    const tree = treeOk({
      drafts: holder(),
      entries: [entry('specs', 'big.md', { draft: draftOf('modified', { fp: null, size: bytes.length, mtimeNs: '1700000000000000000' }) })],
    });
    const f = fakeLoaders();
    f.tree.mockImplementation(async () => okTree(tree));
    const served = servingLoader(bytes);
    let first = true;
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) {
        if (first) { first = false; return { s: 'failed', body: { ok: false, failure: 'worktree-moved' } }; }
        return served.loader.prepare(t, signal);
      },
      frame: (...a) => served.loader.frame(...a),
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
    const { container } = render(<Harness />);
    await waitFor(() => expect(container.textContent).toContain('body words'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(f.tree, 'the first listing and the one re-list').toHaveBeenCalledTimes(2);
  });

  it('a listing already in flight when the failure lands does not spend the one re-list: the next one that starts answers it', async () => {
    const text = '# Title\n\nbody words\n';
    const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
    const tree = treeOk({
      drafts: holder(),
      entries: [entry('specs', 'big.md', { draft: draftOf('modified', { fp: null, size: bytes.length, mtimeNs: '1700000000000000000' }) })],
    });
    const f = fakeLoaders();
    let release: (() => void) | null = null;
    let calls = 0;
    f.tree.mockImplementation(() => {
      calls += 1;
      // The second listing is held: it is the one in flight when the failure lands.
      if (calls === 2) return new Promise((resolve) => { release = () => resolve(okTree(tree)); });
      return Promise.resolve(okTree(tree));
    });
    const served = servingLoader(bytes);
    let first = true;
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) {
        if (first) {
          first = false;
          // A listing (the stale timer, a tab return) is already in flight when the refusal lands.
          const held = visitRef.current;
          held?.retryTree();
          await new Promise((r) => setTimeout(r, 0));
          return { s: 'failed', body: { ok: false, failure: 'worktree-gone' } };
        }
        return served.loader.prepare(t, signal);
      },
      frame: (...a) => served.loader.frame(...a),
    };
    const visitRef: { current: ReturnType<typeof useDocsVisit> | null } = { current: null };
    const located = pageAt('/docs/demo/specs/big.md?ref=main');
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    const page = located;
    const parser = async (src: string) => parseMarkdown(src, 'docs');
    function Harness(): React.ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      visitRef.current = visit;
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />;
    }
    const { container } = render(<Harness />);
    await waitFor(() => expect(calls).toBe(2));
    // Let the failure land while the held listing is in flight, then answer the held listing.
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container.textContent, 'the stale listing did not serve the wait').not.toContain('body words');
    await act(async () => { release?.(); });
    await waitFor(() => expect(container.textContent).toContain('body words'));
    expect(calls, 'the held listing, and the one that started after the failure').toBe(3);
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
    rangeFails: string | null = null, atVersion = true) {
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
    const located = pageAt(`/docs/demo/specs/${path}${atVersion ? `?at=${VERSION}` : ''}`);
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

  it('any other class: the Download the file route refused as too large hands the leaf the size and blob, and the leaf\'s one range Download reads and saves', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    try {
      const { targets, f } = openVersion('big.bin', src, (n) => tooLarge(n, BLOB_2));
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      expect(targets, 'nothing is read until a Download is tapped').toHaveLength(0);
      // One tap: the file route's answer is the probe, and the leaf it hands over reads by range and saves at once.
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(clicks[0]!.download).toBe('big.bin');
      expect(f.file, 'the probe asked the file route once').toHaveBeenCalledTimes(1);
      expect(targets).toHaveLength(1);
      expect(targets[0]).toMatchObject(versionTarget(src.length));
      await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
      expect(clicks, 'saved once').toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('any other class: a Download over the range ceiling says so and reads nothing (the one owner\'s check)', async () => {
    const src = new Uint8Array([1]) as Uint8Array<ArrayBuffer>;
    const { targets } = openVersion('big.bin', src, () => tooLarge(DOCS_RANGE_MAX_BYTES + 1, BLOB_2));
    await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
    fireEvent.click(screen.getByText('Download'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(
      fillSentence(DOCS_RANGE_TEXT.overCeiling, { size: mib(DOCS_RANGE_MAX_BYTES + 1), cap: mib(DOCS_RANGE_MAX_BYTES) })));
    expect(targets).toHaveLength(0);
  });

  it('a default page: a Download refused as too large says its failure, and the version arm does not apply', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const answer = (n: number) => tooLarge(n, BLOB_2);
    const { targets } = openVersion('big.bin', src, answer, null, false);
    await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
    fireEvent.click(screen.getByText('Download'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(failureSentence(answer(src.length).body)));
    expect(targets).toHaveLength(0);
    expect(screen.queryByText(DOCS_RANGE_TEXT.cancel)).toBeNull();
  });

  it('an image page from an older ccd (no blob): the image\'s own sentence, the raster route asked once, nothing read by range', async () => {
    const src = pngOf(4000, 3000);
    const answer = (n: number) => tooLarge(n);
    const { targets, f, container } = openVersion('big.png', src, answer);
    await waitFor(() => expect(container.querySelector('.doc-img-failed')).not.toBeNull());
    expect(container.querySelector('.doc-img-failed')?.textContent).toBe(failureSentence(answer(src.length).body));
    expect(f.raster).toHaveBeenCalledTimes(1);
    expect(targets).toHaveLength(0);
    expect(container.querySelector('img')).toBeNull();
  });

  it('a Download from an older ccd (no blob): the failure\'s own sentence under the button, nothing read by range', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const answer = (n: number) => tooLarge(n);
    const { targets } = openVersion('big.bin', src, answer);
    await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
    fireEvent.click(screen.getByText('Download'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      fillSentence(DOCS_VIEW_TEXT.downloadFailed, { sentence: failureSentence(answer(src.length).body) })));
    expect(targets).toHaveLength(0);
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

describe('a save answers only its own tap (X2 P1, review F2)', () => {
  const clickSpy = (): { clicks: HTMLAnchorElement[]; restore: () => void } => {
    const clicks: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this); });
    return { clicks, restore: () => spy.mockRestore() };
  };
  const parser = async (text: string) => parseMarkdown(text, 'docs');
  const leafOf = (url: string) => {
    const located = pageAt(url);
    if (located.kind !== 'path') throw new Error('fixture: not a leaf');
    return located;
  };

  it('a version page told by a Download tap saves once: going to another page and back does not save again', async () => {
    const VERSION = '9'.repeat(40);
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.bin'), entry('specs', 'b.bin')] })) });
    f.file.mockResolvedValue(failedAnswer('too-large', { size: src.length, cap: 2097152, blob: BLOB_2 }));
    const served = servingLoader(src);
    const targets: RangeTarget[] = [];
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) { targets.push(t); return served.loader.prepare(t, signal); },
      frame: (t, snapshot, offset, length, signal) => served.loader.frame(t, snapshot, offset, length, signal),
    };
    const assets: DocsAssetContextValue = { loaders: { file: f.file, raster: f.raster }, queue: createFetchQueue(), onDraftAsset: () => undefined };
    function Harness(p: { page: ReturnType<typeof leafOf> }): React.ReactNode {
      const visit = useDocsVisit(p.page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return (
        <DocsAssetContext value={assets}>
          <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={p.page} parser={parser} rangeLoader={rangeLoader} />
        </DocsAssetContext>
      );
    }
    const A = leafOf(`/docs/demo/specs/a.bin?at=${VERSION}`);
    const B = leafOf(`/docs/demo/specs/b.bin?at=${VERSION}`);
    const { clicks, restore } = clickSpy();
    try {
      const { rerender } = render(<Harness page={A} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      rerender(<Harness page={B} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      rerender(<Harness page={A} />);
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(clicks, 'one tap, one save').toHaveLength(1);
      expect(targets).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('a late Download answer for a page left behind is dropped: coming back saves nothing, a direct tap saves once', async () => {
    const VERSION = '9'.repeat(40);
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'a.bin'), entry('specs', 'b.bin')] })) });
    let land: (() => void) | null = null;
    const tooLargeAnswer = failedAnswer('too-large', { size: src.length, cap: 2097152, blob: BLOB_2 });
    f.file.mockImplementationOnce(() => new Promise((resolve) => { land = () => resolve(tooLargeAnswer); }));
    f.file.mockResolvedValue(tooLargeAnswer);
    const served = servingLoader(src);
    const assets: DocsAssetContextValue = { loaders: { file: f.file, raster: f.raster }, queue: createFetchQueue(), onDraftAsset: () => undefined };
    function Harness(p: { page: ReturnType<typeof leafOf> }): React.ReactNode {
      const visit = useDocsVisit(p.page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return (
        <DocsAssetContext value={assets}>
          <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={p.page} parser={parser} rangeLoader={served.loader} />
        </DocsAssetContext>
      );
    }
    const A = leafOf(`/docs/demo/specs/a.bin?at=${VERSION}`);
    const B = leafOf(`/docs/demo/specs/b.bin?at=${VERSION}`);
    const { clicks, restore } = clickSpy();
    try {
      const { rerender } = render(<Harness page={A} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(land).not.toBeNull());
      rerender(<Harness page={B} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      await act(async () => { land?.(); await new Promise((r) => setTimeout(r, 20)); });
      rerender(<Harness page={A} />);
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(clicks, 'a late answer for a page left behind saves nothing').toHaveLength(0);
      expect(screen.getByText('Download')).toBeTruthy();
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(clicks, 'a direct tap saves exactly once').toHaveLength(1);
    } finally {
      restore();
    }
  });

  /** A stat-pinned draft of `bytes` whose stat moves on every listing: `n` listings so far. */
  const movingDraft = (path: string, size: number) => {
    let listings = 0;
    const treeAt = () => treeOk({
      drafts: holder(),
      entries: [entry('specs', path, { draft: draftOf('modified', { fp: null, size, mtimeNs: String(1700000000000000000n + BigInt(listings)) }) })],
    });
    const f = fakeLoaders();
    f.tree.mockImplementation(async () => { listings += 1; return okTree(treeAt()); });
    return { f, listingCount: () => listings };
  };

  it('a Download whose re-list changes the read key (a new stat pin) never saves on its own after the remount; a new tap saves once', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const { f } = movingDraft('big.bin', src.length);
    const served = servingLoader(src);
    let first = true;
    const prepares: string[] = [];
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) {
        prepares.push(rangeReadKey(t));
        if (first) { first = false; return failedAnswer('draft-changed'); }
        return served.loader.prepare(t, signal);
      },
      frame: (t, snapshot, offset, length, signal) => served.loader.frame(t, snapshot, offset, length, signal),
    };
    const page = leafOf('/docs/demo/specs/big.bin?ref=main');
    function Harness(): React.ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />;
    }
    const { clicks, restore } = clickSpy();
    try {
      render(<Harness />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      fireEvent.click(screen.getByText('Download'));
      // The re-list moved the read key, so the leaf was remounted: it is a fresh Download-only leaf, and nothing saves.
      await waitFor(() => expect(f.tree).toHaveBeenCalledTimes(2));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(screen.getByText('Download'), 'its Download shows').toBeTruthy();
      expect(clicks, 'no unprompted save').toHaveLength(0);
      expect(prepares, 'only the refused read so far').toHaveLength(1);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      expect(prepares[1]).not.toBe(prepares[0]);
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(clicks, 'the new tap saved once').toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('a re-list released after leaving the page does not save when the page is opened again: its Download shows and a tap saves once', async () => {
    const src = new Uint8Array([1, 2, 3, 4]) as Uint8Array<ArrayBuffer>;
    const draftAt = (path: string) => entry('specs', path, { draft: draftOf('modified', { fp: null, size: src.length, mtimeNs: '1700000000000000000' }) });
    const tree = treeOk({ drafts: holder(), entries: [draftAt('a.bin'), draftAt('b.bin')] });
    const f = fakeLoaders();
    let calls = 0;
    let release: (() => void) | null = null;
    f.tree.mockImplementation(() => {
      calls += 1;
      // The re-list (the second listing) is held until the page has been left.
      if (calls === 2) return new Promise((resolve) => { release = () => resolve(okTree(tree)); });
      return Promise.resolve(okTree(tree));
    });
    const served = servingLoader(src);
    let refused = false;
    const prepares: string[] = [];
    const rangeLoader: RangeLoader = {
      async prepare(t, signal) {
        prepares.push(t.pin.path);
        if (t.pin.path === 'a.bin' && !refused) { refused = true; return failedAnswer('worktree-moved'); }
        return served.loader.prepare(t, signal);
      },
      frame: (t, snapshot, offset, length, signal) => served.loader.frame(t, snapshot, offset, length, signal),
    };
    function Harness(p: { page: ReturnType<typeof leafOf> }): React.ReactNode {
      const visit = useDocsVisit(p.page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={p.page} parser={parser} rangeLoader={rangeLoader} />;
    }
    const A = leafOf('/docs/demo/specs/a.bin?ref=main');
    const B = leafOf('/docs/demo/specs/b.bin?ref=main');
    const { clicks, restore } = clickSpy();
    try {
      const { rerender } = render(<Harness page={A} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(calls).toBe(2));
      rerender(<Harness page={B} />);
      await waitFor(() => expect(screen.getByText('Download')).toBeTruthy());
      await act(async () => { release?.(); });
      rerender(<Harness page={A} />);
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(screen.getByText('Download'), 'its Download shows').toBeTruthy();
      expect(clicks, 'no unprompted save').toHaveLength(0);
      fireEvent.click(screen.getByText('Download'));
      await waitFor(() => expect(clicks).toHaveLength(1));
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(clicks, 'the tap saved once').toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('a tree listing that rejects releases the waiting read as a failure: "changing" with Read it, never Loading for good', async () => {
    const text = '# T\n\nbody\n';
    const bytes = new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;
    const tree = treeOk({
      drafts: holder(),
      entries: [entry('specs', 'big.md', { draft: draftOf('modified', { fp: null, size: bytes.length, mtimeNs: '1700000000000000000' }) })],
    });
    const f = fakeLoaders();
    let calls = 0;
    f.tree.mockImplementation(async () => { calls += 1; if (calls === 2) throw new Error('listing failed'); return okTree(tree); });
    const rangeLoader: RangeLoader = {
      async prepare() { return failedAnswer('worktree-moved'); },
      async frame() { throw new Error('no frame'); },
    };
    const page = leafOf('/docs/demo/specs/big.md?ref=main');
    function Harness(): React.ReactNode {
      const visit = useDocsVisit(page, f.loaders);
      if (visit.tree?.s !== 'ok') return null;
      return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={rangeLoader} />;
    }
    const seen = await recordingRejections(async () => {
      render(<Harness />);
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(DOCS_VIEW_TEXT.changing), { timeout: 3000 });
    });
    expect(seen).toHaveLength(1);
    expect(screen.getByText(DOCS_RANGE_TEXT.readAgain)).toBeTruthy();
    expect(screen.queryByText(DOCS_VIEW_TEXT.loading)).toBeNull();
  });
});
