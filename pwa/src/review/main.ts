// The draft review page's entry (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5).
//
// Ring: L4, an entry that owns the DOM and one network call and decides nothing beyond what the page's words say. It
// imports only L0 (`shared/docsReview.ts`: the marker header, the token grammar and the date formatter), its own
// stylesheet and `./labFixture` (a generated data module: lab mode's two copies as string constants). No React and no app shell: the page is a fixed document served at `/review` under its own header policy
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
//
// Lab mode (X3 R2.3, the measurement row M-X3.16): a fragment of exactly `lab` is the measurement page, not a token. It is
// cleared like any fragment, then the page makes NO request of any kind (no `fetch`, no XHR, no beacon, no dynamic
// `import()`, no URL that is not `data:`), mounts the two committed copies of `./labFixture` (a static import: Export's own
// bytes plus one canary script each) through the same frame code the copy path uses, and draws six lines, each with a
// reference the page itself draws, which the operator answers by comparing a frame with it. A line reads "Not measured"
// until answered, and the script and link lines are held until both load markers (`inline-style`, `nested-frame`) read
// "Drew": a frame that did not load must never read as a pass. The result is one `<pre>` the operator selects and copies by
// hand: no clipboard write, no storage. The page adds no message listener here either, and never reads a frame's DOM.
import {
  REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_SHARED_AT_HEADER, isReviewToken, reviewDate,
} from '../../../shared/docsReview';
import { LAB_MARKDOWN_COPY, LAB_MOCKUP_COPY } from './labFixture';
import './review.css';

const ROOT_ID = 'review-root';
const PAGE_PATH = '/review';
const OPEN_URL = '/api/review/open';

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

/** One copy's frame, for the copy path and for lab mode alike: the strictest sandbox, set before the bytes and before the
 *  frame is attached, so the copy runs no script, submits no form and opens no popup. */
function copyFrame(doc: Document, text: string, title: string): HTMLIFrameElement {
  const frame = doc.createElement('iframe');
  frame.setAttribute('sandbox', '');
  frame.srcdoc = text;
  frame.setAttribute('title', title);
  frame.className = 'review-frame';
  return frame;
}

// ---- lab mode: the pure half ---------------------------------------------------------------------------------------------

/** The reference colours the page draws beside its lines, each the colour the fixture draws: the copy's page ground
 *  (`--bg-page` of Export's dark default), the Markdown copy's picture, and the mockup's swatch. `review-lab-fixture.test.tsx`
 *  holds each to the fixture's own bytes. */
export const LAB_GROUND = '#0b0d0c';
export const LAB_IMAGE_COLOUR = '#c2185b';
export const LAB_SWATCH_COLOUR = '#1f7a4d';

/** The six checks, in the order the page draws them and the result block lists them. The keys never change meaning. */
export const LAB_KEYS = ['inline-style', 'data-image', 'data-font', 'nested-frame', 'script-off', 'link-inert'] as const;
export type LabKey = (typeof LAB_KEYS)[number];
/** The two load markers: the lines that say a frame drew at all. */
const LAB_MARKERS = ['inline-style', 'nested-frame'] as const satisfies readonly LabKey[];
/** The lines held until both load markers read "Drew". */
const LAB_HELD = ['script-off', 'link-inert'] as const satisfies readonly LabKey[];
type LabHeldKey = (typeof LAB_HELD)[number];

type LabAnswerOf<K extends LabKey> = K extends LabHeldKey ? 'unchanged' | 'changed' | 'cannot-tell' : 'drew' | 'did-not-draw' | 'cannot-tell';
/** What the operator answered, by line; a line with no entry is not answered. */
export type LabAnswers = { [K in LabKey]?: LabAnswerOf<K> };
type LabAnswer = NonNullable<LabAnswers[LabKey]>;

const isHeldKey = (key: LabKey): key is LabHeldKey => (LAB_HELD as readonly LabKey[]).includes(key);

/** Both load markers read "Drew": the frames loaded, so the held lines can be taken. */
const loadMarkersDrew = (a: LabAnswers): boolean => LAB_MARKERS.every((k) => a[k] === 'drew');

/** A held line that is answered but not yet taken. */
const isHeld = (key: LabKey, a: LabAnswers): boolean => isHeldKey(key) && a[key] !== undefined && !loadMarkersDrew(a);

/** The word each line holds in the result block: its answer, or `not-measured` (unanswered, or held). */
export function labWordsOf(a: LabAnswers): Record<LabKey, LabAnswer | 'not-measured'> {
  const word = (k: LabKey): LabAnswer | 'not-measured' => (isHeld(k, a) ? 'not-measured' : a[k] ?? 'not-measured');
  return {
    'inline-style': word('inline-style'), 'data-image': word('data-image'), 'data-font': word('data-font'),
    'nested-frame': word('nested-frame'), 'script-off': word('script-off'), 'link-inert': word('link-inert'),
  };
}

export type LabEngine = 'Chromium' | 'WebKit' | 'Firefox' | 'unknown';
export type LabOsClass = 'phone' | 'tablet' | 'desktop';

/** The engine, from the user agent: any iPhone, iPad or iPod is WebKit (whatever browser it names), and so is an iPad that
 *  reports a Mac (a Mac with more than one touch point). */
export function labEngineOf(userAgent: string, touchPoints: number): LabEngine {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'WebKit';
  if (/Macintosh/.test(userAgent) && touchPoints > 1) return 'WebKit';
  if (/Firefox\//.test(userAgent)) return 'Firefox';
  if (/Chrome\/|Chromium\/|Edg\//.test(userAgent)) return 'Chromium';
  if (/AppleWebKit/.test(userAgent) && /Safari\//.test(userAgent)) return 'WebKit';
  return 'unknown';
}

/** The device class: an iPhone or iPod, or an Android with the `Mobile` token, is a phone; an iPad (or a Mac with touch) or
 *  an Android without it, a tablet; anything else, a desktop. */
export function labOsClassOf(userAgent: string, touchPoints: number): LabOsClass {
  if (/iPhone|iPod/.test(userAgent)) return 'phone';
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return 'tablet';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'phone' : 'tablet';
  return 'desktop';
}

/** The copyable result block: one header line, then one `key: word` line per check, in `LAB_KEYS` order. */
export function labResultText(engine: LabEngine, osClass: LabOsClass, answers: LabAnswers): string {
  const words = labWordsOf(answers);
  return [`review-lab 1 · ${engine} · ${osClass}`, ...LAB_KEYS.map((k) => `${k}: ${words[k]}`)].join('\n');
}

// ---- lab mode: the page ----------------------------------------------------------------------------------------------------

const ANSWER_LABEL: Readonly<Record<LabAnswer | 'not-measured', string>> = {
  drew: 'Drew', 'did-not-draw': 'Did not draw', 'cannot-tell': 'Cannot tell', unchanged: 'Unchanged', changed: 'Changed',
  'not-measured': 'Not measured',
};
const DRAW_ANSWERS: readonly LabAnswer[] = ['drew', 'did-not-draw', 'cannot-tell'];
const CHANGE_ANSWERS: readonly LabAnswer[] = ['unchanged', 'changed', 'cannot-tell'];

/** The reference text the mockup's line is set in: the fixture's `.lab-text`. */
const LAB_SAMPLE_TEXT = 'Review lab sample 0123 Hamburgefonstiv';
/** The page's own name for the fixture font, so its reference sample never meets the mockup's face of another name. */
const LAB_REFERENCE_FACE = 'ReviewLabRef';

interface LabLine {
  readonly key: LabKey;
  readonly title: string;
  /** What an unchanged frame looks like, in words. */
  readonly look: string;
  /** The reference swatches drawn beside the words, as `[colour, class]`. */
  readonly swatches: readonly (readonly [string, string])[];
  readonly sample: boolean;
}

const LAB_LINES: readonly LabLine[] = [
  {
    key: 'inline-style', title: 'Inline style: the Markdown copy’s own stylesheet draws.', sample: false,
    swatches: [[LAB_GROUND, 'review-lab-swatch']],
    look: 'Export’s page ground, the whole background of the Markdown copy behind its text, is this dark colour. An unstyled frame is white with black text.',
  },
  {
    key: 'data-image', title: 'Data image: the Markdown copy’s picture draws.', sample: false,
    swatches: [[LAB_IMAGE_COLOUR, 'review-lab-swatch']],
    look: 'Below the paragraph the copy shows one solid block of this colour, 64 by 16 pixels. A broken-picture mark or an empty gap is "Did not draw".',
  },
  {
    key: 'data-font', title: 'Data font: the mockup copy’s inner frame sets its line of text in the fixture font.', sample: true,
    swatches: [],
    look: 'The mockup’s line reads exactly this text, in this face. Serif letters mean its font did not draw.',
  },
  {
    key: 'nested-frame', title: 'Nested frame: the mockup copy’s inner frame draws its swatch.', sample: false,
    swatches: [[LAB_SWATCH_COLOUR, 'review-lab-swatch review-lab-swatch-wide']],
    look: 'Inside the mockup copy, in its own frame, one solid block of this colour, 120 by 24 pixels, sits above the line of text.',
  },
  {
    key: 'script-off', title: 'Script off: the canary script ran in neither copy.', sample: false,
    swatches: [[LAB_GROUND, 'review-lab-swatch'], [LAB_SWATCH_COLOUR, 'review-lab-swatch review-lab-swatch-wide']],
    look: 'After both frames drew, the Markdown copy’s page ground and the mockup’s swatch keep the colours of these blocks. Red anywhere is "Changed". Answer after inline-style and nested-frame read Drew.',
  },
  {
    key: 'link-inert', title: 'Link inert: a tap on a copy’s link changes nothing.', sample: false,
    swatches: [],
    look: 'Tap "a link" in the Markdown copy, then both links in the mockup copy: "a link" in its inner frame and the address in its list of links. Each frame must still show its copy as before: no blank page, no error page, no other site. Anything else is "Changed". Answer after inline-style and nested-frame read Drew.',
  },
];

/** The fixture font's `data:` URL, read out of the mockup copy: Export inlines the stylesheet as one `data:text/css` link and
 *  the font as a `data:` URL inside that sheet, so the sheet is decoded once. `null` when the copy holds none. */
function fontDataUrlOf(copy: string): string | null {
  const sheet = /data:text\/css;base64,([A-Za-z0-9+/=]+)/.exec(copy)?.[1];
  if (sheet === undefined) return null;
  try {
    return /data:font\/woff2;base64,[A-Za-z0-9+/=]+/.exec(atob(sheet))?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Starts lab mode on `root`: no request of any kind, so nothing here reads the network. */
function startLab(win: Window, doc: Document, root: HTMLElement): void {
  const touch = Number(win.navigator.maxTouchPoints) || 0;
  const engine = labEngineOf(win.navigator.userAgent, touch);
  const osClass = labOsClassOf(win.navigator.userAgent, touch);
  let answers: LabAnswers = {};

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const title = el('h1', 'review-lab-title', 'Draft review frame measurement (M-X3.16)');
  const intro = el('p', 'review-lab-intro',
    'Compare each frame below with the reference beside its line, then answer the line with one of its three buttons. A line reads Not measured until you answer it. Then select the result block and copy it by hand.');

  const copies = el('div', 'review-lab-copies');
  for (const [name, caption, text, frameTitle] of [
    ['markdown', 'Markdown copy', LAB_MARKDOWN_COPY, 'Draft copy (Markdown)'],
    ['mockup', 'Mockup copy', LAB_MOCKUP_COPY, 'Draft copy (mockup)'],
  ] as const) {
    const figure = el('figure', 'review-lab-copy');
    figure.setAttribute('data-copy', name);
    const frame = copyFrame(doc, text, frameTitle);
    frame.classList.add('review-lab-frame');
    figure.append(el('figcaption', 'review-lab-caption', caption), frame);
    copies.append(figure);
  }

  // The page's own copy of the fixture face, from the `data:` URL the mockup copy carries, so the sample below can show
  // what "in this face" looks like. Its `url()` is a `data:` URL, which the page's policy allows.
  const fontUrl = fontDataUrlOf(LAB_MOCKUP_COPY);
  const face = el('style', 'review-lab-face');
  if (fontUrl !== null) face.textContent = `@font-face{font-family:${LAB_REFERENCE_FACE};src:url(${fontUrl}) format('woff2');}`;

  const result = el('pre', 'review-lab-result');
  const lines = el('ol', 'review-lab-lines');
  const redraws: (() => void)[] = [];

  for (const line of LAB_LINES) {
    const item = el('li', 'review-lab-row');
    item.setAttribute('data-key', line.key);
    const heading = el('p', 'review-lab-line');
    heading.append(el('code', 'review-lab-key', line.key), doc.createTextNode(` ${line.title}`));
    const ref = el('div', 'review-lab-ref');
    for (const [colour, cls] of line.swatches) {
      const swatch = el('span', cls);
      swatch.style.backgroundColor = colour;
      ref.append(swatch);
    }
    if (line.sample) {
      const sample = el('span', 'review-lab-sample', LAB_SAMPLE_TEXT);
      sample.style.fontFamily = `${LAB_REFERENCE_FACE}, serif`;
      ref.append(sample);
    }
    ref.append(el('span', 'review-lab-look', line.look));
    const status = el('span', 'review-lab-status');
    status.setAttribute('role', 'status');
    const answerButtons = el('div', 'review-lab-answers');
    const buttons = (isHeldKey(line.key) ? CHANGE_ANSWERS : DRAW_ANSWERS).map((word) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.textContent = ANSWER_LABEL[word];
      b.addEventListener('click', () => {
        answers = { ...answers, [line.key]: word };
        redraw();
      });
      return [word, b] as const;
    });
    answerButtons.append(...buttons.map(([, b]) => b));
    item.append(heading, ref, answerButtons, status);
    lines.append(item);
    redraws.push(() => {
      const said = answers[line.key];
      for (const [word, b] of buttons) b.setAttribute('aria-pressed', String(said === word));
      status.textContent = said === undefined ? ANSWER_LABEL['not-measured']
        : isHeld(line.key, answers) ? `Held (${ANSWER_LABEL[said]}): counts once inline-style and nested-frame both read Drew`
          : ANSWER_LABEL[said];
    });
  }

  const block = el('figure', 'review-lab-result-block');
  block.append(el('figcaption', 'review-lab-caption', 'Result: select this block and copy it into the answer.'), result);

  const redraw = (): void => {
    for (const r of redraws) r();
    result.textContent = labResultText(engine, osClass, answers);
  };
  redraw();
  root.replaceChildren(title, intro, copies, face, lines, block);
}

/** The shared-at header as milliseconds since the epoch; null when it is absent, empty or not a finite number. */
function sharedAtOf(header: string | null): number | null {
  if (header === null || header.trim() === '') return null;
  const ms = Number(header);
  return Number.isFinite(ms) ? ms : null;
}

/** Start the page on `win`. The fragment leaves the address bar first, even when the page's root element is missing
 *  (then nothing else happens). */
export function startReviewPage(win: Window): void {
  // 1. The token leaves the address bar before anything else runs.
  let token: string | null = win.location.hash.replace(/^#/, '');
  win.history.replaceState(null, '', PAGE_PATH);

  const doc = win.document;
  const root = doc.getElementById(ROOT_ID);
  if (root === null) return;

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

  // The measurement page (X3 R2.3): the fragment `lab` exactly. It makes no request, so there is no token to keep.
  if (token === 'lab') {
    token = null;
    startLab(win, doc, root);
    return;
  }

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

    parts.push(copyFrame(doc, text, 'Draft copy'));

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
      const sharedAt = sharedAtOf(res.headers.get(REVIEW_SHARED_AT_HEADER));
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

if (typeof document !== 'undefined' && window.location.pathname === PAGE_PATH) startReviewPage(window);
