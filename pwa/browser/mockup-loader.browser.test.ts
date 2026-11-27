// X2 P6.2 (plan 2026-11-18-native-docs-parity, Task P6.2; spec 4.8): the in-walls page loader in a real Chromium. Each row
// builds its page the way the viewer does (the real pre-scan and parse, `planMockupPage`, `loadMockupAssets` over a fake reader that answers each sibling's bytes, `buildMockupSrcdoc`), puts it in the production
// frame (`MockupFrame`, scripted: `sandbox="allow-scripts"`) on a host page under the shell's `frame-src 'none'`, and reads
// what the page's own script wrote into `document.body.dataset`. Every fixture is synthetic; the hosts are loopback names
// under `site.localhost` (`harness.ts`).
//
// Rows:
//   two modules        a module script that imports a sibling module runs, and reads the sibling's export
//   import map         an inline module importing a bare name the page's map maps to a sibling runs
//   shared module      two modules importing one sibling get ONE instance of it (the build inlines each module once)
//   JSON fetch         `fetch('data.json')` answers the sibling's JSON, typed `application/json`
//   model              `fetch('model.glb')` of a model under the budget answers its bytes and `model/gltf-binary`
//   outside the set    on the same page, a fetch of another origin, of an unplanned sibling and of a `data:` URL each fail with
//                      a TypeError, the other origin logs no request, and the policy reports a `connect-src` violation for
//                      each; CONTROL: the planned sibling on that page answers, with no report
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/mockup-loader.browser.test.ts )`, through `ccrc test`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Frame } from 'playwright-core';
import { DOC_SECTION_SLUGS, type DocPin } from '../../shared/docs';
import { MockupFrame, mockupFrameProps } from '../src/docs/MockupFrame';
import { buildMockupSrcdoc, loadMockupAssets, planMockupPage } from '../src/docs/mockup/load';
import { parseMockup } from '../src/docs/mockup/parse';
import type { MockupContext } from '../src/docs/mockup/ports';
import { BLOB_1, COMMIT_A, entry, treeOk } from '../test/docsFixtures';
import { resolveChrome, startOrigins, type OriginHit, type Origins } from './harness';

const SECTION = DOC_SECTION_SLUGS[0]!;
const SHELL = `<meta http-equiv="Content-Security-Policy" content="frame-src 'none'">`;
const PAGES = new Map<string, string>();
let browser: Browser;
let origins: Origins;
const contexts: BrowserContext[] = [];

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  origins = await startOrigins({
    '/frame': (hit) => ({
      headers: { 'content-type': 'text/html; charset=utf-8' },
      body: PAGES.get(new URL(hit.path, 'http://x.invalid').searchParams.get('id') ?? '') ?? '<!doctype html><title>none</title>',
    }),
    '/beacon.json': () => ({ headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: '{"reached":true}' }),
  });
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-features=LocalNetworkAccessChecks'] });
}, 240_000);

afterAll(async () => {
  await browser?.close();
  await origins?.close();
});

afterEach(async () => {
  for (const c of contexts.splice(0)) await c.close();
});

const enc = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
let seq = 0;

async function until<T>(what: string, read: () => Promise<T | null | undefined>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    let got: T | null | undefined = null;
    try { got = await read(); } catch { got = null; }
    if (got !== null && got !== undefined) return got;
    if (Date.now() >= deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

/** The page built as the viewer builds it, from `files` (section-relative path to bytes). */
async function build(html: string, files: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): Promise<string> {
  const parsed = parseMockup(html);
  if (!parsed.ok) throw new Error('the fixture was refused by the pre-scan');
  const pin: DocPin = { kind: 'committed', commit: COMMIT_A, servedRef: 'refs/remotes/origin/main', section: SECTION, path: 'm.html' };
  const entries = [entry(SECTION, 'm.html'), ...[...files].map(([p, b]) => entry(SECTION, p, { committed: { kind: 'file', blob: BLOB_1, size: b.byteLength } }))];
  const context: MockupContext = { project: 'demo', pin, tree: treeOk({ entries }) };
  const { plan } = planMockupPage(parsed.doc, `${SECTION}/m.html`, context);
  const reader = {
    read: async (p: DocPin) => {
      const b = files.get(p.path);
      return b === undefined ? { kind: 'failed' as const, failure: 'not-found' } : { kind: 'ok' as const, bytes: b };
    },
  };
  const built = buildMockupSrcdoc(parsed.doc, await loadMockupAssets(plan, reader, new AbortController().signal), [], true);
  if (!built.ok) throw new Error('the fixture is too large to build');
  return built.page;
}

/** The built page in the production frame on a host page of origin A; the frame. */
async function open(page: string): Promise<Frame> {
  const frame = renderToStaticMarkup(createElement(MockupFrame, mockupFrameProps(page, true, 'Mockup: m.html', () => undefined)));
  const id = `p${seq += 1}`;
  PAGES.set(id, `<!doctype html><html><head><meta charset="utf-8">${SHELL}<title>host</title></head><body><div id="host">${frame}</div></body></html>`);
  const ctx = await browser.newContext();
  contexts.push(ctx);
  const tab = await ctx.newPage();
  await tab.goto(`${origins.a}/frame?id=${id}`, { waitUntil: 'load' });
  const h = await tab.locator('#host iframe').first().elementHandle({ timeout: 15_000 });
  const f = await h?.contentFrame();
  if (f === null || f === undefined) throw new Error('no content frame');
  return f;
}

/** What the page's script wrote, once it wrote `done`. */
async function result(f: Frame): Promise<Record<string, string>> {
  return until('the page to finish', async () => {
    const d = await f.evaluate(() => ({ ...document.body.dataset }) as Record<string, string>).catch(() => null);
    return d !== null && d['done'] === '1' ? d : null;
  });
}

const PAGE = (head: string): string => `<!doctype html><html><head><meta charset="utf-8">${head}</head><body></body></html>`;

describe('X2 P6.2 the in-walls page loader in Chromium', () => {
  it('two modules: a module that imports a sibling module runs', async () => {
    const page = await build(PAGE('<script type="module" src="js/main.js"></script>'), new Map([
      ['js/main.js', enc("import { b } from './b.js';\ndocument.body.dataset.v = b;\ndocument.body.dataset.done = '1';\n")],
      ['js/b.js', enc("export const b = 'from-b';\n")],
    ]));
    expect((await result(await open(page)))['v']).toBe('from-b');
  });

  it('import map: an inline module importing a bare name the map maps to a sibling runs', async () => {
    const page = await build(PAGE(`<script type="importmap">{"imports":{"lib":"./js/lib.js"}}</script>
<script type="module">import { v } from 'lib'; document.body.dataset.v = v; document.body.dataset.done = '1';</script>`), new Map([
      ['js/lib.js', enc("export const v = 'from-lib';\n")],
    ]));
    expect((await result(await open(page)))['v']).toBe('from-lib');
  });

  it('shared module: two modules importing one sibling share one instance of it', async () => {
    const page = await build(PAGE('<script type="module" src="main.js"></script>'), new Map([
      ['main.js', enc("import { box as a } from './a.js';\nimport { box as b } from './b.js';\ndocument.body.dataset.v = a === b ? 'same' : 'two';\ndocument.body.dataset.done = '1';\n")],
      ['a.js', enc("export { box } from './shared.js';\n")],
      ['b.js', enc("export { box } from './shared.js';\n")],
      ['shared.js', enc('export const box = {};\n')],
    ]));
    expect((await result(await open(page)))['v']).toBe('same');
  });

  it('JSON fetch: a planned sibling answers its JSON, typed application/json', async () => {
    const page = await build(PAGE(`<script>fetch('data/points.json').then(async (r) => {
  document.body.dataset.type = r.headers.get('content-type');
  document.body.dataset.v = String((await r.json()).n);
}, (e) => { document.body.dataset.v = 'failed:' + e.name; }).finally(() => { document.body.dataset.done = '1'; });</script>`), new Map([
      ['data/points.json', enc('{"n":7}')],
    ]));
    const d = await result(await open(page));
    expect(d['v']).toBe('7');
    expect(d['type']).toBe('application/json');
  });

  it('model: a model under the budget answers its bytes and model/gltf-binary', async () => {
    const model = new Uint8Array(1536 * 1024).map((_, i) => (i * 31 + 7) % 256);
    let sum = 0;
    for (const b of model) sum = (sum + b) % 65521;
    const page = await build(PAGE(`<script>fetch('model.glb').then(async (r) => {
  const u = new Uint8Array(await r.arrayBuffer());
  let s = 0; for (const b of u) s = (s + b) % 65521;
  document.body.dataset.v = u.length + ':' + s + ':' + r.headers.get('content-type');
}, (e) => { document.body.dataset.v = 'failed:' + e.name; }).finally(() => { document.body.dataset.done = '1'; });</script>`), new Map([
      ['model.glb', model],
    ]));
    expect((await result(await open(page)))['v']).toBe(`${model.length}:${sum}:model/gltf-binary`);
  });

  it('outside the set: another origin, an unplanned sibling and a data: URL fail; CONTROL: the planned sibling answers', async () => {
    const from = origins.hits.length;
    const target = `${origins.b}/beacon.json?row=outside`;
    // The page also records the policy's own violation reports, so the row proves that the policy refused each request,
    // not only that the shim handed it on (fix round 1 of review 4066, A10). Reports are queued as tasks, so it waits one.
    const page = await build(PAGE(`<script>
const vio = [];
document.addEventListener('securitypolicyviolation', (e) => { vio.push({ d: e.effectiveDirective, u: e.blockedURI }); });
const out = (p) => p.then((r) => r.text().then((t) => 'ok:' + t), (e) => 'failed:' + e.name);
const other = 'oth' + 'er.json';
Promise.all([out(fetch('data.json')), out(fetch(${JSON.stringify(target)})), out(fetch(other)), out(fetch('data:application/json,{}'))])
  .then(([c, x, s, d]) => setTimeout(() => {
    Object.assign(document.body.dataset, { control: c, origin: x, sibling: s, data: d, vio: JSON.stringify(vio), done: '1' });
  }, 200));
</script>`), new Map([
      ['data.json', enc('{"n":1}')],
      ['other.json', enc('{"n":2}')],
    ]));
    const d = await result(await open(page));
    expect(d['control']).toBe('ok:{"n":1}');
    expect(d['origin']).toBe('failed:TypeError');
    expect(d['sibling']).toBe('failed:TypeError');
    expect(d['data']).toBe('failed:TypeError');
    const reached = origins.hits.slice(from).filter((h: OriginHit) => h.origin === 'b');
    expect(reached).toEqual([]);
    // Each of the three was refused by the policy's connect-src (its fallback to default-src 'none'), and the control by none.
    // Measured: Chromium dispatches each report twice here, so the distinct reports are compared.
    const vio = JSON.parse(d['vio'] ?? '[]') as { d: string; u: string }[];
    expect(vio.length).toBeGreaterThan(0);
    expect([...new Set(vio.map((v) => `${v.d} ${v.u}`))].sort()).toEqual([
      `connect-src ${target}`, `connect-src ${origins.a}/other.json`, 'connect-src data',
    ].sort());
  });
});
