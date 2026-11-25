// The BUILT draft review page (native Docs draft review, X3, wave R2 Task R2.1; spec 2026-11-18 section 3.5; rows
// M-X3.12, N8, NDR-X3-R2-M7). Nothing in the source tree shows what the bundler and the PWA plugin emit, so this file
// runs the app's own `vite build` (its own config, into a temporary directory, as reader-built.test.ts and
// fonts-built.test.ts do) and reads the output:
// - the built tree holds `review.html`, and the generated service worker's precache manifest names no `review.html`,
//   so an installed client never answers `/review` from a cached copy that has none of the page's headers
//   (`globIgnores` in vite.config.ts; test/browser-dist.test.ts pins the hermetic run with a stand-in builder, so a
//   built-output row cannot live there);
// - the built page holds no inline script (every `<script>` has a `src` under `/assets/` and no text), because its
//   header policy is `script-src 'self'`; no manifest link and no service-worker registration, because the plugin
//   injects both into the shell; and the `data:,` icon, so no favicon request is made;
// - the shell is still built, with its entry script under `assets/index-*.js`.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
let out = '';

// Runs in a node child, cwd the PWA package: a production build of the app's own config into argv[1]. Not in this
// file's jsdom realm, whose URL the PWA plugin's file writes reject. CCRC_SW_DENYLIST is left unset (the env below
// carries only PATH, HOME and NODE_ENV).
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'ccrc-review-built-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
}, 240_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const read = (name: string): string => readFileSync(path.join(out, name), 'utf8');

/** The urls `sw.js` hands to `precacheAndRoute`, as the build wrote them (relative to the shell root). */
const precached = (): string[] => {
  const manifest = /precacheAndRoute\(\[(.*?)\],/s.exec(read('sw.js'));
  expect(manifest, 'sw.js calls precacheAndRoute with a manifest').not.toBeNull();
  return [...manifest![1]!.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
};

/** Every `<script ...>...</script>` of a built page: its attribute text and its body. */
const scripts = (html: string): Array<{ attrs: string; body: string }> =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ attrs: m[1]!, body: m[2]! }));

describe('the built review page (M-X3.12, N8, R2.1)', () => {
  it('the built tree holds review.html', () => {
    expect(readdirSync(out)).toContain('review.html');
  });

  it('the generated service worker precaches no review.html (NDR-X3-R2-M7)', () => {
    const urls = precached();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.filter((u) => /(?:^|\/)review\.html$/.test(u))).toEqual([]);
  });

  it('the built page holds no inline script: every script has a src under /assets/ and no text', () => {
    const found = scripts(read('review.html'));
    expect(found.length).toBeGreaterThan(0);
    for (const s of found) {
      expect(s.attrs).toMatch(/\bsrc="\/assets\/[^"]+\.js"/);
      expect(s.attrs).toMatch(/\btype="module"/);
      expect(s.body.trim()).toBe('');
    }
  });

  it('the built page holds no service-worker registration', () => {
    const html = read('review.html');
    expect(html).not.toMatch(/registerSW/);
    expect(html).not.toMatch(/serviceWorker/);
  });

  it('the built page holds no manifest link', () => {
    const html = read('review.html');
    expect(html).not.toMatch(/rel=["']manifest["']/i);
    expect(html).not.toMatch(/\.webmanifest/);
  });

  it('the built page carries the data: icon, the no-referrer meta and its own title', () => {
    const html = read('review.html');
    expect(html).toContain('<link rel="icon" href="data:,"');
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"/);
    expect(html).toContain('<title>Draft for review</title>');
    expect(html).not.toContain('/icons/');
  });

  it('the shell is still built, and its entry script is assets/index-*.js', () => {
    const html = read('index.html');
    const entry = scripts(html).map((s) => /\bsrc="\/(assets\/[^"]+\.js)"/.exec(s.attrs)?.[1]).filter((s) => s !== undefined);
    expect(entry.some((s) => /^assets\/index-[^/]+\.js$/.test(s!))).toBe(true);
    // The page's own entry is its own chunk: the shell never loads it.
    expect(html).not.toMatch(/assets\/review-/);
  });
});
