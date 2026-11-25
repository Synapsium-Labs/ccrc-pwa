// The draft review page (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5; M-X3.10).
// `src/review/main.ts` is a fixed page with no React: it reads the capability token out of the URL fragment, clears
// the fragment at once, shows one button, and only the tap posts the token to the one read door. Each row below is
// one behaviour of that page, driven in jsdom with a fetch spy.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_SHARED_AT_HEADER, reviewDate } from '../../shared/docsReview';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAB_GROUND, LAB_IMAGE_COLOUR, LAB_KEYS, LAB_SWATCH_COLOUR, MAX_RESTORES, RESTORE_WINDOW_MS, labDeviceWords, labEngineWord,
  labResultText, startReviewPage,
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
/** The injected clock the restore bound reads (milliseconds); a row moves it by hand, so no row waits in real time. */
let clock = 0;
const now = (): number => clock;

beforeEach(() => {
  clock = 0;
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
  startReviewPage(window, now);
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

// ---- the page restores its own copy, bounded at three within ten seconds (D-9029) -----------------------------------------------
// A link with no `target` inside a copy is blocked from leaving, but Chromium navigates the FRAME to its error page, so the copy
// is gone. The page keeps the copy's text and, when the frame element fires a `load` that the page did not cause, sets the same
// `srcdoc` again and shows one sentence beside the frame; at most three times within ten seconds of the injected clock `now`
// (spaced taps are restored every time), then it stops for good and says so. jsdom fires its own
// (trusted, asynchronous) `load` for a frame's FIRST `srcdoc` draw only: setting the same `srcdoc` again reloads nothing in jsdom.
// So `drawn(n)` waits until n trusted loads have arrived (counted by a capture listener on the document), and a row plays the
// load of each restore itself with `ownLoad`, the load the page's own draw would cause in a browser. `navigates` is the load the
// page did NOT cause, the copy leaving its frame. Both are untrusted events dispatched on the frame element.

const RESTORED = 'That link opens outside this page. Use the links listed above.';
const RESTORED_NO_LINKS = 'That link cannot open from this page.';
const STOPPED = 'This copy kept leaving its frame, so it is no longer redrawn. Open the link you were sent to read it again.';

const navigates = (frame: HTMLIFrameElement): void => { frame.dispatchEvent(new Event('load')); };
const ownLoad = navigates; // the same event: the page tells a draw's own load from a navigation by what it expects, never by the event

/** Counts the trusted `load` events of every frame (jsdom's own, for the draws the page makes), until `stop()`. */
function watchLoads(): { drawn: (n: number) => Promise<void>; own: () => number; stop: () => void } {
  let n = 0;
  const on = (e: Event): void => { if (e.isTrusted) n += 1; };
  document.addEventListener('load', on, true);
  return {
    drawn: (total) => vi.waitFor(() => expect(n).toBe(total)),
    own: () => n,
    stop: () => { document.removeEventListener('load', on, true); },
  };
}

/** Records every value set on an iframe's `srcdoc`, until `stop()`. */
function recordSrcdoc(): { readonly sets: string[]; stop: () => void } {
  const sets: string[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc')!;
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true, get: original.get,
    set(this: HTMLIFrameElement, v: string) { sets.push(v); original.set!.call(this, v); },
  });
  return { sets, stop: () => { Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', original); } };
}

describe('the page restores its own copy, at most three times within ten seconds (D-9029)', () => {
  let rec: ReturnType<typeof recordSrcdoc>;
  let loads: ReturnType<typeof watchLoads>;
  beforeEach(() => { rec = recordSrcdoc(); loads = watchLoads(); });
  afterEach(() => { rec.stop(); loads.stop(); });

  const frameOf = (): HTMLIFrameElement => document.querySelector('iframe.review-frame') as HTMLIFrameElement;
  const note = (): string | null => document.querySelector('.review-restore-note')?.textContent ?? null;

  it('draws no sentence at the first draw, nor at its own load', async () => {
    await open();
    await loads.drawn(1); // the first draw's own load
    expect(rec.sets).toEqual([COPY]);
    expect(note()).toBeNull();
    expect(frameOf().getAttribute('data-restores')).toBe('0');
  });

  it('a navigation the page did not cause puts the copy back: the same srcdoc, the sandbox untouched, one sentence beside the frame', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    navigates(frame);
    expect(rec.sets).toEqual([COPY, COPY]);
    expect(frame.srcdoc).toBe(COPY);
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(note()).toBe(RESTORED);
    expect(frame.nextElementSibling?.className).toBe('review-restore-note');
    expect(frame.nextElementSibling?.getAttribute('role')).toBe('status');
    expect(frame.getAttribute('data-restores')).toBe('1');
  });

  it('keeps nothing and asks for nothing: no new request, no storage, cookie or history entry, no token, no message channel', async () => {
    const adds = vi.spyOn(window, 'addEventListener');
    const posts = vi.spyOn(window, 'postMessage');
    const pushes = vi.spyOn(window.history, 'pushState');
    const replaces = vi.spyOn(window.history, 'replaceState');
    try {
      await open();
      const frame = frameOf();
      const asked = fetchSpy.mock.calls.length;
      const addsBefore = adds.mock.calls.length;
      const replacesBefore = replaces.mock.calls.length;
      await loads.drawn(1);
      navigates(frame);
      ownLoad(frame);
      navigates(frame);
      ownLoad(frame);
      expect(fetchSpy.mock.calls.length, 'the restore made no request').toBe(asked);
      expect(adds.mock.calls.length, 'the restore added no listener to the window').toBe(addsBefore);
      expect(adds.mock.calls.map((c) => c[0])).not.toContain('message');
      expect(posts).not.toHaveBeenCalled();
      expect(pushes).not.toHaveBeenCalled();
      expect(replaces.mock.calls.length, 'the restore wrote no history entry').toBe(replacesBefore);
      expect(window.sessionStorage.length).toBe(0);
      expect(window.localStorage.length).toBe(0);
      expect(document.cookie).toBe('');
      expect(window.history.state).toBeNull();
      expect(document.documentElement.outerHTML).not.toContain(TOKEN);
      expect(window.location.href).not.toContain(TOKEN);
    } finally {
      adds.mockRestore();
      posts.mockRestore();
      pushes.mockRestore();
      replaces.mockRestore();
    }
  });

  it('the page\'s own draws are not navigations: the first draw\'s load and each restore\'s load cause no restore', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1); // the first draw's own load arrived, and caused no restore
    expect(rec.sets).toHaveLength(1);
    navigates(frame);
    expect(rec.sets, 'one navigation, one restore').toHaveLength(2);
    ownLoad(frame); // the restore's own load arrives
    expect(rec.sets, 'the restore\'s own load causes no second restore').toHaveLength(2);
    expect(frame.getAttribute('data-restores')).toBe('1');
    navigates(frame);
    expect(rec.sets).toHaveLength(3);
    ownLoad(frame);
    expect(rec.sets).toHaveLength(3);
    expect(frame.getAttribute('data-restores')).toBe('2');
  });

  it('the bound is three restores within ten seconds', () => {
    expect([MAX_RESTORES, RESTORE_WINDOW_MS]).toEqual([3, 10_000]);
  });

  it('a copy that leaves its frame again and again, fast, is restored exactly three times, then left as it is, with the stop sentence', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    for (let i = 1; i <= 3; i += 1) {
      clock += 100; // fast taps: well under ten seconds in all
      navigates(frame);
      expect(note(), `restore ${i}`).toBe(RESTORED);
      expect(rec.sets, `restore ${i}`).toHaveLength(1 + i);
      ownLoad(frame);
    }
    expect(frame.getAttribute('data-restores')).toBe('3');
    navigates(frame); // the fourth time
    expect(rec.sets, 'no fourth restore').toHaveLength(4);
    expect(note()).toBe(STOPPED);
    expect(frame.getAttribute('data-restores')).toBe('3');
    expect(frame.getAttribute('sandbox')).toBe('');
    navigates(frame); // and the fifth: still left as it is
    await settle();
    expect(rec.sets).toHaveLength(4);
    expect(rec.sets, 'the page drew nothing after the third restore').toHaveLength(4);
    expect(note()).toBe(STOPPED);
    expect(document.querySelectorAll('.review-restore-note')).toHaveLength(1);
  });

  it('spaced taps are restored every time: four taps, each more than ten seconds after the last, give four restores and a fifth still restores', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    for (let i = 1; i <= 5; i += 1) {
      clock += 10_001; // a literal, so a changed constant reds this row too
      navigates(frame);
      expect(frame.getAttribute('data-restores'), `tap ${i}`).toBe(String(i));
      expect(frame.srcdoc, `tap ${i}`).toBe(COPY);
      expect(rec.sets, `tap ${i}`).toHaveLength(1 + i);
      expect(note(), `tap ${i}`).toBe(RESTORED);
      ownLoad(frame);
    }
    expect(note()).not.toBe(STOPPED);
    expect(document.querySelectorAll('.review-restore-note')).toHaveLength(1);
  });

  it('the window is exclusive at its far edge: a fourth navigation 9 999 ms after the first restore is stopped', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    for (const t of [0, 1, 2]) {
      clock = t;
      navigates(frame);
      ownLoad(frame);
    }
    expect(frame.getAttribute('data-restores')).toBe('3');
    clock = 9_999;
    navigates(frame);
    expect(note()).toBe(STOPPED);
    expect(rec.sets, 'no fourth restore').toHaveLength(4);
    expect(frame.getAttribute('data-restores')).toBe('3');
  });

  it('a navigation exactly ten seconds after the first restore is restored: that restore has left the window', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    for (const t of [0, 1, 2]) {
      clock = t;
      navigates(frame);
      ownLoad(frame);
    }
    clock = 10_000; // a literal, so a changed constant reds this row too
    navigates(frame);
    expect(note()).toBe(RESTORED);
    expect(rec.sets, 'a fourth restore').toHaveLength(5);
    expect(frame.getAttribute('data-restores')).toBe('4');
  });

  it('once stopped the stop is final: after the window passes, a navigation restores nothing and keeps the stop sentence', async () => {
    await open();
    const frame = frameOf();
    await loads.drawn(1);
    for (let i = 1; i <= 3; i += 1) {
      navigates(frame);
      ownLoad(frame);
    }
    navigates(frame);
    expect(note()).toBe(STOPPED);
    expect(rec.sets).toHaveLength(4);
    clock += RESTORE_WINDOW_MS * 3;
    navigates(frame);
    await settle();
    expect(rec.sets, 'no restore after the stop, however long after').toHaveLength(4);
    expect(note()).toBe(STOPPED);
    expect(frame.getAttribute('data-restores')).toBe('3');
    expect(document.querySelectorAll('.review-restore-note')).toHaveLength(1);
  });

  it('says "That link cannot open from this page." when the page lists no links above the copy', async () => {
    fetchSpy.mockImplementation(async () => answer(200, '<!doctype html><p>no links</p>'));
    await open();
    expect(document.querySelector('.review-links')).toBeNull();
    await loads.drawn(1);
    navigates(frameOf());
    expect(note()).toBe(RESTORED_NO_LINKS);
  });
});

// ---- lab mode (X3 R2.3, M-X3.16; coordinator's ruling on review finding N1) ---------------------------------------------
// `/review#lab` is the measurement page: it clears the fragment as usual, makes no request of any kind, and mounts the
// committed fixture's two copies through the same frame code a copy uses. Seven lines, each answered by the operator
// against a reference the page draws; an "Unchanged" on the script and link lines holds until both load markers read
// "Drew" (the reader lab's rule: every check has a positive signal that it ran), and a "Changed" or "Cannot tell" never holds.

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

const KEYS = ['inline-style', 'data-image', 'data-font', 'nested-frame', 'script-off', 'link-inert', 'link-self'] as const;
const NOT_MEASURED = 'Not measured';

describe('the engine and OS words of the measurement result (R2.3, D-9028: deviceOf is the one parser)', () => {
  it.each([
    ['desktop Chrome', CHROME_LINUX, 'Chromium', 'Linux'],
    ['desktop Edge', EDGE_WINDOWS, 'Chromium', 'Windows'],
    ['desktop Firefox', FIREFOX_LINUX, 'Firefox', 'Linux'],
    ['desktop Safari', SAFARI_MAC, 'WebKit', 'macOS'],
    ['iPhone Safari', SAFARI_IPHONE, 'WebKit', 'iOS'],
    ['iPhone Chrome (CriOS)', CHROME_IPHONE, 'WebKit', 'iOS'],
    ['iPhone Firefox (FxiOS)', FIREFOX_IPHONE, 'WebKit', 'iOS'],
    ['iPad Safari', SAFARI_IPAD, 'WebKit', 'iOS'],
    ['Android Chrome phone', CHROME_ANDROID_PHONE, 'Chromium', 'Android'],
    ['Android Chrome tablet', CHROME_ANDROID_TABLET, 'Chromium', 'Android'],
    ['Android Firefox phone', FIREFOX_ANDROID_PHONE, 'Firefox', 'Android'],
    ['Android Firefox tablet', FIREFOX_ANDROID_TABLET, 'Firefox', 'Android'],
    ['jsdom', JSDOM_UA, 'WebKit', 'other'],
    ['an empty user agent', '', 'unknown', 'other'],
  ] as const)('%s reads %s / %s', (_name, ua, engine, os) => {
    expect(labDeviceWords(ua)).toEqual({ engine, os });
  });

  it('maps each engine class of the reader lab to the word of M-X3.16, and drops the version', () => {
    expect(labEngineWord('Blink 141')).toBe('Chromium');
    expect(labEngineWord('Gecko 140')).toBe('Firefox');
    expect(labEngineWord('WebKit 19')).toBe('WebKit');
    expect(labEngineWord('WebKit')).toBe('WebKit');
    expect(labEngineWord('unknown')).toBe('unknown');
    expect(labEngineWord('')).toBe('unknown');
    expect(labEngineWord('Trident 11')).toBe('unknown');
  });

  it('keeps no user-agent parser of its own: the entry reads `deviceOf` and no regular expression over the user agent', () => {
    const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'review', 'main.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(source).toMatch(/^import \{ deviceOf, type LabFeatures \} from '\.\.\/readerLab\/device';$/m);
    expect(source).not.toMatch(/\/(?:iPhone|iPad|Android|Firefox|Chrome|Macintosh)/);
    expect(source).not.toMatch(/\blabEngineOf\b|\blabOsClassOf\b/);
  });
});

describe('the result block (R2.3)', () => {
  it('is one header line and the seven keys in the fixed order, each with its word', () => {
    const answers: LabAnswers = {
      'inline-style': 'drew', 'data-image': 'did-not-draw', 'data-font': 'cannot-tell', 'nested-frame': 'drew',
      'script-off': 'unchanged', 'link-inert': 'changed', 'link-self': 'restored',
    };
    expect(labResultText('Chromium', 'Linux', answers).split('\n')).toEqual([
      'review-lab 1 · Chromium · Linux',
      'inline-style: drew',
      'data-image: did-not-draw',
      'data-font: cannot-tell',
      'nested-frame: drew',
      'script-off: unchanged',
      'link-inert: changed',
      'link-self: restored',
    ]);
    expect([...LAB_KEYS]).toEqual([...KEYS]);
    expect(KEYS).toHaveLength(7);
  });

  it('link-self: "kept" and "restored" pass and wait for both load markers; "gone" and "cannot-tell" never wait', () => {
    const word = (a: LabAnswers): string => labResultText('Chromium', 'Linux', a).split('\n')[7] ?? '';
    for (const pass of ['kept', 'restored'] as const) {
      expect(word({ 'link-self': pass }), `${pass}, no markers`).toBe('link-self: not-measured');
      expect(word({ 'link-self': pass, 'inline-style': 'drew' })).toBe('link-self: not-measured');
      expect(word({ 'link-self': pass, 'nested-frame': 'drew' })).toBe('link-self: not-measured');
      expect(word({ 'link-self': pass, 'inline-style': 'drew', 'nested-frame': 'did-not-draw' })).toBe('link-self: not-measured');
      expect(word({ 'link-self': pass, 'inline-style': 'drew', 'nested-frame': 'drew' })).toBe(`link-self: ${pass}`);
    }
    for (const fail of ['gone', 'cannot-tell'] as const) {
      expect(word({ 'link-self': fail }), `${fail}, no markers`).toBe(`link-self: ${fail}`);
      expect(word({ 'link-self': fail, 'inline-style': 'did-not-draw' })).toBe(`link-self: ${fail}`);
      expect(word({ 'link-self': fail, 'inline-style': 'drew', 'nested-frame': 'drew' })).toBe(`link-self: ${fail}`);
    }
    expect(word({})).toBe('link-self: not-measured');
  });

  it('reads not-measured for a line nobody answered', () => {
    expect(labResultText('unknown', 'other', {}).split('\n')).toEqual([
      'review-lab 1 · unknown · other',
      ...KEYS.map((k) => `${k}: not-measured`),
    ]);
  });

  it('holds an "unchanged" on the script and link lines to not-measured until both load markers read drew', () => {
    const answers: LabAnswers = { 'script-off': 'unchanged', 'link-inert': 'unchanged' };
    const words = (a: LabAnswers): string[] => labResultText('Chromium', 'Linux', a).split('\n').slice(5, 7);
    expect(words(answers)).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'nested-frame': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew', 'nested-frame': 'did-not-draw' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'cannot-tell', 'nested-frame': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ ...answers, 'inline-style': 'drew', 'nested-frame': 'drew' })).toEqual(['script-off: unchanged', 'link-inert: unchanged']);
  });

  it('never holds a "changed" or a "cannot-tell", whatever the load markers read: a canary that ran is recorded (review I1)', () => {
    const words = (a: LabAnswers): string[] => labResultText('Chromium', 'Linux', a).split('\n').slice(5, 7);
    // The canary ran: the operator saw its red block and may have marked a load marker "Did not draw", or answered none.
    expect(words({ 'script-off': 'changed', 'link-inert': 'changed', 'inline-style': 'did-not-draw' }))
      .toEqual(['script-off: changed', 'link-inert: changed']);
    expect(words({ 'script-off': 'changed', 'inline-style': 'did-not-draw', 'nested-frame': 'did-not-draw' }))
      .toEqual(['script-off: changed', 'link-inert: not-measured']);
    expect(words({ 'script-off': 'changed' })).toEqual(['script-off: changed', 'link-inert: not-measured']);
    expect(words({ 'script-off': 'cannot-tell', 'link-inert': 'cannot-tell' })).toEqual(['script-off: cannot-tell', 'link-inert: cannot-tell']);
    // An unanswered marker still holds an "unchanged".
    expect(words({ 'script-off': 'unchanged', 'inline-style': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
    expect(words({ 'link-inert': 'unchanged', 'nested-frame': 'drew' })).toEqual(['script-off: not-measured', 'link-inert: not-measured']);
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
    startReviewPage(window, now);
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

  it('draws seven lines in the fixed order, each with its key, its answer buttons and "Not measured"', () => {
    lab();
    expect([...document.querySelectorAll('.review-lab-row')].map((r) => r.getAttribute('data-key'))).toEqual([...KEYS]);
    for (const k of KEYS) expect(status(k), k).toBe(NOT_MEASURED);
    for (const k of KEYS.slice(0, 4)) expect(labels(k), k).toEqual(['Drew', 'Did not draw', 'Cannot tell']);
    for (const k of ['script-off', 'link-inert']) expect(labels(k), k).toEqual(['Unchanged', 'Changed', 'Cannot tell']);
    expect(labels('link-self')).toEqual(['Copy still here', 'Copy came back with the sentence', 'Copy gone', 'Cannot tell']);
    // The only controls are those 22 buttons.
    expect(document.querySelectorAll('button, a, input, select, textarea')).toHaveLength(22);
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
    // The script line's reference is the failure itself: the pure red block reading SCRIPT RAN, which the canary would add.
    expect(colourOf('script-off')).toEqual([]);
    const failure = row('script-off').querySelector('.review-lab-ref .review-lab-failure') as HTMLElement;
    expect(failure.textContent).toBe('SCRIPT RAN');
    expect(failure.style.backgroundColor).toBe(rgb('#ff0000'));
    expect(row('script-off').textContent).toContain('no red block reading SCRIPT RAN');
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

  it('holds an "Unchanged" on the script and link lines while either load marker is unanswered or answered other than "Drew" (M-X3.16 positive signal)', () => {
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

  it('takes an "Unchanged" once both load markers read "Drew" and holds it again when one changes; a "Changed" is never held', () => {
    lab();
    tap('script-off', 'Unchanged');
    tap('link-inert', 'Changed');
    // The "Changed" counts at once, with both markers unanswered; the "Unchanged" waits.
    expect(status('link-inert')).toBe('Changed');
    expect(word('link-inert')).toBe('link-inert: changed');
    expect(word('script-off')).toBe('script-off: not-measured');
    tap('inline-style', 'Drew');
    tap('nested-frame', 'Drew');
    expect(status('script-off')).toBe('Unchanged');
    expect(status('link-inert')).toBe('Changed');
    expect(word('script-off')).toBe('script-off: unchanged');
    expect(word('link-inert')).toBe('link-inert: changed');
    tap('inline-style', 'Cannot tell');
    expect(word('script-off')).toBe('script-off: not-measured');
    expect(word('link-inert')).toBe('link-inert: changed');
    expect(status('script-off')).toMatch(/^Held/);
  });

  it('link-self: "Copy still here" and "Copy came back with the sentence" are held like "Unchanged"; "Copy gone" and "Cannot tell" count at once (D-9029)', () => {
    lab();
    tap('link-self', 'Copy still here');
    expect(status('link-self')).toMatch(/^Held \(Copy still here\)/);
    expect(word('link-self')).toBe('link-self: not-measured');
    tap('link-self', 'Copy came back with the sentence');
    expect(status('link-self')).toMatch(/^Held \(Copy came back with the sentence\)/);
    expect(word('link-self')).toBe('link-self: not-measured');
    tap('inline-style', 'Drew');
    expect(word('link-self')).toBe('link-self: not-measured');
    tap('nested-frame', 'Drew');
    expect(status('link-self')).toBe('Copy came back with the sentence');
    expect(word('link-self')).toBe('link-self: restored');
    tap('link-self', 'Copy still here');
    expect(word('link-self')).toBe('link-self: kept');
    tap('inline-style', 'Cannot tell');
    expect(word('link-self')).toBe('link-self: not-measured');
    tap('link-self', 'Copy gone');
    expect(status('link-self')).toBe('Copy gone');
    expect(word('link-self')).toBe('link-self: gone');
    tap('link-self', 'Cannot tell');
    expect(word('link-self')).toBe('link-self: cannot-tell');
  });

  it('records a canary that ran: "Changed" on script-off stands with a load marker answered "Did not draw" (review I1)', () => {
    lab();
    tap('inline-style', 'Did not draw');
    tap('script-off', 'Changed');
    expect(word('script-off')).toBe('script-off: changed');
    expect(status('script-off')).toBe('Changed');
    tap('script-off', 'Cannot tell');
    expect(word('script-off')).toBe('script-off: cannot-tell');
  });

  it('says what can be tapped, what an unchanged frame looks like, the popup sentence, and where the inner frame is (review M1-M4)', () => {
    lab();
    const link = row('link-inert').textContent ?? '';
    expect(link).toContain('"a link" in the Markdown copy');
    expect(link).toContain('Links in this page');
    expect(link).toMatch(/inner frame have no address/);
    expect(link).toContain('A link that opens a new tab is a popup the empty sandbox blocks; the frame itself must still show its copy.');
    expect(link).toMatch(/unchanged frame still shows its copy/);
    // The link-self line says where its link is (the mockup copy's list, near its end, scrolled to inside that frame), what to
    // tap, and what each answer looks like (D-9029).
    const self = row('link-self').textContent ?? '';
    // Before the tap instruction, the line has the operator check that no sentence stands before any tap (R2.3 review, M3).
    expect(self).toContain('Before you tap anything, look under the mockup copy’s frame: no sentence stands there.');
    expect(self).toContain('If a sentence already stands there before any tap, answer "Copy gone"');
    expect(self.indexOf('Before you tap anything')).toBeLessThan(self.indexOf('Scroll inside the mockup copy’s frame to its list'));
    expect(self).toContain('Scroll inside the mockup copy’s frame to its list "Links in this page"');
    expect(self).toContain('near the end of the frame');
    expect(self).toContain('page.md');
    expect(self).toContain('a link written with no target');
    expect(self).toContain('"Copy still here": the frame shows its copy as before');
    expect(self).toContain('"Copy came back with the sentence"');
    expect(self).toContain('That link cannot open from this page.');
    expect(self).toContain('"Copy gone"');
    expect(self).toContain('inline-style and nested-frame both read Drew');
    const script = row('script-off').textContent ?? '';
    expect(script).toContain('Each copy shows no red block reading SCRIPT RAN');
    expect(script).not.toMatch(/red anywhere/i);
    expect(script).toMatch(/crimson/);
    for (const k of ['nested-frame', 'data-font']) expect(row(k).textContent, k).toContain('Scroll inside the mockup copy’s frame to its inner frame');
  });

  it('shows one copyable result block: a pre, its header from the user agent, the keys in order, and no clipboard or storage write', () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      lab();
      expect(document.querySelectorAll('pre')).toHaveLength(1);
      expect(resultLines()).toEqual(['review-lab 1 · Chromium · Linux', ...KEYS.map((k) => `${k}: not-measured`)]);
      tap('inline-style', 'Drew');
      tap('data-image', 'Drew');
      tap('data-font', 'Did not draw');
      tap('nested-frame', 'Drew');
      tap('script-off', 'Unchanged');
      tap('link-inert', 'Unchanged');
      tap('link-self', 'Copy came back with the sentence');
      expect(document.querySelector('pre.review-lab-result')?.textContent).toBe([
        'review-lab 1 · Chromium · Linux',
        'inline-style: drew', 'data-image: drew', 'data-font: did-not-draw', 'nested-frame: drew',
        'script-off: unchanged', 'link-inert: unchanged', 'link-self: restored',
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
    for (const [ua, header] of [
      [FIREFOX_LINUX, 'review-lab 1 · Firefox · Linux'],
      [SAFARI_IPHONE, 'review-lab 1 · WebKit · iOS'],
      [SAFARI_MAC, 'review-lab 1 · WebKit · macOS'],
      [CHROME_ANDROID_PHONE, 'review-lab 1 · Chromium · Android'],
      [EDGE_WINDOWS, 'review-lab 1 · Chromium · Windows'],
      ['', 'review-lab 1 · unknown · other'],
    ] as const) {
      vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
      lab();
      expect(resultLines()[0]).toBe(header);
    }
  });

  it('each lab frame restores its own copy on its own, bounded at three within ten seconds per frame (the clock does not move here), with the sentence beside that frame only (D-9029)', async () => {
    const rec = recordSrcdoc();
    const loads = watchLoads();
    try {
      lab();
      const [md, mock] = [...document.querySelectorAll('iframe')] as HTMLIFrameElement[];
      expect(rec.sets).toEqual([LAB_MARKDOWN_COPY, LAB_MOCKUP_COPY]);
      await loads.drawn(2); // both first draws' own loads
      expect(rec.sets).toHaveLength(2);
      const noteOf = (f: HTMLIFrameElement): string | null => f.parentElement?.querySelector('.review-restore-note')?.textContent ?? null;
      expect([noteOf(md!), noteOf(mock!)]).toEqual([null, null]);
      // The mockup copy leaves its frame once: only it is put back, with the sentence for a page that lists no links.
      navigates(mock!);
      expect(rec.sets).toEqual([LAB_MARKDOWN_COPY, LAB_MOCKUP_COPY, LAB_MOCKUP_COPY]);
      expect([noteOf(md!), noteOf(mock!)]).toEqual([null, RESTORED_NO_LINKS]);
      expect([md!.getAttribute('data-restores'), mock!.getAttribute('data-restores')]).toEqual(['0', '1']);
      ownLoad(mock!);
      expect(rec.sets).toHaveLength(3);
      // The Markdown copy leaves its frame again and again: three restores, then it is left as it is, and the mockup's count
      // is its own (one restore so far, so one more is still allowed there).
      for (let i = 1; i <= 3; i += 1) {
        navigates(md!);
        ownLoad(md!);
      }
      expect(rec.sets.filter((s) => s === LAB_MARKDOWN_COPY)).toHaveLength(4);
      navigates(md!);
      expect(rec.sets.filter((s) => s === LAB_MARKDOWN_COPY)).toHaveLength(4);
      expect(noteOf(md!)).toBe(STOPPED);
      expect(md!.getAttribute('data-restores')).toBe('3');
      expect(noteOf(mock!)).toBe(RESTORED_NO_LINKS);
      navigates(mock!);
      expect(rec.sets.filter((s) => s === LAB_MOCKUP_COPY)).toHaveLength(3);
      expect(mock!.getAttribute('data-restores')).toBe('2');
      expect([md!.getAttribute('sandbox'), mock!.getAttribute('sandbox')]).toEqual(['', '']);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(xhrOpen).not.toHaveBeenCalled();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      rec.stop();
      loads.stop();
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
