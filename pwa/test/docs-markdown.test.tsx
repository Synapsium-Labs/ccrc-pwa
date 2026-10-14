// Docs W5 part 1, Task 8: DocMarkdown (spec 2026-10-01 4.10 "DocMarkdown" steps 1-6, 4.12's doc-body mount; the W5
// halves of M4.P1, M4.P6, M4.P7 and M4.P12, M4.P9 and M4.B2). The gate asks before a large document is parsed; the
// parse runs on the page's parser at DOCS_PARSE_BUDGET_MS of its UTF-8 bytes, or at DOCS_PARSE_BUDGET_LARGE_MS after
// Format anyway; worker-unavailable parses a small text in-thread; a tree is detached once and rendered with
// DOC_COMPONENTS inside a boundary keyed by the pin; every other outcome is DocPlain with one note. `renderHast` is
// wrapped by a spy that a case can make throw. Every page is a placeholder (`demo`, `main`, `https://a.example`).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { docsPageUrl, type DocsShowOk } from '../../shared/docs';
import { SHARED_COMPONENTS } from '../src/lib/markdown';
import { utf8ByteLength } from '../src/lib/markdownGuard';
import {
  CHAT_SYNC_MAX_BYTES, DOCS_PARSE_BUDGET_LARGE_MS, DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES,
} from '../src/lib/markdownLimits';
import { parseMarkdown, type ParseOutcome } from '../src/lib/markdownParse';
import { createMarkdownRunner, type MarkdownParser, type WorkerLike } from '../src/lib/markdownRunner';
import { renderHast } from '../src/lib/renderHast';
import { DocImage } from '../src/docs/DocImage';
import { DocLink, type DocLinkContextValue } from '../src/docs/DocLink';
import {
  DOC_BODY_FALLBACK_NOTE, DOC_COMPONENTS, DOC_FORMATTING, DOC_MARKDOWN_ACTION, DOC_NOT_UTF8_NOTE, DocMarkdown,
  DocPlain, docGateSentence, docMarkdownSource, docShownAsTextNote, docsPlainNote,
} from '../src/docs/DocMarkdown';
import { treeOk } from './docsFixtures';

/** `renderHast`, wrapped: every call is recorded, and while `hast.throwing` is set every call throws. */
const hast = vi.hoisted(() => ({ throwing: false }));
vi.mock('../src/lib/renderHast', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/renderHast')>();
  return {
    ...real,
    renderHast: vi.fn((tree: Parameters<typeof real.renderHast>[0], opts: Parameters<typeof real.renderHast>[1]) => {
      if (hast.throwing) throw new Error('renderer failed');
      return real.renderHast(tree, opts);
    }),
  };
});
const renderSpy = vi.mocked(renderHast);

beforeEach(() => {
  hast.throwing = false;
  renderSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};

/** A parser on the main thread: the real pipeline, answered asynchronously, every call recorded. */
const realParser = (): ReturnType<typeof vi.fn<MarkdownParser>> =>
  vi.fn<MarkdownParser>(async (src, o) => parseMarkdown(src, o.profile));

/** A parser that answers `outcome` for every call. */
const answering = (outcome: ParseOutcome): ReturnType<typeof vi.fn<MarkdownParser>> =>
  vi.fn<MarkdownParser>(async () => outcome);

/** A Markdown document of exactly `bytes` ASCII bytes: a heading, then one paragraph of `w`. */
const doc = (bytes: number): string => {
  const head = '# Heading\n\n';
  return head + 'w'.repeat(bytes - head.length);
};

const KIB = 1024;

const show = (over: Partial<DocsShowOk>): DocsShowOk => ({
  v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'a.md', size: 1,
  sha256: 'c'.repeat(64), encoding: 'utf8', ...over,
});

describe('DOC_COMPONENTS (spec 4.10)', () => {
  it('is exactly the shared components with the Docs a and img', () => {
    expect(DOC_COMPONENTS).toEqual({ ...SHARED_COMPONENTS, a: DocLink, img: DocImage });
    expect(Object.keys(DOC_COMPONENTS).sort()).toEqual([...Object.keys(SHARED_COMPONENTS), 'a', 'img'].sort());
  });
});

describe('docsPlainNote: one note per outcome but a tree (spec 4.10 step 5)', () => {
  const NOTES: readonly [Exclude<ParseOutcome, { kind: 'tree' }>, string][] = [
    [{ kind: 'refused', why: 'container-depth', line: 3, value: 40 },
      'Line 3 nests 40 levels deep (limit 32); shown as plain text.'],
    [{ kind: 'refused', why: 'delimiter-run', line: 7, value: 4096 },
      'Line 7 has a run of 4 096 emphasis marks (limit 64); shown as plain text.'],
    [{ kind: 'too-deep', depth: 101 }, 'This document nests 101 levels deep (limit 64); shown as plain text.'],
    [{ kind: 'too-wide', elements: 90000 }, 'This document would draw 90 000 elements (limit 20 000); shown as plain text.'],
    [{ kind: 'threw', error: 'RangeError' }, 'This document could not be formatted (RangeError); shown as plain text.'],
    [{ kind: 'timeout', budgetMs: 2000 }, 'Formatting took longer than 2 s; shown as plain text.'],
    [{ kind: 'worker-unavailable' }, 'This browser cannot format long documents in the background; shown as plain text.'],
    [{ kind: 'worker-failed', error: 'error' }, 'The formatter stopped (error); shown as plain text.'],
  ];
  it.each(NOTES)('%j', (o, note) => {
    expect(docsPlainNote(o)).toBe(note);
  });

  it.each(NOTES)('DocMarkdown shows %j as DocPlain with its note, and draws nothing', async (o, note) => {
    const text = doc(5 * KIB); // over CHAT_SYNC_MAX_BYTES, so worker-unavailable is not parsed in-thread
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={answering(o)} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent).toBe(note));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(text);
    expect(container.querySelector('article')).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe('M4.P9: the render gate (spec 4.10 step 1)', () => {
  const big = doc(600 * KIB);

  it('a 600 KiB doc shows the gate with Format anyway and Show as text, and the parser has 0 calls', async () => {
    const parser = realParser();
    const { container, getByRole } = render(<DocMarkdown text={big} pinKey="p" parser={parser} link={LINK} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector('.doc-gate-copy')?.textContent).toBe('This document is 0.6 MiB. Formatting it may take a while.');
    expect(docGateSentence(utf8ByteLength(big))).toBe('This document is 0.6 MiB. Formatting it may take a while.');
    expect(getByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway })).toBeTruthy();
    expect(getByRole('button', { name: DOC_MARKDOWN_ACTION.showAsText })).toBeTruthy();
    expect(parser).toHaveBeenCalledTimes(0);
    expect(container.querySelector('pre')).toBeNull();
  });

  it('the gate counts UTF-8 bytes, not characters: a text over it in bytes and under it in length is gated, with 0 parses', async () => {
    const text = 'é'.repeat(DOCS_RENDER_GATE_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(DOCS_RENDER_GATE_BYTES);
    expect(utf8ByteLength(text)).toBeGreaterThan(DOCS_RENDER_GATE_BYTES);
    const parser = realParser();
    const { container, getByRole } = render(<DocMarkdown text={text} pinKey="p" parser={parser} link={LINK} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector('.doc-gate-copy')?.textContent).toBe(docGateSentence(utf8ByteLength(text)));
    expect(getByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway })).toBeTruthy();
    expect(parser).toHaveBeenCalledTimes(0);
    expect(container.querySelector('article')).toBeNull();
  });

  it('Show as text gives pre.doc-plain with the whole text, and still no parse', async () => {
    const parser = realParser();
    const { container, getByRole } = render(<DocMarkdown text={big} pinKey="p" parser={parser} link={LINK} />);
    fireEvent.click(getByRole('button', { name: DOC_MARKDOWN_ACTION.showAsText }));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(big);
    expect(container.querySelector('.doc-plain-note')?.textContent).toBe(docShownAsTextNote(utf8ByteLength(big)));
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(parser).toHaveBeenCalledTimes(0);
  });

  it('M4.P6 (W5 half): Format anyway posts one docs job whose budget timer is DOCS_PARSE_BUDGET_LARGE_MS', async () => {
    const posts: unknown[] = [];
    const timers: number[] = [];
    const worker: WorkerLike = {
      postMessage: (job) => { posts.push(job); }, terminate: () => {}, onmessage: null, onerror: null, onmessageerror: null,
    };
    const runner = createMarkdownRunner({ spawn: () => worker, setTimer: (_fn, ms) => { timers.push(ms); return 0; }, clearTimer: () => {} });
    const { container, getByRole } = render(<DocMarkdown text={big} pinKey="p" parser={runner.parse} link={LINK} />);
    expect(posts).toEqual([]);
    fireEvent.click(getByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ src: big, profile: 'docs' });
    expect(timers).toEqual([DOCS_PARSE_BUDGET_LARGE_MS]);
    expect(container.querySelector('.doc-formatting')?.textContent).toBe(DOC_FORMATTING);
    runner.dispose();
  });

  it('a doc of exactly DOCS_RENDER_GATE_BYTES is not gated: it parses at once at the normal budget', async () => {
    const parser = vi.fn<MarkdownParser>(() => new Promise<ParseOutcome>(() => {}));
    const text = doc(DOCS_RENDER_GATE_BYTES);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(parser).toHaveBeenCalledTimes(1));
    expect(parser.mock.calls[0]![1]).toMatchObject({ profile: 'docs', budgetMs: DOCS_PARSE_BUDGET_MS(DOCS_RENDER_GATE_BYTES) });
    expect(container.querySelector('.doc-gate')).toBeNull();
  });
});

describe('the parse budget (spec 4.10 step 2)', () => {
  it('the normal job\'s budget is DOCS_PARSE_BUDGET_MS of the UTF-8 bytes, per document', async () => {
    const cases = [doc(KIB), doc(128 * KIB), 'é'.repeat(32 * KIB)];
    const got: number[] = [];
    for (const text of cases) {
      const parser = vi.fn<MarkdownParser>(() => new Promise<ParseOutcome>(() => {}));
      render(<DocMarkdown text={text} pinKey={text.slice(0, 4)} parser={parser} link={LINK} />);
      await waitFor(() => expect(parser).toHaveBeenCalledTimes(1));
      expect(parser.mock.calls[0]![0]).toBe(text);
      got.push(parser.mock.calls[0]![1].budgetMs);
      cleanup();
    }
    expect(got).toEqual(cases.map((t) => DOCS_PARSE_BUDGET_MS(utf8ByteLength(t))));
    // 1 KiB and 128 KiB differ, and 32 Ki two-byte characters are budgeted by their 64 KiB, not their length.
    expect(new Set(got).size).toBe(3);
  });

  it('the body says Formatting… until the outcome for this text lands', async () => {
    let answer: (o: ParseOutcome) => void = () => {};
    const parser = vi.fn<MarkdownParser>(() => new Promise<ParseOutcome>((r) => { answer = r; }));
    const { container } = render(<DocMarkdown text="# Title" pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(parser).toHaveBeenCalledTimes(1));
    expect(container.querySelector('.doc-formatting')?.textContent).toBe(DOC_FORMATTING);
    expect(container.querySelector('article')).toBeNull();
    await act(async () => { answer(parseMarkdown('# Title', 'docs')); });
    expect(container.querySelector('article.doc-body.msg-assist h1')?.textContent).toBe('Title');
    expect(container.querySelector('.doc-formatting')).toBeNull();
  });
});

describe('M4.P7 (W5 half): worker-unavailable (spec 4.10 step 3)', () => {
  const noWorker = (): MarkdownParser => createMarkdownRunner({ spawn: () => { throw new Error('no Worker here'); } }).parse;

  it('a 4 KiB doc parses on the main thread and renders the article', async () => {
    const text = doc(4 * KIB);
    expect(utf8ByteLength(text)).toBe(CHAT_SYNC_MAX_BYTES);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={noWorker()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('article.doc-body.msg-assist h1')?.textContent).toBe('Heading'));
    expect(container.querySelector('.doc-plain')).toBeNull();
  });

  it('a 5 KiB doc renders DocPlain with the worker-unavailable note', async () => {
    const text = doc(5 * KIB);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={noWorker()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe(docsPlainNote({ kind: 'worker-unavailable' })));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(text);
    expect(container.querySelector('article')).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it('the in-thread limit counts UTF-8 bytes: 2 049 two-byte characters (4 098 bytes, length 2 049) are DocPlain, never parsed in-thread', async () => {
    const text = 'é'.repeat(2049);
    expect(text.length).toBeLessThan(CHAT_SYNC_MAX_BYTES);
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={noWorker()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe(docsPlainNote({ kind: 'worker-unavailable' })));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(text);
    expect(container.querySelector('article')).toBeNull();
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe('M4.P1 (W5 half): DocMarkdown\'s container-depth note', () => {
  it('10 000 nested quotes render DocPlain with the line and the depth', async () => {
    const text = '>'.repeat(10000) + ' x';
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={realParser()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe('Line 1 nests 10 000 levels deep (limit 32); shown as plain text.'));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe(text);
    expect(renderSpy).not.toHaveBeenCalled();
  });
});

describe('M4.P12 (W5 half): too-wide never renders; a real 500 KiB doc still does', () => {
  it('90 000 thematic breaks under 512 KiB: the too-wide note, and the renderHast spy has 0 calls', async () => {
    const text = '---\n'.repeat(90000);
    expect(utf8ByteLength(text)).toBeLessThan(512 * KIB);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={realParser()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe('This document would draw 90 000 elements (limit 20 000); shown as plain text.'), { timeout: 60000 });
    expect(renderSpy).toHaveBeenCalledTimes(0);
    expect(container.querySelector('hr')).toBeNull();
  }, 90000);

  it('22 000 autolinks under 512 KiB: the too-wide note, and the renderHast spy has 0 calls', async () => {
    const text = '<https://a.example>\n'.repeat(22000);
    expect(utf8ByteLength(text)).toBeLessThan(512 * KIB);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={realParser()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe('This document would draw 22 001 elements (limit 20 000); shown as plain text.'), { timeout: 60000 });
    expect(renderSpy).toHaveBeenCalledTimes(0);
    expect(container.querySelector('a')).toBeNull();
  }, 90000);

  // The fixture W4 measured: this plan, read at test time and cut at its last newline before 512 000 bytes, so it
  // sits under the gate and is parsed at once.
  it('a real 500 KiB prose doc renders article.doc-body.msg-assist, through one renderHast call', async () => {
    const file = path.join(import.meta.dirname, '..', '..', 'docs', 'superpowers', 'plans', '2026-10-06-ccrc-history-w1-b2-recall.md');
    const head = readFileSync(file).subarray(0, 512000);
    const text = head.subarray(0, head.lastIndexOf(0x0a) + 1).toString('utf8');
    expect(utf8ByteLength(text)).toBeGreaterThan(500000);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(DOCS_RENDER_GATE_BYTES);
    const { container } = render(<DocMarkdown text={text} pinKey="p" parser={realParser()} link={LINK} />);
    await waitFor(() => expect(container.querySelector('article.doc-body.msg-assist')).not.toBeNull(), { timeout: 60000 });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(container.querySelector('article h1')).not.toBeNull();
    expect(container.querySelector('.doc-plain')).toBeNull();
  }, 90000);
});

describe('a tree renders through detachUrls and DOC_COMPONENTS (spec 4.10 step 4)', () => {
  const SRC = '# T\n\n[p](../plans/p.md) and ![i](https://evil.example/x.png)\n';

  it('renderHast gets the detached copy, DOC_COMPONENTS and no urlTransform; links go through DocLink', async () => {
    const outcome = parseMarkdown(SRC, 'docs');
    if (outcome.kind !== 'tree') throw new Error('fixture does not parse');
    const { container } = render(<DocMarkdown text={SRC} pinKey="p" parser={answering(outcome)} link={LINK} />);
    await waitFor(() => expect(container.querySelector('article.doc-body.msg-assist')).not.toBeNull());
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [tree, opts] = renderSpy.mock.calls[0]!;
    expect(opts).toEqual({ components: DOC_COMPONENTS });
    expect(Object.hasOwn(opts, 'urlTransform')).toBe(false);
    expect(tree).not.toBe(outcome.tree);
    const para = (root: HastRoot): HastElement =>
      root.children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'p')!;
    const linkOf = (root: HastRoot): HastElement =>
      para(root).children.find((c): c is HastElement => c.type === 'element' && c.tagName === 'a')!;
    expect(linkOf(tree).properties).not.toHaveProperty('href');
    expect(linkOf(outcome.tree).properties['href']).toBe('../plans/p.md');
    expect(container.querySelector('article a')?.getAttribute('href')).toBe(docsPageUrl({
      kind: 'path', project: 'demo', section: 'plans', path: 'p.md', dirSlash: false, ref: null, view: 'effective', frame: 'inline',
    }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.doc-img-refused')).not.toBeNull();
  });

  it('the copy is memoised per outcome: a re-render with a new link object renders the same copy', async () => {
    const outcome = parseMarkdown(SRC, 'docs');
    const parser = answering(outcome);
    const { container, rerender } = render(<DocMarkdown text={SRC} pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
    rerender(<DocMarkdown text={SRC} pinKey="p" parser={parser} link={{ ...LINK }} />);
    expect(renderSpy).toHaveBeenCalledTimes(2);
    expect(renderSpy.mock.calls[1]![0]).toBe(renderSpy.mock.calls[0]![0]);
    expect(parser).toHaveBeenCalledTimes(1);
  });

  it('the page highlight budget reaches the blocks: of nine 60 000-character ts blocks the ninth is not highlighted', async () => {
    // 60 000 characters in 60 lines of 1 000 (r10 bounds a line at MD_HIGHLIGHT_MAX_LINE_CHARS, so one long line would be unhighlighted).
    const body = 'const a = 1;' + ' '.repeat(987) + '\n' + (' '.repeat(999) + '\n').repeat(59);
    const fence = (): HastElement => ({
      type: 'element', tagName: 'pre', properties: {},
      children: [{ type: 'element', tagName: 'code', properties: { className: ['language-ts'] }, children: [{ type: 'text', value: body }] }],
    });
    const tree: HastRoot = { type: 'root', children: Array.from({ length: 9 }, fence) };
    const { container } = render(<DocMarkdown text="nine blocks" pinKey="p" parser={answering({ kind: 'tree', tree, depth: 3 })} link={LINK} />);
    await waitFor(() => expect(container.querySelectorAll('.code-block')).toHaveLength(9), { timeout: 60000 });
    expect([...container.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length))
      .toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
  }, 90000);
});

describe('the note actions (spec 4.10 step 5)', () => {
  it('a timeout under the normal budget offers Format anyway, which parses again at the large budget; a large timeout offers nothing', async () => {
    const parser = vi.fn<MarkdownParser>(async (_src, o) => ({ kind: 'timeout', budgetMs: o.budgetMs }));
    const text = doc(KIB);
    const { container, getByRole, queryByRole } = render(<DocMarkdown text={text} pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe(docsPlainNote({ kind: 'timeout', budgetMs: DOCS_PARSE_BUDGET_MS(KIB) })));
    fireEvent.click(getByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway }));
    await waitFor(() => expect(parser).toHaveBeenCalledTimes(2));
    expect(parser.mock.calls.map((c) => c[1].budgetMs)).toEqual([DOCS_PARSE_BUDGET_MS(KIB), DOCS_PARSE_BUDGET_LARGE_MS]);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe(docsPlainNote({ kind: 'timeout', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS })));
    expect(queryByRole('button', { name: DOC_MARKDOWN_ACTION.formatAnyway })).toBeNull();
  });

  it('worker-failed offers Retry, which parses the same text again and renders what it answers', async () => {
    const parser = vi.fn<MarkdownParser>()
      .mockResolvedValueOnce({ kind: 'worker-failed', error: 'error' })
      .mockImplementation(async (src, o) => parseMarkdown(src, o.profile));
    const { container, getByRole } = render(<DocMarkdown text="# Again" pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent)
      .toBe(docsPlainNote({ kind: 'worker-failed', error: 'error' })));
    fireEvent.click(getByRole('button', { name: DOC_MARKDOWN_ACTION.retry }));
    await waitFor(() => expect(container.querySelector('article h1')?.textContent).toBe('Again'));
    expect(parser.mock.calls.map((c) => c[0])).toEqual(['# Again', '# Again']);
  });

  it.each([
    { kind: 'refused', why: 'delimiter-run', line: 1, value: 100 },
    { kind: 'too-deep', depth: 100 },
    { kind: 'too-wide', elements: 20001 },
    { kind: 'threw', error: 'RangeError' },
    { kind: 'worker-unavailable' },
    { kind: 'timeout', budgetMs: DOCS_PARSE_BUDGET_LARGE_MS },
  ] as const)('%j offers no action', async (o) => {
    const { container } = render(<DocMarkdown text={doc(5 * KIB)} pinKey="p" parser={answering(o)} link={LINK} />);
    await waitFor(() => expect(container.querySelector('.doc-plain-note')).not.toBeNull());
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('M4.B2: the doc-body boundary, keyed by the pin (spec 4.12)', () => {
  it('a throwing renderer gives DocPlain with the fallback note while the header beside it stays; a new pin resets it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    hast.throwing = true;
    const parser = realParser();
    const page = (pinKey: string) => (
      <>
        <header className="docs-truth">origin/main · aaaaaaaa</header>
        <DocMarkdown text="# Body" pinKey={pinKey} parser={parser} link={LINK} />
      </>
    );
    const { container, rerender } = render(page('pin-1'));
    await waitFor(() => expect(container.querySelector('.doc-plain-note')?.textContent).toBe(DOC_BODY_FALLBACK_NOTE));
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe('# Body');
    expect(container.querySelector('header.docs-truth')?.textContent).toBe('origin/main · aaaaaaaa');
    expect(container.querySelector('article')).toBeNull();
    expect(warn).toHaveBeenCalledWith('ccrc: render error in doc body', expect.any(Error));
    hast.throwing = false;
    rerender(page('pin-1'));
    expect(container.querySelector('article')).toBeNull();
    rerender(page('pin-2'));
    await waitFor(() => expect(container.querySelector('article.doc-body h1')?.textContent).toBe('Body'));
    expect(container.querySelector('.doc-plain')).toBeNull();
    expect(container.querySelector('header.docs-truth')).not.toBeNull();
    // Decision 3: the throw was the renderer's, inside DocParse's boundary, so the parse is kept: one parse, never a second.
    expect(parser).toHaveBeenCalledTimes(1);
  });
});

describe('docMarkdownSource: a markdown leaf\'s bytes (spec 4.10 step 6)', () => {
  const b64 = (bytes: readonly number[]): string => btoa(String.fromCharCode(...bytes));

  it('utf8 text is Markdown as sent', () => {
    expect(docMarkdownSource(show({ encoding: 'utf8', text: '# A' }))).toEqual({ kind: 'markdown', text: '# A' });
  });

  it('base64 bytes that are strict UTF-8 are Markdown, decoded', () => {
    const bytes = [...new TextEncoder().encode('# Café "q"')];
    expect(docMarkdownSource(show({ encoding: 'base64', b64: b64(bytes) }))).toEqual({ kind: 'markdown', text: '# Café "q"' });
  });

  it('base64 bytes that are not UTF-8 are decoded non-fatally and shown as plain text: "Not valid UTF-8."', () => {
    const src = docMarkdownSource(show({ encoding: 'base64', b64: b64([0x23, 0x20, 0xff, 0x41, 0xc3]) }));
    expect(src).toEqual({ kind: 'not-utf8', text: '# �A�' });
    if (src.kind !== 'not-utf8') throw new Error('unreachable');
    const { container } = render(<DocPlain text={src.text} note={DOC_NOT_UTF8_NOTE} />);
    expect(container.querySelector('.doc-plain-note')?.textContent).toBe('Not valid UTF-8.');
    expect(container.querySelector('pre.doc-plain')?.textContent).toBe('# �A�');
  });

  it('an answer whose encoding names a missing field, or base64 that does not decode, holds no bytes', () => {
    expect(docMarkdownSource(show({ encoding: 'utf8' }))).toEqual({ kind: 'no-bytes' });
    expect(docMarkdownSource(show({ encoding: 'base64' }))).toEqual({ kind: 'no-bytes' });
    expect(docMarkdownSource(show({ encoding: 'base64', b64: '!!!' }))).toEqual({ kind: 'no-bytes' });
    expect(docMarkdownSource(show({ encoding: 'base64', text: '# A' }))).toEqual({ kind: 'no-bytes' });
  });
});

describe('T13 review 1-1: the in-thread fallback parses in the docs profile', () => {
  it('a small text with a <br>, with no Worker, draws a br element and no literal "<br>"', async () => {
    const parser = createMarkdownRunner({ spawn: () => { throw new Error('no Worker'); } }).parse;
    const { container } = render(<DocMarkdown text="a<br>b" pinKey="p" parser={parser} link={LINK} />);
    await waitFor(() => expect(container.querySelector('article.doc-body')).not.toBeNull());
    expect(container.querySelector('article br')).not.toBeNull();
    expect(container.textContent).not.toContain('<br>');
  });
});
