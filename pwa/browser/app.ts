// The real-browser leg's app half (foundations follow-up F-e; D-5570, D-5576): the production PWA, built once by the
// app's own `vite build`, served from loopback, and opened in a Chrome context whose `/api` and `/ws` answer from a
// fixture. No server, no ccd, no tmux: a row-fit measure needs the shipped markup and the shipped stylesheet laid out
// by a real engine, which jsdom cannot do, and nothing else. `harness.ts` stays the docs rows' three things; this is
// the second thing a browser row can need, so it is a module of its own.
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { SKIN_STORAGE_KEY, THEME_STORAGE_KEY } from '@ccrc/ui';

const PWA = path.join(import.meta.dirname, '..');

// Runs in a node child, cwd the PWA package, as `test/markdown-worker-built.test.ts` builds: the app's own config, a
// production build (vitest's NODE_ENV=test would build the `development` export conditions), into argv[1]. Not in
// this file's jsdom realm, whose URL the PWA plugin's file writes reject.
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

/** Build the PWA into a fresh temporary directory and return it. The caller removes it (`removeDist`). */
export function buildDist(): string {
  const out = mkdtempSync(path.join(tmpdir(), 'ccrc-browser-dist-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
  return out;
}

export function removeDist(dist: string | undefined): void {
  if (dist !== undefined) rmSync(dist, { recursive: true, force: true });
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

export interface DistServer {
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string;
  close(): Promise<void>;
}

/** Serve `dist` on an ephemeral loopback port. A path that is not a file answers `index.html`, as the server's own
 *  SPA fallback does, so a deep link such as `/s/<id>` boots the app. `/api` and `/ws` never reach it: the context
 *  routes them (`openApp`). */
export async function serveDist(dist: string): Promise<DistServer> {
  const root = path.resolve(dist);
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://dist.invalid').pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/** What the app's `/api` and `/ws` answer. `api` is keyed by pathname; any other `/api` path answers `{}`, which every
 *  poller the shell mounts reads as "nothing to say". `/ws/fleet` sends each of `fleetFrames` once it opens; every
 *  other socket opens and stays silent. */
export interface AppFixture {
  readonly api: Readonly<Record<string, unknown>>;
  readonly fleetFrames: readonly unknown[];
}

export interface AppView {
  readonly width: number;
  readonly skin: string;
  readonly theme: string;
}

export interface OpenedApp {
  readonly ctx: BrowserContext;
  readonly page: Page;
  /** Every uncaught page error, in order. */
  readonly errors: string[];
}

/** A context at `view.width` (844 tall below 900, as a phone; 900 above), with a touch screen below 900, the skin and
 *  the theme stored before the first paint (the keys the app itself reads), service workers blocked, and the fixture
 *  answering `/api` and `/ws`. The page is not navigated yet. */
export async function openApp(browser: Browser, view: AppView, fixture: AppFixture): Promise<OpenedApp> {
  const phone = view.width < 900;
  const ctx = await browser.newContext({
    viewport: { width: view.width, height: phone ? 844 : 900 }, hasTouch: phone, serviceWorkers: 'block',
  });
  await ctx.addInitScript(([skinKey, skin, themeKey, theme]) => {
    try {
      localStorage.setItem(skinKey, skin);
      localStorage.setItem(themeKey, theme);
    } catch { /* a context without storage boots the defaults; the measure then says which skin it drew */ }
  }, [SKIN_STORAGE_KEY, view.skin, THEME_STORAGE_KEY, view.theme] as const);
  await ctx.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = Object.hasOwn(fixture.api, pathname) ? fixture.api[pathname] : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.routeWebSocket(/\/ws\//, (ws) => {
    if (new URL(ws.url()).pathname === '/ws/fleet') for (const frame of fixture.fleetFrames) ws.send(JSON.stringify(frame));
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => { errors.push(e.message); });
  return { ctx, page, errors };
}
