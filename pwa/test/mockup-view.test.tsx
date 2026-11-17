// The mockup viewer (native Docs reader, completion plan Task 8, C2; base spec 2026-10-01 5.6.1-5.6.8; rows M5.13-M5.16,
// M5.21, M5.22). The real C1 modules run (pre-scan, parser, planner, loader, build); only the asset reader is a fake
// whose answers each test controls, and `loadMockupAssets` is wrapped so a test can hold one attempt's result and
// hand it back after the view has moved on. jsdom does not run a srcdoc, so a frame's `load` events are fired by hand.
// Completion plan Task 9 adds the last describe: what the view publishes for Export. Placeholders only (project `demo`,
// hosts `cdn.example`, `lib.example`, `ext.example`).
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  DOCS_CLASS_CAP, docsApi,
  type DocPin, type DocsEntry, type DocsFileResponse, type DocsPageLocation, type DocsShowOk, type DocsTreeOk,
} from '../../shared/docs';
import { DocsAssetContext, type DocsAssetContextValue } from '../src/docs/DocImage';
import { DocsScreen } from '../src/screens/DocsScreen';
import { MockupView, type MockupViewProps } from '../src/docs/MockupView';
import { createFetchQueue } from '../src/docs/fetchQueue';
import type { DocsFileAnswer, DocsLoaders } from '../src/docs/failures';
import { DOCS_FAILURE_SENTENCE, DOCS_SLOT_SENTENCE, DOCS_VIEW_TEXT, DOC_IMAGE_REFUSED_SENTENCE, EXPORT_TEXT, MOCKUP_TEXT, MOCKUP_VERDICT_SENTENCE } from '../src/docs/docsText';
import { ExportBodyContext, GATE_BODY, type ExportBody, type MockupLoadEnd } from '../src/docs/exportBody';
import { buildMockupSrcdoc, loadMockupAssets } from '../src/docs/mockup/load';
import {
  MOCKUP_AUTO_RENDER_BYTES, MOCKUP_CLICK_GUARD, MOCKUP_CSP, MOCKUP_MAX_ASSET_BYTES, MOCKUP_MAX_ATTRIBUTES, MOCKUP_MAX_DEPTH,
  MOCKUP_MAX_OPEN_FORMATTING, MOCKUP_MAX_TAGS, mockupCsp, metaFor,
} from '../src/docs/mockup/policy';
import type { HttpsOrigin, MockupAssetReader, MockupContext, MockupReadAnswer } from '../src/docs/mockup/ports';
import { HighlighterContext } from '../src/lib/highlighterContext';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { navigate, useLocation } from '../src/lib/router';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { BLOB_2, COMMIT_A, COMMIT_B, FP_1, draftOf, entry, failedAnswer, fakeLoaders, fileResponse, holder, okTree, treeOk, type FakeLoaders } from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

vi.mock('../src/docs/mockup/load', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/docs/mockup/load')>();
  return { ...real, loadMockupAssets: vi.fn(real.loadMockupAssets), buildMockupSrcdoc: vi.fn(real.buildMockupSrcdoc) };
});

const RealDOMParser = DOMParser;
let constructed = 0;

beforeEach(() => {
  constructed = 0;
  vi.stubGlobal('DOMParser', class extends RealDOMParser {
    constructor() {
      super();
      constructed += 1;
    }
  });
  vi.mocked(loadMockupAssets).mockClear();
  vi.mocked(buildMockupSrcdoc).mockClear();
});

afterEach(() => {
  cleanup();
  clearAuthLost();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
  localStorage.clear();
  sessionStorage.clear();
});

const enc = new TextEncoder();
const bytesOf = (...n: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(n);
const PAGE: DocsPageLocation & { kind: 'path' } = {
  kind: 'path', project: 'demo', section: 'specs', path: 'm.html', dirSlash: false, ref: null, at: null, view: 'effective', frame: 'inline',
};
const DRAFT_PAGE: DocsPageLocation & { kind: 'path' } = { ...PAGE, ref: { kind: 'bare', name: 'main' } };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise<void>((r) => { setTimeout(r, 0); });
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function showOf(text: string, size: number = enc.encode(text).byteLength): DocsShowOk {
  return {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 1, source: 'committed', section: 'specs', path: 'm.html', size,
    sha256: 'c'.repeat(64), encoding: 'utf8', text, commit: COMMIT_A,
  };
}

function ctxOf(entries: DocsEntry[], pin?: DocPin, tree?: DocsTreeOk): MockupContext {
  const own: DocPin = pin ?? { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
  return { project: 'demo', pin: own, tree: tree ?? treeOk({ entries: [entry('specs', 'm.html'), ...entries], drafts: holder() }) };
}

const DRAFT_PIN: DocPin = { kind: 'draft', branch: 'main', head: COMMIT_A, section: 'specs', path: 'm.html', fp: FP_1 };
function draftCtx(entries: DocsEntry[]): MockupContext {
  return ctxOf([], DRAFT_PIN, treeOk({ entries: [entry('specs', 'm.html', { draft: draftOf('modified') }), ...entries], drafts: holder() }));
}
const draftAsset = (path: string): DocsEntry => entry('specs', path, { draft: draftOf('modified') });

interface Deferred { readonly promise: Promise<MockupReadAnswer>; resolve(a: MockupReadAnswer): void }
function deferred(): Deferred {
  let resolve!: (a: MockupReadAnswer) => void;
  const promise = new Promise<MockupReadAnswer>((r) => { resolve = r; });
  return { promise, resolve };
}

/** A reader over fixed answers by path (a path not listed answers three bytes); a gated path waits for its gate. */
function fakeReader(gates: Map<string, Deferred> = new Map()) {
  const calls: DocPin[] = [];
  const reader: MockupAssetReader = {
    read: async (pin) => {
      calls.push(pin);
      const gate = gates.get(pin.path);
      if (gate !== undefined) return gate.promise;
      return { kind: 'ok', bytes: bytesOf(1, 2, 3) };
    },
  };
  return { reader, calls, paths: () => calls.map((c) => c.path) };
}

const DOWNLOAD = <button type="button">Download</button>;
const LOADERS = fakeLoaders().loaders;

interface Setup {
  readonly html: string;
  readonly size?: number;
  readonly context?: MockupContext;
  readonly reader?: MockupAssetReader;
  readonly page?: DocsPageLocation & { kind: 'path' };
  readonly onDraft?: Mock<(n: number) => void>;
  readonly relist?: () => void;
  readonly keyed?: string;
}

/** A stable assets context per `onDraft` (a new object each render would re-run the view's effects). */
const ASSETS = new WeakMap<object, DocsAssetContextValue>();
function viewOf(s: Setup, onDraft: Mock<(n: number) => void>, queue = createFetchQueue()): ReactNode {
  let assets = ASSETS.get(onDraft);
  if (assets === undefined) {
    assets = { loaders: LOADERS, queue, onDraftAsset: onDraft };
    ASSETS.set(onDraft, assets);
  }
  const props: MockupViewProps = {
    show: showOf(s.html, s.size), context: s.context ?? ctxOf([]), reader: s.reader ?? fakeReader().reader,
    page: s.page ?? PAGE, relist: s.relist ?? (() => {}), download: DOWNLOAD,
  };
  return (
    <DocsAssetContext value={assets}>
      <MockupView key={s.keyed ?? 'k'} {...props} />
    </DocsAssetContext>
  );
}

function mount(s: Setup) {
  const onDraft = s.onDraft ?? vi.fn<(n: number) => void>();
  const r = render(viewOf(s, onDraft));
  return {
    ...r, onDraft,
    again: (next: Setup) => r.rerender(viewOf(next, onDraft)),
    frame: (): HTMLIFrameElement | null => r.container.querySelector('iframe'),
  };
}
const frameIn = (c: HTMLElement): HTMLIFrameElement => {
  const f = c.querySelector('iframe');
  if (f === null) throw new Error('no frame');
  return f;
};
const button = (name: string | RegExp): HTMLElement => screen.getByRole('button', { name });
/** Opens a fold the way the browser does: `open` set, then its `toggle` event. */
function openFold(c: HTMLElement, selector: string): HTMLElement {
  const d = c.querySelector<HTMLDetailsElement>(selector);
  if (d === null) throw new Error(`no fold ${selector}`);
  d.open = true;
  fireEvent(d, new Event('toggle'));
  return d;
}
const CENSUS = 'details.docs-mockup-census';
const LINKS = 'details.docs-mockup-links';

const doc = (srcdoc: string): Document => new RealDOMParser().parseFromString(srcdoc, 'text/html');

describe('the HTML leaf mounts the viewer (M5.13; the stand-in is gone)', () => {
  const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
  function Routed(p: { readonly loaders: DocsLoaders }): ReactNode {
    const { path, search } = useLocation();
    return <DocsScreen path={path} search={search} loaders={p.loaders} parser={parser} />;
  }
  const fileAs = (text: string): DocsFileAnswer => {
    const r: DocsFileResponse = fileResponse(text);
    return { s: 'ok', value: { ...r, contentClass: 'html', show: { ...r.show, path: 'm.html', size: text.length } } };
  };
  function byPath(tree: DocsTreeOk, files: Record<string, DocsFileAnswer>): FakeLoaders {
    const f = fakeLoaders({ tree: okTree(tree) });
    f.file.mockImplementation(async (_p: string, pin: DocPin) => files[pin.path] ?? failedAnswer('absent-path'));
    return f;
  }

  it.each(['/docs/demo/specs/m.html', '/docs/demo/specs/m.html?ref=main&frame=full'])('%s: the frame, no stand-in sentence', async (url) => {
    const f = byPath(treeOk({ entries: [entry('specs', 'm.html')] }), { 'm.html': fileAs('<p>mock</p>') });
    navigate(url);
    const { container } = render(<Routed loaders={f.loaders} />);
    await waitFor(() => expect(container.querySelector('iframe.docs-mockup-frame')).not.toBeNull());
    expect(screen.queryByText(/HTML mockups open in a later release/)).toBeNull();
    if (!url.includes('frame=full')) expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.download })).toBeInTheDocument();
    else expect(screen.getByRole('button', { name: MOCKUP_TEXT.close })).toBeInTheDocument();
    expect(frameIn(container).getAttribute('srcdoc')!.startsWith(metaFor(MOCKUP_CSP) + MOCKUP_CLICK_GUARD)).toBe(true);
  });

  it('Export is offered on the screen: disabled "Render the mockup first" over the gate, enabled once the view has a plan, and its sheet builds the snapshot (completion plan Task 9; M5.EX6)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    navigate('/docs/demo/specs/m.html');
    const gated = render(<Routed loaders={byPath(tree, { 'm.html': fileAs(`<p>${'x'.repeat(MOCKUP_AUTO_RENDER_BYTES)}</p>`) }).loaders} />);
    const waiting = await screen.findByRole('button', { name: 'Export: Render the mockup first' });
    expect(waiting).toBeDisabled();
    fireEvent.click(button(/^Render mockup · /));
    await waitFor(() => expect(gated.container.querySelector('.docs-export')).toBeEnabled());
    gated.unmount();
    const { container } = render(<Routed loaders={byPath(tree, { 'm.html': fileAs('<p>mock</p><script>x()</script>') }).loaders} />);
    await waitFor(() => expect(container.querySelector('iframe.docs-mockup-frame')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('.docs-export')).toBeEnabled());
    fireEvent.click(container.querySelector('.docs-export')!);
    const save = await screen.findByRole('button', { name: new RegExp(`^Save demo_specs_m\\.html_${COMMIT_A.slice(0, 8)}\\.html \\(\\d+ KiB\\)$`) }, { timeout: 5000 });
    expect(save).toBeInTheDocument();
    expect(screen.getByText(EXPORT_TEXT.mockupCss)).toBeInTheDocument();
  });

  it('a page the pre-scan refuses still offers Export, which saves its source (the plain arm; M5.EX6)', async () => {
    const tree = treeOk({ entries: [entry('specs', 'm.html')] });
    navigate('/docs/demo/specs/m.html');
    const { container } = render(<Routed loaders={byPath(tree, { 'm.html': fileAs('<div>'.repeat(MOCKUP_MAX_DEPTH + 1)) }).loaders} />);
    expect(await screen.findByText(MOCKUP_TEXT.tooComplex)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('.docs-export')).toBeEnabled());
    fireEvent.click(container.querySelector('.docs-export')!);
    expect(await screen.findByRole('button', { name: /^Save demo_specs_m\.html_/ }, { timeout: 5000 })).toBeInTheDocument();
  });

  it('a listed size over the class cap: the too-large sentence and Download, no viewer, no file request', async () => {
    const big = DOCS_CLASS_CAP.html + 1;
    const f = byPath(treeOk({ entries: [entry('specs', 'm.html', { committed: { kind: 'file', blob: '1'.repeat(40), size: big } })] }), {});
    navigate('/docs/demo/specs/m.html');
    const { container } = render(<Routed loaders={f.loaders} />);
    expect(await screen.findByText(/Docs shows files of this kind up to/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DOCS_VIEW_TEXT.download })).toBeInTheDocument();
    expect(container.querySelector('iframe')).toBeNull();
    expect(f.file).not.toHaveBeenCalled();
    expect(constructed).toBe(0);
  });
});

describe('the size gate (M5.22; base 5.6.2 step 3)', () => {
  it('pins the gate at exactly 1 MiB', () => {
    expect(MOCKUP_AUTO_RENDER_BYTES).toBe(1_048_576);
  });

  it('EXACTLY 1 048 576 bytes renders on open with no tap, one parser', async () => {
    const m = mount({ html: '<p>a</p>', size: 1_048_576 });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^Render mockup/ })).toBeNull();
    expect(constructed).toBe(1);
  });

  it('1 048 577 bytes shows "Render mockup · …" and constructs no parser until tapped, then one', async () => {
    const m = mount({ html: '<p>a</p>', size: 1_048_577 });
    const go = button(/^Render mockup · /);
    expect(go.textContent).toBe('Render mockup · 1.0 MiB');
    expect(button('Source')).toBeInTheDocument();
    expect(button('Download')).toBeInTheDocument();
    await flush();
    expect(constructed).toBe(0);
    expect(m.frame()).toBeNull();
    fireEvent.click(go);
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(constructed).toBe(1);
    expect(screen.queryByRole('button', { name: /^Render mockup/ })).toBeNull();
  });

  it('a gated page the pre-scan refuses shows the refusal before any tap, with no render control and no parser', async () => {
    mount({ html: '<div>'.repeat(MOCKUP_MAX_DEPTH + 1), size: 1_048_577 });
    expect(screen.getByText(MOCKUP_TEXT.tooComplex)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Render mockup/ })).toBeNull();
    await flush();
    expect(constructed).toBe(0);
  });
});

describe('a pre-scan refusal (M5.22 rendering half)', () => {
  it.each([
    ['too-deep', '<div>'.repeat(MOCKUP_MAX_DEPTH + 1), 'its elements nest too deeply'],
    ['too-many-tags', '<br>'.repeat(MOCKUP_MAX_TAGS + 1), 'it has too many tags'],
    ['too-many-formatting', '<b>'.repeat(MOCKUP_MAX_OPEN_FORMATTING + 1), 'it keeps too many formatting elements open at once'],
    ['too-many-attributes', `<p ${Array.from({ length: MOCKUP_MAX_ATTRIBUTES + 1 }, (_, i) => `a${i}`).join(' ')}>`, 'a tag carries too many attributes'],
    ['foreign-markup', '<svg><desc><b>x</b></desc></svg>', 'it puts markup inside SVG or MathML content'],
  ])('%s: the line, its reason, counts and limits, Source and Download; no render control, frame or census; zero parsers', async (_why, html, reason) => {
    const reads = fakeReader();
    const m = mount({ html, reader: reads.reader });
    expect(screen.getByText(MOCKUP_TEXT.tooComplex)).toBeInTheDocument();
    expect(screen.getByText(`Not rendered: ${reason}.`)).toBeInTheDocument();
    const counts = screen.getByText(/^Measured: depth \d+, \d+ tags, \d+ formatting elements open\./);
    expect(counts.textContent).toContain(`Limits: depth ${MOCKUP_MAX_DEPTH}, ${MOCKUP_MAX_TAGS} tags, ${MOCKUP_MAX_OPEN_FORMATTING} formatting elements open, ${MOCKUP_MAX_ATTRIBUTES} attributes on one tag.`);
    expect(button('Source')).toBeInTheDocument();
    expect(button('Download')).toBeInTheDocument();
    for (const absent of [/^Render mockup/, /Run scripts/, /Load external/, /Full screen/, /New tab/]) {
      expect(screen.queryByRole('button', { name: absent })).toBeNull();
    }
    await flush();
    expect(m.frame()).toBeNull();
    expect(m.container.querySelector('details')).toBeNull();
    expect(constructed).toBe(0);
    expect(reads.calls).toHaveLength(0);
  });

  it('Source on a refused page shows the file as source', async () => {
    mount({ html: '<div>'.repeat(MOCKUP_MAX_DEPTH + 1) });
    fireEvent.click(button('Source'));
    expect(document.querySelector('.code-block, pre.doc-plain')?.textContent).toContain('<div><div>');
  });
});

describe('the frame (M5.13)', () => {
  it('static: sandbox present and empty, no src, name, allow or allowfullscreen; no-referrer; csp equals the meta; meta then click guard first', async () => {
    const m = mount({ html: '<!doctype html><title>t</title><p>hi</p>' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const f = m.frame()!;
    expect(f.hasAttribute('sandbox')).toBe(true);
    expect(f.getAttribute('sandbox')).toBe('');
    for (const a of ['src', 'name', 'allow', 'allowfullscreen']) expect(f.hasAttribute(a), a).toBe(false);
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    const srcdoc = f.getAttribute('srcdoc')!;
    expect(srcdoc.startsWith(metaFor(MOCKUP_CSP) + MOCKUP_CLICK_GUARD)).toBe(true);
    expect(f.getAttribute('csp')).toBe(MOCKUP_CSP);
    const meta = doc(srcdoc).querySelector('meta[http-equiv="Content-Security-Policy"]');
    expect(meta?.getAttribute('content')).toBe(f.getAttribute('csp'));
    expect(f.getAttribute('title')).toBe('Mockup: m.html');
  });

  it('Run scripts remounts the frame scripted (a NEW element), exactly allow-scripts; Stop scripts remounts it static and destroys the old one', async () => {
    const m = mount({ html: '<p>a</p><script>x()</script>' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const first = m.frame()!;
    expect(first.getAttribute('sandbox')).toBe('');
    expect(screen.getByText(MOCKUP_TEXT.scriptsOff)).toBeInTheDocument();
    fireEvent.click(button(MOCKUP_TEXT.runScripts));
    const second = m.frame()!;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.getAttribute('sandbox')).toBe('allow-scripts');
    expect(second.getAttribute('srcdoc')).toBe(first.getAttribute('srcdoc'));
    expect(screen.queryByText(MOCKUP_TEXT.scriptsOff)).toBeNull();
    fireEvent.click(button(MOCKUP_TEXT.stopScripts));
    const third = m.frame()!;
    expect(third).not.toBe(second);
    expect(second.isConnected).toBe(false);
    expect(third.getAttribute('sandbox')).toBe('');
    expect(m.container.querySelectorAll('iframe')).toHaveLength(1);
  });

  it.each([
    ['no scripts at all', '<p>a</p><a href="#x">x</a>', false],
    ['a script element', '<script>1</script>', true],
    ['an on* attribute', '<p onclick="f()">a</p>', true],
    ['a javascript: href', '<a href="javascript:f()">a</a>', true],
    ['a javascript: form action', '<form action="javascript:f()"></form>', true],
    ['a meta refresh', '<meta http-equiv="refresh" content="5">', true],
    ['a script inside svg', '<svg><script>1</script></svg>', true],
  ])('%s: Run scripts is offered only when the page has scripts', async (_n, html, has) => {
    const m = mount({ html });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(screen.queryByRole('button', { name: MOCKUP_TEXT.runScripts }) !== null).toBe(has);
    expect(screen.queryByText(MOCKUP_TEXT.scriptsOff) !== null).toBe(has);
  });

  it('script and origin choices reset on a new key (a doc or mode change), and nothing is stored and the URL does not move', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const html = '<script>import("https://lib.example/m.js")</script><img src="https://cdn.example/a.png">';
    const m = mount({ html, keyed: 'doc-1' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const url = location.href;
    fireEvent.click(button(MOCKUP_TEXT.runScripts));
    fireEvent.click(button(/^Load external/));
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
    await waitFor(() => expect(m.frame()!.getAttribute('csp')).not.toBe(MOCKUP_CSP));
    expect(m.frame()!.getAttribute('sandbox')).toBe('allow-scripts');
    m.again({ html, keyed: 'doc-2' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(m.frame()!.getAttribute('sandbox')).toBe('');
    expect(m.frame()!.getAttribute('csp')).toBe(MOCKUP_CSP);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length + sessionStorage.length).toBe(0);
    expect(location.href).toBe(url);
  });
});

describe('a second load tears the frame down (M5.15; base 5.6.6)', () => {
  it('the first load is the page; the second removes the frame, shows the notice, and nothing remounts until Reload mockup', async () => {
    const m = mount({ html: '<p>a</p>' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const first = m.frame()!;
    // jsdom fires the page's own load by itself: it is the first one, and the view keeps the frame through it.
    await flush();
    expect(m.frame()).toBe(first);
    fireEvent.load(first);
    expect(m.frame()).toBeNull();
    expect(first.isConnected).toBe(false);
    expect(screen.getByText(MOCKUP_TEXT.navigatedAway)).toBeInTheDocument();
    await flush();
    expect(m.frame()).toBeNull();
    fireEvent.click(button(MOCKUP_TEXT.reload));
    expect(m.frame()).not.toBeNull();
    expect(m.frame()).not.toBe(first);
    expect(screen.queryByText(MOCKUP_TEXT.navigatedAway)).toBeNull();
  });

  it('a build published over a showing frame is a NEW element, so a browser never reloads one iframe in place and calls it a navigation (review I1)', async () => {
    // jsdom never reloads a changed srcdoc; a browser does, and fires a second load on the SAME element, which the frame
    // reads as the document navigating away. The view therefore gives each published build its own element.
    let answers = 0;
    const reader: MockupAssetReader = {
      read: async () => {
        answers += 1;
        return answers === 1 ? { kind: 'failed', failure: 'auth' } : { kind: 'ok', bytes: bytesOf(1, 2, 3) };
      },
    };
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    await flush();
    const first = m.frame()!;
    const firstDoc = first.getAttribute('srcdoc');
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(m.frame()!.getAttribute('srcdoc')).not.toBe(firstDoc));
    await flush();
    const second = m.frame()!;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    // The new element's one load (jsdom fires it by itself) is its page, and the frame stands.
    expect(screen.queryByText(MOCKUP_TEXT.navigatedAway)).toBeNull();
    expect(m.frame()).toBe(second);
  });

  it('a new context whose assets changed also publishes into a NEW element (review I1)', async () => {
    const reads = fakeReader();
    const gate = (entries: DocsEntry[]): Setup => ({ html: '<img src="a.png"><img src="b.png">', context: ctxOf(entries), reader: reads.reader });
    const m = mount(gate([entry('specs', 'a.png')]));
    await waitFor(() => expect(m.frame()).not.toBeNull());
    await flush();
    const first = m.frame()!;
    const firstDoc = first.getAttribute('srcdoc');
    m.again(gate([entry('specs', 'a.png'), entry('specs', 'b.png')]));
    await waitFor(() => expect(m.frame()!.getAttribute('srcdoc')).not.toBe(firstDoc));
    await flush();
    expect(m.frame()).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(screen.queryByText(MOCKUP_TEXT.navigatedAway)).toBeNull();
  });

  it('Reload mockup keeps a Load external choice made in this view', async () => {
    const m = mount({ html: '<img src="https://cdn.example/a.png">' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    fireEvent.click(button(/^Load external/));
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
    const csp = mockupCsp(['https://cdn.example' as HttpsOrigin]);
    await waitFor(() => expect(m.frame()!.getAttribute('csp')).toBe(csp));
    await flush();
    fireEvent.load(m.frame()!);
    expect(m.frame()).toBeNull();
    fireEvent.click(button(MOCKUP_TEXT.reload));
    expect(m.frame()!.getAttribute('csp')).toBe(csp);
  });
});

describe('draft and omitted assets tell the truth (M5.14)', () => {
  it('counts DISTINCT draft pins inlined, gives them back on unmount', async () => {
    const html = '<img src="a.png"><img src="a.png"><img src="b.png">';
    const m = mount({ html, context: draftCtx([draftAsset('a.png'), draftAsset('b.png')]), page: DRAFT_PAGE });
    await waitFor(() => expect(screen.getByText('embeds 2 uncommitted assets')).toBeInTheDocument());
    // The badge is drawn in the commit; the effect that reports the count runs after it, so wait for the report too.
    await waitFor(() => expect(m.onDraft.mock.calls.map((c) => c[0])).toEqual([2]));
    m.unmount();
    expect(m.onDraft.mock.calls.map((c) => c[0])).toEqual([2, -2]);
  });

  it('a committed page shows no draft badge and reports no draft assets', async () => {
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]) });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(screen.queryByText(/uncommitted asset/)).toBeNull();
    m.unmount();
    expect(m.onDraft).not.toHaveBeenCalled();
  });

  it('omitted rows are counted in "{n} not loaded" and listed in the census with their sentences', async () => {
    const html = [
      '<img src="a.png">', '<img src="missing.png">', '<img src="big.png">', '<img src="/root.png">', '<img src="note.txt">',
      '<iframe src="i.html"></iframe>',
    ].join('');
    const entries = [
      entry('specs', 'a.png'), entry('specs', 'note.txt'),
      entry('specs', 'big.png', { committed: { kind: 'file', blob: '1'.repeat(40), size: DOCS_CLASS_CAP.raster + 1 } }),
    ];
    const m = mount({ html, context: ctxOf(entries) });
    await waitFor(() => expect(screen.getByText('5 not loaded')).toBeInTheDocument());
    const summary = m.container.querySelector('details.docs-mockup-census > summary')!;
    expect(summary.textContent).toBe('Assets and references · 1 loaded · 5 not loaded');
    expect(m.container.querySelector('details.docs-mockup-census li')).toBeNull();
    openFold(m.container, CENSUS);
    const rows = [...m.container.querySelectorAll('details.docs-mockup-census li.docs-mockup-row')].map((r) => r.textContent ?? '');
    const has = (needle: string): boolean => rows.some((r) => r.includes(needle));
    expect(has(DOC_IMAGE_REFUSED_SENTENCE.absent)).toBe(true);
    expect(has(MOCKUP_VERDICT_SENTENCE.skipped['too-large'])).toBe(true);
    expect(has(DOC_IMAGE_REFUSED_SENTENCE['root-relative'])).toBe(true);
    expect(has(MOCKUP_VERDICT_SENTENCE.unsupported.kind)).toBe(true);
    expect(has(MOCKUP_VERDICT_SENTENCE.unsupported.element)).toBe(true);
    expect(has(MOCKUP_VERDICT_SENTENCE.inline)).toBe(true);
  });

  it('a failed asset reads failed in the census and the frame still renders', async () => {
    const reader: MockupAssetReader = { read: async () => ({ kind: 'failed', failure: 'absent-path' }) };
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(screen.getByText('1 not loaded')).toBeInTheDocument();
    openFold(m.container, CENSUS);
    const row = m.container.querySelector('li.docs-mockup-row')!;
    expect(row.textContent).toContain(`failed: ${DOCS_FAILURE_SENTENCE['absent-path']}`);
  });

  it('the conservative-admission note shows only with a class-cap reservation AND an over-budget row', async () => {
    expect(DOCS_CLASS_CAP.raster * 3).toBeGreaterThan(MOCKUP_MAX_ASSET_BYTES);
    const html = '<img src="a.png"><img src="b.png"><img src="c.png">';
    const entries = [entry('specs', 'a.png'), entry('specs', 'b.png'), entry('specs', 'c.png')];
    // A historical page: its size is not the listing's, so each reservation is the class cap, and the third does not fit.
    const old: DocPin = { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
    const hist = mount({ html, context: ctxOf(entries, old), page: { ...PAGE, at: COMMIT_B } });
    await waitFor(() => expect(hist.frame()).not.toBeNull());
    openFold(hist.container, CENSUS);
    expect(hist.container.querySelector('.docs-mockup-conservative')?.textContent).toBe(MOCKUP_TEXT.conservative);
    cleanup();
    // The same references at listed sizes: nothing is over budget, so no note.
    const listed = mount({ html, context: ctxOf(entries) });
    await waitFor(() => expect(listed.frame()).not.toBeNull());
    openFold(listed.container, CENSUS);
    expect(listed.container.querySelector('.docs-mockup-conservative')).toBeNull();
    cleanup();
    // Class-cap reservations that all fit: no over-budget row, so no note.
    const fits = mount({ html: '<img src="a.png">', context: ctxOf(entries, old), page: { ...PAGE, at: COMMIT_B } });
    await waitFor(() => expect(fits.frame()).not.toBeNull());
    openFold(fits.container, CENSUS);
    expect(fits.container.querySelector('.docs-mockup-conservative')).toBeNull();
  });

  it('a build over the size cap says "Too large to render; use Download." with Source and Download, no frame and no census (D-8662)', async () => {
    const real = await vi.importActual<typeof import('../src/docs/mockup/load')>('../src/docs/mockup/load');
    vi.mocked(buildMockupSrcdoc).mockImplementationOnce((d, assets, extra, scripted) => {
      const built = real.buildMockupSrcdoc(d, assets, extra, scripted);
      return { ok: false, why: 'too-large', chars: 9, cap: 8, plan: built.plan };
    });
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]) });
    expect(await screen.findByText(MOCKUP_TEXT.tooLarge)).toBeInTheDocument();
    expect(m.frame()).toBeNull();
    expect(button('Source')).toBeInTheDocument();
    expect(button('Download')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Render mockup/ })).toBeNull();
    expect(m.container.querySelector('details')).toBeNull();
  });

  it('a draft page whose build is too large reports no drafted embeds: the count waits for a page that renders (review M3)', async () => {
    const real = await vi.importActual<typeof import('../src/docs/mockup/load')>('../src/docs/mockup/load');
    vi.mocked(buildMockupSrcdoc).mockImplementationOnce((d, assets, extra, scripted) => {
      const built = real.buildMockupSrcdoc(d, assets, extra, scripted);
      return { ok: false, why: 'too-large', chars: 9, cap: 8, plan: built.plan };
    });
    const m = mount({ html: '<img src="a.png">', context: draftCtx([draftAsset('a.png')]), page: DRAFT_PAGE });
    expect(await screen.findByText(MOCKUP_TEXT.tooLarge)).toBeInTheDocument();
    await flush();
    expect(m.onDraft).not.toHaveBeenCalled();
    expect(screen.queryByText(/uncommitted asset/)).toBeNull();
  });
});

describe('Load external (M5.21; base 5.6.4)', () => {
  const html = [
    '<img src="https://cdn.example/a.png">', '<img src="https://127.0.0.1/b.png">', '<img src="http://plain.example/c.png">',
    '<img src="https://localhost/d.png">', '<img src="https://cdn.example/again.png">',
    '<script>import("https://lib.example/m.js")</script>',
  ].join('');

  it('the sheet lists exactly the offered origins; the refused ones stay in the census and are never offered', async () => {
    const m = mount({ html });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    fireEvent.click(button('Load external (2)'));
    const dialog = await screen.findByRole('dialog');
    const items = [...dialog.querySelectorAll('li')].map((li) => li.textContent ?? '');
    expect(items).toEqual(['https://cdn.example', `https://lib.example ${MOCKUP_TEXT.namedInScript}`]);
    expect(within(dialog).getByText(MOCKUP_TEXT.externalNote)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/127\.0\.0\.1|localhost|plain\.example/);
    openFold(m.container, CENSUS);
    const rows = [...m.container.querySelectorAll('li.docs-mockup-row')].map((r) => r.textContent ?? '');
    expect(rows.filter((r) => r.includes(MOCKUP_VERDICT_SENTENCE.refusedOrigin))).toHaveLength(3);
    expect(rows.some((r) => r.includes(MOCKUP_TEXT.vendor))).toBe(true);
    const mark = m.container.querySelector('.docs-mockup-mark');
    expect(mark?.textContent).toBe(MOCKUP_TEXT.namedInScript);
  });

  it('Cancel changes nothing; Load rebuilds the frame (a new element, new key) with mockupCsp(origins) in the meta and the csp attribute', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const m = mount({ html });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const first = m.frame()!;
    fireEvent.click(button(/^Load external/));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(m.frame()).toBe(first);
    fireEvent.click(button(/^Load external/));
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
    const csp = mockupCsp(['https://cdn.example' as HttpsOrigin, 'https://lib.example' as HttpsOrigin]);
    await waitFor(() => expect(m.frame()!.getAttribute('csp')).toBe(csp));
    const second = m.frame()!;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    const srcdoc = second.getAttribute('srcdoc')!;
    expect(srcdoc.startsWith(metaFor(csp) + MOCKUP_CLICK_GUARD)).toBe(true);
    expect(csp).not.toContain('connect-src');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('no origin to offer: no Load external control', async () => {
    const m = mount({ html: '<img src="https://127.0.0.1/b.png">' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^Load external/ })).toBeNull();
  });
});

describe('Source (base 5.6.7)', () => {
  it('one CodeBlock on a one-block store: plain first, coloured only when the highlighter answers, never synchronously', async () => {
    const hl = inThreadHighlighter({ hold: true });
    const onDraft = vi.fn<(n: number) => void>();
    const ui = (
      <HighlighterContext value={inThreadContext(hl)}>{viewOf({ html: '<p class="x">a</p>' }, onDraft)}</HighlighterContext>
    );
    const { container } = render(ui);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    expect(container.querySelector('.code-block')).toBeNull();
    fireEvent.click(button('Source'));
    expect(container.querySelectorAll('.code-block')).toHaveLength(1);
    expect(container.querySelector('.code-block [class^="hljs-"]')).toBeNull();
    await waitFor(() => expect(hl.calls.length).toBeGreaterThan(0));
    expect(hl.calls).toHaveLength(1);
    expect(hl.calls[0]!.lang).toBe('xml');
    await act(async () => { hl.release(); await flush(); });
    await waitFor(() => expect(container.querySelector('.code-block [class^="hljs-"]')).not.toBeNull());
    fireEvent.click(button('Source'));
    expect(container.querySelector('.code-block')).toBeNull();
  });
});

describe('the census rows and the links list (M5.14; base 5.6.6, 5.6.7)', () => {
  it('a census row shows the cut, escaped reference; its target; its size; a draft chip; and a doc target links in-app', async () => {
    const long = `${'p'.repeat(130)}.png`;
    const html = `<img src="a.png"><img src="${long}"><img src="é.png">`;
    const m = mount({ html, context: draftCtx([draftAsset('a.png')]), page: DRAFT_PAGE });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    openFold(m.container, CENSUS);
    const refs = [...m.container.querySelectorAll('.docs-mockup-ref')].map((e) => e.textContent);
    expect(refs).toEqual(['a.png', 'p'.repeat(120) + '…', 'U+00E9.png']);
    const first = m.container.querySelector('li.docs-mockup-row')!;
    expect(first.querySelector('.docs-mockup-target')?.textContent).toBe('specs/a.png');
    expect(first.querySelector('.docs-mockup-size')?.textContent).toBe('1 KiB');
    expect(first.querySelector('.doc-img-chip')?.textContent).toBe('draft');
    const link = first.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/docs/demo/specs/a.png?ref=main');
    fireEvent.click(link);
    expect(location.pathname + location.search).toBe('/docs/demo/specs/a.png?ref=main');
  });

  it('a class-cap reservation reads "up to {size}"', async () => {
    const old: DocPin = { kind: 'committed', commit: COMMIT_B, servedRef: 'refs/remotes/origin/main', section: 'specs', path: 'm.html' };
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')], old), page: { ...PAGE, at: COMMIT_B } });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    openFold(m.container, CENSUS);
    expect(m.container.querySelector('.docs-mockup-size')?.textContent).toBe('up to 2048 KiB');
  });

  it('the links list routes a doc link in-app, an external one through openExternal, and the rest as text', async () => {
    const html = '<a href="other.md">o</a><a href="https://ext.example/p">e</a><a href="#top">f</a><a href="mailto:x@ext.example">m</a><area href="area.md">';
    const m = mount({ html });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const list = m.container.querySelector('details.docs-mockup-links')!;
    expect(list.querySelector('summary')?.textContent).toBe('Links · 5');
    expect(list.querySelector('li')).toBeNull();
    openFold(m.container, LINKS);
    const doc = list.querySelector('a[href="/docs/demo/specs/other.md"]')!;
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const ext = list.querySelector('a[href="https://ext.example/p"]') as HTMLAnchorElement;
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');
    fireEvent.click(ext);
    expect(open).toHaveBeenCalledWith('https://ext.example/p', '_blank', 'noopener,noreferrer');
    fireEvent.click(doc);
    expect(location.pathname).toBe('/docs/demo/specs/other.md');
    expect(list.querySelector('a[href="/docs/demo/specs/area.md"]')).not.toBeNull();
    const rows = [...list.querySelectorAll('li')];
    const text = (needle: string): Element => rows.find((r) => r.textContent === needle)!;
    expect(text('#top').querySelector('a')).toBeNull();
    expect(text('mailto:x@ext.example').querySelector('a')).toBeNull();
  });
});

describe('Full screen, New tab and Close (base 5.6.7)', () => {
  it('Full screen navigates to the frame=full URL', async () => {
    const m = mount({ html: '<p>a</p>' });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    fireEvent.click(button(MOCKUP_TEXT.fullScreen));
    expect(location.pathname + location.search).toBe('/docs/demo/specs/m.html?frame=full');
  });

  it('New tab calls window.open with that URL, _blank and noopener,noreferrer', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const m = mount({ html: '<p>a</p>', page: { ...PAGE, ref: { kind: 'bare', name: 'main' } } });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    fireEvent.click(button(MOCKUP_TEXT.newTab));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/docs/demo/specs/m.html?ref=main&frame=full', '_blank', 'noopener,noreferrer');
    expect(location.search).toBe('');
  });

  it('in frame=full, Close goes back when the previous entry is this leaf (the view recorded it), else navigates to the leaf', async () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    // From the leaf: the tap records where it came from, the full-frame view stands on the new entry.
    const inline = mount({ html: '<p>a</p>' });
    await waitFor(() => expect(inline.frame()).not.toBeNull());
    fireEvent.click(button(MOCKUP_TEXT.fullScreen));
    inline.unmount();
    const full = mount({ html: '<p>a</p>', page: { ...PAGE, frame: 'full' } });
    await waitFor(() => expect(full.frame()).not.toBeNull());
    expect(full.container.querySelector('.docs-mockup-bar')).not.toBeNull();
    for (const gone of [/Run scripts/, /Full screen/, /New tab/]) expect(screen.queryByRole('button', { name: gone })).toBeNull();
    fireEvent.click(button(MOCKUP_TEXT.close));
    expect(back).toHaveBeenCalledTimes(1);
    expect(location.search).toBe('?frame=full');
    full.unmount();
    // A direct load of the full-frame URL: no recorded leaf, so Close navigates to it.
    history.replaceState(null, '', '/docs/demo/specs/m.html?frame=full');
    const direct = mount({ html: '<p>a</p>', page: { ...PAGE, frame: 'full' } });
    await waitFor(() => expect(direct.frame()).not.toBeNull());
    fireEvent.click(button(MOCKUP_TEXT.close));
    expect(back).toHaveBeenCalledTimes(1);
    expect(location.pathname + location.search).toBe('/docs/demo/specs/m.html');
  });
});

describe('the attempt lifecycle (base 5.6.2 step 5; the generation and abort boundary)', () => {
  it('unmount aborts the attempt in flight', async () => {
    const gate = deferred();
    const reads = fakeReader(new Map([['a.png', gate]]));
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.calls).toHaveLength(1));
    const signal = vi.mocked(loadMockupAssets).mock.calls[0]![2];
    expect(signal.aborted).toBe(false);
    m.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('a new context aborts the old attempt and starts a fresh plan from the new context only', async () => {
    const gate = deferred();
    const reads = fakeReader(new Map([['a.png', gate]]));
    const m = mount({ html: '<img src="a.png"><img src="b.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.paths()).toEqual(['a.png']));
    const firstSignal = vi.mocked(loadMockupAssets).mock.calls[0]![2];
    m.again({ html: '<img src="a.png"><img src="b.png">', context: ctxOf([entry('specs', 'b.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.paths()).toEqual(['a.png', 'b.png']));
    expect(firstSignal.aborted).toBe(true);
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const html = m.frame()!.getAttribute('srcdoc')!;
    expect(html).toContain('data:image/png;base64,AQID');
    gate.resolve({ kind: 'ok', bytes: bytesOf(9, 9, 9) });
    await flush();
    expect(m.frame()!.getAttribute('srcdoc')).toBe(html);
  });

  it('a late result of an old attempt never publishes into a later one (the generation check, with a loader that ignores abort)', async () => {
    const real = await vi.importActual<typeof import('../src/docs/mockup/load')>('../src/docs/mockup/load');
    const heldReader = fakeReader();
    const ctxP = ctxOf([entry('specs', 'a.png')]);
    const html = '<img src="a.png">';
    const outP = new Deferred2();
    const mocked = vi.mocked(loadMockupAssets);
    mocked.mockImplementationOnce((plan, rd, signal) => {
      void signal;
      return outP.promise.then(() => real.loadMockupAssets(plan, rd, new AbortController().signal));
    });
    const m = mount({ html, context: ctxP, reader: heldReader.reader });
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    // The next attempt: a context where a.png is not listed, so its build holds no asset.
    m.again({ html, context: ctxOf([]), reader: heldReader.reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const before = m.frame()!.getAttribute('srcdoc')!;
    expect(before).not.toContain('data:image/png');
    outP.resolve();
    await flush();
    expect(m.frame()!.getAttribute('srcdoc')).toBe(before);
    expect(before.includes('data:image/png')).toBe(false);
  });

  it('a context that does not open the page (a mid-update leaf) starts nothing and keeps what is shown', async () => {
    const reads = fakeReader();
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const shown = m.frame()!.getAttribute('srcdoc');
    const stale: MockupContext = { ...ctxOf([]), tree: treeOk({ entries: [], drafts: holder() }) };
    m.again({ html: '<img src="a.png">', context: stale, reader: reads.reader });
    await flush();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(1);
    expect(m.frame()!.getAttribute('srcdoc')).toBe(shown);
  });

  it('assets go through the reader it is given and docsApi pins identify them', async () => {
    const reads = fakeReader();
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(reads.calls.map((p) => docsApi.file('demo', p))).toEqual([docsApi.file('demo', reads.calls[0]!)]);
    expect(reads.calls[0]).toMatchObject({ kind: 'committed', commit: COMMIT_A, section: 'specs', path: 'a.png' });
  });
});

describe('re-list, retry and sign-in (D-8660: the view owns them, the loader never relists)', () => {
  const COMMIT_C = 'c'.repeat(40);
  const SERVED_REF = 'refs/remotes/origin/main';
  const HTML = '<link rel="stylesheet" href="s.css"><img src="moved.png"><img src="x.png"><img src="y.png"><img src="z.png">';
  const P_CSS = enc.encode('body{background:url(child.png)}');
  const Q_CSS = enc.encode('body{color:red}');

  /** The listing P read: every asset small, and a child only this listing names (`child.png`). */
  const ctxP = (): MockupContext => ctxOf([
    entry('specs', 's.css'), entry('specs', 'moved.png'), entry('specs', 'x.png'), entry('specs', 'y.png'), entry('specs', 'z.png'),
    entry('specs', 'child.png'),
  ]);
  /** The listing Q reads: a new commit, the moved asset at a new blob, no child, and three 2 MiB images, of which the
   *  third does not fit the 5 MiB budget (P admitted it at 100 bytes). */
  const ctxQ = (commit = COMMIT_B): MockupContext => {
    const big = { kind: 'file' as const, blob: BLOB_2, size: DOCS_CLASS_CAP.raster };
    const pin: DocPin = { kind: 'committed', commit, servedRef: SERVED_REF, section: 'specs', path: 'm.html' };
    return ctxOf([], pin, treeOk({
      commit,
      entries: [
        entry('specs', 'm.html'), entry('specs', 's.css'), entry('specs', 'moved.png', { committed: { kind: 'file', blob: BLOB_2, size: 100 } }),
        entry('specs', 'x.png', { committed: big }), entry('specs', 'y.png', { committed: big }), entry('specs', 'z.png', { committed: big }),
      ],
      drafts: holder(commit),
    }));
  };

  type Script = (pin: DocPin, nth: number) => MockupReadAnswer | Deferred;
  /** A reader whose answer is a function of the pin and how often its path has been read; a `Deferred` is held. */
  function scripted(script: Script) {
    const calls: DocPin[] = [];
    const counts = new Map<string, number>();
    const reader: MockupAssetReader = {
      read: async (pin) => {
        calls.push(pin);
        const nth = (counts.get(pin.path) ?? 0) + 1;
        counts.set(pin.path, nth);
        const a = script(pin, nth);
        return 'promise' in a ? a.promise : a;
      },
    };
    return { reader, calls, paths: () => calls.map((c) => c.path) };
  }
  const OK = (b: Uint8Array<ArrayBuffer> = bytesOf(1, 2, 3)): MockupReadAnswer => ({ kind: 'ok', bytes: b });
  const MOVED: MockupReadAnswer = { kind: 'failed', failure: 'draft-changed' };
  const cssBytes = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
  const rowOf = (c: HTMLElement, ref: string): string | undefined =>
    [...c.querySelectorAll('li.docs-mockup-row')].find((r) => r.querySelector('.docs-mockup-ref')?.textContent === ref)?.textContent ?? undefined;
  const allRows = (c: HTMLElement): string[] => [...c.querySelectorAll('li.docs-mockup-row .docs-mockup-ref')].map((r) => r.textContent ?? '');

  /** P's stylesheet is held; the first read of the moved asset answers that the draft changed (the movement). */
  function heldPScript(heldCss: Deferred): Script {
    return (pin, nth) => {
      if (pin.path === 's.css') return nth === 1 ? heldCss : OK(cssBytes(Q_CSS));
      if (pin.path === 'moved.png') return nth === 1 ? MOVED : OK();
      return OK();
    };
  }

  it('the first movement aborts attempt P at once, calls relist once, and starts nothing; Q starts from Q alone, and a held P stylesheet resolved after Q starts reaches nobody', async () => {
    const heldCss = deferred();
    const reads = scripted(heldPScript(heldCss));
    const relist = vi.fn<() => void>();
    const m = mount({ html: HTML, context: ctxP(), reader: reads.reader, relist });
    await waitFor(() => expect(relist).toHaveBeenCalledTimes(1));
    const pSignal = vi.mocked(loadMockupAssets).mock.calls[0]![2];
    expect(pSignal.aborted).toBe(true);
    expect(reads.paths()).toEqual(['s.css', 'moved.png']);
    expect(m.frame()).toBeNull();
    await flush();
    expect(relist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(1);
    expect(reads.paths()).toEqual(['s.css', 'moved.png']);
    // The next context starts Q, a fresh plan from Q's listing, pin and budget.
    const q = ctxQ();
    m.again({ html: HTML, context: q, reader: reads.reader, relist });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2);
    const qCalls = reads.calls.slice(2);
    expect(qCalls.map((c) => c.path)).toEqual(['s.css', 'moved.png', 'x.png', 'y.png']);
    for (const c of qCalls) expect(c).toMatchObject({ kind: 'committed', commit: COMMIT_B });
    expect(vi.mocked(loadMockupAssets).mock.calls[1]![0].context).toBe(q);
    const shown = m.frame()!.getAttribute('srcdoc')!;
    // The held P stylesheet comes back after Q started: its child is uniquely eligible in P's listing only.
    await act(async () => { heldCss.resolve(OK(cssBytes(P_CSS))); await flush(); });
    await flush();
    expect(reads.paths()).not.toContain('child.png');
    expect(reads.calls.slice(2)).toHaveLength(4);
    expect(m.frame()!.getAttribute('srcdoc')).toBe(shown);
    expect(shown).not.toContain('child.png');
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2);
    expect(relist).toHaveBeenCalledTimes(1);
    // Q's rows and reservations are Q's own: its boundary kept z.png out (P admitted it), and its reservations are Q's sizes.
    openFold(m.container, CENSUS);
    expect(allRows(m.container)).toEqual(['s.css', 'moved.png', 'x.png', 'y.png', 'z.png']);
    expect(rowOf(m.container, 'z.png')).toContain(MOCKUP_VERDICT_SENTENCE.skipped['over-budget']);
    expect(rowOf(m.container, 'x.png')).toContain('2048 KiB');
    expect(rowOf(m.container, 'y.png')).toContain('2048 KiB');
    expect(rowOf(m.container, 'moved.png')).toContain(MOCKUP_VERDICT_SENTENCE.inline);
    expect(m.container.textContent).not.toContain('child.png');
    expect(screen.queryByText(MOCKUP_TEXT.changing)).toBeNull();
  });

  it('the movement aborts P BEFORE the next context arrives: a stylesheet P held is read by nobody, its child is never read, and the view has not published', async () => {
    const heldCss = deferred();
    const reads = scripted(heldPScript(heldCss));
    const relist = vi.fn<() => void>();
    const m = mount({ html: HTML, context: ctxP(), reader: reads.reader, relist });
    await waitFor(() => expect(relist).toHaveBeenCalledTimes(1));
    await act(async () => { heldCss.resolve(OK(cssBytes(P_CSS))); await flush(); });
    await flush();
    expect(reads.paths()).toEqual(['s.css', 'moved.png']);
    expect(m.frame()).toBeNull();
    expect(screen.getByText(DOCS_VIEW_TEXT.loading)).toBeInTheDocument();
    expect(m.onDraft).not.toHaveBeenCalled();
  });

  it('a movement report of an attempt that is no longer current is ignored (the generation check on the report)', async () => {
    const heldMove = deferred();
    const reads = scripted((pin, nth) => (pin.path === 'moved.png' && nth === 1 ? heldMove : OK()));
    const relist = vi.fn<() => void>();
    const html = '<img src="moved.png">';
    const entries = [entry('specs', 'moved.png')];
    const m = mount({ html, context: ctxOf(entries), reader: reads.reader, relist });
    await waitFor(() => expect(reads.paths()).toEqual(['moved.png']));
    // A new context supersedes the attempt (the held read is still out); then its answer arrives: a stale report.
    m.again({ html, context: ctxQ(), reader: reads.reader, relist });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    await act(async () => { heldMove.resolve(MOVED); await flush(); });
    await flush();
    expect(relist).not.toHaveBeenCalled();
    expect(screen.queryByText(MOCKUP_TEXT.changing)).toBeNull();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2);
  });

  it('a second movement in this view (attempt Q): no second relist and no third attempt, the changing note and Retry; Retry relists and reads again, uncapped', async () => {
    const reads = scripted((pin) => (pin.path === 'moved.png' && pin.kind === 'committed' && pin.commit !== COMMIT_C ? MOVED : OK()));
    const relist = vi.fn<() => void>();
    const html = '<img src="moved.png"><img src="x.png">';
    const entries = [entry('specs', 'moved.png'), entry('specs', 'x.png')];
    const m = mount({ html, context: ctxOf(entries), reader: reads.reader, relist });
    await waitFor(() => expect(relist).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(MOCKUP_TEXT.changing)).toBeNull();
    m.again({ html, context: ctxQ(), reader: reads.reader, relist });
    await waitFor(() => expect(screen.getByText(MOCKUP_TEXT.changing)).toBeInTheDocument());
    // The attempt finished: its page shows, the moved row reads failed, and nothing re-listed or started again.
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(relist).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2);
    const readsAfterQ = reads.calls.length;
    await flush();
    expect(reads.calls).toHaveLength(readsAfterQ);
    expect(reads.paths()).toEqual(['moved.png', 'x.png', 'moved.png', 'x.png']);
    openFold(m.container, CENSUS);
    expect(rowOf(m.container, 'moved.png')).toContain(`failed: ${DOCS_FAILURE_SENTENCE['draft-changed']}`);
    expect(button(MOCKUP_TEXT.retry)).toBeInTheDocument();
    // Retry: the user's re-list, and a new attempt over the current context right away.
    fireEvent.click(button(MOCKUP_TEXT.retry));
    expect(relist).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(reads.paths().filter((x) => x === 'moved.png')).toHaveLength(3));
    // Its own movement does not re-list by itself (the automatic one is spent): the note stays, and Retry is uncapped.
    await waitFor(() => expect(screen.getByText(MOCKUP_TEXT.changing)).toBeInTheDocument());
    await flush();
    expect(relist).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(3);
    fireEvent.click(button(MOCKUP_TEXT.retry));
    expect(relist).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(4));
    // The new context the re-list produces starts another attempt (and aborts that one); the note goes with the old attempt.
    const signal4 = vi.mocked(loadMockupAssets).mock.calls[3]![2];
    m.again({ html, context: ctxQ(COMMIT_C), reader: reads.reader, relist });
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(5));
    expect(signal4.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByText(MOCKUP_TEXT.changing)).toBeNull());
    expect(screen.queryByRole('button', { name: MOCKUP_TEXT.retry })).toBeNull();
    expect(relist).toHaveBeenCalledTimes(3);
  });

  it('a historical page (page.at set): a movement word is just that row failed; zero relists, no changing note', async () => {
    const reads = scripted(() => ({ kind: 'failed', failure: 'unknown-commit' }));
    const relist = vi.fn<() => void>();
    const old: DocPin = { kind: 'committed', commit: COMMIT_B, servedRef: SERVED_REF, section: 'specs', path: 'm.html' };
    const m = mount({
      html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')], old), page: { ...PAGE, at: COMMIT_B }, reader: reads.reader, relist,
    });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    await flush();
    expect(relist).not.toHaveBeenCalled();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(1);
    expect(reads.paths()).toEqual(['a.png']);
    expect(screen.queryByText(MOCKUP_TEXT.changing)).toBeNull();
    expect(screen.queryByRole('button', { name: MOCKUP_TEXT.retry })).toBeNull();
    openFold(m.container, CENSUS);
    expect(rowOf(m.container, 'a.png')).toContain(`failed: ${DOCS_FAILURE_SENTENCE['unknown-commit']}`);
  });

  it('sign-in: a row failed with auth reads again in ONE new attempt when sign-in returns; a later auth row subscribes again', async () => {
    let authAnswers = 2;
    const reads = scripted(() => {
      if (authAnswers > 0) { authAnswers -= 1; return { kind: 'failed', failure: 'auth' }; }
      return OK();
    });
    const entries = [entry('specs', 'a.png')];
    const m = mount({ html: '<img src="a.png">', context: ctxOf(entries), reader: reads.reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    openFold(m.container, CENSUS);
    expect(rowOf(m.container, 'a.png')).toContain(`failed: ${DOCS_SLOT_SENTENCE.auth}`);
    await flush();
    expect(reads.paths()).toEqual(['a.png']);
    act(() => raiseAuthLost('expired'));
    await flush();
    expect(reads.paths()).toEqual(['a.png']);
    act(() => clearAuthLost());
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(reads.paths()).toEqual(['a.png', 'a.png']));
    // The second attempt answered auth again: its result subscribes again, and one more sign-in is one more attempt.
    await flush();
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await waitFor(() => expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(m.container.querySelector('details.docs-mockup-census > summary')?.textContent).toBe('Assets and references · 1 loaded · 0 not loaded'));
    // The result has no auth row now: a further sign-in starts nothing.
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await flush();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(3);
  });

  it('sign-in starts nothing for a result with no auth row, and nothing after unmount', async () => {
    const reads = scripted(() => ({ kind: 'failed', failure: 'absent-path' }));
    const m = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    await flush();
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await flush();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(1);
    expect(reads.paths()).toEqual(['a.png']);
    m.unmount();
    cleanup();
    const authReads = scripted(() => ({ kind: 'failed', failure: 'auth' }));
    const n = mount({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: authReads.reader });
    await waitFor(() => expect(n.frame()).not.toBeNull());
    await flush();
    const before = vi.mocked(loadMockupAssets).mock.calls.length;
    n.unmount();
    act(() => raiseAuthLost('expired'));
    act(() => clearAuthLost());
    await flush();
    expect(vi.mocked(loadMockupAssets)).toHaveBeenCalledTimes(before);
    expect(authReads.paths()).toEqual(['a.png']);
  });

  it('the observing reader passes every answer through unchanged (the port stays read-only, the rows keep the words)', async () => {
    const bytes = bytesOf(7, 8, 9);
    const reads = scripted((pin) => (pin.path === 'a.png' ? OK(bytes) : { kind: 'failed', failure: 'absent-path' }));
    const m = mount({
      html: '<img src="a.png"><img src="b.png">', context: ctxOf([entry('specs', 'a.png'), entry('specs', 'b.png')]), reader: reads.reader,
    });
    await waitFor(() => expect(m.frame()).not.toBeNull());
    expect(m.frame()!.getAttribute('srcdoc')).toContain('data:image/png;base64,BwgJ');
    openFold(m.container, CENSUS);
    expect(rowOf(m.container, 'b.png')).toContain(`failed: ${DOCS_FAILURE_SENTENCE['absent-path']}`);
  });
});

/** A promise a test resolves by hand. */
class Deferred2 {
  readonly promise: Promise<void>;
  resolve!: () => void;
  constructor() {
    this.promise = new Promise<void>((r) => { this.resolve = r; });
  }
}

describe('what the view publishes for Export (completion plan Task 9; M5.EX6)', () => {
  /** A mount under an Export body holder that records every publish, `null` withdrawals included. */
  function publishing(s: Setup) {
    const bodies: Array<ExportBody | null> = [];
    const publish = (b: ExportBody | null): void => { bodies.push(b); };
    const onDraft = vi.fn<(n: number) => void>();
    const wrap = (n: Setup): ReactNode => <ExportBodyContext value={publish}>{viewOf(n, onDraft)}</ExportBodyContext>;
    const r = render(wrap(s));
    return {
      ...r, bodies, again: (n: Setup) => r.rerender(wrap(n)),
      /** What stands now: the last publish, `null` once withdrawn or when nothing was published. */
      current: (): ExportBody | null => bodies.at(-1) ?? null,
      frame: (): HTMLIFrameElement | null => r.container.querySelector('iframe'),
    };
  }
  const mockupOf = (b: ExportBody | null): Extract<ExportBody, { kind: 'mockup' }> => {
    if (b === null || b.kind !== 'mockup') throw new Error(`not a mockup body: ${b === null ? 'null' : b.kind}`);
    return b;
  };
  /** Whether `p` has settled yet, without waiting on it. */
  const isSettled = async (p: Promise<MockupLoadEnd>): Promise<boolean> => {
    const pending = Symbol('pending');
    return (await Promise.race([p, flush().then(() => pending)])) !== pending;
  };

  it('the render gate publishes GATE_BODY; the tap withdraws it and the attempt publishes a mockup body', async () => {
    const m = publishing({ html: '<p>a</p>', size: 1_048_577 });
    expect(m.current()).toBe(GATE_BODY);
    fireEvent.click(button(/^Render mockup · /));
    await waitFor(() => expect(m.current()?.kind).toBe('mockup'));
    expect(m.bodies.slice(0, 3).map((b) => (b === null ? null : b.kind))).toEqual(['gate', null, 'mockup']);
  });

  it('a page the pre-scan refuses publishes its source as a plain body with the refused-export note, over the gate or under it', async () => {
    const html = '<div>'.repeat(MOCKUP_MAX_DEPTH + 1);
    const under = publishing({ html });
    expect(under.current()).toEqual({ kind: 'plain', text: html, note: EXPORT_TEXT.mockupRefused });
    expect(under.frame()).toBeNull();
    under.unmount();
    const over = publishing({ html, size: 1_048_577 });
    expect(over.current()).toEqual({ kind: 'plain', text: html, note: EXPORT_TEXT.mockupRefused });
    expect(over.bodies.some((b) => b !== null && b.kind === 'gate')).toBe(false);
  });

  it('an attempt publishes a mockup body from the moment it has a plan; its settled resolves loaded with the attempt\'s result', async () => {
    const gate = deferred();
    const reads = fakeReader(new Map([['a.png', gate]]));
    const html = '<img src="a.png">';
    const m = publishing({ html, context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.calls).toHaveLength(1));
    const body = mockupOf(m.current());
    expect(m.frame()).toBeNull();
    expect(body.text).toBe(html);
    expect(body.doc.querySelector('img')?.getAttribute('src')).toBe('a.png');
    expect(body.assets.plan.rows.map((r) => r.verdict.v)).toEqual(['inline']);
    expect(await isSettled(body.assets.settled)).toBe(false);
    gate.resolve({ kind: 'ok', bytes: bytesOf(1, 2, 3) });
    const end = await body.assets.settled;
    if (end.s !== 'loaded') throw new Error('not loaded');
    expect(end.result).toBe(await vi.mocked(loadMockupAssets).mock.results[0]!.value);
    expect([...end.result.assets.values()].map((a) => [...a.bytes])).toEqual([[1, 2, 3]]);
    await waitFor(() => expect(m.frame()).not.toBeNull());
  });

  it('a new attempt publishes its own body, and the superseded attempt\'s settled ends', async () => {
    const gate = deferred();
    const reads = fakeReader(new Map([['a.png', gate]]));
    const html = '<img src="a.png"><img src="b.png">';
    const m = publishing({ html, context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.calls).toHaveLength(1));
    const first = mockupOf(m.current());
    m.again({ html, context: ctxOf([entry('specs', 'b.png')]), reader: reads.reader });
    await waitFor(() => expect(mockupOf(m.current())).not.toBe(first));
    const second = mockupOf(m.current());
    expect(second.assets).not.toBe(first.assets);
    expect(second.assets.plan.context.tree).not.toBe(first.assets.plan.context.tree);
    expect(await first.assets.settled).toEqual({ s: 'ended' });
    gate.resolve({ kind: 'ok', bytes: bytesOf(9) });
    expect((await second.assets.settled).s).toBe('loaded');
    // The first attempt's end stays ended; a late answer never rewrites it.
    expect(await first.assets.settled).toEqual({ s: 'ended' });
  });

  it('the body changes only with the attempt: a toggle or a re-render of the same props publishes nothing new', async () => {
    const reads = fakeReader();
    // One context and one reader for every render, as the screen's memoised ones are.
    const setup: Setup = { html: '<p>a</p>', reader: reads.reader, context: ctxOf([]) };
    const m = publishing(setup);
    await waitFor(() => expect(m.frame()).not.toBeNull());
    const count = m.bodies.length;
    const body = m.current();
    fireEvent.click(button('Source'));
    m.again(setup);
    await flush();
    expect(m.bodies.length).toBe(count);
    expect(m.current()).toBe(body);
  });

  it('unmounting withdraws the body and ends the attempt\'s settled', async () => {
    const gate = deferred();
    const reads = fakeReader(new Map([['a.png', gate]]));
    const m = publishing({ html: '<img src="a.png">', context: ctxOf([entry('specs', 'a.png')]), reader: reads.reader });
    await waitFor(() => expect(reads.calls).toHaveLength(1));
    const body = mockupOf(m.current());
    m.unmount();
    expect(m.current()).toBeNull();
    // The cleanup ends it synchronously; the bound only turns a missing end into an assertion, never a hung test.
    const pending = new Promise<'pending'>((r) => { setTimeout(() => r('pending'), 2000); });
    expect(await Promise.race([body.assets.settled, pending])).toEqual({ s: 'ended' });
  });

  it('a context that does not open the page (a mid-update leaf) publishes no body', async () => {
    const stale: MockupContext = { ...ctxOf([]), tree: treeOk({ entries: [], drafts: holder() }) };
    const m = publishing({ html: '<p>a</p>', context: stale });
    await flush();
    expect(m.bodies.filter((b) => b !== null)).toEqual([]);
  });

  it('an attempt the view aborts for a re-list ends its settled, and the re-listed context publishes a body of its own', async () => {
    const relist = vi.fn<() => void>();
    const moved: MockupAssetReader = { read: async () => ({ kind: 'failed', failure: 'unknown-commit' }) };
    const html = '<img src="a.png">';
    const m = publishing({ html, context: ctxOf([entry('specs', 'a.png')]), reader: moved, relist });
    await waitFor(() => expect(relist).toHaveBeenCalledTimes(1));
    const first = m.bodies.find((b) => b !== null && b.kind === 'mockup') ?? null;
    expect(await mockupOf(first).assets.settled).toEqual({ s: 'ended' });
    m.again({ html, context: ctxOf([entry('specs', 'a.png')]), reader: fakeReader().reader, relist });
    await waitFor(() => expect(mockupOf(m.current())).not.toBe(first));
    expect((await mockupOf(m.current()).assets.settled).s).toBe('loaded');
  });
});
