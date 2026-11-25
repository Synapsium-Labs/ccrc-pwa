// The draft review page (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5; M-X3.10).
// `src/review/main.ts` is a fixed page with no React: it reads the capability token out of the URL fragment, clears
// the fragment at once, shows one button, and only the tap posts the token to the one read door. Each row below is
// one behaviour of that page, driven in jsdom with a fetch spy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_SHARED_AT_HEADER, reviewDate } from '../../shared/docsReview';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_GROUND, LAB_IMAGE_COLOUR, LAB_KEYS, LAB_SWATCH_COLOUR, labEngineOf, labOsClassOf, labResultText, startReviewPage,
  type LabAnswers,
} from '../src/review/main';
import { LAB_MARKDOWN_COPY, LAB_MOCKUP_COPY } from '../src/review/labFixture';

const TOKEN = 'Tk3_-Tk3_-Tk3_-Tk3_-Tk3_-Tk3_-Tk3_-Tk3_-Tk3_-'.slice(0, 43);
const SHARED_AT = Date.UTC(2026, 10, 26, 12, 0, 0);
const FAILURE = 'This link has expired, was revoked, or never existed.';
const NO_TOKEN = 'To open this draft again, use the link you were sent.';

// Every link shape the page must sort: one https URL twice, a second https URL in an area, a third, and the four
// shapes it must never list.
const COPY = [
  '<!doctype html><html><head><title>Copy</title></head><body>',
  '<a href="https://a.example/one?x=1">one</a>',
  '<a href="javascript:alert(1)">js</a>',
  '<a href="data:text/html,hi">data</a>',
  '<a href="http://plain.example/">http</a>',
  '<a href="/relative/path">relative</a>',
  '<map name="m"><area href="https://b.example/area" alt="area"></map>',
  '<a href="https://a.example/one?x=1">one again</a>',
  '<a href="https://c.example/">three</a>',
  '<a>no href</a>',
  '</body></html>',
].join('\n');

function mount(hash: string): HTMLElement {
  document.body.innerHTML = '<div id="review-root"></div>';
  window.history.replaceState(null, '', `/review${hash}`);
  return document.getElementById('review-root') as HTMLElement;
}

function answer(status: number, body = COPY, sharedAt: string | null = String(SHARED_AT)): Response {
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
  if (sharedAt !== null) headers[REVIEW_SHARED_AT_HEADER] = sharedAt;
  return new Response(status === 200 ? body : 'not found', { status, headers });
}

const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
const button = (): HTMLButtonElement | null => document.querySelector('button');

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(async () => answer(200));
  vi.stubGlobal('fetch', fetchSpy);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function open(): Promise<HTMLElement> {
  const root = mount(`#${TOKEN}`);
  startReviewPage(window);
  button()!.click();
  await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
  return root;
}

describe('the review page (M-X3.10)', () => {
  it('clears the fragment at once and makes no request on load', () => {
    mount(`#${TOKEN}`);
    startReviewPage(window);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/review');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('shows one control, a button named "Open draft", and makes no request before its click', async () => {
    const root = mount(`#${TOKEN}`);
    startReviewPage(window);
    await settle();
    const controls = root.querySelectorAll('button, a, input, select, textarea, [tabindex], [role="button"]');
    expect(controls).toHaveLength(1);
    expect(button()?.textContent).toBe('Open draft');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts once on the click: the token in the JSON body, the marker header, no credentials', async () => {
    await open();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/review/open');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(init.headers).toEqual({ 'content-type': 'application/json', [REVIEW_MARKER_HEADER]: REVIEW_MARKER_VALUE });
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('clears the fragment even when the page has no root element (R2.1 review, M3)', () => {
    document.body.innerHTML = '';
    window.history.replaceState(null, '', `/review#${TOKEN}`);
    startReviewPage(window);
    expect(window.location.hash).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the token is nowhere in the document and in no console line, before or after the open (R2.1 review, M4)', async () => {
    const lines: unknown[] = [];
    const record = (...args: unknown[]): void => { lines.push(...args); };
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(record));
    try {
      mount(`#${TOKEN}`);
      startReviewPage(window);
      expect(document.documentElement.outerHTML).not.toContain(TOKEN);
      button()!.click();
      await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
      expect(document.documentElement.outerHTML).not.toContain(TOKEN);
      expect(lines.map(String).join('\n')).not.toContain(TOKEN);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it('sets the empty sandbox before the bytes, and both before the frame is attached (R2.1 review, M4)', async () => {
    const steps: string[] = [];
    const setAttribute = vi.spyOn(HTMLIFrameElement.prototype, 'setAttribute');
    setAttribute.mockImplementation(function (this: HTMLIFrameElement, name: string, value: string) {
      if (name === 'sandbox') steps.push(`sandbox:${this.isConnected}`);
      Element.prototype.setAttribute.call(this, name, value);
    });
    const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true, get: srcdoc.get,
      set(this: HTMLIFrameElement, v: string) { steps.push(`srcdoc:${this.isConnected}`); srcdoc.set!.call(this, v); },
    });
    try {
      await open();
      expect(steps).toEqual(['sandbox:false', 'srcdoc:false']);
    } finally {
      setAttribute.mockRestore();
      Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', srcdoc);
    }
  });

  it('sends once for two taps in a row', async () => {
    mount(`#${TOKEN}`);
    startReviewPage(window);
    const b = button()!;
    b.click();
    b.click();
    await vi.waitFor(() => expect(document.querySelector('iframe')).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('on a 200 the frame is sandboxed to the empty string and holds the response text as its srcdoc', async () => {
    await open();
    const frame = document.querySelector('iframe') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.srcdoc).toBe(COPY);
    expect(frame.getAttribute('title')).toBe('Draft copy');
    expect(button()).toBeNull();
  });

  it('draws the banner, then the links, then the frame, and the banner reads exactly', async () => {
    const root = await open();
    expect([...root.children].map((e) => e.className)).toEqual(['review-banner', 'review-links', 'review-frame']);
    expect(root.querySelector('.review-banner')?.textContent)
      .toBe(`Draft, not committed. Shared for review on ${reviewDate(SHARED_AT)}. Read-only.`);
  });

  it('lists each https link of the bytes once, in document order, as a top-level anchor, and no other kind', async () => {
    const root = await open();
    expect(root.querySelector('.review-links h2')?.textContent).toBe('Links in this copy');
    const anchors = [...root.querySelectorAll('.review-links a')] as HTMLAnchorElement[];
    expect(anchors.map((a) => a.textContent)).toEqual(['https://a.example/one?x=1', 'https://b.example/area', 'https://c.example/']);
    for (const a of anchors) {
      expect(a.getAttribute('href')).toBe(a.textContent);
      expect(a.getAttribute('rel')).toBe('noreferrer noopener');
      expect(a.getAttribute('target')).toBe('_blank');
    }
    const listed = root.querySelector('.review-links')?.innerHTML ?? '';
    for (const never of ['javascript:', 'data:', 'http://plain', '/relative']) expect(listed).not.toContain(never);
  });

  it('shows no "Links in this copy" section when the copy holds no https link', async () => {
    fetchSpy.mockImplementation(async () => answer(200, '<!doctype html><p>no links <a href="/x">here</a></p>'));
    const root = await open();
    expect(root.querySelector('.review-links')).toBeNull();
    expect([...root.children].map((e) => e.className)).toEqual(['review-banner', 'review-frame']);
  });

  it('a 404 shows the one failure sentence and no frame', async () => {
    fetchSpy.mockImplementation(async () => answer(404));
    const root = mount(`#${TOKEN}`);
    startReviewPage(window);
    button()!.click();
    await vi.waitFor(() => expect(root.textContent).toBe(FAILURE));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a rejected fetch shows the one failure sentence and no frame', async () => {
    fetchSpy.mockImplementation(async () => { throw new TypeError('network'); });
    const root = mount(`#${TOKEN}`);
    startReviewPage(window);
    button()!.click();
    await vi.waitFor(() => expect(root.textContent).toBe(FAILURE));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a 200 without a readable shared-at header is a failure', async () => {
    for (const header of [null, 'soon', '']) {
      fetchSpy.mockImplementation(async () => answer(200, COPY, header));
      const root = mount(`#${TOKEN}`);
      startReviewPage(window);
      button()!.click();
      await vi.waitFor(() => expect(root.textContent).toBe(FAILURE));
      expect(document.querySelector('iframe')).toBeNull();
    }
  });

  it('a 200 whose bytes are not UTF-8 is a failure', async () => {
    fetchSpy.mockImplementation(async () => new Response(new Uint8Array([0xff, 0xfe, 0x41]), {
      status: 200, headers: { [REVIEW_SHARED_AT_HEADER]: String(SHARED_AT) },
    }));
    const root = mount(`#${TOKEN}`);
    startReviewPage(window);
    button()!.click();
    await vi.waitFor(() => expect(root.textContent).toBe(FAILURE));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a load with no fragment shows the reopen sentence and makes no request', async () => {
    const root = mount('');
    startReviewPage(window);
    await settle();
    expect(root.textContent).toBe(NO_TOKEN);
    expect(button()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves nothing in sessionStorage, localStorage, cookies or history state', async () => {
    await open();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(window.history.state).toBeNull();
    expect(JSON.stringify(window.history.state)).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('a malformed token makes no request on the click and shows the failure sentence', async () => {
    // `#lab` exactly is the measurement page since R2.3 (below); every other near miss is still a malformed token.
    // (A trailing space would not do as a near miss: the URL parser strips it, so `#lab ` is `#lab`.)
    for (const bad of ['short', `${TOKEN}x`, 'Lab', 'labs', 'lab-1', `${TOKEN.slice(0, 42)}!`]) {
      const root = mount(`#${bad}`);
      startReviewPage(window);
      await settle();
      expect(fetchSpy).not.toHaveBeenCalled();
      button()!.click();
      await vi.waitFor(() => expect(root.textContent).toBe(FAILURE));
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });
});

// ---- lab mode (X3 R2.3, M-X3.16; coordinator's ruling on review finding N1) ---------------------------------------------
// `/review#lab` is the measurement page: it clears the fragment as usual, makes no request of any kind, and mounts the
// committed fixture's two copies through the same frame code a copy uses. Six lines, each answered by the operator
// against a reference the page draws; the script and link lines hold until both load markers read "Drew" (the reader
// lab's rule: every check has a positive signal that it ran).

const CHROME_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const EDGE_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';
const FIREFOX_ANDROID_PHONE = 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0';
const FIREFOX_ANDROID_TABLET = 'Mozilla/5.0 (Android 14; Tablet; rv:132.0) Gecko/132.0 Firefox/132.0';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1';
const FIREFOX_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15';
const SAFARI_IPAD = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const JSDOM_UA = 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0';

const KEYS = ['inline-style', 'data-image', 'data-font', 'nested-frame', 'script-off', 'link-inert'] as const;
const NOT_MEASURED = 'Not measured';

describe('the engine and OS words of the measurement result (R2.3)', () => {
  it.each([
    ['desktop Chrome', CHROME_LINUX, 0, 'Chromium', 'desktop'],
    ['desktop Edge', EDGE_WINDOWS, 0, 'Chromium', 'desktop'],
    ['desktop Firefox', FIREFOX_LINUX, 0, 'Firefox', 'desktop'],
    ['desktop Safari', SAFARI_MAC, 0, 'WebKit', 'desktop'],
    ['iPhone Safari', SAFARI_IPHONE, 5, 'WebKit', 'phone'],
    ['iPhone Chrome (CriOS)', CHROME_IPHONE, 5, 'WebKit', 'phone'],
    ['iPhone Firefox (FxiOS)', FIREFOX_IPHONE, 5, 'WebKit', 'phone'],
    ['iPad with an iPad user agent', SAFARI_IPAD, 5, 'WebKit', 'tablet'],
    ['iPad with a Mac user agent and touch points', SAFARI_MAC, 5, 'WebKit', 'tablet'],
    ['a Mac with one touch point is not an iPad', SAFARI_MAC, 1, 'WebKit', 'desktop'],
    ['Android Chrome phone', CHROME_ANDROID_PHONE, 5, 'Chromium', 'phone'],
    ['Android Chrome tablet', CHROME_ANDROID_TABLET, 5, 'Chromium', 'tablet'],
    ['Android Firefox phone', FIREFOX_ANDROID_PHONE, 5, 'Firefox', 'phone'],
    ['Android Firefox tablet', FIREFOX_ANDROID_TABLET, 5, 'Firefox', 'tablet'],
    ['jsdom', JSDOM_UA, 0, 'unknown', 'desktop'],
    ['an empty user agent', '', 0, 'unknown', 'desktop'],
  ] as const)('%s reads %s / %s', (_name, ua, touch, engine, os) => {
    expect(labEngineOf(ua, touch)).toBe(engine);
    expect(labOsClassOf(ua, touch)).toBe(os);
  });
});

describe('the result block (R2.3)', () => {
  it('is one header line and the six keys in the fixed order, each with its word', () => {
    const answers: LabAnswers = {
      'inline-style': 'drew', 'data-image': 'did-not-draw', 'data-font': 'cannot-tell', 'nested-frame': 'drew',
      'script-off': 'unchanged', 'link-inert': 'changed',
    };
    expect(labResultText('Chromium', 'desktop', answers).split('\n')).toEqual([
      'review-lab 1 · Chromium · desktop',
      'inline-style: drew',
      'data-image: did-not-draw',
      'data-font: cannot-tell',
      'nested-frame: drew',
      'script-off: unchanged',
      'link-inert: changed',
    ]);
    expect([...LAB_KEYS]).toEqual([...KEYS]);
  });

  it('reads not-measured for a line nobody answered', () => {
    expect(labResultText('unknown', 'phone', {}).split('\n')).toEqual([
      'review-lab 1 · unknown · phone',
      ...KEYS.map((k) => `${k}: not-measured`),
    ]);
  });

  it('holds the script and link lines to not-measured until both load markers read drew', () => {
    const answers: LabAnswers = { 'script-off': 'unchanged', 'link-inert': 'unchanged' };
    const words = (a: LabAnswers): string[] => labResultText('Chromium', 'desktop', a).split('\n').slice(5);
    expect(words(answers)).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'nested-frame': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew', 'nested-frame': 'did-not-draw' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'cannot-tell', 'nested-frame': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew', 'nested-frame': 'drew' })).toEqual(['script-off: unchanged', 'link-inert: unchanged']);
  });
});

describe('lab mode: /review#lab (R2.3, M-X3.16)', () => {
  let xhrOpen: ReturnType<typeof vi.spyOn>;
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(CHROME_LINUX);
    xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    beacon = vi.fn(() => true);
    Object.defineProperty(window.navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.navigator, 'sendBeacon');
    Reflect.deleteProperty(window.navigator, 'maxTouchPoints');
  });

  const lab = (): HTMLElement => {
    const root = mount('#lab');
    startReviewPage(window);
    return root;
  };
  const row = (key: string): HTMLElement => document.querySelector(`.review-lab-row[data-key="${key}"]`) as HTMLElement;
  const status = (key: string): string => row(key).querySelector('.review-lab-status')?.textContent ?? '';
  const labels = (key: string): string[] => [...row(key).querySelectorAll('button')].map((b) => b.textContent ?? '');
  const tap = (key: string, label: string): void => {
    const b = [...row(key).querySelectorAll('button')].find((x) => x.textContent === label);
    if (b === undefined) throw new Error(`no "${label}" button on ${key}`);
    b.click();
  };
  const resultLines = (): string[] => (document.querySelector('pre.review-lab-result')?.textContent ?? '').split('\n');
  const word = (key: string): string => resultLines().find((l) => l.startsWith(`${key}: `)) ?? '';

  it('clears the fragment at once, as the copy path does', () => {
    lab();
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/review');
  });

  it('makes no request of any kind: no fetch, no XHR, no beacon, no link, script or non-data: image or font URL, no import()', async () => {
    const before = document.querySelectorAll('link, script').length;
    lab();
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(document.querySelectorAll('link, script')).toHaveLength(before);
    for (const img of document.querySelectorAll('img')) expect(img.getAttribute('src') ?? '').toMatch(/^data:/);
    // The page's own style text names no URL but a data: one (its reference font).
    const urls = [...document.querySelectorAll('style')].flatMap((s) => [...(s.textContent ?? '').matchAll(/url\(([^)]*)\)/g)].map((m) => m[1] ?? ''));
    for (const u of urls) expect(u.replace(/^['"]/, '')).toMatch(/^data:font\/woff2;base64,/);
    // `labFixture` is a static import: the entry's code (its comment lines set aside) holds no dynamic `import(`.
    const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'review', 'main.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).toMatch(/^import \{[^}]*\} from '\.\/labFixture';$/m);
  });

  it('shows no "Open draft" button and no reopen sentence, and says what the page is', () => {
    const root = lab();
    expect([...root.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Open draft');
    expect(root.textContent).not.toContain('To open this draft again');
    expect(root.querySelector('h1')?.textContent).toBe('Draft review frame measurement (M-X3.16)');
    expect(root.querySelector('.review-lab-intro')?.textContent).toMatch(/compar/i);
  });

  it('mounts both copies in frames: the empty sandbox, the fixture\'s bytes as srcdoc, a title for each, Markdown first', () => {
    lab();
    const frames = [...document.querySelectorAll('iframe')] as HTMLIFrameElement[];
    expect(frames).toHaveLength(2);
    expect(frames.map((f) => f.getAttribute('sandbox'))).toEqual(['', '']);
    expect(frames[0]!.srcdoc).toBe(LAB_MARKDOWN_COPY);
    expect(frames[1]!.srcdoc).toBe(LAB_MOCKUP_COPY);
    expect(frames.map((f) => f.getAttribute('title'))).toEqual(['Draft copy (Markdown)', 'Draft copy (mockup)']);
    for (const f of frames) expect(f.className).toContain('review-frame');
  });

  it('draws six lines in the fixed order, each with its key, three answer buttons and "Not measured"', () => {
    lab();
    expect([...document.querySelectorAll('.review-lab-row')].map((r) => r.getAttribute('data-key'))).toEqual([...KEYS]);
    for (const k of KEYS) expect(status(k), k).toBe(NOT_MEASURED);
    for (const k of KEYS.slice(0, 4)) expect(labels(k), k).toEqual(['Drew', 'Did not draw', 'Cannot tell']);
    for (const k of KEYS.slice(4)) expect(labels(k), k).toEqual(['Unchanged', 'Changed', 'Cannot tell']);
    // The only controls are those 18 buttons.
    expect(document.querySelectorAll('button, a, input, select, textarea')).toHaveLength(18);
  });

  it('draws a reference beside each line, by the page itself: the swatches in the expected colours, a sample in the fixture font', () => {
    lab();
    const colourOf = (key: string): string[] => [...row(key).querySelectorAll('.review-lab-ref .review-lab-swatch')]
      .map((s) => (s as HTMLElement).style.backgroundColor);
    const rgb = (hex: string): string => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = hex;
      return probe.style.backgroundColor;
    };
    expect(colourOf('inline-style')).toEqual([rgb(LAB_GROUND)]);
    expect(colourOf('data-image')).toEqual([rgb(LAB_IMAGE_COLOUR)]);
    expect(colourOf('nested-frame')).toEqual([rgb(LAB_SWATCH_COLOUR)]);
    expect(colourOf('script-off')).toEqual([rgb(LAB_GROUND), rgb(LAB_SWATCH_COLOUR)]);
    const sample = row('data-font').querySelector('.review-lab-ref .review-lab-sample') as HTMLElement;
    expect(sample.textContent).toBe('Review lab sample 0123 Hamburgefonstiv');
    expect(sample.style.fontFamily).toContain('ReviewLabRef');
    expect([...document.querySelectorAll('style')].some((s) => /@font-face[^}]*ReviewLabRef[^}]*data:font\/woff2;base64,/.test(s.textContent ?? ''))).toBe(true);
    for (const k of KEYS) expect(row(k).querySelector('.review-lab-ref')?.textContent?.trim().length, k).toBeGreaterThan(20);
    // The inline-style line says which element of Export's chrome it points at.
    expect(row('inline-style').textContent).toMatch(/page ground/i);
  });

  it('reads "Not measured" until answered, and an answer replaces the one before it', () => {
    lab();
    tap('data-image', 'Drew');
    expect(status('data-image')).toBe('Drew');
    expect(status('data-font')).toBe(NOT_MEASURED);
    expect(word('data-image')).toBe('data-image: drew');
    tap('data-image', 'Did not draw');
    expect(status('data-image')).toBe('Did not draw');
    expect(word('data-image')).toBe('data-image: did-not-draw');
    tap('data-image', 'Cannot tell');
    expect(word('data-image')).toBe('data-image: cannot-tell');
    expect([...row('data-image').querySelectorAll('button')].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('holds the script and link lines while either load marker is unanswered or answered other than "Drew" (M-X3.16 positive signal)', () => {
    lab();
    tap('script-off', 'Unchanged');
    tap('link-inert', 'Unchanged');
    expect(status('script-off')).toMatch(/^Held/);
    expect(status('link-inert')).toMatch(/^Held/);
    expect(word('script-off')).toBe('script-off: not-measured');
    expect(word('link-inert')).toBe('link-inert: not-measured');
    tap('inline-style', 'Drew');
    expect(word('script-off')).toBe('script-off: not-measured');
    tap('nested-frame', 'Did not draw');
    expect(word('script-off')).toBe('script-off: not-measured');
    expect(word('link-inert')).toBe('link-inert: not-measured');
    expect(status('script-off')).toMatch(/^Held/);
  });

  it('takes the held answers once both load markers read "Drew", and holds them again when one changes', () => {
    lab();
    tap('script-off', 'Unchanged');
    tap('link-inert', 'Changed');
    tap('inline-style', 'Drew');
    tap('nested-frame', 'Drew');
    expect(status('script-off')).toBe('Unchanged');
    expect(status('link-inert')).toBe('Changed');
    expect(word('script-off')).toBe('script-off: unchanged');
    expect(word('link-inert')).toBe('link-inert: changed');
    tap('inline-style', 'Cannot tell');
    expect(word('script-off')).toBe('script-off: not-measured');
    expect(word('link-inert')).toBe('link-inert: not-measured');
    expect(status('script-off')).toMatch(/^Held/);
  });

  it('shows one copyable result block: a pre, its header from the user agent, the keys in order, and no clipboard or storage write', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      lab();
      expect(document.querySelectorAll('pre')).toHaveLength(1);
      expect(resultLines()).toEqual(['review-lab 1 · Chromium · desktop', ...KEYS.map((k) => `${k}: not-measured`)]);
      tap('inline-style', 'Drew');
      tap('data-image', 'Drew');
      tap('data-font', 'Did not draw');
      tap('nested-frame', 'Drew');
      tap('script-off', 'Unchanged');
      tap('link-inert', 'Unchanged');
      expect(document.querySelector('pre.review-lab-result')?.textContent).toBe([
        'review-lab 1 · Chromium · desktop',
        'inline-style: drew', 'data-image: drew', 'data-font: did-not-draw', 'nested-frame: drew',
        'script-off: unchanged', 'link-inert: unchanged',
      ].join('\n'));
      expect(writeText).not.toHaveBeenCalled();
      expect(window.sessionStorage.length).toBe(0);
      expect(window.localStorage.length).toBe(0);
      expect(document.cookie).toBe('');
    } finally {
      Reflect.deleteProperty(window.navigator, 'clipboard');
    }
  });

  it('names the engine and the OS class from the user agent in the first line of the block', () => {
    for (const [ua, touch, header] of [
      [FIREFOX_LINUX, 0, 'review-lab 1 · Firefox · desktop'],
      [SAFARI_IPHONE, 5, 'review-lab 1 · WebKit · phone'],
      [SAFARI_MAC, 5, 'review-lab 1 · WebKit · tablet'],
      [JSDOM_UA, 0, 'review-lab 1 · unknown · desktop'],
    ] as const) {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
      Object.defineProperty(window.navigator, 'maxTouchPoints', { value: touch, configurable: true });
      lab();
      expect(resultLines()[0]).toBe(header);
    }
  });

  it('does not change the copy path: a hash that is not exactly "lab" is still a token, and the lab page is not drawn for it', async () => {
    for (const hash of ['#Lab', '#labs', `#${TOKEN}`]) {
      const root = mount(hash);
      startReviewPage(window);
      await settle();
      expect(root.querySelector('.review-lab-row')).toBeNull();
      expect(button()?.textContent).toBe('Open draft');
    }
  });
});
