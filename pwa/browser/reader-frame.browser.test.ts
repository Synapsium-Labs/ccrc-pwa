// The reader frame's real-browser rows (native Docs reader, W8a Task 10; the 2026-10-12 spec's section 7.2: M8.B1 to
// M8.B6, and M8.1, M8.3, M8.4, M8.6, M8.8, M8.11, M8.20 on the live DOM; labs E14, E15, E16; section 4.3's worst case).
// These are claims about what Chrome DOES with the production frame: the sandbox, the two CSPs, the port, the pinned
// srcdoc order and the Mermaid draw. jsdom has no CSP, no sandbox and no srcdoc browsing context, so every row drives
// a real Chrome through `playwright-core` over the production PWA (`app.ts`'s `buildDist`, `serveDist`, `openApp`)
// whose `/api/docs` answers from fixtures here. No server, no ccd, no tmux: the shell is the built bundle and nothing
// else.
//
// What the rows share:
//   - Two hooks, both Playwright init scripts. The PARENT hook (the page's realm) records every iframe the reader
//     mounts (attributes, srcdoc, whether it held focus when it was inserted), wraps `HTMLIFrameElement.prototype
//     .contentWindow` so every `postMessage` to the frame is counted (target, payload, port), notes when `ready`
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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import { FRAME_MANIFEST, frameCsp } from '@synapsium-labs/docserver/frame';
import { DOCS_MAX_IMAGES_PER_PAGE, DOCS_RASTER_TYPES, DOCS_RESPONSE_HEADERS, sniffRaster } from '../../shared/docs';
import { READER_FALLBACK_NOTE } from '../src/docs/reader/readerText';
import { READER_IMAGE_BUDGET_BYTES, READER_STORE_PREFIX } from '../src/lib/readerLimits';
import { COMMIT_A, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { buildDist, openApp, removeDist, serveDist, type DistServer, type OpenedApp } from './app';
import { onePixelPng, resolveChrome, startOrigins, type OriginAnswer, type OriginRoute, type Origins } from './harness';

// ---- fixture documents (project `demo`, section `specs`) ------------------------------------------------------------

const PROJECT = 'demo';
const SECTION = 'specs';
/** Built, never typed: an ESC, a line separator, and a script close that would end the seed's element if it were raw. */
const ESC = String.fromCharCode(27);
const LS = String.fromCharCode(0x2028);
const SCRIPT_CLOSE = '</' + 'script><' + 'script>';
const HOSTILE_PAYLOAD = 'ccrc-hostile-payload';
const HOSTILE_FILL = 'rgb(255, 0, 255)';
const COOKIE = { name: 'ccrc_session', value: 'demo-session' } as const;

const fence = (body: string): string => '```mermaid\n' + body + '\n```\n\n';

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
  /** Parent realm: run an iframe's `load` listeners this many ms late, so a self-navigating frame's child is what the
   *  library's first `load` handler finds. */
  readonly delayLoadMs?: number;
  /** Parent realm: messages posted on the frame's end of the port just before it is handed to the frame, so they are
   *  on the wire ahead of anything the frame says (the Playwright init script reaches a srcdoc frame before its
   *  scripts in some loads and after them in others, so a frame-realm hook cannot be relied on to speak first). */
  readonly earlyOps?: readonly unknown[];
  /** Frame realm: messages posted on the port the moment it is captured (a navigated child's, which has no scripts
   *  of the library's to be ahead of). */
  readonly onHello?: readonly unknown[];
  /** Frame realm: the srcdoc document navigates here at once. */
  readonly navigateTo?: string;
}

function hookScript(cfg: HookConfig): string {
  return `(() => {
  const CFG = ${JSON.stringify(cfg)};
  if (window.top === window) {
    window.__posts = []; window.__postPorts = []; window.__frames = []; window.__readyAts = [];
    if (CFG.skipCspAttr) {
      const orig = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (n, v) {
        if (this.tagName === 'IFRAME' && String(n).toLowerCase() === 'csp') return undefined;
        return orig.call(this, n, v);
      };
    }
    if (CFG.delayLoadMs) {
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, cb, opts) {
        if (type === 'load' && this instanceof HTMLIFrameElement && typeof cb === 'function' && this.hasAttribute('srcdoc')) {
          const orig = cb; const self = this;
          cb = function (ev) { setTimeout(() => orig.call(self, ev), CFG.delayLoadMs); };
        }
        return add.call(this, type, cb, opts);
      };
    }
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
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
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.t !== 'hello' || !e.ports || e.ports.length !== 1) return;
      const p = e.ports[0];
      window.__ccrcPort = p;
      console.log('ccrc-hook hello ' + (location.href === 'about:srcdoc' ? 'srcdoc' : location.href));
      for (const m of (CFG.onHello || [])) p.postMessage(m);
    }, true);
    if (CFG.navigateTo && location.href === 'about:srcdoc') location.href = CFG.navigateTo;
  }
})();`;
}

// ---- the 27-channel battery -------------------------------------------------------------------------------------------

const CHANNELS = [
  'fetch-cors', 'fetch-nocors', 'fetch-credentials', 'fetch-post', 'fetch-keepalive', 'xhr-get', 'xhr-post', 'beacon',
  'websocket', 'eventsource', 'image', 'image-srcset', 'script', 'script-module', 'link-stylesheet', 'link-prefetch',
  'link-preload', 'link-modulepreload', 'style-import', 'css-background', 'css-font-face', 'css-content-url', 'audio',
  'video', 'svg-image', 'import-dynamic', 'iframe',
] as const;

/** The battery as an expression for the frame's own realm: every channel, once per origin, each to `/battery/<name>`.
 *  It returns what it attempted and the `securitypolicyviolation` events the frame's CSP raised, so a run that reaches
 *  nothing can show it was refused rather than never run. */
function batterySource(origins: readonly string[]): string {
  return `(async () => {
  const violations = []; const threw = {}; const attempted = [];
  document.addEventListener('securitypolicyviolation', (e) => { violations.push(e.blockedURI); });
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));
  const ns = 'http://www.w3.org/2000/svg';
  const mount = (el) => { (document.body || document.documentElement).append(el); return el; };
  const channels = {
    'fetch-cors': (u) => fetch(u, { mode: 'cors' }).catch(() => 0),
    'fetch-nocors': (u) => fetch(u, { mode: 'no-cors' }).catch(() => 0),
    'fetch-credentials': (u) => fetch(u, { mode: 'cors', credentials: 'include' }).catch(() => 0),
    'fetch-post': (u) => fetch(u, { method: 'POST', body: 'x', mode: 'no-cors' }).catch(() => 0),
    'fetch-keepalive': (u) => fetch(u, { keepalive: true, mode: 'no-cors' }).catch(() => 0),
    'xhr-get': (u) => { const x = new XMLHttpRequest(); x.open('GET', u); x.send(); },
    'xhr-post': (u) => { const x = new XMLHttpRequest(); x.open('POST', u); x.send('x'); },
    'beacon': (u) => { navigator.sendBeacon(u, 'x'); },
    'websocket': (u) => { const w = new WebSocket(u.replace('http', 'ws')); w.onerror = () => {}; },
    'eventsource': (u) => { const s = new EventSource(u); s.onerror = () => s.close(); },
    'image': (u) => { const i = new Image(); i.src = u; },
    'image-srcset': (u) => { const i = document.createElement('img'); i.srcset = u + ' 1x'; mount(i); },
    'script': (u) => { const s = document.createElement('script'); s.src = u; mount(s); },
    'script-module': (u) => { const s = document.createElement('script'); s.type = 'module'; s.src = u; mount(s); },
    'link-stylesheet': (u) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = u; mount(l); },
    'link-prefetch': (u) => { const l = document.createElement('link'); l.rel = 'prefetch'; l.href = u; mount(l); },
    'link-preload': (u) => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'image'; l.href = u; mount(l); },
    'link-modulepreload': (u) => { const l = document.createElement('link'); l.rel = 'modulepreload'; l.href = u; mount(l); },
    'style-import': (u) => { const s = document.createElement('style'); s.textContent = '@import url("' + u + '");'; mount(s); },
    'css-background': (u) => { const d = document.createElement('div'); d.style.cssText = 'width:10px;height:10px;background-image:url("' + u + '")'; mount(d); },
    'css-font-face': (u) => {
      const s = document.createElement('style'); s.textContent = '@font-face{font-family:bat;src:url("' + u + '")}.bat{font-family:bat}'; mount(s);
      const p = document.createElement('p'); p.className = 'bat'; p.textContent = 'x'; mount(p);
    },
    'css-content-url': (u) => {
      const s = document.createElement('style'); s.textContent = '.cu::before{content:url("' + u + '")}'; mount(s);
      const d = document.createElement('div'); d.className = 'cu'; d.textContent = 'x'; mount(d);
    },
    'audio': (u) => { const a = new Audio(); a.preload = 'auto'; a.src = u; a.load(); },
    'video': (u) => { const v = document.createElement('video'); v.preload = 'auto'; v.src = u; mount(v); v.load(); },
    'svg-image': (u) => {
      const s = document.createElementNS(ns, 'svg'); const i = document.createElementNS(ns, 'image');
      i.setAttribute('href', u); i.setAttribute('width', '10'); i.setAttribute('height', '10'); s.append(i); mount(s);
    },
    'import-dynamic': (u) => import(u).catch(() => 0),
    'iframe': (u) => { const f = document.createElement('iframe'); f.src = u; mount(f); },
  };
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
  dist = buildDist();
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
  removeDist(dist);
});

interface ApiHit {
  readonly path: string;
  readonly method: string;
  readonly cookie: string | null;
}

interface SessionOptions {
  readonly width?: number;
  readonly height?: number;
  readonly hook?: HookConfig;
  /** Rewrite the built `index.html` before the page sees it (the shell meta controls). */
  readonly index?: (html: string) => string;
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
  const app = await openApp(using, { width: opts.width ?? 1280, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
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

// ---- the rows ---------------------------------------------------------------------------------------------------------

describe('W8a reader frame in Chrome', () => {
  it('M8.B1: the 27-channel battery inside the frame reaches neither origin, Mermaid draws on tap, and the hostile directive injects no style', async () => {
    const { s, outcome } = await open('flow.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    // E15: tap Render on EVERY figure, the hostile ones included, and wait for each.
    const buttons = frame.locator('.fig-render-btn');
    expect(await buttons.count(), 'one Render button per figure').toBe(FIGURES);
    expect(await frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => `${f.getAttribute('data-docreader-draw')}:${f.querySelectorAll('svg').length}`)),
      'before the tap nothing is drawn (on-request)').toEqual(Array.from({ length: FIGURES }, () => 'on-request:0'));
    const fromDraw = origins.hits.length;
    for (let i = 0; i < FIGURES; i += 1) {
      const figure = frame.locator('figure.mermaid-figure').nth(i);
      await figure.locator('.fig-render-btn').click();
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
      fetch(base + 'fetch-marker', { credentials: 'include', headers: { 'x-ccrc-docs': '1' } }).catch(() => 0);
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

  it('M8.B5: a parent.postMessage of a well-formed navigate has no effect', async () => {
    const { s, outcome } = await open('small.md');
    expect(outcome).toBe('ready');
    const frame = await readerFrame(s.page);
    const before = await readerKeys(s.page);
    await frame.evaluate(`(() => {
      parent.postMessage({ t: 'navigate', href: './other.md' }, '*');
      parent.postMessage({ t: 'store.set', key: 'pref:ui', value: '{"x":1}' }, '*');
      parent.postMessage({ t: 'hash', id: 'x' }, '*');
    })()`);
    await sleep(1200);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('small.md'));
    expect(await readerKeys(s.page), 'no store write').toEqual(before);
    expect(await s.page.getByText('Open this link?').count(), 'no sheet').toBe(0);
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
    expect(await s.page.getByRole('heading', { name: 'Small page' }).count(), 'the plain view shows the document').toBeGreaterThan(0);
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

  it('M8.B5 control: without the shell meta, a navigated child receives the port and still achieves no effect', async () => {
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
      hook: { delayLoadMs: 700, navigateTo: child, onHello: ops },
    }, lna);
    sessions.splice(sessions.indexOf(s.app), 1);
    const from = origins.hits.length;
    await s.goto(leafUrl('small.md'));
    expect(await settle(s.page, 30_000)).toBe('fallback');
    await sleep(500);
    const childHits = origins.hits.slice(from).filter((h) => h.origin === 'b' && h.path === '/child');
    expect(childHits.length, 'without the shell meta the frame navigated, and the child loaded').toBeGreaterThan(0);
    expect(s.logs.filter((l) => l.includes('ccrc-hook hello') && l.includes('/child')).length, 'the child received the port').toBeGreaterThan(0);
    expect(pathOf(s.page), 'no route').toBe(leafUrl('small.md'));
    expect(await readerKeys(s.page), 'no store write').toEqual([]);
    expect(await s.page.getByText('Open this link?').count() + await s.page.getByText('Copy with hidden characters?').count(), 'no sheet').toBe(0);
    await s.app.ctx.close();
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
    expect(await s.page.getByRole('heading', { name: 'Small page' }).count(), 'the fallback renders the document').toBeGreaterThan(0);
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
      'each once').toEqual({ guard: 1, bootstrap: 1, enhance: 1, mermaid: 1, seed: 1 });
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
    await frame.locator('.fig-render-btn').click();
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
    const frame = await readerFrame(s.page);
    const figures = await frame.evaluate(() => [...document.querySelectorAll('figure.mermaid-figure')].map((f) => ({
      source: (f.querySelector('pre')?.textContent ?? '').trim().length, render: f.querySelectorAll('.fig-render-btn').length, svgs: f.querySelectorAll('svg').length,
    })));
    expect(figures.length, 'every figure is there').toBe(25);
    expect(figures.filter((f) => f.source === 0), 'each shows its source').toEqual([]);
    expect(figures.filter((f) => f.render !== 0 || f.svgs !== 0), 'no Render button, no drawing').toEqual([]);
  }, 120_000);

  it('the reader is sized to the Docs pane and only the frame scrolls, at 1280x800 and 390x844', async () => {
    const problems: string[] = [];
    for (const [w, h] of [[1280, 800], [390, 844]] as const) {
      const { s, outcome } = await open('long.md', { width: w, height: h });
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
    expect(summary.head.filter((h) => h.sha256 === FRAME_MANIFEST.mermaid.sha256).length, 'the Mermaid text is inlined once (the gate passed)').toBe(1);
    expect(m.srcdocChars).toBeGreaterThan(FRAME_MANIFEST.mermaid.chars);
    expect(imageCount, 'all 30 images are in the seed').toBe(DOCS_MAX_IMAGES_PER_PAGE);
    expect(painted.decoded, 'and all 30 decode in the frame').toBe(DOCS_MAX_IMAGES_PER_PAGE);
    expect(m.readyMs, 'ready arrived').toBeGreaterThan(0);
  }, 300_000);
});
