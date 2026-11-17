// The mockup viewer's real-browser rows (native Docs reader, completion plan C2 Tasks 8 and 10; base spec 2026-10-01 section
// 5.0's labs and E rows, 5.6.1 to 5.6.6, 5.7, and 5.8's table M5.B1 to M5.B4, M5.B7, M5.B11). These are claims about what
// Chrome DOES with the production artefacts, so every row drives a real Chrome through `playwright-core` and none rests on a
// jsdom proof of a CSP. Production artefacts, never copies of them: `parseMockup`, `extractMockupRefs`, `planMockupAssets`,
// `loadMockupAssets` (over a fake reader that answers each asset's bytes), `buildMockupSrcdoc` (so `metaFor`, the click guard
// and `mockupCsp` are the shipped ones), `MockupFrame` through `renderToStaticMarkup`, the shell meta read from the BUILT
// `index.html` of the run's one production build, and `DOCS_RESPONSE_HEADERS` for the app rows. Every fixture is synthetic.
//
// Origins (`harness.ts`): A is the host page's origin, B and C are the cross-origin targets the 27-channel battery aims at;
// all three are plain `http` loopback names. `mockupCsp` accepts only `https` origins, so the rows that LIST an origin
// (M5.B7, M5.B11, the diagram fixture, the static-mode beacon) run two small TLS origins of this file's own (`l.site.localhost`
// listed, `u.site.localhost` unlisted; a throwaway certificate from `openssl`, Chrome started with certificate errors ignored).
// Chrome's local-network checks are off for the whole file, so they cannot make a property hold.
// A request is REACHED when an origin logs it. Every request a mockup makes carries `?row=<id>` of its own row, so a row
// counts only its own requests.
//
// Windows: no row decides a negative by a fixed sleep. Where a wall is claimed, the row first waits for a positive that
// bounds it: the frame's own report that its attempts finished (a battery's 2.5 s window, an image's `load`/`error` event, a
// page flag), the parent's `securitypolicyviolation` for the blocked navigation, or the CONTROL's measured latency (the
// control runs first, and a bounded wait for a request that must not come is `max(1.5 s, 3 x the control's latency)`).
//
// Rows (each with its control, the same fixture run in the same Chrome where the wall is taken away):
//   M5.B1 / E3 / lab 3   the battery in a SCRIPTED frame plus an unrewritten relative `<img>`: 0/27 to A and B; the inlined
//                        png, svg, css, font, classic script and module script all work; the SVG's own script does not run;
//                        CONTROL: the same page with no CSP meta (and no `csp` attribute) reaches B on at least 20/27, and the
//                        same SVG opened as a document does run its script
//   meta-only            the same fixture with the `csp` attribute dropped from the frame stays at 0/27 (the meta alone is the
//                        wall); the attribute-only variant is measured too (CONTROL: M5.B1's)
//   M5.B2 / E1           parent wall: script navigation, `<meta refresh>`, a link click (no click guard) to B, and a link to
//                        A's `/api/x`: nothing reaches either server; CONTROL: without the shell meta they all reach, with
//                        `frame-src 'self'` A's `/api/x` is reached
//   M5.B3 / E5           click guard: a fragment click scrolls and the frame's liveness counter keeps counting; CONTROL: built
//                        without the guard the frame dies
//   M5.B4 / E1           static mode (`sandbox=""`): no script runs, `<meta refresh>` is refused (measured: with or without the
//                        shell meta); CONTROL: the same page scripted runs the script and follows the refresh to B
//   attributes           the real DOM's frame attributes (sandbox, no src/name/allow/allowfullscreen, referrerpolicy, csp);
//                        CONTROL: a hand-built frame reads the opposite through the same reader
//   lab 1-2              `document.cookie` and `localStorage` throw in the scripted frame and its requests carry no cookie for A;
//                        CONTROL: a same-origin frame reads and sends the cookie
//   popup / top nav      `window.open` yields no page and `top.location = ...` leaves the parent; CONTROL: a frame with
//                        allow-popups and allow-top-navigation does both
//   lab 3 (second half)  `document.open(); document.write('<img ...>')` and a script that removes the CSP meta, then requests
//                        B: 0 requests reach B; CONTROL: the same scripts in a frame built without the meta reach B
//   lab 4                a `blob:` URL the parent made cannot load in the child, a `data:` URL can; CONTROL: the parent and a
//                        same-origin frame load the same blob URL
//   M5.B7 / E9           a page built with `mockupCsp([listed])`: the listed classic script runs; A, an unlisted http origin and an
//                        unlisted TLS origin stay at 0/27; the listed origin gets no fetch, XHR, beacon, WebSocket or EventSource;
//                        no cookie anywhere; CONTROLS: the base CSP runs no listed script, and no CSP reaches the listed origin
//   M5.B11               a CORS module `import()` from the listed origin loads; under the base CSP, or from an unlisted
//                        origin, it is blocked; CONTROL: with no CSP every one of them loads
//   diagram fixture      the synthetic CDN-module diagram page (Task 10): base CSP versus `mockupCsp([listed])`, recorded as
//                        measured, never widened
//   E10 (desktop)        a scripted frame's 3 s busy loop leaves the parent's 50 ms timer under a stated gap bound; CONTROL: the
//                        same loop in the parent shows a gap over 2 000 ms. PHONE ISOLATION IS NOT MEASURED HERE (Task 17).
//   E12                  Chrome's `DOMParser` on a hostile page (img, stylesheet link, script src, inline beacon script, an
//                        `onerror` handler, a `meta refresh`, all aimed at B), exactly as `parse.ts` calls it after the pre-scan
//                        admits the text: 0 requests, no script and no handler runs; CONTROL: the same text as a live scratch
//                        element's `innerHTML` reaches B and runs the handler
//   second-load teardown the real viewer removes a frame that navigates itself (script or meta refresh) and shows its notice
//                        and Reload mockup; CONTROL: Reload mockup mounts a new frame within a time the no-frame window exceeds
//   no parent messages   `parent.postMessage` from the scripted frame changes nothing in the console; the page's own counter
//                        sees each message arrive
//   chrome and widths    at 412x915 and 1280x800 the toolbar controls are at least 44 px tall and inside the viewport, the frame
//                        is 70% of the viewport height, no horizontal scroll; CONTROL: the same meter reads a short control and
//                        a wide page as violations
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/docs-mockup.browser.test.ts )`, through `ccrc test`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer as createHttps } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import { DOC_SECTION_SLUGS, DOCS_RESPONSE_HEADERS, type DocPin } from '../../shared/docs';
import { LAB_BATTERY_CHANNELS } from '../../shared/readerLab';
import { MOCKUP_TEXT } from '../src/docs/docsText';
import { MockupFrame, mockupFrameProps } from '../src/docs/MockupFrame';
import { buildMockupSrcdoc, extractMockupRefs, loadMockupAssets } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import { planMockupAssets } from '../src/docs/mockup/plan';
import { MOCKUP_CLICK_GUARD, MOCKUP_CSP, metaFor, mockupCsp } from '../src/docs/mockup/policy';
import type { HttpsOrigin, MockupAssetPlan, MockupContext } from '../src/docs/mockup/ports';
import { prescanMockup } from '../src/docs/mockup/prescan';
import { LAB_BATTERY_CHANNELS_JS, LAB_BATTERY_PRELUDE_JS } from '../src/readerLab/battery';
import { COMMIT_A, BLOB_1, entry, treeOk, treeResponse } from '../test/docsFixtures';
import { openApp, serveDist, sharedDist, type DistServer, type OpenedApp } from './app';
import { onePixelPng, resolveChrome, startOrigins, type OriginHit, type OriginName, type OriginRoute, type Origins } from './harness';

type Loose = Record<string, unknown>;

const PROJECT = 'demo';
const SECTION = DOC_SECTION_SLUGS[0]!;
const COOKIE = { name: 'ccrc_demo', value: 'a' } as const;
const CHANNELS = LAB_BATTERY_CHANNELS;
/** The channels a listed origin may carry: the four directives `mockupCsp` appends to (script, style, img, font). */
const ELEMENT_CHANNELS: readonly string[] = [
  'script', 'script-module', 'import-dynamic', 'link-modulepreload', 'link-stylesheet', 'style-import', 'image', 'image-srcset',
  'svg-image', 'css-background', 'css-content-url', 'css-font-face', 'link-preload',
  // MEASURED (Chromium 156): a `<link rel=prefetch>` to the listed origin is reached, so Chromium checks a prefetch against one of
  // the four directives `mockupCsp` appends to (not against `default-src 'none'`, under which it stayed at 0 for A and B).
  'link-prefetch',
];
/** The channels E9 says a listed origin never gets: the connect family. */
const CONNECT_CHANNELS: readonly string[] = [
  'fetch-cors', 'fetch-nocors', 'fetch-credentials', 'fetch-post', 'fetch-keepalive', 'xhr-get', 'xhr-post', 'beacon', 'websocket',
  'eventsource',
];

// ---- the origins: A, B, C (http) and the two TLS origins -------------------------------------------------------------------

const PNG = onePixelPng();
const png: OriginRoute = () => ({ headers: { 'content-type': 'image/png' }, body: PNG });
const js = (body: string, cors = false): OriginRoute => () => ({
  headers: { 'content-type': 'text/javascript; charset=utf-8', ...(cors ? { 'access-control-allow-origin': '*' } : {}) }, body,
});

/** Pages the host route serves, by id. */
const PAGES = new Map<string, string>();

const DIAGRAM_LIB = `export function draw(root) {
  const ns = 'http://www.w3.org/2000/svg';
  let n = 0;
  for (const pre of [...root.querySelectorAll('pre.diagram')]) {
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '40'); svg.setAttribute('height', '20'); svg.setAttribute('data-from', pre.id);
    const t = document.createElementNS(ns, 'text'); t.textContent = pre.textContent; svg.append(t);
    pre.replaceWith(svg); n += 1;
  }
  return n;
}`;

/** The SVG asset: its own script would beacon to `b` if it ever ran. */
const svgText = (b: string, row: string): string => '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">'
  + '<rect width="24" height="24" fill="#2f6f9f"/>'
  + `<script>window.__svgScript=1;new Image().src='${b}/svg-script?row=${row}'</script></svg>`;

function routesFor(getB: () => string): Readonly<Record<string, OriginRoute>> {
  return {
    '/frame': (hit) => {
      const id = new URL(hit.path, 'http://x.invalid').searchParams.get('id') ?? '';
      return { headers: { 'content-type': 'text/html; charset=utf-8' }, body: PAGES.get(id) ?? '<!doctype html><title>none</title>' };
    },
    '/scratch': () => ({ headers: { 'content-type': 'text/html; charset=utf-8' }, body: '<!doctype html><title>scratch</title><div id="s"></div>' }),
    '/mark.svg': (hit) => ({
      headers: { 'content-type': 'image/svg+xml' },
      body: svgText(getB(), new URL(hit.path, 'http://x.invalid').searchParams.get('row') ?? ''),
    }),
    '/cookie-probe.png': png,
    '/lab3/write.png': png,
    '/lab3/removed.png': png,
    '/e12/img.png': png,
    '/e12/onerror.png': png,
    '/e12/inline.png': png,
    '/e12/sheet.css': () => ({ headers: { 'content-type': 'text/css' }, body: 'body{}' }),
    '/static/script.png': png,
    '/lib/classic.js': js('window.__listedClassic = 1;'),
    '/lib/mod.mjs': js("export const marker = 'module-ok'; globalThis.__modRan = (globalThis.__modRan || 0) + 1;", true),
    '/lib/diagram.mjs': js(DIAGRAM_LIB, true),
  };
}

interface TlsOrigins {
  /** `https://l.site.localhost:<port>`: the origin the rows list in the policy. */
  readonly listed: string;
  /** `https://u.site.localhost:<port>`: valid TLS, never listed. */
  readonly unlisted: string;
  /** Hits: `origin: 'b'` for the listed one and `'c'` for the unlisted one. */
  readonly hits: readonly OriginHit[];
  close(): Promise<void>;
}

async function startTls(routes: Readonly<Record<string, OriginRoute>>): Promise<TlsOrigins> {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-mockup-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '2',
    '-subj', '/CN=l.site.localhost', '-addext', 'subjectAltName=DNS:l.site.localhost,DNS:u.site.localhost',
  ], { stdio: 'ignore' });
  const credentials = { key: readFileSync(key), cert: readFileSync(cert) };
  rmSync(dir, { recursive: true, force: true }); // the pair is in memory now; nothing of it stays on disk
  const hits: OriginHit[] = [];
  const handler = (origin: OriginName) => (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    const hit: OriginHit = {
      origin, method: req.method ?? '', path: url.pathname + url.search, cookie: req.headers.cookie ?? null,
      fetchSite: typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : null,
    };
    hits.push(hit);
    const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : undefined;
    const answer = route === undefined ? { status: 404, headers: { 'content-type': 'text/plain' }, body: 'no such fixture' } : route(hit);
    res.writeHead(answer.status ?? 200, { ...answer.headers });
    res.end(answer.body);
  };
  const listen = (origin: OriginName): Promise<ReturnType<typeof createHttps>> => new Promise((resolve, reject) => {
    const server = createHttps(credentials, handler(origin));
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const [sl, su] = await Promise.all([listen('b'), listen('c')]);
  const port = (s: ReturnType<typeof createHttps>): number => (s.address() as AddressInfo).port;
  const close = (s: ReturnType<typeof createHttps>): Promise<void> => new Promise((resolve) => { s.closeAllConnections(); s.close(() => resolve()); });
  return {
    listed: `https://l.site.localhost:${port(sl)}`, unlisted: `https://u.site.localhost:${port(su)}`, hits,
    close: async () => { await Promise.all([close(sl), close(su)]); },
  };
}

// ---- the browser, the origins, the built app ---------------------------------------------------------------------------

let browser: Browser;
let origins: Origins;
let tls: TlsOrigins;
let dist: string;
let server: DistServer;
let SHELL: string;

const SHELL_META = /<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  let b = '';
  const routes = routesFor(() => b);
  origins = await startOrigins(routes);
  b = origins.b;
  tls = await startTls(routes);
  dist = sharedDist();
  server = await serveDist(dist);
  const found = SHELL_META.exec(readFileSync(path.join(dist, 'index.html'), 'utf8'));
  if (found === null || !found[0].includes("frame-src 'none'")) throw new Error("the built index.html holds no frame-src 'none' shell meta");
  SHELL = found[0];
  browser = await chromium.launch({
    executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks', '--ignore-certificate-errors'],
  });
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  await tls?.close();
  await origins?.close();
});

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

// ---- helpers -----------------------------------------------------------------------------------------------------------

let seq = 0;
const newRow = (p: string): string => `${p}${seq += 1}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

/** `read` polled every 50 ms until it answers something other than null/undefined/false, or `ms` pass (then it throws, naming `what`). A
 *  read that throws (a frame mid-navigation) counts as no answer yet. */
async function until<T>(what: string, read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    let got: T | null | undefined | false = null;
    try { got = await read(); } catch { got = null; }
    if (got !== null && got !== undefined && got !== false) return got;
    if (Date.now() >= deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

/** The first hit of `hits` from `from` that `pred` accepts, polled every 50 ms for at most `ms`; null when none came. */
async function waitHit(hits: readonly OriginHit[], from: number, pred: (h: OriginHit) => boolean, ms: number): Promise<OriginHit | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = hits.slice(from).find(pred);
    if (found !== undefined) return found;
    if (Date.now() >= deadline) return null;
    await sleep(50);
  }
}

const rowOf = (h: OriginHit): string | null => new URL(h.path, 'http://x.invalid').searchParams.get('row');
const pathOf = (h: OriginHit): string => h.path.split('?')[0] ?? '';
/** The hits a row's mockup caused (every request of a row carries `?row=`), optionally on one origin. */
const tagged = (hits: readonly OriginHit[], row: string, who?: OriginName): OriginHit[] =>
  hits.filter((h) => rowOf(h) === row && (who === undefined || h.origin === who));
/** The battery channels a row reached on `who`. */
function reached(hits: readonly OriginHit[], row: string, who: OriginName): string[] {
  const names = new Set<string>();
  for (const h of tagged(hits, row, who)) if (pathOf(h).startsWith('/battery/')) names.add(pathOf(h).slice('/battery/'.length));
  return [...names].sort();
}
/** A negative's window, taken from a positive: `max(1.5 s, 3 x` how long the control took to show its effect`)`. */
const windowFrom = (controlMs: number): number => Math.max(1500, 3 * controlMs);

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
/** A hand-built frame (the controls): no `MockupFrame`, so no attribute the caller does not name. */
const iframeMarkup = (srcdoc: string, sandbox: string | null, csp?: string): string =>
  `<iframe${sandbox === null ? '' : ` sandbox="${esc(sandbox)}"`}${csp === undefined ? '' : ` csp="${esc(csp)}"`} srcdoc="${esc(srcdoc)}"></iframe>`;
/** The production frame for a built page. */
const frameMarkup = (page: string, scripted: boolean): string =>
  renderToStaticMarkup(createElement(MockupFrame, mockupFrameProps(page, scripted, 'Mockup: m.html', () => undefined)));
const withoutAttr = (markup: string): string => {
  const out = markup.replace(/ csp="[^"]*"/, '');
  if (out === markup) throw new Error('the frame markup has no csp attribute to drop');
  return out;
};
const withoutMeta = (page: string): string => {
  const out = page.replace(metaFor(MOCKUP_CSP), '');
  if (out === page) throw new Error('the page does not begin with the base policy meta');
  return out;
};

const pinOf = (p: string): DocPin => ({ kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: SECTION, path: p });

const GEIST = new Uint8Array(readFileSync(path.join(import.meta.dirname, '..', '..', 'ui/src/fonts/GeistMono-Variable.woff2')));
const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);

/** The asset files the fake reader answers, by section-relative path. */
function assetFiles(row: string): Map<string, Uint8Array<ArrayBuffer>> {
  return new Map<string, Uint8Array<ArrayBuffer>>([
    ['img/pixel.png', Uint8Array.from(PNG)],
    ['img/mark.svg', enc(svgText(origins.b, row))],
    ['css/theme.css', enc('#themed{background-color:rgb(1, 2, 3)}')],
    ['fonts/synth.woff2', Uint8Array.from(GEIST)],
    ['js/classic.js', enc('window.__classic = 1;')],
    ['js/mod.mjs', enc('window.__module = 1; export {};')],
  ]);
}

interface Built { readonly page: string; readonly plan: MockupAssetPlan }

/** The page's bytes for the frame, built the way the viewer builds them: the real pre-scan and parse, extract, plan, load (over
 *  a fake reader) and build, with `extra` the origins the viewer's Load external would list. */
async function build(html: string, files: Map<string, Uint8Array<ArrayBuffer>> = new Map(), extra: readonly string[] = []): Promise<Built> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error(`the fixture was refused by the pre-scan: ${JSON.stringify(parsed.prescan)}`);
  const entries = [entry(SECTION, 'm.html'), ...[...files].map(([p, bytes]) => entry(SECTION, p, { committed: { kind: 'file', blob: BLOB_1, size: bytes.byteLength } }))];
  const context: MockupContext = { project: PROJECT, pin: pinOf('m.html'), tree: treeOk({ entries }) };
  const extract = extractMockupRefs(parsed.doc, `${SECTION}/m.html`);
  const plan = planMockupAssets(extract.refs, context);
  const reader = {
    read: async (pin: DocPin) => {
      const bytes = files.get(pin.path);
      return bytes === undefined ? { kind: 'failed' as const, failure: 'missing' } : { kind: 'ok' as const, bytes };
    },
  };
  const result = await loadMockupAssets(plan, reader, new AbortController().signal);
  const built = buildMockupSrcdoc(parsed.doc, result, extra as readonly HttpsOrigin[], true);
  if (!built.ok) throw new Error('the fixture is too large to build');
  return { page: built.page, plan: built.plan };
}

/** The battery as the author's own inline script: every channel once per target, each to `/battery/<name>?row=<row>`, then a
 *  report in `window.__battery` after the battery's own 2.5 s window. */
function batteryJs(targets: readonly string[], row: string): string {
  return `<script>
(function () {
  var vio = [];
  document.addEventListener('securitypolicyviolation', function (e) { vio.push(e.blockedURI); });
  window.__battery = { state: 'waiting' };
  window.addEventListener('load', async function () {
    window.__battery = { state: 'running' };
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    ${LAB_BATTERY_PRELUDE_JS}
    const channels = ${LAB_BATTERY_CHANNELS_JS};
    const attempted = []; const threw = {};
    for (const origin of ${JSON.stringify(targets)}) {
      for (const [name, run] of Object.entries(channels)) {
        attempted.push(name + '@' + origin);
        try { run(origin + '/battery/' + name + '?row=' + ${JSON.stringify(row)}); } catch (e) { threw[name + '@' + origin] = e && e.name; }
      }
    }
    await nap(2500);
    window.__battery = { state: 'done', attempted: attempted.length, threw: Object.keys(threw).length, violations: vio.length };
  });
})();
</script>`;
}

interface BatteryReport { readonly state: string; readonly attempted: number; readonly threw: number; readonly violations: number }

interface HostOptions {
  /** The shell meta of the host page: the built one (default), none, or the text of a replacement policy. */
  readonly shell?: 'built' | 'none' | string;
  readonly head?: string;
}

/** A host page on origin A: the shell meta, a hook recording the parent's own policy violations and the messages it
 *  receives, then each frame in a `#host<i>` wrapper. */
function hostHtml(frames: readonly string[], o: HostOptions = {}): string {
  const shell = o.shell === undefined || o.shell === 'built' ? SHELL : o.shell === 'none' ? '' : `<meta http-equiv="Content-Security-Policy" content="${esc(o.shell)}">`;
  return `<!doctype html><html><head><meta charset="utf-8">${shell}<title>host</title>
<script>window.__pv=[];document.addEventListener('securitypolicyviolation',function(e){window.__pv.push({d:e.effectiveDirective,u:e.blockedURI})});
window.__msgs=[];addEventListener('message',function(e){window.__msgs.push(e.data)});</script>${o.head ?? ''}</head>
<body>${frames.map((f, i) => `<div id="host${i}">${f}</div>`).join('')}</body></html>`;
}

interface Host { readonly ctx: BrowserContext; readonly page: Page }
async function openHost(html: string): Promise<Host> {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  await ctx.addCookies([{ ...COOKIE, url: origins.a }]);
  const page = await ctx.newPage();
  const id = newRow('p');
  PAGES.set(id, html);
  await page.goto(`${origins.a}/frame?id=${id}`, { waitUntil: 'load' });
  return { ctx, page };
}

async function frameAt(page: Page, i = 0, timeout = 15_000): Promise<Frame> {
  const h = await page.locator(`#host${i} iframe`).first().elementHandle({ timeout });
  const f = await h?.contentFrame();
  if (f === null || f === undefined) throw new Error(`#host${i} has no content frame`);
  return f;
}

/** One read of the frame: null when it throws (a frame mid-navigation or swapped to another process) and null when it has not
 *  answered in 3 s, so one stuck evaluate cannot stall a poll past its deadline. */
const read = <T>(f: Frame, fn: () => T): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stuck = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 3000); });
  return Promise.race([f.evaluate(fn).catch(() => null), stuck]).finally(() => { clearTimeout(timer); });
};

async function batteryDone(f: Frame): Promise<BatteryReport> {
  return until('the battery to finish', async () => {
    const r = await read(f, () => (window as unknown as { __battery?: unknown }).__battery);
    return (r as BatteryReport | null)?.state === 'done' ? (r as BatteryReport) : null;
  }, 40_000);
}

const A = (): string => origins.a;
const B = (): string => origins.b;
const C = (): string => origins.c;
const L = (): string => tls.listed;
const U = (): string => tls.unlisted;

/** The blocked-navigation violations the parent recorded. */
const parentViolations = (page: Page): Promise<{ d: string; u: string }[]> =>
  page.evaluate(() => (window as unknown as { __pv: { d: string; u: string }[] }).__pv);

// ---- M5.B1 / E3 / lab 3 and the meta-only row -----------------------------------------------------------------------------

function b1Html(row: string, targets: readonly string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Synthetic mockup</title>
<link rel="stylesheet" href="css/theme.css">
<style>@font-face{font-family:Synth;src:url(fonts/synth.woff2)}.w{font-family:Synth}</style>
<script src="js/classic.js"></script><script type="module" src="js/mod.mjs"></script></head>
<body><p id="themed" class="w">themed</p><img id="px" src="img/pixel.png" alt=""><img id="sv" src="img/mark.svg" alt="">
<img id="rel" src="missing/ghost.png?row=${row}" alt="">${batteryJs(targets, row)}</body></html>`;
}

interface Probe {
  readonly classic: unknown; readonly module: unknown; readonly px: number; readonly sv: number; readonly themed: string; readonly fonts: string[];
}
async function probeAssets(f: Frame): Promise<Probe> {
  return until('the inlined assets to settle', async () => {
    const p = await f.evaluate(async () => {
      const w = window as unknown as Loose;
      await document.fonts.load('16px Synth');
      const px = document.getElementById('px') as HTMLImageElement;
      const sv = document.getElementById('sv') as HTMLImageElement;
      return {
        classic: w['__classic'], module: w['__module'], px: px.complete ? px.naturalWidth : -1, sv: sv.complete ? sv.naturalWidth : -1,
        themed: getComputedStyle(document.getElementById('themed') as HTMLElement).backgroundColor,
        fonts: [...document.fonts].map((x) => `${x.family}:${x.status}`),
      };
    });
    return p.module === 1 ? p : null;
  });
}

describe('M5.B1 / E3 / lab 3: the battery in a scripted frame', () => {
  it('reaches neither A nor B, every inlined asset kind works, the SVG script and the unrewritten relative img do nothing; the no-meta control reaches B', async () => {
    const row = newRow('b1');
    const { page: built, plan } = await build(b1Html(row, [A(), B()]), assetFiles(row));
    const inline = plan.rows.filter((r) => r.verdict.v === 'inline').map((r) => r.ref.raw).sort();
    expect(inline, 'the planner admitted the six assets').toEqual(['css/theme.css', 'fonts/synth.woff2', 'img/mark.svg', 'img/pixel.png', 'js/classic.js', 'js/mod.mjs']);
    expect(plan.rows.find((r) => r.ref.raw.startsWith('missing/'))?.verdict.v, 'the relative img stays as written').toBe('missing');

    // CONTROL first: the same page with no CSP meta and no csp attribute (a hand-built frame), the same Chrome.
    const crow = newRow('b1c');
    const control = await build(b1Html(crow, [A(), B()]), assetFiles(crow));
    const cHost = await openHost(hostHtml([iframeMarkup(withoutMeta(control.page), 'allow-scripts')]));
    const cReport = await batteryDone(await frameAt(cHost.page));
    const cB = reached(origins.hits, crow, 'b');
    expect(cB.length, `the control reaches B on at least 20/27 (reached: ${cB.join(', ')}; threw ${cReport.threw})`).toBeGreaterThanOrEqual(20);
    expect(tagged(origins.hits, crow, 'a').some((h) => pathOf(h) === '/missing/ghost.png'), 'the control sends the relative img to A').toBe(true);
    // The SVG's own script runs when the same bytes are a document (the detector can see it), and never as an img.
    const svgRow = newRow('b1s');
    const svgPage = await (await browser.newContext()).newPage();
    contexts.push(svgPage.context());
    const before = origins.hits.length;
    await svgPage.goto(`${A()}/mark.svg?row=${svgRow}`);
    expect(await waitHit(origins.hits, before, (h) => pathOf(h) === '/svg-script' && rowOf(h) === svgRow, 10_000), 'the svg script runs as a document').not.toBeNull();

    // The production page: MockupFrame (all attributes), the built shell meta, the shipped policy.
    const host = await openHost(hostHtml([frameMarkup(built, true)]));
    const frame = await frameAt(host.page);
    const report = await batteryDone(frame);
    expect(report.attempted, 'two origins, 27 channels').toBe(2 * CHANNELS.length);
    expect(report.violations, 'the frame was refused, not idle: its own CSP raised violations').toBeGreaterThanOrEqual(CHANNELS.length);
    expect(tagged(origins.hits, row), 'nothing the mockup did reached A or B').toEqual([]);
    const probe = await probeAssets(frame);
    expect(probe.classic, 'the inlined classic script ran').toBe(1);
    expect(probe.module, 'the inlined module script ran').toBe(1);
    expect(probe.px, 'the inlined png decoded').toBe(1);
    expect(probe.sv, 'the inlined svg decoded as an img').toBe(24);
    expect(probe.themed, 'the inlined stylesheet applied').toBe('rgb(1, 2, 3)');
    expect(probe.fonts, 'the inlined font loaded').toContain('Synth:loaded');
    expect(tagged(origins.hits, row), 'the svg script did not run and the relative img made no request').toEqual([]);
  }, 180_000);

  it('meta-only: with the csp attribute dropped the meta alone keeps the battery at 0/27; the attribute alone is measured', async () => {
    const row = newRow('mo');
    const { page: built } = await build(b1Html(row, [A(), B()]), assetFiles(row));
    const host = await openHost(hostHtml([withoutAttr(frameMarkup(built, true))]));
    const dom = await host.page.evaluate(() => { const f = document.querySelector('#host0 iframe') as HTMLIFrameElement; return { csp: f.getAttribute('csp'), sandbox: f.getAttribute('sandbox') }; });
    expect(dom, 'the frame has no csp attribute').toEqual({ csp: null, sandbox: 'allow-scripts' });
    const report = await batteryDone(await frameAt(host.page));
    expect(report.violations, 'the meta raised violations').toBeGreaterThanOrEqual(CHANNELS.length);
    expect(tagged(origins.hits, row), 'the meta alone: nothing reached A or B').toEqual([]);

    // Attribute-only: the same page without its meta, the policy given as the csp attribute alone. MEASURED, not assumed.
    const arow = newRow('ao');
    const ao = await build(b1Html(arow, [A(), B()]), assetFiles(arow));
    const aHost = await openHost(hostHtml([iframeMarkup(withoutMeta(ao.page), 'allow-scripts', MOCKUP_CSP)]));
    await batteryDone(await frameAt(aHost.page));
    const viaAttr = reached(origins.hits, arow, 'a').length + reached(origins.hits, arow, 'b').length;
    expect(viaAttr, 'the csp attribute alone on a srcdoc frame: 0 channels reached').toBe(0);
  }, 180_000);
});

// ---- M5.B2 parent wall ---------------------------------------------------------------------------------------------------

type Vector = 'script' | 'refresh' | 'click' | 'api';
const VECTORS: readonly Vector[] = ['script', 'refresh', 'click', 'api'];
function navHtml(v: Vector, row: string): string {
  const target = v === 'api' ? `/api/x?row=${row}` : `${B()}/nav/${v}?row=${row}`;
  const body = {
    // The script navigates only once the TEST has seen the fixture alive and set `__go`: no timer races the test's first read.
    // Its target travels as data, an attribute the script reads, so no value is spliced into script source.
    script: `<i id="target" data-href="${target}" hidden></i><script>setInterval(function(){if(window.__go===1){window.__go=2;location.href=document.getElementById('target').getAttribute('data-href')}},20)</script>`,
    // The refresh cannot be gated, and nothing reads this frame: its positives are the parent's violation report (production)
    // and B's hit (control), both independent of the frame's document.
    refresh: `<meta http-equiv="refresh" content="0;url=${target}"><p>refresh</p>`,
    click: `<a id="lnk" href="${target}">go</a>`,
    api: `<a id="lnk" href="${target}">go</a>`,
  }[v];
  return `<!doctype html><html><head><meta charset="utf-8"><title>nav ${v}</title></head><body>${body}<script>window.__alive=1</script></body></html>`;
}
const navHit = (v: Vector, row: string) => (h: OriginHit): boolean => rowOf(h) === row && pathOf(h) === (v === 'api' ? '/api/x' : `/nav/${v}`);

async function runVector(v: Vector, shell: HostOptions['shell']): Promise<{ row: string; host: Host; from: number }> {
  const row = newRow(`nav${v}`);
  // NO click guard for this row only: with it, a link click is swallowed and the wall would not be what is measured.
  const { page } = await build(navHtml(v, row));
  const unguarded = page.replace(MOCKUP_CLICK_GUARD, '');
  expect(unguarded, 'the click guard was removed for this row').not.toBe(page);
  const from = origins.hits.length;
  const host = await openHost(hostHtml([frameMarkup(unguarded, true)], { shell }));
  if (v !== 'refresh') {
    // The frame is resolved afresh on every poll: a srcdoc frame can be swapped to another process after its commit, and a
    // handle taken before the swap stays detached.
    await until('the fixture to be alive', async () =>
      (await read(await frameAt(host.page, 0, 3000), () => (window as unknown as Loose)['__alive'])) === 1 || null);
    if (v === 'script') await (await frameAt(host.page)).evaluate(() => { (window as unknown as Loose)['__go'] = 1; });
    else {
      // A real click can be lost here: the frame stays on about:srcdoc, loaded and with its link, and nothing navigates
      // (measured: the click and api controls failed in about one run in three, before this change too; most likely the click
      // arrives before Chrome routes input to a srcdoc frame that has just moved to its own process, which is not measured).
      // So the click is repeated until the frame leaves about:srcdoc, for the target, A's /api/x, or Chrome's error page for a
      // refused navigation. A click repeated over a navigation slower than 2 s only restarts it: the control still reaches its
      // target, and the wall still refuses it.
      const left = async (): Promise<true | null> => ((await frameAt(host.page, 0, 3000)).url() !== 'about:srcdoc' ? true : null);
      for (let attempt = 1; ; attempt += 1) {
        await (await frameAt(host.page)).locator('#lnk').click();
        if (await until('the frame to leave about:srcdoc', left, 2000).then(() => true, () => false)) break;
        if (attempt === 5) throw new Error('five link clicks started no navigation: the frame stayed on about:srcdoc');
      }
    }
  }
  return { row, host, from };
}

describe('M5.B2 / E1: the parent wall', () => {
  for (const v of VECTORS) {
    it(`${v}: nothing reaches A or B under the shell meta; control: without it (or with frame-src 'self' for A's /api/x) it does`, async () => {
      // CONTROL first, for the latency the production window is taken from.
      const t0 = Date.now();
      const ctl = await runVector(v, v === 'api' ? "frame-src 'self'" : 'none');
      const hit = await waitHit(origins.hits, ctl.from, navHit(v, ctl.row), 20_000);
      expect(hit, `the control reaches ${v === 'api' ? "A's /api/x" : 'B'}`).not.toBeNull();
      const controlMs = Date.now() - t0;

      const run = await runVector(v, 'built');
      // The parent's own violation report is the positive that bounds the negative: the navigation was refused. MEASURED (Chromium
      // 156, `M5B2-MEASURE` lines): for a navigation to B, Chrome reports `blockedURI` as B's ORIGIN only (no path, no query), and
      // for A's `/api/x` (the parent's own origin) as the FULL URL with its query; the matcher takes exactly those two shapes.
      const blocked = await until('the parent to report the blocked navigation', async () =>
        (await parentViolations(run.host.page)).find((p) => p.u === (v === 'api' ? `${A()}/api/x?row=${run.row}` : B())) ?? null, 20_000)
        .catch(async (e: unknown) => { throw new Error(`${String(e)}; the parent recorded ${JSON.stringify(await parentViolations(run.host.page))}`); });
      process.stderr.write(`M5B2-MEASURE ${v}: the parent's report is ${JSON.stringify(blocked)}\n`);
      expect(['frame-src', 'child-src'], `the parent's ${blocked.d} refused it`).toContain(blocked.d);
      expect(await waitHit(origins.hits, run.from, navHit(v, run.row), windowFrom(controlMs)), 'nothing reached a server').toBeNull();
      expect(tagged(origins.hits, run.row), 'no request of this row at all').toEqual([]);
    }, 120_000);
  }
});

// ---- M5.B3 click guard -------------------------------------------------------------------------------------------------

const guardHtml = `<!doctype html><html><head><meta charset="utf-8"><title>guard</title></head><body>
<a id="go" href="#target">go to the target</a><div style="height:3000px">spacer</div><h2 id="target">Target</h2>
<script>window.__tick=0;setInterval(function(){window.__tick++},50)</script></body></html>`;

describe('M5.B3 / E5: the click guard', () => {
  const tick = (f: Frame): Promise<number | null> => read(f, () => (window as unknown as { __tick?: number }).__tick ?? null);
  it('a fragment click scrolls the target into view and the liveness counter keeps counting; without the guard the frame dies', async () => {
    const { page } = await build(guardHtml);
    expect(page.includes(MOCKUP_CLICK_GUARD), 'the production page carries the guard').toBe(true);
    const host = await openHost(hostHtml([frameMarkup(page, true)]));
    const frame = await frameAt(host.page);
    const t0 = await until('the counter to run', async () => ((await tick(frame)) ?? 0) > 3 || null);
    expect(t0).toBe(true);
    await frame.locator('#go').click();
    const scrolled = await until('the target to scroll into view', async () => {
      const y = await read(frame, () => window.scrollY);
      return y !== null && y > 100 ? y : null;
    });
    expect(scrolled).toBeGreaterThan(100);
    const t1 = (await tick(frame)) ?? 0;
    await until('the counter to keep counting after the click', async () => ((await tick(frame)) ?? 0) > t1 || null);

    // CONTROL: the page built WITHOUT the guard; the same click navigates the frame, which dies.
    const bare = page.replace(MOCKUP_CLICK_GUARD, '');
    expect(bare).not.toBe(page);
    const cHost = await openHost(hostHtml([frameMarkup(bare, true)]));
    const cFrame = await frameAt(cHost.page);
    await until('the control counter to run', async () => ((await tick(cFrame)) ?? 0) > 3 || null);
    await cFrame.locator('#go').click();
    await until('the unguarded frame to die (its counter gone)', async () => ((await tick(cFrame)) === null ? true : null), 20_000);
    expect(await tick(cFrame), 'the beacon stopped').toBeNull();
  }, 120_000);
});

// ---- M5.B4 static mode ------------------------------------------------------------------------------------------------

describe('M5.B4 / E1: static mode', () => {
  it('sandbox="" runs no script (the same page scripted does); a meta refresh is refused (without the shell meta it reaches B)', async () => {
    // Script: the beacon goes to the LISTED TLS origin, which the production policy of this page allows an image from, so a
    // script that ran would be seen on the wire. Static and scripted are the same page bytes; only the sandbox differs.
    const srow = newRow('st');
    const beaconHtml = `<!doctype html><html><head><meta charset="utf-8"><title>beacon</title></head><body><p>x</p>
<script>new Image().src=${JSON.stringify(`${L()}/static/script.png?row=${srow}`)}</script></body></html>`;
    const { page } = await build(beaconHtml, new Map(), [L()]);
    const from = tls.hits.length;
    const t0 = Date.now();
    await openHost(hostHtml([frameMarkup(page, true)]));
    expect(await waitHit(tls.hits, from, (h) => rowOf(h) === srow, 20_000), 'scripted: the script ran and its image reached the listed origin').not.toBeNull();
    const controlMs = Date.now() - t0;
    const sfrom = tls.hits.length;
    const sHost = await openHost(hostHtml([frameMarkup(page, false)]));
    const dom = await sHost.page.evaluate(() => (document.querySelector('#host0 iframe') as HTMLIFrameElement).getAttribute('sandbox'));
    expect(dom, 'static: sandbox is present and empty').toBe('');
    await sHost.page.waitForLoadState('load');
    expect(await waitHit(tls.hits, sfrom, (h) => rowOf(h) === srow, windowFrom(controlMs)), 'static: no script ran').toBeNull();

    // Refresh. MEASURED: Chromium does not follow a meta refresh in a frame with an empty sandbox even when the parent's shell
    // meta is absent (the scripted frame, below, follows it), so the static mode refuses it by itself; the shell meta is the
    // scripted mode's wall (M5.B2). CONTROL: the same page bytes in the scripted frame, no shell meta, reach B.
    const rrow = newRow('sr');
    const refreshHtml = `<!doctype html><html><head><meta charset="utf-8"><title>refresh</title>
<meta http-equiv="refresh" content="0;url=${B()}/static/refresh?row=${rrow}"></head><body><p>x</p></body></html>`;
    const refreshed = await build(refreshHtml);
    const cfrom = origins.hits.length;
    const t1 = Date.now();
    await openHost(hostHtml([frameMarkup(refreshed.page, true)], { shell: 'none' }));
    expect(await waitHit(origins.hits, cfrom, (h) => rowOf(h) === rrow, 20_000), 'control: the scripted frame follows the refresh to B').not.toBeNull();
    const refreshMs = Date.now() - t1;
    for (const shell of ['built', 'none'] as const) {
      const pfrom = origins.hits.length;
      const pHost = await openHost(hostHtml([frameMarkup(refreshed.page, false)], { shell }));
      await pHost.page.waitForLoadState('load');
      await frameAt(pHost.page);
      expect(await waitHit(origins.hits, pfrom, (h) => rowOf(h) === rrow, windowFrom(refreshMs)), `static (shell meta: ${shell}): the refresh is refused`).toBeNull();
    }
  }, 120_000);
});

// ---- attributes in the real DOM -----------------------------------------------------------------------------------------

interface FrameAttrs {
  readonly sandbox: string | null; readonly tokens: string[]; readonly src: boolean; readonly name: boolean; readonly allow: boolean;
  readonly allowfullscreen: boolean; readonly referrerpolicy: string | null; readonly csp: string | null; readonly metaContent: string | null;
}
const attrsOf = (page: Page, i: number): Promise<FrameAttrs> => page.evaluate((n) => {
  const el = document.querySelector(`#host${n} iframe`) as HTMLIFrameElement;
  const meta = new DOMParser().parseFromString(el.srcdoc, 'text/html').querySelector('meta[http-equiv]');
  return {
    sandbox: el.getAttribute('sandbox'), tokens: [...el.sandbox], src: el.hasAttribute('src'), name: el.hasAttribute('name'),
    allow: el.hasAttribute('allow'), allowfullscreen: el.hasAttribute('allowfullscreen'),
    referrerpolicy: el.getAttribute('referrerpolicy'), csp: el.getAttribute('csp'), metaContent: meta?.getAttribute('content') ?? null,
  };
}, i);

describe('the frame attributes in the real DOM', () => {
  it('static: sandbox present and empty; scripted: exactly allow-scripts; no src, name, allow, allowfullscreen; no-referrer; csp equals the meta; a hand-built frame reads the opposite', async () => {
    const { page } = await build('<!doctype html><html><head><title>a</title></head><body><p>x</p></body></html>');
    const control = iframeMarkup('<p>c</p>', 'allow-scripts allow-same-origin').replace('<iframe', '<iframe src="about:blank" name="x" allow="fullscreen" allowfullscreen referrerpolicy="origin"');
    const host = await openHost(hostHtml([frameMarkup(page, false), frameMarkup(page, true), control]));
    const [st, sc, ct] = [await attrsOf(host.page, 0), await attrsOf(host.page, 1), await attrsOf(host.page, 2)];
    for (const a of [st, sc]) {
      expect([a.src, a.name, a.allow, a.allowfullscreen], 'no src, name, allow or allowfullscreen').toEqual([false, false, false, false]);
      expect(a.referrerpolicy).toBe('no-referrer');
      expect(a.csp, 'csp is the meta, one policy').toBe(a.metaContent);
      expect(a.csp).toBe(MOCKUP_CSP);
    }
    expect(st.sandbox, 'static: present').toBe('');
    expect(st.tokens).toEqual([]);
    expect(sc.tokens, 'scripted: exactly allow-scripts').toEqual(['allow-scripts']);
    expect([ct.src, ct.name, ct.allow, ct.allowfullscreen, ct.csp, ct.referrerpolicy], 'the reader sees what a hand-built frame has').toEqual([true, true, true, true, null, 'origin']);
    expect(ct.tokens).toEqual(['allow-scripts', 'allow-same-origin']);
  }, 60_000);
});

// ---- lab 1-2: cookie and storage ---------------------------------------------------------------------------------------

describe('lab 1-2: the opaque origin', () => {
  it('document.cookie and localStorage throw in the scripted frame, and its requests carry no cookie for A; a same-origin frame reads and sends the cookie', async () => {
    const row = newRow('ck');
    const probeHtml = (k: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>${k}</title></head><body>
<script>(function(){
  var t = function (f) { try { f(); return 'held'; } catch (e) { return e.name; } };
  window.__ambient = { cookie: t(function () { return document.cookie; }), local: t(function () { return localStorage.length; }),
    session: t(function () { return sessionStorage.length; }), cookieText: (function () { try { return document.cookie; } catch (e) { return ''; } })() };
  new Image().src = ${JSON.stringify(`${A()}/cookie-probe.png?row=${row}&k=${k}&via=img`)};
  fetch(${JSON.stringify(`${A()}/cookie-probe.png?row=${row}&k=${k}&via=fetch`)}, { credentials: 'include', mode: 'no-cors' }).catch(function () {});
  window.__ready = 1;
})();</script></body></html>`;
    // Production page: the throws.
    const prod = await build(probeHtml('prod'));
    const pHost = await openHost(hostHtml([frameMarkup(prod.page, true)]));
    const pFrame = await frameAt(pHost.page);
    const ambient = await until('the probe to run', async () => read(pFrame, () => (window as unknown as { __ambient?: Loose }).__ambient ?? null));
    expect([ambient['cookie'], ambient['local'], ambient['session']], 'cookie and storage throw in the opaque origin').toEqual(['SecurityError', 'SecurityError', 'SecurityError']);
    expect(tagged(origins.hits, row), 'under the production policy no request left').toEqual([]);
    // Requests have to LEAVE to carry (or not carry) a cookie, so those two frames run without the policy; the sandbox is what
    // withholds the cookie, not the meta. The control frame is same-origin with A (allow-same-origin) and sends it.
    const bare = (k: string): string => iframeMarkup(withoutMeta(`${metaFor(MOCKUP_CSP)}<!doctype html>${probeHtml(k)}`), k === 'sandbox' ? 'allow-scripts' : 'allow-scripts allow-same-origin');
    const from = origins.hits.length;
    const host = await openHost(hostHtml([bare('sandbox'), bare('same')]));
    const hitsOf = (k: string): OriginHit[] => origins.hits.slice(from).filter((h) => h.origin === 'a' && h.path.includes(`k=${k}`) && rowOf(h) === row);
    await until('the same-origin frame to send its probes', async () => hitsOf('same').length >= 2 || null);
    await until('the sandboxed frame to send its probes', async () => hitsOf('sandbox').length >= 2 || null);
    expect(hitsOf('sandbox').map((h) => h.cookie), 'the opaque frame sends no cookie for A').toEqual([null, null]);
    expect(hitsOf('same').every((h) => (h.cookie ?? '').includes('ccrc_demo=a')), 'the same-origin control does').toBe(true);
    const f = await frameAt(host.page, 1);
    const same = await read(f, () => (window as unknown as { __ambient?: Loose }).__ambient ?? null);
    expect(same?.['cookieText'], 'the control reads the cookie').toContain('ccrc_demo=a');
  }, 120_000);
});

// ---- no popup, no top navigation ---------------------------------------------------------------------------------------

describe('no popup and no top navigation', () => {
  const html = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>pop</title></head><body><script>
addEventListener('load', function () {
  var w = null;
  try { w = window.open(${JSON.stringify(`${B()}/popup?row=${row}`)}, '_blank'); } catch (e) {}
  window.__popup = w === null ? 'null' : 'window';
  try { top.location.href = ${JSON.stringify(`${B()}/topnav?row=${row}`)}; window.__top = 'returned'; } catch (e) { window.__top = e.name; }
  window.__done = 1;
});</script></body></html>`;

  it('window.open yields no page and top.location leaves the parent where it is; a frame with allow-popups and allow-top-navigation does both', async () => {
    const crow = newRow('pc');
    const control = await build(html(crow));
    const cctx = await browser.newContext();
    contexts.push(cctx);
    const opened: string[] = [];
    cctx.on('page', (p) => { opened.push(p.url()); });
    const cpage = await cctx.newPage();
    const id = newRow('p');
    PAGES.set(id, hostHtml([iframeMarkup(withoutMeta(control.page), 'allow-scripts allow-popups allow-top-navigation')], { shell: 'none' }));
    const from = origins.hits.length;
    const t0 = Date.now();
    await cpage.goto(`${origins.a}/frame?id=${id}`);
    expect(await waitHit(origins.hits, from, (h) => pathOf(h) === '/popup' && rowOf(h) === crow, 20_000), 'control: the popup request arrives').not.toBeNull();
    expect(await waitHit(origins.hits, from, (h) => pathOf(h) === '/topnav' && rowOf(h) === crow, 20_000), 'control: the top navigation arrives').not.toBeNull();
    const controlMs = Date.now() - t0;
    expect(opened.length, 'control: a popup page opened').toBeGreaterThanOrEqual(1);

    const row = newRow('pp');
    const prod = await build(html(row));
    const pfrom = origins.hits.length;
    const host = await openHost(hostHtml([frameMarkup(prod.page, true)]));
    const pages: string[] = [];
    host.ctx.on('page', (p) => { pages.push(p.url()); });
    const hostUrl = host.page.url();
    const frame = await frameAt(host.page);
    await until('the fixture to finish its attempts', async () => (await read(frame, () => (window as unknown as Loose)['__done'])) === 1 || null);
    const seen = await read(frame, () => { const w = window as unknown as Loose; return { popup: w['__popup'], top: w['__top'] }; });
    expect(seen?.popup, 'window.open returned null').toBe('null');
    expect(await waitHit(origins.hits, pfrom, (h) => rowOf(h) === row, windowFrom(controlMs)), 'no request for the popup or the top navigation').toBeNull();
    expect(pages, 'no page opened in the context').toEqual([]);
    expect(host.page.url(), 'the parent page did not move').toBe(hostUrl);
  }, 120_000);
});

// ---- lab 3, the second half ---------------------------------------------------------------------------------------------

describe('lab 3 (second half): a script cannot lift the frame policy', () => {
  const writeHtml = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>write</title></head><body><script>
addEventListener('load', function () { setTimeout(function () {
  document.open();
  document.write(${JSON.stringify(`<img id="w" src="${B()}/lab3/write.png?row=${row}" onload="window.__wr='load'" onerror="window.__wr='error'">`)});
  document.close();
}, 50); });</script></body></html>`;
  const removeHtml = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>remove</title></head><body><script>
addEventListener('load', function () { setTimeout(function () {
  var sel = 'meta[http-equiv="Content-Security-Policy"]';
  var m = document.querySelector(sel);
  window.__metaBefore = m !== null; if (m) m.remove(); window.__metaAfter = document.querySelector(sel) !== null;
  var i = new Image(); i.onload = function () { window.__rm = 'load'; }; i.onerror = function () { window.__rm = 'error'; };
  i.src = ${JSON.stringify(`${B()}/lab3/removed.png?row=${row}`)};
  fetch(${JSON.stringify(`${B()}/lab3/removed-fetch?row=${row}`)}, { mode: 'no-cors' }).then(function () { window.__rf = 'ok'; }, function () { window.__rf = 'blocked'; });
}, 50); });</script></body></html>`;
  const flag = (f: Frame, name: string): Promise<unknown> => until(`${name} to be set`, async () => {
    const v = await f.evaluate((n) => (window as unknown as Loose)[n], name).catch(() => null);
    return v === undefined ? null : v;
  });

  it('document.open + document.write of an img to B: the img errors and nothing reaches B; the same script with no meta reaches B', async () => {
    const crow = newRow('lwc');
    const control = await build(writeHtml(crow));
    const cHost = await openHost(hostHtml([iframeMarkup(withoutMeta(control.page), 'allow-scripts')]));
    expect(await flag(await frameAt(cHost.page), '__wr'), 'control: the written img loaded').toBe('load');
    expect(tagged(origins.hits, crow, 'b').length, 'control: B saw it').toBeGreaterThanOrEqual(1);

    const row = newRow('lw');
    const prod = await build(writeHtml(row));
    const host = await openHost(hostHtml([frameMarkup(prod.page, true)]));
    const f = await frameAt(host.page);
    expect(await flag(f, '__wr'), 'the written img was refused (its error event is the bound)').toBe('error');
    expect(tagged(origins.hits, row), 'nothing reached B').toEqual([]);
  }, 120_000);

  it('removing the CSP meta element, then requesting B: the policy persists and nothing reaches B; with no meta the requests reach B', async () => {
    const crow = newRow('lrc');
    const control = await build(removeHtml(crow));
    const cHost = await openHost(hostHtml([iframeMarkup(withoutMeta(control.page), 'allow-scripts')]));
    const cf = await frameAt(cHost.page);
    expect([await flag(cf, '__rm'), await flag(cf, '__rf')], 'control: both requests succeed').toEqual(['load', 'ok']);
    expect(tagged(origins.hits, crow, 'b').length).toBeGreaterThanOrEqual(2);

    for (const [label, markup] of [['meta only', (p: string) => withoutAttr(frameMarkup(p, true))], ['meta and attribute', (p: string) => frameMarkup(p, true)]] as const) {
      const row = newRow('lr');
      const prod = await build(removeHtml(row));
      const host = await openHost(hostHtml([markup(prod.page)]));
      const f = await frameAt(host.page);
      expect([await flag(f, '__rm'), await flag(f, '__rf')], `${label}: both requests were refused`).toEqual(['error', 'blocked']);
      const metas = await f.evaluate(() => { const w = window as unknown as Loose; return [w['__metaBefore'], w['__metaAfter']]; });
      expect(metas, `${label}: the meta existed and was removed`).toEqual([true, false]);
      expect(tagged(origins.hits, row), `${label}: nothing reached B`).toEqual([]);
    }
  }, 120_000);
});

// ---- lab 4: blob and data -----------------------------------------------------------------------------------------------

describe('lab 4: blob: and data: URLs', () => {
  it('a blob: URL the parent made cannot load in the child; a data: URL can; the parent and a same-origin frame load the same blob', async () => {
    const { page } = await build('<!doctype html><html><head><title>b</title></head><body><p>x</p></body></html>');
    const same = iframeMarkup('<!doctype html><title>same</title><p>same</p>', 'allow-scripts allow-same-origin');
    const host = await openHost(hostHtml([frameMarkup(page, true), same]));
    const png64 = Buffer.from(PNG).toString('base64');
    const blobUrl = await host.page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    }, png64);
    const load = (f: Frame | Page, url: string): Promise<string> => f.evaluate((u) => new Promise<string>((resolve) => {
      const i = new Image();
      i.onload = () => resolve('load');
      i.onerror = () => resolve('error');
      setTimeout(() => resolve('no event'), 15_000);
      i.src = u;
    }), url);
    expect(await load(host.page, blobUrl), 'control: the parent loads its blob').toBe('load');
    expect(await load(await frameAt(host.page, 1), blobUrl), 'control: a same-origin frame loads it').toBe('load');
    const child = await frameAt(host.page, 0);
    expect(await load(child, `data:image/png;base64,${png64}`), 'the child loads a data: URL').toBe('load');
    expect(await load(child, blobUrl), 'the child cannot load the parent\'s blob: URL').toBe('error');
  }, 120_000);
});

// ---- M5.B7 / E9, M5.B11 and the diagram fixture ----------------------------------------------------------------------------

describe('M5.B7 / E9: a listed origin', () => {
  const html = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>listed</title>
<script src="${L()}/lib/classic.js?row=${row}"></script></head><body><p>x</p>${batteryJs([A(), C(), L(), U()], row)}</body></html>`;

  it("the listed origin's script runs; A, C and an unlisted TLS origin stay at 0/27; the listed one gets no connect channel and no cookie; the base CSP runs no listed script; no CSP reaches the listed origin", async () => {
    const row = newRow('b7');
    const listed = await build(html(row), new Map(), [L()]);
    expect(listed.page.startsWith(metaFor(mockupCsp([L() as HttpsOrigin]))), 'the page carries the policy with exactly the listed origin').toBe(true);
    const host = await openHost(hostHtml([frameMarkup(listed.page, true)]));
    const frame = await frameAt(host.page);
    await batteryDone(frame);
    expect(await read(frame, () => (window as unknown as Loose)['__listedClassic']), "the listed origin's classic script ran").toBe(1);
    expect(tagged(origins.hits, row), 'A, B and C: nothing').toEqual([]);
    expect(tagged(tls.hits, row, 'c'), 'the unlisted TLS origin: nothing').toEqual([]);
    const got = reached(tls.hits, row, 'b');
    expect(got, `the listed origin carries no connect channel (reached: ${got.join(', ')})`).toEqual(got.filter((n) => !CONNECT_CHANNELS.includes(n)));
    expect(got.filter((n) => !ELEMENT_CHANNELS.includes(n)), 'only element channels reach the listed origin (no iframe, audio or video)').toEqual([]);
    expect(got, 'the listed origin\'s script channel is reached').toContain('script');
    expect(tagged(tls.hits, row, 'b').every((h) => h.cookie === null), 'no cookie anywhere').toBe(true);
    expect(tagged(tls.hits, row, 'b').some((h) => pathOf(h) === '/lib/classic.js'), 'the page\'s own script request arrived').toBe(true);
    process.stderr.write(`M5B7-MEASURE listed origin reached: ${got.join(', ')}\n`);

    // CONTROL 1: the base policy (nothing listed): the same page runs no listed script and reaches nothing.
    const brow = newRow('b7b');
    const base = await build(html(brow));
    const bHost = await openHost(hostHtml([frameMarkup(base.page, true)]));
    const bf = await frameAt(bHost.page);
    await batteryDone(bf);
    expect(await read(bf, () => (window as unknown as Loose)['__listedClassic'] ?? null), 'base CSP: the listed script did not run').toBeNull();
    expect(tagged(tls.hits, brow).length + tagged(origins.hits, brow).length, 'base CSP: nothing reached any origin').toBe(0);
    // CONTROL 2: no CSP at all: the listed origin is reachable on at least 20/27.
    const nrow = newRow('b7n');
    const none = await build(html(nrow));
    const nHost = await openHost(hostHtml([iframeMarkup(withoutMeta(none.page), 'allow-scripts')]));
    await batteryDone(await frameAt(nHost.page));
    expect(reached(tls.hits, nrow, 'b').length, 'no CSP: the listed origin reaches 20/27 or more').toBeGreaterThanOrEqual(20);
  }, 180_000);
});

describe('M5.B11: a module import() from a listed origin', () => {
  const html = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>imports</title></head><body><p>x</p><script>
(async function () {
  var targets = { listed: ${JSON.stringify(L())}, unlisted: ${JSON.stringify(U())}, a: ${JSON.stringify(A())}, b: ${JSON.stringify(B())}, c: ${JSON.stringify(C())} };
  var out = {};
  for (var k in targets) {
    try { var m = await import(targets[k] + '/lib/mod.mjs?row=' + ${JSON.stringify(row)} + '&o=' + k); out[k] = 'loaded:' + m.marker; }
    catch (e) { out[k] = 'blocked:' + (e && e.name); }
  }
  window.__imports = out;
})();</script></body></html>`;
  const imports = async (extra: readonly string[], shellless = false, row = newRow('b11')): Promise<Record<string, string>> => {
    const built = await build(html(row), new Map(), extra);
    const frame = shellless ? iframeMarkup(withoutMeta(built.page), 'allow-scripts') : frameMarkup(built.page, true);
    const host = await openHost(hostHtml([frame]));
    const f = await frameAt(host.page);
    return until('the imports to settle', async () => read(f, () => (window as unknown as { __imports?: Record<string, string> }).__imports ?? null), 40_000);
  };

  it('loads from the listed origin; blocked under the base CSP and from every unlisted origin; with no CSP every one loads', async () => {
    const control = await imports([], true);
    expect(Object.values(control).every((v) => v === 'loaded:module-ok'), `control (no CSP): every origin's module loads (${JSON.stringify(control)})`).toBe(true);
    const listed = await imports([L()]);
    expect(listed['listed'], 'the listed origin loads').toBe('loaded:module-ok');
    for (const k of ['unlisted', 'a', 'b', 'c']) expect(listed[k], `${k} is blocked`).toMatch(/^blocked:/);
    const base = await imports([]);
    for (const [k, v] of Object.entries(base)) expect(v, `base CSP: ${k} is blocked`).toMatch(/^blocked:/);
  }, 180_000);
});

describe('the synthetic CDN-module diagram fixture (Task 10)', () => {
  const html = (): string => `<!doctype html><html><head><meta charset="utf-8"><title>diagrams</title></head><body>
<nav id="toc" aria-label="Contents"></nav>
<pre class="diagram" id="d1">graph A to B</pre><pre class="diagram" id="d2">graph C to D</pre>
<script type="module">
try {
  const lib = await import(${JSON.stringify(`${L()}/lib/diagram.mjs`)});
  lib.draw(document);
} catch (e) { document.body.dataset.diagramError = String(e && e.name); }
document.body.dataset.diagramDone = '1';
</script></body></html>`;
  const count = async (extra: readonly string[]): Promise<{ pre: number; svg: number; error: string | null; toc: number }> => {
    const built = await build(html(), new Map(), extra);
    const host = await openHost(hostHtml([frameMarkup(built.page, true)]));
    const f = await frameAt(host.page);
    return until('the fixture to finish', async () => read(f, () => document.body.dataset['diagramDone'] === '1' ? {
      pre: document.querySelectorAll('pre.diagram').length, svg: document.querySelectorAll('svg[data-from]').length,
      error: document.body.dataset['diagramError'] ?? null, toc: document.getElementById('toc')?.children.length ?? -1,
    } : null), 40_000);
  };
  it('base CSP: the import is blocked and both diagrams stay as source; mockupCsp([listed]): measured', async () => {
    const base = await count([]);
    expect(base, 'base CSP').toEqual({ pre: 2, svg: 0, error: 'TypeError', toc: 0 });
    const listed = await count([L()]);
    process.stderr.write(`DIAGRAM-MEASURE base ${JSON.stringify(base)} listed ${JSON.stringify(listed)}\n`);
    expect(listed, 'mockupCsp([listed]): the listed module loads, so both diagrams draw').toEqual({ pre: 0, svg: 2, error: null, toc: 0 });
  }, 120_000);
});

// ---- E10: desktop isolation ----------------------------------------------------------------------------------------------

describe('E10 (desktop): a scripted frame\'s busy loop', () => {
  /** The parent's own 50 ms timer, recording absolute times (`Date.now()`, comparable with the frame's). */
  const head = `<script>window.__gaps=[];(function(){var last=Date.now();setInterval(function(){var t=Date.now();window.__gaps.push({t:t,gap:t-last});last=t;},50)})();</script>`;
  const busyHtml = `<!doctype html><html><head><meta charset="utf-8"><title>busy</title></head><body><script>
addEventListener('load', function () { setTimeout(function () {
  var start = Date.now();
  for (const end = Date.now() + 3000; Date.now() < end;);
  parent.postMessage({ busy: [start, Date.now()] }, '*');
}, 300); });</script></body></html>`;
  type Gap = { t: number; gap: number };
  const gaps = (p: Page): Promise<Gap[]> => p.evaluate(() => (window as unknown as { __gaps: Gap[] }).__gaps);
  /** The largest gap among the samples inside [from - 100, to + 100] and how many there were. */
  const within = (all: Gap[], from: number, to: number): { max: number; n: number } => {
    const s = all.filter((g) => g.t >= from - 100 && g.t <= to + 100);
    return { max: Math.max(0, ...s.map((g) => g.gap)), n: s.length };
  };
  /** The bound a loaded CI runner will not flake on: the design measured at most 52 ms on desktop Chromium, so 250 ms is nearly
   *  five times that and still an order of magnitude under the 3 000 ms stall a shared thread would show. */
  const BOUND_MS = 250;

  it('leaves the parent\'s 50 ms timer under the bound; the same loop in the parent shows a gap over 2000 ms', async () => {
    const { page } = await build(busyHtml);
    const host = await openHost(hostHtml([frameMarkup(page, true)], { head }));
    const done = await until('the frame to report its busy loop', async () => {
      const m = await host.page.evaluate(() => (window as unknown as { __msgs: { busy?: [number, number] }[] }).__msgs.find((x) => x?.busy !== undefined)?.busy ?? null);
      return m;
    }, 40_000);
    const frame = within(await gaps(host.page), done[0], done[1]);
    process.stderr.write(`E10-MEASURE frame busy ${done[1] - done[0]} ms: parent timer max gap ${frame.max} ms over ${frame.n} samples\n`);
    expect(done[1] - done[0], 'the loop really ran 3 s').toBeGreaterThanOrEqual(2900);
    expect(frame.n, 'the parent timer kept sampling through the loop').toBeGreaterThanOrEqual(20);
    expect(frame.max, `the parent's largest gap stays under ${BOUND_MS} ms`).toBeLessThan(BOUND_MS);

    // CONTROL: the same loop in the parent itself.
    const cHost = await openHost(hostHtml([], { head }));
    const [s, e] = await cHost.page.evaluate(() => { const start = Date.now(); for (const end = Date.now() + 3000; Date.now() < end;); return [start, Date.now()] as [number, number]; });
    await until('two more ticks after the loop', async () => (await gaps(cHost.page)).filter((g) => g.t > e).length >= 2 || null);
    const control = within(await gaps(cHost.page), s, e);
    process.stderr.write(`E10-MEASURE control (parent busy): max gap ${control.max} ms\n`);
    expect(control.max, 'the timer sees the hazard: a gap over 2000 ms').toBeGreaterThan(2000);
  }, 120_000);
});

// ---- E12: the inert parse ----------------------------------------------------------------------------------------------

describe('E12: the browser\'s DOMParser on a hostile page', () => {
  const hostile = (row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>Hostile</title>
<link rel="stylesheet" href="${B()}/e12/sheet.css?row=${row}">
<meta http-equiv="refresh" content="30;url=${B()}/e12/refresh?row=${row}">
<script src="${B()}/e12/script.js?row=${row}"></script>
<script>window.__e12ran=1;new Image().src=${JSON.stringify(`${B()}/e12/inline.png?row=${row}`)}</script></head>
<body><img src="${B()}/e12/img.png?row=${row}" alt="x">
<img src="x:broken" alt="y" onerror="window.__e12onerror=1;new Image().src='${B()}/e12/onerror.png?row=${row}'"></body></html>`;
  const flags = (p: Page): Promise<{ ran: unknown; onerror: unknown }> =>
    p.evaluate(() => { const w = window as unknown as Loose; return { ran: w['__e12ran'] ?? null, onerror: w['__e12onerror'] ?? null }; });

  it('parses with 0 requests to B and runs no script or handler; the same text as a live element\'s innerHTML reaches B and runs the handler', async () => {
    // CONTROL first: the text as a live scratch element's innerHTML (a scratch page on A, never the console). The meta refresh
    // here waits 30 s, so it cannot move the scratch page inside this row.
    const crow = newRow('e12c');
    const cctx = await browser.newContext();
    contexts.push(cctx);
    const cpage = await cctx.newPage();
    await cpage.goto(`${A()}/scratch`);
    const from = origins.hits.length;
    const t0 = Date.now();
    await cpage.evaluate((t) => { (document.getElementById('s') as HTMLElement).innerHTML = t; }, hostile(crow));
    const img = await waitHit(origins.hits, from, (h) => pathOf(h) === '/e12/img.png' && rowOf(h) === crow, 20_000);
    expect(img, 'control: the live element reaches B').not.toBeNull();
    const controlMs = Date.now() - t0;
    expect(await waitHit(origins.hits, from, (h) => pathOf(h) === '/e12/sheet.css' && rowOf(h) === crow, 20_000), 'control: its stylesheet link too').not.toBeNull();
    await until('the control onerror handler to run', async () => (await flags(cpage)).onerror === 1 || null);
    expect((await flags(cpage)).ran, 'control: an inserted script does not run (innerHTML), so the handler is the proof').toBeNull();

    // The parse, as parse.ts makes it once the pre-scan admits the text (the pre-scan is the real one, in node).
    const row = newRow('e12');
    const text = hostile(row);
    expect(prescanMockup(text).ok, 'the pre-scan admits the hostile page').toBe(true);
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const page = await ctx.newPage();
    await page.goto(`${A()}/scratch`);
    const pfrom = origins.hits.length;
    const counts = await page.evaluate((t) => {
      const d = new DOMParser().parseFromString(t, 'text/html');
      return { imgs: d.images.length, links: d.querySelectorAll('link').length, scripts: d.scripts.length, metas: d.querySelectorAll('meta[http-equiv]').length };
    }, text);
    expect(counts, 'the parser saw every planted element').toEqual({ imgs: 2, links: 1, scripts: 2, metas: 1 });
    expect(await waitHit(origins.hits, pfrom, (h) => rowOf(h) === row, windowFrom(controlMs)), 'the inert parse made no request').toBeNull();
    expect(await flags(page), 'no script and no handler ran').toEqual({ ran: null, onerror: null });
  }, 120_000);
});

// ---- the app rows: the real built PWA ----------------------------------------------------------------------------------------

const DOCS: Map<string, string> = new Map();
const blobOf = (p: string): string => Buffer.from(p).toString('hex').padEnd(40, '0').slice(0, 40);

function docsAnswer(url: URL): { status: number; headers: Record<string, string>; body: string } {
  const json = 'application/json; charset=utf-8';
  if (url.pathname.endsWith('/tree')) {
    const entries = [...DOCS].map(([p, t]) => entry(SECTION, p, { committed: { kind: 'file', blob: blobOf(p), size: Buffer.byteLength(t) } }));
    return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify(treeResponse(treeOk({ entries }))) };
  }
  const p = url.searchParams.get('path') ?? '';
  const text = DOCS.get(p);
  if (text === undefined) return { status: 404, headers: { 'content-type': json }, body: JSON.stringify({ ok: false, failure: 'not-a-file' }) };
  const show = {
    v: 1, verb: 'docs-show', ok: true, elapsedMs: 3, source: 'committed', section: SECTION, path: p, size: Buffer.byteLength(text),
    sha256: blobOf(p).padEnd(64, '0'), encoding: 'utf8', text, commit: COMMIT_A, blob: blobOf(p), onRef: 'contains',
  };
  return { status: 200, headers: { ...DOCS_RESPONSE_HEADERS, 'content-type': json }, body: JSON.stringify({ ok: true, contentClass: 'html', from: 'ccd', show }) };
}

/** The page-side recorder every app row installs: iframe insertions and removals with times, clicks with times, the messages
 *  the window receives. */
const APP_HOOK = `(() => {
  window.__t = { adds: [], removes: [], clicks: [] }; window.__msgs = 0;
  addEventListener('message', () => { window.__msgs += 1; });
  addEventListener('click', () => { window.__t.clicks.push(performance.now()); }, true);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === 'IFRAME' || n.querySelector?.('iframe'))) window.__t.adds.push(performance.now());
      for (const n of m.removedNodes) if (n.nodeType === 1 && (n.tagName === 'IFRAME' || n.querySelector?.('iframe'))) window.__t.removes.push(performance.now());
    }
  }).observe(document, { childList: true, subtree: true });
})();`;

interface AppSession { readonly app: OpenedApp; readonly page: Page }
async function openDocs(width: number, height: number): Promise<AppSession> {
  const app = await openApp(browser, { width, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
  contexts.push(app.ctx);
  await app.page.setViewportSize({ width, height });
  await app.ctx.addInitScript(APP_HOOK);
  await app.ctx.route((u) => u.pathname.startsWith('/api/docs/'), async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') { await route.fulfill({ status: 204 }); return; }
    const a = docsAnswer(new URL(req.url()));
    await route.fulfill({ status: a.status, headers: a.headers, body: a.body });
  });
  return { app, page: app.page };
}
const leaf = (name: string): string => `${server.origin}/docs/${PROJECT}/${SECTION}/${name}`;
const framed = (page: Page): Promise<void> => page.locator('.docs-mockup[data-state="framed"]').waitFor({ timeout: 60_000 });
const runScripts = (page: Page): Promise<void> => page.getByRole('button', { name: MOCKUP_TEXT.runScripts }).click();

describe('the real viewer', () => {
  it('second-load teardown: a scripted frame that navigates itself (script, or meta refresh) is removed with its notice and Reload mockup; no new frame appears within the window a remount takes', async () => {
    // The script's target travels as data, an attribute the script reads, so no value is spliced into script source.
    const away = (via: 'script' | 'refresh', row: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>away ${via}</title>${
      via === 'refresh' ? `<meta http-equiv="refresh" content="1;url=${B()}/away?row=${row}">` : ''}</head><body><p>away</p>${
      via === 'script' ? `<i id="target" data-href="${B()}/away?row=${row}" hidden></i><script>addEventListener('load', function () { setTimeout(function () { location.href = document.getElementById('target').getAttribute('data-href'); }, 50); });</script>` : ''}</body></html>`;
    for (const via of ['script', 'refresh'] as const) {
      const row = newRow(`away${via}`);
      DOCS.set(`away-${via}.html`, away(via, row));
      const { page } = await openDocs(1280, 800);
      await page.goto(leaf(`away-${via}.html`));
      await framed(page);
      await runScripts(page);
      const notice = page.locator('.docs-mockup-away');
      await notice.waitFor({ timeout: 30_000 });
      expect(await notice.innerText(), `${via}: the notice`).toContain(MOCKUP_TEXT.navigatedAway);
      expect(await page.getByRole('button', { name: MOCKUP_TEXT.reload }).count(), `${via}: Reload mockup is offered`).toBe(1);
      expect(await page.locator('iframe.docs-mockup-frame').count(), `${via}: the frame is gone`).toBe(0);
      // The window the frame must stay away for: 2 s here, then the CONTROL (a Reload mockup tap mounts a frame) shows it is
      // at least three times what a remount takes.
      const addsBefore = await page.evaluate(() => (window as unknown as { __t: { adds: number[] } }).__t.adds.length);
      const end = Date.now() + 2000;
      while (Date.now() < end) {
        expect(await page.locator('iframe.docs-mockup-frame').count(), `${via}: still no frame`).toBe(0);
        await sleep(50);
      }
      expect(await page.evaluate(() => (window as unknown as { __t: { adds: number[] } }).__t.adds.length), `${via}: no frame was inserted in the window`).toBe(addsBefore);
      await page.getByRole('button', { name: MOCKUP_TEXT.reload }).click();
      const t = await until(`${via}: a new frame after Reload mockup`, async () => {
        const r = await page.evaluate(() => { const x = (window as unknown as { __t: { adds: number[]; clicks: number[] } }).__t; return { adds: x.adds, clicks: x.clicks }; });
        const click = r.clicks.at(-1);
        const add = click === undefined ? undefined : r.adds.find((a) => a >= click);
        return add === undefined || click === undefined ? null : add - click;
      });
      process.stderr.write(`TEARDOWN-MEASURE ${via}: a remount mounted a frame ${Math.round(t)} ms after the tap\n`);
      expect(t * 3, `${via}: the no-frame window (2000 ms) is at least three times a remount`).toBeLessThanOrEqual(2000);
      expect(tagged(origins.hits, row), `${via}: the target never received a request`).toEqual([]);
    }
  }, 180_000);

  it('no parent messages: parent.postMessage from the scripted frame changes nothing in the console', async () => {
    DOCS.set('post.html', `<!doctype html><html><head><meta charset="utf-8"><title>post</title></head><body><p>post</p><script>
addEventListener('load', function () { setTimeout(function () {
  parent.postMessage({ type: 'navigate', href: '/' }, '*'); parent.postMessage('close', '*'); parent.postMessage([1, 2, 3], '*');
}, 300); });</script></body></html>`);
    const { app, page } = await openDocs(1280, 800);
    await page.goto(leaf('post.html'));
    await framed(page);
    const url = page.url();
    await runScripts(page);
    await page.locator('iframe.docs-mockup-frame[sandbox="allow-scripts"]').waitFor({ timeout: 30_000 });
    await page.evaluate(() => document.querySelector('iframe.docs-mockup-frame')?.setAttribute('data-probe', '1'));
    // The counter is the proof the post happened: all three messages arrived at the window.
    await until('the three messages to arrive', async () => (await page.evaluate(() => (window as unknown as { __msgs: number }).__msgs)) >= 3 || null);
    // Two animation frames after the last arrival: a handler's state change would have been committed.
    await page.evaluate(() => new Promise<void>((r) => { requestAnimationFrame(() => requestAnimationFrame(() => r())); }));
    expect(page.url(), 'no navigation').toBe(url);
    expect(await page.locator('iframe.docs-mockup-frame[data-probe="1"]').count(), 'the same frame element stands').toBe(1);
    expect(await page.locator('.docs-mockup-away').count(), 'no teardown notice').toBe(0);
    expect(app.errors, 'no page error').toEqual([]);
  }, 120_000);

  it('chrome and widths: controls at least 44 px, inside the viewport, a 70% frame and no horizontal scroll at 412x915 and 1280x800', async () => {
    DOCS.set('m.html', `<!doctype html><html><head><meta charset="utf-8"><title>m</title></head><body><h1>Synthetic mockup</h1><p>Body.</p>
<a href="#x">a link</a><script>window.__m=1</script></body></html>`);
    const meter = (page: Page) => page.evaluate(() => {
      const sel = '.docs-mockup-toolbar .docs-leaf-action, .docs-mockup-fold > summary';
      const rects = [...document.querySelectorAll(sel)].map((e) => { const r = e.getBoundingClientRect(); return { h: r.height, l: r.left, r: r.right, text: (e.textContent ?? '').slice(0, 24) }; });
      const f = document.querySelector('iframe.docs-mockup-frame') as HTMLElement;
      return {
        count: rects.length, short: rects.filter((r) => r.h < 43.5).map((r) => r.text), outside: rects.filter((r) => r.l < -0.5 || r.r > innerWidth + 0.5).map((r) => r.text),
        frameRatio: f.getBoundingClientRect().height / innerHeight, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
      };
    });
    for (const [w, h] of [[412, 915], [1280, 800]] as const) {
      const { page } = await openDocs(w, h);
      await page.goto(leaf('m.html'));
      await framed(page);
      const m = await meter(page);
      expect(m.count, `${w}: the toolbar and folds were measured (Run scripts, Full screen, New tab, Source, Download and two summaries)`).toBeGreaterThanOrEqual(6);
      expect(m.short, `${w}: no control under 44 px`).toEqual([]);
      expect(m.outside, `${w}: every control inside the viewport`).toEqual([]);
      expect(Math.abs(m.frameRatio - 0.7), `${w}: the frame is 70% of the viewport height (${m.frameRatio})`).toBeLessThan(0.01);
      expect(m.scrollW, `${w}: no horizontal scroll`).toBeLessThanOrEqual(m.innerW);
      // CONTROL: the same meter reads a short control and a wide page as violations.
      await page.evaluate(() => {
        const t = document.querySelector('.docs-mockup-toolbar') as HTMLElement;
        const b = document.createElement('button'); b.className = 'docs-leaf-action'; b.textContent = 'short'; b.style.minHeight = '0'; b.style.height = '20px'; t.append(b);
        const wide = document.createElement('div'); wide.style.width = '3000px'; wide.style.height = '4px'; document.body.append(wide);
      });
      const bad = await meter(page);
      expect(bad.short, `${w}: control: the meter sees a 20 px control`).toContain('short');
      expect(bad.scrollW, `${w}: control: the meter sees a wide page`).toBeGreaterThan(bad.innerW);
    }
  }, 180_000);
});
