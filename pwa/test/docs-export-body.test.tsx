// Docs W5 Export, Task 6: what a leaf's body shows, published for Export (spec 2026-10-01 4.10 "The settled outcome",
// 4.17; M4.EX15's publication half; refinements (a), (h); the W5h-a hand-off). Each body publishes what it shows
// through `ExportBodyContext`, in an effect, and withdraws it on cleanup: a parsed tree with its text and URL map, a
// plain body with its note, the render gate, a text leaf's text and grammar, or the reader frame. Placeholders only:
// project `demo`, `specs/...`.
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import type { DocsTreeOk } from '../../shared/docs';
import { DOC_MARKDOWN_ACTION, DocMarkdown, docShownAsTextNote, docsPlainNote } from '../src/docs/DocMarkdown';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { DocsLeaf } from '../src/docs/DocsLeaf';
import { ExportBodyContext, type ExportBody } from '../src/docs/exportBody';
import { ReaderFrame, type ReaderDeps } from '../src/docs/ReaderFrame';
import { pinFor, type DocsVisit } from '../src/docs/useDocsVisit';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { entry, fileResponse, pageAt, treeOk, treeResponse } from './docsFixtures';
import { withSyncHighlight } from './highlightTestStore';

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');

/** `node` under an `ExportBodyContext` whose one, stable listener records every publication in order. */
function recording(node: ReactNode): { seen: (ExportBody | null)[]; view: ReturnType<typeof render>; again: (n: ReactNode) => void } {
  const seen: (ExportBody | null)[] = [];
  const publish = (b: ExportBody | null): void => { seen.push(b); };
  const view = render(<ExportBodyContext value={publish}>{node}</ExportBodyContext>);
  return { seen, view, again: (n) => view.rerender(<ExportBodyContext value={publish}>{n}</ExportBodyContext>) };
}

function firstImg(tree: HastRoot): HastElement | undefined {
  const stack = [...tree.children];
  while (stack.length > 0) {
    const n = stack.shift()!;
    if (n.type !== 'element') continue;
    if (n.tagName === 'img') return n;
    stack.unshift(...n.children);
  }
  return undefined;
}

describe("what a leaf's body shows, published for Export (spec 4.10, 4.17; M4.EX15)", () => {
  it('a Markdown page publishes nothing while it formats, then its tree, text and URL map, and withdraws them when it goes', async () => {
    let resolve: (o: ParseOutcome) => void = () => {};
    const slow: MarkdownParser = () => new Promise<ParseOutcome>((r) => { resolve = r; });
    const text = '# A\n\n![x](x.png)\n';
    const { seen, view } = recording(<DocMarkdown text={text} pinKey="p" parser={slow} link={LINK} />);
    await act(async () => { await Promise.resolve(); });
    expect(seen.filter((b) => b !== null)).toEqual([]);
    await act(async () => { resolve(parseMarkdown(text, 'docs')); });
    await waitFor(() => expect(seen.at(-1)?.kind).toBe('tree'));
    const body = seen.at(-1);
    if (body?.kind !== 'tree') throw new Error('not a tree');
    expect(body.text).toBe(text);
    expect(body.link).toBe(LINK);
    const img = firstImg(body.tree);
    expect(img === undefined ? undefined : body.urls.get(img)?.attrs['src']).toBe('x.png');
    view.unmount();
    expect(seen.at(-1)).toBeNull();
  });

  it('a body Docs did not format publishes its text plain, with the note it shows', async () => {
    const timeout: MarkdownParser = async () => ({ kind: 'timeout', budgetMs: 2000 });
    const { seen } = recording(<DocMarkdown text="# A" pinKey="p" parser={timeout} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'plain', text: '# A', note: docsPlainNote({ kind: 'timeout', budgetMs: 2000 }) }));
  });

  it('the render gate publishes the gate; Show as text then publishes the text plain', async () => {
    const big = `# A\n\n${'x'.repeat(DOCS_RENDER_GATE_BYTES)}\n`;
    const { seen } = recording(<DocMarkdown text={big} pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'gate' }));
    fireEvent.click(screen.getByRole('button', { name: DOC_MARKDOWN_ACTION.showAsText }));
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'plain', text: big, note: docShownAsTextNote(utf8ByteLength(big)) }));
  });

  const TEXT_LEAVES: [string, string | null][] = [['a.json', 'json'], ['a.txt', null]];
  it.each(TEXT_LEAVES)('a text leaf (%s) publishes its text and the grammar it matched (%s)', async (path, lang) => {
    const tree: DocsTreeOk = treeOk({ entries: [entry('specs', path)] });
    const page = pageAt(`/docs/demo/specs/${path}`);
    if (page.kind !== 'path') throw new Error('fixture: not a leaf');
    const pin = pinFor(tree, page);
    if (pin === null) throw new Error('fixture: opens nothing');
    const r = fileResponse('{"a":1}\n');
    const visit: DocsVisit = {
      tree: { s: 'ok', answer: treeResponse(tree), receivedAt: 0 },
      file: { s: 'ok', pin, answer: { ...r, contentClass: 'text', show: { ...r.show, path } }, receivedAt: 0 },
      freshness: { s: 'idle' }, updatedTo: null, pendingFragment: null, retryTree: vi.fn(), retryFile: vi.fn(),
      refreshManual: vi.fn(), fetchFromOrigin: vi.fn(), setFragment: vi.fn(),
    };
    const { seen } = recording(withSyncHighlight(<DocsLeaf visit={visit} tree={tree} page={page} parser={parser} />));
    await waitFor(() => expect(seen.at(-1)).toEqual({ kind: 'text', text: '{"a":1}\n', lang }));
  });

  it("while the reader frame shows the leaf it publishes that; a reader that falls back hands over to the plain view's tree (refinement (a))", async () => {
    const show = fileResponse('# A\n').show;
    const frame = (reader: ReaderDeps): ReactNode => (
      <ReaderFrame show={show} bodyKey="k" link={LINK} parser={parser} reader={reader} pendingFragment={null} onFragmentConsumed={() => {}} />
    );
    const pending = { render: () => new Promise(() => {}), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const shown = recording(frame(pending));
    await waitFor(() => expect(shown.seen.at(-1)).toEqual({ kind: 'reader' }));
    shown.view.unmount();
    expect(shown.seen.at(-1)).toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const refusing = { render: async () => ({ kind: 'worker-unavailable' }), mount: vi.fn(), images: vi.fn() } as unknown as ReaderDeps;
    const fell = recording(frame(refusing));
    await waitFor(() => expect(fell.seen.at(-1)?.kind).toBe('tree'));
    vi.restoreAllMocks();
  });

  it('a re-parse withdraws the old tree before the new one lands, so one holder ends on the body on screen (D-7755)', async () => {
    const { seen, again } = recording(<DocMarkdown key="1" text="# A" pinKey="1" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)?.kind).toBe('tree'));
    again(<DocMarkdown key="2" text="# B" pinKey="2" parser={parser} link={LINK} />);
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ kind: 'tree', text: '# B' }));
    const lastA = seen.findLastIndex((b) => b?.kind === 'tree' && b.text === '# A');
    expect(seen[lastA + 1]).toBeNull();
  });
});
