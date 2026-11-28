// Native Docs HTML artifacts X5, plan Task A5.3: the golden replay (`pwa/browser/fixtures/artifact-answers.json`).
// The REAL artifact instance (`buildArtifactServer`) is built over a fixture store (one capability minted with a fixed token and a
// fixed id), a fixed clock, a liveness port that is always live and a fake bytes port that serves the fixture page's files from
// memory. Each request below is injected with the `Host` the instance expects and the `Sec-Fetch-Dest`, `Sec-Fetch-Mode` and
// `Sec-Fetch-Site` Chromium sends for it, and the instance's exact status, headers (sorted by name) and body are written to the
// golden file beside the request, with the two fixture origins and their host:port forms replaced by `{{ARTIFACT_ORIGIN}}`,
// `{{CONTENT_ORIGIN}}`, `{{ARTIFACT_HOST}}` and `{{CONTENT_HOST}}`. The browser leg (`pwa/browser/harness.ts`'s
// `startArtifactReplay`) serves those answers from two loopback ports of its own, so Chromium sees the real instance's headers and
// bodies, and this test fails the moment the instance answers differently from the file.
//
// `CCRC_UPDATE_GOLDEN=1` rewrites the file (and the test still asserts afterwards); CI never sets it. The comparison is of the file's
// text with the text this test would write, byte for byte.
//
// What the fixture page does is written here, in the page's own bytes: its scripts run the probes the browser leg reads
// (`console.log('PROBE <name> <json>')`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { artifactMime } from '../../shared/artifacts.js';
import type { DocPin } from '../../shared/docs.js';
import { artifactConfig, type ArtifactConfig } from '../src/artifacts/policy.js';
import type { ArtifactBytes, SessionLiveness } from '../src/artifacts/ports.js';
import { buildArtifactServer } from '../src/artifacts/routes.js';
import { createArtifactStore, type ArtifactManifestEntry, type CapabilityInput } from '../src/artifacts/store.js';

const GOLDEN_PATH = fileURLToPath(new URL('../../pwa/browser/fixtures/artifact-answers.json', import.meta.url));

// Loopback pair (policy.ts's rule): the console on `http://localhost:<p>`, each artifact origin on `http://127.0.0.1:<p>`.
const ART_HOST = '127.0.0.1:47801';
const CONTENT_HOST = '127.0.0.1:47802';
const ART_ORIGIN = `http://${ART_HOST}`;
const CONTENT_ORIGIN = `http://${CONTENT_HOST}`;
const CONSOLE_ORIGIN = 'http://localhost:47800';

/** A fixed 43-character base64url fixture token and a fixed 22-character id: public fixture values, never a real capability. */
const TOKEN = 'golden-fixture-token-0123456789-abcdefghijk';
const ID = 'golden-fixture-id-0001';
const T0 = 1_800_000_000_000;
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
const BLOB = 'b'.repeat(64);
const SESSION = 'c0ffee'.repeat(10) + 'abcd';

/** The key the console page sets on its own origin; the fixture page reads it from the content origin and must find nothing. */
const CONSOLE_KEY = 'ccrc-console-fixture-key';

/** `add(i32, i32) -> i32` as a WebAssembly module, written out byte by byte: type, function, export and code sections. */
const ADD_WASM = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic and version 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section: (i32, i32) -> i32
  0x03, 0x02, 0x01, 0x00, // function section: one function of type 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section: "add" is function 0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code section: local.get 0, local.get 1, i32.add
]);

const PAGE = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>artifact fixture</title>',
  '<script src="classic.js"></script>',
  // sw.js is loaded by a script tag FIRST, so a registration with the cache allowed has a stored copy to take (D-9145).
  '<script src="sw.js"></script>',
  '<script type="module" src="mod.mjs"></script>',
  '</head><body>',
  '<img id="icon" src="icon.svg" alt="">',
  '<a id="dl" href="data.txt" download="data.txt">download</a>',
  '<script>',
  "const log = (name, value) => console.log('PROBE ' + name + ' ' + JSON.stringify(value));",
  'const said = (e) => ({ threw: true, name: e && e.name, message: e && e.message });',
  'const probe = async (name, f) => { try { log(name, await f()); } catch (e) { log(name, said(e)); } };',
  'const wait = (ms) => new Promise((r) => setTimeout(r, ms));',
  '(async () => {',
  "  await probe('parent-document', () => { parent.document; return { threw: false }; });",
  "  await probe('storage', () => {",
  `    const consoleKey = localStorage.getItem('${CONSOLE_KEY}');`,
  "    localStorage.setItem('own-key', 'own-value');",
  "    return { origin: location.origin, consoleKey, own: localStorage.getItem('own-key') };",
  '  });',
  "  await probe('sw', async () => {",
  "    const r = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'all' });",
  '    return { registered: true, scope: r.scope };',
  '  });',
  "  await probe('svg', () => new Promise((resolve) => {",
  "    const img = document.getElementById('icon');",
  '    const done = () => resolve({ loaded: img.naturalWidth > 0, naturalWidth: img.naturalWidth });',
  '    if (img.complete) done(); else { img.onload = done; img.onerror = done; }',
  '  }));',
  "  await probe('fetch-html', async () => { const r = await fetch('frag.html'); return { status: r.status, text: await r.text() }; });",
  "  await probe('wasm', async () => {",
  "    const m = await WebAssembly.instantiateStreaming(fetch('add.wasm'));",
  '    return { sum: m.instance.exports.add(2, 3) };',
  '  });',
  "  await probe('worker', () => new Promise((resolve, reject) => {",
  "    const w = new Worker('worker.mjs', { type: 'module' });",
  '    w.onmessage = (ev) => resolve({ message: ev.data });',
  "    w.onerror = (ev) => reject(new Error(ev.message || 'worker error'));",
  "    setTimeout(() => reject(new Error('no message from the worker in 20 s')), 20000);",
  '  }));',
  "  await probe('alert', () => { alert('artifact'); return { returned: true }; });",
  "  await probe('download', () => { document.getElementById('dl').click(); return { clicked: true }; });",
  '  await wait(500);',
  "  log('done', {});",
  // The frame's own navigation goes last: it replaces the page.
  '  await wait(100);',
  "  log('top-nav', { about: 'navigating to https://example.invalid/' });",
  "  location = 'https://example.invalid/';",
  '})();',
  '</script>',
  '</body></html>',
].join('\n');

const FILES: ReadonlyMap<string, Buffer> = new Map<string, Buffer>([
  ['x/page.html', Buffer.from(PAGE, 'utf8')],
  ['x/classic.js', Buffer.from("console.log('PROBE classic ' + JSON.stringify({ ran: true }));\n", 'utf8')],
  ['x/mod.mjs', Buffer.from("console.log('PROBE module ' + JSON.stringify({ ran: true }));\nexport const ran = true;\n", 'utf8')],
  ['x/worker.mjs', Buffer.from("self.postMessage('worker-ok');\n", 'utf8')],
  ['x/sw.js', Buffer.from("self.addEventListener('install', function () {});\n", 'utf8')],
  ['x/icon.svg', Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" fill="#2f6f9f"/></svg>\n',
    'utf8')],
  ['x/frag.html', Buffer.from('<p id="frag">a same-origin fragment</p>\n', 'utf8')],
  ['x/add.wasm', ADD_WASM],
  ['x/data.txt', Buffer.from('a downloaded file\n', 'utf8')],
]);

const bytes: ArtifactBytes = {
  prepare: async () => ({ ok: false, error: 'unreadable' }),
  read: async (at, _entry, range, _snapshot, sink) => {
    const b = FILES.get(at.path);
    if (b === undefined) return { ok: false, error: 'unreadable' };
    await sink(b.subarray(range.start, range.end + 1));
    return { ok: true };
  },
};

function fixtureInstance() {
  const c: ArtifactConfig = artifactConfig({ origin: ART_ORIGIN, content: CONTENT_ORIGIN, port: '7790' }, CONSOLE_ORIGIN, 47800);
  if (c.state !== 'on') throw new Error(`the fixture config is not on: ${JSON.stringify(c)}`);
  const liveness: SessionLiveness = { of: () => 'live' };
  const store = createArtifactStore(() => T0, liveness, () => TOKEN, () => ID);
  const manifest = new Map<string, ArtifactManifestEntry>();
  for (const [key, b] of FILES) {
    manifest.set(key, { rel: key, pin: { kind: 'blob', sha: BLOB }, size: b.length, mime: artifactMime(key).mime, committed: true });
  }
  const pin: DocPin = { kind: 'committed', commit: COMMIT, servedRef: 'main', section: 'specs', path: 'x/page.html' };
  const input: CapabilityInput = {
    sessionIdHash: SESSION, project: 'project-a', pin, ref: { commit: COMMIT, served: 'main' }, section: 'specs', dir: 'x',
    page: 'x/page.html', manifest, origins: [], windows: false,
  };
  const minted = store.mint(input);
  if (!minted.ok || minted.token !== TOKEN) throw new Error('the fixture capability was not minted with the fixed token');
  return buildArtifactServer({ cfg: c, store, bytes, now: () => T0 });
}

type Side = 'artifact' | 'content';
interface FixtureRequest {
  name: string;
  side: Side;
  path: string;
  dest: string;
  mode: string;
  site: string;
  serviceWorker?: string;
}

/** The Sec-Fetch set Chromium sends for each request (plan Task A5.3). The frame's and `/clear`'s `Sec-Fetch-Site` between two
 *  `127.0.0.1` ports is `same-site` as expected; the browser leg's "injected sets are Chromium's" case measures it. */
const REQUESTS: readonly FixtureRequest[] = [
  { name: 'wrapper, opened from the console', side: 'artifact', path: `/a/${TOKEN}`, dest: 'document', mode: 'navigate', site: 'cross-site' },
  { name: 'the page in the frame', side: 'content', path: `/c/${TOKEN}/page.html`, dest: 'iframe', mode: 'navigate', site: 'same-site' },
  { name: 'clear page in the frame', side: 'content', path: '/clear', dest: 'iframe', mode: 'navigate', site: 'same-site' },
  { name: 'classic script', side: 'content', path: `/c/${TOKEN}/classic.js`, dest: 'script', mode: 'no-cors', site: 'same-origin' },
  { name: 'module script', side: 'content', path: `/c/${TOKEN}/mod.mjs`, dest: 'script', mode: 'cors', site: 'same-origin' },
  { name: 'module worker script', side: 'content', path: `/c/${TOKEN}/worker.mjs`, dest: 'worker', mode: 'same-origin', site: 'same-origin' },
  { name: 'service worker script, loaded by a script tag', side: 'content', path: `/c/${TOKEN}/sw.js`, dest: 'script', mode: 'no-cors', site: 'same-origin' },
  {
    name: 'service worker registration', side: 'content', path: `/c/${TOKEN}/sw.js`, dest: 'serviceworker', mode: 'same-origin',
    site: 'same-origin', serviceWorker: 'script',
  },
  { name: 'svg image', side: 'content', path: `/c/${TOKEN}/icon.svg`, dest: 'image', mode: 'no-cors', site: 'same-origin' },
  { name: 'fetch of an html fragment', side: 'content', path: `/c/${TOKEN}/frag.html`, dest: 'empty', mode: 'cors', site: 'same-origin' },
  { name: 'fetch of a wasm module', side: 'content', path: `/c/${TOKEN}/add.wasm`, dest: 'empty', mode: 'cors', site: 'same-origin' },
  { name: 'download', side: 'content', path: `/c/${TOKEN}/data.txt`, dest: 'empty', mode: 'navigate', site: 'same-origin' },
];

/** The two fixture origins, then their host:port forms, as placeholders. Origins first: an origin contains its host. */
const PLACEHOLDERS: readonly (readonly [string, string])[] = [
  [ART_ORIGIN, '{{ARTIFACT_ORIGIN}}'], [CONTENT_ORIGIN, '{{CONTENT_ORIGIN}}'], [ART_HOST, '{{ARTIFACT_HOST}}'], [CONTENT_HOST, '{{CONTENT_HOST}}'],
];
const place = (s: string): string => PLACEHOLDERS.reduce((acc, [real, ph]) => acc.split(real).join(ph), s);

const TRANSPORT_HEADERS: ReadonlySet<string> = new Set(['date', 'connection']);

const TEXTUAL = /^(text\/|application\/json|application\/javascript|image\/svg\+xml)/;

interface GoldenEntry {
  name: string;
  request: { method: 'GET'; host: string; path: string; headers: Record<string, string> };
  response: { status: number; headers: Record<string, string>; body: string; encoding: 'utf8' | 'base64' };
}

async function record(app: ReturnType<typeof fixtureInstance>, r: FixtureRequest): Promise<GoldenEntry> {
  const host = r.side === 'artifact' ? ART_HOST : CONTENT_HOST;
  const sent: Record<string, string> = { 'sec-fetch-dest': r.dest, 'sec-fetch-mode': r.mode, 'sec-fetch-site': r.site };
  if (r.serviceWorker !== undefined) sent['service-worker'] = r.serviceWorker;
  const res = await app.inject({ method: 'GET', url: r.path, headers: { host, ...sent } });
  const headers: Record<string, string> = {};
  for (const name of Object.keys(res.headers).sort()) {
    // `date` and `connection` are the transport's (inject adds a wall-clock `date`), never the instance's: the replay's own
    // server adds its own, so they are not part of the file.
    if (TRANSPORT_HEADERS.has(name)) continue;
    const v = res.headers[name];
    headers[name] = place(Array.isArray(v) ? v.join(', ') : String(v));
  }
  const type = String(res.headers['content-type'] ?? '');
  const textual = TEXTUAL.test(type);
  return {
    name: r.name,
    request: { method: 'GET', host: place(host), path: r.path, headers: sent },
    response: {
      status: res.statusCode,
      headers,
      body: textual ? place(res.rawPayload.toString('utf8')) : res.rawPayload.toString('base64'),
      encoding: textual ? 'utf8' : 'base64',
    },
  };
}

describe('artifacts golden: the real instance answers each fixture request as pwa/browser/fixtures/artifact-answers.json says', () => {
  it('golden: every answer equals the file byte for byte', async () => {
    const app = fixtureInstance();
    const entries: GoldenEntry[] = [];
    for (const r of REQUESTS) entries.push(await record(app, r));
    await app.close();
    const text = `${JSON.stringify({ format: 1, token: TOKEN, entries }, null, 2)}\n`;
    if (process.env['CCRC_UPDATE_GOLDEN'] === '1') {
      mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
      writeFileSync(GOLDEN_PATH, text);
    }
    expect(readFileSync(GOLDEN_PATH, 'utf8')).toBe(text);
  });

  it('golden: the fixture is not all refusals, and holds no real origin', async () => {
    const app = fixtureInstance();
    const answered: Record<string, number> = {};
    for (const r of REQUESTS) answered[r.name] = (await record(app, r)).response.status;
    await app.close();
    const refused = Object.entries(answered).filter(([, s]) => s !== 200).map(([n, s]) => `${n}: ${s}`);
    // Only the service worker's own script request is refused (the fence's row for `Sec-Fetch-Dest: serviceworker`).
    expect(refused).toEqual(['service worker registration: 403']);
    const file = readFileSync(GOLDEN_PATH, 'utf8');
    expect(file).not.toMatch(/127\.0\.0\.1/);
    expect(file).toContain('{{ARTIFACT_ORIGIN}}');
    expect(file).toContain('{{CONTENT_ORIGIN}}');
  });
});
