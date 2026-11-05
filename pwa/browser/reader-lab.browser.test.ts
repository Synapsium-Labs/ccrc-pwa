// The reader lab's real-browser case (native Docs reader, the reader lab plan of 2026-11-03, Task 11; the rich-docs
// spec's rows M10.9, M10.10 and M10.B1). It measures the built page's `/settings/reader-lab` in Chrome, end to end,
// against a fake door: every wall line and the teardown signal must hold on desktop Chrome, the engine every wall was
// measured on. The E17 lines (the busy frame, the Mermaid stall) are recorded in the output, not asserted.
//
// The door is ONE loopback `node:http` server of this case's own (the desktop leg counts at servers of its own for the same
// reason): it serves the shared build with the SPA fallback and answers the lab's `/api/reader-lab/` requests, counting
// by probe name, the session cookie by name, and `Sec-Fetch-Site` and `Origin` by class, as the server's counter does. The
// page is opened at its origin, and one context route passes every `/api/reader-lab/` request on to it (`continue`, never
// `fulfill`), so each arrival is counted once, at the server. Measured: Playwright's `ctx.route` did not see the early
// requests of the lab's sandboxed frames (12 seen, 9 routed, most never a request event), so a route cannot be the door.
// What the harness still shows differently: its `/api` interception answers a CORS preflight itself, so the cookie frame's
// marker request (`cookie-fetch-marker`, which needs a preflight) may arrive here although a real server never approves
// that preflight; the door records the marker as harness-limited and counts nothing for it. An OPTIONS that does reach
// the door answers 404 with no CORS header. The refusal itself is pinned at the server.
// Headers are read with `allHeaders()`: `headers()` leaves out `cookie` and the `sec-fetch-*` headers.
//
// Run: `( cd pwa && CCRC_CHROME=<a Chrome or Chromium binary> ./node_modules/.bin/vitest run --config
// vitest.browser.config.ts browser/reader-lab.browser.test.ts )`, through `ccrc test`.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright-core';
import { REFINED } from '@ccrc/ui';
import {
  LAB_BATTERY_CHANNELS, LAB_PROBE_NAMES, LAB_SITE_CLASSES, LAB_ORIGIN_CLASSES, readerLabClosePath, readerLabRunPath,
  type LabOriginClass, type LabProbeName, type LabProbeTally, type LabRunView, type LabSiteClass,
} from '../../shared/readerLab';
import { LAB_WALLS } from '../src/readerLab/checks';
import { LAB_CONTROL_FLOOR } from '../src/readerLab/verdicts';
import { openApp, sharedDist, type OpenedApp } from './app';
import { resolveChrome } from './harness';

const NONCE = 'BBBBBBBBBBBBBBBBBBBBBB';
const TTL_MS = 1_176_000; // The fake's value; the page ignores it.
const SESSION_COOKIE = 'ccrc_session';

let server: Server;
let origin = '';
let browser: Browser;
let app: OpenedApp | undefined;

const zero = <K extends string>(keys: readonly K[]): Record<K, number> => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const emptyTally = (): LabProbeTally => ({
  hits: 0, cookie: 0, upgrade: 0, site: zero<LabSiteClass>(LAB_SITE_CLASSES), origin: zero<LabOriginClass>(LAB_ORIGIN_CLASSES),
});
const siteClass = (v: string | undefined): LabSiteClass =>
  v === undefined ? 'absent' : (LAB_SITE_CLASSES as readonly string[]).includes(v) ? (v as LabSiteClass) : 'other';
const originClass = (v: string | undefined): LabOriginClass => v === undefined ? 'absent' : v === 'null' ? 'null' : 'present';

// The door's state: what it counted, in one place.
const tallies = new Map<LabProbeName, LabProbeTally>(LAB_PROBE_NAMES.map((n) => [n, emptyTally()]));
const harnessLimited: string[] = [];
let closes = 0;
const view = (): LabRunView => {
  const probes = Object.fromEntries([...tallies].map(([n, t]) => [n, structuredClone(t)])) as Record<LabProbeName, LabProbeTally>;
  const counted = [...tallies.values()].reduce((sum, t) => sum + t.hits, 0);
  return { openedAt: 0, expiresAt: TTL_MS, counted, ignored: 0, saturated: false, probes };
};

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function answerJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** The door: the lab's `/api/reader-lab/` requests, answered as the server's routes do. */
function door(req: IncomingMessage, res: ServerResponse, pathname: string): void {
  const h = (k: string): string | undefined => {
    const v = req.headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (req.method === 'OPTIONS') { res.writeHead(404); res.end(); return; }
  if (pathname === '/api/reader-lab/runs' && req.method === 'POST') { answerJson(res, { ok: true, nonce: NONCE, ttlMs: TTL_MS }); return; }
  if (pathname === readerLabRunPath(NONCE) && req.method === 'GET') { answerJson(res, { ok: true, run: view() }); return; }
  if (pathname === readerLabClosePath(NONCE) && req.method === 'POST') { closes += 1; answerJson(res, { ok: true, closed: true }); return; }
  const m = /^\/api\/reader-lab\/probe\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (m !== null && m[1] === NONCE) {
    const name = m[2] as LabProbeName;
    if (name === 'cookie-fetch-marker') { harnessLimited.push(name); res.writeHead(204); res.end(); return; }
    const t = tallies.get(name);
    if (t !== undefined) {
      const site = siteClass(h('sec-fetch-site'));
      const org = originClass(h('origin'));
      tallies.set(name, {
        hits: t.hits + 1,
        cookie: t.cookie + ((h('cookie') ?? '').includes(`${SESSION_COOKIE}=`) ? 1 : 0),
        upgrade: t.upgrade + (h('upgrade')?.toLowerCase() === 'websocket' ? 1 : 0),
        site: { ...t.site, [site]: t.site[site] + 1 },
        origin: { ...t.origin, [org]: t.origin[org] + 1 },
      });
    }
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(404);
  res.end();
}

/** The door plus the shared build, with the SPA fallback the harness's own static server has. */
async function startDoorServer(dist: string): Promise<{ readonly server: Server; readonly origin: string }> {
  const root = path.resolve(dist);
  const srv = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://door.invalid').pathname);
    if (pathname.startsWith('/api/reader-lab/')) { door(req, res, pathname); return; }
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve());
  });
  return { server: srv, origin: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

beforeAll(async () => {
  const executablePath = resolveChrome(); // throws on a box with no Chrome: red, never skipped
  const started = await startDoorServer(sharedDist());
  server = started.server;
  origin = started.origin;
  browser = await chromium.launch({ executablePath, headless: true });
}, 240_000);

afterAll(async () => {
  await app?.ctx.close();
  await browser?.close();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => { server.close(() => resolve()); });
  }
});

describe('the reader lab in Chrome (reader lab plan, Task 11)', () => {
  it('the reader lab in Chrome: every wall holds, the door run is closed, and the block names no host or nonce (M10.B1)', async () => {
    app = await openApp(browser, { width: 390, skin: REFINED, theme: 'light' }, { api: {}, fleetFrames: [] });
    const { ctx, page } = app;
    await ctx.addCookies([{ name: SESSION_COOKIE, value: 'lab-session', url: origin }]);

    // After openApp: every `/api/reader-lab/` request goes on to the door server, never answered here.
    await ctx.route((u) => u.pathname.startsWith('/api/reader-lab/'), (route) => route.continue());

    await page.goto(`${origin}/settings/reader-lab`);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.frameLocator('.reader-lab-stage > iframe').first().getByRole('button', { name: 'Tap here' }).click({ timeout: 30_000 });
    try {
      await page.locator('figcaption', { hasText: /^Result$/ }).waitFor({ timeout: 180_000 });
    } catch (e) {
      // Say where the run stood, so a timeout names a step and not only a clock.
      console.log('RLB-T11-STALLED', await page.locator('main').innerText().catch(() => '(no main)'), JSON.stringify({ closes, harnessLimited, errors: app.errors }));
      throw e;
    }
    const text = await page.locator('pre.reader-lab-result').innerText();
    console.log('RLB-T11-FIGURES', text);
    console.log('RLB-T11-HARNESS-LIMITED', JSON.stringify(harnessLimited));

    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^reader-lab 1 · Blink \d+ · .* · worker yes · frame sandbox yes · csp attribute yes · library [0-9a-f]{12}$/);
    // Under fixture interception the tried image beacon is cancelled by its own navigation, so the wall holds on the second load.
    expect(lines[1]).toBe('E18 walls: 7 of 7 hold; teardown signal holds');
    for (const k of LAB_WALLS) {
      expect(lines.some((l) => new RegExp(`^\\s+${k}\\s+holds( \\(.+\\))?$`).test(l)), `${k} holds`).toBe(true);
    }
    expect(lines.some((l) => /^\s+self-nav-teardown\s+holds \(second load fired\)$/.test(l)), 'self-nav-teardown').toBe(true);
    expect(lines.find((l) => l.startsWith('door:'))).toMatch(/session cookie sent$/);

    const t = (n: LabProbeName): LabProbeTally => tallies.get(n)!;
    expect(t('cookie-console').hits).toBeGreaterThanOrEqual(1);
    expect(t('cookie-console').cookie).toBeGreaterThanOrEqual(1);
    const frameCookies: LabProbeName[] = ['cookie-fetch', 'cookie-xhr', 'cookie-beacon', 'cookie-image'];
    expect(frameCookies.filter((n) => t(n).hits > 0).length).toBeGreaterThanOrEqual(1);
    for (const n of frameCookies) expect(t(n).cookie, `${n} carried no cookie`).toBe(0);
    expect(t('csp-canary').hits).toBe(1);
    for (const c of LAB_BATTERY_CHANNELS) expect(t(`csp-${c}`).hits, `csp-${c}`).toBe(0);
    const controls = LAB_BATTERY_CHANNELS.filter((c) => c !== 'iframe' && t(`ctl-${c}`).hits > 0);
    expect(controls.length).toBeGreaterThanOrEqual(LAB_CONTROL_FLOOR);
    for (const n of ['popup-open', 'popup-blank', 'top-nav', 'self-nav'] as const) expect(t(n).hits, n).toBe(0);
    expect(closes).toBe(1);
    expect(harnessLimited.every((n) => n === 'cookie-fetch-marker')).toBe(true);

    expect(text).not.toContain(new URL(origin).host);
    expect(text).not.toContain(NONCE);
  }, 240_000);
});
