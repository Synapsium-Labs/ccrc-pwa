// The print view and the print trees' preparation (X2 P6.1 Step 1; spec 2026-11-18 4.6 "The tree is parsed ahead", rows PR12 and
// PL3). `PrintView` draws a `PrintTree` with React only (never a string parsed as HTML); `preparePrintTree` and `preparePartsPrint`
// ask the render job for each part's tree, one part at a time, each under its parse budget, with at most 10 s a part. The real
// render job (`answerRenderJob`, wrapped as a promise) answers the cases that need the library; a fake answers the ones about
// budgets, order and time. Mutation rows M11.60 (the drafts banner) and M11.76 (print only the part on screen) each name a case
// here. Placeholders only: project `demo`, `/repo/demo`, `example.test`.
import type { Element, ElementContent, Root } from 'hast';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { docsApi, type DocPin, type DocsFileResponse, type DocsPageLocation } from '../../shared/docs';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import type { ReaderMount, ReaderMountInput } from '../src/docs/reader/bridge';
import type { DocsFileAnswer } from '../src/docs/failures';
import { navigate, useLocation } from '../src/lib/router';
import { DocsScreen } from '../src/screens/DocsScreen';
import { parseMarkdown } from '../src/lib/markdownParse';
import { utf8Bytes } from '../../shared/utf8';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { linkBaseFor } from '../src/docs/docsLinkBase';
import { DOCS_BANNER_TEXT, DOCS_HEAD_TEXT } from '../src/docs/docsText';
import { chooseReaderLayout, resetReaderLayoutChoiceForTests } from '../src/docs/reader/layoutPref';
import { pinFor } from '../src/docs/useDocsVisit';
import { planImageRef, rasterDataUrl, SVG_DATA_PREFIX } from '../src/docs/DocImage';
import { createExportAssets, type ExportAssets } from '../src/docs/export/exportAssets';
import { loadedImageOf } from '../src/docs/print/printImages';
import { fromWorker, imagesFor, prepKeyOf, prepStarted, printElementCount, printPlanFor, PRINT_WHOLE_MAX_ELEMENTS } from '../src/docs/print/printPlan';
import type { PrintSource } from '../src/docs/print/printSource';
import { docLinkTarget } from '../src/docs/docsLinks';
import { exportProvenance } from '../src/docs/export/provenance';
import { PrintView } from '../src/docs/print/PrintView';
import { preparePartsPrint, preparePrintTree, type PrintPart, type PrintRender } from '../src/docs/print/preparePrint';
import { leafPrintTree, PRINT_WAIT_MS } from '../src/docs/print/printTree';
import { PRINT_HTML_LINE, PRINT_NOT_READY, PRINT_PDF_LINE, PRINT_PREPARING_LINE, PRINT_ROW_TEXT, PRINT_TOO_LONG } from '../src/docs/print/printWords';
import { cutMarkdownText, partText, type BlocksJob } from '../src/docs/range/mdParts';
import { DOCS_PARSE_BUDGET_MS, DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { PRINT_ELEMENTS, printAllow, type PrintTree } from '../src/lib/printAllow';
import { answerRenderJob, type ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import {
  COMMIT_A, COMMIT_B, FP_1, SERVED, draftOf, entry, failedAnswer, fakeLoaders, fileResponse, holder, okTree, pageAt, servingLoader, treeOk,
  type FakeLoaders,
} from './docsFixtures';

// A PDF leaf never loads the PDF viewer's assets here: its view stays at "Loading".
vi.mock('../src/docs/pdf/pdfAssets', () => ({ loadPdfAssets: () => new Promise(() => undefined) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
  resetReaderLayoutChoiceForTests();
});

// ---- the render job, as a promise -----------------------------------------------------------------------------------------

/** The REAL render job over a source: `print: true` asks for the print tree, as the runner posts it. */
const realRender: PrintRender = (src, o) => new Promise((resolve) => {
  answerRenderJob({ id: 1, kind: 'render', src, ...(o.print ? { print: true } : {}) }, (r) => { resolve(r.outcome); });
});
/** The real blocks job, for the parts' cutter. */
const realBlocks: BlocksJob = (src) => new Promise((resolve) => {
  answerRenderJob({ id: 1, kind: 'render', src, blocks: true }, (r) => { resolve(r.outcome); });
});
const SIGNAL = (): AbortSignal => new AbortController().signal;

/** The print part of a source through the real render job. */
const partOf = (md: string): Promise<PrintPart> => preparePrintTree(md, realRender, SIGNAL());
async function treeOfMd(md: string): Promise<PrintTree> {
  const p = await partOf(md);
  if (p.kind !== 'tree') throw new Error(`fixture: ${p.why}`);
  return p.tree;
}

const NO_IMAGES: ReadonlyMap<string, string> = new Map();
const NO_LINKS = (): null => null;

interface ViewOver { parts?: readonly PrintPart[]; banner?: string | null; images?: ReadonlyMap<string, string>; linkTarget?: (raw: string) => string | null; line?: string | null }
function view(over: ViewOver = {}) {
  return render(<PrintView parts={over.parts ?? []} banner={over.banner ?? null} images={over.images ?? NO_IMAGES} linkTarget={over.linkTarget ?? NO_LINKS} line={over.line ?? null} />);
}

// ---- hast builders for hand-made hostile trees ---------------------------------------------------------------------------

const h = (tagName: string, properties: Element['properties'], ...children: ElementContent[]): Element =>
  ({ type: 'element', tagName, properties, children });
const tx = (value: string): ElementContent => ({ type: 'text', value });
const root = (...children: Root['children']): Root => ({ type: 'root', children });

// ---- fixtures for the fake render ---------------------------------------------------------------------------------------

const leaf = (url: string): DocsPageLocation & { kind: 'path' } => {
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error(`fixture: ${url} is not a leaf`);
  return page;
};
const textTree = (t: string): PrintTree => ({ nodes: [{ t: 'el', n: 'p', a: {}, c: [{ t: 'text', v: t }] }] });
const renderedWith = (tree: PrintTree): ReaderRenderOutcome => ({
  kind: 'rendered',
  result: { outcome: 'rendered', html: '', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [], imagesTruncated: false, printTree: tree,
});
/** A rendered answer with no print tree: what a worker of a build before this job answers to a `print` job. */
function withoutTree(o: ReaderRenderOutcome): ReaderRenderOutcome {
  if (o.kind !== 'rendered') return o;
  const { printTree: _dropped, ...rest } = o;
  return rest;
}
/** A render that never answers on its own, and rejects with the signal's reason when it is aborted, as the runner does. */
const hangs = (o: { signal?: AbortSignal }): Promise<ReaderRenderOutcome> => new Promise((_, reject) => {
  o.signal?.addEventListener('abort', () => { reject(o.signal?.reason); }, { once: true });
});

// ---- PR12: the drafts banner ---------------------------------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const DIGEST = 'ab12cd34ef56'.repeat(5) + 'abcd';
const draftPin = (fp: string, stat?: { size: number; mtimeNs: string }): DocPin =>
  ({ kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'a.md', fp, ...(stat === undefined ? {} : { stat }) });
const committedPin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'a.md' };
const draftTree = treeOk({ entries: [entry('specs', 'a.md', { draft: draftOf('modified') })], drafts: holder() });

/** The banner `exportProvenance` gives the pin the leaf opened. */
function bannerOf(tree: ReturnType<typeof treeOk>, url: string, pin: DocPin): string | null {
  return exportProvenance({ tree, page: leaf(url), pin, show: null, exportedAt: NOW, readAt: NOW - 1000, plainView: false }).banner;
}

describe('print: the drafts banner (spec 4.6 row PR12)', () => {
  it('print: a draft prints the drafts banner from exportProvenance, a committed doc none', () => {
    const banner = bannerOf(draftTree, '/docs/demo/specs/a.md?ref=main', draftPin(FP_1));
    expect(banner).toContain('Draft, not committed.');
    const parts: PrintPart[] = [{ kind: 'tree', tree: textTree('body') }];
    const drafted = view({ parts, banner });
    const p = drafted.container.querySelector('.docs-print-banner');
    expect(p?.tagName).toBe('P');
    expect(p?.textContent).toBe(banner);
    // The banner is the first thing the view draws, before the document.
    expect(drafted.container.querySelector('.docs-print-view')?.firstElementChild).toBe(p);
    cleanup();

    const committed = bannerOf(treeOk(), '/docs/demo/specs/a.md', committedPin);
    expect(committed).toBeNull();
    const plain = view({ parts, banner: committed });
    expect(plain.container.querySelector('.docs-print-banner')).toBeNull();
    expect(plain.container.textContent).toBe('body');
  });

  it('print: a stat-pinned draft prints the banner with its snapshot digest', () => {
    const stat = { size: 120, mtimeNs: '1700000000000000000' };
    const banner = bannerOf(draftTree, '/docs/demo/specs/a.md?ref=main', draftPin(DIGEST, stat));
    expect(banner).toContain(`sha256:${DIGEST.slice(0, 12)}`);
    const r = view({ parts: [{ kind: 'tree', tree: textTree('body') }], banner });
    expect(r.container.querySelector('.docs-print-banner')?.textContent).toBe(banner);
  });
});

// ---- PL3: the parts, their budgets and the wait --------------------------------------------------------------------------

describe('print: a doc in parts (spec 4.6, PL3)', () => {
  it('print: a doc in parts prints every part, each parsed under its budget', async () => {
    const parts = ['# One\n\nfirst', `${'word '.repeat(30000)}\n`, '# Three\n'];
    expect(utf8Bytes(parts[1] as string)).toBeGreaterThan(131072);
    const calls: { src: string; budgetMs: number; print: boolean; hasSignal: boolean }[] = [];
    let live = 0;
    let most = 0;
    const fake: PrintRender = async (src, o) => {
      calls.push({ src, budgetMs: o.budgetMs, print: o.print, hasSignal: o.signal !== undefined });
      live += 1;
      most = Math.max(most, live);
      await Promise.resolve();
      live -= 1;
      return renderedWith(textTree(src.slice(0, 5)));
    };
    const told: number[] = [];
    const got = await preparePartsPrint(parts, fake, SIGNAL(), (k, p) => { told.push(k); expect(p.kind).toBe('tree'); });
    expect(got).toHaveLength(3);
    expect(got.every((p) => p.kind === 'tree')).toBe(true);
    expect(told).toEqual([0, 1, 2]);
    // Each part under ITS budget, asked for its print tree, one at a time and in order.
    expect(calls.map((c) => c.src)).toEqual(parts);
    expect(calls.map((c) => c.budgetMs)).toEqual(parts.map((s) => DOCS_PARSE_BUDGET_MS(utf8Bytes(s))));
    expect(new Set(calls.map((c) => c.budgetMs)).size, 'the budgets differ, so a shared one is seen').toBeGreaterThan(1);
    expect(calls.every((c) => c.print && c.hasSignal)).toBe(true);
    expect(most).toBe(1);
  });

  it('print: each part\'s print tree comes from the render job, and Print waits at most 10 s a part, printing a part not ready, or refused by the render job, as its plain text with the reason\'s sentence', async () => {
    vi.useFakeTimers();
    const parts = ['ready part', 'slow part', 'refused part', 'timed out part', 'broken part', 'old build part'];
    const trees = new Map<string, PrintTree>([['ready part', textTree('from the job')]]);
    const signals = new Map<string, AbortSignal | undefined>();
    const render: PrintRender = (src, o) => {
      signals.set(src, o.signal);
      switch (src) {
        case 'ready part': return Promise.resolve(renderedWith(trees.get(src) as PrintTree));
        case 'slow part': return hangs(o);
        case 'refused part': return Promise.resolve({ kind: 'refused', why: 'container-depth', line: 3, value: 40 });
        case 'timed out part': return Promise.resolve({ kind: 'timeout', budgetMs: 4000 });
        case 'broken part': return Promise.reject(new RangeError('boom'));
        default: return Promise.resolve(withoutTree(renderedWith(textTree(''))));
      }
    };
    const told: [number, PrintPart][] = [];
    const done = preparePartsPrint(parts, render, SIGNAL(), (k, p) => { told.push([k, p]); });
    await vi.advanceTimersByTimeAsync(PRINT_WAIT_MS - 1);
    // The first part landed; the slow one is still waited for, and nothing after it has started.
    expect(told.map(([k]) => k)).toEqual([0]);
    expect(told[0]![1]).toEqual({ kind: 'tree', tree: trees.get('ready part') });
    expect(signals.has('refused part')).toBe(false);
    expect(signals.get('slow part')?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const got = await done;
    // At 10 s the slow part is let go (its render is cancelled) and prints plain with its own sentence.
    expect(signals.get('slow part')?.aborted).toBe(true);
    expect(got).toHaveLength(6);
    expect(got[0]).toEqual({ kind: 'tree', tree: trees.get('ready part') });
    expect(got[1]).toEqual({ kind: 'plain', text: 'slow part', why: 'This part was not ready in time to print.' });
    expect(PRINT_NOT_READY).toBe('This part was not ready in time to print.');
    expect(got[2]).toEqual({ kind: 'plain', text: 'refused part', why: 'Line 3 nests 40 levels deep (limit 32); printed as plain text.' });
    expect(got[3]).toEqual({ kind: 'plain', text: 'timed out part', why: 'Formatting took longer than 4 s; printed as plain text.' });
    expect(got[4]).toEqual({ kind: 'plain', text: 'broken part', why: 'This document could not be formatted (RangeError); printed as plain text.' });
    expect(got[5]).toMatchObject({ kind: 'plain', text: 'old build part', why: 'This document could not be prepared for print; printed as plain text.' });
    // The parts that wait no longer than 10 s each: a ready part holds nothing up, and the wait restarts for each part.
    expect(told.map(([k]) => k)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('print: a refusal of each kind the render job answers prints the text under a sentence, and the caller\'s own abort rejects', async () => {
    const sentence = async (o: ReaderRenderOutcome): Promise<string> => {
      const p = await preparePrintTree('text', () => Promise.resolve(o), SIGNAL());
      if (p.kind !== 'plain') throw new Error('expected plain');
      expect(p.text).toBe('text');
      return p.why;
    };
    expect(await sentence({ kind: 'refused', why: 'delimiter-run', line: 7, value: 70 })).toBe('Line 7 has a run of 70 emphasis marks (limit 64); printed as plain text.');
    expect(await sentence({ kind: 'not-rendered', why: 'over-limit' })).toContain('printed as plain text.');
    expect(await sentence({ kind: 'not-rendered', why: 'output-over-limit' })).toContain('printed as plain text.');
    expect(await sentence({ kind: 'not-rendered', why: 'failed' })).toContain('printed as plain text.');
    expect(await sentence({ kind: 'threw', error: 'TypeError' })).toBe('This document could not be formatted (TypeError); printed as plain text.');
    expect(await sentence({ kind: 'worker-unavailable' })).toContain('printed as plain text.');
    expect(await sentence({ kind: 'worker-failed', error: 'error' })).toBe('The formatter stopped (error); printed as plain text.');
    expect(await sentence({ kind: 'blocks', blocks: [] })).toContain('printed as plain text.');

    const ac = new AbortController();
    const rejected = preparePartsPrint(['a', 'b'], (_src, o) => hangs(o), ac.signal, () => {});
    ac.abort(new DOMException('gone', 'AbortError'));
    await expect(rejected).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// ---- PL3: the render gate and the fixtures, through the real job -----------------------------------------------------------

/** Text of exactly `bytes` ASCII bytes: paragraphs of 99 characters, then a last short one for the remainder. */
function sized(bytes: number): string {
  const para = `${'p'.repeat(99)}\n\n`;
  let t = para.repeat(Math.floor(bytes / para.length));
  const rest = bytes - t.length;
  if (rest > 0) t += 'q'.repeat(rest);
  return t;
}
/** Dense mixed Markdown of at least `bytes`: headings, paragraphs, lists, tables, fences, quotes. */
function dense(bytes: number): string {
  let t = '';
  let i = 0;
  while (t.length < bytes) {
    i += 1;
    t += `## Section ${i}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.\n\n`;
    t += `- item ${i}.1\n- item ${i}.2\n  continued text\n- item ${i}.3\n\n`;
    t += `| a | b | c |\n|---|---|---|\n| ${i} | x | y |\n| z | ${i} | w |\n\n`;
    t += '```ts\n' + `const v${i} = ${i};\n`.repeat(8) + '```\n\n';
    t += `> quote ${i}\n> more\n\n1. one\n2. two\n\n`;
  }
  return t;
}
/** Every part of `text` as the reader cuts it (the blocks from the real render job), as the strings each part mounts. */
async function partsOf(text: string): Promise<string[]> {
  const cut = await cutMarkdownText(text, realBlocks, SIGNAL());
  return cut.map((p) => partText(text, p));
}
/** The element count of a print tree. */
function countNodes(t: PrintTree): number {
  let n = 0;
  const stack = [...t.nodes];
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    n += 1;
    if (x.t === 'el') for (const c of x.c) stack.push(c);
  }
  return n;
}

describe('print: Markdown parts at the render gate and the fixtures', () => {
  it('print: Markdown of 524 287 and 524 288 bytes prints as one part, 524 289 bytes as two', async () => {
    expect(DOCS_RENDER_GATE_BYTES).toBe(524288);
    for (const [bytes, count] of [[DOCS_RENDER_GATE_BYTES - 1, 1], [DOCS_RENDER_GATE_BYTES, 1], [DOCS_RENDER_GATE_BYTES + 1, 2]] as const) {
      const text = sized(bytes);
      expect(utf8Bytes(text)).toBe(bytes);
      const parts = await partsOf(text);
      expect(parts, `${bytes} bytes`).toHaveLength(count);
      const printed = await preparePartsPrint(parts, realRender, SIGNAL(), () => {});
      expect(printed.map((p) => p.kind), `${bytes} bytes print as a tree each`).toEqual(parts.map(() => 'tree'));
    }
  }, 120_000);

  it('print: the 2 MiB and 3.4 MiB (3 565 158 bytes) fixtures print every part', async () => {
    for (const [bytes, least] of [[2097152, 4], [3565158, 7]] as const) {
      const text = dense(bytes).slice(0, bytes - 1) + '\n';
      expect(utf8Bytes(text)).toBe(bytes);
      const parts = await partsOf(text);
      expect(parts.length, `${bytes} bytes`).toBeGreaterThanOrEqual(least);
      const kinds: string[] = [];
      let elements = 0;
      const printed = await preparePartsPrint(parts, realRender, SIGNAL(), (_k, p) => {
        kinds.push(p.kind);
        if (p.kind === 'tree') elements += countNodes(p.tree);
      });
      expect(printed).toHaveLength(parts.length);
      expect(kinds.filter((k) => k !== 'tree'), `${bytes} bytes: no part printed plain`).toEqual([]);
      expect(elements).toBeGreaterThan(parts.length * 1000);
      // The first part starts at the first heading and its id is prefixed.
      const first = printed[0] as Extract<PrintPart, { kind: 'tree' }>;
      expect(first.tree.nodes[0]).toMatchObject({ t: 'el', n: 'h2', a: { id: 'docs-print-section-1' } });
    }
  }, 300_000);

  it('print: a text leaf in parts prints each part as one pre', () => {
    const texts = ['first <b>part</b> & more\nline two', '<script>alert(1)</script>\nsecond part'];
    const parts: PrintPart[] = texts.map((text, i) => ({
      kind: 'tree', tree: leafPrintTree({ kind: 'text', text, name: 'big.txt', part: { k: i + 1, n: texts.length } }),
    }));
    const r = view({ parts });
    const root = r.container.querySelector('.docs-print-view') as HTMLElement;
    const pres = [...root.querySelectorAll('pre')];
    expect(pres.map((p) => p.textContent)).toEqual(texts);
    // Markup in the text stays text: it makes no element.
    expect(root.querySelector('b, script')).toBeNull();
    // Each part holds exactly one pre, after its "Part k of n" line, and the second starts a page.
    const partBoxes = [...root.children] as HTMLElement[];
    expect(partBoxes).toHaveLength(2);
    expect(partBoxes.map((b) => b.querySelectorAll('pre').length)).toEqual([1, 1]);
    expect(partBoxes.map((b) => b.querySelector('p')?.textContent)).toEqual(['Part 1 of 2', 'Part 2 of 2']);
    expect(partBoxes[0]!.classList.contains('docs-print-part')).toBe(false);
    expect(partBoxes[1]!.classList.contains('docs-print-part')).toBe(true);
  });
});

// ---- the view: what it draws and never draws -----------------------------------------------------------------------------

describe('print view', () => {
  it('print view: no dangerouslySetInnerHTML in pwa/src/docs/print', () => {
    const dir = path.join(import.meta.dirname, '..', 'src', 'docs', 'print');
    const files = readdirSync(dir).filter((n) => /\.tsx?$/.test(n));
    expect(files).toEqual(expect.arrayContaining(['PrintView.tsx', 'preparePrint.ts', 'printTree.ts', 'printWords.ts']));
    for (const name of files) {
      const code = readFileSync(path.join(dir, name), 'utf8');
      expect(code, name).not.toContain('dangerouslySetInnerHTML');
      expect(code, name).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|DOMParser|createContextualFragment/);
      // The print tree is parsed in the worker, never here: nothing in this folder imports the html parser's module.
      expect(code, `${name}: no import of lib/renderTree`).not.toMatch(/from\s+['"][^'"]*renderTree['"]/);
    }
  });

  it('print view: a tree from a hostile render prints no script, style, handler or foreign href', () => {
    const tree = printAllow(root(
      h('script', {}, tx('alert(1)')),
      h('style', {}, tx('body{display:none}')),
      h('p', { onclick: 'x()', style: 'color:red', id: 'a b', dataLine: '1-1' },
        tx('hi '),
        h('a', { href: 'javascript:alert(1)', onclick: 'y()' }, tx('bad')), tx(' '),
        h('a', { href: 'https://other.example/x', target: '_blank' }, tx('far')), tx(' '),
        h('a', { href: '#frag' }, tx('in'))),
      h('svg', { onload: 'z()' }, h('script', {}, tx('in-svg-script')), tx('svgtext')),
      h('img', { src: 'https://other.example/p.png', srcset: 'a.png 1x', onerror: 'q()', alt: 'pic' }),
      h('input', { type: 'text', value: 'x' }),
      h('input', { type: 'checkbox', checked: true, onclick: 'w()' }),
      h('iframe', { src: 'https://other.example/f' }, tx('frame text')),
    ));
    const r = view({ parts: [{ kind: 'tree', tree }] });
    const root_ = r.container.querySelector('.docs-print-view') as HTMLElement;
    expect(root_.querySelector('script, style, svg, iframe, object, embed, img, [style]')).toBeNull();
    for (const el of root_.querySelectorAll('*')) {
      expect(el.getAttributeNames().filter((n) => n.startsWith('on')), el.tagName).toEqual([]);
      expect(el.hasAttribute('src'), el.tagName).toBe(false);
      expect(el.hasAttribute('srcset'), el.tagName).toBe(false);
      const href = el.getAttribute('href');
      if (href !== null) expect(href.startsWith('#docs-print-'), href).toBe(true);
    }
    // Only the in-document fragment is a link; the others print their text and keep no address.
    expect([...root_.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual(['#docs-print-frag']);
    expect(root_.textContent).toContain('hi bad far in');
    expect(root_.textContent).toContain('[pic]');
    expect(root_.textContent).toContain('svgtext');
    for (const gone of ['alert(1)', 'body{display', 'in-svg-script', 'frame text', 'javascript:', 'other.example']) {
      expect(root_.textContent, gone).not.toContain(gone);
      expect(root_.innerHTML, gone).not.toContain(gone);
    }
    // Only a checkbox input, disabled, read-only and checked; the text input is gone; the id is prefixed.
    const inputs = [...root_.querySelectorAll('input')];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ type: 'checkbox', disabled: true, readOnly: true, checked: true });
    expect(root_.querySelector('p')?.id).toBe('docs-print-a b');
    expect(root_.querySelector('p')?.getAttribute('data-line')).toBe('1-1');
    // Every element drawn has a tag the allow-list names, or the view's own wrappers.
    const allowed = new Set<string>([...PRINT_ELEMENTS, 'div', 'p', 'pre']);
    for (const el of root_.querySelectorAll('*')) expect(allowed.has(el.tagName.toLowerCase()), el.tagName).toBe(true);
  });

  it('print view: an image prints only from a URL the page loaded', async () => {
    const tree = await treeOfMd('![pic](a.png "T")\n\n![](https://other.example/b.png)\n');
    const mapped = view({ parts: [{ kind: 'tree', tree }], images: new Map([['a.png', 'blob:loaded-a']]) });
    const imgs = [...mapped.container.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')).toBe('blob:loaded-a');
    expect(imgs[0]?.getAttribute('alt')).toBe('pic');
    expect(imgs[0]?.getAttribute('title')).toBe('T');
    // The unmapped one (with no alt text) prints a bracketed word and no address.
    expect(mapped.container.textContent).toContain('[image]');
    expect(mapped.container.innerHTML).not.toContain('other.example');
    cleanup();
    const none = view({ parts: [{ kind: 'tree', tree }] });
    expect(none.container.querySelector('img')).toBeNull();
    expect(none.container.textContent).toContain('[pic]');
    expect(none.container.innerHTML).not.toContain('a.png');
  });

  it('print view: a doc link prints its target as text, a foreign link prints its text only', async () => {
    const tree = await treeOfMd('See [the doc](other.md#part), [far](https://far.example/p), [mail](mailto:a@b.example) and [here](#top).\n\n## Top\n');
    const ctx: DocLinkContextValue = {
      project: 'demo', pageRef: null, pageAt: null, pageVariant: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
      pageSource: 'committed', urls: new WeakMap(), onFragment: () => {},
    };
    const asked: string[] = [];
    const linkTarget = (raw: string): string | null => {
      asked.push(raw);
      const t = docLinkTarget(ctx, raw);
      return t.kind === 'in-app' ? t.href : null;
    };
    const r = view({ parts: [{ kind: 'tree', tree }], linkTarget });
    const text = r.container.textContent ?? '';
    const docHref = docLinkTarget(ctx, 'other.md#part');
    if (docHref.kind !== 'in-app') throw new Error('fixture: the doc link is not in-app');
    expect(text).toContain(`the doc (${docHref.href})`);
    expect(docHref.href).toContain('/docs/demo/specs/other.md');
    // A link that is not a doc link prints its text and nothing after it; an in-document link keeps its fragment href.
    expect(text).toContain('far, mail and here.');
    expect(text).not.toContain('far.example');
    expect(text).not.toContain('a@b.example');
    expect([...r.container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual(['#docs-print-top']);
    expect(asked).toEqual(['other.md#part', 'https://far.example/p', 'mailto:a@b.example']);
    expect(r.container.querySelector('#docs-print-top')?.tagName).toBe('H2');
  });

  it('print: figures print as source with caption', async () => {
    const tree = await treeOfMd('```mermaid\nflowchart LR\n  A-->B\n```\n*Figure 1. Two boxes.*\n');
    const r = view({ parts: [{ kind: 'tree', tree }] });
    const fig = r.container.querySelector('figure');
    expect(fig).not.toBeNull();
    const pre = fig?.querySelector(':scope > pre');
    expect(pre?.textContent).toBe('flowchart LR\n  A-->B\n');
    expect(fig?.querySelector('figcaption')?.textContent).toBe('Figure 1. Two boxes.');
    // Printed as source: no drawn picture, no svg, no image.
    expect(r.container.querySelector('svg, img, canvas')).toBeNull();
  });

  it('print view: a task list prints disabled checkboxes, and one line replaces the document when a line is given', async () => {
    const tree = await treeOfMd('- [x] done\n- [ ] todo\n');
    const r = view({ parts: [{ kind: 'tree', tree }], banner: 'a banner' });
    const boxes = [...r.container.querySelectorAll('input')];
    expect(boxes.map((b) => [b.type, b.disabled, b.checked])).toEqual([['checkbox', true, true], ['checkbox', true, false]]);
    cleanup();
    const one = view({ parts: [{ kind: 'tree', tree }], banner: 'a banner', line: 'Docs is preparing this page for print; print again in a moment.' });
    const box = one.container.querySelector('.docs-print-view') as HTMLElement;
    expect(box.children).toHaveLength(1);
    expect(box.firstElementChild?.tagName).toBe('P');
    expect(box.textContent).toBe('Docs is preparing this page for print; print again in a moment.');
  });

  it('print view: a plain part prints its reason in a note and its text in one pre', () => {
    const r = view({ parts: [{ kind: 'plain', text: '# raw <b>text</b>\n\nmore', why: 'because; printed as plain text.' }] });
    const box = r.container.querySelector('.docs-print-view >div') as HTMLElement;
    expect(box.querySelector('p.docs-print-note')?.textContent).toBe('because; printed as plain text.');
    expect(box.querySelectorAll('pre')).toHaveLength(1);
    expect(box.querySelector('pre')?.textContent).toBe('# raw <b>text</b>\n\nmore');
    expect(box.querySelector('b')).toBeNull();
  });
});

// ---- the whole-print ceiling (D-9163) ---------------------------------------------------------------------------------------------

/** A print tree of exactly `n` elements (flat `p`s: each counts one, and its text child counts none). */
const elementsOf = (n: number): PrintTree => ({
  nodes: Array.from({ length: n }, (): PrintTree['nodes'][number] => ({ t: 'el', n: 'p', a: {}, c: [{ t: 'text', v: 'x' }] })),
});

describe('print: the whole-print ceiling (printPlan.PRINT_WHOLE_MAX_ELEMENTS, D-9163)', () => {
  const elements = (n: number): PrintPart => ({ kind: 'tree', tree: elementsOf(n) });
  const parts = ['a', 'b', 'c'];
  const source = (at: number): PrintSource => ({ kind: 'markdown-parts', parts, complete: true, at });

  it('the measure counts elements, nested ones too, and nothing else', () => {
    expect(PRINT_WHOLE_MAX_ELEMENTS).toBe(120000);
    const nested: PrintPart = { kind: 'tree', tree: { nodes: [{ t: 'el', n: 'ul', a: {}, c: [{ t: 'el', n: 'li', a: {}, c: [{ t: 'text', v: 'x' }] }] }, { t: 'text', v: 'y' }] } };
    expect(printElementCount([nested, null, { kind: 'plain', text: 'p', why: 'w' }])).toBe(2);
  });

  it('print: a document at the whole-print ceiling prints every part', () => {
    const prepared = [elements(40000), elements(40000), elements(40000)];
    expect(printElementCount(prepared)).toBe(PRINT_WHOLE_MAX_ELEMENTS);
    const plan = printPlanFor(source(1), prepared);
    expect(plan?.parts).toEqual(prepared);
    expect(plan?.notice).toBeNull();
    expect(plan?.line).toBeNull();
  });

  it('print: a document over the whole-print ceiling prints the part on screen and says so', () => {
    const prepared = [elements(40000), elements(40000), elements(40001)];
    expect(printElementCount(prepared)).toBe(PRINT_WHOLE_MAX_ELEMENTS + 1);
    for (const at of [0, 1, 2]) {
      const plan = printPlanFor(source(at), prepared);
      expect(plan?.parts, `at ${at}`).toEqual([prepared[at]]);
      expect(plan?.notice).toBe(PRINT_TOO_LONG);
      expect(plan?.line).toBeNull();
    }
    // A part index past the end is the last part; a text leaf in parts follows the same decision.
    expect(printPlanFor(source(9), prepared)?.parts).toEqual([prepared[2]]);
    expect(PRINT_TOO_LONG).toBe('This document is too long to print whole: Print prints the part on screen. To print the rest, open each part and print it.');
    // A part not prepared yet counts nothing and prints plain: the decision is over what is prepared.
    const lightly = printPlanFor(source(0), [elements(40000), null, elements(40000)]);
    expect(lightly?.notice).toBeNull();
    expect(lightly?.parts).toHaveLength(3);
  });

  it('print: a document over the whole-print ceiling says so below the row and at the top of the view, and follows the part on screen', async () => {
    const printed: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => { printed.push(printRoot()?.textContent ?? '<empty>'); });
    const text = `# Head\n\n${sized(DOCS_RENDER_GATE_BYTES + 1)}`;
    // Part 1 is the heavy one (120 000 elements, never mounted here); part 2 is two small elements: 120 002 in all.
    const r = rig((src) => Promise.resolve(renderedWith(src.startsWith('# Head') ? elementsOf(120000) : elementsOf(2))));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', text, 'markdown')), r.reader);
    await waitFor(() => expect(r.landed).toHaveLength(2), { timeout: 20000 });
    await settle();
    // Below the row: the sentence, in the head, once the parts are prepared.
    expect((await screen.findByText(PRINT_TOO_LONG)).closest('.docs-head')).not.toBeNull();
    // The page turns to part 2: that is the part Print (and Ctrl+P) holds.
    fireEvent.click(await screen.findByText('Next part'));
    await waitFor(() => expect(screen.getByText('Part 2 of 2')).toBeTruthy());
    await settle();
    fire('beforeprint');
    const view = printRoot()?.querySelector('.docs-print-view') as HTMLElement;
    expect(view.firstElementChild?.tagName).toBe('P');
    expect(view.firstElementChild?.textContent).toBe(PRINT_TOO_LONG);
    expect(view.firstElementChild?.classList.contains('docs-print-notice')).toBe(true);
    expect(view.querySelectorAll('p')).toHaveLength(1 + 2);
    expect(view.querySelector('.docs-print-part'), 'one part only').toBeNull();
    fire('afterprint');
    // The row prints the same view.
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    expect(printed).toHaveLength(1);
    expect(printed[0]!.startsWith(PRINT_TOO_LONG)).toBe(true);
  }, 90000);
});

// ---- what the worker is asked to prepare (review 4116, A2: one writer of the prepare gate) --------------------------------------

describe('print: what the worker prepares (printPlan.prepKeyOf, the one gate prepStarted states)', () => {
  const parts = ['# One\n', '# Two\n'];
  const sources: readonly (PrintSource | null)[] = [
    null,
    { kind: 'markdown', text: '# A\n', ready: false },
    { kind: 'markdown', text: '# A\n', ready: true },
    { kind: 'markdown-parts', parts, complete: false, at: 0 },
    { kind: 'markdown-parts', parts: [], complete: true, at: 0 },
    { kind: 'markdown-parts', parts, complete: true, at: 1 },
    { kind: 'text', parts: ['a'], name: 'a.txt', at: 0 },
    { kind: 'image', src: 'blob:x', name: 'a.png' },
    { kind: 'download-to-print', cls: 'pdf' },
  ];

  it('asks the worker exactly when the source is the worker\'s and prepStarted says it can start', () => {
    for (const s of sources) {
      const key = prepKeyOf(s);
      expect(key !== null, JSON.stringify(s)).toBe(s !== null && fromWorker(s) && prepStarted(s));
    }
  });

  it('keys a Markdown text by its text and parts by the parts array itself (a new array starts again)', () => {
    expect(prepKeyOf({ kind: 'markdown', text: '# A\n', ready: true })).toBe('# A\n');
    expect(prepKeyOf({ kind: 'markdown-parts', parts, complete: true, at: 1 })).toBe(parts);
  });

  // Review 4126 A6: the cases above pin `prepKeyOf`'s formula, not that the hook USES it. A text scan of the hook (its code, with
  // comments cut out): the prepare key is `prepKeyOf(source)`, and the hook states no gate of its own (the published source's
  // `ready`, `complete` or `parts.length`), which is how a second writer of the gate would come back.
  it('print: usePrint takes its prepare key from prepKeyOf and restates no gate of its own (review 4126 A6)', () => {
    const file = path.join(import.meta.dirname, '..', 'src', 'docs', 'print', 'usePrint.ts');
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code, 'the prepare key is prepKeyOf of the published source').toMatch(/\bconst prepKey\s*=\s*prepKeyOf\(\s*source\s*\)\s*;/);
    expect(code.match(/\bprepKey\s*=(?!=)/g) ?? [], 'one writer of the prepare key').toHaveLength(1);
    expect(code, 'no `ready` gate of a Markdown source written inline').not.toMatch(/\.ready\b/);
    expect(code, 'no `complete` gate of parts written inline').not.toMatch(/\.complete\b/);
    expect(code, 'no parts-count gate written inline').not.toMatch(/\.parts\.length\b/);
  });
});

// ---- which URL a printed image loads from ---------------------------------------------------------------------------------------

describe('print: which URL a printed image loads from (printPlan.imagesFor)', () => {
  const tree = treeOk({ entries: [entry('specs', 'a.md'), entry('specs', 'a.png'), entry('specs', 'b.svg')] });
  const page = leaf('/docs/demo/specs/a.md');
  const link: DocLinkContextValue = { ...linkBaseFor(page, tree, pinFor(tree, page), () => {}, page.variant ?? null), urls: new WeakMap() };
  const keyOf = (ref: string): string => {
    const plan = planImageRef(link, ref, null);
    if (plan.kind !== 'pinned') throw new Error(`fixture: ${ref} is not pinned`);
    return docsApi.file('demo', plan.pin);
  };
  const BYTES = Uint8Array.of(1, 2, 3) as Uint8Array<ArrayBuffer>;
  const SVG_URL = SVG_DATA_PREFIX + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const printed = (refs: readonly string[], frame: Readonly<Record<string, string>> | undefined, assets: ExportAssets | null): Map<string, string> => {
    const out = imagesFor(refs, frame, loadedImageOf(link, assets));
    // Whatever the map holds, no URL in it is a ref the document wrote.
    for (const [ref, url] of out) expect(url, ref).not.toBe(ref);
    return out;
  };

  it('a ref the frame loaded prints from the frame\'s URL', () => {
    const out = printed(['a.png', 'constructor'], { 'a.png': 'data:image/png;base64,FRAME' }, null);
    expect([...out]).toEqual([['a.png', 'data:image/png;base64,FRAME']]);
  });

  it('a ref the registry loaded as a raster prints from the data URL of its verified bytes', () => {
    const assets = createExportAssets();
    assets.track(keyOf('a.png')).report({ s: 'loaded', asset: { kind: 'raster', bytes: BYTES, mime: 'image/png' } });
    expect([...printed(['a.png'], undefined, assets)]).toEqual([['a.png', rasterDataUrl(BYTES, 'image/png')]]);
    expect(rasterDataUrl(BYTES, 'image/png')).toBe('data:image/png;base64,AQID');
  });

  it('a ref the registry loaded as an SVG prints from the data URL the page built, and from no other source', () => {
    const assets = createExportAssets();
    assets.track(keyOf('b.svg')).report({ s: 'loaded', asset: { kind: 'svg', src: SVG_URL } });
    expect([...printed(['b.svg'], undefined, assets)]).toEqual([['b.svg', SVG_URL]]);
    const other = createExportAssets();
    other.track(keyOf('b.svg')).report({ s: 'loaded', asset: { kind: 'svg', src: 'https://other.example/x.svg' } });
    expect([...printed(['b.svg'], undefined, other)]).toEqual([]);
  });

  it('a foreign ref prints no image, even with everything else loaded', () => {
    const assets = createExportAssets();
    assets.track(keyOf('a.png')).report({ s: 'loaded', asset: { kind: 'raster', bytes: BYTES, mime: 'image/png' } });
    const out = printed(['https://other.example/p.png', 'data:image/png;base64,AAAA', '//other.example/q.png'], undefined, assets);
    expect([...out]).toEqual([]);
  });

  it('a ref nothing loaded prints no image: still loading, failed, or not in the registry', () => {
    const assets = createExportAssets();
    assets.track(keyOf('a.png'));
    assets.track(keyOf('b.svg')).report({ s: 'failed' });
    expect([...printed(['a.png', 'b.svg', 'c.png'], undefined, assets)]).toEqual([]);
    expect([...printed(['a.png'], undefined, null)]).toEqual([]);
  });
});

// ---- through the Docs screen: what the page publishes, what is prepared, what the listeners mount, the Print row -------------------

URL.createObjectURL = vi.fn(() => 'blob:mock/print');
URL.revokeObjectURL = vi.fn();

/** matchMedia at `width`, as an engine at that width answers a min-width or max-width query. */
function atWidth(width: number): void {
  vi.stubGlobal('matchMedia', (q: string) => {
    const min = /min-width:\s*([\d.]+)px/.exec(q);
    const max = /max-width:\s*([\d.]+)px/.exec(q);
    const matches = (min === null || width >= Number(min[1])) && (max === null || width <= Number(max[1])) && (min !== null || max !== null);
    return {
      matches, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    };
  });
}

/** The screen under the live location, as the app's `docs` arm mounts it. */
function Routed(p: { readonly loaders: FakeLoaders['loaders']; readonly reader: ReaderDeps | null }): ReactNode {
  const { path: at, search } = useLocation();
  return <DocsScreen path={at} search={search} loaders={p.loaders} parser={async (src) => parseMarkdown(src, 'docs')} reader={p.reader} />;
}
function open(url: string, f: FakeLoaders, reader: ReaderDeps | null): void {
  // The compact width: Print lives in Page details, which the desk head does not have (the desk prints with Ctrl+P).
  atWidth(412);
  navigate(url);
  render(<Routed loaders={f.loaders} reader={reader} />);
}

const READER_RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [], imagesTruncated: false,
};

/** A reader whose frame is fake: `inputs` are the mounts, `print` the render jobs asked for a print tree (by source), and `answer`
 *  what each answers (the first part immediately, by default). The pre-pass and blocks jobs answer as the real job does. */
function rig(
  answer: (src: string) => Promise<ReaderRenderOutcome> = (src) => Promise.resolve(renderedWith(textTree(`PRINTED ${src.slice(0, 12)}`))),
  images: ReaderDeps['images'] = async () => ({ urls: {}, drafts: 0, auth: 0 }),
) {
  const inputs: ReaderMountInput[] = [];
  const print: { readonly src: string; readonly budgetMs: number }[] = [];
  const landed: string[] = [];
  const handle = { destroy: vi.fn(), setPrefs: vi.fn(), command: vi.fn(), openAt: vi.fn(), seed: { hosted: false as const }, follow: vi.fn() };
  const parser = vi.fn(async () => parseMarkdown('# x', 'docs'));
  const reader: ReaderDeps = {
    render: vi.fn(async (src, o) => {
      if (o.blocks === true) return realBlocks(src, { budgetMs: o.budgetMs, signal: o.signal ?? SIGNAL(), blocks: true });
      if (o.print !== true) return READER_RENDERED;
      print.push({ src, budgetMs: o.budgetMs });
      const out = await answer(src);
      landed.push(src);
      return out;
    }),
    mount: vi.fn(async (_el: HTMLElement, input: ReaderMountInput) => { inputs.push(input); return handle as unknown as ReaderMount; }),
    images: vi.fn(images),
  };
  return { reader, inputs, print, landed, parser };
}

const printRoot = (): HTMLElement | null => document.body.querySelector(':scope > .docs-print-root');
const fire = (name: 'beforeprint' | 'afterprint'): void => { act(() => { window.dispatchEvent(new Event(name)); }); };
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 30)); }); };
const b64Of = (b: Uint8Array): string => { let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s); };

/** `text` answered as the file of `path`, of the class `cls`. */
function fileAs(path: string, text: string, cls: DocsFileResponse['contentClass']): DocsFileAnswer {
  const r = fileResponse(text);
  return { s: 'ok', value: { ...r, contentClass: cls, show: { ...r.show, path, size: text.length } } };
}
/** A loader set whose tree lists `path` and whose file answers `answer`. */
function leafLoaders(path: string, answer: DocsFileAnswer, tree = treeOk({ entries: [entry('specs', path)] })): FakeLoaders {
  return fakeLoaders({ tree: okTree(tree), file: answer });
}

describe('print: from the Docs screen', () => {
  it('print: tree parsed only after ready, never on the main thread', async () => {
    const r = rig();
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    await settle();
    // The frame has mounted but not reported ready: no print tree has been asked for.
    expect(r.print).toHaveLength(0);
    // Ctrl+P now asks the worker for nothing: the handler only mounts, and what it mounts is the one line.
    fire('beforeprint');
    expect(r.print).toHaveLength(0);
    expect(printRoot()?.textContent).toBe(PRINT_PREPARING_LINE);
    fire('afterprint');
    // Ready: exactly one print render of this very text, asked of the worker through the reader's own render job.
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.landed).toHaveLength(1));
    await settle();
    expect(r.print).toEqual([{ src: '# A', budgetMs: DOCS_PARSE_BUDGET_MS(utf8Bytes('# A')) }]);
    // Later prints ask for nothing more: the handler mounts what is prepared.
    fire('beforeprint');
    fire('afterprint');
    fire('beforeprint');
    expect(r.print).toHaveLength(1);
    expect(printRoot()?.textContent).toBe('PRINTED # A');
    // And no print tree was parsed on the main thread: the screen's own parser was never asked.
    expect(r.parser).not.toHaveBeenCalled();
  });

  it('print: beforeprint mounts from the prepared tree, afterprint unmounts', async () => {
    const r = rig();
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.landed).toHaveLength(1));
    await settle();
    expect(printRoot()?.childElementCount ?? 0).toBe(0);
    fire('beforeprint');
    const root = printRoot();
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-theme')).toBe('light');
    expect(root?.querySelector('.docs-print-view')?.textContent).toBe('PRINTED # A');
    fire('afterprint');
    // The root stays, empty; the next print mounts into the same node, which was appended once.
    expect(printRoot()).toBe(root);
    expect(root?.childElementCount).toBe(0);
    fire('beforeprint');
    expect(document.body.querySelectorAll('.docs-print-root')).toHaveLength(1);
    expect(root?.textContent).toBe('PRINTED # A');
    fire('afterprint');
    expect(root?.childElementCount).toBe(0);
    // A page that publishes nothing (a listing) mounts no view: the browser prints it as it is.
    act(() => { navigate('/docs/demo/specs/'); });
    await settle();
    fire('beforeprint');
    expect(printRoot()?.childElementCount ?? 0).toBe(0);
  });

  it('print: Ctrl+P before the tree is ready prints the one-line page', async () => {
    const r = rig(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe('Docs is preparing this page for print; print again in a moment.');
    expect(printRoot()?.querySelectorAll('.docs-print-view >*')).toHaveLength(1);
    expect(printRoot()?.querySelector('.docs-print-view >p.docs-print-line')).not.toBeNull();
    fire('afterprint');
    // Ready, but the worker has not answered: still the one line.
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.print).toHaveLength(1));
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe(PRINT_PREPARING_LINE);
  });

  it('print: a PDF or an HTML page offers Download to print, and Ctrl+P prints the one line', async () => {
    const pdf = new Uint8Array(40).fill(65);
    pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
    const pdfAnswer: DocsFileAnswer = {
      s: 'ok',
      value: {
        ok: true, contentClass: 'pdf', from: 'ccd',
        show: { v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'a.pdf', size: pdf.length, sha256: 'c'.repeat(64), encoding: 'base64', b64: b64Of(pdf) },
      },
    };
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record(this: HTMLAnchorElement) { clicks.push(this); });
    const f = leafLoaders('a.pdf', pdfAnswer);
    open('/docs/demo/specs/a.pdf', f, null);
    const row = await screen.findByRole('button', { name: PRINT_ROW_TEXT.downloadToPrint, hidden: true });
    expect(row).toHaveClass('docs-action', 'docs-print');
    expect(screen.queryByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true })).toBeNull();
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe(PRINT_PDF_LINE);
    fire('afterprint');
    // The row starts the page's own download of the file (the one the leaf's Download button makes).
    fireEvent.click(row);
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]!.download).toBe('a.pdf');
    expect(f.file).toHaveBeenCalled();
    cleanup();

    const html = fileAs('a.html', '<p>hi</p>', 'html');
    open('/docs/demo/specs/a.html', leafLoaders('a.html', html), null);
    expect(await screen.findByRole('button', { name: PRINT_ROW_TEXT.downloadToPrint, hidden: true })).toBeEnabled();
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe(PRINT_HTML_LINE);
    expect(PRINT_HTML_LINE).toContain("Opening it runs it outside Docs' protections.");
    fire('afterprint');
  });

  it('print: the Print row waits at most 10 s a part and says which part it prepares', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const printed = vi.spyOn(window, 'print').mockImplementation(() => {});
    // Two parts: the first is answered at once, the second never.
    const r = rig((src) => (src.length > DOCS_RENDER_GATE_BYTES - 1000 && src.startsWith('# ') ? Promise.resolve(renderedWith(textTree('FIRST PART'))) : new Promise<never>(() => {})));
    const text = `# Head\n\n${sized(DOCS_RENDER_GATE_BYTES + 1)}`;
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', text, 'markdown')), r.reader);
    const row = await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    await waitFor(() => expect(r.print.length).toBeGreaterThan(0));
    await waitFor(() => expect(r.landed).toHaveLength(1));
    fireEvent.click(row);
    // The second part is the one it waits for, and the row is off and says so.
    const busy = await screen.findByRole('button', { name: 'Preparing part 2 of 2…', hidden: true });
    expect(busy).toBeDisabled();
    expect(printed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_WAIT_MS - 500); });
    expect(printed).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Preparing part 2 of 2…', hidden: true })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    // At ten seconds the part is let go and prints as its plain text; the window prints, and the row is Print again.
    await waitFor(() => expect(printed).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true })).toBeEnabled();
    fire('beforeprint');
    const view = printRoot()?.querySelector('.docs-print-view') as HTMLElement;
    expect(view.children).toHaveLength(2);
    expect(view.children[0]?.textContent).toBe('FIRST PART');
    expect(view.children[1]?.querySelector('p.docs-print-note')?.textContent).toBe(PRINT_NOT_READY);
    expect(view.children[1]?.querySelector('pre')).not.toBeNull();
    expect(view.children[1]?.classList.contains('docs-print-part')).toBe(true);
  }, 60000);

  it('print: an image leaf prints the URL the leaf shows', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    open('/docs/demo/specs/a.svg', leafLoaders('a.svg', fileAs('a.svg', svg, 'svg')), null);
    const shown = await waitFor(() => {
      const img = document.querySelector<HTMLImageElement>('.docs-leaf img.docs-svg-img');
      expect(img).not.toBeNull();
      return img as HTMLImageElement;
    });
    expect(shown.getAttribute('src')).toBe('data:image/svg+xml;base64,' + btoa(svg));
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    const printed = printRoot()?.querySelector('img');
    expect(printed?.getAttribute('src')).toBe(shown.getAttribute('src'));
    expect(printRoot()?.querySelector('figure > figcaption')?.textContent).toBe('a.svg');
    fire('afterprint');
    cleanup();

    // A raster leaf: the image the page loaded (its verified bytes, from the visit's registry), never one the document named.
    const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 255);
    const f = leafLoaders('a.png', fileAs('a.png', '', 'other'));
    f.raster.mockResolvedValue({ s: 'ok', value: { bytes: png, mime: 'image/png' } });
    open('/docs/demo/specs/a.png', f, null);
    await waitFor(() => expect(document.querySelector('.docs-leaf img')).not.toBeNull());
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    expect(printRoot()?.querySelector('img')?.getAttribute('src')).toBe(`data:image/png;base64,${b64Of(png)}`);
    expect(printRoot()?.querySelector('figcaption')?.textContent).toBe('a.png');
  });

  it('print: a text leaf prints its text in one pre', async () => {
    const text = 'line one <b>not bold</b>\nline two';
    open('/docs/demo/specs/x.txt', leafLoaders('x.txt', fileAs('x.txt', text, 'text')), null);
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    const pres = printRoot()?.querySelectorAll('pre') ?? [];
    expect(pres).toHaveLength(1);
    expect(pres[0]?.textContent).toBe(text);
    expect(printRoot()?.querySelector('b')).toBeNull();
    fire('afterprint');
  });

  it('print: a draft prints its banner, a committed doc none', async () => {
    const answerAs = (draft: boolean): DocsFileAnswer => {
      const a = fileAs('x.txt', 'body text', 'text');
      if (a.s !== 'ok' || !draft) return a;
      const show = a.value.show;
      return { s: 'ok', value: { ...a.value, show: { ...show, source: 'draft', branch: 'main', head: COMMIT_A, fp: FP_1 } as typeof show } };
    };
    const drafted = treeOk({ drafts: holder(), entries: [entry('specs', 'x.txt', { draft: draftOf('modified') })] });
    open('/docs/demo/specs/x.txt?ref=main', leafLoaders('x.txt', answerAs(true), drafted), null);
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    const banner = printRoot()?.querySelector('.docs-print-view >p.docs-print-banner');
    expect(banner?.textContent).toContain('Draft, not committed.');
    expect(banner?.textContent).toContain(`sha256:${FP_1.slice(0, 12)}`);
    expect(printRoot()?.querySelector('.docs-print-view')?.firstElementChild).toBe(banner);
    expect(printRoot()?.querySelector('pre')?.textContent).toBe('body text');
    fire('afterprint');
    cleanup();

    open('/docs/demo/specs/x.txt', leafLoaders('x.txt', answerAs(false)), null);
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    expect(printRoot()?.querySelector('.docs-print-banner')).toBeNull();
    expect(printRoot()?.textContent).not.toContain('Draft, not committed');
    expect(printRoot()?.querySelector('pre')?.textContent).toBe('body text');
  });

  it("print: Download to print starts the page's download for a PDF and an HTML page", async () => {
    const clicks: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record(this: HTMLAnchorElement) { clicks.push(this); });
    const pdf = new Uint8Array(40).fill(65);
    pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
    const pdfAnswer: DocsFileAnswer = {
      s: 'ok',
      value: {
        ok: true, contentClass: 'pdf', from: 'ccd',
        show: { v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'a.pdf', size: pdf.length, sha256: 'c'.repeat(64), encoding: 'base64', b64: b64Of(pdf) },
      },
    };
    for (const [path, answer, bytes] of [['a.pdf', pdfAnswer, pdf.length], ['a.html', fileAs('a.html', '<p>hi</p>', 'html'), 9]] as const) {
      const f = leafLoaders(path, answer);
      open(`/docs/demo/specs/${path}`, f, null);
      const row = await screen.findByRole('button', { name: PRINT_ROW_TEXT.downloadToPrint, hidden: true });
      expect(row).toBeEnabled();
      const asked = f.file.mock.calls.length;
      fireEvent.click(row);
      await waitFor(() => expect(clicks.filter((c) => c.download === path)).toHaveLength(1));
      // It read the file through the file route, as the leaf's own Download does, and saved the file's bytes under its name.
      expect(f.file.mock.calls.length).toBeGreaterThan(asked);
      expect(f.file.mock.calls.at(-1)?.[1]).toMatchObject({ kind: 'committed', path });
      const blob = vi.mocked(URL.createObjectURL).mock.calls.at(-1)?.[0] as Blob;
      expect(blob.type).toBe('application/octet-stream');
      expect(blob.size).toBe(bytes);
      expect(screen.queryByRole('alert')).toBeNull();
      cleanup();
    }
  });

  it('print: with no download reachable the row is disabled with its reason', async () => {
    // A PDF above the class cap is read by range: the file route would refuse it, so the head has no download of it to start.
    const size = 3 * 1048576;
    const bytes = new Uint8Array(size).fill(65);
    bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
    const served = servingLoader(bytes);
    const f = fakeLoaders({
      tree: okTree(treeOk({ entries: [entry('specs', 'a.pdf', { committed: { kind: 'file', blob: '2'.repeat(40), size } })] })),
      file: failedAnswer('too-large') as DocsFileAnswer,
    });
    const loaders = { ...f.loaders, range: served.loader };
    atWidth(412);
    navigate('/docs/demo/specs/a.pdf');
    render(<Routed loaders={loaders} reader={null} />);
    const row = await screen.findByRole('button', { name: `${PRINT_ROW_TEXT.downloadToPrint}: ${PRINT_ROW_TEXT.noDownload}`, hidden: true }, { timeout: 30000 });
    expect(row).toBeDisabled();
    expect(row.getAttribute('title')).toBe(`${PRINT_ROW_TEXT.downloadToPrint}: ${PRINT_ROW_TEXT.noDownload}`);
    fireEvent.click(row);
    await settle();
    // Ctrl+P still prints the PDF's one line.
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe(PRINT_PDF_LINE);
  }, 90000);

  it('print: a doc link prints its in-app target as text, any other link prints nothing', async () => {
    const md = 'See [the doc](other.md#part), [far](https://far.example/p) and [mail](mailto:a@b.example).';
    const r = rig((src) => realRender(src, { budgetMs: 5000, print: true }));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', md, 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.landed).toHaveLength(1));
    await settle();
    fire('beforeprint');
    const text = printRoot()?.textContent ?? '';
    // The doc link: its words, then the page it opens in Docs, as text (never a link: the view makes none for it).
    expect(text).toContain(`the doc (${location.origin}/docs/demo/specs/other.md#part)`);
    expect(printRoot()?.querySelectorAll('a[href]')).toHaveLength(0);
    // Any other link: its words alone, and the address nowhere in the printed page.
    expect(text).toContain('far and mail.');
    expect(printRoot()?.innerHTML).not.toContain('far.example');
    expect(printRoot()?.innerHTML).not.toContain('a@b.example');
  });

  it('print: the Print row prints the view, not the console', async () => {
    // The window's print is called with the print view already in the document: what it holds at that moment is what prints.
    const seen: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => { seen.push(printRoot()?.textContent ?? '<empty>'); });
    const done = (): void => { seen.length = 0; fire('afterprint'); cleanup(); };

    // A prepared Markdown doc: the press prints at once, in the tap itself.
    const a = rig();
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), a.reader);
    await waitFor(() => expect(a.inputs.length).toBeGreaterThan(0));
    act(() => { a.inputs[0]!.onReady(); });
    await waitFor(() => expect(a.landed).toHaveLength(1));
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    expect(seen).toEqual(['PRINTED # A']);
    done();

    // A text leaf: nothing to wait for.
    open('/docs/demo/specs/x.txt', leafLoaders('x.txt', fileAs('x.txt', 'one\ntwo', 'text')), null);
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    expect(seen).toEqual(['one\ntwo']);
    done();

    // A doc in two parts, both prepared.
    const text = `# Head\n\n${sized(DOCS_RENDER_GATE_BYTES + 1)}`;
    const two = rig((src) => Promise.resolve(renderedWith(textTree(`PART ${src.slice(0, 6)}`))));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', text, 'markdown')), two.reader);
    await waitFor(() => expect(two.landed).toHaveLength(2), { timeout: 20000 });
    await settle();
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^PART # HeadPART \w{6}$/);
    done();

    // Pressed before the tree is in: it waits, then prints from a task of its own (never from inside React's commit).
    const slow = rig((src) => new Promise((resolve) => { setTimeout(() => resolve(renderedWith(textTree(`LATE ${src.slice(0, 3)}`))), 80); }));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), slow.reader);
    await waitFor(() => expect(slow.inputs.length).toBeGreaterThan(0));
    act(() => { slow.inputs[0]!.onReady(); });
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    expect(seen).toEqual([]);
    await waitFor(() => expect(seen).toEqual(['LATE # A']));
  }, 60000);

  it('print: which URL a printed image loads from, through the screen: the frame\'s, never the document\'s', async () => {
    const md = '![Loaded](a.png)\n\n![Foreign](https://other.example/p.png)\n';
    const r = rig((src) => realRender(src, { budgetMs: 5000, print: true }), async () => ({ urls: { 'a.png': 'data:image/png;base64,QUJD' }, drafts: 0, auth: 0 }));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', md, 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    await waitFor(() => expect(r.reader.images).toHaveBeenCalled());
    await settle();
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.landed).toHaveLength(1));
    await settle();
    fire('beforeprint');
    const imgs = [...(printRoot()?.querySelectorAll('img') ?? [])];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['data:image/png;base64,QUJD']);
    expect(imgs[0]?.getAttribute('alt')).toBe('Loaded');
    expect(printRoot()?.textContent).toContain('[Foreign]');
    expect(printRoot()?.innerHTML).not.toContain('other.example');
  });

  it('print: a beforeprint with nothing published empties the root, so a stale view never prints', async () => {
    open('/docs/demo/specs/x.txt', leafLoaders('x.txt', fileAs('x.txt', 'stale text', 'text')), null);
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    expect(printRoot()?.textContent).toBe('stale text');
    // No afterprint came; the page moves on to a listing, which publishes nothing.
    act(() => { navigate('/docs/demo/specs/'); });
    await settle();
    fire('beforeprint');
    expect(printRoot()?.childElementCount ?? 0).toBe(0);
    expect(document.body.hasAttribute('data-docs-printing')).toBe(false);
  });

  it('print: the body is marked while the view is mounted, and the printed page is forced light', async () => {
    document.body.setAttribute('data-theme', 'phosphor');
    try {
      open('/docs/demo/specs/x.txt', leafLoaders('x.txt', fileAs('x.txt', 'text', 'text')), null);
      await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
      expect(document.body.hasAttribute('data-docs-printing')).toBe(false);
      fire('beforeprint');
      expect(document.body.hasAttribute('data-docs-printing')).toBe(true);
      expect(document.body.getAttribute('data-theme')).toBe('light');
      fire('afterprint');
      expect(document.body.hasAttribute('data-docs-printing')).toBe(false);
      expect(document.body.getAttribute('data-theme'), 'the console\'s own value is put back').toBe('phosphor');
      fire('beforeprint');
      cleanup();
      await settle();
      expect(document.body.hasAttribute('data-docs-printing'), 'leaving the screen leaves nothing marked').toBe(false);
      expect(document.body.getAttribute('data-theme')).toBe('phosphor');
    } finally {
      document.body.removeAttribute('data-theme');
    }
    // The print sheet hides the console by the mark as well as by `:has`, and forces the light palette on html and body.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');
    expect(css).toContain('body[data-docs-printing] > :not(.docs-print-root)');
    expect(css).toContain('body:has(> .docs-print-root > *) > :not(.docs-print-root)');
    expect(css).toMatch(/@media print \{[^@]*html:has\(> body\[data-docs-printing\]\) \{[^}]*color-scheme: light/);
    expect(css).toMatch(/body\[data-docs-printing\] \{[^}]*color-scheme: light/);
  });

  it('print: a part that was not ready in time is asked again at the next press', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const printed: string[] = [];
    vi.spyOn(window, 'print').mockImplementation(() => { printed.push(printRoot()?.textContent ?? '<empty>'); });
    // The docs queue was busy: the first ask never comes back in time; the second answers.
    let asks = 0;
    const r = rig(() => { asks += 1; return asks === 1 ? new Promise<never>(() => {}) : Promise.resolve(renderedWith(textTree('RETRIED'))); });
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.print).toHaveLength(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(PRINT_WAIT_MS + 100); });
    // For the rest of the visit Ctrl+P would print the part as plain text under its sentence...
    fire('beforeprint');
    expect(printRoot()?.textContent).toContain(PRINT_NOT_READY);
    fire('afterprint');
    // ...but the row asks again, and prints the tree.
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    await waitFor(() => expect(printed).toEqual(['RETRIED']));
    expect(r.print).toHaveLength(2);
  }, 60000);

  it('print: the row\'s wait runs from the press, and a republished source does not restart it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const printed = vi.spyOn(window, 'print').mockImplementation(() => {});
    const r = rig(() => new Promise<never>(() => {}));
    open('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    fireEvent.click(await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    // The frame reports ready six seconds in: the source is published again, and the wait is still the one the press started.
    act(() => { r.inputs[0]!.onReady(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
    expect(printed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(printed).toHaveBeenCalledTimes(1);
  }, 60000);

  it('print: a document read by range prints the banner of the pin its read opened (the snapshot digest)', async () => {
    const src = new TextEncoder().encode('hello\n') as Uint8Array<ArrayBuffer>;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', src))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const tree = treeOk({
      drafts: holder(), entries: [entry('specs', 'a.log', { draft: draftOf('modified', { fp: null, size: src.length, mtimeNs: '1700000000000000000' }) })],
    });
    const f = fakeLoaders({ tree: okTree(tree) });
    atWidth(412);
    navigate('/docs/demo/specs/a.log?ref=main');
    render(<Routed loaders={{ ...f.loaders, range: servingLoader(src).loader }} reader={null} />);
    await waitFor(() => expect(document.querySelector('pre.doc-plain')?.textContent).toBe('hello\n'));
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    const banner = printRoot()?.querySelector('.docs-print-view > p.docs-print-banner')?.textContent ?? '';
    expect(banner).toContain('Draft, not committed.');
    expect(banner).toContain(`sha256:${digest.slice(0, 12)}`);
    expect(banner).toMatch(/Read \d{4}-\d\d-\d\dT[\d:.]+Z\./);
    expect(printRoot()?.querySelector('pre')?.textContent).toBe('hello\n');
  }, 60000);

  it('print: Markdown that is not UTF-8, shown as plain text, prints that text', async () => {
    const r = rig();
    const base = fileAs('a.md', '', 'markdown');
    if (base.s !== 'ok') throw new Error('fixture');
    const show = { ...base.value.show, encoding: 'base64' as const, b64: b64Of(Uint8Array.of(0x68, 0x69, 0xff)), size: 3 };
    delete (show as { text?: string }).text;
    open('/docs/demo/specs/a.md', leafLoaders('a.md', { s: 'ok', value: { ...base.value, show } }), r.reader);
    await waitFor(() => expect(document.querySelector('.docs-leaf pre.doc-plain')?.textContent).toBe('hi�'));
    await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    fire('beforeprint');
    expect(printRoot()?.querySelector('pre')?.textContent).toBe('hi�');
    expect(r.print, 'a text source is drawn at once: the worker is not asked').toHaveLength(0);
  });

  it('print: a failed download is said below the row, outside the bar and the row\'s own box', async () => {
    const pdf = new Uint8Array(40).fill(65);
    pdf.set(new TextEncoder().encode('%PDF-1.7\n'));
    const answer: DocsFileAnswer = {
      s: 'ok',
      value: {
        ok: true, contentClass: 'pdf', from: 'ccd',
        show: { v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: 'specs', path: 'a.pdf', size: pdf.length, sha256: 'c'.repeat(64), encoding: 'base64', b64: b64Of(pdf) },
      },
    };
    for (const width of [412]) {
      const f = leafLoaders('a.pdf', answer);
      atWidth(width);
      navigate('/docs/demo/specs/a.pdf');
      render(<Routed loaders={f.loaders} reader={null} />);
      const row = await screen.findByRole('button', { name: PRINT_ROW_TEXT.downloadToPrint, hidden: true });
      f.file.mockImplementation(async () => failedAnswer('absent-path') as DocsFileAnswer);
      fireEvent.click(row);
      const note = await screen.findByText(/^Download failed: /);
      expect(note.getAttribute('role')).toBe('alert');
      expect(note.closest('.docs-actions'), `${width}px: not inside the row's flex box`).toBeNull();
      expect(note.closest('.docs-compact-bar'), `${width}px: not inside the bar`).toBeNull();
      expect(note.closest('.docs-head'), `${width}px: it is the head's, under the row`).not.toBeNull();
      cleanup();
    }
  }, 60000);

  it('print: Print is in Page details only: the desk row has none, and the desk prints with Ctrl+P', async () => {
    atWidth(1280);
    navigate('/docs/demo/specs/x.txt');
    render(<Routed loaders={leafLoaders('x.txt', fileAs('x.txt', 'desk text', 'text')).loaders} reader={null} />);
    await waitFor(() => expect(document.querySelector('.docs-leaf pre.doc-plain')?.textContent).toBe('desk text'));
    await screen.findByRole('button', { name: 'Export' });
    expect(document.querySelector('button.docs-print'), 'the desk row has no Print').toBeNull();
    fire('beforeprint');
    expect(printRoot()?.querySelector('pre')?.textContent).toBe('desk text');
    fire('afterprint');
    cleanup();
    // The compact row: the icon strip has none either; the panel does, with its word.
    atWidth(412);
    navigate('/docs/demo/specs/x.txt');
    render(<Routed loaders={leafLoaders('x.txt', fileAs('x.txt', 'desk text', 'text')).loaders} reader={null} />);
    const inPanel = await screen.findByRole('button', { name: PRINT_ROW_TEXT.print, hidden: true });
    expect(inPanel.closest('.docs-more-panel')).not.toBeNull();
    expect(document.querySelector('.docs-compact-bar button.docs-print')).toBeNull();
    expect(inPanel.textContent).toBe('Print');
  });

  // Characterization (X2 P6.1 Step 1, part B fix 2): the link context a leaf builds for its body, as the reader's image loader receives
  // it. Green on `DocsLeaf`'s own inline formula; after it moved to `docsLinkBase.ts#linkBaseFor`, the same cases hold, and so does
  // equality with the function. (An outside folder's file is drawn by `FolderPages`, which builds no link context: no third arm.)
  describe('the link context of a leaf', () => {
    async function ctxOf(url: string, f: FakeLoaders): Promise<DocLinkContextValue> {
      const r = rig();
      open(url, f, r.reader);
      await waitFor(() => expect(r.reader.images).toHaveBeenCalled());
      return vi.mocked(r.reader.images).mock.calls[0]![1];
    }
    /** What the leaf built is what `linkBaseFor` answers for the same page, tree and pin (the URL map and the callback aside). */
    const sameAsTheFunction = (ctx: DocLinkContextValue, url: string, tree: ReturnType<typeof treeOk>): void => {
      const page = pageAt(url);
      if (page.kind !== 'path') throw new Error('fixture');
      const { urls: _u, onFragment: _o, ...built } = ctx;
      const { onFragment: _f, ...answered } = linkBaseFor(page, tree, pinFor(tree, page), () => {}, page.variant ?? null);
      expect(built).toEqual(answered);
    };
    const draftAnswer = (): DocsFileAnswer => {
      const a = fileAs('a.md', '# A', 'markdown');
      if (a.s !== 'ok') return a;
      const show = a.value.show;
      return { s: 'ok', value: { ...a.value, show: { ...show, source: 'draft', branch: 'main', head: COMMIT_A, fp: FP_1 } as typeof show } };
    };

    it('a committed doc: its project, ref, version, view, place, tree and committed source', async () => {
      const tree = treeOk({ entries: [entry('specs', 'a.md')] });
      const ctx = await ctxOf('/docs/demo/specs/a.md', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown'), tree));
      expect(ctx).toMatchObject({
        project: 'demo', pageRef: null, pageAt: null, view: 'effective', section: 'specs', path: 'a.md', pageSource: 'committed',
      });
      expect(ctx.tree).toEqual(tree);
      expect(Object.keys(ctx).sort()).toEqual(['onFragment', 'pageAt', 'pageRef', 'pageSource', 'pageVariant', 'path', 'project', 'section', 'tree', 'urls', 'view']);
      sameAsTheFunction(ctx, '/docs/demo/specs/a.md', tree);
    });

    it('a draft: the same, with its ref and a draft source', async () => {
      const tree = treeOk({ drafts: holder(), entries: [entry('specs', 'a.md', { draft: draftOf('modified') })] });
      const page = pageAt('/docs/demo/specs/a.md?ref=main');
      if (page.kind !== 'path') throw new Error('fixture');
      const ctx = await ctxOf('/docs/demo/specs/a.md?ref=main', leafLoaders('a.md', draftAnswer(), tree));
      expect(ctx).toMatchObject({ project: 'demo', pageRef: page.ref, pageAt: null, view: 'effective', section: 'specs', path: 'a.md', pageSource: 'draft' });
      expect(page.ref).not.toBeNull();
      sameAsTheFunction(ctx, '/docs/demo/specs/a.md?ref=main', tree);
    });

    it('a version page: its commit, and a committed source', async () => {
      const tree = treeOk({ entries: [entry('specs', 'a.md')] });
      const ctx = await ctxOf(`/docs/demo/specs/a.md?at=${COMMIT_B}`, leafLoaders('a.md', fileAs('a.md', '# A', 'markdown'), tree));
      expect(ctx).toMatchObject({ project: 'demo', pageRef: null, pageAt: COMMIT_B, view: 'effective', path: 'a.md', pageSource: 'committed' });
      sameAsTheFunction(ctx, `/docs/demo/specs/a.md?at=${COMMIT_B}`, tree);
    });
  });

  it('layouts: after a Layout choice on a ?variant page, Open committed view, Back to the draft, a version and Print\'s links carry no variant', async () => {
    // I-2: "a Layout choice ended the visit's variant at this address" has ONE owner (`layoutPref.ts`), and the Docs screen derives the
    // page it hands every view from it, so every link built from the page follows, none reading the raw address. The address itself is
    // left as it is. Each link is read before the choice (it names the visit's variant) and after it.
    const draftTree = treeOk({ drafts: holder(), entries: [entry('specs', 'a.md', { draft: draftOf('modified') })] });
    const linkNamed = (name: string): string | null => {
      const a = [...document.querySelectorAll('a')].find((x) => (x.getAttribute('aria-label') ?? x.textContent ?? '').includes(name));
      return a?.getAttribute('href') ?? null;
    };
    const arms: ReadonlyArray<{ what: string; url: string; tree?: ReturnType<typeof treeOk>; read: () => string | null; before: string; after: string }> = [
      {
        what: 'Open committed version', url: '/docs/demo/specs/a.md?ref=main&variant=B', tree: draftTree,
        read: () => linkNamed(DOCS_HEAD_TEXT.openCommitted),
        before: '/docs/demo/specs/a.md?ref=main&view=committed&variant=B', after: '/docs/demo/specs/a.md?ref=main&view=committed',
      },
      {
        what: 'Back to the draft', url: '/docs/demo/specs/a.md?ref=main&view=committed&variant=B', tree: draftTree,
        read: () => linkNamed(DOCS_BANNER_TEXT.backToDraft),
        before: '/docs/demo/specs/a.md?ref=main&variant=B', after: '/docs/demo/specs/a.md?ref=main',
      },
      {
        what: 'Back to the latest', url: `/docs/demo/specs/a.md?at=${COMMIT_B}&variant=B`,
        read: () => linkNamed(DOCS_HEAD_TEXT.backToLatest),
        before: '/docs/demo/specs/a.md?variant=B', after: '/docs/demo/specs/a.md',
      },
    ];
    for (const arm of arms) {
      const r = rig();
      open(arm.url, leafLoaders('a.md', fileAs('a.md', '# A', 'markdown'), arm.tree), r.reader);
      await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
      await waitFor(() => expect(arm.read(), `${arm.what}: before a choice`).toBe(arm.before));
      act(() => { chooseReaderLayout('guided'); });
      await waitFor(() => expect(arm.read(), `${arm.what}: after a choice`).toBe(arm.after));
      expect(location.pathname + location.search, `${arm.what}: the address was changed`).toBe(arm.url);
      cleanup();
      resetReaderLayoutChoiceForTests();
    }
    // Print's links: the printed tree's doc link names its target, built from the page the screen handed Print.
    const linked: PrintTree = {
      nodes: [{ t: 'el', n: 'p', a: {}, c: [{ t: 'el', n: 'a', a: { target: 'other.md' }, c: [{ t: 'text', v: 'the doc' }] }] }],
    };
    const r = rig(() => Promise.resolve(renderedWith(linked)));
    open('/docs/demo/specs/a.md?variant=B', leafLoaders('a.md', fileAs('a.md', '# A', 'markdown')), r.reader);
    await waitFor(() => expect(r.inputs.length).toBeGreaterThan(0));
    act(() => { r.inputs[0]!.onReady(); });
    await waitFor(() => expect(r.landed).toHaveLength(1));
    await settle();
    fire('beforeprint');
    // The target is an absolute address on the page's origin, so the page's own path and query are what is read.
    expect(printRoot()?.textContent, 'CONTROL: before a choice a printed doc link names the variant').toContain('/docs/demo/specs/other.md?variant=B)');
    fire('afterprint');
    act(() => { chooseReaderLayout('guided'); });
    fire('beforeprint');
    expect(printRoot()?.textContent, 'after a choice a printed doc link still names the variant').toContain('/docs/demo/specs/other.md)');
    expect(printRoot()?.textContent).not.toContain('variant');
    fire('afterprint');
  });

  it('print: no allow-modals anywhere', () => {
    // The existing token scans cover the Docs sources, `pwa/src/docs/print` included (the folder is under `pwa/src/docs`); find them.
    const roots = ['src/docs', 'src/lib'].map((d) => path.join(import.meta.dirname, '..', d));
    const files: string[] = [];
    for (const root of roots) {
      for (const n of readdirSync(root, { recursive: true, encoding: 'utf8' })) if (/\.(ts|tsx)$/.test(n)) files.push(path.join(root, n));
    }
    expect(files.some((f) => f.includes(`${path.sep}print${path.sep}`))).toBe(true);
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/allow-modals/);
    }
  });
});
