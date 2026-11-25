// The draft review page (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5; M-X3.10).
// `src/review/main.ts` is a fixed page with no React: it reads the capability token out of the URL fragment, clears
// the fragment at once, shows one button, and only the tap posts the token to the one read door. Each row below is
// one behaviour of that page, driven in jsdom with a fetch spy.
import { REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, reviewDate } from '../../shared/docsReview';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReviewPage } from '../src/review/main';

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
  if (sharedAt !== null) headers['x-ccrc-review-shared-at'] = sharedAt;
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
      status: 200, headers: { 'x-ccrc-review-shared-at': String(SHARED_AT) },
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
    for (const bad of ['short', `${TOKEN}x`, 'lab', `${TOKEN.slice(0, 42)}!`]) {
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
