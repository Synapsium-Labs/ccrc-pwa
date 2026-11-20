// X2 P1 Tasks P1.4 and P1.5 (spec 4.3): the leaf's range read and Markdown in parts, as components. `RangeLeaf` reads
// a file above its class cap (or a draft with no fingerprint) by range, with progress and a Cancel, and says plainly when
// a file passes the range ceiling; `MarkdownParts` shows a text above the render gate one part at a time, and opens the
// part a link names, from the pre-pass's heading ids. Placeholders only (`demo`, `specs/...`).
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCS_RANGE_FRAME_BYTES, DOCS_RANGE_MAX_BYTES, type DocPin } from '../../shared/docs';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { openedRangePin } from '../src/docs/DocsLeaf';
import { MarkdownParts } from '../src/docs/range/MarkdownParts';
import { RangeLeaf } from '../src/docs/range/RangeLeaf';
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

describe('the page pin of a draft read by range', () => {
  it('md parts: a stat-pinned draft\'s page pin carries the snapshot digest as fp', () => {
    const listed: DocPin = {
      kind: 'draft', branch: 'main', head: 'a'.repeat(40), section: 'specs', path: 'big.md', fp: null,
      stat: { size: 5242880, mtimeNs: '1795125141216123456' },
    };
    expect(openedRangePin(listed, 'e'.repeat(64))).toEqual({ ...listed, fp: 'e'.repeat(64) });
    const fp: DocPin = { ...listed, fp: 'f'.repeat(64), stat: undefined };
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
