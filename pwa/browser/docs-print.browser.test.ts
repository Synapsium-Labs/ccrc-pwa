// @vitest-environment node
// Print's browser leg, in a real Chromium over the production build (X2 P6.1 Step 1; spec 2026-11-18 4.6 "How"; plan Task P6.1,
// the three browser cases of Step 1 and the lab line). jsdom cannot lay a page out or print it, so these rows hold what only an
// engine can: that `page.pdf()` (Chromium's own print path, which fires `beforeprint` before it lays the page out and
// `afterprint` after it) reaches the print view's mount, that the printed page holds the document's text and not the console's,
// and that the frame and the console's chrome are `display: none` under print media (M11.25).
//
//   1. `print: page.pdf holds every PR1 and PR2 block of the fixture`: a Markdown fixture of every block the render prints (headings,
//      paragraphs, lists, a table, a fenced code block, a callout, a footnote, an image the page loads, `details` and `summary`,
//      `sup`, `sub`, `kbd`, a comment anchor, a Mermaid figure printed as its source with its caption) is opened, the reader's
//      `ready` and the prepared print tree awaited, and the PDF's text read back with pdfjs: every block's text is there and the
//      console's chrome words (the head's actions, the rail's lines) are not.
//   2. `print: page.pdf of an image leaf and of a text leaf holds the image and the text`.
//   3. `print: under print media the frame and console chrome are not rendered` (M11.25), with a CONTROL: the same page with the
//      print stylesheet's hiding rule overridden prints the frame's own words, so the detector is not blind.
//   4. The lab line `PRINT-L-3.4MiB`: the 3.4 MiB (3 565 158 bytes) fixture read by range (the range route is faked: a prepare and
//      seven frames, each with its sha256, as the PWA checks them) and printed whole; the time from the Print tap to `page.pdf()`
//      resolving, the print root's element count and the page's JS heap before and after.
//   5. The head's widths with the Print row (`PRINT-HEAD`): at 1280 x 800 and 1440 x 900 the desk row stays one line and the head within
//      HEAD_MAX; at 412 x 915 the compact row's controls are a tap each and nothing scrolls sideways.
//
// Which print trigger Chromium fires: `page.pdf()` fires `beforeprint` and then `afterprint` on the page itself (measured by the
// `trigger` case below), so the cases need no synthetic event for the print; the ONE synthetic dispatch is `waitPrepared`'s probe
// of whether the worker has finished the tree (the hook shows no state of its own), which mounts and empties the view through
// the hook's own listeners. `window.print` is stubbed only where a case taps the Print row, because a headless Chromium's
// `window.print()` has no dialog to answer.
//
// The PDF's text is read with pdfjs-dist's legacy build in this node process. Chromium only on this box (`resolveChrome`).
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/docs-print.browser.test.ts )`, through `ccrc test`.
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import {
  DOC_SECTION_SLUGS, DOCS_RANGE_FRAME_BYTES, DOCS_RESPONSE_HEADERS, type DocSectionSlug,
} from '../../shared/docs';
import { DOCS_HEAD_TEXT, DOCS_TOOL_TEXT } from '../src/docs/docsText';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { PRINT_WHOLE_MAX_ELEMENTS } from '../src/docs/print/printPlan';
import { PRINT_TOO_LONG } from '../src/docs/print/printWords';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { HEAD_MAX, TAP } from './docsHeadBudgets';
import { MEASURE } from './measurement';
import { onePixelPng, resolveChrome } from './harness';

const PROJECT = 'demo';
const SECTION: DocSectionSlug = DOC_SECTION_SLUGS[0]!;
const JSON_TYPE = 'application/json; charset=utf-8';

let dist: string | undefined;
let server: DistServer | undefined;
let browser: Browser | undefined;
const execFileAsync = promisify(execFile);
/** A switch value no other browser on the box carries, so the lab's memory reading is of this test's processes alone. */
const BROWSER_MARKER = `printlab-${process.pid}-${Date.now()}`;

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-precise-memory-info', `--ccrc-print-lab=${BROWSER_MARKER}`] });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

// ---- the fixtures ---------------------------------------------------------------------------------------------------------

/** One file the fake `/api/docs` serves: its listed name, its class and its bytes. */
type Spec =
  | { readonly name: string; readonly kind: 'markdown' | 'text'; readonly text: string }
  | { readonly name: string; readonly kind: 'raster'; readonly bytes: Uint8Array };

const bytesOf = (s: Spec): Buffer => (s.kind === 'raster' ? Buffer.from(s.bytes) : Buffer.from(s.text, 'utf8'));
/** A 40-hex blob id of its own for each name (the listing and the pin carry it; nothing checks it against the bytes). */
const blobOf = (name: string): string => createHash('sha1').update(name).digest('hex');
const sha256Of = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** Every block the render prints, each carrying a token of its own that no console word contains. */
const FIXTURE_NAME = 'handbook.md';
const FIXTURE = [
  '# Handbook fixture title',
  '',
  'Opening paragraph PARAALPHA with **bold WORDBOLD** and a [local link](#second-heading) back.',
  '',
  '## Second heading',
  '',
  '- bullet LISTONE',
  '- bullet LISTTWO',
  '  - nested NESTEDITEM',
  '',
  '1. ordered ORDEREDONE',
  '2. ordered ORDEREDTWO',
  '',
  '| HEADCOLA | HEADCOLB |',
  '|---|---|',
  '| CELLAONE | CELLBONE |',
  '',
  '```ts',
  'const CODETOKEN = 1;',
  '```',
  '',
  '> [!NOTE]',
  '> CALLOUTBODY says something.',
  '',
  'A sentence with a footnote.[^1]',
  '',
  '[^1]: FOOTNOTETEXT is the note.',
  '',
  '![IMGALT](pic.png)',
  '',
  '<details>',
  '<summary>SUMMARYTEXT</summary>',
  '',
  'DETAILSBODY inside the fold.',
  '',
  '</details>',
  '',
  'Powers x<sup>SUPTEXT</sup> and H<sub>SUBTEXT</sub>O, press <kbd>KBDTEXT</kbd>.',
  '',
  '<!-- id:anchor-one -->',
  '',
  'Paragraph after the anchor ANCHORPARA.',
  '',
  '```mermaid',
  'flowchart LR',
  '  MERMAIDA --> MERMAIDB',
  '```',
  '*Figure 1. FIGURECAPTION lies under it.*',
  '',
].join('\n');
/** What the printed page must hold, one needle per block (compared with every space removed: pdf text splits on glyph runs). */
const NEEDLES: ReadonlyArray<readonly [string, string]> = [
  ['title', 'Handbook fixture title'], ['paragraph', 'PARAALPHA'], ['bold', 'WORDBOLD'], ['heading', 'Second heading'],
  ['bullet', 'LISTONE'], ['bullet 2', 'LISTTWO'], ['nested', 'NESTEDITEM'], ['ordered', 'ORDEREDONE'], ['ordered 2', 'ORDEREDTWO'],
  ['table head', 'HEADCOLA'], ['table head 2', 'HEADCOLB'], ['table cell', 'CELLAONE'], ['table cell 2', 'CELLBONE'],
  ['code', 'const CODETOKEN = 1;'], ['callout', 'CALLOUTBODY says something.'], ['footnote', 'FOOTNOTETEXT is the note.'],
  ['details summary', 'SUMMARYTEXT'], ['details body', 'DETAILSBODY inside the fold.'],
  ['sup', 'SUPTEXT'], ['sub', 'SUBTEXT'], ['kbd', 'KBDTEXT'], ['after the anchor', 'ANCHORPARA'],
  ['mermaid source', 'flowchart LR MERMAIDA --> MERMAIDB'], ['mermaid caption', 'Figure 1. FIGURECAPTION lies under it.'],
];

const TEXT_NAME = 'notes.txt';
const TEXT_BODY = '<b>x</b> & <script>\nsecond line TEXTLEAFTOKEN\n';
const IMAGE_NAME = 'pic.png';
const PNG = onePixelPng();

const FIXTURE_FILES: readonly Spec[] = [
  { name: FIXTURE_NAME, kind: 'markdown', text: FIXTURE },
  { name: IMAGE_NAME, kind: 'raster', bytes: PNG },
  { name: TEXT_NAME, kind: 'text', text: TEXT_BODY },
];

/** The 3.4 MiB fixture of the plan's lab line: 3 565 158 bytes of dense mixed Markdown, built the way the unit suite builds it
 *  (`docs-print.test.tsx`'s `dense`, cut to the byte). */
const LAB_BYTES = 3_565_158;
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
const LAB_TEXT = dense(LAB_BYTES).slice(0, LAB_BYTES - 1) + '\n';

// ---- the fake /api/docs ---------------------------------------------------------------------------------------------------

const jsonBody = (v: unknown): Buffer => Buffer.from(JSON.stringify(v), 'utf8');
const SNAPSHOT = 'ab'.repeat(16);

/** Routes `/api/docs/…` for `files`: the tree, the file (JSON for Markdown and text, raw bytes for a raster) and the range route
 *  (a prepare, then frames, each checked by the PWA against its own sha256 and the whole's). */
async function answerDocs(app: OpenedApp, files: readonly Spec[]): Promise<void> {
  const tree = treeOk({
    entries: files.map((f) => entry(SECTION, f.name, { committed: { kind: 'file', blob: blobOf(f.name), size: bytesOf(f).length } })),
  });
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    const headers = { ...DOCS_RESPONSE_HEADERS, 'content-type': JSON_TYPE };
    if (req.method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const url = new URL(req.url());
    if (url.pathname.endsWith('/tree')) { await route.fulfill({ status: 200, headers, body: jsonBody(treeResponse(tree)) }); return; }
    const spec = files.find((f) => f.name === url.searchParams.get('path'));
    if (spec === undefined) { await route.fulfill({ status: 404, headers, body: jsonBody({ ok: false, failure: 'not-found' }) }); return; }
    const raw = bytesOf(spec);
    if (url.pathname.endsWith('/range')) {
      if (url.searchParams.get('prepare') === '1') {
        await route.fulfill({ status: 200, headers, body: jsonBody({ ok: true, prepared: { snapshot: SNAPSHOT, size: raw.length, digest: sha256Of(raw) } }) });
        return;
      }
      const offset = Number(url.searchParams.get('offset'));
      const length = Number(url.searchParams.get('length'));
      const slice = raw.subarray(offset, offset + length);
      await route.fulfill({
        status: 200, headers,
        body: jsonBody({ ok: true, frame: { snapshot: SNAPSHOT, offset, bytesB64: slice.toString('base64'), digest: sha256Of(slice), total: raw.length } }),
      });
      return;
    }
    if (spec.kind === 'raster') {
      await route.fulfill({ status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': 'image/png' }, body: raw });
      return;
    }
    const show = {
      v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: spec.name, size: raw.length,
      sha256: sha256Of(raw), encoding: 'utf8', text: spec.text, commit: COMMIT_A, blob: blobOf(spec.name), onRef: 'contains',
    };
    await route.fulfill({ status: 200, headers, body: jsonBody({ ok: true, contentClass: spec.kind, from: 'ccd', show }) });
  });
}

interface View { readonly width: number; readonly height: number; readonly pointer?: 'fine'; readonly touch?: boolean }

/** A context at `view` inside the console (a console tab's load, so the rail is drawn), its `/api/docs` answering `files`. */
async function openView(view: View, files: readonly Spec[], using: Browser = browser!): Promise<OpenedApp> {
  const opened = view.pointer === 'fine' ? Math.max(view.width, 900) : view.width;
  const app = await openApp(using, { width: opened, skin: REFINED, theme: 'light', touch: view.touch, tab: 'console' }, { api: {}, fleetFrames: [] });
  await app.page.setViewportSize({ width: view.width, height: view.height });
  await answerDocs(app, files);
  return app;
}

type Leaf = 'markdown' | 'text' | 'image' | 'ranged';

/** Opens `name` and waits until its body is up: the reader's frame ready (never the plain-view fallback, retried once as the
 *  other Docs rows do, D-7958), the text drawn, or the image loaded; then until the Print row is drawn and not waiting. */
async function openLeaf(view: View, files: readonly Spec[], name: string, leaf: Leaf, using: Browser = browser!): Promise<OpenedApp> {
  const app = await openView(view, files, using);
  const url = `${server!.origin}/docs/${PROJECT}/${SECTION}/${name}`;
  const up = async (): Promise<unknown> => {
    await app.page.goto(url, { waitUntil: 'load' });
    if (leaf === 'text') {
      await app.page.waitForFunction(() => document.querySelector('pre.doc-plain') !== null, undefined, { timeout: 60_000, polling: 100 });
      return 'ready';
    }
    if (leaf === 'image') {
      await app.page.waitForFunction(() => [...document.querySelectorAll('.docs-screen img')].some((i) => (i as HTMLImageElement).naturalWidth > 0), undefined, { timeout: 60_000, polling: 100 });
      return 'ready';
    }
    if (leaf === 'ranged') {
      // A document in parts draws the part bar; one of a single part is the reader's frame, ready.
      await app.page.waitForFunction(() => document.querySelector('.docs-parts, .docs-in-parts') !== null
        || (document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null), undefined, { timeout: 120_000, polling: 100 });
      return 'ready';
    }
    const h = await app.page.waitForFunction((note) => {
      if ([...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note)) return 'fallback';
      return document.querySelector('.docs-reader iframe') !== null && document.querySelector('.doc-formatting') === null ? 'ready' : null;
    }, READER_FALLBACK_NOTE, { timeout: 90_000, polling: 100 });
    return h.jsonValue();
  };
  let outcome = await up();
  if (outcome === 'fallback') {
    console.warn('PRINT-RETRY the reader\'s start watchdog fell back; opening the leaf once more (D-7958)');
    outcome = await up();
  }
  if (outcome !== 'ready') throw new Error(`the leaf did not come up: ${String(outcome)}`);
  return app;
}

async function withLeaf(view: View, files: readonly Spec[], name: string, leaf: Leaf, check: (app: OpenedApp) => Promise<void>): Promise<void> {
  const app = await openLeaf(view, files, name, leaf);
  try {
    await check(app);
    expect(app.errors, 'no page error').toEqual([]);
  } finally {
    await app.ctx.close();
  }
}

/** Opens Page details (the compact row's `button.docs-more`, or the one bar's title) if it is shut, and answers the Print row it
 *  holds: Print is in Page details only (the coordinator's ruling), so a tap on it is two taps, and the desk has none (it prints with
 *  Ctrl+P, which `page.pdf()` reaches through `beforeprint`). */
async function printRowOf(page: Page): Promise<Locator> {
  const opener = page.locator('.docs-head button.docs-more, .docs-head button.docs-title').first();
  await opener.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
  const row = page.locator('.docs-head button.docs-print');
  await row.waitFor({ state: 'visible', timeout: 30_000 });
  return row;
}

const PHONE = { width: 412, height: 915 } as const;

// ---- driving the print ----------------------------------------------------------------------------------------------------

/** Waits until the worker has prepared the print tree, through the hook's own listeners: `beforeprint` mounts what is prepared,
 *  `afterprint` empties it. A mount holding the one preparing line (or a part's not-ready note) is not it yet; one holding the tree
 *  is. The hook shows no state of its own, so this is the way to read it as the DOM shows it. */
async function waitPrepared(page: Page, ms = 90_000): Promise<number> {
  const t0 = Date.now();
  for (;;) {
    const state = await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
      const root = document.querySelector('.docs-print-root');
      const out = root === null ? 'none' : root.querySelector('.docs-print-line, .docs-print-note') !== null ? 'waiting' : root.childElementCount === 0 ? 'empty' : 'prepared';
      window.dispatchEvent(new Event('afterprint'));
      return out;
    });
    if (state === 'prepared') return Date.now() - t0;
    if (Date.now() - t0 > ms) throw new Error(`the print tree was not prepared within ${ms} ms (last state: ${state})`);
    await page.waitForTimeout(250);
  }
}

/** Counts what the page's own print path fires, over one `page.pdf()`. */
async function countPrintEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __print: { before: number; after: number; mountedAtBefore: boolean[] } };
    w.__print = { before: 0, after: 0, mountedAtBefore: [] };
    // Registered after the hook's own listener, so it sees the view the hook just mounted.
    window.addEventListener('beforeprint', () => {
      w.__print.before += 1;
      w.__print.mountedAtBefore.push((document.querySelector('.docs-print-root')?.childElementCount ?? 0) > 0);
    });
    window.addEventListener('afterprint', () => { w.__print.after += 1; });
  });
}

// ---- reading a PDF --------------------------------------------------------------------------------------------------------

interface PdfRead { readonly pages: number; readonly text: string; readonly images: number }

/** The PDF's text (every page, every item) and its image paint operators, read with pdfjs in this process. Text is squashed (all
 *  whitespace removed) by `squash`, for comparison, because the PDF splits a line on glyph runs. */
async function readPdf(pdf: Uint8Array, withOps = true): Promise<PdfRead> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 });
  const doc = await task.promise;
  const ops = new Set<number>([
    pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject,
    pdfjs.OPS.paintImageXObjectRepeat, pdfjs.OPS.paintInlineImageXObjectGroup,
  ]);
  let text = '';
  let images = 0;
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const tc = await p.getTextContent();
    text += tc.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('') + '\n';
    if (withOps) images += (await p.getOperatorList()).fnArray.filter((f: number) => ops.has(f)).length;
    p.cleanup();
  }
  const pages = doc.numPages;
  await task.destroy();
  return { pages, text, images };
}

/** A PDF's page count alone (no text, no operators): for the lab's large print. */
async function pageCount(pdf: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 });
  const n =(await task.promise).numPages;
  await task.destroy();
  return n;
}
const squash = (s: string): string => s.replace(/\s+/g, '');
const holds = (pdfText: string, needle: string): boolean => squash(pdfText).includes(squash(needle));

/** Print media, then the PDF: Chromium's own print path, which fires `beforeprint` and `afterprint` on the page. */
async function printPdf(page: Page): Promise<Uint8Array> {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ printBackground: true });
  await page.emulateMedia({ media: null });
  expect(Buffer.from(pdf).subarray(0, 5).toString('latin1'), 'a PDF').toBe('%PDF-');
  return pdf;
}

/** How many times `token` is in `text`, whitespace ignored. */
const occurrences = (text: string, token: string): number => squash(text).split(squash(token)).length - 1;

/** The console's chrome words, read from the live page: the head's actions (names and words), the rail's lines and ccrc's own labels
 *  for the same controls, less any the fixture's own text holds. */
async function chromeWordsOf(page: Page): Promise<string[]> {
  const chrome = await page.evaluate(() => {
    const names = [...document.querySelectorAll('.docs-head button, .docs-head a, .docs-actions button, .docs-actions a')]
      .flatMap((e) => [e.getAttribute('aria-label') ?? '', e.getAttribute('title') ?? '', (e as HTMLElement).innerText ?? '']);
    const rail = ((document.querySelector('.shell-nav') as HTMLElement | null)?.innerText ?? '').split('\n');
    return { names, rail };
  });
  const words = [...chrome.names, ...chrome.rail, DOCS_HEAD_TEXT.share, DOCS_HEAD_TEXT.github, DOCS_HEAD_TEXT.exportPlainView,
    READER_MODE_TEXT.enter, DOCS_TOOL_TEXT.jump, DOCS_TOOL_TEXT.contents]
    .map((w) => w.trim()).filter((w) => w.length >= 4 && !squash(FIXTURE).includes(squash(w)));
  return [...new Set(words)];
}

/** The lines of `text` (trimmed, at least four characters) that `skip` does not hold. */
const distinctLines = (text: string, skip: (line: string) => boolean): string[] =>
  [...new Set(text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 4 && !skip(l)))];

// ---- the cases ------------------------------------------------------------------------------------------------------------

describe('Print in a real Chromium (X2 P6.1 Step 1, browser leg)', () => {
  it('trigger: page.pdf fires beforeprint and afterprint on the page, and the hook mounts the view in between', async () => {
    await withLeaf({ width: 1280, height: 800, pointer: 'fine' }, FIXTURE_FILES, TEXT_NAME, 'text', async ({ page }) => {
      await countPrintEvents(page);
      await printPdf(page);
      const seen = await page.evaluate(() => (window as unknown as { __print: { before: number; after: number; mountedAtBefore: boolean[] } }).__print);
      console.log(`PRINT-TRIGGER ${JSON.stringify(seen)}`);
      expect(seen.before, 'beforeprint fired by page.pdf').toBe(1);
      expect(seen.after, 'afterprint fired by page.pdf').toBe(1);
      expect(seen.mountedAtBefore, 'the hook had mounted the view when the next listener ran').toEqual([true]);
      expect(await page.evaluate(() => document.querySelector('.docs-print-root')?.childElementCount ?? -1), 'afterprint emptied it').toBe(0);
    });
  }, 120_000);

  it('print: page.pdf holds every PR1 and PR2 block of the fixture', async () => {
    await withLeaf({ width: 1280, height: 800, pointer: 'fine' }, FIXTURE_FILES, FIXTURE_NAME, 'markdown', async ({ page }) => {
      const preparedMs = await waitPrepared(page);
      const chromeWords = await chromeWordsOf(page);
      expect(chromeWords.length, 'the detector has chrome words to look for').toBeGreaterThan(3);

      await countPrintEvents(page);
      const pdf = await printPdf(page);
      const read = await readPdf(pdf);
      const events = await page.evaluate(() => (window as unknown as { __print: { before: number; after: number } }).__print);
      const missing = NEEDLES.filter(([, n]) => !holds(read.text, n)).map(([k]) => k);
      const leaked = chromeWords.filter((w) => holds(read.text, w));
      console.log(`PRINT-PDF-BLOCKS ${JSON.stringify({ preparedMs, pages: read.pages, images: read.images, events, needles: NEEDLES.length, missing, chromeWords: chromeWords.length, leaked })}`);
      expect(events, 'page.pdf fired the pair once').toMatchObject({ before: 1, after: 1 });
      expect(missing, 'every block of the fixture is in the PDF').toEqual([]);
      expect(leaked, 'no console chrome word is in the PDF').toEqual([]);
      expect(read.images, 'the fixture\'s image is in the PDF').toBeGreaterThanOrEqual(1);
      // The page is back as it was: the view emptied, the frame still there.
      expect(await page.evaluate(() => document.querySelector('.docs-print-root')?.childElementCount ?? -1)).toBe(0);
      expect(await page.locator('.docs-reader iframe').count()).toBe(1);
    });
  }, 240_000);

  it('print: page.pdf of an image leaf and of a text leaf holds the image and the text', async () => {
    // The text leaf: markup in the text prints as text.
    await withLeaf({ width: 1280, height: 800, pointer: 'fine' }, FIXTURE_FILES, TEXT_NAME, 'text', async ({ page }) => {
      const read = await readPdf(await printPdf(page), false);
      console.log(`PRINT-TEXT-LEAF ${JSON.stringify({ pages: read.pages, text: squash(read.text).slice(0, 120) })}`);
      expect(holds(read.text, '<b>x</b> & <script>'), 'the markup is in the PDF as text').toBe(true);
      expect(holds(read.text, 'second line TEXTLEAFTOKEN')).toBe(true);
    });
    // The image leaf, A: the browser's own path, nothing mounted before page.pdf (what Ctrl+P does).
    await withLeaf({ width: 1280, height: 800, pointer: 'fine' }, FIXTURE_FILES, IMAGE_NAME, 'image', async ({ page }) => {
      const read = await readPdf(await printPdf(page));
      console.log(`PRINT-IMAGE-LEAF-CTRLP ${JSON.stringify({ pages: read.pages, images: read.images })}`);
      expect(read.images, 'the PDF holds one image (the browser\'s own path, no view mounted before it)').toBe(1);
    });
    // The image leaf, B: the Print row's tap (in Page details, on a phone) mounts the view first (window.print stubbed: no dialog), and
    // the print root's image is loaded under print media before page.pdf.
    await withLeaf(PHONE, FIXTURE_FILES, IMAGE_NAME, 'image', async ({ page }) => {
      await page.evaluate(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
      await (await printRowOf(page)).click();
      await page.waitForFunction(() => (window as unknown as { __printed: number }).__printed === 1, undefined, { timeout: 30_000 });
      await page.emulateMedia({ media: 'print' });
      const img = await page.evaluate(() => {
        const i = document.querySelector('.docs-print-root img') as HTMLImageElement | null;
        return i === null ? null : { natural: i.naturalWidth, complete: i.complete, src: i.src.slice(0, 22), shown: getComputedStyle(i).display !== 'none' && i.getClientRects().length > 0 };
      });
      await page.emulateMedia({ media: null });
      const read = await readPdf(await printPdf(page));
      console.log(`PRINT-IMAGE-LEAF-ROW ${JSON.stringify({ img, pages: read.pages, images: read.images })}`);
      expect(img, 'the print root holds an image').not.toBeNull();
      expect(img!.natural, 'the print root\'s image is loaded under print media').toBeGreaterThan(0);
      expect(img!.shown, 'and laid out').toBe(true);
      expect(read.images, 'the PDF holds one image').toBe(1);
    });
  }, 240_000);

  it('print: under print media the frame and console chrome are not rendered', async () => {
    await withLeaf({ width: 1280, height: 800, pointer: 'fine' }, FIXTURE_FILES, FIXTURE_NAME, 'markdown', async ({ page }) => {
      await waitPrepared(page);
      // The frame's own words: what its document says that the document does not (its chrome), read while it is on screen.
      const frameHandle = await page.locator('.docs-reader iframe').elementHandle({ timeout: 30_000 });
      const frame = await frameHandle?.contentFrame();
      if (frame === null || frame === undefined) throw new Error('the reader iframe has no content frame');
      const frameText = await frame.evaluate(() => (document.body as HTMLElement).innerText);
      // What the print view says: its own text, read through the hook's listeners (mounted, read, emptied).
      const printText = await page.evaluate(() => {
        window.dispatchEvent(new Event('beforeprint'));
        const t = (document.querySelector('.docs-print-root') as HTMLElement | null)?.textContent ?? '';
        window.dispatchEvent(new Event('afterprint'));
        return t;
      });
      const alnum = (s: string): string => s.replace(/[^A-Za-z0-9]/g, '');
      expect(printText.length, 'the print view has text').toBeGreaterThan(200);
      const frameOnly = distinctLines(frameText, (l) => alnum(printText).includes(alnum(l)) || alnum(l).length < 3);
      console.log(`PRINT-FRAME-ONLY ${JSON.stringify(frameOnly.slice(0, 20))}`);
      expect(frameOnly.length, 'the frame says words of its own, so the detector has something to look for').toBeGreaterThan(0);

      // Print media emulated, the view mounted by the page's own beforeprint listener.
      await page.emulateMedia({ media: 'print' });
      await page.evaluate(() => { window.dispatchEvent(new Event('beforeprint')); });
      const hidden = await page.evaluate(() => {
        const describe = (e: Element): string => `${e.tagName.toLowerCase()}${e.id === '' ? '' : '#' + e.id}${e.className === '' || typeof e.className !== 'string' ? '' : '.' + e.className.trim().split(/\s+/).join('.')}`;
        const probe = (sel: string): { sel: string; present: boolean; rects: number; display: string; hiddenBy: string; ancestorIsBodyChild: boolean } => {
          const el = document.querySelector(sel);
          if (el === null) return { sel, present: false, rects: -1, display: '', hiddenBy: '', ancestorIsBodyChild: false };
          let at: Element | null = el;
          while (at !== null && getComputedStyle(at).display !== 'none') at = at.parentElement;
          return {
            sel, present: true, rects: el.getClientRects().length, display: getComputedStyle(el).display,
            hiddenBy: at === null ? 'nothing' : describe(at), ancestorIsBodyChild: at !== null && at.parentElement === document.body,
          };
        };
        const root = document.querySelector('.docs-print-root') as HTMLElement | null;
        const rect = root?.getBoundingClientRect();
        return {
          probes: ['.docs-reader iframe', '.docs-head', '.shell-nav', '.shell-tab-bar', '.shell-status', '.shell-phone-nav'].map(probe),
          printRoot: root === null ? null : { display: getComputedStyle(root).display, h: rect?.height ?? 0, kids: root.childElementCount },
          bodyKids: [...document.body.children].map((c) => `${describe(c)}=${getComputedStyle(c).display}`),
        };
      });
      console.log(`PRINT-HIDDEN ${JSON.stringify(hidden)}`);
      for (const sel of ['.docs-reader iframe', '.docs-head', '.shell-nav']) {
        const p = hidden.probes.find((x) => x.sel === sel)!;
        expect(p.present, `${sel} is on the page`).toBe(true);
        expect(p.rects, `${sel} has no box under print media`).toBe(0);
        expect(p.hiddenBy, `${sel}: some ancestor (or itself) is display: none`).not.toBe('nothing');
        expect(p.ancestorIsBodyChild, `${sel} is hidden by a child of body (the print stylesheet's own rule)`).toBe(true);
      }
      for (const p of hidden.probes.filter((x) => x.present)) expect(p.rects, `${p.sel} has no box`).toBe(0);
      expect(hidden.printRoot?.display, 'the print root is displayed').toBe('block');
      expect(hidden.printRoot?.h, 'and has height').toBeGreaterThan(0);
      await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
      await page.emulateMedia({ media: null });

      // The PDF: the print view's words are there, none of the frame's own is.
      // Each token the document says once is in the frame's document AND in the print view: a PDF that holds it once has the print
      // view's copy only, and twice would be the frame's box printed beside it.
      const TOKENS = ['PARAALPHA', 'CELLAONE', 'SUPTEXT', 'ANCHORPARA'] as const;
      const chromeWords = await chromeWordsOf(page);
      const read = await readPdf(await printPdf(page), false);
      const framed = frameOnly.filter((l) => holds(read.text, l));
      const counts = Object.fromEntries(TOKENS.map((t) => [t, occurrences(read.text, t)]));
      const chromeLeaked = chromeWords.filter((w) => holds(read.text, w));
      console.log(`PRINT-NO-FRAME ${JSON.stringify({ pages: read.pages, frameOnlyLines: frameOnly.length, framed, counts, chromeLeaked, printViewHeld: NEEDLES.filter(([, n]) => holds(read.text, n)).length })}`);
      expect(NEEDLES.filter(([, n]) => holds(read.text, n)).length, 'the print view\'s words are in the PDF').toBeGreaterThan(NEEDLES.length - 3);
      expect(counts, 'each token is in the PDF once: the print view\'s copy, no frame beside it').toEqual({ PARAALPHA: 1, CELLAONE: 1, SUPTEXT: 1, ANCHORPARA: 1 });
      expect(framed, 'none of the frame\'s own words is in the PDF').toEqual([]);
      expect(chromeLeaked, 'none of the console\'s words is in the PDF').toEqual([]);

      // CONTROL: the hiding rule overridden (the console shown beside the print view), the same page prints the console's words and,
      // if the engine prints a frame, each token twice: the detector is not blind.
      await page.addStyleTag({ content: '@media print { body:has(> .docs-print-root > *) > :not(.docs-print-root) { display: block !important } }' });
      const control = await readPdf(await printPdf(page), false);
      const controlCounts = Object.fromEntries(TOKENS.map((t) => [t, occurrences(control.text, t)]));
      const controlChrome = chromeWords.filter((w) => holds(control.text, w));
      console.log(`PRINT-NO-FRAME-CONTROL ${JSON.stringify({ pages: control.pages, controlCounts, controlChrome: controlChrome.length, of: chromeWords.length })}`);
      expect(controlChrome.length, 'CONTROL: with the rule overridden the console\'s words are in the PDF').toBeGreaterThan(0);
      expect(TOKENS.some((t) => controlCounts[t]! >= 2), 'CONTROL: with the rule overridden the frame\'s copy of a token is in the PDF beside the print view\'s').toBe(true);
    });
  }, 300_000);

  it('PRINT-L-3.4MiB-CAPPED: the 3.4 MiB fixture (over the ceiling) prints the part on screen and says so', async () => {
    expect(Buffer.byteLength(LAB_TEXT, 'utf8')).toBe(LAB_BYTES);
    expect(Math.ceil(LAB_BYTES / DOCS_RANGE_FRAME_BYTES), 'the read is seven frames').toBe(7);
    const { line, view, pdf, error } = await printWhole('lab-3.4MiB', LAB_TEXT);
    console.log(`PRINT-L-3.4MiB-CAPPED ${JSON.stringify(line)}`);
    expect(error, `the print failed: ${JSON.stringify(line)}`).toBeNull();
    expect(view!.shape, 'read in parts').toBe('parts');
    // The view: the part on screen and the sentence, at the top, after the (absent) banner; the sentence is also below the Print row.
    expect(view!.parts, 'one part: the part on screen').toBe(1);
    expect(view!.plain, 'no part printed as plain text').toBe(0);
    expect(view!.notice, 'the sentence at the top of the view').toBe(PRINT_TOO_LONG);
    expect(view!.noticeFirst, 'and it is the first thing in the view').toBe(true);
    expect(view!.noteBelowRow, 'the sentence below the Print row').toBe(PRINT_TOO_LONG);
    // The PDF: that part's text and the sentence, and no other part's. The dense fixture numbers its sections 1..N in order, so the
    // sections the PDF holds are 1..(the view's sections) and the last one is not there.
    const read = await readPdf(pdf!, false);
    const total = (LAB_TEXT.match(/^## Section \d+$/gm) ?? []).length;
    const printed = [...new Set([...squash(read.text).matchAll(/Section(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
    console.log(`PRINT-L-3.4MiB-CAPPED-PDF ${JSON.stringify({ pages: read.pages, sectionsInView: view!.sections, sectionsInPdf: printed.length, first: printed[0], last: printed.at(-1), totalSections: total })}`);
    expect(holds(read.text, PRINT_TOO_LONG), 'the sentence is in the PDF').toBe(true);
    expect(view!.sections, 'the view is a part of the document, not the document').toBeLessThan(total);
    expect(printed[0], 'the part on screen opens the document').toBe(1);
    expect(printed.at(-1), 'the PDF ends where the part on screen ends').toBe(view!.sections);
    expect(printed.length, 'every section of that part, and no other').toBe(view!.sections);
    expect(squash(read.text).includes(`Section${total}`), 'the last section of the document is not in the PDF').toBe(false);
    // The bars: under 60 s from the tap to page.pdf() resolving, and no more elements than the ceiling.
    expect(line['totalMs'], `Print tap to page.pdf() took ${String(line['totalMs'])} ms (60 s is the bar): ${JSON.stringify(line)}`).toBeLessThanOrEqual(60_000);
    expect(view!.elements, `the print root holds ${view!.elements} elements (the ceiling is ${PRINT_WHOLE_MAX_ELEMENTS}): ${JSON.stringify(line)}`).toBeLessThanOrEqual(PRINT_WHOLE_MAX_ELEMENTS);
  }, 900_000);

  // Two documents either side of the whole-print ceiling, from one generator (`weighted`): each section is the same weight, so the
  // elements are a section's times the count, and the bytes are set apart from the elements by filler words, so two parts can hold
  // nearly the ceiling's elements. Just under: two parts, all printed. Just over: three parts, the part on screen only, and it says so.
  it('print: a document that prepares just under the ceiling prints every part (two parts)', async () => {
    const { line, view, pdf, error } = await printWhole('under', weighted(100));
    const estimate = view === null ? 0 : view.elements - view.parts - 1;
    console.log(`PRINT-CEILING ${JSON.stringify({ case: 'under', ceiling: PRINT_WHOLE_MAX_ELEMENTS, treeElementsEstimate: estimate, ...pick(line, ['bytes', 'parts', 'elements', 'tapToPrintMs', 'pdfMs', 'heapMiB', 'browserRssPeakMiB', 'pdfPages']) })}`);
    expect(error, `the print failed: ${JSON.stringify(line)}`).toBeNull();
    expect(view!.parts, 'two parts, both printed').toBe(2);
    expect(view!.plain).toBe(0);
    expect(view!.notice, 'no sentence').toBeNull();
    expect(view!.noteBelowRow, 'none below the row either').toBeNull();
    expect(estimate, 'just under the ceiling').toBeLessThanOrEqual(PRINT_WHOLE_MAX_ELEMENTS);
    expect(estimate, 'and near it').toBeGreaterThanOrEqual(PRINT_WHOLE_MAX_ELEMENTS * 0.9);
    const read = await readPdf(pdf!, false);
    expect(holds(read.text, 'STARTTOKEN'), 'the first part is in the PDF').toBe(true);
    expect(holds(read.text, 'ENDTOKEN'), 'the second part is in the PDF').toBe(true);
  }, 600_000);

  it('print: a document that prepares just over the ceiling prints the part on screen and says so (three parts)', async () => {
    const { line, view, pdf, error } = await printWhole('over', weighted(106));
    // One part is mounted, so its own weight gives a section's: (the root's elements less the view, the part's wrapper and the
    // sentence) over the part's sections, times all 106.
    const perSection = view === null ? 0 : (view.elements - 3) / Math.max(1, view.sections);
    const estimate = Math.round(perSection * 106);
    console.log(`PRINT-CEILING ${JSON.stringify({ case: 'over', ceiling: PRINT_WHOLE_MAX_ELEMENTS, treeElementsEstimate: estimate, perSection, ...pick(line, ['bytes', 'parts', 'elements', 'tapToPrintMs', 'pdfMs', 'heapMiB', 'browserRssPeakMiB', 'pdfPages']) })}`);
    expect(error, `the print failed: ${JSON.stringify(line)}`).toBeNull();
    expect(view!.shape, 'read in parts').toBe('parts');
    expect(view!.parts, 'the part on screen only').toBe(1);
    expect(view!.notice, 'and the sentence').toBe(PRINT_TOO_LONG);
    expect(view!.noteBelowRow, 'below the row too').toBe(PRINT_TOO_LONG);
    expect(estimate, 'the whole document is just over the ceiling').toBeGreaterThan(PRINT_WHOLE_MAX_ELEMENTS);
    expect(estimate, 'and near it').toBeLessThanOrEqual(PRINT_WHOLE_MAX_ELEMENTS * 1.1);
    expect(view!.sections, 'fewer sections than the document has').toBeLessThan(106);
    const read = await readPdf(pdf!, false);
    expect(holds(read.text, 'STARTTOKEN'), 'the part on screen is in the PDF').toBe(true);
    expect(holds(read.text, 'ENDTOKEN'), 'the last part is not').toBe(false);
    expect(holds(read.text, PRINT_TOO_LONG), 'the sentence is').toBe(true);
  }, 600_000);
});

/** `keys` of `o`, for a short log line. */
const pick = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, o[k]]));

/** `sections` equal sections: a heading, a paragraph of filler words (bytes, one element), and a list of 1 150 items (elements, 4 bytes
 *  each): about 10 000 bytes and 1 153 elements a section, so 100 are two parts and about 115 000 elements, and 106 are three parts and
 *  about 122 000. The first section's paragraph says STARTTOKEN and the last's ENDTOKEN. */
function weighted(sections: number): string {
  const filler = 'Plain words that carry bytes and no elements. '.repeat(117);
  return Array.from({ length: sections }, (_, i) => `## Section ${i + 1}\n\n${i === 0 ? 'STARTTOKEN ' : i === sections - 1 ? 'ENDTOKEN ' : ''}${filler}\n\n${'- x\n'.repeat(1150)}\n`).join('');
}

const mib = (n: number): number => Math.round((n / 1048576) * 10) / 10;

// ---- the measurement block: the whole print by size (`CCRC_MEASURE=1`) ---------------------------------------------------------

/** What the print view held when `window.print` was called (read from the DOM, before `page.pdf()`). */
interface ViewFacts {
  /** Every element under the print root (the view's own div, the part wrappers, the notice, the tree). */
  readonly elements: number;
  /** The part wrappers: the parts the view prints. */
  readonly parts: number;
  /** The `h2` headings: the sections it prints. */
  readonly sections: number;
  /** Parts or lines printed as plain text (a part not ready, the preparing line). */
  readonly plain: number;
  readonly shape: 'whole' | 'parts';
  /** The sentence at the top of the view (`p.docs-print-notice`), or `null`; whether it is the view's first child. */
  readonly notice: string | null;
  readonly noticeFirst: boolean;
  /** The status sentence below the Print row (`PrintNote`, `p.docs-note[role=status]`), or `null`. */
  readonly noteBelowRow: string | null;
}

interface Whole { readonly line: Record<string, unknown>; readonly view: ViewFacts | null; readonly pdf: Uint8Array | null; readonly error: string | null }

/** The whole print of a Markdown document through the Print row, on a phone: Page details opened, the tap (cold: as soon as the row
 *  can be pressed) with `window.print` stubbed, then `page.pdf()`. The line carries the tap to the print call, `page.pdf()`'s time,
 *  the print view's element count, the page's JS heap before / mounted / after a GC and the browser's resident peak over the print
 *  (every process of this browser). Each document gets a browser of its own (a print killed by the memory cap takes its browser
 *  with it, and the next document must not inherit that), found by its own marker. Never throws: what failed is in `error`. */
async function printWhole(label: string, text: string): Promise<Whole> {
  const marker = `printmeasure-${process.pid}-${label}-${Date.now()}`;
  const own = await chromium.launch({ executablePath: resolveChrome(), headless: true, args: ['--enable-precise-memory-info', `--ccrc-print-lab=${marker}`] });
  const name = `measure-${label}.md`;
  const watch = rssWatch(marker);
  let line: Record<string, unknown> = { label, bytes: Buffer.byteLength(text, 'utf8') };
  let view: ViewFacts | null = null;
  let pdf: Uint8Array | null = null;
  let error: string | null = null;
  try {
    const t0 = Date.now();
    const app = await openLeaf(PHONE, [{ name, kind: 'markdown', text }], name, 'ranged', own);
    try {
      const { page } = app;
      line = { ...line, openMs: Date.now() - t0 };
      const cdp = await app.ctx.newCDPSession(page);
      const heap = async (gc: boolean): Promise<number> => {
        if (gc) await cdp.send('HeapProfiler.collectGarbage');
        return page.evaluate(() => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize);
      };
      await page.evaluate(() => {
        const w = window as unknown as { __printCalls: number[] };
        w.__printCalls = [];
        window.print = () => { w.__printCalls.push(performance.now()); };
      });
      const row = await printRowOf(page);
      const heapBefore = await heap(true);
      const rssBefore = await watch.now();
      const tap = Date.now();
      await row.click();
      await page.waitForFunction(() => (window as unknown as { __printCalls: number[] }).__printCalls.length === 1, undefined, { timeout: 300_000, polling: 200 });
      const tapToPrintMs = Date.now() - tap;
      view = await page.evaluate((): ViewFacts => {
        const root = document.querySelector('.docs-print-root');
        const notice = root?.querySelector('.docs-print-notice') ?? null;
        return {
          elements: root?.querySelectorAll('*').length ?? 0,
          parts: root?.querySelectorAll(':scope > * > div').length ?? 0,
          sections: root?.querySelectorAll('h2').length ?? 0,
          plain: root?.querySelectorAll('.docs-print-note, .docs-print-line').length ?? 0,
          shape: document.querySelector('.docs-parts, .docs-in-parts') === null ? 'whole' : 'parts',
          notice: notice?.textContent ?? null,
          noticeFirst: notice !== null && root?.firstElementChild?.firstElementChild === notice,
          noteBelowRow: document.querySelector('.docs-head p.docs-note[role="status"]')?.textContent ?? null,
        };
      });
      const heapMounted = await heap(false);
      const rssMounted = await watch.now();
      line = { ...line, ...view, notice: view.notice !== null, noteBelowRow: view.noteBelowRow !== null, tapToPrintMs,
        heapMiB: { before: mib(heapBefore), mounted: mib(heapMounted) }, browserRssMiB: { before: rssBefore, mounted: rssMounted } };
      const pdfStart = Date.now();
      try {
        pdf = await Promise.race([
          page.pdf(),
          new Promise<never>((_, rej) => { setTimeout(() => { rej(new Error('page.pdf() did not resolve within 300 s')); }, 300_000); }),
        ]);
        const pdfMs = Date.now() - pdfStart;
        const heapAfter = await heap(true);
        line = { ...line, pdfMs, totalMs: tapToPrintMs + pdfMs, pdfBytes: pdf.length, pdfPages: await pageCount(pdf).catch(() => -1),
          heapMiB: { before: mib(heapBefore), mounted: mib(heapMounted), after: mib(heapAfter) } };
      } catch (err) {
        error = (err as Error).message;
        line = { ...line, pdfFailedAfterMs: Date.now() - pdfStart, error };
      }
    } finally {
      await app.ctx.close().catch(() => undefined);
    }
  } catch (err) {
    error = (err as Error).message;
    line = { ...line, error };
  } finally {
    watch.stop();
    line = { ...line, browserRssPeakMiB: watch.peak() };
    await own.close().catch(() => undefined);
  }
  return { line, view, pdf, error };
}

describe.runIf(MEASURE)('measurement: the whole print by size (CCRC_MEASURE=1; one PRINT-MEASURE line each, nothing asserted)', () => {
  // Dense mixed Markdown of exactly k render gates, k = 1 to 4, then the 3.4 MiB fixture: the lab's generator, cut to the byte.
  const GATE = 524_288;
  const sizes: ReadonlyArray<readonly [string, number]> = [
    ['k1', GATE], ['k2', 2 * GATE], ['k3', 3 * GATE], ['k4', 4 * GATE], ['3.4MiB', LAB_BYTES],
    // The 3.4 MiB fixture's capped print (over the whole-print ceiling: the part on screen and the sentence), on its own line.
    ['3.4MiB-capped', LAB_BYTES],
    // A part ends at a block boundary and is under the gate, so exactly k gates cut into more than k parts (3, 4 and 5 for k = 2 to 4);
    // k gates less 4 KiB a gate cut into k parts.
    ['p2', 2 * GATE - 2 * 4096], ['p3', 3 * GATE - 3 * 4096], ['p4', 4 * GATE - 4 * 4096],
  ];
  it.each(sizes)('%s: tap to print, page.pdf, elements, heap and resident peak', async (label, bytes) => {
    const text = bytes === LAB_BYTES ? LAB_TEXT : dense(bytes).slice(0, bytes - 1) + '\n';
    expect(Buffer.byteLength(text, 'utf8'), 'the document is its size to the byte').toBe(bytes);
    // Since D-9163 a document over the whole-print ceiling prints the part on screen: `notice` in the line says which print this was.
    const { line } = await printWhole(label, text);
    console.log(`PRINT-MEASURE ${JSON.stringify(line)}`);
  }, 900_000);
});

/** The resident set, in MiB, of every process of THIS test's browser (the browser and everything below it), found by the
 *  marker switch the launch carries; sampled twice a second while a watch is on. Read from `ps`, so it counts shared pages in each. */
function rssWatch(marker: string = BROWSER_MARKER): { now(): Promise<number>; peak(): number; stop(): void } {
  let peak = 0;
  const sample = async (): Promise<number> => {
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid=,rss=,args=']);
    const rows = stdout.split('\n').flatMap((l) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l);
      return m === null ? [] : [{ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]), args: m[4]! }];
    });
    const mine = new Set(rows.filter((r) => r.args.includes(marker)).map((r) => r.pid));
    for (let grew = true; grew;) {
      grew = false;
      for (const r of rows) if (!mine.has(r.pid) && mine.has(r.ppid)) { mine.add(r.pid); grew = true; }
    }
    const kib = rows.filter((r) => mine.has(r.pid)).reduce((s, r) => s + r.rss, 0);
    const m = Math.round(kib / 1024);
    peak = Math.max(peak, m);
    return m;
  };
  const timer = setInterval(() => { void sample().catch(() => undefined); }, 500);
  return { now: sample, peak: () => peak, stop: () => { clearInterval(timer); } };
}

// ---- the head with the Print row ------------------------------------------------------------------------------------------

interface DeskRow {
  readonly head: number; readonly rowH: number; readonly backMid: number; readonly mids: readonly { readonly name: string; readonly mid: number }[];
  readonly print: { readonly name: string; readonly w: number; readonly h: number; readonly words: boolean; readonly right: number } | null;
  readonly actions: readonly { readonly name: string; readonly words: boolean; readonly w: number }[];
  readonly scrollW: number; readonly innerW: number; readonly rowRight: number;
}

/** The full head's row, as `docs-compact-head.browser.test.ts` measures it, and where a Print button would stand in it (`print`:
 *  `null`, since Print is in Page details only). */
async function deskRow(page: Page): Promise<DeskRow> {
  await page.waitForSelector('.docs-full .docs-actions .docs-reader-mode', { timeout: 90_000 });
  return page.evaluate(async () => {
    await document.fonts.ready;
    const head = document.querySelector('.docs-head.docs-full')!;
    const row = head.querySelector(':scope > .docs-head-bar')!;
    const truth = head.querySelector(':scope > .docs-truth')!;
    const mid = (e: Element): number => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
    const shown = (e: Element | null): boolean => e !== null && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
    const print = row.querySelector('.docs-actions .docs-print');
    const pr = print?.getBoundingClientRect();
    return {
      head: truth.getBoundingClientRect().bottom - head.getBoundingClientRect().top,
      rowH: row.getBoundingClientRect().height,
      backMid: mid(row.querySelector('.docs-back')!),
      mids: [...row.querySelectorAll('button, a')].filter((e) => shown(e)).map((c) => ({ name: c.getAttribute('aria-label') ?? c.textContent ?? '', mid: mid(c) })),
      print: print === null || pr === undefined ? null : {
        name: print.getAttribute('aria-label') ?? '', w: pr.width, h: pr.height, right: pr.right,
        words: shown(print.querySelector('.docs-action-words, .docs-reader-words')),
      },
      actions: [...row.querySelectorAll(':scope > .docs-actions > a, :scope > .docs-actions > button')].map((c) => ({
        name: c.getAttribute('aria-label') ?? '', words: shown(c.querySelector('.docs-action-words, .docs-reader-words')), w: c.getBoundingClientRect().width,
      })),
      scrollW: document.documentElement.scrollWidth, innerW: innerWidth, rowRight: row.getBoundingClientRect().right,
    };
  });
}

describe('the head with the Print row in Page details (PRINT-HEAD)', () => {
  it.each([[1280, 800], [1440, 900]] as const)('%i x %i, a mouse: the desk row has no Print, stays one line, and the head at most HEAD_MAX', async (width, height) => {
    await withLeaf({ width, height, pointer: 'fine' }, FIXTURE_FILES, FIXTURE_NAME, 'markdown', async ({ page }) => {
      const f = await deskRow(page);
      console.log(`PRINT-HEAD ${width}x${height} desk ${JSON.stringify(f)}`);
      expect(f.print, 'the desk row draws no Print (it prints with Ctrl+P)').toBeNull();
      expect(f.actions.map((a) => a.name), 'the row\'s actions are as before Print').not.toContain('Print');
      for (const c of f.mids) expect(Math.abs(c.mid - f.backMid), `${c.name} on the row's line`).toBeLessThanOrEqual(1);
      expect(f.rowH, 'the row is one tap tall').toBeLessThanOrEqual(TAP + 0.5);
      expect(f.head, 'the head, from its top to the bottom of the truth line').toBeLessThanOrEqual(HEAD_MAX);
      expect(f.scrollW, 'no sideways scroll').toBeLessThanOrEqual(f.innerW);
    });
  }, 180_000);

  it('412 x 915, the compact row of a text leaf: no Print among the icons, and Print worded in Page details, a tap, nothing scrolls sideways', async () => {
    await withLeaf({ width: 412, height: 915 }, FIXTURE_FILES, TEXT_NAME, 'text', async ({ page }) => {
      await page.waitForSelector('.docs-compact-bar', { timeout: 30_000 });
      const f = await page.evaluate(async () => {
        await document.fonts.ready;
        const bar = document.querySelector('.docs-compact-bar')!;
        const b = bar.getBoundingClientRect();
        return {
          bar: { h: b.height, w: b.width, right: b.right },
          controls: [...bar.querySelectorAll('button')].map((c) => {
            const r = c.getBoundingClientRect();
            return { name: c.getAttribute('aria-label') ?? '', w: r.width, h: r.height, right: r.right };
          }),
          scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        };
      });
      console.log(`PRINT-HEAD 412x915 compact ${JSON.stringify(f)}`);
      expect(f.controls.map((c) => c.name), 'no Print among the icons').not.toContain('Print');
      for (const c of f.controls) {
        expect(c.w, `${c.name}: a tap wide`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.h, `${c.name}: a tap tall`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.right, `${c.name} ends inside the viewport`).toBeLessThanOrEqual(f.innerW);
      }
      expect(f.bar.h, 'the row is one tap tall').toBeLessThanOrEqual(TAP + 0.5);
      expect(f.scrollW, 'no sideways scroll').toBeLessThanOrEqual(f.innerW);
      const row = await printRowOf(page);
      const box = await row.boundingBox();
      const inPanel = await row.evaluate((e) => e.closest('.docs-more-panel') !== null);
      const open = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth, words: document.querySelector('.docs-head button.docs-print')?.textContent }));
      console.log(`PRINT-HEAD 412x915 compact-panel ${JSON.stringify({ box, inPanel, ...open })}`);
      expect(inPanel, 'Print is in the Page details panel').toBe(true);
      expect(open.words, 'worded').toBe('Print');
      expect(box!.height, 'a tap tall').toBeGreaterThanOrEqual(TAP - 0.5);
      expect(box!.x + box!.width, 'inside the viewport').toBeLessThanOrEqual(open.innerW);
      expect(open.scrollW, 'no sideways scroll with the panel open').toBeLessThanOrEqual(open.innerW);
    });
  }, 180_000);

  it('412 x 915, the reader\'s one bar: no Print on it, one tap tall, and Print worded in its panel (the stacked actions)', async () => {
    await withLeaf({ width: 412, height: 915 }, FIXTURE_FILES, FIXTURE_NAME, 'markdown', async ({ page }) => {
      await page.waitForSelector('.docs-head.docs-one-bar', { timeout: 30_000 });
      const f = await page.evaluate(async () => {
        await document.fonts.ready;
        const bar = document.querySelector('.docs-one-bar .docs-compact-bar')!;
        const b = bar.getBoundingClientRect();
        return {
          bar: { h: b.height, w: b.width },
          controls: [...bar.querySelectorAll('button')].map((c) => ({ name: c.classList.contains('docs-title') ? 'title' : c.getAttribute('aria-label') ?? '', w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height, right: c.getBoundingClientRect().right })),
          printOnBar: bar.querySelector('.docs-print') !== null,
          scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
        };
      });
      console.log(`PRINT-HEAD 412x915 one-bar ${JSON.stringify(f)}`);
      for (const c of f.controls) {
        expect(c.w, `${c.name}: a tap wide`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.h, `${c.name}: a tap tall`).toBeGreaterThanOrEqual(TAP - 0.5);
        expect(c.right, `${c.name} ends inside the viewport`).toBeLessThanOrEqual(f.innerW);
      }
      expect(f.bar.h, 'the bar is one tap tall').toBeLessThanOrEqual(TAP + 0.5);
      expect(f.scrollW, 'no sideways scroll').toBeLessThanOrEqual(f.innerW);
      expect(f.printOnBar, 'no Print on the bar').toBe(false);
      const row = await printRowOf(page);
      const box = await row.boundingBox();
      const inPanel = await row.evaluate((e) => e.closest('.docs-more-panel') !== null);
      const open = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, innerW: innerWidth, words: document.querySelector('.docs-head button.docs-print')?.textContent }));
      console.log(`PRINT-HEAD 412x915 one-bar-panel ${JSON.stringify({ box, inPanel, ...open })}`);
      expect(inPanel, 'Print is in the one bar\'s panel').toBe(true);
      expect(open.words, 'worded').toBe('Print');
      expect(box!.height, 'a tap tall').toBeGreaterThanOrEqual(TAP - 0.5);
      expect(open.scrollW, 'no sideways scroll with the panel open').toBeLessThanOrEqual(open.innerW);
    });
  }, 180_000);
});
