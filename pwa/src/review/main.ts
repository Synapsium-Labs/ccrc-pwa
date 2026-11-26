// The draft review page's entry (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5).
//
// Ring: L4, an entry that owns the DOM and one network call and decides nothing beyond what the page's words say. It
// imports only L0 (`shared/docsReview.ts`: the marker header, the token grammar and the date formatter), its own
// stylesheet, `../../generated/reviewLabFixture` (a generated data module outside the authored source tree: lab mode's two
// copies and the page ground as string constants) and `../readerLab/device`
// (D-9028: `deviceOf`, the reader lab's one owner of the engine and OS class, pure and importing nothing, so the page keeps
// no user-agent parser of its own). No React and no app shell: the page is a fixed document served at `/review` under its own header policy
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
//   5. A copy that leaves its frame (a link with no `target` makes Chromium navigate the frame to its error page) is put
//      back by the page itself, with one sentence beside it, at most three times within any ten seconds (a fourth inside
//      that window stops it for good), so spaced taps are restored every time; a restore draws the copy afresh, at its top
//      (D-9029; see `copyFrame`).
// The page adds no message listener, calls no `postMessage`, and never reads the frame's DOM: the one event it hears from a
// frame is the frame element's own `load`.
//
// Lab mode (X3 R2.3, the measurement row M-X3.16): a fragment of exactly `lab` is the measurement page, not a token. It is
// cleared like any fragment, then the page makes NO request of any kind (no `fetch`, no XHR, no beacon, no dynamic
// `import()`, no URL that is not `data:`), mounts the two committed copies of `../../generated/reviewLabFixture` (a static import: Export's own
// bytes plus one canary script each) through the same frame code the copy path uses (each frame restores its own copy, D-9029, each frame's own bound of three restores within ten seconds), and draws seven lines, each with a
// reference the page itself draws, which the operator answers by comparing a frame with it. A line reads "Not measured"
// until answered, and the script and link lines' "Unchanged" is held until both load markers (`inline-style`,
// `nested-frame`) read "Drew" (a frame that did not load shows no block either, so it must never read as a pass; a
// "Changed" or "Cannot tell" is never held). The canary of each copy appends its own red block reading SCRIPT RAN and
// leaves every element a load marker reads alone, so a script that ran can be recorded as the failure it is. The result
// is one `<pre>` the operator selects and copies by hand: no clipboard write, no storage. The page adds no message
// listener here either, and never reads a frame's DOM.
import {
  REVIEW_MARKER_HEADER, REVIEW_MARKER_VALUE, REVIEW_SHARED_AT_HEADER, isReviewToken, reviewDate,
} from '../../../shared/docsReview';
import { deviceOf, type LabFeatures } from '../readerLab/device';
import { LAB_GROUND, LAB_MARKDOWN_COPY, LAB_MOCKUP_COPY } from '../../generated/reviewLabFixture';
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

/** At most this many restores of one frame within any `RESTORE_WINDOW_MS` (D-9029). A fourth navigation inside the window
 *  stops the page redrawing that frame for good. Taps spaced further apart than the window are restored every time. */
export const MAX_RESTORES = 3;
export const RESTORE_WINDOW_MS = 10_000;
/** The one sentence beside a restored copy, by whether the page lists the copy's links above it. */
export const RESTORED_WITH_LINKS = 'That link opens outside this page. Use the links listed above.';
export const RESTORED_NO_LINKS = 'That link cannot open from this page.';
/** The one sentence once the bound is reached: the page redraws no more and leaves the frame as it is. */
export const RESTORE_STOPPED = 'This copy kept leaving its frame, so it is no longer redrawn. Open the link you were sent to read it again.';

/** One copy's frame, for the copy path and for lab mode alike: the strictest sandbox, set before the bytes and before the
 *  frame is attached, so the copy runs no script, submits no form and opens no popup.
 *
 *  A link with no `target` inside the copy is blocked from leaving (no request, the top page stays), but Chromium navigates the
 *  FRAME to its error page, so the copy is gone (D-9029, measured). The page therefore restores its own copy: when the
 *  frame element fires a `load` that this code did not cause, it sets the same `srcdoc` again (the sandbox is untouched) and
 *  shows one sentence beside the frame. The bound is a rate: at most `MAX_RESTORES` restores within any `RESTORE_WINDOW_MS`
 *  of the injected clock `now` (a past restore counts while `now() - past < RESTORE_WINDOW_MS`). A copy that drives its own
 *  frame quickly is stopped after three restores in ten seconds: the page then says so, leaves the frame alone, and the stop
 *  is final for that frame (no restore ever again, even once the window has passed). Taps that never put a fourth navigation
 *  within ten seconds of the third-last restore (on average more than about 3.4 seconds apart) are restored every time. A
 *  restore draws the copy afresh, so it opens at its top.
 *
 *  Named residual (D-9029): a navigation that starts before a draw's own `load` (the first draw or a restore) has its load
 *  taken as that draw's, so the copy can be lost with no stop sentence. The page cannot tell the two apart without reading the
 *  frame, which it never does.
 *
 *  Own draws against a navigation, with no guessing: `expected` counts the draws this code made whose `load` has not yet
 *  arrived. Each draw (the first and each restore) adds one before it sets `srcdoc`; a `load` finding the count above zero
 *  is that draw's own and is consumed, and only a `load` finding it at zero is a navigation. A restore is a draw, so it
 *  expects its own `load` and never causes another restore. The restore keeps nothing: it reads no document of the frame,
 *  makes no request, adds no message channel and writes no storage, history or cookie, and it is not a view. The only
 *  event it hears is the frame element's own `load`. `data-restores` on the frame says how many it has made. */
function copyFrame(doc: Document, text: string, title: string, linksListed: boolean, now: () => number): HTMLIFrameElement {
  const frame = doc.createElement('iframe');
  let expected = 0;
  let restores = 0;
  let stopped = false;
  const restoredAt: number[] = [];
  let note: HTMLElement | null = null;
  const draw = (): void => {
    expected += 1;
    frame.srcdoc = text;
  };
  const say = (sentence: string): void => {
    if (note === null && frame.parentNode !== null) {
      note = doc.createElement('p');
      note.className = 'review-restore-note';
      note.setAttribute('role', 'status');
      frame.after(note);
    }
    if (note !== null) note.textContent = sentence;
  };
  frame.setAttribute('sandbox', '');
  draw();
  frame.setAttribute('title', title);
  frame.className = 'review-frame';
  frame.setAttribute('data-restores', '0');
  frame.addEventListener('load', () => {
    if (expected > 0) {
      expected -= 1;
      return;
    }
    const t = now();
    if (!stopped && restoredAt.filter((past) => t - past < RESTORE_WINDOW_MS).length >= MAX_RESTORES) stopped = true;
    if (stopped) {
      say(RESTORE_STOPPED);
      return;
    }
    restoredAt.push(t);
    restores += 1;
    frame.setAttribute('data-restores', String(restores));
    say(linksListed ? RESTORED_WITH_LINKS : RESTORED_NO_LINKS);
    draw();
  });
  return frame;
}

// ---- lab mode: the pure half ---------------------------------------------------------------------------------------------

/** The reference colours the page draws beside its lines, each the colour the fixture draws: the copy's page ground
 *  (`--bg-page` of Export's dark default; a console token colour, so it is generated from Export's own bytes into the
 *  fixture module and re-exported here, never typed in this file), the Markdown copy's picture, and the mockup's swatch.
 *  `review-lab-fixture.test.tsx` holds each to the fixture's own bytes. */
export { LAB_GROUND };
export const LAB_IMAGE_COLOUR = '#c2185b';
export const LAB_SWATCH_COLOUR = '#1f7a4d';

/** The seven checks, in the order the page draws them and the result block lists them. The keys never change meaning
 *  (`link-self` joined `link-inert` in D-9029, and `link-inert` kept its own: a tap on the `_blank` link). */
export const LAB_KEYS = ['inline-style', 'data-image', 'data-font', 'nested-frame', 'script-off', 'link-inert', 'link-self'] as const;
export type LabKey = (typeof LAB_KEYS)[number];
/** The two load markers: the lines that say a frame drew at all. */
const LAB_MARKERS = ['inline-style', 'nested-frame'] as const satisfies readonly LabKey[];
/** The lines whose passing answer is held until both load markers read "Drew". */
const LAB_HELD = ['script-off', 'link-inert', 'link-self'] as const satisfies readonly LabKey[];
type LabHeldKey = (typeof LAB_HELD)[number];

type LabAnswerOf<K extends LabKey> = K extends 'link-self' ? 'kept' | 'restored' | 'gone' | 'cannot-tell'
  : K extends LabHeldKey ? 'unchanged' | 'changed' | 'cannot-tell'
    : 'drew' | 'did-not-draw' | 'cannot-tell';
/** What the operator answered, by line; a line with no entry is not answered. */
export type LabAnswers = { [K in LabKey]?: LabAnswerOf<K> };
type LabAnswer = NonNullable<LabAnswers[LabKey]>;

const isHeldKey = (key: LabKey): key is LabHeldKey => (LAB_HELD as readonly LabKey[]).includes(key);

/** Both load markers read "Drew": the frames loaded, so the held lines can be taken. */
const loadMarkersDrew = (a: LabAnswers): boolean => LAB_MARKERS.every((k) => a[k] === 'drew');

/** The answers of a held line that count as a pass, and so wait for the load markers: `link-self` passes with the copy kept
 *  or restored, the other two with "Unchanged". */
const PASSING: { readonly [K in LabHeldKey]: readonly LabAnswerOf<K>[] } = {
  'script-off': ['unchanged'], 'link-inert': ['unchanged'], 'link-self': ['kept', 'restored'],
};

/** A held line whose passing answer is not yet taken. Only a pass waits: a frame that did not load shows no red block
 *  either, so "nothing changed" proves nothing until both frames drew. Any other answer ("Changed", "Copy gone", "Cannot tell")
 *  is taken as answered, whatever the markers read, so a canary that ran (and the load markers with it) is still recorded as
 *  the failure it is. */
const isHeld = (key: LabKey, a: LabAnswers): boolean => {
  const said: string | undefined = a[key];
  if (!isHeldKey(key) || said === undefined) return false;
  const passing: readonly string[] = PASSING[key];
  return passing.includes(said) && !loadMarkersDrew(a);
};

/** The word each line holds in the result block: its answer, or `not-measured` (unanswered, or held). */
export function labWordsOf(a: LabAnswers): Record<LabKey, LabAnswer | 'not-measured'> {
  const word = (k: LabKey): LabAnswer | 'not-measured' => (isHeld(k, a) ? 'not-measured' : a[k] ?? 'not-measured');
  return {
    'inline-style': word('inline-style'), 'data-image': word('data-image'), 'data-font': word('data-font'),
    'nested-frame': word('nested-frame'), 'script-off': word('script-off'), 'link-inert': word('link-inert'),
    'link-self': word('link-self'),
  };
}

export type LabEngine = 'Chromium' | 'WebKit' | 'Firefox' | 'unknown';

/** The engine word of M-X3.16, from the engine class `deviceOf` names (`Blink 141`, `Gecko 140`, `WebKit 19`, `unknown`);
 *  the version it appends is dropped. */
export function labEngineWord(engineClass: string): LabEngine {
  switch (engineClass.split(' ')[0]) {
    case 'Blink': return 'Chromium';
    case 'Gecko': return 'Firefox';
    case 'WebKit': return 'WebKit';
    default: return 'unknown';
  }
}

/** `deviceOf` reads the user agent alone for the two facts the result block names; the feature tests it also carries are
 *  the reader lab's device line, not this page's, so they stay false here and nothing is probed. */
const NO_FEATURES: LabFeatures = { worker: false, frameSandbox: false, cspAttribute: false };

/** The engine word and the OS class of the result block's first line, both from `deviceOf` (D-9028): the OS class is its
 *  `os` (`Android`, `iOS`, `macOS`, `Windows`, `Linux` or `other`). */
export function labDeviceWords(userAgent: string): { readonly engine: LabEngine; readonly os: string } {
  const d = deviceOf(userAgent, null, NO_FEATURES);
  return { engine: labEngineWord(d.engine), os: d.os };
}

/** The copyable result block: one header line, then one `key: word` line per check, in `LAB_KEYS` order. */
export function labResultText(engine: LabEngine, os: string, answers: LabAnswers): string {
  const words = labWordsOf(answers);
  return [`review-lab 1 · ${engine} · ${os}`, ...LAB_KEYS.map((k) => `${k}: ${words[k]}`)].join('\n');
}

// ---- lab mode: the page ----------------------------------------------------------------------------------------------------

const ANSWER_LABEL: Readonly<Record<LabAnswer | 'not-measured', string>> = {
  drew: 'Drew', 'did-not-draw': 'Did not draw', 'cannot-tell': 'Cannot tell', unchanged: 'Unchanged', changed: 'Changed',
  kept: 'Copy still here', restored: 'Copy came back with the sentence', gone: 'Copy gone',
  'not-measured': 'Not measured',
};
const DRAW_ANSWERS: readonly LabAnswer[] = ['drew', 'did-not-draw', 'cannot-tell'];
const CHANGE_ANSWERS: readonly LabAnswer[] = ['unchanged', 'changed', 'cannot-tell'];
const SELF_ANSWERS: readonly LabAnswer[] = ['kept', 'restored', 'gone', 'cannot-tell'];
/** The answers each line offers, by its kind. */
const answersOf = (key: LabKey): readonly LabAnswer[] => (key === 'link-self' ? SELF_ANSWERS : isHeldKey(key) ? CHANGE_ANSWERS : DRAW_ANSWERS);

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
  /** Draws the failure reference: the pure red block the canary of a copy would add, with its words. */
  readonly failure: boolean;
}

/** The words of the canary's block, and of the page's reference for it: a copy that ran its script shows exactly these. */
const LAB_CANARY_TEXT = 'SCRIPT RAN';
/** The canary block's colour: pure red, which no other part of either copy is (the picture's own colour is a crimson). */
const LAB_FAILURE_COLOUR = '#ff0000';

const LAB_LINES: readonly LabLine[] = [
  {
    key: 'inline-style', title: 'Inline style: the Markdown copy’s own stylesheet draws.', sample: false, failure: false,
    swatches: [[LAB_GROUND, 'review-lab-swatch']],
    look: 'Export’s page ground, the whole background of the Markdown copy behind its text, is this dark colour. An unstyled frame is white with black text.',
  },
  {
    key: 'data-image', title: 'Data image: the Markdown copy’s picture draws.', sample: false, failure: false,
    swatches: [[LAB_IMAGE_COLOUR, 'review-lab-swatch']],
    look: 'Below the paragraph the copy shows one solid block of this colour, 64 by 16 pixels. A broken-picture mark or an empty gap is "Did not draw".',
  },
  {
    key: 'data-font', title: 'Data font: the mockup copy’s inner frame sets its line of text in the fixture font.', sample: true, failure: false,
    swatches: [],
    look: 'Scroll inside the mockup copy’s frame to its inner frame. The mockup’s line reads exactly this text, in this face. Serif letters mean its font did not draw.',
  },
  {
    key: 'nested-frame', title: 'Nested frame: the mockup copy’s inner frame draws its swatch.', sample: false, failure: false,
    swatches: [[LAB_SWATCH_COLOUR, 'review-lab-swatch review-lab-swatch-wide']],
    look: 'Scroll inside the mockup copy’s frame to its inner frame. In it, one solid block of this colour, 120 by 24 pixels, sits above the line of text.',
  },
  {
    key: 'script-off', title: 'Script off: the canary script ran in neither copy.', sample: false, failure: true,
    swatches: [],
    look: `Each copy shows no red block reading ${LAB_CANARY_TEXT}. A copy whose script ran adds one, pure red with white text, as drawn here: in the Markdown copy below its link, and in the mockup copy at the end of its inner frame, below the link line (scroll inside the mockup copy’s frame to its inner frame). Such a block in either copy is "Changed", and needs no other answer. Only that block counts: the copy’s dark ground, the picture’s crimson and the green swatch are not it. "Unchanged" counts once inline-style and nested-frame both read Drew, because a frame that did not load shows no block either.`,
  },
  {
    key: 'link-inert', title: 'Link inert: a tap on a copy’s link changes nothing.', sample: false, failure: false,
    swatches: [],
    look: 'There are two links to tap: "a link" in the Markdown copy, and the first address, https://example.org/review-lab, in the mockup copy’s list "Links in this page", above its inner frame (the links inside the inner frame have no address, so they cannot be tapped; the list’s other address is the next line’s). After a tap an unchanged frame still shows its copy, as before: no blank page, no error page, no other site. A link that opens a new tab is a popup the empty sandbox blocks; the frame itself must still show its copy. Anything else is "Changed". "Unchanged" counts once inline-style and nested-frame both read Drew.',
  },
  {
    key: 'link-self', title: 'Link self: a tap on a link with no target leaves the reader with the copy.', sample: false, failure: false,
    swatches: [],
    look: `Before you tap anything, look under the mockup copy’s frame: no sentence stands there. If a sentence already stands there before any tap, answer "Copy gone": the page restored the copy when it opened, which is a failure of the measurement, not a pass. Scroll inside the mockup copy’s frame to its list "Links in this page", near the end of the frame, above its inner frame, and tap its last address, page.md: a link written with no target. The tap must not open that address or move this page. Then read the mockup frame. "Copy still here": the frame shows its copy as before and nothing else. "Copy came back with the sentence": the frame went blank or showed an error page for a moment, then this page drew the copy again and a sentence reading "${RESTORED_NO_LINKS}" stands under that frame. "Copy gone": the frame stays blank or on an error page with no copy, or this page itself moved. "Copy still here" and "Copy came back with the sentence" both count once inline-style and nested-frame both read Drew; any other answer counts at once.`,
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
function startLab(win: Window, doc: Document, root: HTMLElement, now: () => number): void {
  const { engine, os } = labDeviceWords(win.navigator.userAgent);
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
    // The page lists no links beside a lab copy, so a restored copy's sentence is the one without "the links listed above".
    const frame = copyFrame(doc, text, frameTitle, false, now);
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
    if (line.failure) {
      const block = el('span', 'review-lab-failure', LAB_CANARY_TEXT);
      block.style.backgroundColor = LAB_FAILURE_COLOUR;
      ref.append(block);
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
    const buttons = answersOf(line.key).map((word) => {
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
        : isHeld(line.key, answers) ? `Held (${ANSWER_LABEL[said]}): counts once inline-style and nested-frame both read Drew; any other answer counts at once`
          : ANSWER_LABEL[said];
    });
  }

  const block = el('figure', 'review-lab-result-block');
  block.append(el('figcaption', 'review-lab-caption', 'Result: select this block and copy it into the answer.'), result);

  const redraw = (): void => {
    for (const r of redraws) r();
    result.textContent = labResultText(engine, os, answers);
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
 *  (then nothing else happens). `now` is the clock the restore bound reads (milliseconds); a test injects its own, and the
 *  page uses its window's `performance.now()`. */
export function startReviewPage(win: Window, now: () => number = () => win.performance.now()): void {
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
    startLab(win, doc, root, now);
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

    parts.push(copyFrame(doc, text, 'Draft copy', links.length > 0, now));

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
