// The Docs side of the worker path (native Docs reader, W5h-a Task 7; base spec 2026-10-01 section 4.10 "CodeBlock" and
// "The store", section 4.4 "The text leaf"; M4.H16, M4.H19 Docs half; the Export hand-off). The real store over
// in-thread highlighters that answer when the test releases them: a Docs page's block and a text leaf render plain
// first and are coloured when the worker answers; their stores go to the Docs highlighter only; each is published
// through `HighlighterContext`'s `publish` slot with its `settled()`, which is what Export reads (refinement (h)); the
// Docs screen prewarms the Docs highlighter.
import { useContext, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { DocMarkdown } from '../src/docs/DocMarkdown';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { HIGHLIGHTER_DEFAULT, HighlighterContext, createProductionStore, type HighlighterContextValue } from '../src/lib/highlighterContext';
import type { HighlightStore } from '../src/lib/highlightStore';
import { parseMarkdown } from '../src/lib/markdownParse';
import { chatHighlighter, docsHighlighter, type MarkdownParser } from '../src/lib/markdownRunner';
import { DocsScreen } from '../src/screens/DocsScreen';
import { HLJS } from '../src/lib/highlightGrammars';
import type { Highlighter, HighlightOutcome, HighlightRequest } from '../src/lib/highlightProtocol';
import { HIGHLIGHT_BLOCK_DEADLINE_MS, MD_HIGHLIGHT_MAX_HTML_CHARS } from '../src/lib/markdownLimits';
import { entry, fakeLoaders, fileResponse, okTree, treeOk } from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

afterEach(cleanup);

const SRC = '# T\n\n```ts\nconst a = 1;\n```\n';
const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => undefined,
} as Omit<DocLinkContextValue, 'urls'>;
const under = (ctx: HighlighterContextValue, node: ReactNode): ReactNode => <HighlighterContext value={ctx}>{node}</HighlighterContext>;

/** A Docs screen on the text leaf `specs/x.ts`, its file `text`. */
function textLeaf(ctx: HighlighterContextValue, text: string) {
  const r = fileResponse(text);
  const f = fakeLoaders({ tree: okTree(treeOk({ entries: [entry('specs', 'x.ts')] })), file: { s: 'ok', value: { ...r, contentClass: 'text', show: { ...r.show, path: 'x.ts', size: text.length } } } });
  return render(under(ctx, <DocsScreen path="/docs/demo/specs/x.ts" search="" loaders={f.loaders} parser={parser} reader={null} />));
}

describe('M4.H16: plain first frame on the Docs side', () => {
  it('a Docs page\'s block: plain, same text and label, until the worker answers; then spans, text unchanged', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const { container } = render(under(inThreadContext(docs), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(container.querySelector('article .code-block code.hljs')).not.toBeNull());
    const pre = container.querySelector('article pre')!;
    expect(pre.textContent).toBe('const a = 1;');
    expect(container.querySelector('[class^="hljs-"]')).toBeNull();
    expect(container.querySelector('.code-block-lang')?.textContent).toBe('TypeScript');
    await act(async () => { docs.release(); });
    await waitFor(() => expect(container.querySelector('article .hljs-keyword')?.textContent).toBe('const'));
    expect(pre.textContent).toBe('const a = 1;');
  });

  it('a text leaf: plain first, then coloured, on the Docs highlighter', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const { container } = textLeaf(inThreadContext(docs), 'const b = 2;');
    await waitFor(() => expect(container.querySelector('.docs-leaf .code-block code.hljs')?.textContent).toBe('const b = 2;'));
    expect(container.querySelector('.docs-leaf [class^="hljs-"]')).toBeNull();
    await act(async () => { docs.release(); });
    await waitFor(() => expect(container.querySelector('.docs-leaf .hljs-keyword')?.textContent).toBe('const'));
  });
});

describe('M4.H19 (Docs half): a Docs page\'s and a text leaf\'s requests go to the Docs highlighter only', () => {
  it('neither asks the chat highlighter', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const chat = inThreadHighlighter({ hold: true });
    const page = render(under(inThreadContext(docs, chat), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(docs.calls).toHaveLength(1));
    page.unmount();
    textLeaf(inThreadContext(docs, chat), 'const c = 3;');
    await waitFor(() => expect(docs.calls).toHaveLength(2));
    expect(chat.calls).toHaveLength(0);
  });

  it('the Docs screen prewarms the Docs highlighter on mount', () => {
    const docs = inThreadHighlighter();
    const prewarm = vi.spyOn(docs, 'prewarm');
    render(under(inThreadContext(docs), <DocsScreen path="/docs" search="" loaders={fakeLoaders().loaders} parser={parser} reader={null} />));
    expect(prewarm).toHaveBeenCalled();
  });
});

describe('the Export hand-off: the store is published with its settled()', () => {
  it('a Docs page publishes its seeded store, not settled until the block is answered, and withdraws it on unmount', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const published: (HighlightStore | null)[] = [];
    const { unmount } = render(under(inThreadContext(docs, undefined, (s) => published.push(s)), <DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(published.at(-1)).toBeTruthy());
    const store = published.at(-1)!;
    const k = store.keyOf('ts', 'const a = 1;');
    expect(k.kind).toBe('key');
    expect(store.settled()).toBe(false);
    await act(async () => { docs.release(); });
    await waitFor(() => expect(store.settled()).toBe(true));
    expect(store.peek((k as { key: string }).key).kind).toBe('html');
    unmount();
    expect(published.at(-1)).toBeNull();
  });

  it('a text leaf publishes its one-block store the same way', async () => {
    const docs = inThreadHighlighter({ hold: true });
    const published: (HighlightStore | null)[] = [];
    textLeaf(inThreadContext(docs, undefined, (s) => published.push(s)), 'const d = 4;');
    await waitFor(() => expect(published.at(-1)).toBeTruthy());
    const store = published.at(-1)!;
    expect(store.settled()).toBe(false);
    await act(async () => { docs.release(); });
    await waitFor(() => expect(store.settled()).toBe(true));
  });
});

/** A highlighter the test answers request by request (`answer(i, outcome)`), posting each first. */
function scripted(): Highlighter & { readonly calls: HighlightRequest[]; answer(i: number, o: HighlightOutcome): void } {
  const calls: HighlightRequest[] = [];
  const waiting: { readonly onPosted?: () => void; readonly resolve: (o: HighlightOutcome) => void }[] = [];
  return {
    calls,
    highlight: (req, o) => new Promise<HighlightOutcome>((resolve) => {
      calls.push(req);
      waiting.push({ onPosted: o.onPosted, resolve });
    }),
    status: () => 'live',
    prewarm: () => undefined,
    answer: (i, outcome) => {
      waiting[i]!.onPosted?.();
      waiting[i]!.resolve(outcome);
    },
  };
}
const coloured = (code: string, mode: 'block' | 'line' = 'block'): HighlightOutcome =>
  ({ kind: 'html', html: HLJS.highlight(code, { language: 'ts', ignoreIllegals: true }).value, mode });
const labels = (c: HTMLElement): string[] => [...c.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? '');
/** A ts fence of 30 lines: over the line retry's unit. */
const LONG = 'const a = 1;\n'.repeat(30).replace(/\n$/, '');

describe('the page halves of M4.H7, M4.H13 and M4.H18: what a block left plain, or coloured line by line, says', () => {
  it('M4.H7: of three blocks whose second times out, the first and third are coloured and only the second is plain', async () => {
    const h = scripted();
    const src = '```ts\nconst a = 1;\n```\n\n```ts\nconst b = 2;\n```\n\n```ts\nconst c = 3;\n```\n';
    const { container } = render(under(inThreadContext(h), <DocMarkdown text={src} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(h.calls).toHaveLength(3));
    await act(async () => {
      h.answer(0, coloured('const a = 1;'));
      h.answer(1, { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS });
      h.answer(2, coloured('const c = 3;'));
    });
    await waitFor(() => expect(container.querySelectorAll('.hljs-keyword')).toHaveLength(2));
    expect([...container.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length)).toEqual([1, 0, 1]);
    expect(labels(container)).toEqual(['TypeScript', `TypeScript · not highlighted (took over ${HIGHLIGHT_BLOCK_DEADLINE_MS / 1000} s)`, 'TypeScript']);
  });

  it('M4.H13: an answer over the per-block HTML cap, whose line retry is too large as well, says "output too large"', async () => {
    const h = scripted();
    const { container } = render(under(inThreadContext(h), <DocMarkdown text={`\`\`\`ts\n${LONG}\n\`\`\`\n`} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    await act(async () => { h.answer(0, { kind: 'html', html: 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS + 1), mode: 'block' }); });
    await waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls[1]!.mode).toBe('line');
    await act(async () => { h.answer(1, { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 }); });
    await waitFor(() => expect(labels(container)).toEqual(['TypeScript · not highlighted (output too large)']));
    expect(container.querySelector('.hljs-keyword')).toBeNull();
  });

  it('M4.H18: a block that timed out and was coloured by its line retry says "highlighted line by line"', async () => {
    const h = scripted();
    const { container } = render(under(inThreadContext(h), <DocMarkdown text={`\`\`\`ts\n${LONG}\n\`\`\`\n`} pinKey="p" parser={parser} link={LINK} />));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    await act(async () => { h.answer(0, { kind: 'timeout', budgetMs: HIGHLIGHT_BLOCK_DEADLINE_MS }); });
    await waitFor(() => expect(h.calls).toHaveLength(2));
    await act(async () => { h.answer(1, coloured(LONG, 'line')); });
    await waitFor(() => expect(labels(container)).toEqual(['TypeScript · highlighted line by line']));
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
  });
});

describe('M4.H17: the seam\'s default is production', () => {
  it('HighlighterContext\'s default holds docsHighlighter, chatHighlighter and the production createStore, and no publish slot', () => {
    let seen: HighlighterContextValue | undefined;
    function Probe(): ReactNode {
      seen = useContext(HighlighterContext);
      return null;
    }
    render(<Probe />);
    expect(seen).toBe(HIGHLIGHTER_DEFAULT);
    expect(HIGHLIGHTER_DEFAULT.docs).toBe(docsHighlighter);
    expect(HIGHLIGHTER_DEFAULT.chat).toBe(chatHighlighter);
    expect(HIGHLIGHTER_DEFAULT.createStore).toBe(createProductionStore);
    expect(HIGHLIGHTER_DEFAULT.publish).toBeUndefined();
  });
});
