// The draft review page's measurement fixture (native Docs draft review, X3, wave R2 Task R2.3; spec 2026-11-18 section
// 3.5; row M-X3.16). `/review#lab` mounts two committed copies under the page's real header policy, and each copy is
// Export's own output: `buildExport` over a committed Markdown page and a committed mockup page, from the inputs in
// `fixtures/review-lab/`. `src/review/labFixture.ts` is those two copies' bytes as string constants, plus ONE change
// made after the build: a `<script>` canary, which would recolour the copy's swatch and set a global if it ever ran
// (the builder strips every script, so no real copy has one). This file is the fixture's test and its one writer:
//
//   regenerate:  cd pwa && CCRC_WRITE_FIXTURE=1 ccrc test -- ./node_modules/.bin/vitest run test/review-lab-fixture.test.tsx
//
// Any change to Export's builder, its stylesheet or `@ccrc/ui`'s tokens changes the bytes, and this file goes red until
// the fixture is written again and the diff is read. The canary goes in after the build: before the Markdown copy's one
// `</body>`, and, for the mockup, inside the INNER document (the nested srcdoc frame's text), before its `</body>`, in
// the escaped form the wrapper's `srcDoc` attribute holds (`&lt;/body&gt;`), so a script in either frame, the deepest
// included, is measured. Placeholders only: project `demo`, `example-org/example-repo`, `https://example.org`.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsApi, type DocPin } from '../../shared/docs';
import { detachUrls } from '../src/docs/docsLinks';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { buildExport } from '../src/docs/export/buildExport';
import { createExportAssets } from '../src/docs/export/exportAssets';
import { exportInputOf, type ExportRequest } from '../src/docs/export/exportInput';
import { DOCS_EXPORT_CSP } from '../src/docs/export/policy';
import { extractMockupRefs, loadMockupAssets } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import type { MockupAssetReader, MockupContext } from '../src/docs/mockup/ports';
import { parseMarkdown } from '../src/lib/markdownParse';
import { BLOB_1, COMMIT_A, SERVED, entry, fileResponse, holder, pageAt, treeOk } from './docsFixtures';
import { syncTestStore } from './highlightTestStore';

const INPUTS = path.join(import.meta.dirname, 'fixtures', 'review-lab');
const FIXTURE_FILE = path.join(import.meta.dirname, '..', 'src', 'review', 'labFixture.ts');
const REGENERATE = 'cd pwa && CCRC_WRITE_FIXTURE=1 ccrc test -- ./node_modules/.bin/vitest run test/review-lab-fixture.test.tsx';
const WRITE = process.env['CCRC_WRITE_FIXTURE'] === '1';

/** The three reference colours the page draws beside its lines, read out of `main.ts`'s text and not imported: that file
 *  imports `labFixture.ts`, which does not exist until this test has written it. */
function pageColour(name: string): string {
  const m = new RegExp(`export const ${name} = '(#[0-9a-fA-F]{6})';`).exec(readFileSync(path.join(import.meta.dirname, '..', 'src', 'review', 'main.ts'), 'utf8'));
  if (m === null) throw new Error(`main.ts declares no ${name}`);
  return m[1]!;
}
const LAB_GROUND = (): string => pageColour('LAB_GROUND');
const LAB_IMAGE_COLOUR = (): string => pageColour('LAB_IMAGE_COLOUR');
const LAB_SWATCH_COLOUR = (): string => pageColour('LAB_SWATCH_COLOUR');

const EXPORTED_AT = Date.UTC(2026, 10, 25, 12, 0, 0);
const text = (file: string): string => readFileSync(path.join(INPUTS, file), 'utf8');
const bytes = (file: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(path.join(INPUTS, file)));

/** The canary: one script, no quote and no ampersand (so the wrapper's attribute escape changes only its angle
 *  brackets), setting a global and recolouring the copy's swatch (`.lab-swatch` in the mockup, the page ground in the
 *  Markdown copy, which has no swatch element of its own). */
const CANARY = '<script>window.__reviewLabCanary=1;var t=document.querySelector(`.lab-swatch`)||document.body;t.style.background=`rgb(255,0,0)`;</script>';
/** What React writes for a `srcDoc` attribute value: the five characters it escapes. */
const escapeAttr = (s: string): string => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const MARKDOWN_BEFORE = '</body>';
const MOCKUP_BEFORE = escapeAttr('</body>');

function insertBeforeLast(copy: string, marker: string, insertion: string): string {
  const at = copy.lastIndexOf(marker);
  if (at < 0) throw new Error(`the build holds no ${marker}`);
  return copy.slice(0, at) + insertion + copy.slice(at);
}

type Leaf = ReturnType<typeof pageAt> & { kind: 'path' };
function leafAt(url: string): Leaf {
  const page = pageAt(url);
  if (page.kind !== 'path') throw new Error(`fixture: ${url} is not a leaf`);
  return page;
}

/** `buildExport`'s bytes for the committed Markdown page, with its one picture loaded from memory. */
async function markdownBuild(): Promise<string> {
  const tree = treeOk({ entries: [entry('specs', 'page.md'), entry('specs', 'swatch.png')], drafts: holder() });
  const page = leafAt('/docs/demo/specs/page.md');
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'page.md' };
  const source = text('page.md');
  const outcome = parseMarkdown(source, 'docs');
  if (outcome.kind !== 'tree') throw new Error(`fixture: ${outcome.kind}`);
  const detached = detachUrls(outcome.tree);
  const link: Omit<DocLinkContextValue, 'urls'> = {
    project: 'demo', pageRef: page.ref, pageAt: null, view: page.view, section: page.section, path: page.path, tree,
    pageSource: 'committed', onFragment: () => {},
  };
  const imagePin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'swatch.png' };
  const assets = createExportAssets();
  assets.track(docsApi.file('demo', imagePin)).report({ s: 'loaded', asset: { kind: 'raster', bytes: bytes('swatch.png'), mime: 'image/png' } });
  const request: ExportRequest = {
    page, tree, assets, readAt: EXPORTED_AT,
    source: {
      kind: 'tree', pin, show: fileResponse(source).show,
      body: { kind: 'tree', text: source, tree: detached.tree, urls: detached.urls, link }, store: syncTestStore('docs'),
    },
  };
  const built = await buildExport(exportInputOf(request, { exportedAt: EXPORTED_AT, theme: null }));
  if (!built.ok) throw new Error('fixture: the Markdown page did not fit');
  return new TextDecoder().decode(built.bytes);
}

/** `buildExport`'s bytes for the committed mockup page, its stylesheet and the font that stylesheet names inlined. */
async function mockupBuild(): Promise<string> {
  const html = text('mockup.html');
  const files = new Map<string, Uint8Array<ArrayBuffer>>([['style.css', bytes('style.css')], ['Geist-Variable.woff2', bytes('Geist-Variable.woff2')]]);
  const tree = treeOk({
    entries: [entry('specs', 'mockup.html'), ...[...files].map(([p, b]) => entry('specs', p, { committed: { kind: 'file', blob: BLOB_1, size: b.byteLength } }))],
    drafts: holder(),
  });
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: SERVED, section: 'specs', path: 'mockup.html' };
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('fixture: the pre-scan refused the mockup');
  const context: MockupContext = { project: 'demo', pin, tree };
  const plan = planMockupAssets(extractMockupRefs(parsed.doc, 'specs/mockup.html').refs, context);
  const reader: MockupAssetReader = {
    read: async (p) => {
      const b = files.get(p.path);
      return b === undefined ? { kind: 'failed', failure: 'not-found' } : { kind: 'ok', bytes: b };
    },
  };
  const result = await loadMockupAssets(plan, reader, new AbortController().signal);
  const request: ExportRequest = {
    page: leafAt('/docs/demo/specs/mockup.html'), tree, assets: null, readAt: EXPORTED_AT,
    source: { kind: 'mockup', pin, show: fileResponse(html).show, doc: parsed.doc, assets: { plan, settled: Promise.resolve({ s: 'loaded', result }), now: () => result } },
  };
  const built = await buildExport(exportInputOf(request, { exportedAt: EXPORTED_AT, theme: null }));
  if (!built.ok) throw new Error('fixture: the mockup page did not fit');
  return new TextDecoder().decode(built.bytes);
}

interface Expected {
  readonly canary: string;
  readonly canaryMockup: string;
  readonly markdownBefore: string;
  readonly mockupBefore: string;
  readonly markdownCopy: string;
  readonly mockupCopy: string;
}

/** The fixture as it must be: each build with the one canary put in. */
async function expectedFixture(): Promise<Expected> {
  const canaryMockup = escapeAttr(CANARY);
  return {
    canary: CANARY,
    canaryMockup,
    markdownBefore: MARKDOWN_BEFORE,
    mockupBefore: MOCKUP_BEFORE,
    markdownCopy: insertBeforeLast(await markdownBuild(), MARKDOWN_BEFORE, CANARY),
    mockupCopy: insertBeforeLast(await mockupBuild(), MOCKUP_BEFORE, canaryMockup),
  };
}

const NAMES = {
  canary: 'LAB_CANARY',
  canaryMockup: 'LAB_CANARY_MOCKUP',
  markdownBefore: 'LAB_CANARY_BEFORE_MARKDOWN',
  mockupBefore: 'LAB_CANARY_BEFORE_MOCKUP',
  markdownCopy: 'LAB_MARKDOWN_COPY',
  mockupCopy: 'LAB_MOCKUP_COPY',
} as const satisfies Record<keyof Expected, string>;

const HEADER = [
  '// GENERATED by pwa/test/review-lab-fixture.test.tsx: never edit this file by hand (native Docs draft review, X3, R2.3).',
  '//   regenerate: cd pwa && CCRC_WRITE_FIXTURE=1 ccrc test -- ./node_modules/.bin/vitest run test/review-lab-fixture.test.tsx',
  '// A data module: string constants only, no imports and no other code. `/review#lab` mounts the two copies in frames.',
  '// Each copy is `buildExport`\'s own output for a committed input page under pwa/test/fixtures/review-lab/ (a fixed commit,',
  '// a fixed export time, no theme), plus ONE insertion made after the build: LAB_CANARY, a script that would recolour the',
  '// copy\'s swatch and set a global if it ever ran (the builder strips scripts, so no real copy has one). The Markdown copy',
  '// takes it as is, before its last LAB_CANARY_BEFORE_MARKDOWN. The mockup copy takes LAB_CANARY_MOCKUP, the canary in the',
  '// escaped form the wrapper\'s srcDoc attribute holds, before its last LAB_CANARY_BEFORE_MOCKUP: that is the INNER document\'s',
  '// closing body tag, so the canary sits in the nested frame, the deepest one the copy holds.',
].join('\n');

function sourceOf(e: Expected): string {
  const lines = (Object.keys(NAMES) as (keyof Expected)[]).map((k) => `export const ${NAMES[k]} = ${JSON.stringify(e[k])};`);
  return `${HEADER}\n${lines.join('\n')}\n`;
}

/** The constants of a `labFixture.ts` text, read without importing it (the file may be absent or stale). */
function constantsOf(source: string): Partial<Record<keyof Expected, string>> {
  const out: Partial<Record<keyof Expected, string>> = {};
  for (const k of Object.keys(NAMES) as (keyof Expected)[]) {
    const m = new RegExp(`^export const ${NAMES[k]} = (".*");$`, 'm').exec(source);
    if (m !== null) out[k] = JSON.parse(m[1]!) as string;
  }
  return out;
}

/** The fixture as `labFixture.ts` holds it now. The structural rows below read THIS, never the rebuild, so a copy that lost
 *  its policy meta, its image or its canary in the file is red in its own row, whatever the first row says. */
function heldFixture(): Expected {
  const held = constantsOf(readFileSync(FIXTURE_FILE, 'utf8'));
  for (const k of Object.keys(NAMES) as (keyof Expected)[]) {
    if (held[k] === undefined) throw new Error(`labFixture.ts holds no ${NAMES[k]}. Regenerate it: ${REGENERATE}`);
  }
  return held as Expected;
}

const firstDifference = (a: string, b: string): number => {
  let i = 0;
  while (i < a.length && i < b.length && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
};

const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');
const innerOf = (outer: Document): string => outer.querySelector('iframe')?.getAttribute('srcdoc') ?? '';
const scriptsOf = (doc: Document): string[] => [...doc.querySelectorAll('script')].map((s) => s.outerHTML);

describe('the review lab fixture (R2.3, M-X3.16)', () => {
  it('holds exactly the bytes buildExport makes from the committed inputs, plus the one canary insertion', async () => {
    const expected = await expectedFixture();
    if (WRITE) writeFileSync(FIXTURE_FILE, sourceOf(expected));
    const held = constantsOf(readFileSync(FIXTURE_FILE, 'utf8'));
    for (const k of Object.keys(NAMES) as (keyof Expected)[]) {
      const a = held[k];
      const b = expected[k];
      const same = a === b;
      expect(same, `${NAMES[k]} is not what the builder makes (held ${a?.length ?? 'nothing'} characters, built ${b.length}`
        + `${a === undefined ? '' : `, first difference at ${firstDifference(a, b)}`}). Export's builder, its stylesheet or @ccrc/ui's tokens `
        + `changed, or the file was edited by hand. Regenerate it: ${REGENERATE}`).toBe(true);
    }
    expect(readFileSync(FIXTURE_FILE, 'utf8'), `labFixture.ts differs from its generated form. Regenerate it: ${REGENERATE}`).toBe(sourceOf(expected));
  });

  it('puts the canary in once: raw before the Markdown copy\'s last </body>, escaped before the mockup\'s inner </body>', async () => {
    const e = heldFixture();
    expect(e.canary).toBe(CANARY);
    expect(e.markdownBefore).toBe(MARKDOWN_BEFORE);
    expect(e.mockupBefore).toBe(MOCKUP_BEFORE);
    const mdBuild = await markdownBuild();
    const mockBuild = await mockupBuild();
    expect(e.markdownCopy.split(e.canary)).toHaveLength(2);
    expect(e.mockupCopy.split(e.canaryMockup)).toHaveLength(2);
    // Taking the canary out gives the build's own bytes back, so nothing else changed.
    expect(e.markdownCopy.replace(e.canary, '')).toBe(mdBuild);
    expect(e.mockupCopy.replace(e.canaryMockup, '')).toBe(mockBuild);
    expect(e.markdownCopy.indexOf(e.canary) + e.canary.length).toBe(e.markdownCopy.lastIndexOf(MARKDOWN_BEFORE));
    expect(e.mockupCopy.indexOf(e.canaryMockup) + e.canaryMockup.length).toBe(e.mockupCopy.lastIndexOf(MOCKUP_BEFORE));
    expect(e.canaryMockup).toBe(escapeAttr(e.canary));
    expect(e.canary).not.toMatch(/["'&]/);
  });

  it('each copy keeps its own DOCS_EXPORT_CSP meta as the first head child after the charset, and its generator meta', () => {
    const e = heldFixture();
    for (const copy of [e.markdownCopy, e.mockupCopy]) {
      expect(copy.startsWith('<!doctype html>')).toBe(true);
      const head = parseHtml(copy).head.children;
      expect(head[0]?.tagName).toBe('META');
      expect(head[0]?.getAttribute('charset')).toBe('utf-8');
      expect(head[1]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
      expect(head[1]?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
      expect([...head].some((c) => c.getAttribute('name') === 'generator' && c.getAttribute('content') === 'ccrc-docs-export/1')).toBe(true);
    }
  });

  it('the Markdown copy holds a data: PNG, its inline style, its one link and exactly one script, the canary', () => {
    const doc = parseHtml(heldFixture().markdownCopy);
    const imgs = [...doc.querySelectorAll('img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]?.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(doc.querySelectorAll('link')).toHaveLength(0);
    expect(scriptsOf(doc)).toEqual([CANARY]);
    expect([...doc.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('https://example.org/review-lab');
    expect(doc.querySelector('h1')?.textContent).toBe('Review lab page');
  });

  it('the mockup copy holds Export\'s wrapper with one nested <iframe sandbox="">, a data: font, the swatch rule and exactly one script, the canary, inside the inner frame', () => {
    const copy = heldFixture().mockupCopy;
    const outer = parseHtml(copy);
    const frames = [...outer.querySelectorAll('iframe')];
    expect(frames).toHaveLength(1);
    expect(frames[0]?.getAttribute('sandbox')).toBe('');
    expect(copy).toContain('<iframe sandbox=""');
    expect(scriptsOf(outer)).toEqual([]);
    const inner = innerOf(outer);
    const innerDoc = parseHtml(inner);
    expect(scriptsOf(innerDoc)).toEqual([CANARY]);
    // The stylesheet is one `data:text/css` link of the inner document, and the font is a `data:` URL INSIDE that sheet
    // (Export nests its inlined assets), so the sheet is decoded once to read it.
    const sheetUrl = /<link rel="stylesheet" href="(data:text\/css;base64,[A-Za-z0-9+/=]+)"/.exec(inner)?.[1];
    expect(sheetUrl).toBeDefined();
    const sheet = atob(sheetUrl!.slice('data:text/css;base64,'.length));
    expect(sheet).toMatch(/@font-face\s*\{[^}]*ReviewLabFace[^}]*url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\)/);
    expect(sheet).toMatch(/\.lab-text\s*\{[^}]*font-family:\s*'ReviewLabFace'/);
    expect(sheet).toMatch(/\.lab-swatch\s*\{[^}]*width:\s*120px[^}]*height:\s*24px[^}]*\}/);
    expect(sheet.toLowerCase()).toContain(`background: ${LAB_SWATCH_COLOUR().toLowerCase()}`);
    expect(inner).not.toContain('url(');
    expect(innerDoc.querySelector('.lab-swatch')).not.toBeNull();
    expect(innerDoc.querySelector('.lab-text')?.textContent).toBe('Review lab sample 0123 Hamburgefonstiv');
    // The inner document carries its own policy first, so the deepest frame is under one as well.
    const innerMeta = [...innerDoc.head.children].find((c) => c.getAttribute('http-equiv') === 'Content-Security-Policy');
    expect(innerMeta?.getAttribute('content')).toBe(DOCS_EXPORT_CSP);
  });

  it('the page\'s reference colours are the fixture\'s: the ground token, the picture\'s pixel and the swatch rule', () => {
    const e = heldFixture();
    const style = parseHtml(e.markdownCopy).querySelector('style')?.textContent ?? '';
    expect(/--bg-page:\s*([#0-9A-Za-z]+);/.exec(style)?.[1]?.toLowerCase()).toBe(LAB_GROUND().toLowerCase());
    expect(style).toMatch(/\.ccrc-export\s*\{[^}]*background:\s*var\(--bg-page\)/);
    // The PNG's first pixel, read out of its one IDAT chunk.
    const png = readFileSync(path.join(INPUTS, 'swatch.png'));
    const at = png.indexOf('IDAT');
    const pixels = inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
    const hex = `#${[pixels[1], pixels[2], pixels[3]].map((b) => (b ?? 0).toString(16).padStart(2, '0')).join('')}`;
    expect(hex).toBe(LAB_IMAGE_COLOUR().toLowerCase());
  });

  it('names no host but example.org and no absolute home path', () => {
    const e = heldFixture();
    for (const copy of [e.markdownCopy, e.mockupCopy]) {
      const withoutData = copy.replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/g, 'data:');
      expect(withoutData).not.toMatch(/\/home\/|\/Users\/|\/mnt\//);
      const hosts = [...withoutData.matchAll(/https?:\/\/([^/\s"'<>)&]+)/g)].map((m) => m[1]);
      // `https://github.com/example-org/...` is the permalink Export writes for the placeholder repository.
      for (const host of hosts) expect(['example.org', 'github.com', 'www.w3.org']).toContain(host);
    }
  });
});
