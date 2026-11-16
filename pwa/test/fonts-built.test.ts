// The BUILT shell carries the Geist pair offline (D-5095, the foundations plan's Task 7 Step 7b). fonts.test.ts pins
// the source side: the vendored woff2 files, the faces that name them, the stacks and the licence. None of it shows
// what the bundler and the PWA plugin emit, so this file runs the app's own `vite build` (its own config, into a
// temporary directory, as markdown-worker-built.test.ts does) and reads the output:
// - the generated service worker precaches both woff2 files, so an installed client's offline second launch renders
//   Geist, not the system faces behind it (workbox `globPatterns` in vite.config.ts names `woff2`);
// - the built CSS reaches them same-origin, under /assets/, never a font host;
// - the licence ships verbatim at licenses/Geist-OFL.txt;
// - the emitted worker's navigation denylist covers /licenses/, so a navigation there gets the licence, not the shell
//   (what `swDenylist` returns is what the build carries).
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const FACES = [/^Geist-Variable-[\w-]+\.woff2$/, /^GeistMono-Variable-[\w-]+\.woff2$/] as const;
let out = '';

// Runs in a node child, cwd the PWA package: a production build of the app's own config into argv[1]. Not in this
// file's jsdom realm, whose URL the PWA plugin's file writes reject. CCRC_SW_DENYLIST is left unset (the env below
// carries only PATH, HOME and NODE_ENV), so the denylist read back is ccrc's own list.
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'ccrc-fonts-built-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

const emittedFaces = (): string[] => {
  const assets = readdirSync(path.join(out, 'assets'));
  return FACES.map((re) => {
    const hits = assets.filter((n) => re.test(n));
    expect(hits, `one emitted file matching ${re}`).toHaveLength(1);
    return hits[0]!;
  });
};

const sw = (): string => readFileSync(path.join(out, 'sw.js'), 'utf8');

describe('the built shell and the Geist pair (D-5095, Task 7 Step 7b)', () => {
  it('the built shell precaches both woff2 files', () => {
    const faces = emittedFaces();
    const manifest = /precacheAndRoute\(\[(.*?)\],/s.exec(sw());
    expect(manifest, 'sw.js calls precacheAndRoute with a manifest').not.toBeNull();
    const urls = [...manifest![1]!.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
    for (const face of faces) expect(urls).toContain(`assets/${face}`);
  });

  it('the built CSS references them same-origin, under /assets/', () => {
    const faces = emittedFaces();
    const assets = path.join(out, 'assets');
    const css = readdirSync(assets).filter((n) => n.endsWith('.css')).map((n) => readFileSync(path.join(assets, n), 'utf8')).join('\n');
    const fontUrls = [...css.matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)].map((m) => m[1]);
    expect(fontUrls.sort()).toEqual(faces.map((f) => `/assets/${f}`).sort());
    expect(css).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//);
    expect(css).not.toMatch(/fonts\.(?:googleapis|gstatic)/);
  });

  it('licenses/Geist-OFL.txt is in the output', () => {
    const shipped = readFileSync(path.join(out, 'licenses', 'Geist-OFL.txt'));
    expect(shipped.equals(readFileSync(path.join(PWA, 'public', 'licenses', 'Geist-OFL.txt')))).toBe(true);
    // The vendored source licence too, so this built-output check stands alone (D-5095): an edit to the public copy
    // only is red here, not just in fonts.test.ts.
    expect(shipped.equals(readFileSync(path.join(PWA, '..', 'ui', 'src', 'fonts', 'OFL.txt')))).toBe(true);
    expect(shipped.toString('utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it("the emitted service worker's navigation denylist covers /licenses/", () => {
    const route = /new \w+\.NavigationRoute\([^]*?\{denylist:\[(.*?)\]\}\)/s.exec(sw());
    expect(route, 'sw.js registers a NavigationRoute with a denylist').not.toBeNull();
    const denylist = [...route![1]!.matchAll(/\/((?:\\.|[^/\\])+)\/([a-z]*)/g)].map((m) => new RegExp(m[1]!, m[2]));
    expect(denylist.length).toBeGreaterThan(0);
    const denied = (p: string) => denylist.some((re) => re.test(p));
    expect(denied('/licenses/')).toBe(true);
    expect(denied('/licenses/Geist-OFL.txt')).toBe(true);
    // The shell still answers ccrc's own pages, so the denylist is not a catch-all.
    expect(denied('/')).toBe(false);
    expect(denied('/docs')).toBe(false);
  });
});

// D-7891: index.html's pre-paint <style> names the cascade-layer order before any built sheet loads. Its FIRST name is
// not in ui's theme.css statement (layer-order.test.ts holds the rest equal to that): it is the layer Tailwind's built
// entry sheet opens with (`properties`, the --tw-* defaults, which must stay lowest), measured here on this build
// rather than typed. And every layer any emitted sheet uses is one index.html names, so a layer a later Tailwind or a
// new sheet adds can never be appended above `utilities` unseen.
describe('the built sheets and the layer order index.html declares first (D-7891)', () => {
  const declared = (): string[] => {
    const html = readFileSync(path.join(PWA, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, '');
    const m = /@layer\s+([\w-]+(?:\s*,\s*[\w-]+)+)\s*;/.exec(html);
    expect(m, 'index.html declares an @layer order').not.toBeNull();
    return m![1]!.split(/\s*,\s*/);
  };
  const sheets = (): string[] => readdirSync(path.join(out, 'assets')).filter((n) => n.endsWith('.css'));
  /** Every layer `css` opens or names, as the TOP-LEVEL layer that ranks it: a dotted `a.b` counts under `a`, and an
   *  anonymous `@layer {` reads as `(anonymous)`, which index.html can never name, so it is always reported. */
  const layersOf = (css: string): string[] =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@layer(?:\s+([\w.-]+(?:\s*,\s*[\w.-]+)*))?\s*[{;]/g)]
      .flatMap((m) => (m[1] === undefined ? ['(anonymous)'] : m[1].split(/\s*,\s*/).map((n) => n.split('.')[0]!)));

  it('reads a dotted layer as its top-level one and an anonymous layer as one index.html cannot name (planted control)', () => {
    expect(layersOf('@layer foo.bar{a{b:c}} @layer{d{e:f}} @layer components.x{g{h:i}} @layer a, b.c;'))
      .toEqual(['foo', '(anonymous)', 'components', 'a', 'b']);
  });

  it("the built entry sheet's first layer is index.html's first name", () => {
    const shell = readFileSync(path.join(out, 'index.html'), 'utf8');
    const entry = /<link rel="stylesheet"[^>]*href="\/assets\/(index-[\w-]+\.css)"/.exec(shell);
    expect(entry, 'the built shell links its entry sheet').not.toBeNull();
    const first = layersOf(readFileSync(path.join(out, 'assets', entry![1]!), 'utf8'))[0];
    expect(first).toBeDefined();
    expect(declared()[0]).toBe(first);
  });

  it("the built shell states the order before every stylesheet it links", () => {
    const shell = readFileSync(path.join(out, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length));
    const at = shell.search(/@layer\s+[\w.-]+\s*,/);
    expect(at, 'the built shell keeps the pre-paint @layer statement').toBeGreaterThan(-1);
    const links = [...shell.matchAll(/<link\b[^>]*\brel="stylesheet"/g)].map((m) => m.index ?? 0);
    expect(links.length, 'the built shell links its sheets').toBeGreaterThan(0);
    for (const i of links) expect(i).toBeGreaterThan(at);
  });

  it('every layer an emitted sheet uses is one index.html names', () => {
    const names = new Set(declared());
    const used = new Set(sheets().flatMap((n) => layersOf(readFileSync(path.join(out, 'assets', n), 'utf8'))));
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((n) => !names.has(n))).toEqual([]);
  });
});
