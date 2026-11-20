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
import { RangeMarkdown, openedRangePin } from '../src/docs/DocsLeaf';
import { DOC_NOT_UTF8_NOTE } from '../src/docs/DocMarkdown';
import { DOCS_RANGE_TEXT, fillSentence } from '../src/docs/docsText';
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

/** A loader that answers every call from `src`, counting its prepares. */
function servingLoader(src: Uint8Array<ArrayBuffer>, opts: { throws?: boolean } = {}) {
  let prepares = 0;
  const hex = async (b: Uint8Array<ArrayBuffer>): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const b64 = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };
  const loader: RangeLoader = {
    async prepare() {
      prepares += 1;
      if (opts.throws === true) throw new TypeError('a loader fault');
      return { s: 'ok', value: { snapshot: 's'.repeat(32), size: src.length, digest: await hex(src) } };
    },
    async frame(_t, snapshot, offset, length) {
      const part = src.slice(offset, offset + length);
      return { s: 'ok', value: { snapshot, offset, bytesB64: b64(part), digest: await hex(part), total: src.length } };
    },
  };
  return { loader, prepares: () => prepares };
}

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
  type Stat = { kind: 'stat'; size: number; mtimeNs: string };
  const STAT_OLD: Stat = { kind: 'stat', size: 5242880, mtimeNs: '1700000000000000000' };
  const STAT_NEW: Stat = { kind: 'stat', size: 5242881, mtimeNs: '1700000000000000001' };
  const at = (range: Stat): RangeTarget => ({
    project: 'demo', range, size: range.size,
    pin: { kind: 'draft', branch: 'ws/a', head: 'c'.repeat(40), section: 'specs', path: 'big.md', fp: null,
      stat: { size: range.size, mtimeNs: range.mtimeNs } },
  });

  it.each(['draft-changed', 'unknown-commit', 'worktree-moved', 'worktree-gone'] as const)(
    'a %s answer calls relist once, and the next Read it reads the pin the new listing gave',
    async (word) => {
      // A committed doc re-listed after a force-push keeps its blob, so its read key does not move: "Read it" is the
      // way on, and it must send the commit the new listing gave.
      const commits: string[] = [];
      const loader: RangeLoader = {
        async prepare(t) {
          commits.push(t.pin.kind === 'committed' ? t.pin.commit : '');
          return { s: 'failed', body: { ok: false, failure: word } };
        },
        async frame() { throw new Error('no frame'); },
      };
      const relist = vi.fn();
      const withCommit = (c: string): RangeTarget => ({ ...target(5242880), pin: { ...COMMITTED, commit: c.repeat(40) } });
      const props = (t: RangeTarget) => ({ target: t, cls: 'markdown' as const, name: 'big.md', loader, relist });
      const { rerender } = render(<RangeLeaf {...props(withCommit('a'))}>{() => <p>view</p>}</RangeLeaf>);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(relist, 'one re-list for the stale answer').toHaveBeenCalledTimes(1);
      // The re-list gave the leaf a new pin: the same instance sees it through its props.
      rerender(<RangeLeaf {...props(withCommit('e'))}>{() => <p>view</p>}</RangeLeaf>);
      fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.readAgain));
      await waitFor(() => expect(commits).toHaveLength(2));
      expect(commits).toEqual(['a'.repeat(40), 'e'.repeat(40)]);
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(relist, 'a second stale answer does not re-list again').toHaveBeenCalledTimes(1);
    },
  );

  it('a draft re-listed with a new stat pin reads again by itself, with the new pin, and re-lists once', async () => {
    const seen: string[] = [];
    const loader: RangeLoader = {
      async prepare(t) { seen.push(rangeReadKey(t)); return { s: 'failed', body: { ok: false, failure: 'draft-changed' } }; },
      async frame() { throw new Error('no frame'); },
    };
    const relist = vi.fn();
    const props = (t: RangeTarget) => ({ target: t, cls: 'markdown' as const, name: 'big.md', loader, relist });
    const { rerender } = render(<RangeLeaf {...props(at(STAT_OLD))}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(relist).toHaveBeenCalledTimes(1));
    rerender(<RangeLeaf {...props(at(STAT_NEW))}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toBe(rangeReadKey(at(STAT_NEW)));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(relist, 'the stale answer of the new read was the leaf\'s second, and re-lists no more').toHaveBeenCalledTimes(1);
  });

  it('an answer that is not a re-list word never calls relist', async () => {
    const loader: RangeLoader = {
      async prepare() { return { s: 'failed', body: { ok: false, failure: 'snapshot-gone' } }; },
      async frame() { throw new Error('no frame'); },
    };
    const relist = vi.fn();
    render(<RangeLeaf target={at(STAT_OLD)} cls="markdown" name="big.md" loader={loader} relist={relist}>{() => <p>view</p>}</RangeLeaf>);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(relist).not.toHaveBeenCalled();
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
