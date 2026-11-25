// The reader frame's real-browser rows (native Docs reader, W8a Task 10; the 2026-10-12 spec's section 7.2: M8.B1 to
// M8.B6, and M8.1, M8.3, M8.4, M8.6, M8.8, M8.11, M8.20 on the live DOM; labs E14, E15, E16; section 4.3's worst case).
// These are claims about what Chrome DOES with the production frame: the sandbox, the two CSPs, the port, the pinned
// srcdoc order and the Mermaid draw. jsdom has no CSP, no sandbox and no srcdoc browsing context, so every row drives
// a real Chrome through `playwright-core` over the production PWA (the run's one build, `app.ts`'s `sharedDist`, `serveDist`, `openApp`)
// whose `/api/docs` answers from fixtures here. No server, no ccd, no tmux: the shell is the built bundle and nothing
// else.
//
// What the rows share:
//   - Two hooks, both Playwright init scripts. The PARENT hook (the page's realm) records every iframe the reader
//     mounts (attributes, srcdoc, whether it held focus when it was inserted), wraps `HTMLIFrameElement.prototype
//     .contentWindow` so every `postMessage` to the frame is counted (target, payload, port; not for a row that asks
//     for the frame's window bare, `bareContentWindow`, since the wrapper is never a message's source), notes when `ready`
//     arrived, and can put ops on the frame's end of the port before the frame is handed it. The FRAME hook (each
//     frame's realm) captures the `MessagePort` the frame is handed, so a row can speak on the frame's own port once
//     it is up. Measured (12 loads): the init script reaches a srcdoc frame BEFORE its scripts in some loads and
//     after them in others, so no row relies on the frame hook speaking ahead of the bootstrap. CDP-injected scripts
//     are outside both CSPs.
//   - The battery: 27 channels aimed at origins A and B (`harness.ts`), run in the frame through Playwright's frame
//     evaluation. A channel counts as REACHED when an origin logs a request for its path. The same battery against a
//     hand-built frame with no CSP is the control that proves it can reach them.
//   - Every wall has a control that goes the other way, run in the same Chrome (B3's is a same-origin frame in which
//     every store works, and a planted frame error that the error listener sees). The mutation rows for this file
//     are planted in the installed library's `dist` (W8A-T10-M1 to M9) and recorded in the SDD ledger.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/reader-frame.browser.test.ts )`, through `ccrc test`.
//
// Every session opens its leaf inside the console, as a console tab's reload does (`AppView.tab`): since desktop polish wave
// 174 a Docs address loaded first in a fresh tab is a Docs tab, the reader alone (`isDocsTab`). A Docs tab's own cases
// (`SessionOptions.tab`) hold it to the same: the reader fills its pane and only the frame scrolls, and the mount yields
// focus to a host control the reader of the page holds (fix round 3).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame, type Page, type Route } from 'playwright-core';
import { INSTRUMENT, REFINED } from '@ccrc/ui';
import { FRAME_MANIFEST, frameCsp } from '@synapsium-labs/docserver/frame';
import {
  DOC_SECTION_SLUGS, DOCS_MAX_IMAGES_PER_PAGE, DOCS_RASTER_TYPES, DOCS_REQUEST_HEADER, DOCS_REQUEST_HEADER_VALUE, DOCS_RESPONSE_HEADERS, sniffRaster,
} from '../../shared/docs';
import { DOCS_HEAD_TEXT } from '../src/docs/docsText';
import { READER_E17_MERMAID, docsDrawFor } from '../src/docs/reader/policy';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { LAB_BATTERY_CHANNELS } from '../../shared/readerLab';
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from '../src/readerLab/battery';
import { READER_IMAGE_REF_MAX_UNITS } from '../src/docs/reader/images';
import { READER_IMAGE_BUDGET_BYTES, READER_STORE_PREFIX } from '../src/lib/readerLimits';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { onePixelPng, resolveChrome, startOrigins, type OriginAnswer, type OriginRoute, type Origins } from './harness';

// ---- fixture documents (project `demo`, section `specs`) ------------------------------------------------------------

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
/** Built, never typed: an ESC, a line separator, and a script close that would end the seed's element if it were raw. */
const ESC = String.fromCharCode(27);
const LS = String.fromCharCode(0x2028);
const SCRIPT_CLOSE = '</' + 'script><' + 'script>';
const HOSTILE_PAYLOAD = 'ccrc-hostile-payload';
const HOSTILE_FILL = 'rgb(255, 0, 255)';
const COOKIE = { name: 'ccrc_session', value: 'demo-session' } as const;

/** The directory counts of the deep leaves the mount-focus rows open (docs-compact-head's `DEEPER_CASES`): five directories are
 *  nine crumbs unfolded and seven are eleven, wider than the head's row at 600 and 900. */
const DEEP_DIRS = [5, 7] as const;
const deepPath = (dirs: number): string => [...Array.from({ length: dirs }, (_, i) => `dir-${String.fromCharCode(97 + i)}`), 'deep.md'].join('/');

const fence = (body: string): string => '```mermaid\n' + body + '\n```\n\n';

/** Built, never typed (the hidden-character set is the library's: U+202E is a bidirectional override, U+200B a zero-width space). */
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
/** The block hidden.md's copy tap writes. */
const HIDDEN_BLOCK = `copy ${RLO}me${ZWSP} here`;
/** The heading the same-page and stray-hash rows aim at, far below the fold (its slug is its id). */
const FAR_ID = 'far-target';
/** The footnote id the plain view gives its definition (`user-content-` + the label), for the deep-link row. */
const FOOTNOTE_ID = 'user-content-fn-1';
/** An image ref one code unit past the reader's seed limit that still names a real file: redundant `./` segments (a ref over
 *  the limit as a PATH would be refused by the planner's own path rules, and never load), then the file's name. */
const LONG_NAME = 'pixlong.png';
const LONG_REF = ((): string => {
  const rest = READER_IMAGE_REF_MAX_UNITS + 1 - LONG_NAME.length;
  if (rest % 2 !== 0) throw new Error(`a ref of ${READER_IMAGE_REF_MAX_UNITS + 1} units cannot be built from "./" segments and ${LONG_NAME}`);
  return './'.repeat(rest / 2) + LONG_NAME;
})();

const FLOWCHART = fence('flowchart LR\n  A[Start] --> B[End]');
const SEQUENCE = fence('sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi');
const GANTT = fence('gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Work\n  Build :a1, 2026-01-01, 3d');
const HOSTILE = fence(
  `%%{init: {"themeCSS": ".node rect { fill: #ff00ff !important; } /* ${HOSTILE_PAYLOAD} */", "theme": "base"}}%%\n`
  + 'flowchart LR\n  H1[Hostile] --> H2[Node]');
/** A second hostile figure: a loose security level, an `img` label and a click binding, all aimed at the origins. */
const hostileLinks = (o: Origins): string => fence(
  '%%{init: {"securityLevel": "loose", "flowchart": {"htmlLabels": true}}}%%\n'
  + `flowchart LR\n  L1["<img src='${o.a}/battery/hostile-img'>"] --> L2[Link]\n  click L2 "${o.b}/battery/hostile-click"`);

/** Figures in flow.md: a flowchart, a sequence, a gantt and two hostile ones. */
const FIGURES = 5;
/** How the Docs reader draws figures, by the recorded E17 reading (`docsDrawFor`): these rows open at 1280, where the frame is
 *  on its own bar, so the draw is the reading's. 'on-request' (arm B): a Render button per figure, a tap draws it.
 *  'after-ready' (arm A): no button, every figure draws after ready with no tap. A later flip of the reading needs no edit here. */
const DRAW = docsDrawFor(READER_E17_MERMAID);

/** The global names the installed frame bootstrap guards against clobbering: the first array literal of
 *  `assets/frame/bootstrap.js` (`var O=[...]`), read from the installed file so a library change moves the fixture. Some are
 *  natives no element id can shadow (`location`, `window`); the rest, Mermaid's and cytoscape's among them
 *  (`instance`, `next`, `update`, `processed`, `cytoscape`, `mermaidCaptureSizes`, `__mermaidProfiler`), a named
 *  access could. The seed element has no id (the bootstrap finds it by its place before its own script), so there is no
 *  seed name to plant. */
const BOOTSTRAP_GLOBALS: readonly string[] = ((): string[] => {
  const text = readFileSync(path.join(import.meta.dirname, '..', 'node_modules/@synapsium-labs/docserver/assets/frame/bootstrap.js'), 'utf8');
  const m = /var O=(\[[^\]]*\])/.exec(text);
  if (m === null) throw new Error('the installed bootstrap holds no global list in the expected place');
  const names = JSON.parse(m[1] ?? '[]') as string[];
  if (names.length < 100 || new Set(names).size !== names.length) throw new Error('the bootstrap global list is not the list this fixture reads');
  return names;
})();
/** Planted as `## <name>` headings (their slug is the name); every other global is planted as a `<!-- id:name -->`
 *  anchor, so each name is an id exactly once. */
const HEADING_GLOBALS = ['instance', 'next', 'update', 'processed', 'pred1'] as const;

function m88Doc(): string {
  for (const n of HEADING_GLOBALS) if (!BOOTSTRAP_GLOBALS.includes(n)) throw new Error(`${n} is not in the bootstrap's list`);
  const heads = HEADING_GLOBALS.map((n) => `## ${n}\n\nSection ${n}.\n\n`).join('');
  const anchors = BOOTSTRAP_GLOBALS.filter((n) => !(HEADING_GLOBALS as readonly string[]).includes(n))
    .map((n) => `<!-- id:${n} -->\nAnchored ${n}.\n\n`).join('');
  return `---\nowner: ${SCRIPT_CLOSE}${LS}fm\n---\n# Title ${SCRIPT_CLOSE}${LS}h\n\nBody ${SCRIPT_CLOSE}${LS} text, `
    + `[the other page](./other.md).\n\n${fence('flowchart LR\n  Q1[Quiet] --> Q2[Page]')}${heads}${anchors}`;
}

/** A page that links to itself by its file name with a fragment near the top, and holds the target far down. */
function selfDoc(): string {
  const filler = (n: number): string => Array.from({ length: n }, (_, i) => `A paragraph of the self-linking page, number ${i}, with enough words to fill a line or two.\n\n`).join('');
  // Three level-two headings make it a "document" to the library (the outline, the marks and the last visit are drawn for one).
  return `# Self page\n\nSee [the far target](./self.md#${FAR_ID}) or [the bare link](#${FAR_ID}).\n\n## Near part\n\n${filler(30)}`
    + `## Middle part\n\n${filler(30)}## Far target\n\nThe far target.\n\n${filler(40)}## Last part\n\n${filler(40)}`;
}

/** A PNG of exactly `size` bytes: a real 1x1 image with a `tEXt` chunk padding it out (it decodes as any PNG does). */
function paddedPng(size: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([head, typed, crc]);
  };
  const base = onePixelPng(); // signature, IHDR, IDAT, IEND
  const iend = 12;
  const cut = base.length - iend;
  const padData = size - base.length - 12;
  if (padData < 0) throw new Error(`a PNG of ${size} bytes cannot hold the 1x1 base`);
  const text = Buffer.alloc(padData, 0x20);
  text.write('Comment\0', 0, 'latin1');
  const out = Buffer.concat([base.subarray(0, cut), chunk('tEXt', text), base.subarray(cut)]);
  if (out.length !== size) throw new Error(`padded PNG is ${out.length} bytes, wanted ${size}`);
  return Uint8Array.from(out);
}

/** The worst-case document: exactly the render gate's 512 KiB, 30 images, a passing Mermaid gate, many elements. */
const WORST_BYTES = 524288;
function worstDoc(): string {
  const head: string[] = ['# Worst case\n\n'];
  for (let i = 0; i < DOCS_MAX_IMAGES_PER_PAGE; i += 1) head.push(`![pixel ${i}](pix-${String(i).padStart(2, '0')}.png)\n\n`);
  for (let i = 0; i < 6; i += 1) head.push(fence(`flowchart LR\n  W${i}[Start] --> X${i}[End]`));
  const section = (n: number): string => `## Section ${n}\n\nThe reader frame holds a page of \`code ${n}\`, **bold text ${n}**, `
    + `_emphasis ${n}_ and [a link ${n}](./other.md) in a paragraph that runs on for some while so the page has weight.\n\n`
    + `- item one ${n}\n- item two ${n}\n- item three ${n}\n\n| head a | head b |\n| --- | --- |\n| cell ${n} | cell ${n} |\n\n`;
  const bytes = (s: string): number => Buffer.byteLength(s, 'utf8');
  let text = head.join('');
  let n = 0;
  while (bytes(text) + bytes(section(n)) < WORST_BYTES - 64) {
    text += section(n);
    n += 1;
  }
  return text + 'x'.repeat(WORST_BYTES - bytes(text));
}

type Body = string | Uint8Array;

/** Every file the fixture serves, keyed by section-relative path. Built after the origins start (some hold their URLs). */
function fixtureFiles(o: Origins): Map<string, Body> {
  const files = new Map<string, Body>();
  files.set('small.md', `# Small page\n\nRead [the other page](./other.md), the [external link](https://a.example/p) and the `
    + `[popup link](${o.a}/popup).\n\n![pixel](pix.png)\n\n\`\`\`text\ncopy me ${ESC} here\n\`\`\`\n`);
  files.set('other.md', '# Other page\n\nSecond.\n');
  for (const dirs of DEEP_DIRS) files.set(deepPath(dirs), `# Deep page\n\nA leaf under ${dirs} directories.\n\n${'A paragraph of the deep page.\n\n'.repeat(12)}`);
  files.set('hidden.md', `# Hidden characters\n\nA block whose text holds two hidden characters.\n\n\`\`\`text\n${HIDDEN_BLOCK}\n\`\`\`\n`);
  files.set('self.md', selfDoc());
  files.set('fn.md', `# Footnote page\n\nThe note is far below.[^1]\n\n${'A paragraph above the note, long enough to push it past the fold.\n\n'.repeat(80)}[^1]: The note.\n`);
  files.set('imgs.md', `# Two images\n\n![long image](${LONG_REF})\n\n![ordinary image](pix.png)\n`);
  files.set('fig.md', `# One figure\n\nA page with a single Mermaid fence.\n\n${FLOWCHART}`);
  let long = '# Long page\n\n';
  for (let i = 0; i < 120; i += 1) long += `## Part ${i}\n\nA paragraph of the long page, number ${i}, with enough words to fill a line or two of the frame.\n\n`;
  files.set('long.md', long);
  files.set('flow.md', `# Flow page\n\n[the other page](./other.md)\n\n${FLOWCHART}${SEQUENCE}${GANTT}${HOSTILE}${hostileLinks(o)}`);
  let many = '# Many figures\n\n';
  for (let i = 0; i < 25; i += 1) many += fence(`flowchart LR\n  M${i} --> N${i}`);
  files.set('many.md', many);
  files.set('m88.md', m88Doc());
  files.set('worst.md', worstDoc());
  files.set('pix.png', onePixelPng());
  files.set(LONG_NAME, onePixelPng());
  const each = Math.floor(READER_IMAGE_BUDGET_BYTES / DOCS_MAX_IMAGES_PER_PAGE);
  const extra = READER_IMAGE_BUDGET_BYTES - each * DOCS_MAX_IMAGES_PER_PAGE;
  for (let i = 0; i < DOCS_MAX_IMAGES_PER_PAGE; i += 1) {
    files.set(`pix-${String(i).padStart(2, '0')}.png`, paddedPng(each + (i < extra ? 1 : 0)));
  }
  return files;
}

const sizeOf = (b: Body): number => (typeof b === 'string' ? Buffer.byteLength(b, 'utf8') : b.length);
const blobOf = (path: string): string => createHash('sha1').update(path).digest('hex');

// ---- the hooks (Playwright init scripts) ------------------------------------------------------------------------------

interface HookConfig {
  /** Parent realm: make `setAttribute('csp', ...)` on an iframe do nothing (WebKit's and Gecko's condition). */
  readonly skipCspAttr?: boolean;
  /** Parent realm: hold a srcdoc iframe's `load` listener calls until the navigated child (`navigateTo`) has done its
   *  part: the first until the child is up, every later one until the reader's own end of the port has received every
   *  op the child sends (`onHello`). The library's first `load` handler then posts its hello to the child whichever
   *  load fired first, and its 'navigated' fallback (a later call, which removes the frame) runs only after the child's
   *  ops have reached the reader, so it can discard neither the hello nor the parent's answer to the child's word. It
   *  replaces a fixed 700 ms delay, which promised neither (merge queue run 41551141767: "the child received the port:
   *  expected 0 to be greater than 0"). Measured under load, the frame hook runs in the srcdoc at readyState
   *  `interactive`, after the bootstrap's scripts (20 of 20 runs), and the srcdoc's own load fired before the hook
   *  navigated in 2 of 27 (the load-first ordering, which `navigateAfterLoad` forces); with a child that commits more
   *  than 700 ms after that load, the hello goes to the srcdoc. And a child slower than about 1.3 s pushed the delayed
   *  handler past the 2 s watchdog, so no hello was posted at all.
   *  The evidence is the parent's own: the child's word that it holds the port, which the parent records
   *  (`__childPorts`) and answers before the child speaks on the port, and what the reader's end of the port received
   *  (`__readerPortIn`, each message counted after the reader's own handler has run it). Anything the child sends can
   *  be lost with the frame once an op makes the reader remove it (the forged ready does: the reader falls back with
   *  `nonce`): its console line (Playwright drops a console call whose context is already gone; hosted runs 44160844545
   *  and 44168803467: "the child received the port (hellos: [])"), or its window message (measured: 1 run of 30
   *  recorded no word from a child whose hello line was captured). */
  readonly holdLoadForChild?: boolean;
  /** Parent realm: messages posted on the frame's end of the port just before it is handed to the frame, so they are
   *  on the wire ahead of anything the frame says (the Playwright init script reaches a srcdoc frame before its
   *  scripts in some loads and after them in others, so a frame-realm hook cannot be relied on to speak first). */
  readonly earlyOps?: readonly unknown[];
  /** Frame realm: messages posted on the port once it is captured (a navigated child's, which has no scripts of the
   *  library's to be ahead of); with `holdLoadForChild`, once the parent has recorded and answered the child's word. */
  readonly onHello?: readonly unknown[];
  /** Frame realm: the srcdoc document navigates here, at once, or with `navigateAfterLoad` only when the parent hook
   *  posts it `ccrcHookGo`, which it does once it has taken the srcdoc's own load listener call. */
  readonly navigateTo?: string;
  /** With `holdLoadForChild`: the load-first ordering, forced at its worst. The srcdoc navigates only when the parent
   *  hook has taken the srcdoc's own load listener call (the parent tells it to), and the parent answers the child's
   *  word only once it holds the child's load call too, so the library's 'navigated' fallback is pending before the
   *  child can speak. */
  readonly navigateAfterLoad?: boolean;
  /** Parent realm: every window `message` the parent receives is recorded (`__msgIn`: the payload's `t`, the origin, the port
   *  count), so a row can wait on the parent's own receipt of a stray message and then assert it had no effect. */
  readonly countMessages?: boolean;
  /** Parent realm: `HTMLIFrameElement.prototype.contentWindow` is left unwrapped, so `iframe.contentWindow` is the
   *  frame's own window and nothing posted to the frame is counted (`__posts`, `earlyOps` and the load-first hold need the
   *  wrapper). The wrapper is a Proxy, and a Proxy is never the `source` of a message the frame posts, so under it a
   *  listener that checks `event.source === iframe.contentWindow` never matches, which production's would: a row about
   *  window messages from the frame runs bare (measured: the stray case missed such a listener with the wrapper on). */
  readonly bareContentWindow?: boolean;
  /** Parent realm: `Clipboard.prototype.writeText` records its text (`__clipWrites`) and resolves, so a row counts what the
   *  console writes and when (headless Chrome grants no clipboard permission). */
  readonly recordClipboard?: boolean;
  /** Parent realm: the `content` of the srcdoc's `<meta http-equiv="Content-Security-Policy">` is replaced with this text
   *  as the library sets the iframe's `srcdoc`, so the frame is parsed under a meta the library did not build. Used with
   *  `skipCspAttr`, so the meta is the only policy the frame has. */
  readonly srcdocMeta?: string;
}

function hookScript(cfg: HookConfig): string {
  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  if (window.top === window) {
    window.__posts = []; window.__postPorts = []; window.__frames = []; window.__readyAts = []; window.__childPorts = [];
    if (CFG.skipCspAttr || typeof CFG.srcdocMeta === 'string') {
      const orig = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (n, v) {
        if (this.tagName === 'IFRAME') {
          const name = String(n).toLowerCase();
          if (CFG.skipCspAttr && name === 'csp') return undefined;
          if (typeof CFG.srcdocMeta === 'string' && name === 'srcdoc') {
            v = String(v).replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, (m, a, b) => a + CFG.srcdocMeta + b);
          }
        }
        return orig.call(this, n, v);
      };
    }
    if (CFG.countMessages) {
      window.__msgIn = [];
      window.addEventListener('message', (e) => {
        const d = e.data;
        const f = document.querySelector('.docs-reader iframe');
        window.__msgIn.push({ t: d !== null && typeof d === 'object' ? String(d.t) : typeof d, origin: e.origin, ports: e.ports.length,
          fromReader: f !== null && e.source === f.contentWindow });
      }, true);
    }
    if (CFG.recordClipboard && typeof Clipboard !== 'undefined') {
      window.__clipWrites = [];
      Clipboard.prototype.writeText = function (text) { window.__clipWrites.push(String(text)); return Promise.resolve(); };
    }
    let handed = null;
    if (CFG.holdLoadForChild) {
      // Two gates on the library's srcdoc load listener, each opened by the child's own doing: the first call waits
      // until the child is up (its word: it sits in the sandbox with no allow-same-origin, so its messages carry origin
      // "null" and it names itself), every later one until the reader's own end of the port has received every op the
      // child sends. A later call is the library's 'navigated' fallback, which removes the frame; run any earlier, it
      // would discard the hello, or the parent's answer to the child's word, with the frame.
      const state = { up: false, spoke: false };
      const held = [];
      let ran = 0;
      window.__loadCalls = 0; window.__readerPortIn = [];
      const pump = () => {
        while (held.length > 0 && (ran === 0 ? state.up : state.spoke)) { ran += 1; held.shift()(); }
      };
      // The reader's own end of the port: the channel whose other end the library hands the frame with its hello.
      const MC = window.MessageChannel;
      const channels = [];
      window.MessageChannel = function MessageChannel() { const c = new MC(); channels.push(c); return c; };
      window.MessageChannel.prototype = MC.prototype;
      handed = (frameEnd) => {
        const c = channels.find((x) => x.port2 === frameEnd);
        if (c === undefined) return;
        // Added after the library set this end's onmessage (it does before the frame loads), so it runs after the
        // reader's own handler: a message is counted once the reader has acted on it.
        c.port1.addEventListener('message', (e) => {
          window.__readerPortIn.push(e.data !== null && typeof e.data === 'object' ? String(e.data.t) : typeof e.data);
          if (window.__readerPortIn.length >= (CFG.onHello || []).length) state.spoke = true;
          pump();
        });
      };
      const own = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow').get;
      let answer = null;
      const answerWhenDue = () => {
        if (answer !== null && (!CFG.navigateAfterLoad || window.__loadCalls >= 2)) { const a = answer; answer = null; a(); }
      };
      window.addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.ccrcHookChild === undefined || d.href !== CFG.navigateTo) return;
        if (d.ccrcHookChild === 'up') state.up = true;
        if (d.ccrcHookChild === 'port') {
          // Recorded, then answered (at once, or with navigateAfterLoad once the child's load call is held too); the
          // child speaks on the port only after this answer. No held call can remove the frame before the answer
          // arrives: the later ones wait for the child's ops on the reader's port (state.spoke).
          window.__childPorts.push(d.href);
          const to = e.source;
          answer = () => { if (to) to.postMessage({ ccrcHookAck: 'port', href: d.href }, '*'); };
          answerWhenDue();
        }
        pump();
      });
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, cb, opts) {
        if (type === 'load' && this instanceof HTMLIFrameElement && typeof cb === 'function' && this.hasAttribute('srcdoc')) {
          const orig = cb; const self = this;
          cb = function (ev) {
            window.__loadCalls += 1;
            held.push(() => orig.call(self, ev));
            pump();
            if (CFG.navigateAfterLoad && window.__loadCalls === 1) {
              const w = own.call(self);
              if (w) w.postMessage({ ccrcHookGo: true }, '*');
            }
            answerWhenDue();
          };
        }
        return add.call(this, type, cb, opts);
      };
    }
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (!CFG.bareContentWindow) Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true, enumerable: desc.enumerable,
      get() {
        const w = desc.get.call(this);
        if (w === null) return w;
        return new Proxy(w, {
          get(t, k) {
            if (k === 'postMessage') {
              return (...a) => {
                window.__posts.push({ at: performance.now(), target: a[1], data: JSON.parse(JSON.stringify(a[0])), ports: a[2] ? a[2].length : 0 });
                if (a[2] && a[2][0]) {
                  window.__postPorts.push(a[2][0]);
                  if (handed !== null) handed(a[2][0]);
                  for (const op of (CFG.earlyOps || [])) a[2][0].postMessage(op);
                }
                return t.postMessage(...a);
              };
            }
            const v = t[k];
            return typeof v === 'function' ? v.bind(t) : v;
          },
        });
      },
    });
    const seen = (iframe) => {
      const attrs = {};
      for (const a of iframe.attributes) if (a.name !== 'srcdoc') attrs[a.name] = a.value;
      window.__frames.push({ attrs, srcdoc: iframe.getAttribute('srcdoc'), focusedAtInsert: document.activeElement === iframe, at: performance.now() });
    };
    const ready = () => {
      const n = window.__frames.length;
      if (n === 0 || window.__readyAts.length >= n) return;
      if (document.querySelector('.docs-reader iframe') && !document.querySelector('.doc-formatting')) window.__readyAts.push(performance.now());
    };
    new MutationObserver((muts) => {
      for (const m of muts) for (const node of m.addedNodes) {
        if (node.nodeType === 1 && node.tagName === 'IFRAME' && node.closest('.docs-reader')) seen(node);
      }
      ready();
    }).observe(document, { childList: true, subtree: true });
  } else {
    const heldFor = CFG.holdLoadForChild === true && location.href === CFG.navigateTo;
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.t !== 'hello' || !e.ports || e.ports.length !== 1) return;
      const p = e.ports[0];
      window.__ccrcPort = p;
      console.log('ccrc-hook hello ' + (location.href === 'about:srcdoc' ? 'srcdoc' : location.href));
      let spoke = false;
      const speak = () => {
        if (spoke) return;
        spoke = true;
        for (const m of (CFG.onHello || [])) p.postMessage(m);
      };
      if (!heldFor) { speak(); return; }
      // The word first, the ops only once the parent has recorded and answered it (see holdLoadForChild).
      window.addEventListener('message', (a) => {
        if (a.data && a.data.ccrcHookAck === 'port' && a.data.href === location.href) speak();
      });
      top.postMessage({ ccrcHookChild: 'port', href: location.href }, '*');
    }, true);
    // The child is the frame's current document once its own script runs, its hello listener above already in place:
    // the parent hook may now run the first load listener call it held.
    if (heldFor) top.postMessage({ ccrcHookChild: 'up', href: location.href }, '*');
    if (CFG.navigateTo && location.href === 'about:srcdoc') {
      const go = () => { location.href = CFG.navigateTo; };
      // The load-first ordering (navigateAfterLoad): only once the parent hook has taken this document's load call.
      if (CFG.navigateAfterLoad) window.addEventListener('message', (e) => { if (e.data && e.data.ccrcHookGo === true) go(); });
      else go();
    }
  }
})();`;
}

// ---- the 27-channel battery -------------------------------------------------------------------------------------------

/** The 27 channels: one list for this leg and the reader lab (the reader lab plan, Task 6; M10.16). */
const CHANNELS = LAB_BATTERY_CHANNELS;

/** The battery as an expression for the frame's own realm: every channel, once per origin, each to `/battery/<name>`.
 *  It returns what it attempted and the `securitypolicyviolation` events the frame's CSP raised, so a run that reaches
 *  nothing can show it was refused rather than never run. */
function batterySource(origins: readonly string[]): string {
  return `(async () => {
  const violations = []; const threw = {}; const attempted = [];
  document.addEventListener('securitypolicyviolation', (e) => { violations.push(e.blockedURI); });
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  ${LAB_BATTERY_PRELUDE_JS}
  const channels = ${LAB_BATTERY_CHANNELS_JS};
  for (const origin of ${JSON.stringify(origins)}) {
    for (const [name, run] of Object.entries(channels)) {
      attempted.push(name + '@' + origin);
      try { run(origin + '/battery/' + name); } catch (e) { threw[name + '@' + origin] = e && e.name; }
    }
  }
  await nap(2500);
  return { attempted, threw, violations };
})()`;
}

interface BatteryRun {
  readonly attempted: string[];
  readonly threw: Record<string, string>;
  readonly violations: string[];
}

// ---- the browser, the origins, the built app --------------------------------------------------------------------------

let browser: Browser;
let origins: Origins;
let dist: string | undefined;
let server: DistServer;
let FILES: Map<string, Body>;

const CHILD_PAGE: OriginAnswer = {
  headers: { 'content-type': 'text/html; charset=utf-8', 'allow-csp-from': '*' },
  body: '<!doctype html><meta charset="utf-8"><title>child</title><p>child',
};
const ROUTES: Readonly<Record<string, OriginRoute>> = { '/child': () => CHILD_PAGE };

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  origins = await startOrigins(ROUTES);
  FILES = fixtureFiles(origins);
  dist = sharedDist();
  server = await serveDist(dist);
  browser = await chromium.launch({ executablePath, headless: true });
}, 240_000);

/** The one browser with Chrome's local-network checks off (nothing else changed), launched on first use and shared by the
 *  rows that need it: those checks already refuse a sandboxed frame's navigation to a loopback address, which would hide
 *  what the shell meta alone does. */
let checksOff: Browser | undefined;
async function checksOffBrowser(): Promise<Browser> {
  checksOff ??= await chromium.launch({ executablePath: resolveChrome(), headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
  return checksOff;
}

afterAll(async () => {
  await checksOff?.close();
  await browser?.close();
  await server?.close();
  await origins?.close();
});

interface ApiHit {
  readonly path: string;
  readonly method: string;
  readonly cookie: string | null;
}

interface SessionOptions {
  /** The width the context is opened at, when it differs from `width` (the viewport it is then resized to): a fine pointer
   *  opened at a desk width and narrowed, as docs-compact-head's `openView` does. */
  readonly openWidth?: number;
  /** The skin (Refined by default). */
  readonly skin?: string;
  readonly width?: number;
  readonly height?: number;
  readonly hook?: HookConfig;
  /** Rewrite the built `index.html` before the page sees it (the shell meta controls). */
  readonly index?: (html: string) => string;
  /** Let the context run the built app's service worker (lab 10 alone; `app.ts`'s `AppView.serviceWorkers`). */
  readonly serviceWorkers?: 'allow';
  /** `docs`: the leaf loads first in a fresh tab, a Docs tab. Absent, it loads inside the console (`AppView.tab`). */
  readonly tab?: 'docs';
}

interface Session {
  readonly app: OpenedApp;
  readonly page: Page;
  readonly apiHits: ApiHit[];
  readonly logs: string[];
  /** URLs that got a response: a request Chrome really sent. */
  readonly responses: string[];
  goto(path: string): Promise<void>;
}

const sessions: OpenedApp[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.ctx.close();
});

const SHELL_META = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;

async function openSession(opts: SessionOptions = {}, using: Browser = browser): Promise<Session> {
  const app = await openApp(using, {
    width: opts.openWidth ?? opts.width ?? 1280, skin: opts.skin ?? REFINED, theme: 'light',
    ...(opts.serviceWorkers === undefined ? {} : { serviceWorkers: opts.serviceWorkers }),
    ...(opts.tab === 'docs' ? {} : { tab: 'console' as const }),
  }, { api: {}, fleetFrames: [] });
  sessions.push(app);
  const { ctx, page } = app;
  if (opts.width !== undefined || opts.height !== undefined) {
    await page.setViewportSize({ width: opts.width ?? 1280, height: opts.height ?? 800 });
  }
  await ctx.addCookies([{ ...COOKIE, url: server.origin }]);
  await ctx.addInitScript(hookScript(opts.hook ?? {}));
  const apiHits: ApiHit[] = [];
  const logs: string[] = [];
  const responses: string[] = [];
  page.on('response', (r) => { responses.push(r.url()); });
  page.on('console', (m) => { logs.push(`${m.type()} ${m.text()}`); });
  await ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const h = await req.allHeaders();
    apiHits.push({ path: url.pathname + url.search, method: req.method(), cookie: h['cookie'] ?? null });
    if (req.method() !== 'GET') {
      await route.fulfill({ status: 204 });
      return;
    }
    const answer = docsAnswer(url);
    await route.fulfill({ status: answer.status, headers: answer.headers, body: Buffer.from(answer.body) });
  });
  if (opts.index !== undefined) {
    const rewrite = opts.index;
    await ctx.route((u) => u.origin === server.origin, async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.fallback();
        return;
      }
      const res = await route.fetch();
      const html = await res.text();
      const changed = rewrite(html);
      if (changed === html) throw new Error('the shell rewrite changed nothing: the meta was not found in the built index.html');
      await route.fulfill({ response: res, body: changed });
    });
  }
  return { app, page, apiHits, logs, responses, goto: async (path) => { await page.goto(server.origin + path, { waitUntil: 'load' }); } };
}

interface Answer { readonly status: number; readonly headers: Record<string, string>; readonly body: Uint8Array }
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** What `/api/docs/demo/tree` and `/api/docs/demo/file` answer: the listing of FILES, and each file by its `path`. */
function docsAnswer(url: URL): Answer {
  const json = 'application/json; charset=utf-8';
  if (url.pathname.endsWith('/tree')) {
    const entries = [...FILES].map(([path, body]) => entry(SECTION, path, { committed: { kind: 'file', blob: blobOf(path), size: sizeOf(body) } }));
    return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: enc(JSON.stringify(treeResponse(treeOk({ entries })))) };
  }
  const path = url.searchParams.get('path') ?? '';
  const file = FILES.get(path);
  if (file === undefined) return { status: 404, headers: { 'content-type': json }, body: enc(JSON.stringify({ ok: false, failure: 'not-a-file' })) };
  if (typeof file !== 'string') return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': DOCS_RASTER_TYPES.png.mime }, body: file };
  const show = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path, size: sizeOf(file),
    sha256: blobOf(path).padEnd(64, '0'), encoding: 'utf8', text: file, commit: COMMIT_A, blob: blobOf(path), onRef: 'contains',
  };
  return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json },
    body: enc(JSON.stringify({ ok: true, contentClass: 'markdown', from: 'ccd', show })) };
}

const leafUrl = (name: string): string => `/docs/${PROJECT}/${SECTION}/${name}`;

type Outcome = 'ready' | 'fallback' | 'timeout';

/** Waits for the reader to be up (a frame, and the "formatting" line gone) or to have fallen back to the plain view. */
async function settle(page: Page, ms = 90_000, want: Outcome | null = null): Promise<Outcome> {
  try {
    const h = await page.waitForFunction(([note, only]) => {
      const state = [...document.querySelectorAll('.doc-plain-note')].some((n) => n.textContent === note) ? 'fallback'
        : document.querySelector('.docs-reader iframe') && !document.querySelector('.doc-formatting') ? 'ready' : null;
      return only === null || state === only ? state : null;
    }, [READER_FALLBACK_NOTE, want] as const, { timeout: ms, polling: 100 });
    return (await h.jsonValue()) as Outcome;
  } catch {
    return 'timeout';
  }
}

async function readerFrame(page: Page): Promise<Frame> {
  const h = await page.locator('.docs-reader iframe').elementHandle({ timeout: 30_000 });
  const f = await h?.contentFrame();
  if (f === null || f === undefined) throw new Error('the reader iframe has no content frame');
  return f;
}

interface SeenFrame {
  readonly attrs: Record<string, string>;
  readonly srcdoc: string;
  readonly focusedAtInsert: boolean;
  readonly at: number;
}
interface Post { readonly at: number; readonly target: string; readonly data: unknown; readonly ports: number }

const framesSeen = (page: Page): Promise<SeenFrame[]> => page.evaluate(() => (window as unknown as { __frames: SeenFrame[] }).__frames);
const postsSeen = (page: Page): Promise<Post[]> => page.evaluate(() => (window as unknown as { __posts: Post[] }).__posts);

async function open(path: string, opts: SessionOptions = {}): Promise<{ s: Session; outcome: Outcome }> {
  const s = await openSession(opts);
  await s.goto(leafUrl(path));
  return { s, outcome: await settle(s.page) };
}

/** Opens the page and waits only for the reader's iframe to be INSERTED (its srcdoc captured by the parent hook), not for
 *  `ready`: a row about the srcdoc must read it even when a mutated library builds one the frame then refuses. */
async function openInserted(path: string, opts: SessionOptions = {}): Promise<Session> {
  const s = await openSession(opts);
  await s.goto(leafUrl(path));
  await s.page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length > 0, undefined, { timeout: 60_000 });
  return s;
}

/** How many headings named `name` the page shows once the plain view has formatted its body. The fallback note and the
 *  plain view's "Formatting" line land in one commit and the formatted document only after the parse worker answers
 *  (measured 6 to 7 ms later, more on a loaded runner), so a count taken the moment `settle` sees the note can find
 *  none (merge queue run 41557867782: "the plain view shows the document: expected 0 to be greater than 0"). */
async function plainHeadings(page: Page, name: string): Promise<number> {
  const heading = page.getByRole('heading', { name });
  await heading.first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  return heading.count();
}

const pathOf = (page: Page): string => new URL(page.url()).pathname;
const store = (page: Page): Promise<Record<string, string>> => page.evaluate(() => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k !== null) out[k] = localStorage.getItem(k) ?? '';
  }
  return out;
});
const readerKeys = async (page: Page): Promise<string[]> => Object.keys(await store(page)).filter((k) => k.startsWith(READER_STORE_PREFIX));
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
/** The reasons the console's own fallback line gave (`ReaderFrame`'s "ccrc: reader fell back (<reason>)"), in order. A
 *  reason is all the line holds up to its last `)`, so one with a space or a parenthesis of its own (`no host element`,
 *  `mount <error>`, `images <error>`) reads whole rather than as no fallback at all. */
const fellBackFor = (logs: readonly string[]): string[] => logs.flatMap((l) => {
  const m = /ccrc: reader fell back \(([\s\S]*)\)$/.exec(l);
  return m === null ? [] : [m[1]!];
});

/** The origins' hits on `/battery/<name>`, by name, since `from`. */
function reached(from: number, who: readonly ('a' | 'b')[] = ['a', 'b']): string[] {
  const names = new Set<string>();
  for (const h of origins.hits.slice(from)) {
    if (!who.includes(h.origin as 'a' | 'b')) continue;
    const p = h.path.split('?')[0] ?? '';
    if (p.startsWith('/battery/')) names.add(p.slice('/battery/'.length));
  }
  return [...names].sort();
}

async function runBattery(frame: Frame): Promise<BatteryRun> {
  return (await frame.evaluate(batterySource([origins.a, origins.b]))) as BatteryRun;
}

/** A hand-built frame in the page, outside `.docs-reader`: no library, no CSP, the sandbox the caller names. */
async function mountControl(page: Page, sandbox: string): Promise<Frame> {
  await page.evaluate((sb) => {
    const f = document.createElement('iframe');
    f.id = 'control';
    f.setAttribute('sandbox', sb);
    f.srcdoc = '<!doctype html><meta charset="utf-8"><title>control</title><p>control</p>';
    document.body.append(f);
  }, sandbox);
  const h = await page.locator('#control').elementHandle();
  const f = await h?.contentFrame();
  if (f === null || f === undefined) throw new Error('the control iframe has no content frame');
  await f.waitForLoadState('load');
  return f;
}

// ---- the srcdoc, read the way a parser reads it -----------------------------------------------------------------------

interface SrcdocSummary {
  readonly head: { tag: string; type: string | null; httpEquiv: string | null; content: string | null; sha256: string; chars: number }[];
  readonly bodyChildren: number;
  readonly links: string[];
  readonly urlAttrs: { tag: string; attr: string; value: string }[];
  readonly cssRefs: string[];
  readonly seed: string | null;
}

/** Parses the n-th captured srcdoc (negative n from the end) in the page, so the big text never crosses the wire. */
function summariseSrcdoc(page: Page, n: number): Promise<SrcdocSummary> {
  return page.evaluate(async (index) => {
    const frames = (window as unknown as { __frames: { srcdoc: string }[] }).__frames;
    const text = (index < 0 ? frames[frames.length + index] : frames[index])?.srcdoc ?? '';
    const d = new DOMParser().parseFromString(text, 'text/html');
    const hex = async (s: string): Promise<string> => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const head: SrcdocSummary['head'] = [];
    let seed: string | null = null;
    for (const el of d.head.children) {
      const type = el.getAttribute('type');
      head.push({ tag: el.tagName.toLowerCase(), type, httpEquiv: el.getAttribute('http-equiv'), content: el.getAttribute('content'),
        sha256: await hex(el.textContent ?? ''), chars: (el.textContent ?? '').length });
      if (el.tagName === 'SCRIPT' && type === 'application/json') seed = el.textContent;
    }
    const external = /^\s*(?:https?:)?\/\//i;
    const urlAttrs: SrcdocSummary['urlAttrs'] = [];
    const names = ['src', 'href', 'srcset', 'action', 'poster', 'data', 'ping', 'formaction', 'background', 'cite', 'manifest'];
    for (const el of d.querySelectorAll('*')) {
      for (const attr of names) {
        const value = el.getAttribute(attr);
        if (value !== null && external.test(value)) urlAttrs.push({ tag: el.tagName.toLowerCase(), attr, value });
      }
    }
    const cssRefs: string[] = [];
    for (const style of d.querySelectorAll('style')) {
      const css = style.textContent ?? '';
      for (const m of css.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/gi)) cssRefs.push(m[1] ?? '');
      for (const m of css.matchAll(/url\(\s*['"]?([^'")\s]+)/gi)) if (external.test(m[1] ?? '')) cssRefs.push(m[1] ?? '');
    }
    return {
      head, bodyChildren: d.body.children.length,
      links: [...d.querySelectorAll('link')].map((l) => `${l.getAttribute('rel')} ${l.getAttribute('href')}`),
      urlAttrs, cssRefs, seed,
    };
  }, n);
}

// ---- the reader's lazy chunks, held (D-8729, completion plan Task 13) --------------------------------------------------

/** The built app's chunk for `./reader/bridge` (`ReaderFrame.tsx#lazyMountReader`'s first `import()`): the emitted file is
 *  `assets/<module name>-<hash>.js`, the name the build gives a dynamic import's chunk (`test/reader-built.test.ts` finds the
 *  render job's the same way). A request for none fails by name in `arrival`, listing the script requests that did arrive. */
const BRIDGE_CHUNK = /\/assets\/bridge-[^/]+\.js$/;
/** The Mermaid text's chunk (`./reader/assets`' `loadMermaidAsset`; `test/reader-built.test.ts` pins exactly one emitted). */
const MERMAID_CHUNK = /\/assets\/mermaid\.frame-[^/]+\.js$/;

interface HeldChunk {
  /** Resolves once a request for the chunk has arrived and is parked (bounded; the failure names the chunk and the script
   *  requests seen). */
  arrival(): Promise<void>;
  /** Lets every parked request, and every later one, through. */
  release(): Promise<void>;
}

/** Parks the browser's request for the chunk `pattern` names until the case calls `release()`. Routed on the context, before
 *  the page loads; any other request falls through to the routes `openApp` and the session set up. */
async function holdChunk(ctx: BrowserContext, label: string, pattern: RegExp): Promise<HeldChunk> {
  const parked: Route[] = [];
  const scripts: string[] = [];
  let released = false;
  await ctx.route((u) => u.pathname.includes('/assets/') && u.pathname.endsWith('.js'), async (route) => {
    const { pathname } = new URL(route.request().url());
    scripts.push(pathname);
    if (released || !pattern.test(pathname)) {
      await route.fallback();
      return;
    }
    parked.push(route);
  });
  return {
    async arrival() {
      const deadline = Date.now() + 60_000;
      while (parked.length === 0) {
        if (Date.now() > deadline) throw new Error(`no request for the ${label} chunk (${String(pattern)}) arrived in 60 s; script requests seen: ${scripts.join(', ') || 'none'}`);
        await sleep(25);
      }
    },
    async release() {
      released = true;
      for (const route of parked.splice(0)) await route.fallback();
    },
  };
}

/** Keyboard focus onto the element `selector` names, the way a reader of the page gets there: Tab (or Shift+Tab) from where
 *  focus stands, until it lands, at most `max` presses. The failure names the selector and the stops passed. */
async function tabTo(page: Page, selector: string, key: 'Tab' | 'Shift+Tab', max = 60): Promise<void> {
  const passed: string[] = [];
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(key);
    const here = await page.evaluate((sel) => {
      const a = document.activeElement;
      return { hit: a !== null && a.matches(sel), name: a === null ? 'null' : `${a.tagName.toLowerCase()}.${String(a.className)}` };
    }, selector);
    if (here.hit) return;
    passed.push(here.name);
  }
  throw new Error(`${key} did not reach ${selector} in ${max} presses (stops: ${passed.join(' > ')})`);
}

/** What holds focus, in the parent document. */
const activeOf = (page: Page): Promise<{ readonly onFrame: boolean; readonly cls: string; readonly tag: string }> => page.evaluate(() => {
  const a = document.activeElement;
  return { onFrame: a !== null && a === document.querySelector('.docs-reader iframe'), cls: a === null ? '' : String(a.className), tag: a === null ? 'null' : a.tagName.toLowerCase() };
});

const insertFocus = async (page: Page): Promise<boolean[]> => (await framesSeen(page)).map((f) => f.focusedAtInsert);

/** The element Tab goes to next from the control `selector` names: the next focusable, visible element after it in document
 *  order (a tabindex of -1, a disabled control, anything not drawn or inside a hidden region does not count). */
const nextStopAfter = (page: Page, selector: string): Promise<string> => page.evaluate((sel) => {
  const from = document.querySelector(sel);
  if (from === null) return 'no such control';
  const stops = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, iframe, [tabindex]')]
    .filter((e) => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.checkVisibility({ visibilityProperty: true }));
  const i = stops.indexOf(from as HTMLElement);
  const next = stops[i + 1];
  return i < 0 || next === undefined ? 'none' : `${next.tagName.toLowerCase()}.${String(next.className)}`;
}, selector);

/** How many `/api/docs` file reads the page has made for the section-relative `name` (the document's own bytes). */
const fileReads = (s: Session, name: string): number => s.apiHits.filter((h) => {
  const u = new URL(h.path, 'http://hits.invalid');
  return u.pathname.endsWith('/file') && u.searchParams.get('path') === name;
}).length;
const historyReads = (s: Session, name: string): number => s.apiHits.filter((h) => {
  const u = new URL(h.path, 'http://hits.invalid');
  return u.pathname.endsWith('/history') && u.searchParams.get('path') === name;
}).length;

/** Where the element `id` sits in `frame`: its top and the frame's viewport height, or null when the frame has no such element. */
const topIn = (frame: Frame, id: string): Promise<{ readonly top: number; readonly viewport: number } | null> => frame.evaluate((i) => {
  const e = document.getElementById(i);
  return e === null ? null : { top: e.getBoundingClientRect().top, viewport: window.innerHeight };
}, id);
const inView = (at: { readonly top: number; readonly viewport: number } | null): boolean => at !== null && at.top >= 0 && at.top < at.viewport;

/** What the parent window has received, by the payload's `t` (the hook's `countMessages`), with each message's origin and port
 *  count, and whether its source is the reader's iframe's `contentWindow` (true only for a row whose hook runs it bare). */
type MessageIn = { t: string; origin: string; ports: number; fromReader: boolean };
const messagesIn = (page: Page): Promise<MessageIn[]> => page.evaluate(() => (window as unknown as { __msgIn: MessageIn[] }).__msgIn);
/** Every text the console wrote to the clipboard (the hook's `recordClipboard`). */
const clipboardWrites = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __clipWrites: string[] }).__clipWrites);

/** Lets the page render what its last task queued: two animation frames, then a task. A barrier for "nothing happened" claims
 *  whose effect, had there been one, would be a React commit; it is not a delay. */
const rendered = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((done) => {
  requestAnimationFrame(() => { requestAnimationFrame(() => { setTimeout(done, 0); }); });
}));

// ---- the rows ---------------------------------------------------------------------------------------------------------

describe('W8a reader frame in Chrome', () => {
  it('M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws (on tap, or after ready where E17 held), and the hostile directive injects no style', async () => {
    // After ready the library may start drawing while the frame boots, so that arm counts from before the open.
    const beforeOpen = origins.hits.length;
    const { s, outcome } = await open('flow.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    // E15: tap Render on EVERY figure, the hostile ones included, and wait for each.
    const buttons = frame.locator('.fig-render-btn');
    if (DRAW === 'on-request') {
      expect(await buttons.count(), 'one Render button per figure').toBe(FIGURES);
      expect(await frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => `${f.getAttribute('data-docreader-draw')}:${f.querySelectorAll('svg').length}`)),
        'before the tap nothing is drawn (on-request)').toEqual(Array.from({ length: FIGURES }, () => 'on-request:0'));
    } else {
      expect(await buttons.count(), 'no Render button: the figures draw after ready (after-ready)').toBe(0);
    }
    const fromDraw = DRAW === 'on-request' ? origins.hits.length : beforeOpen;
    for (let i = 0; i < FIGURES; i += 1) {
      if (DRAW === 'on-request') await frame.locator('figure.mermaid-figure').nth(i).locator('.fig-render-btn').click();
      await frame.waitForFunction((k) => {
        const f = document.querySelectorAll('figure.mermaid-figure')[k];
        const state = f?.getAttribute('data-docreader-draw');
        return state === 'drawn' || state === 'failed';
      }, i, { timeout: 90_000 });
    }
    const states = await frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => ({
      draw: f.getAttribute('data-docreader-draw'), svgs: f.querySelectorAll('svg').length,
    })));
    console.log(`T10-FIGURES mermaid ${JSON.stringify(states)}`);
    for (const k of [0, 1, 2]) expect(states[k]?.draw, `figure ${k} (flowchart, sequence, gantt) is drawn`).toBe('drawn');
    for (const k of [0, 1, 2]) expect(states[k]?.svgs, `figure ${k} (flowchart, sequence, gantt) holds an svg`).toBeGreaterThan(0);
    for (const k of [3, 4]) expect(['drawn', 'failed'], `hostile figure ${k} is drawn or shows its documented refusal`).toContain(states[k]?.draw);
    expect(origins.hits.slice(fromDraw).filter((h) => h.path.startsWith('/battery/')).map((h) => `${h.origin} ${h.path}`), 'drawing reached neither origin').toEqual([]);
    const hostile = await frame.evaluate((payload) => {
      const styles = [...document.querySelectorAll('style')].map((st) => st.textContent ?? '');
      const rects = [...document.querySelectorAll('figure.mermaid-figure')[3]?.querySelectorAll('rect') ?? []];
      return {
        styles: styles.length,
        payloadInStyle: styles.some((t) => t.includes(payload)),
        fills: rects.map((r) => getComputedStyle(r).fill),
      };
    }, HOSTILE_PAYLOAD);
    expect(hostile.styles, 'the scan sees the styles the frame and Mermaid wrote').toBeGreaterThan(1);
    expect(hostile.payloadInStyle, 'no style element carries the hostile payload').toBe(false);
    expect(hostile.fills.includes(HOSTILE_FILL), `no rect takes the hostile fill (${hostile.fills.join('|')})`).toBe(false);
    // M8.B1's "fonts load": the library's faces, once the figures used them.
    const fonts = await frame.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].map((f) => f.status);
    });
    expect(fonts.length, 'the frame declares its faces').toBeGreaterThan(0);
    expect(fonts.includes('loaded'), `a face loaded (${fonts.join(',')})`).toBe(true);
    expect(fonts.includes('error'), `no face errored (${fonts.join(',')})`).toBe(false);

    // THEN the battery, with Mermaid having run.
    const from = origins.hits.length;
    const fromRes = s.responses.length;
    const run = await runBattery(frame);
    expect(run.attempted.length, 'every channel was attempted against both origins').toBe(CHANNELS.length * 2);
    expect(reached(from), '0/27 reached A or B').toEqual([]);
    expect(s.responses.slice(fromRes).filter((u) => u.includes('site.localhost')), 'Chrome itself got no response from A or B').toEqual([]);
    const refused = new Set(run.violations.map((v) => v.split('/battery/')[1]?.split('?')[0]).filter((n): n is string => n !== undefined));
    console.log(`T10-FIGURES battery-refused ${refused.size}/${CHANNELS.length} unnamed ${CHANNELS.filter((c) => !refused.has(c)).join(',')} threw ${JSON.stringify(run.threw)} violations ${run.violations.length}`);
    expect(refused.size, `the frame's CSP refused the channels it names (${[...refused].join(',')})`).toBeGreaterThanOrEqual(20);
  }, 240_000);

  it('M8.B1 meta-only: with the iframe csp attribute suppressed, the srcdoc meta alone holds 0 of 27', async () => {
    const { s, outcome } = await open('small.md', { hook: { skipCspAttr: true } });
    expect(outcome).toBe('ready');
    const seen = await framesSeen(s.page);
    expect(seen[0]?.attrs['csp'], 'the attribute was suppressed, so the meta is the only policy').toBeUndefined();
    const frame = await readerFrame(s.page);
    const from = origins.hits.length;
    const run = await runBattery(frame);
    expect(run.attempted.length).toBe(CHANNELS.length * 2);
    expect(reached(from), 'the meta alone holds 0/27').toEqual([]);
    const refused = new Set(run.violations.map((v) => v.split('/battery/')[1]?.split('?')[0]).filter((n): n is string => n !== undefined));
    expect(refused.size, `the meta refused the channels (${[...refused].join(',')})`).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it('M8.B1 control: a srcdoc without the meta reaches B on at least 20 of 27', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const control = await mountControl(s.page, 'allow-scripts');
    const from = origins.hits.length;
    const fromRes = s.responses.length;
    const run = await runBattery(control);
    expect(run.attempted.length).toBe(CHANNELS.length * 2);
    expect(s.responses.slice(fromRes).filter((u) => u.includes('site.localhost')).length, 'Chrome sees the responses the origins sent').toBeGreaterThan(0);
    const b = reached(from, ['b']);
    const a = reached(from, ['a']);
    console.log(`T10-FIGURES battery-control B ${b.length}/27 A ${a.length}/27 missing-at-B ${CHANNELS.filter((c) => !b.includes(c)).join(',')}`);
    expect(b.length, `B reached by ${b.join(',')}`).toBeGreaterThanOrEqual(20);
  }, 120_000);

  it('M8.B2: no request from the frame carries the session cookie', async () => {
    const s = await openInserted('small.md'); // probed as soon as it exists: the property does not wait for the boot
    const probes = (tag: string): string => `(async () => {
      const base = ${JSON.stringify(server.origin)} + '/api/docs/${PROJECT}/file?probe=${tag}-';
      const nap = (ms) => new Promise((r) => setTimeout(r, ms));
      const violations = [];
      document.addEventListener('securitypolicyviolation', (e) => { violations.push(e.blockedURI); });
      const out = { origin: self.origin };
      fetch(base + 'fetch-marker', { credentials: 'include', headers: { [${JSON.stringify(DOCS_REQUEST_HEADER)}]: ${JSON.stringify(DOCS_REQUEST_HEADER_VALUE)} } }).catch(() => 0);
      fetch(base + 'fetch-plain', { credentials: 'include' }).catch(() => 0);
      const x = new XMLHttpRequest(); x.open('GET', base + 'xhr'); x.withCredentials = true; x.send();
      navigator.sendBeacon(base + 'beacon', 'x');
      try { const w = new WebSocket(base.replace('http', 'ws') + 'ws'); w.onerror = () => {}; } catch (e) { out.ws = e.name; }
      const i = new Image(); i.src = base + 'image';
      await nap(1500);
      out.violations = violations.length;
      return out;
    })()`;
    const frame = await readerFrame(s.page);
    const prod = (await frame.evaluate(probes('prod'))) as { origin: string; violations: number };
    expect(prod.origin, 'the frame has an opaque origin, so it has no cookie jar of the console').toBe('null');
    expect(prod.violations, 'the probes ran and the CSP refused them').toBeGreaterThanOrEqual(5);
    expect(s.apiHits.filter((h) => h.path.includes('probe=prod-')).map((h) => `${h.method} ${h.path}`), 'none arrives').toEqual([]);
    expect(await settle(s.page), 'and the reader is up').toBe('ready');

    // The controls, in the same Chrome: a frame with no CSP and the production sandbox sends its requests, with no
    // cookie; the same frame with allow-same-origin sends the cookie; and the console page itself carries it.
    const bare = await mountControl(s.page, 'allow-scripts');
    await bare.evaluate(probes('bare'));
    const bareHits = s.apiHits.filter((h) => h.path.includes('probe=bare-'));
    expect(bareHits.length, 'with no CSP the probes arrive (the detector sees them)').toBeGreaterThan(0);
    expect(bareHits.filter((h) => h.cookie !== null && h.cookie.includes(COOKIE.name)), 'but the opaque origin sends no cookie').toEqual([]);
    await s.page.evaluate(() => document.getElementById('control')?.remove());
    const same = await mountControl(s.page, 'allow-scripts allow-same-origin');
    await same.evaluate(probes('same'));
    expect(s.apiHits.filter((h) => h.path.includes('probe=same-') && h.cookie !== null && h.cookie.includes(COOKIE.name)).length,
      'with allow-same-origin the cookie rides').toBeGreaterThan(0);
    await s.page.evaluate((u) => fetch(u, { credentials: 'include' }).then(() => 0), `${server.origin}/api/docs/${PROJECT}/file?probe=top-fetch`);
    expect(s.apiHits.filter((h) => h.path.includes('probe=top-') && (h.cookie ?? '').includes(COOKIE.name)).length,
      'the console page carries it').toBe(1);
  }, 120_000);

  it('M8.B3: storage, IndexedDB, cookie and caches throw or are empty, with zero uncaught errors', async () => {
    const s = await openInserted('small.md');
    const frame = await readerFrame(s.page);
    const probe = `(async () => {
      const out = {};
      const tries = {
        localStorage: () => localStorage.length,
        sessionStorage: () => sessionStorage.length,
        cookie: () => document.cookie,
        indexedDB: () => indexedDB.open('ccrc-probe'),
        caches: () => caches.open('ccrc-probe'),
      };
      for (const [k, f] of Object.entries(tries)) {
        try { const v = await f(); out[k] = 'returned ' + (v === '' ? 'empty' : typeof v); } catch (e) { out[k] = e && e.name; }
      }
      return out;
    })()`;
    const got = (await frame.evaluate(probe)) as Record<string, string>;
    expect(got, 'each ambient store throws in the opaque origin').toEqual({
      localStorage: 'SecurityError', sessionStorage: 'SecurityError', cookie: 'SecurityError',
      indexedDB: 'SecurityError', caches: 'SecurityError',
    });
    expect(await settle(s.page), 'the library boots').toBe('ready');
    expect(s.app.errors, 'the library booted with zero uncaught errors').toEqual([]);
    expect(s.logs.filter((l) => l.startsWith('error ')), 'and logged no console error').toEqual([]);

    // Control 1, the other way: the same probe in a frame with allow-same-origin finds every store working, so a
    // SecurityError above is the sandbox's doing and the probe is not blind.
    const same = await mountControl(s.page, 'allow-scripts allow-same-origin');
    const open = (await same.evaluate(probe)) as Record<string, string>;
    expect(Object.values(open).filter((v) => !v.startsWith('returned')), `with allow-same-origin nothing throws (${JSON.stringify(open)})`).toEqual([]);
    await s.page.evaluate(() => document.getElementById('control')?.remove());

    // Control 2: an uncaught error thrown in a sandboxed frame's realm reaches the listener the zero above was read
    // from (`pageerror`, filled by openApp), so "zero" is not a channel that cannot see a frame.
    const bare = await mountControl(s.page, 'allow-scripts');
    await bare.evaluate(`setTimeout(() => { throw new Error('ccrc-planted-frame-error'); }, 0)`);
    await expect.poll(() => s.app.errors.some((e) => e.includes('ccrc-planted-frame-error')), { timeout: 5_000 },
    ).toBe(true);
  }, 120_000);

  it('M8.B4: window.open returns null, top.location= throws, and _blank is inert (a planted target=_blank link, and the author link)', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    const from = origins.hits.length;
    const opened = (await frame.evaluate(`(() => {
      const out = {};
      const w = window.open(${JSON.stringify(origins.a + '/popup-open')}, '_blank');
      out.open = w === null ? 'null' : 'window';
      try { top.location.href; out.topRead = 'read'; } catch (e) { out.topRead = e.name; }
      try { top.location = ${JSON.stringify(origins.a + '/popup-top')}; out.topWrite = 'no-throw'; } catch (e) { out.topWrite = e.name; }
      return out;
    })()`)) as { open: string; topRead: string; topWrite: string };
    console.log(`T10-FIGURES b4 ${JSON.stringify(opened)}`);
    expect.soft(opened.open, 'window.open returns null').toBe('null');
    expect.soft(opened.topRead, 'reading top.location throws').toBe('SecurityError');
    expect.soft(opened.topWrite, 'writing top.location throws').toBe('SecurityError');
    const topUrl = s.page.url();
    await sleep(800);
    expect(s.page.url(), 'a top.location write moved nothing').toBe(topUrl);
    // _blank: the library emits no target=_blank link (raw HTML is off), and the frame's click guard turns any click that
    // reaches `window` on a link into the console's sheet, so a plain click never tests the sandbox. One is planted
    // inside a shadow root and clicked with a non-composed event, which never reaches the guard: the browser's own
    // `_blank` handling runs, and the sandbox without allow-popups is the only wall left.
    await frame.evaluate(`(() => {
      const host = document.createElement('div');
      const a = document.createElement('a');
      a.target = '_blank'; a.href = ${JSON.stringify(origins.a + '/popup-blank')}; a.textContent = 'planted blank link';
      host.attachShadow({ mode: 'open' }).append(a);
      document.body.prepend(host);
      window.__plantedBlankClick = () => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: false }));
    })()`);
    // Counted just before the click, and compared after it: a popup from an earlier clause (window.open under a mutated
    // sandbox) is already in the count and is not this link's.
    const pagesBefore = s.app.ctx.pages().length;
    expect(await frame.evaluate('window.__plantedBlankClick()'), 'the planted click was not cancelled by the guard (it never saw it)').toBe(true);
    await sleep(1000);
    expect(s.app.ctx.pages().length - pagesBefore, 'the planted _blank link opened no window (pages opened by the click)').toBe(0);
    expect(origins.hits.slice(from).filter((h) => h.path.startsWith('/popup-blank')).map((h) => h.path), 'and nothing reached A').toEqual([]);
    if (await s.page.getByText('Open this link?').count() > 0) await s.page.getByRole('button', { name: 'Cancel' }).click();
    // And the author's own external link: a real click, which the guard routes to the console's sheet.
    await frame.getByRole('link', { name: 'popup link' }).click();
    await s.page.getByText('Open this link?').waitFor({ timeout: 10_000 });
    await sleep(800);
    expect(s.app.ctx.pages().length, 'no popup window exists').toBe(1);
    expect(origins.hits.slice(from).filter((h) => h.path.startsWith('/popup')).map((h) => h.path), 'nothing reached A').toEqual([]);
  }, 120_000);

  it('M8.B5: a width change persists under ccrc:reader:v1:pref:prefs and is seeded back on remount', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    await frame.locator('.aa-btn').click();
    await frame.locator('input[data-pref="width"][value="wide"]').check();
    const key = `${READER_STORE_PREFIX}pref:prefs`;
    await s.page.waitForFunction((k) => {
      const v = localStorage.getItem(k);
      return v !== null && v.includes('wide');
    }, key, { timeout: 10_000 });
    expect(JSON.parse((await store(s.page))[key] ?? 'null'), 'the pref is stored under the library prefix').toMatchObject({ width: 'wide' });
    // A remount: the other page opens in a new frame, seeded from the store.
    await frame.getByRole('link', { name: 'the other page' }).click();
    await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'));
    expect(await settle(s.page)).toBe('ready');
    const again = await readerFrame(s.page);
    expect(await again.locator('input[data-pref="width"][value="wide"]').isChecked(), 'wide is seeded back').toBe(true);
    expect((await framesSeen(s.page)).length, 'the remount made a second frame').toBe(2);
  }, 120_000);

  it('M8.B5: a doc link click routes in-app', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    await frame.getByRole('link', { name: 'the other page' }).click();
    await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'));
    expect(pathOf(s.page)).toBe(leafUrl('other.md'));
    expect(await settle(s.page)).toBe('ready');
  }, 120_000);

  // The stray messages and their controls (completion plan Task 13; the W8a residue's "hash" and "no control" items). The frame
  // posts a well-formed navigate, store.set and hash to `parent` (a window message, no port): the parent's own window must
  // receive all three (counted in the parent hook, a bounded wait), and then none has an effect. Each sink has a control of
  // its own, the same message on the frame's own port. `STRAY_ID` is a heading of long.md far below the first screen, so a
  // scroll of the frame would show. The hook runs bare (`bareContentWindow`), and each stray message's source is asserted to
  // be the iframe's own `contentWindow`: so a library that acted on window messages from its frame behind the usual source
  // check would act here as in production (row NDR-D2-T13-B-STRAYWIN, which survived the wrapped hook, where no source
  // check can match).
  const STRAY_ID = 'part-100';
  const STRAY = [
    { t: 'navigate', href: './other.md' },
    { t: 'store.set', key: 'pref:ui', value: '{"x":1}' },
    { t: 'hash', id: STRAY_ID },
  ] as const;

  it('M8.B5: a parent.postMessage of a well-formed navigate has no effect (store.set and hash too: the parent received all three)', async () => {
    const { s, outcome } = await open('long.md', { hook: { countMessages: true, bareContentWindow: true } });
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    const before = await readerKeys(s.page);
    const hashBefore = await s.page.evaluate(() => location.hash);
    const target = await topIn(frame, STRAY_ID);
    expect(target, 'the page has the hash target').not.toBeNull();
    expect(target!.top, 'and it is far below the first screen, so a scroll of the frame would move it').toBeGreaterThan(target!.viewport * 2);
    const scrollBefore = await frame.evaluate(() => (document.scrollingElement as Element).scrollTop);
    await frame.evaluate((messages) => { for (const m of messages) parent.postMessage(m, '*'); }, STRAY);
    // The parent's window received all three, from the frame (origin "null" for the sandbox) and carrying no port: only then is "no effect" a claim.
    await expect.poll(async () => (await messagesIn(s.page)).filter((m) => STRAY.some((x) => x.t === m.t)).map((m) => m.t).sort(), {
      timeout: 10_000, message: 'the parent window did not receive the frame\'s three stray messages (navigate, store.set, hash)',
    }).toEqual(['hash', 'navigate', 'store.set']);
    expect((await messagesIn(s.page)).filter((m) => STRAY.some((x) => x.t === m.t)).every((m) => m.origin === 'null' && m.ports === 0 && m.fromReader),
      'each came from the sandboxed frame, its source the iframe\'s own window (a source check would match it), with no port').toBe(true);
    await rendered(s.page);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('long.md'));
    expect(await readerKeys(s.page), 'no store write').toEqual(before);
    expect(await s.page.getByText('Open this link?').count() + await s.page.getByText('Copy with hidden characters?').count(), 'no sheet').toBe(0);
    expect(await s.page.evaluate(() => location.hash), 'location.hash is unchanged').toBe(hashBefore);
    expect(await frame.evaluate(() => (document.scrollingElement as Element).scrollTop), 'and the frame did not scroll').toBe(scrollBefore);
    expect((await topIn(frame, STRAY_ID))!.top, 'the hash target has not moved').toBe(target!.top);
  }, 120_000);

  /** One sink per control, each triggered alone: the same message as the stray one, sent on the frame's own port. */
  const SINKS = [
    ['navigate', STRAY[0], async (s: Session): Promise<void> => {
      await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'), undefined, { timeout: 10_000 });
    }],
    ['store.set', STRAY[1], async (s: Session): Promise<void> => {
      await s.page.waitForFunction((k) => localStorage.getItem(k) === '{"x":1}', `${READER_STORE_PREFIX}pref:ui`, { timeout: 10_000 });
    }],
    ['hash', STRAY[2], async (s: Session): Promise<void> => {
      await s.page.waitForFunction((id) => location.hash === `#${id}`, STRAY_ID, { timeout: 10_000 });
    }],
  ] as const;
  it.each(SINKS)('M8.B5 control: the same %s on the frame\'s own port reaches its sink', async (_name, message, reachesSink) => {
    const { s, outcome } = await open('long.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    expect(await frame.evaluate('typeof window.__ccrcPort'), 'the frame hook captured the frame\'s own port').toBe('object');
    await frame.evaluate((m) => (window as unknown as { __ccrcPort: MessagePort }).__ccrcPort.postMessage(m), message);
    await reachesSink(s);
  }, 120_000);

  it('M8.B5: a second load gives the plain view with the fixed note', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    const from = origins.hits.length;
    await frame.evaluate(`setTimeout(() => { location.href = ${JSON.stringify(origins.a + '/nav')}; }, 0)`);
    expect(await settle(s.page, 20_000, 'fallback'), 'a blocked self-navigation still fires a second load, and the reader falls back').toBe('fallback');
    expect(await s.page.locator('.doc-plain-note').first().textContent()).toBe(READER_FALLBACK_NOTE);
    expect(await s.page.locator('.docs-reader').count(), 'the frame is gone').toBe(0);
    expect(await plainHeadings(s.page, 'Small page'), 'the plain view shows the document').toBeGreaterThan(0);
    expect(s.logs.some((l) => l.includes('ccrc: reader fell back (navigated)')), 'the reason went to the console').toBe(true);
    expect(await s.page.evaluate(() => document.body.outerHTML.includes('navigated')), 'and appears nowhere in the DOM (M8.11)').toBe(false);
    await sleep(800);
    expect((await framesSeen(s.page)).length, 'the body does not mount again (M8.11)').toBe(1);
    expect(origins.hits.slice(from).filter((h) => h.path.startsWith('/nav')), 'the shell meta blocked the navigation').toEqual([]);
  }, 120_000);

  it('M8.B5: an unknown op and a 70 KiB value on the port have no effect', async () => {
    const { s, outcome } = await open('small.md', { hook: {} });
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    expect(await frame.evaluate('typeof window.__ccrcPort'), 'the frame hook captured the frame\'s own port').toBe('object');
    const before = await readerKeys(s.page);
    await frame.evaluate(`(() => {
      const p = window.__ccrcPort;
      p.postMessage({ t: 'frobnicate', x: 1 });
      p.postMessage({ t: 'store.set', key: 'evil:key', value: '1' });
      p.postMessage({ t: 'store.set', key: 'pref:ui', value: JSON.stringify('x'.repeat(70 * 1024)) });
      p.postMessage({ t: 'navigate', href: './other.md', extra: 1 });
    })()`);
    await sleep(1200);
    expect(await readerKeys(s.page), 'no store write').toEqual(before);
    expect(Object.keys(await store(s.page)).includes('evil:key')).toBe(false);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('small.md'));
    // Four refusals are below the sixteen that close the port, and the port still works for a good message.
    await frame.evaluate(`window.__ccrcPort.postMessage({ t: 'store.set', key: 'pref:ui', value: '{"ok":1}' })`);
    await s.page.waitForFunction((k) => localStorage.getItem(k) !== null, `${READER_STORE_PREFIX}pref:ui`, { timeout: 10_000 });
    expect(await settle(s.page, 5_000)).toBe('ready');
  }, 120_000);

  it('M8.B5: a navigate sent before ready has no effect', async () => {
    const early = { t: 'navigate', href: './other.md' };
    const { s, outcome } = await open('small.md', { hook: { earlyOps: [early] } });
    expect(outcome, 'the early op did not break the mount').toBe('ready');
    await sleep(800);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('small.md'));
    expect(await s.page.getByText('Open this link?').count(), 'no sheet').toBe(0);
    // And a navigate after ready does route (the same message, so the early one was dropped for its time alone).
    const frame = await readerFrame(s.page);
    await frame.evaluate(`window.__ccrcPort.postMessage(${JSON.stringify(early)})`);
    await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'), undefined, { timeout: 10_000 });
  }, 120_000);

  /** The M8.B5 control: the srcdoc navigates to the child at once, or (`loadFirst`) in the forced load-first ordering. */
  const childControl = async (loadFirst: boolean): Promise<void> => {
    const child = origins.b + '/child';
    const ops = [
      { t: 'navigate', href: './other.md' },
      { t: 'store.set', key: 'pref:prefs', value: '{"width":"wide"}' },
      { t: 'copy', text: 'child-copy' },
      { t: 'ready', v: 1, nonce: '0'.repeat(32) },
    ];
    // Chrome's local-network checks refuse a sandboxed frame's navigation to a loopback address (the child here is
    // on one), which a child on the public internet would not meet; this one browser has them off, nothing else changed.
    const lna = await checksOffBrowser();
    const s = await openSession({
      index: (html) => html.replace(SHELL_META, ''),
      hook: { holdLoadForChild: true, navigateTo: child, onHello: ops, navigateAfterLoad: loadFirst },
    }, lna);
    sessions.splice(sessions.indexOf(s.app), 1);
    const from = origins.hits.length;
    await s.goto(leafUrl('small.md'));
    expect(await settle(s.page, 30_000)).toBe('fallback');
    await sleep(500);
    const childHits = origins.hits.slice(from).filter((h) => h.origin === 'b' && h.path === '/child');
    expect(childHits.length, 'without the shell meta the frame navigated, and the child loaded').toBeGreaterThan(0);
    // The child received the port: its own word, which the parent records before the child speaks on the port (see
    // holdLoadForChild), read with a bounded wait that names its own failure; the console's hello lines are only shown.
    const hellos = s.logs.filter((l) => l.includes('ccrc-hook hello'));
    const said = await s.page.waitForFunction(
      (href) => (window as unknown as { __childPorts: string[] }).__childPorts.includes(href), child, { timeout: 10_000 },
    ).then(() => true, () => false);
    expect(said, `the child never said, within 10 s, that it holds the port (hello lines captured: ${JSON.stringify(hellos)})`).toBe(true);
    // Every op the child sent reached the reader: its own end of the port received them, in order (each counted after
    // the reader's handler ran it), and the reader fell back on the last, the forged ready (nonce), not on a second
    // load (navigated) or its watchdog (timeout). So the no-effect claims below rest on ops the reader acted on.
    const seen = await s.page.evaluate(() => {
      const w = window as unknown as { __readerPortIn: string[]; __loadCalls: number };
      return { portIn: w.__readerPortIn, loadCalls: w.__loadCalls };
    });
    expect(seen.portIn, 'the reader\'s own end of the port received every op the child sent, in order').toEqual(ops.map((o) => o.t));
    await expect.poll(() => fellBackFor(s.logs), { timeout: 5_000, message: 'the reader fell back once, on the child\'s forged ready (nonce)' })
      .toEqual(['nonce']);
    if (loadFirst) expect(seen.loadCalls, 'the load-first ordering: the srcdoc\'s own load call, then the child\'s, both held').toBe(2);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('small.md'));
    expect(await readerKeys(s.page), 'no store write').toEqual([]);
    expect(await s.page.getByText('Open this link?').count() + await s.page.getByText('Copy with hidden characters?').count(), 'no sheet').toBe(0);
    await s.app.ctx.close();
  };

  it('the controls\' fallback reader reads each reason whole, spaces and parentheses included (review 2432 A3)', () => {
    const line = (reason: string): string => `warning ccrc: reader fell back (${reason})`;
    expect(fellBackFor([
      line('nonce'), 'log ccrc-hook hello srcdoc', line('no host element'), line('mount TypeError: x (y)'), line('images AbortError: z'),
    ])).toEqual(['nonce', 'no host element', 'mount TypeError: x (y)', 'images AbortError: z']);
  });

  it('M8.B5 control: without the shell meta, a navigated child receives the port and still achieves no effect', async () => {
    await childControl(false);
  }, 120_000);

  it('M8.B5 control, load first: the srcdoc\'s own load is taken before the child\'s, and the navigated fallback waits for the child\'s ops', async () => {
    await childControl(true);
  }, 120_000);

  it('M8.B5 wall: with the shell meta present and the local-network checks off, the frame navigating itself reaches nothing (A3)', async () => {
    // The same browser as the control above, the meta left in: any refusal of the navigation is the meta's alone.
    const s = await openSession({}, await checksOffBrowser());
    await s.app.ctx.addInitScript(`if (window === window.top) {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (e) => { window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI); });
    }`);
    await s.goto(leafUrl('small.md'));
    expect(await settle(s.page)).toBe('ready');
    const frame = await readerFrame(s.page);
    const from = origins.hits.length;
    await frame.evaluate(`setTimeout(() => { location.href = ${JSON.stringify(origins.a + '/nav-wall')}; }, 0)`);
    expect(await settle(s.page, 20_000, 'fallback'), 'the blocked self-navigation still fires a second load, and the reader falls back').toBe('fallback');
    await sleep(800);
    expect(origins.hits.slice(from).filter((h) => h.path.startsWith('/nav-wall')), 'the shell meta blocked the navigation: nothing reached origin A').toEqual([]);
    expect(s.responses.filter((u) => u.startsWith(origins.a)), 'and no response came from origin A').toEqual([]);
    // Measured on 5 of 5 runs: the parent document reports the refusal as a frame-src violation naming origin A.
    const violations = await s.page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
    expect(violations.filter((v) => v.startsWith('frame-src ') && v.includes(origins.a.replace(/^https?:\/\//, ''))), 'the parent realm saw the frame-src violation for origin A').not.toEqual([]);
  }, 120_000);

  it('M8.B6 control: a shell meta with script-src self makes the reader fall back (E14)', async () => {
    const s = await openSession({ index: (html) => html.replace(SHELL_META, `<meta http-equiv="Content-Security-Policy" content="frame-src 'none'; script-src 'self'" />`) });
    await s.goto(leafUrl('small.md'));
    expect(await settle(s.page, 30_000), 'the shell\'s script-src reaches the srcdoc child and its inline scripts do not run').toBe('fallback');
    expect(await s.page.locator('.doc-plain-note').first().textContent()).toBe(READER_FALLBACK_NOTE);
    expect(await plainHeadings(s.page, 'Small page'), 'the fallback renders the document').toBeGreaterThan(0);
    expect(s.logs.some((l) => l.includes('ccrc: reader fell back (timeout)')), 'the reason (the watchdog) went to the console').toBe(true);
    expect(await s.page.evaluate(() => document.body.outerHTML.includes('timeout')), 'and appears nowhere in the DOM (M8.11)').toBe(false);
  }, 120_000);

  it("M8.1 live: the iframe's attributes, the csp attribute equal to the srcdoc meta, and focus on mount", async () => {
    const s = await openInserted('small.md');
    const [seen] = await framesSeen(s.page);
    expect(seen).toBeDefined();
    expect(seen?.attrs, 'exactly the four attributes besides srcdoc, set before insertion').toEqual({
      sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', csp: frameCsp(), title: 'small.md',
    });
    const summary = await summariseSrcdoc(s.page, 0);
    expect(summary.head[0]?.content, 'the csp attribute equals the srcdoc meta').toBe(seen?.attrs['csp']);
    expect(seen?.focusedAtInsert, 'the library focused the iframe right after inserting it').toBe(true);
    expect(await settle(s.page)).toBe('ready');
    expect(await s.page.evaluate(() => document.activeElement === document.querySelector('.docs-reader iframe')), 'and it still holds focus at ready').toBe(true);
    await sleep(800);
    expect(await s.page.evaluate(() => document.activeElement === document.querySelector('.docs-reader iframe')), 'and a moment later').toBe(true);
  }, 120_000);

  it('M8.3 live: the srcdoc prefix order, with the meta carrying frameCsp exactly', async () => {
    const s = await openInserted('flow.md');
    const summary = await summariseSrcdoc(s.page, 0);
    const head = summary.head;
    expect(head[0]?.tag).toBe('meta');
    expect(head[0]?.httpEquiv?.toLowerCase()).toBe('content-security-policy');
    expect(head[0]?.content).toBe(frameCsp());
    expect(head[0]?.content).toBe((await framesSeen(s.page))[0]?.attrs['csp']);
    const scripts = head.map((h, i) => ({ ...h, i })).filter((h) => h.tag === 'script');
    const byHash = (h: string): number[] => scripts.filter((x) => x.sha256 === h).map((x) => x.i);
    const guard = byHash(FRAME_MANIFEST.guard.sha256);
    const bootstrap = byHash(FRAME_MANIFEST.bootstrap.sha256);
    const enhance = byHash(FRAME_MANIFEST.enhance.sha256);
    const mermaid = byHash(FRAME_MANIFEST.mermaid.sha256);
    const seeds = scripts.filter((x) => x.type === 'application/json').map((x) => x.i);
    expect({ guard: guard.length, bootstrap: bootstrap.length, enhance: enhance.length, mermaid: mermaid.length, seed: seeds.length },
      'each once; the srcdoc carries Mermaid only when it draws before the mount (on request), never after ready').toEqual({ guard: 1, bootstrap: 1, enhance: 1, mermaid: DRAW === 'after-ready' ? 0 : 1, seed: 1 });
    expect(guard[0], 'the guard follows the meta at once').toBe(1);
    expect(seeds[0], 'the seed follows the guard').toBe(2);
    expect(bootstrap[0], 'the seed is immediately before the bootstrap').toBe(3);
    expect(head.map((h) => h.tag).slice(0, 4)).toEqual(['meta', 'script', 'script', 'script']);
    expect(summary.bodyChildren, 'nothing else is in the document').toBe(0);
    expect(await settle(s.page), 'and the frame starts').toBe('ready');
  }, 240_000);

  it('M8.4 live: no http(s) or // value in src, href, srcset, @import or url() outside script bodies, and no modulepreload or preconnect', async () => {
    const s = await openInserted('flow.md');
    const summary = await summariseSrcdoc(s.page, 0);
    expect(summary.urlAttrs, 'no external URL in an attribute').toEqual([]);
    expect(summary.cssRefs, 'no external @import or url() in a stylesheet').toEqual([]);
    expect(summary.links, 'no link element at all, preconnect and modulepreload included').toEqual([]);
    // The live DOM: nothing the frame drew loads from the network either.
    expect(await settle(s.page), 'the frame starts').toBe('ready');
    const frame = await readerFrame(s.page);
    const live = await frame.evaluate(() => [...document.querySelectorAll('img, source, link, script, iframe, video, audio, object, embed, image')]
      .map((el) => `${el.tagName.toLowerCase()} ${el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('data') ?? ''}`)
      .filter((t) => /\s(?:https?:)?\/\//i.test(t)));
    expect(live, 'no loading element in the frame points at the network').toEqual([]);
  }, 240_000);

  it('M8.6: exactly one contentWindow.postMessage per mount, {t:hello,v:1}, target *, one port; the nonce is in the seed only and new on remount', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const posts = await postsSeen(s.page);
    expect(posts.length, 'one postMessage for the mount').toBe(1);
    expect(posts[0]).toMatchObject({ target: '*', data: { t: 'hello', v: 1 }, ports: 1 });
    expect(Object.keys((posts[0]?.data ?? {}) as object).sort(), 'the hello carries no nonce').toEqual(['t', 'v']);
    const first = await summariseSrcdoc(s.page, 0);
    const seed = JSON.parse(first.seed ?? 'null') as { nonce: string };
    expect(seed.nonce).toMatch(/^[0-9a-f]{32}$/);
    const doc0 = (await framesSeen(s.page))[0]?.srcdoc ?? '';
    expect(doc0.split(seed.nonce).length - 1, 'the nonce appears once in the srcdoc, in the seed').toBe(1);
    // The frame is driven to a second load: the count stays one.
    const frame = await readerFrame(s.page);
    await frame.evaluate(`setTimeout(() => { location.href = ${JSON.stringify(origins.a + '/nav-m86')}; }, 0)`);
    expect(await settle(s.page, 20_000, 'fallback'), 'the second load settles in the fallback').toBe('fallback');
    await sleep(600);
    expect((await postsSeen(s.page)).length, 'a second load posts nothing').toBe(1);

    // A remount (another page, a new body key): a different nonce, a new port, and again exactly one message.
    await s.page.evaluate(() => {
      history.pushState(null, '', '/docs/demo/specs/other.md');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(await settle(s.page)).toBe('ready');
    const after = await postsSeen(s.page);
    expect(after.length, 'the remount posted one more').toBe(2);
    expect(after[1]).toMatchObject({ target: '*', data: { t: 'hello', v: 1 }, ports: 1 });
    const second = JSON.parse((await summariseSrcdoc(s.page, -1)).seed ?? 'null') as { nonce: string };
    expect(second.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(second.nonce, 'a new nonce').not.toBe(seed.nonce);
    expect(await s.page.evaluate(() => {
      const ports = (window as unknown as { __postPorts: unknown[] }).__postPorts;
      return ports.length === 2 && ports[0] !== ports[1];
    }), 'a new port').toBe(true);
  }, 120_000);

  it('E16: pushState inside the frame does not change the console URL; clipboard.writeText inside the frame is refused; the copy op still reaches the parent sheet', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    const url = s.page.url();
    const length = await s.page.evaluate(() => history.length);
    const got = (await frame.evaluate(`(async () => {
      const out = {};
      try { history.pushState({ e16: 1 }, '', '#e16'); out.push = 'ok'; } catch (e) { out.push = e && e.name; }
      try { await navigator.clipboard.writeText('e16'); out.clip = 'ok'; } catch (e) { out.clip = e && e.name; }
      return out;
    })()`)) as { push: string; clip: string };
    console.log(`T10-FIGURES e16 ${JSON.stringify(got)}`);
    expect(s.page.url(), 'the console URL did not move').toBe(url);
    expect(await s.page.evaluate(() => history.length), 'and no entry joined the console history').toBe(length);
    expect(got.clip, 'the frame cannot write the clipboard itself').not.toBe('ok');
    // The copy op: a tap on the block's Copy reaches the parent, which asks first because the text holds an ESC.
    await frame.locator('.code-copy').first().click();
    await s.page.getByText('Copy with hidden characters?').waitFor({ timeout: 10_000 });
    expect(await s.page.getByText('U+001B').count(), 'the sheet names the hidden character').toBeGreaterThan(0);
  }, 120_000);

  it('M8.8: a seed value with </script><script> and U+2028 round-trips inert, and ids named like every bootstrap global change nothing', async () => {
    const s = await openInserted('m88.md');
    const summary = await summariseSrcdoc(s.page, 0);
    const seedText = summary.seed ?? '';
    expect(seedText.length).toBeGreaterThan(0);
    for (const bad of ['<', '>', '&', LS, String.fromCharCode(0x2029)]) expect(seedText.includes(bad), `the seed text holds no raw ${JSON.stringify(bad)}`).toBe(false);
    const seed = JSON.parse(seedText) as { title: string; frontList: { key: string; vals: string[] }[] };
    expect(seed.title, 'the hostile title round-trips').toBe(`Title ${SCRIPT_CLOSE}${LS}h`);
    expect(seed.frontList.some((f) => f.vals.includes(`${SCRIPT_CLOSE}${LS}fm`)), 'the hostile front-matter value round-trips').toBe(true);
    // The frame holds exactly the scripts the prefix carries, and the hostile text is text.
    expect(await settle(s.page), 'the document reaches ready').toBe('ready');
    const frame = await readerFrame(s.page);
    // Mermaid has run while every bootstrap global is also an id in the document.
    if (DRAW === 'on-request') await frame.locator('.fig-render-btn').click();
    await frame.waitForFunction(() => document.querySelector('figure.mermaid-figure')?.getAttribute('data-docreader-draw') === 'drawn', undefined, { timeout: 90_000 });
    const live = await frame.evaluate((names) => ({
      // A name the bootstrap pinned reads as its own property; one it did not would read as the element with that id.
      shadowed: names.filter((n) => (window as unknown as Record<string, unknown>)[n] instanceof Element),
      scripts: document.querySelectorAll('script').length,
      text: document.body.textContent ?? '',
      missing: names.filter((n) => document.getElementById(n) === null),
      duplicated: names.filter((n) => document.querySelectorAll(`[id="${n}"]`).length !== 1),
      drawn: document.querySelectorAll('figure.mermaid-figure svg').length,
    }), [...BOOTSTRAP_GLOBALS]);
    expect(live.scripts, 'guard, seed, bootstrap, enhance and Mermaid, and nothing planted').toBe(5);
    expect(live.text.includes(`Body ${SCRIPT_CLOSE}${LS} text`), 'the body text holds the hostile run and U+2028 exactly').toBe(true);
    expect(live.missing, `every one of the ${BOOTSTRAP_GLOBALS.length} bootstrap globals renders as an id`).toEqual([]);
    expect(live.duplicated, 'each exactly once').toEqual([]);
    expect(live.drawn, 'and the figure drew').toBe(1);
    expect(live.shadowed, 'no global the bootstrap guards reads as the element with its id (the pin holds)').toEqual([]);
    expect(s.app.errors, 'no uncaught error in the page or the frame').toEqual([]);
    expect(s.logs.filter((l) => l.startsWith('error ')), 'and no console error').toEqual([]);
    expect(await frame.evaluate('typeof window.location + typeof window.document'), 'and the frame\'s own globals are its own').toBe('objectobject');
    // The frame still behaves.
    await frame.getByRole('link', { name: 'the other page' }).click();
    await s.page.waitForFunction(() => location.pathname.endsWith('/other.md'), undefined, { timeout: 10_000 });
    expect(await settle(s.page)).toBe('ready');
  }, 120_000);

  it('M8.20 live: a 25-fence doc shows every figure as source and inlines no Mermaid', async () => {
    const s = await openInserted('many.md');
    const summary = await summariseSrcdoc(s.page, 0);
    expect(summary.head.filter((h) => h.sha256 === FRAME_MANIFEST.mermaid.sha256), 'no script is the Mermaid text').toEqual([]);
    expect((await framesSeen(s.page))[0]?.srcdoc.length, 'and the srcdoc is nowhere near the Mermaid text').toBeLessThan(FRAME_MANIFEST.mermaid.chars);
    expect(await settle(s.page), 'the frame starts').toBe('ready');
    if (DRAW === 'after-ready') {
      expect(s.responses.filter((u) => /mermaid\.frame-[^/]*\.js/.test(u)), 'no Mermaid chunk was fetched (the library\'s gate kept the loader from being called)').toEqual([]);
    }
    const frame = await readerFrame(s.page);
    const figures = await frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => ({
      source: (f.querySelector('pre')?.textContent ?? '').trim().length, render: f.querySelectorAll('.fig-render-btn').length, svgs: f.querySelectorAll('svg').length,
    })));
    expect(figures.length, 'every figure is there').toBe(25);
    expect(figures.filter((f) => f.source === 0), 'each shows its source').toEqual([]);
    expect(figures.filter((f) => f.render !== 0 || f.svgs !== 0), 'no Render button, no drawing').toEqual([]);
  }, 120_000);

  it.each(['the console', 'a Docs tab'] as const)('the reader is sized to the Docs pane and only the frame scrolls, at 1280x800 and 390x844, in %s', async (where) => {
    const problems: string[] = [];
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      const { s, outcome } = await open('long.md', { width: w, height: h, ...(where === 'a Docs tab' ? { tab: 'docs' as const } : {}) });
      if (where === 'a Docs tab') expect(await s.page.evaluate(() => document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null), `${w}x${h}: a Docs tab`).toBe('docs');
      expect(outcome, `${w}x${h}: the reader is up`).toBe('ready');
      const m = await s.page.evaluate(() => {
        const reader = document.querySelector('.docs-reader');
        if (reader === null) return null;
        const r = reader.getBoundingClientRect();
        const se = document.scrollingElement as Element;
        const scrollers: { tag: string; cls: string; scrollHeight: number; clientHeight: number }[] = [];
        for (let n: Element | null = reader.parentElement; n !== null; n = n.parentElement) {
          if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) {
            scrollers.push({ tag: n.tagName, cls: String(n.className), scrollHeight: n.scrollHeight, clientHeight: n.clientHeight });
          }
        }
        // The lower bound: the reader reaches the bottom of what its screen holds, and the screen reaches the pane's.
        const screen = reader.closest('.docs-screen');
        const pane = reader.closest('.shell-detail');
        const frameBox = reader.querySelector('iframe')?.getBoundingClientRect() ?? null;
        const screenBottom = screen?.getBoundingClientRect().bottom ?? NaN;
        return {
          innerHeight: window.innerHeight, readerTop: Math.round(r.top), readerBottom: r.bottom, readerHeight: r.height,
          docScrollHeight: se.scrollHeight, docClientHeight: se.clientHeight, scrollers,
          paneBottom: pane?.getBoundingClientRect().bottom ?? NaN, screenBottom,
          screenPadBottom: screen === null ? NaN : parseFloat(getComputedStyle(screen).paddingBottom),
          frameHeight: frameBox?.height ?? NaN,
        };
      });
      expect(m, `${w}x${h}: the reader is in the page`).not.toBeNull();
      const got = m as NonNullable<typeof m>;
      if (got.readerBottom > got.innerHeight + 1) problems.push(`${w}x${h}: the reader's bottom is below the viewport ${JSON.stringify(got)}`);
      const room = got.screenBottom - got.screenPadBottom;
      if (Math.abs(room - got.readerBottom) > 2) problems.push(`${w}x${h}: the reader does not fill the screen: its bottom ${got.readerBottom} against the screen's content bottom ${room} ${JSON.stringify(got)}`);
      if (got.paneBottom - got.readerBottom > got.screenPadBottom + 2) problems.push(`${w}x${h}: the reader stops short of the pane's bottom (${got.paneBottom - got.readerBottom}px, the screen pads ${got.screenPadBottom}px) ${JSON.stringify(got)}`);
      if (Math.abs(got.paneBottom - got.screenBottom) > 2) problems.push(`${w}x${h}: the screen does not reach the pane's bottom ${JSON.stringify(got)}`);
      if (Math.abs(got.frameHeight - got.readerHeight) > 1) problems.push(`${w}x${h}: the iframe is not the reader's height ${JSON.stringify(got)}`);
      if (got.docScrollHeight > got.docClientHeight + 1) problems.push(`${w}x${h}: the document scrolls ${JSON.stringify(got)}`);
      if (got.scrollers.length > 0) problems.push(`${w}x${h}: an ancestor of the reader scrolls ${JSON.stringify(got.scrollers)}`);
      const frame = await readerFrame(s.page);
      const inner = await frame.evaluate(() => {
        const se = document.scrollingElement as Element;
        return { scrollHeight: se.scrollHeight, clientHeight: se.clientHeight };
      });
      if (inner.scrollHeight <= inner.clientHeight + 1) problems.push(`${w}x${h}: the frame's own document does not scroll for a long page ${JSON.stringify(inner)}`);
      await s.app.ctx.close();
      sessions.splice(sessions.indexOf(s.app), 1);
    }
    expect(problems, 'the reader is one pane tall and only its frame scrolls, at both sizes').toEqual([]);
  }, 180_000);

  it('the worst case renders inside the watchdog', async () => {
    const files = FILES.get('worst.md');
    expect(typeof files === 'string' && Buffer.byteLength(files, 'utf8')).toBe(WORST_BYTES);
    const images = [...FILES].filter(([p]) => p.startsWith('pix-'));
    expect(images.length).toBe(DOCS_MAX_IMAGES_PER_PAGE);
    expect(images.reduce((n, [, b]) => n + sizeOf(b), 0), '30 images totalling the budget').toBe(READER_IMAGE_BUDGET_BYTES);
    expect(sniffRaster('png', images[0]?.[1] as Uint8Array)).toBe('match');
    const t0 = Date.now();
    const { s, outcome } = await open('worst.md');
    const wall = Date.now() - t0;
    expect(outcome, 'ready inside the watchdog, not the fallback').toBe('ready');
    const m = await s.page.evaluate(() => {
      const mark = (n: string): number => performance.getEntriesByName(n).at(-1)?.startTime ?? NaN;
      const w = window as unknown as { __frames: { srcdoc: string }[]; __readyAts: number[] };
      return {
        srcdocChars: w.__frames.at(-1)?.srcdoc.length ?? 0,
        mountMs: mark('ccrc-reader-mount-end') - mark('ccrc-reader-mount-start'),
        readyMs: (w.__readyAts.at(-1) ?? NaN) - mark('ccrc-reader-mount-start'),
      };
    });
    const summary = await summariseSrcdoc(s.page, 0);
    const seed = JSON.parse(summary.seed ?? 'null') as { images: unknown };
    const imageCount = Array.isArray(seed.images) ? seed.images.length : Object.keys(seed.images as object).length;
    const frame = await readerFrame(s.page);
    const painted = await frame.evaluate(() => ({
      imgs: document.querySelectorAll('img').length, decoded: [...document.querySelectorAll('img')].filter((i) => i.naturalWidth === 1).length,
      elements: document.querySelectorAll('*').length,
    }));
    console.log(`T10-FIGURES worst ${JSON.stringify({ ...m, wallMs: wall, budget: READER_IMAGE_BUDGET_BYTES, seedImages: imageCount, painted })}`);
    expect(summary.head.filter((h) => h.sha256 === FRAME_MANIFEST.mermaid.sha256).length,
      DRAW === 'after-ready' ? 'no head script is the Mermaid text (it loads after ready)' : 'the Mermaid text is inlined once (the gate passed)')
      .toBe(DRAW === 'after-ready' ? 0 : 1);
    // Arm A keeps this out of its arm: the 30 images (about 7 million characters of base64) hold the srcdoc over Mermaid's
    // length in both arms, so the size says nothing about Mermaid there; `srcdocChars` is recorded beside BASE above.
    if (DRAW === 'on-request') expect(m.srcdocChars).toBeGreaterThan(FRAME_MANIFEST.mermaid.chars);
    expect(imageCount, 'all 30 images are in the seed').toBe(DOCS_MAX_IMAGES_PER_PAGE);
    expect(painted.decoded, 'and all 30 decode in the frame').toBe(DOCS_MAX_IMAGES_PER_PAGE);
    expect(m.readyMs, 'ready arrived').toBeGreaterThan(0);
  }, 300_000);

  // ---- the mount's focus yields to a host control (D-8729, completion plan Task 13) ---------------------------------------
  // The defect (desktop polish c16, fix round 2; c18's correction): a lazily loaded reader took focus from a head control the
  // reader of the page had already moved to, and the next Tab jumped from the frame to an unrelated stop. The bridge chunk
  // is held here, so "the page's reader moves focus before the mount" is a fact the case makes, not a race it hopes for. No
  // case focuses anything after the reader mounted and then claims focus was kept: every focus move is before the release.
  describe('the mount yields focus to a host control, and takes it when no one owns it (D-8729)', () => {
    /** docs-compact-head's `DEEPER_CASES`: both skins, 5 and 7 directories, 600 x 960 and 900 x 800, under a fine pointer. */
    const DESK_CASES = [INSTRUMENT, REFINED].flatMap((skin) => DEEP_DIRS.flatMap((dirs) =>
      ([[600, 960], [900, 800]] as const).map(([w, h]) => [skin, dirs, w, h] as const)));

    it.each(DESK_CASES)('desk-born, %s, %i directories, %i x %i: back keeps the focus a reader of the page gave it, the frame is not focused at insertion, and the first Tab stop is the first crumb, seen whole', async (skin, dirs, width, height) => {
      const s = await openSession({ openWidth: Math.max(width, 900), width, height, skin });
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl(deepPath(dirs)));
      await bridge.arrival();
      expect((await framesSeen(s.page)).length, 'held: no frame yet').toBe(0);
      // Unfold the crumbs (the compact-head case's setup), then go to back by KEYBOARD: Shift+Tab from where the click left focus.
      await s.page.locator('.docs-full .docs-crumbs-more').click({ timeout: 30_000 });
      await tabTo(s.page, '.docs-full .docs-back', 'Shift+Tab');
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
      expect(await activeOf(s.page), 'back still holds the focus at ready (nothing focused after the mount)').toMatchObject({ onFrame: false, cls: 'docs-back' });
      // And a moment later, as M8.1 live checks the positive side: a focus the frame took after ready would show here.
      await sleep(800);
      expect(await activeOf(s.page), 'and a moment later').toMatchObject({ onFrame: false, cls: 'docs-back' });
      await s.page.keyboard.press('Tab');
      const first = await s.page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const nav = document.querySelector('.docs-full .docs-crumbs')!.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        return { text: a.textContent ?? '', seen: Math.max(0, Math.min(b.right, nav.right) - Math.max(b.left, nav.left)), w: b.width };
      });
      expect(first.text, 'the first Tab stop after back is the first crumb').toBe(DOCS_HEAD_TEXT.index);
      expect(first.seen, 'it is seen whole').toBeGreaterThanOrEqual(first.w - 0.5);
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 180_000);
    /** Phone-born: the leaf opens at 412 x 915, so the mount asks for ccrc's one bar (`docs/readerBar.ts`). */
    const PHONE_VIEW = { width: 412, height: 915 } as const;
    /** ccrc's phone bar: its doors are outside the Docs head and outside the reader, and the head's swap does not touch them. */
    const PHONE_DOOR = '.phone-bar-door';

    it('phone-born, a phone bar door: it keeps the focus a reader of the page gave it, the frame is not focused at insertion, and Tab goes to the next stop of the host, not into the frame', async () => {
      const s = await openSession(PHONE_VIEW);
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl('small.md'));
      await bridge.arrival();
      expect((await framesSeen(s.page)).length, 'held: no frame yet').toBe(0);
      // By KEYBOARD: Tab from the top of the page to the bar's first door (the skip link and the compact head come first).
      await tabTo(s.page, PHONE_DOOR, 'Tab');
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await s.page.evaluate(() => document.querySelector('.docs-head')?.classList.contains('docs-one-bar')), 'on ccrc\'s one bar').toBe(true);
      expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
      const door = await s.page.evaluate((sel) => document.activeElement?.matches(sel) === true, PHONE_DOOR);
      expect(door, 'the door still holds the focus at ready (nothing focused after the mount)').toBe(true);
      await sleep(800);
      expect(await s.page.evaluate((sel) => document.activeElement?.matches(sel) === true, PHONE_DOOR), 'and a moment later').toBe(true);
      const next = await nextStopAfter(s.page, ':focus');
      expect(next, 'the host has a stop after the door, and it is not the frame').toMatch(/^button\./);
      await s.page.keyboard.press('Tab');
      const landed = await s.page.evaluate(() => {
        const a = document.activeElement;
        return a === null ? 'null' : `${a.tagName.toLowerCase()}.${String(a.className)}`;
      });
      expect(landed, 'Tab goes to the next stop after the door in the host\'s own DOM order, not into the frame and not to body').toBe(next);
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 120_000);

    // The phone head is one shell for both states (`DocsHead.tsx#PhoneHead`): the compact row and the one bar draw the same
    // `header`, the same row and the same back button, so the swap at ready replaces only the controls after back and the
    // panel's tail. A reader of the page who focused back while the chunk loaded therefore keeps it: the very element, held
    // here by a handle taken before the release, is the active element at ready. Nothing refocuses it (the mount takes no
    // focus when a host control holds it, and the head calls no `focus()` on back).
    it('phone-born, back: the very same element holds the focus across the swap to the one bar, the frame is not focused at insertion, and Tab goes to the next stop of the one bar', async () => {
      const s = await openSession(PHONE_VIEW);
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl('small.md'));
      await bridge.arrival();
      expect((await framesSeen(s.page)).length, 'held: no frame yet').toBe(0);
      expect(await s.page.evaluate(() => document.querySelector('.docs-head')?.classList.contains('docs-one-bar')), 'held: the compact row').toBe(false);
      // The tree is in: the compact ROW (the shell), not the tree-less head, whose back is another element.
      await s.page.locator('.docs-compact .docs-compact-bar').waitFor({ timeout: 30_000 });
      // By KEYBOARD: Tab from the top of the page to the compact head's back, and keep a handle to that element.
      await tabTo(s.page, '.docs-compact .docs-compact-bar .docs-back', 'Tab');
      const handle = await s.page.evaluateHandle(() => document.activeElement);
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await s.page.evaluate(() => document.querySelector('.docs-head')?.classList.contains('docs-one-bar')), 'on ccrc\'s one bar').toBe(true);
      expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
      expect((await activeOf(s.page)).onFrame, 'and the frame does not hold the focus at ready').toBe(false);
      const kept = await s.page.evaluate((el) => ({
        same: document.activeElement === el, connected: el instanceof Element && el.isConnected,
        back: el instanceof Element && el.matches('.docs-one-bar .docs-compact-bar > .docs-back'),
      }), handle);
      expect(kept, 'the very same element holds the focus, and it is the one bar\'s back').toEqual({ same: true, connected: true, back: true });
      await sleep(800);
      expect(await s.page.evaluate((el) => document.activeElement === el, handle), 'and a moment later').toBe(true);
      // The next stop in the one bar's DOM order, computed before the press.
      const next = await nextStopAfter(s.page, ':focus');
      expect(next, 'the one bar has a stop after back, and it is the title').toBe('button.docs-title');
      await s.page.keyboard.press('Tab');
      const landed = await s.page.evaluate(() => {
        const a = document.activeElement;
        return {
          inFrame: a !== null && a === document.querySelector('.docs-reader iframe'), inHead: a?.closest('.docs-head') != null,
          at: a === null ? 'null' : `${a.tagName.toLowerCase()}.${String(a.className)}`,
        };
      });
      expect(landed, 'one Tab goes to the next stop of the one bar, not into the frame').toEqual({ inFrame: false, inHead: true, at: next });
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 120_000);

    // A Docs tab (desktop polish wave 174, fix round 3): the reader alone, the window's width its pane's. At a desk its bar's
    // link back is the first stop after the skip link, then the head; on a phone it has no bar, and the head is the top.
    it.each(DEEP_DIRS.flatMap((dirs) => [INSTRUMENT, REFINED].map((skin) => [skin, dirs] as const)))('a Docs tab, desk-born, %s, %i directories, 900 x 800: back keeps the focus a reader of the page gave it, the frame is not focused at insertion, and the next Tab stop is the first crumb, seen whole', async (skin, dirs) => {
      const s = await openSession({ width: 900, height: 800, skin, tab: 'docs' });
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl(deepPath(dirs)));
      await bridge.arrival();
      expect((await framesSeen(s.page)).length, 'held: no frame yet').toBe(0);
      expect(await s.page.evaluate(() => document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null), 'a Docs tab').toBe('docs');
      await s.page.locator('.docs-full .docs-back').waitFor({ timeout: 30_000 });
      // The crumbs unfolded where the row folded them, as in the console's case; at this width the row may have room for all.
      const more = s.page.locator('.docs-full .docs-crumbs-more');
      if (await more.count() > 0) {
        await more.click({ timeout: 30_000 });
        await tabTo(s.page, '.docs-full .docs-back', 'Shift+Tab');
      } else {
        await tabTo(s.page, '.docs-full .docs-back', 'Tab');
      }
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
      expect(await activeOf(s.page), 'back still holds the focus at ready').toMatchObject({ onFrame: false, cls: 'docs-back' });
      await sleep(800);
      expect(await activeOf(s.page), 'and a moment later').toMatchObject({ onFrame: false, cls: 'docs-back' });
      await s.page.keyboard.press('Tab');
      const first = await s.page.evaluate(() => {
        const a = document.activeElement as HTMLElement;
        const nav = document.querySelector('.docs-full .docs-crumbs')!.getBoundingClientRect();
        const b = a.getBoundingClientRect();
        return { text: a.textContent ?? '', seen: Math.max(0, Math.min(b.right, nav.right) - Math.max(b.left, nav.left)), w: b.width };
      });
      expect(first.text, 'the first Tab stop after back is the first crumb').toBe(DOCS_HEAD_TEXT.index);
      expect(first.seen, 'it is seen whole').toBeGreaterThanOrEqual(first.w - 0.5);
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 180_000);

    it('a Docs tab, phone-born, back: the very same element holds the focus across the swap to the one bar, the frame is not focused at insertion, and Tab goes to the next stop of the one bar', async () => {
      const s = await openSession({ ...PHONE_VIEW, tab: 'docs' });
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl('small.md'));
      await bridge.arrival();
      expect(await s.page.evaluate(() => document.querySelector('.app-shell')?.getAttribute('data-tab') ?? null), 'a Docs tab').toBe('docs');
      expect(await s.page.locator('header.shell-tab-bar, nav.shell-phone-nav').count(), 'no bar on a phone').toBe(0);
      await s.page.locator('.docs-compact .docs-compact-bar').waitFor({ timeout: 30_000 });
      await tabTo(s.page, '.docs-compact .docs-compact-bar .docs-back', 'Tab');
      const handle = await s.page.evaluateHandle(() => document.activeElement);
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await s.page.evaluate(() => document.querySelector('.docs-head')?.classList.contains('docs-one-bar')), 'on ccrc\'s one bar').toBe(true);
      expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
      const kept = await s.page.evaluate((el) => ({
        same: document.activeElement === el, connected: el instanceof Element && el.isConnected,
        back: el instanceof Element && el.matches('.docs-one-bar .docs-compact-bar > .docs-back'),
      }), handle);
      expect(kept, 'the very same element holds the focus, and it is the one bar\'s back').toEqual({ same: true, connected: true, back: true });
      const next = await nextStopAfter(s.page, ':focus');
      expect(next, 'the one bar has a stop after back, and it is the title').toBe('button.docs-title');
      await s.page.keyboard.press('Tab');
      const at = await s.page.evaluate(() => { const a = document.activeElement; return a === null ? 'null' : `${a.tagName.toLowerCase()}.${String(a.className)}`; });
      expect(at, 'one Tab goes to the next stop of the one bar, not into the frame').toBe(next);
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 120_000);

    it('nothing owns focus when the reader mounts, phone-born: the frame IS focused at insertion and at ready (M8.1 kept; the 1280 case is "M8.1 live")', async () => {
      const s = await openSession(PHONE_VIEW);
      const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
      await s.goto(leafUrl('small.md'));
      await bridge.arrival();
      expect((await activeOf(s.page)).tag, 'held, with nothing focused').toBe('body');
      await bridge.release();
      expect(await settle(s.page), 'the reader came up').toBe('ready');
      expect(await insertFocus(s.page), 'the library focused the iframe right after inserting it').toEqual([true]);
      expect((await activeOf(s.page)).onFrame, 'and it holds focus at ready').toBe(true);
    }, 120_000);

    // The Mermaid wait: on request (E17 does not hold), a document whose figures the gate inlines makes the bridge load the
    // Mermaid text before it mounts. The decision reads focus once, after that last await, so a focus move DURING the wait
    // counts and one BEFORE it that ended inside the wait does not.
    describe.skipIf(DRAW !== 'on-request')('the focus is read after the bridge\'s last wait (the held Mermaid chunk)', () => {
      it('a head control focused while the Mermaid text is held keeps its focus; the frame is not focused at insertion', async () => {
        const s = await openSession({ width: 1280, height: 800 });
        const mermaid = await holdChunk(s.app.ctx, 'Mermaid text', MERMAID_CHUNK);
        await s.goto(leafUrl('fig.md'));
        await mermaid.arrival();
        expect((await framesSeen(s.page)).length, 'held on the Mermaid wait: no frame yet').toBe(0);
        await tabTo(s.page, '.docs-full .docs-back', 'Tab');
        await mermaid.release();
        expect(await settle(s.page), 'the reader came up').toBe('ready');
        expect(await insertFocus(s.page), 'one frame, not focused when it was inserted').toEqual([false]);
        expect(await activeOf(s.page), 'back still holds the focus at ready').toMatchObject({ onFrame: false, cls: 'docs-back' });
      }, 120_000);

      it('a head control focused BEFORE the Mermaid wait, then blurred while it is held: the frame IS focused at insertion', async () => {
        const s = await openSession({ width: 1280, height: 800 });
        const bridge = await holdChunk(s.app.ctx, 'reader bridge', BRIDGE_CHUNK);
        const mermaid = await holdChunk(s.app.ctx, 'Mermaid text', MERMAID_CHUNK);
        await s.goto(leafUrl('fig.md'));
        await bridge.arrival();
        await tabTo(s.page, '.docs-full .docs-back', 'Tab');
        await bridge.release();
        await mermaid.arrival();
        expect((await framesSeen(s.page)).length, 'held on the Mermaid wait: no frame yet').toBe(0);
        expect((await activeOf(s.page)).cls, 'back still holds the focus while the Mermaid text is held').toBe('docs-back');
        await s.page.evaluate(() => (document.activeElement as HTMLElement).blur());
        expect((await activeOf(s.page)).tag, 'focus is on body').toBe('body');
        await mermaid.release();
        expect(await settle(s.page), 'the reader came up').toBe('ready');
        expect(await insertFocus(s.page), 'no one owned focus when the mount read it, so the frame was focused when inserted').toEqual([true]);
        expect((await activeOf(s.page)).onFrame, 'and it holds focus at ready').toBe(true);
      }, 120_000);
    });
  });

  // ---- hidden characters through the real library (completion plan Task 13) ----------------------------------------------------
  // The W8a residue: the copy check had never run against the real library for U+202E and U+200B. The frame's Copy tap posts
  // the block's text and the library's own scan of it; the console asks first and writes only from the sheet's own button.
  it('M8.B5 copy: a block holding U+202E and U+200B asks first, naming both, and the clipboard is written only by the sheet\'s own button', async () => {
    const { s, outcome } = await open('hidden.md', { hook: { recordClipboard: true } });
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    expect(await clipboardWrites(s.page), 'the hook is in place and nothing was written yet').toEqual([]);
    await frame.locator('.code-copy').first().click();
    await s.page.getByText('Copy with hidden characters?').waitFor({ timeout: 10_000 });
    const shown = (await s.page.locator('.docs-reader-sheet-text').textContent()) ?? '';
    expect(shown, 'the sheet names U+202E').toMatch(/⟦U\+202E [^⟧]+⟧/);
    expect(shown, 'the sheet names U+200B').toMatch(/⟦U\+200B [^⟧]+⟧/);
    expect(shown.includes(RLO) || shown.includes(ZWSP), 'and shows the characters as markers, not as themselves').toBe(false);
    // The sheet is up, so the copy decision was "ask": no write has happened and none is pending.
    expect(await clipboardWrites(s.page), 'nothing is written while the sheet asks').toEqual([]);
    await s.page.getByRole('button', { name: 'Copy anyway' }).click();
    await s.page.waitForFunction(() => (window as unknown as { __clipWrites: string[] }).__clipWrites.length > 0, undefined, { timeout: 10_000 });
    const written = await clipboardWrites(s.page);
    expect(written.length, 'one write').toBe(1);
    expect(written[0], 'of the block\'s exact text (the fence\'s closing newline included), hidden characters in place').toBe(`${HIDDEN_BLOCK}\n`);
    await s.page.getByText('Copy with hidden characters?').waitFor({ state: 'detached', timeout: 10_000 });
  }, 120_000);

  // ---- the meta-only row's own control (completion plan Task 13; the W8a residue's first control gap) ----------------------------
  // Measured (Chromium build 1248, library 1.1.0, 20 metas written by the parent hook with the csp attribute suppressed):
  // the frame's boot gate (`He` in `assets/frame/bootstrap.js`: the policy floor, `cspFloor` in `dist/frame/csp-rules.js`) admits only
  // a policy of `default-src 'none'`, hash sources in `script-src`, `data:` (and `'unsafe-inline'` for styles) in the others,
  // and `base-uri` and `form-action` of 'none'. So no meta that BOOTS has a network source: every meta that would open a
  // channel (a `connect-src`, `img-src http: https:` or `*` or origin A, `default-src *`, a dropped `default-src`) is refused, and the reader
  // falls back (reason "error", the frame removed). The changes that do boot are reorderings, a trailing semicolon and an
  // extra script hash, none of which opens a channel. A control in which the battery reaches the origins through a booted
  // frame therefore cannot be built; the two cases below pin both halves: a permissive meta never boots, and a meta that
  // boots still reaches nothing. Their mutation needs two files (the frame asset's gate and the host's asset hash check).
  describe('M8.B1 meta-only, what a changed meta can do (completion plan Task 13)', () => {
    const PERMISSIVE: readonly (readonly [string, (a: string) => string])[] = [
      ['a connect-src of *', (m) => `${m}; connect-src *`],
      ['an img-src of http: and https:', (m) => m.replace(/img-src [^;]*/, 'img-src data: http: https:')],
      ['an img-src naming origin A', (m) => m.replace(/img-src [^;]*/, `img-src data: ${origins.a}`)],
      ['a default-src of *', (m) => m.replace("default-src 'none'", 'default-src *')],
    ];
    it.each(PERMISSIVE)('a meta with %s does not boot: the reader falls back, so the battery has no frame to reach the origins from', async (_name, weaken) => {
      const meta = weaken(frameCsp());
      expect(meta, 'the weakened meta differs from the library\'s').not.toBe(frameCsp());
      const s = await openSession({ hook: { skipCspAttr: true, srcdocMeta: meta } });
      await s.goto(leafUrl('small.md'));
      let reach = '';
      const outcome = await settle(s.page, 30_000);
      if (outcome === 'ready') {
        const from = origins.hits.length;
        await runBattery(await readerFrame(s.page));
        reach = ` (it booted, and the battery then reached ${reached(from).length} of ${CHANNELS.length}: ${reached(from).join(',')})`;
      }
      expect(outcome, `the boot gate refuses a policy with a network source${reach}`).toBe('fallback');
      expect((await summariseSrcdoc(s.page, 0)).head[0]?.content, 'the frame was parsed under the weakened meta (the rewrite took)').toBe(meta);
      expect((await framesSeen(s.page))[0]?.attrs['csp'], 'and no csp attribute').toBeUndefined();
      expect(fellBackFor(s.logs), 'the reader fell back on the frame\'s error').toEqual(['error']);
    }, 120_000);

    it('a meta changed only by an extra script hash boots, and the battery still reaches 0 of 27', async () => {
      const meta = frameCsp().replace(/(script-src [^;]*)/, `$1 'sha256-${'A'.repeat(43)}='`);
      expect(meta, 'the meta differs from the library\'s').not.toBe(frameCsp());
      const s = await openSession({ hook: { skipCspAttr: true, srcdocMeta: meta } });
      await s.goto(leafUrl('small.md'));
      expect(await settle(s.page, 30_000), 'a floor-clean change boots').toBe('ready');
      expect((await summariseSrcdoc(s.page, 0)).head[0]?.content, 'under the changed meta').toBe(meta);
      const from = origins.hits.length;
      const run = await runBattery(await readerFrame(s.page));
      expect(run.attempted.length).toBe(CHANNELS.length * 2);
      expect(reached(from), '0 of 27 reach A or B').toEqual([]);
      const refused = new Set(run.violations.map((v) => v.split('/battery/')[1]?.split('?')[0]).filter((n): n is string => n !== undefined));
      expect(refused.size, `the changed meta refused the channels (${[...refused].join(',')})`).toBeGreaterThanOrEqual(20);
    }, 120_000);
  });

  // ---- a link to this very page, in Chrome (completion plan Task 13; the coordinator's conditions, ask 553) -----------------------
  // self.md links to itself by file name with a fragment near its top, and holds the target far down. The link routes as a
  // `hash` with `reopen`: the console rewrites the fragment and opens the same document again in this body's mount, so no
  // body is read again. A bare `#id` link is the library's own in-frame hash path and remounts nothing.
  describe('a link to this page spelled with its file name (completion plan Task 13)', () => {
    const DOC = `${READER_STORE_PREFIX}doc:${PROJECT}:${SECTION}:self.md:`;
    const openSelf = async (): Promise<{ s: Session; frame: Frame }> => {
      const { s, outcome } = await open('self.md');
      expect(outcome).toBe('ready');
      const frame = await readerFrame(s.page);
      const at = await topIn(frame, FAR_ID);
      expect(at, 'the page has the target').not.toBeNull();
      expect(at!.top, 'it is far below the first screen, so reaching it takes a scroll').toBeGreaterThan(at!.viewport * 2);
      expect(fileReads(s, 'self.md'), 'the page was read once').toBe(1);
      return { s, frame };
    };
    const framesCount = (s: Session): Promise<number> => framesSeen(s.page).then((f) => f.length);

    it('remounts the frame at the target: a second iframe, the target in view, the new frame focused, no body read again, no history entry', async () => {
      const { s, frame } = await openSelf();
      const old = await s.page.locator('.docs-reader iframe').elementHandle();
      const entries = await s.page.evaluate(() => history.length);
      const reads = { file: fileReads(s, 'self.md'), log: historyReads(s, 'self.md'), all: s.apiHits.length };
      await frame.getByRole('link', { name: 'the far target' }).click();
      await s.page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length === 2, undefined, { timeout: 10_000 });
      expect(await old!.evaluate((e) => e.isConnected), 'the first frame was removed').toBe(false);
      const again = await readerFrame(s.page);
      await expect.poll(async () => inView(await topIn(again, FAR_ID)), {
        timeout: 30_000, message: 'the target is not in the new frame\'s viewport (its top must be inside 0 and the frame\'s height)',
      }).toBe(true);
      expect(await s.page.evaluate(() => location.hash), 'the address bar holds the fragment').toBe(`#${FAR_ID}`);
      expect(await s.page.evaluate(() => history.length), 'the jump added no history entry (the fragment is rewritten)').toBe(entries);
      expect({ file: fileReads(s, 'self.md'), log: historyReads(s, 'self.md'), all: s.apiHits.length }, 'no request for the document, its history or anything else').toEqual(reads);
      expect(await framesCount(s), 'a second iframe was seen').toBe(2);
      expect((await postsSeen(s.page)).length, 'each frame was handed one hello').toBe(2);
      expect((await framesSeen(s.page))[1]?.focusedAtInsert, 'the new frame was focused when inserted (the click was in the frame)').toBe(true);
      expect((await activeOf(s.page)).onFrame, 'and holds focus').toBe(true);
      expect(await settle(s.page, 5_000), 'the reader is up').toBe('ready');
      expect(fellBackFor(s.logs), 'no fallback').toEqual([]);
      expect(s.app.errors, 'no page error').toEqual([]);
    }, 120_000);

    it('a bare #id link scrolls in the frame, remounts nothing, updates the fragment, adds no history entry and reads nothing', async () => {
      const { s, frame } = await openSelf();
      const handle = await s.page.locator('.docs-reader iframe').elementHandle();
      const entries = await s.page.evaluate(() => history.length);
      const reads = s.apiHits.length;
      await frame.getByRole('link', { name: 'the bare link' }).click();
      await expect.poll(async () => inView(await topIn(frame, FAR_ID)), {
        timeout: 30_000, message: 'the target is not in the frame\'s viewport after the bare link (the frame did not scroll to it)',
      }).toBe(true);
      await s.page.waitForFunction((h) => location.hash === h, `#${FAR_ID}`, { timeout: 10_000 });
      expect(await framesCount(s), 'still one iframe').toBe(1);
      expect(await handle!.evaluate((e) => e.isConnected), 'the same frame element').toBe(true);
      expect(await s.page.evaluate(() => history.length), 'no history entry').toBe(entries);
      expect(s.apiHits.length, 'no request at all').toBe(reads);
      expect((await postsSeen(s.page)).length, 'no second hello').toBe(1);
    }, 120_000);

    it('the remount keeps the persisted reader state: the width pref, the marks, the folds and the last visit survive, and the frame shows them', async () => {
      const { s, frame } = await openSelf();
      await frame.locator('.aa-btn').click();
      await frame.locator('input[data-pref="width"][value="wide"]').check();
      await frame.locator('.h-mark').nth(1).click({ force: true }); // "Middle part"
      await frame.locator('.h-fold').nth(3).click({ force: true }); // "Last part", below the target
      const keys = { prefs: `${READER_STORE_PREFIX}pref:prefs`, seen: `${DOC}seen`, marks: `${DOC}marks`, folds: `${DOC}folds` };
      await s.page.waitForFunction((ks) => ks.every((k) => localStorage.getItem(k) !== null), Object.values(keys), { timeout: 15_000 });
      const before = Object.fromEntries(Object.entries(await store(s.page)).filter(([k]) => k.startsWith(READER_STORE_PREFIX)));
      await frame.getByRole('link', { name: 'the far target' }).click();
      await s.page.waitForFunction(() => (window as unknown as { __frames: unknown[] }).__frames.length === 2, undefined, { timeout: 10_000 });
      const again = await readerFrame(s.page);
      await expect.poll(async () => inView(await topIn(again, FAR_ID)), { timeout: 30_000, message: 'the target is not in the new frame\'s viewport' }).toBe(true);
      // The new frame shows what was stored.
      expect(await again.locator('input[data-pref="width"][value="wide"]').isChecked(), 'the new frame shows the wide pref').toBe(true);
      expect(await again.locator('.h-mark').evaluateAll((bs) => bs.map((b) => b.textContent)), 'and the mark on "Middle part"').toEqual(['Mark read', 'Read', 'Mark read', 'Mark read']);
      expect(await again.locator('.h-fold').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-expanded'))), 'and the fold on "Last part"').toEqual(['true', 'true', 'true', 'false']);
      // Nothing under the prefix is lost, and nothing the visit chose changed. The frame itself moves two entries by design: the
      // reading position (it scrolled to the target) and the last visit's time (its new boot stamps it, with the same commit).
      const after = Object.fromEntries(Object.entries(await store(s.page)).filter(([k]) => k.startsWith(READER_STORE_PREFIX)));
      expect(Object.keys(after).sort(), 'every stored key under the reader prefix is still there').toEqual(expect.arrayContaining(Object.keys(before).sort()));
      const settledKeys = Object.keys(before).filter((k) => k !== keys.seen && !k.endsWith(':pos'));
      expect(settledKeys.map((k) => [k, after[k]]), 'and each, but the position and the last visit, holds the same value').toEqual(settledKeys.map((k) => [k, before[k]]));
      const seen = (o: Record<string, string>): { sha: string; at: number } => JSON.parse(o[keys.seen] ?? 'null') as { sha: string; at: number };
      expect(seen(after).sha, 'the last visit names the same commit').toBe(seen(before).sha);
      console.log(`T13-REMOUNT last visit stamped ${seen(before).at} then ${seen(after).at}; keys ${Object.keys(after).length} (before ${Object.keys(before).length}); marks, folds and pref kept`);
    }, 120_000);
  });

  // ---- a deep link survives a fallback raised after the mount (completion plan Task 13) -------------------------------------------
  // fn.md holds a footnote far below the fold; the plain view renders its definition with the id `user-content-fn-1` (its headings
  // carry none). A forged `ready` with a wrong nonce is put on the port ahead of the frame's own word: the reader mounted (the
  // mount resolved long before any port message is processed), and falls back on `nonce`, before its `ready`. The fragment was
  // handed to the frame and not yet spent, so the plain view still scrolls it.
  it('a deep link survives a fallback raised after the mount resolved: the plain view shows the fixed note and the named element is in view', async () => {
    const forged = { t: 'ready', v: 1, nonce: '0'.repeat(32) };
    const control = await openSession({ hook: { earlyOps: [forged] } });
    await control.goto(leafUrl('fn.md'));
    expect(await settle(control.page, 30_000, 'fallback'), 'without a fragment: the forged ready sends the reader to the plain view').toBe('fallback');
    const idle = await control.page.locator(`article li#${FOOTNOTE_ID}`).evaluate((e) => ({ top: e.getBoundingClientRect().top, viewport: window.innerHeight }));
    expect(idle.top, 'and there the footnote is below the first screen, so a scroll is what brings it into view').toBeGreaterThan(idle.viewport);

    const s = await openSession({ hook: { earlyOps: [forged] } });
    await s.goto(`${leafUrl('fn.md')}#${FOOTNOTE_ID}`);
    expect(await settle(s.page, 30_000, 'fallback'), 'the reader fell back').toBe('fallback');
    await expect.poll(() => fellBackFor(s.logs), { timeout: 5_000, message: 'the reader fell back on the frame\'s forged ready (nonce), after the mount' }).toEqual(['nonce']);
    expect(await s.page.locator('.doc-plain-note').first().textContent(), 'the fixed note').toBe(READER_FALLBACK_NOTE);
    expect((await framesSeen(s.page)).length, 'a frame was mounted').toBe(1);
    await expect.poll(async () => inView(await s.page.locator(`article li#${FOOTNOTE_ID}`).evaluate((e) => ({ top: e.getBoundingClientRect().top, viewport: window.innerHeight }))), {
      timeout: 15_000, message: `the plain view did not scroll #${FOOTNOTE_ID} into view`,
    }).toBe(true);
  }, 120_000);

  // ---- an over-long image ref (completion plan Task 13) -------------------------------------------------------------------------
  // The seed check refuses a whole seed carrying one image ref past 2048 code units, which would send the page to the plain view.
  // The ref here is one past the limit (redundant "./" segments, so it still names a real file), beside an ordinary image.
  it('an image ref one code unit over the seed limit is left out: the reader comes up, the ordinary image shows, the long one is the frame\'s not-loaded chip', async () => {
    expect(LONG_REF.length, 'the ref is one past the limit').toBe(READER_IMAGE_REF_MAX_UNITS + 1);
    const { s, outcome } = await open('imgs.md');
    expect(outcome, 'the reader comes up (the seed stayed valid)').toBe('ready');
    expect(fellBackFor(s.logs), 'no fallback').toEqual([]);
    const frame = await readerFrame(s.page);
    await frame.waitForFunction(() => [...document.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth === 1), undefined, { timeout: 30_000 });
    const seen = await frame.evaluate(() => ({
      imgs: [...document.querySelectorAll('img')].map((i) => `${i.getAttribute('alt')}:${i.naturalWidth}`),
      chips: [...document.querySelectorAll('[data-docreader-chrome]')].map((c) => c.textContent ?? '').filter((t) => t.includes('Image not loaded')),
    }));
    expect(seen.imgs, 'the ordinary image shows, decoded').toEqual(['ordinary image:1']);
    expect(seen.chips.length, 'one not-loaded chip').toBe(1);
    expect(seen.chips[0], 'and it is the long image\'s').toMatch(/^long image .*Image not loaded$/);
    expect(fileReads(s, 'pix.png'), 'the ordinary image was read').toBeGreaterThan(0);
    expect(fileReads(s, LONG_NAME), 'the long ref was never planned or loaded').toBe(0);
  }, 120_000);

  // ---- lab 10: a service worker never controls the sandboxed child (completion plan Task 13) ---------------------------------------
  // The only case that lets a context run a service worker (`AppView.serviceWorkers`, `app.ts`); every other case blocks them.
  // The built app registers its own worker (`main.tsx`'s `registerSW`). A positive control comes first in the same context: that
  // worker is registered, active, and controls the console page, and a request of the page for a precached file is answered by it
  // (`Response.fromServiceWorker()`). Only then the sandboxed child: the reader's own srcdoc frame (CSP `default-src 'none'`, so
  // it makes no request) and, for the requests and the navigation the reader's frame cannot make, hand-built children in the
  // controlled page and in a host page of the same origin. The precache ignores a `utm_` query, so every probe has its own URL
  // (no HTTP cache can answer for another) and still names a file the worker holds. The harness's `/api` route still answers
  // what the worker forwards (measured: a fetch the worker answered reached the route); the case asserts that, so the reader's
  // fixtures arriving is a checked fact, not an assumption.
  describe('lab 10: a service worker never controls a sandboxed srcdoc child (completion plan Task 13)', () => {
    const PRECACHED = '/icons/icon-192.png';
    const probe = (who: string): string => `${PRECACHED}?utm_lab10=${who}`;
    const CONTROLLER_OF = `(() => { try { return navigator.serviceWorker === undefined ? 'absent' : navigator.serviceWorker.controller === null ? 'no-controller' : 'controller'; } catch (e) { return 'threw ' + e.name; } })()`;
    interface Answered { readonly path: string; readonly viaWorker: boolean; readonly status: number; readonly from: Frame | null }

    it('the built app\'s worker controls the console page, the reader\'s sandboxed frame and a hand-built one reach no controller, and their loads and navigation bypass the worker', async () => {
      const s = await openSession({ serviceWorkers: 'allow' });
      const answered: Answered[] = [];
      s.page.on('response', (r) => {
        let from: Frame | null = null;
        try { from = r.request().frame(); } catch { /* a request of the worker itself has no frame */ }
        const u = new URL(r.url());
        answered.push({ path: u.pathname + u.search, viaWorker: r.fromServiceWorker(), status: r.status(), from });
      });
      const answer = async (path: string): Promise<Answered> => {
        await expect.poll(() => answered.some((a) => a.path === path), { timeout: 15_000, message: `no response for ${path} was seen` }).toBe(true);
        return answered.find((a) => a.path === path)!;
      };

      // Positive control: the worker registers, activates, claims the page, and answers a precached file.
      await s.goto(leafUrl('small.md'));
      await s.page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 }).catch(() => {
        throw new Error('the built app\'s service worker never took control of the console page: it was not registered, did not activate, or did not claim (30 s)');
      });
      await expect.poll(() => s.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => ({ scope: new URL(r.scope).pathname, state: r.active?.state ?? 'none' }))), {
        timeout: 15_000, message: 'the built app\'s worker is not one registration of scope / in state activated',
      }).toEqual([{ scope: '/', state: 'activated' }]);
      expect(s.app.ctx.serviceWorkers().length, 'Playwright sees the worker').toBeGreaterThan(0);
      await s.page.reload({ waitUntil: 'load' }); // the document is controlled from its first byte
      expect(await settle(s.page), 'the reader is up in the controlled page').toBe('ready');
      expect(await s.page.evaluate(() => navigator.serviceWorker.controller !== null), 'the console page is controlled').toBe(true);
      expect(await s.page.evaluate((u) => fetch(u).then((r) => r.status), probe('console')), 'the console fetches a precached file').toBe(200);
      expect((await answer(probe('console'))).viaWorker, 'and the worker answered it').toBe(true);
      expect(await s.page.evaluate((u) => fetch(u).then((r) => r.status), '/api/docs/demo/file?probe=lab10-console'), 'a request the worker forwards still reaches the harness\'s route').toBe(404);
      expect((await answer('/api/docs/demo/file?probe=lab10-console')).viaWorker, 'it passed through the worker').toBe(true);
      expect(s.apiHits.map((h) => h.path), 'and the route recorded it, as it did the reader\'s own reads').toEqual(expect.arrayContaining(['/api/docs/demo/file?probe=lab10-console']));
      expect(fileReads(s, 'small.md'), 'the reader\'s document read was answered by the fixture').toBeGreaterThan(0);

      // The reader's own sandboxed srcdoc frame: no controller is reachable, and it loads nothing.
      const frame = await readerFrame(s.page);
      expect(await frame.evaluate(CONTROLLER_OF), 'in the reader frame\'s realm there is no controller to reach').toMatch(/^(threw SecurityError|absent|no-controller)$/);
      const refused = await frame.evaluate(async ([viaFetch, viaImage]) => {
        const violations: string[] = [];
        document.addEventListener('securitypolicyviolation', (e) => { violations.push(e.blockedURI); });
        fetch(viaFetch!).catch(() => 0);
        const i = new Image();
        i.src = viaImage!;
        for (let k = 0; k < 100 && violations.length < 2; k += 1) await new Promise((r) => setTimeout(r, 50));
        return violations.length;
      }, [probe('reader'), probe('readerimg')]);
      expect(refused, 'the frame\'s CSP refused both attempts').toBeGreaterThanOrEqual(2);
      expect(answered.filter((a) => a.from === frame).map((a) => a.path), 'no load of the reader frame was answered by anything, the worker included').toEqual([]);

      // A same-origin child (allow-same-origin) is the control for the probe: it inherits the controller, and its load is the worker's.
      const same = await mountControl(s.page, 'allow-scripts allow-same-origin');
      expect(await same.evaluate(CONTROLLER_OF), 'a same-origin srcdoc child reaches the controller (the probe can see one)').toBe('controller');
      await same.evaluate((u) => fetch(u).then((r) => r.status), probe('same'));
      const sameAnswer = await answer(probe('same'));
      expect(sameAnswer.viaWorker, 'and its load goes through the worker').toBe(true);
      await s.page.evaluate(() => document.getElementById('control')?.remove());

      // The hand-built sandboxed child (allow-scripts, no CSP): no controller, and its requests go to the network, not the worker.
      const child = await mountControl(s.page, 'allow-scripts');
      expect(await child.evaluate(CONTROLLER_OF), 'the sandboxed child reaches no controller').toMatch(/^(threw SecurityError|absent|no-controller)$/);
      await child.evaluate(async ([viaFetch, viaImage]) => {
        await fetch(viaFetch!, { mode: 'no-cors' }).catch(() => 0);
        await fetch('/api/docs/demo/file?probe=lab10-child', { mode: 'no-cors' }).catch(() => 0);
        const i = new Image();
        i.src = viaImage!;
        await new Promise((r) => { i.onload = r; i.onerror = r; });
      }, [probe('child'), probe('childimg')]);
      for (const path of [probe('child'), probe('childimg'), '/api/docs/demo/file?probe=lab10-child']) {
        const a = await answer(path);
        expect(a.viaWorker, `the child's request for ${path} was not answered by the worker`).toBe(false);
        expect(a.from, `and it came from the child frame`).toBe(child);
      }
      expect(s.apiHits.map((h) => h.path), 'the child\'s request reached the network (the harness\'s route saw it)').toEqual(expect.arrayContaining(['/api/docs/demo/file?probe=lab10-child']));

      // A sandboxed frame's navigation is never seen by the worker. The shell meta (`frame-src 'none'`) keeps any child of the
      // app page from navigating, so the pair lives in a host page of the same origin: one plain iframe and one sandboxed, each
      // navigating to a file the worker holds.
      await s.app.ctx.route((u) => u.pathname === '/api/lab10/host', (route) => route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><title>host</title><iframe src="${probe('navplain')}"></iframe><iframe sandbox="allow-scripts" src="${probe('navboxed')}"></iframe>`,
      }));
      const host = await s.app.ctx.newPage();
      host.on('response', (r) => { const u = new URL(r.url()); answered.push({ path: u.pathname + u.search, viaWorker: r.fromServiceWorker(), status: r.status(), from: null }); });
      await host.goto(`${server.origin}/api/lab10/host`, { waitUntil: 'load' });
      expect((await answer(probe('navplain'))).viaWorker, 'a plain iframe\'s navigation to a precached file is the worker\'s (control)').toBe(true);
      const boxed = await answer(probe('navboxed'));
      expect(boxed.status, 'the sandboxed frame\'s navigation was answered').toBe(200);
      expect(boxed.viaWorker, 'and not by the worker').toBe(false);
      expect(s.app.errors, 'no page error').toEqual([]);

      // No registration outlives the case: a fresh context starts with none.
      await s.app.ctx.close();
      sessions.splice(sessions.indexOf(s.app), 1);
      const fresh = await openSession({ serviceWorkers: 'allow' });
      await fresh.page.goto(server.origin + PRECACHED, { waitUntil: 'load' });
      expect(await fresh.page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 'a fresh context holds no registration').toBe(0);
      expect(fresh.app.ctx.serviceWorkers().length, 'and no worker').toBe(0);
    }, 180_000);
  });
});
