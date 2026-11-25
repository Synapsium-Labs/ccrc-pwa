// The draft review page's entry (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5).
//
// Ring: L4, an entry that owns the DOM and one network call and decides nothing beyond what the page's words say. It
// imports only L0 (`shared/docsReview.ts`: the marker header, the token grammar and the date formatter) and its own
// stylesheet. No React and no app shell: the page is a fixed document served at `/review` under its own header policy
// (`script-src 'self'`, no inline script, no external font, `img-src data:`), so nothing here writes an inline script,
// loads a font or draws an image.
//
// What the page does, in order:
//   1. It reads the fragment (the capability token) into a local of this closure and replaces its history entry's URL
//      with a bare `/review` before any other work. The token is never in `sessionStorage`, `localStorage`, a cookie,
//      `history.state`, a global, the DOM or a console line, and it is dropped once the copy is drawn.
//   2. With no fragment it says how to open the draft again, and makes no request.
//   3. Otherwise it shows one button, "Open draft". Only the tap posts the token, to the one read door.
//   4. On a 200 it draws a banner, then every `https:` link target found in the bytes by an inert parse (each a
//      top-level anchor, so a tap can leave the sandboxed copy), then the copy itself in a frame with the empty sandbox.
//      On any other answer, a network error or a failed decode it says that the link has expired, and draws no frame.
// The page adds no message listener, calls no `postMessage`, and never reads the frame's DOM.
import { REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, isReviewToken, reviewDate } from '../../../shared/docsReview';
import './review.css';

const ROOT_ID = 'review-root';
const PAGE_PATH = '/review';
const OPEN_URL = '/api/review/open';
const SHARED_AT_HEADER = 'x-ccrc-review-shared-at';

const FAILURE = 'This link has expired, was revoked, or never existed.';
const NO_TOKEN = 'To open this draft again, use the link you were sent.';

/** The `https:` link targets of the copy's bytes, each once by its `URL.href`, in document order. The parse is inert:
 *  scripts do not run and nothing loads. A relative value, `javascript:`, `data:` and `http:` are never listed. */
function httpsLinks(text: string): string[] {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of doc.querySelectorAll('a[href], area[href]')) {
    const value = el.getAttribute('href');
    if (value === null) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || seen.has(url.href)) continue;
    seen.add(url.href);
    out.push(url.href);
  }
  return out;
}

/** The shared-at header as milliseconds since the epoch; null when it is absent, empty or not a finite number. */
function sharedAtOf(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const ms = Number(header);
  return Number.isFinite(ms) ? ms : null;
}

/** Start the page on `win`: a no-op when the page's root element is not there. */
export function startReviewPage(win: Window): void {
  const doc = win.document;
  const root = doc.getElementById(ROOT_ID);
  if (root === null) return;

  // 1. The token leaves the address bar before anything else runs.
  let token: string | null = win.location.hash.replace(/^#/, '');
  win.history.replaceState(null, '', PAGE_PATH);

  const say = (sentence: string): void => {
    const p = doc.createElement('p');
    p.className = 'review-message';
    p.setAttribute('role', 'status');
    p.textContent = sentence;
    root.replaceChildren(p);
  };
  const fail = (): void => {
    token = null;
    say(FAILURE);
  };

  // 2. No fragment: nothing to open, nothing to ask.
  if (token === '') {
    token = null;
    say(NO_TOKEN);
    return;
  }

  /** Draws the banner, the links (when the copy has any) and the frame in one step, so a throw draws none of them. */
  const draw = (text: string, sharedAt: number): void => {
    const banner = doc.createElement('p');
    banner.className = 'review-banner';
    banner.textContent = `Draft, not committed. Shared for review on ${reviewDate(sharedAt)}. Read-only.`;
    const parts: HTMLElement[] = [banner];

    const links = httpsLinks(text);
    if (links.length > 0) {
      const section = doc.createElement('section');
      section.className = 'review-links';
      const heading = doc.createElement('h2');
      heading.textContent = 'Links in this copy';
      const list = doc.createElement('ul');
      for (const href of links) {
        const a = doc.createElement('a');
        a.setAttribute('href', href);
        a.setAttribute('rel', 'noreferrer noopener');
        a.setAttribute('target', '_blank');
        a.textContent = href;
        const item = doc.createElement('li');
        item.append(a);
        list.append(item);
      }
      section.append(heading, list);
      parts.push(section);
    }

    // The sandbox is set before the bytes and before the frame is attached: the strictest value, so the copy runs no
    // script, submits no form and opens no popup.
    const frame = doc.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.srcdoc = text;
    frame.setAttribute('title', 'Draft copy');
    frame.className = 'review-frame';
    parts.push(frame);

    root.replaceChildren(...parts);
  };

  // 4. Only the tap posts.
  const open = async (): Promise<void> => {
    const t = token;
    if (t === null || !isReviewToken(t)) {
      fail();
      return;
    }
    try {
      const res = await win.fetch(OPEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [REVIEW_MARKER_HEADER]: REVIEW_MARKER_VALUE },
        body: JSON.stringify({ token: t }),
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      const sharedAt = sharedAtOf(res.headers.get(SHARED_AT_HEADER));
      if (res.status !== 200 || sharedAt === null) {
        fail();
        return;
      }
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await res.arrayBuffer());
      draw(text, sharedAt);
      token = null;
    } catch {
      fail();
    }
  };

  // 3. One control.
  const button = doc.createElement('button');
  button.type = 'button';
  button.textContent = 'Open draft';
  let tapped = false;
  button.addEventListener('click', () => {
    if (tapped) return;
    tapped = true;
    button.disabled = true;
    void open();
  });
  const actions = doc.createElement('p');
  actions.className = 'review-actions';
  actions.append(button);
  root.replaceChildren(actions);
}

if (typeof document !== 'undefined' && document.getElementById(ROOT_ID) !== null) startReviewPage(window);
