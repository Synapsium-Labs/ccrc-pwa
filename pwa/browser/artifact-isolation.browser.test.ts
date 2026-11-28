// The artifact tier's isolation proofs in a real Chromium (native Docs HTML artifacts X5, plan Task A5.3; spec
// docs/superpowers/specs/2026-11-19-native-docs-html-artifacts-design.md sections 3.4, 4.2, 4.3 and 7's A12).
// The console is a page on `http://localhost:<p>`; the wrapper and the content each answer on a `127.0.0.1` port the harness binds
// itself (`startArtifactReplay`), from the golden file the REAL artifact instance wrote (`server/test/artifacts-golden.test.ts`), so
// the browser sees the instance's exact headers and bodies, and that test fails the moment the instance answers differently.
// One scenario runs once in `beforeAll`: click the console's Open link, catch the new tab, let the fixture page run its probes
// (each reports `PROBE <name> <json>` on the console, an exception's name and message included), then click the wrapper's "Clear
// this host's data" link. Every `it` reads what that run recorded. Each case prints what the browser said on an `ART-TRACE` line.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config vitest.browser.config.ts
// browser/artifact-isolation.browser.test.ts )`, through `ccrc test`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { ARTIFACT_CONSOLE_KEY, resolveChrome, startArtifactReplay, type ArtifactGolden, type ArtifactReplay } from './harness';

const GOLDEN: ArtifactGolden = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'artifact-answers.json'), 'utf8'),
) as ArtifactGolden;

// At load: the file is the format this test reads, and an entry's name is its key (the replay and the cases look entries up by it).
if (GOLDEN.format !== 1) throw new Error(`artifact-answers.json has format ${String(GOLDEN.format)}, this test reads format 1`);
{
  const names = GOLDEN.entries.map((e) => e.name);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  if (twice.length > 0) throw new Error(`artifact-answers.json names an entry twice: ${JSON.stringify(twice)}`);
}

interface Said { readonly type: string; readonly text: string }
interface Dialog { readonly type: string; readonly message: string }

interface Run {
  readonly probes: ReadonlyMap<string, Record<string, unknown>>;
  readonly said: readonly Said[];
  readonly dialogs: readonly Dialog[];
  readonly downloads: readonly string[];
  readonly navigations: readonly string[];
  readonly openerIsNull: boolean;
  readonly consoleKeySet: boolean;
  readonly tabUrl: string;
}

let replay: ArtifactReplay | undefined;
let browser: Browser | undefined;
let context: BrowserContext | undefined;
let run: Run | undefined;

const trace = (label: string, value: unknown): void => { process.stderr.write(`ART-TRACE ${label} ${JSON.stringify(value)}\n`); };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    await sleep(50);
  }
}

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  replay = await startArtifactReplay(GOLDEN);
  browser = await chromium.launch({ executablePath, headless: true });
  context = await browser.newContext();

  const probes = new Map<string, Record<string, unknown>>();
  const said: Said[] = [];
  const dialogs: Dialog[] = [];
  const downloads: string[] = [];
  const navigations: string[] = [];
  // Every page of the context is watched from its creation: a popup's first messages are not lost.
  context.on('page', (p: Page) => {
    p.on('console', (m) => {
      const text = m.text();
      said.push({ type: m.type(), text });
      const hit = /^PROBE (\S+) (.*)$/s.exec(text);
      if (hit !== null) probes.set(hit[1]!, JSON.parse(hit[2]!) as Record<string, unknown>);
    });
    p.on('dialog', (d) => { dialogs.push({ type: d.type(), message: d.message() }); void d.accept(); });
    p.on('download', (d) => { downloads.push(d.suggestedFilename()); });
    p.on('framenavigated', (f) => { navigations.push(f.url()); });
  });

  const consolePage = await context.newPage();
  await consolePage.goto(`${replay.consoleOrigin}/`, { waitUntil: 'load' });
  const consoleKeySet = await consolePage.evaluate((k) => window.localStorage.getItem(k) !== null, ARTIFACT_CONSOLE_KEY);

  const opened = context.waitForEvent('page', { timeout: 30_000 });
  await consolePage.click('#open');
  const tab = await opened;

  await until(() => probes.has('done'), 60_000, 'the fixture page to finish its probes');
  await until(() => probes.has('top-nav'), 10_000, 'the page to attempt its own navigation');
  await sleep(2_000); // a navigation the browser allowed would have committed by now
  const openerIsNull = await tab.evaluate(() => window.opener === null);
  const tabUrl = tab.url();

  // The wrapper's own link loads `/clear` into the frame. The refused navigation left the frame on Chromium's error page (the page
  // is gone from it), but the frame keeps its name, so the link's `target` still reaches it.
  await tab.click('a.clear');
  await until(() => replay!.hits.some((h) => h.path === '/clear'), 15_000, 'the frame to request /clear');

  run = { probes, said, dialogs, downloads, navigations, openerIsNull, consoleKeySet, tabUrl };
  trace('probes', Object.fromEntries(probes));
  trace('dialogs', dialogs);
  trace('downloads', downloads);
  trace('navigations', navigations);
  trace('console', said);
  trace('hits', replay.hits.map((h) => ({ side: h.side, method: h.method, path: h.path.replace(GOLDEN.token, '<token>'), referer: h.referer,
    dest: h.dest, mode: h.mode, site: h.site, sw: h.serviceWorker, entry: h.entry })));
}, 180_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await replay?.close();
});

const probe = (name: string): Record<string, unknown> => {
  const p = run!.probes.get(name);
  if (p === undefined) throw new Error(`the page never reported the ${name} probe`);
  return p;
};

describe('artifact isolation in Chromium: the wrapper tab, its frame and the page in it', () => {
  it('browser: a navigation to another site in the frame is blocked', () => {
    expect(run!.probes.has('top-nav'), 'the page attempted the navigation').toBe(true);
    expect(run!.navigations.filter((u) => u.includes('example.invalid'))).toEqual([]);
    // The violation is the wrapper's `frame-src` (the frame's own response does not restrict where it navigates).
    const violation = run!.said.filter((s) => /example\.invalid/.test(s.text) && /Content Security Policy/i.test(s.text)
      && /frame-src/.test(s.text));
    trace('violation text', violation);
    expect(violation.length, 'a frame-src violation naming https://example.invalid was reported').toBeGreaterThan(0);
    // The tab itself never moved: its URL is still the wrapper's after the probe. (The refused navigation leaves the FRAME on
    // Chromium's error page, `chrome-error://chromewebdata/`, never on the other site.)
    expect(run!.tabUrl).toBe(replay!.wrapperUrl);
  });

  it('browser: parent.document throws', () => {
    const p = probe('parent-document');
    trace('parent.document', p);
    expect(p['threw']).toBe(true);
    expect(p['name']).toBe('SecurityError');
  });

  // In Chromium the wrapper's `Cross-Origin-Opener-Policy: same-origin-allow-popups` also severs the opener, so it is cut twice: by
  // the link's `rel="noopener noreferrer"` and by the wrapper's policy (D-9164). The isolation rests on the rel and the walls; the
  // policy is an extra layer. This case therefore cannot go red for a regression of the rel alone (measured: with `rel="opener"` it
  // stayed green until the COOP header was removed from the golden too), because the launch sheet's jsdom case MX5.39 pins the
  // rel exactly. Other engines are acceptance's ART rows.
  it('browser: the tab has no opener', () => {
    expect(run!.openerIsNull, 'window.opener === null in the tab').toBe(true);
  });

  it('browser: the content request carries no Referer', () => {
    const content = replay!.hits.filter((h) => h.side === 'content');
    expect(content.length, 'the content origin answered requests').toBeGreaterThan(5);
    expect(content.filter((h) => h.referer !== null).map((h) => `${h.path}: ${h.referer}`)).toEqual([]);
    const wrapper = replay!.hits.filter((h) => h.side === 'artifact' && h.path.startsWith('/a/'));
    expect(wrapper.length).toBeGreaterThan(0);
    expect(wrapper.filter((h) => h.referer !== null).map((h) => h.referer)).toEqual([]);
  });

  it('browser: a service worker cannot register, even from a script first loaded by a script tag with the cache allowed', () => {
    const p = probe('sw');
    trace('service worker registration', p);
    // The rejection is the fence's 403, not some earlier refusal: a TypeError whose message names the 403.
    expect(p['threw']).toBe(true);
    expect(p['name']).toBe('TypeError');
    expect(String(p['message'])).toMatch(/403/);
    const hits = replay!.hits;
    const scriptAt = hits.findIndex((h) => h.dest === 'script' && h.path.endsWith('/sw.js'));
    expect(scriptAt, 'sw.js was loaded by the script tag first').toBeGreaterThanOrEqual(0);
    // Exactly one request of the registration reached the replay, as a service worker's script fetch, after the tag's load, and the
    // golden entry that answered it is the instance's 403 for it.
    const worker = hits.filter((h) => h.dest === 'serviceworker');
    expect(worker.length, 'requests with Sec-Fetch-Dest: serviceworker').toBe(1);
    const w = worker[0]!;
    expect(w.serviceWorker).toBe('script');
    expect(hits.indexOf(w), 'the registration came after the script tag load').toBeGreaterThan(scriptAt);
    expect(w.entry).toBe('service worker registration');
    expect(replay!.entryOf(w)?.response.status).toBe(403);
    trace('service worker request', { dest: w.dest, serviceWorker: w.serviceWorker, entry: w.entry, afterScriptLoad: hits.indexOf(w) > scriptAt });
  });

  it("browser: the console origin's storage is unreadable from the page", () => {
    expect(run!.consoleKeySet, 'the console page holds its key on its own origin').toBe(true);
    const p = probe('storage');
    trace('storage', p);
    // The page ran on the content origin, so the null above is another origin's storage being unreadable, not an unset page.
    expect(p['origin']).toBe(replay!.contentOrigin);
    expect(p['consoleKey']).toBeNull();
    expect(p['own'], 'the content origin has storage of its own').toBe('own-value');
    expect(GOLDEN.entries.find((e) => e.name === 'the page in the frame')!.response.body).toContain(ARTIFACT_CONSOLE_KEY);
  });

  it('browser: an SVG icon and a same-origin HTML fetch load', () => {
    expect(probe('svg')['loaded']).toBe(true);
    const f = probe('fetch-html');
    expect(f['status']).toBe(200);
    expect(String(f['text'])).toContain('a same-origin fragment');
  });

  it('browser: alert, WebAssembly and a module worker run', () => {
    expect(run!.dialogs).toContainEqual({ type: 'alert', message: 'artifact' });
    expect(probe('alert')['returned']).toBe(true);
    expect(probe('wasm')['sum']).toBe(5);
    expect(probe('worker')['message']).toBe('worker-ok');
    // The classic and module scripts the page loads by tag ran too.
    expect(probe('classic')['ran']).toBe(true);
    expect(probe('module')['ran']).toBe(true);
  });

  it('browser: a download from the page starts and reaches the replay as a download', () => {
    expect(run!.downloads).toEqual(['data.txt']);
    const hit = replay!.hits.find((h) => h.entry === 'download');
    expect(hit, 'a replay request matched the download entry').toBeDefined();
    expect([hit!.dest, hit!.mode, hit!.site]).toEqual(['empty', 'navigate', 'same-origin']);
  });

  it("browser: the injected sets are Chromium's", () => {
    const answered = replay!.hits.filter((h) => h.entry !== null);
    // Every request kind of the fixture reached a golden answer: the wrapper, the frame, /clear and each subresource.
    const names = new Set(answered.map((h) => h.entry));
    for (const needed of ['wrapper, opened from the console', 'the page in the frame', 'clear page in the frame', 'classic script',
      'module script', 'module worker script', 'service worker script, loaded by a script tag', 'svg image', 'fetch of an html fragment',
      'fetch of a wasm module', 'service worker registration', 'download']) {
      expect(names.has(needed), `${needed} was requested`).toBe(true);
    }
    const mismatched: string[] = [];
    for (const h of answered) {
      const stored = replay!.entryOf(h)!.request.headers;
      const sent = { 'sec-fetch-dest': h.dest, 'sec-fetch-mode': h.mode, 'sec-fetch-site': h.site, 'service-worker': h.serviceWorker };
      const wanted = {
        'sec-fetch-dest': stored['sec-fetch-dest'] ?? null, 'sec-fetch-mode': stored['sec-fetch-mode'] ?? null,
        'sec-fetch-site': stored['sec-fetch-site'] ?? null, 'service-worker': stored['service-worker'] ?? null,
      };
      if (JSON.stringify(sent) !== JSON.stringify(wanted)) mismatched.push(`${h.entry}: Chromium sent ${JSON.stringify(sent)}, golden has ${JSON.stringify(wanted)}`);
    }
    expect(mismatched).toEqual([]);
    // No other request reached either replay listener, but the wrapper tab's own icon request to the artifact listener.
    expect(replay!.hits.filter((h) => h.side !== 'console' && h.entry === null && !(h.side === 'artifact' && h.path === '/favicon.ico'))
      .map((h) => `${h.side} ${h.path}`)).toEqual([]);
  });
});
