// The PDF frame's walls (X2 spec 2026-11-18 section 4.4; plan Task P3.2; mutation rows M11.16, M11.17 and M11.19): its
// sandbox, its policy token by token, the page's order (the meta first, the guard second), the scripts the policy names
// and only those, and the frame's one-load rule. jsdom does not run a srcdoc, so `load` is fired by hand; the frame's
// behaviour inside a real engine is pdf-frame.browser.test.ts's. Fixture assets are placeholders, never the package's.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PdfFrame } from '../src/docs/pdf/PdfFrame';
import { PDF_BOOT_JS } from '../src/docs/pdf/pdfBoot';
import { PDF_CLICK_GUARD_JS, PDF_SANDBOX, pdfCsp, pdfMeta } from '../src/docs/pdf/pdfPolicy';
import type { PdfAssets } from '../src/docs/pdf/pdfAssets';
import {
  buildPdfSrcdoc, inlineSafe, pdfCspOfPage, pdfUndrawnImages, type PdfDocumentInput,
} from '../src/docs/pdf/pdfSrcdoc';
import { base64Of } from '../src/docs/mockup/load';
import { PDF_TEXT } from '../src/docs/pdf/pdfWords';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('base64');
const VIEWER = 'globalThis.pdfjsLib = { placeholder: true };';
const WORKER = 'globalThis.pdfjsWorker = { placeholder: true };';
const ASSETS: PdfAssets = {
  viewer: VIEWER, worker: WORKER, fonts: { 'F.pfb': 'AAEC' }, cmaps: { 'C.bcmap': 'AwQF' },
  hashes: { guard: sha(PDF_CLICK_GUARD_JS), viewer: sha(VIEWER), boot: sha(PDF_BOOT_JS), worker: sha(WORKER) },
};
const PDF = Uint8Array.from('%PDF-1.7\n%%EOF\n', (c) => c.charCodeAt(0));
const input = (over: Partial<PdfDocumentInput> = {}): PdfDocumentInput => ({
  pdfB64: base64Of(PDF), viewer: ASSETS.viewer, worker: ASSETS.worker, fonts: ASSETS.fonts, cmaps: ASSETS.cmaps,
  hashes: ASSETS.hashes, undrawn: [], ...over,
});

/** The text of every `<script>` element of `page`, in order, with its type attribute ('' for a classic script). */
function scriptsOf(page: string): { type: string; text: string }[] {
  return [...page.matchAll(/<script(?: type="([^"]*)")?(?: id="[^"]*")?>([\s\S]*?)<\/script>/g)]
    .map((m) => ({ type: m[1] ?? '', text: m[2] ?? '' }));
}

it('pdf frame: the opening status can paint before even a warm frame mounts', async () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  const { container } = render(<PdfFrame bytes={PDF} name="a.pdf" loader={() => Promise.resolve(ASSETS)} />);
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByRole('status').textContent).toBe(PDF_TEXT.loading);
  expect(container.querySelector('iframe')).toBeNull();
  act(() => frames.shift()!(0));
  expect(screen.getByRole('status').textContent).toBe(PDF_TEXT.loading);
  expect(container.querySelector('iframe')).toBeNull();
  await act(async () => frames.shift()!(16));
  expect(container.querySelector('iframe')).not.toBeNull();
});

describe('pdf frame: sandbox is exactly allow-scripts (M11.16)', () => {
  it('the constant is the one token', () => {
    expect(PDF_SANDBOX).toBe('allow-scripts');
  });

  it('the frame carries it, with no-referrer and none of src, name, allow or allowfullscreen', async () => {
    const { container } = render(<PdfFrame bytes={PDF} name="a.pdf" loader={() => Promise.resolve(ASSETS)} />);
    const frame = await vi.waitFor(() => {
      const f = container.querySelector('iframe');
      if (f === null) throw new Error('no frame yet');
      return f;
    });
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    for (const a of ['src', 'name', 'allow', 'allowfullscreen']) expect(frame.hasAttribute(a), a).toBe(false);
    expect(frame.getAttribute('title')).toBe('PDF: a.pdf');
    const page = frame.getAttribute('srcdoc')!;
    expect(frame.getAttribute('csp')).toBe(pdfCspOfPage(page));
  });
});

describe('pdf frame: csp tokens pinned, no eval sources (M11.17)', () => {
  const A = sha('a');
  const B = sha('b');

  it('the policy is the spec\'s, token by token, with one hash source per digest', () => {
    expect(pdfCsp([A, B])).toBe(`default-src 'none'; script-src 'sha256-${A}' 'sha256-${B}'; style-src 'unsafe-inline'; `
      + "img-src data: blob:; font-src data:; worker-src blob:; base-uri 'none'; form-action 'none'");
  });

  it('no eval source, no inline script, no network source, no self', () => {
    const csp = pdfCsp([A]);
    for (const banned of ["'unsafe-eval'", "'wasm-unsafe-eval'", "'self'", 'http:', 'https:', '*', 'connect-src', 'frame-src', 'strict-dynamic']) {
      expect(csp, banned).not.toContain(banned);
    }
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc.split(' ').slice(1).every((t) => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(t))).toBe(true);
  });

  it('a digest given twice is named once; an empty list and a value that is not a digest throw', () => {
    expect(pdfCsp([A, A])).toBe(pdfCsp([A]));
    expect(() => pdfCsp([])).toThrow(RangeError);
    for (const bad of ["x' 'unsafe-eval", `${A} 'unsafe-eval'`, A.slice(1), 'not a digest', `${A}; connect-src *`]) {
      expect(() => pdfCsp([bad]), bad).toThrow(RangeError);
    }
  });
});

describe('pdf frame: meta first, guard second', () => {
  it('the page begins with the policy meta, then the click guard, then the frame', () => {
    const page = buildPdfSrcdoc(input());
    const csp = pdfCsp([ASSETS.hashes.guard, ASSETS.hashes.viewer, ASSETS.hashes.boot, ASSETS.hashes.worker]);
    expect(page.startsWith(pdfMeta(csp) + `<script>${PDF_CLICK_GUARD_JS}</script>`)).toBe(true);
    expect(pdfCspOfPage(page)).toBe(csp);
  });

  it('every script the page runs is named by its hash, and the policy names nothing else but the parser', () => {
    const page = buildPdfSrcdoc(input());
    const scripts = scriptsOf(page);
    expect(scripts.map((s) => s.type)).toEqual(['', 'application/json', 'module', 'module']);
    const run = scripts.filter((s) => s.type !== 'application/json');
    expect(run.map((s) => s.text)).toEqual([PDF_CLICK_GUARD_JS, VIEWER, PDF_BOOT_JS]);
    const named = [...pdfCspOfPage(page).matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]);
    // The fourth hash is the parser's, run only on the frame's own thread when its worker does not start.
    expect(named).toEqual([...run.map((s) => sha(s.text)), sha(WORKER)]);
  });

  it('the seed carries the PDF, the parser, the fonts and the CMaps, with every < escaped', () => {
    const page = buildPdfSrcdoc(input({ fonts: { 'F.pfb': 'AAEC' }, undrawn: ['JPEG 2000'] }));
    const seedText = scriptsOf(page)[1]!.text;
    expect(seedText).not.toContain('<');
    const seed = JSON.parse(seedText) as Record<string, unknown>;
    expect(seed).toEqual({
      pdf: base64Of(PDF), worker: WORKER, fonts: { 'F.pfb': 'AAEC' }, cmaps: ASSETS.cmaps, undrawn: ['JPEG 2000'],
    });
    // A parser text holding `<` (legal JavaScript) cannot end the seed's element early.
    const tricky = 'var a = 1 < 2; // <b>';
    const page2 = buildPdfSrcdoc(input({ worker: tricky, hashes: { ...ASSETS.hashes, worker: sha(tricky) } }));
    expect((JSON.parse(scriptsOf(page2)[1]!.text) as { worker: string }).worker).toBe(tricky);
  });

  it('a script that cannot be inlined byte for byte is refused, never built', () => {
    for (const bad of ['a</script>b', 'a</SCRIPT b', 'x<!--y', 'a\rb', 'a\0b']) {
      expect(inlineSafe(bad), JSON.stringify(bad)).toBe(false);
      expect(() => buildPdfSrcdoc(input({ viewer: bad }))).toThrow(RangeError);
      expect(() => buildPdfSrcdoc(input({ worker: bad }))).toThrow(RangeError);
    }
    expect(inlineSafe(PDF_BOOT_JS)).toBe(true);
    expect(inlineSafe(PDF_CLICK_GUARD_JS)).toBe(true);
  });

  it('a page that does not begin with the meta has no policy to read', () => {
    expect(() => pdfCspOfPage('<p>x</p>')).toThrow(/does not begin with the Content-Security-Policy meta/);
  });
});

describe('the images the frame cannot draw, named for its note', () => {
  const b = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));
  it.each([
    ['none', '%PDF-1.7 << /Filter /DCTDecode >>', []],
    ['JPEG 2000', '%PDF-1.7 << /Filter /JPXDecode >>', ['JPEG 2000']],
    ['JBIG2', '%PDF-1.7 << /Filter [/FlateDecode /JBIG2Decode] >>', ['JBIG2']],
    ['both, in the table order', '%PDF /JBIG2Decode /JPXDecode', ['JPEG 2000', 'JBIG2']],
    ['a filter cut short is none', '%PDF /JPXDecod', []],
  ] as const)('%s', (_n, text, want) => {
    expect(pdfUndrawnImages(b(text))).toEqual(want);
  });
});

describe('pdf frame: forced navigation tears down once (M11.19)', () => {
  it('the first load is the page; a second tears the frame down and shows why; nothing brings it back', async () => {
    const loader = vi.fn(() => Promise.resolve(ASSETS));
    const { container } = render(<PdfFrame bytes={PDF} name="a.pdf" loader={loader} />);
    const frame = await vi.waitFor(() => {
      const f = container.querySelector('iframe');
      if (f === null) throw new Error('no frame yet');
      return f;
    });
    // jsdom fires the page's own load by itself once the frame is mounted: that one is the first.
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector('iframe')).toBe(frame);
    fireEvent.load(frame);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(PDF_TEXT.navigated);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector('iframe')).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('assets that fail to load show the failure, and no frame', async () => {
    render(<PdfFrame bytes={PDF} name="a.pdf" loader={() => Promise.reject(new Error('gone'))} />);
    expect((await screen.findByRole('alert')).textContent).toBe(PDF_TEXT.failed);
    expect(document.querySelector('iframe')).toBeNull();
  });
});

describe('pdf frame parser startup', () => {
  function start(documentResult = new Promise<unknown>(() => undefined)) {
    const frameDoc = document.implementation.createHTMLDocument();
    for (const id of ['pdf-pages', 'pdf-note', 'pdf-link', 'pdf-fit', 'pdf-smaller', 'pdf-larger', 'pdf-zoom', 'pdf-seed']) {
      const element = frameDoc.createElement('div');
      element.id = id;
      frameDoc.body.append(element);
    }
    frameDoc.getElementById('pdf-seed')!.textContent = JSON.stringify({ pdf: base64Of(PDF), worker: WORKER, undrawn: [] });
    class Port extends EventTarget {
      static current: Port;
      terminate = vi.fn();
      constructor() { super(); Port.current = this; }
    }
    class PdfWorker {
      readonly options: { port: Port };
      constructor(options: { port: Port }) { this.options = options; }
    }
    const getDocument = vi.fn((_params: { worker?: PdfWorker }) => ({ promise: documentResult }));
    const revokeObjectURL = vi.fn();
    let firstVisible = 1;
    const frameWindow = Object.assign(new EventTarget(), {
      devicePixelRatio: 1, innerHeight: 800, requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    });
    const createElement = frameDoc.createElement.bind(frameDoc);
    vi.spyOn(frameDoc, 'createElement').mockImplementation((tag) => {
      const node = createElement(tag);
      vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => {
        const top = (Number(node.dataset.page) - firstVisible) * 800;
        return new DOMRect(0, top, 600, 792);
      });
      return node;
    });
    const scope = {
      document: frameDoc, window: frameWindow, performance: { mark: vi.fn() }, atob, Blob, Uint8Array,
      Worker: Port, URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL },
      setTimeout, clearTimeout, pdfjsLib: { PDFWorker: PdfWorker, getDocument }, pdfjsWorker: undefined as unknown,
    };
    const append = frameDoc.head.appendChild.bind(frameDoc.head);
    vi.spyOn(frameDoc.head, 'appendChild').mockImplementation((node) => {
      const appended = append(node);
      scope.pdfjsWorker = { ready: true }; // This fixture supplies the loaded own-thread parser at the script boundary.
      return appended;
    });
    runInNewContext(PDF_BOOT_JS, scope);
    return {
      frameDoc, port: Port.current, getDocument, revokeObjectURL, parser: () => frameDoc.body.getAttribute('data-parser'),
      view: (page: number) => { firstVisible = page; frameWindow.dispatchEvent(new Event('scroll')); },
    };
  }

  it('a distant page releases its canvas backing store even if a caller still holds that canvas', async () => {
    const rendered = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
      getAnnotations: () => Promise.resolve([]),
    };
    const { frameDoc, port, view } = start(Promise.resolve({ numPages: 6, getPage: () => Promise.resolve(rendered) }));
    port.dispatchEvent(new Event('error'));
    const canvasFor = (page: number) => frameDoc.querySelector<HTMLCanvasElement>(`[data-page="${page}"] canvas`);
    await vi.waitFor(() => expect(frameDoc.body.getAttribute('data-state')).toBe('shown'));
    const original = canvasFor(1)!;
    expect(original.width).toBeGreaterThan(0);
    view(6);
    await vi.waitFor(() => expect(canvasFor(6)).not.toBeNull());
    expect(original.width * original.height).toBe(0);
    expect(canvasFor(1)).toBeNull();
    view(1);
    await vi.waitFor(() => expect(canvasFor(1)).not.toBeNull());
    expect(canvasFor(1)).not.toBe(original);
  });

  it.each(['silent', 'error', 'ready'] as const)('%s worker chooses exactly one parser path', (mode) => {
    vi.useFakeTimers();
    try {
      const { port, parser, getDocument, revokeObjectURL } = start();
      expect(getDocument).not.toHaveBeenCalled();
      if (mode === 'error') port.dispatchEvent(new Event('error'));
      if (mode === 'ready') port.dispatchEvent(new MessageEvent('message', {
        data: { sourceName: 'worker', targetName: 'main', action: 'ready', data: new Uint8Array() },
      }));
      if (mode === 'silent') {
        vi.advanceTimersByTime(1999);
        expect(parser()).toBeNull();
        vi.advanceTimersByTime(1);
      }
      expect(parser()).toBe(mode === 'ready' ? 'worker' : 'own-thread');
      vi.advanceTimersByTime(4000);
      expect(getDocument).toHaveBeenCalledTimes(1);
      expect(getDocument.mock.calls[0]![0].worker?.options.port).toBe(mode === 'ready' ? port : undefined);
      expect(port.terminate).toHaveBeenCalledTimes(mode === 'ready' ? 0 : 1);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:fixture');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pdf frame: no parent or Window message channel', () => {
  const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'docs', 'pdf');
  it('only the exact ready listener on the frame-local Worker is allowed', () => {
    const files = readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files).toEqual(expect.arrayContaining(['PdfFrame.tsx', 'pdfBoot.ts', 'pdfPolicy.ts', 'pdfSrcdoc.ts']));
    for (const f of files) {
      const raw = readFileSync(path.join(DIR, f), 'utf8');
      const text = f === 'pdfBoot.ts' ? raw.replace("worker.addEventListener('message', workerReady);", '')
        .replace("worker.removeEventListener('message', workerReady);", '') : raw;
      if (f === 'pdfBoot.ts') expect(raw).toContain("worker = new Worker(workerUrl, { type: 'module' });");
      for (const banned of [/postMessage/, /MessageChannel/, /MessagePort/, /onmessage/i, /['"`]message['"`]/, /BroadcastChannel/]) {
        expect(banned.test(text), `${f} matches ${String(banned)}`).toBe(false);
      }
    }
  });
});
