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
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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

const read = (name: string): string => readFileSync(path.join(out, name), 'utf8');

/** The urls `sw.js` hands to `precacheAndRoute`, as the build wrote them (relative to the shell root). */
const precached = (): string[] => {
  const manifest = /precacheAndRoute\(\[(.*?)\],/s.exec(read('sw.js'));
  expect(manifest, 'sw.js calls precacheAndRoute with a manifest').not.toBeNull();
  return [...manifest![1]!.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]!);
};

/** Every `<script ...>...</script>` of a built page: its attribute text and its body. The end tag is matched in any case and
 *  with whitespace or attributes before its bracket (`</script >`), so no block hides behind that spelling (a code-scanning
 *  finding on the first version, which missed the end tag written with a space). */
const scripts = (html: string): Array<{ attrs: string; body: string }> =>
  [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)].map((m) => ({ attrs: m[1]!, body: m[2]! }));

describe('the script matcher', () => {
  it('reads a block whose end tag has a space before its bracket', () => {
    expect(scripts('<script src="/a.js">x</script >')).toEqual([{ attrs: ' src="/a.js"', body: 'x' }]);
  });
});

describe('the built review page (M-X3.12, N8, R2.1)', () => {
  // The build is this describe's alone, so the matcher's row above needs none.
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

  // The PWA plugin adds the manifest link to every HTML entry; vite.config.ts's `reviewPageWithoutManifest` takes it out
  // of the review page alone, so the shell keeps its own (the installable app needs it).
  it('the built page holds no manifest link, and the shell keeps its own', () => {
    const html = read('review.html');
    expect(html).not.toMatch(/rel=["']manifest["']/i);
    expect(html).not.toMatch(/\.webmanifest/);
    expect(read('index.html')).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it('the built page carries the data: icon, the no-referrer meta and its own title', () => {
    const html = read('review.html');
    expect(html).toContain('<link rel="icon" href="data:,"');
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"/);
    expect(html).toContain('<title>Draft for review</title>');
    expect(html).not.toContain('/icons/');
  });

  // R2.1 review, M1: under `default-src 'none'` with `script-src 'self'` and `img-src data:`, every URL the built page
  // names must be a `data:` one or a same-origin file under `/assets/`; and the page's import closure must stay its own,
  // never reaching the shell's entry chunk or React, so a later `manualChunks` or a heavy import into `shared/` shows here.
  it('every URL the built page names is data: or under /assets/', () => {
    const html = read('review.html');
    const urls = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThan(2);
    for (const u of urls) expect(u, u).toMatch(/^(?:data:|\/assets\/[^/?#]+$)/);
  });

  it("the page's import closure reaches neither the shell's entry chunk nor React", () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = read(path.join('assets', file));
      for (const m of text.matchAll(/(?:from\s*|import\s*\(?\s*)["']\.\/([^"']+\.js)["']/g)) walk(m[1]!);
    };
    const entry = /\bsrc="\/assets\/(review-[^"]+\.js)"/.exec(read('review.html'))?.[1];
    expect(entry, 'the page has an entry chunk of its own').toBeDefined();
    walk(entry!);
    // Not vacuous: the entry imports the shared `docs-*` chunk the build splits out (measured 2026-11-25).
    expect(seen.size, [...seen].join(', ')).toBeGreaterThan(1);
    expect([...seen].filter((f) => /^index-/.test(f))).toEqual([]);
    for (const f of seen) expect(read(path.join('assets', f)), f).not.toMatch(/react\.(?:production|development)|__SECRET_INTERNALS|react-dom/);
  });

  // D-9027's condition: the review server in `browser/reviewServer.ts` is test harness only. No shipped source imports
  // anything under `pwa/browser/` (each relative specifier of every `src` file is resolved and must stay out of it), and
  // no built file names the harness. A planted import shows the scan sees one.
  it('no shipped code reaches the browser harness (D-9027)', () => {
    const BROWSER = path.join(PWA, 'browser') + path.sep;
    const specifiers = (text: string): string[] =>
      [...text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]!);
    const reaching = (file: string, text: string): string[] =>
      specifiers(text).filter((s) => (path.resolve(path.dirname(file), s) + path.sep).startsWith(BROWSER)
        || path.resolve(path.dirname(file), s).startsWith(BROWSER));
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(?:ts|tsx|mts)$/.test(n) ? [p] : [];
    });
    const files = walk(path.join(PWA, 'src'));
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap((f) => reaching(f, readFileSync(f, 'utf8')).map((s) => `${path.relative(PWA, f)} ${s}`))).toEqual([]);
    const planted = path.join(PWA, 'src', 'review', 'main.ts');
    expect(reaching(planted, "import { serveReview } from '../../browser/reviewServer';\n")).toEqual(['../../browser/reviewServer']);
    for (const name of readdirSync(path.join(out, 'assets'))) {
      expect(read(path.join('assets', name)), name).not.toMatch(/reviewServer|startReviewServer/);
    }
  });

  // The page's sheet is built into the shared `assets/` beside the shell's, where a reader of "every sheet under assets/"
  // (the browser leg's `linear-items` rows, for one) applies it to the shell's document. Every selector is therefore scoped
  // to the review document (`:root.review-page`, which review.html's root carries) or to a `review-` name. An unscoped
  // `body { padding: 16px }` moved the shell's act bar 5.5 px under its phone bar there (measured 2026-11-25).
  it("the page's built sheet styles only the review document: every selector is scoped to it", () => {
    // A small block walker (sheet review, M2 to M4): a top-level selector list is split at commas outside parentheses and
    // each must be scoped; keyframe selectors and nested rules sit under a parent already judged. An at-rule that acts on the
    // whole document (`@font-face`, `@keyframes`, `@property`, `@counter-style`, `@page`, `@import`, `@layer` and the like)
    // must carry a `review-` name; only the group rules (`@media`, `@supports`, `@container`) are walked into.
    const SCOPED = /^(?::where\(:root\.review-page\)|:root\.review-page\b|\.review-|#review-)/;
    const GROUPS = new Set(['media', 'supports', 'container']);
    const splitTop = (list: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let from = 0;
      for (let i = 0; i < list.length; i += 1) {
        if (list[i] === '(') depth += 1;
        else if (list[i] === ')') depth -= 1;
        else if (list[i] === ',' && depth === 0) { parts.push(list.slice(from, i).trim()); from = i + 1; }
      }
      return [...parts, list.slice(from).trim()];
    };
    const unscoped = (css: string): string[] => {
      const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
      const bad: string[] = [];
      const stack: Array<'group' | 'keyframes' | 'style' | 'other'> = [];
      let from = 0;
      for (let i = 0; i < text.length; i += 1) {
        const c = text[i];
        if (c === ';') {
          const statement = text.slice(from, i).trim();
          if (statement.startsWith('@') && stack.every((k) => k === 'group') && !/^@charset\b|\breview-/.test(statement)) bad.push(statement);
          from = i + 1;
        } else if (c === '}') {
          stack.pop();
          from = i + 1;
        } else if (c === '{') {
          const prelude = text.slice(from, i).trim();
          from = i + 1;
          const parent = stack[stack.length - 1];
          if (prelude.startsWith('@')) {
            const name = (/^@(?:-[a-z]+-)?([\w-]+)/i.exec(prelude)?.[1] ?? '').toLowerCase();
            if (GROUPS.has(name)) { stack.push('group'); continue; }
            if (!/\breview-/.test(prelude)) bad.push(prelude);
            stack.push(name === 'keyframes' ? 'keyframes' : 'other');
          } else if (parent === undefined || parent === 'group') {
            for (const s of splitTop(prelude)) if (!SCOPED.test(s)) bad.push(s);
            stack.push('style');
          } else {
            stack.push('style');
          }
        }
      }
      return bad;
    };
    const html = read('review.html');
    expect(html, 'the root carries the scope class').toMatch(/<html\b[^>]*\bclass="review-page"/);
    const sheets = [...html.matchAll(/\bhref="\/(assets\/[^"]+\.css)"/g)].map((m) => m[1]!);
    expect(sheets.length, 'the page links its own sheet').toBeGreaterThan(0);
    for (const s of sheets) {
      const css = read(s);
      expect(css.length, s).toBeGreaterThan(100);
      expect(unscoped(css), s).toEqual([]);
    }
    // CONTROL: the checker sees an unscoped rule, inside a media query too, after a statement at-rule, and a document-wide
    // at-rule with no `review-` name; it passes a scoped `:is()` list, keyframe selectors and a nested rule.
    expect(unscoped('body{margin:0}@media (prefers-color-scheme:dark){:root{--x:1}}.review-a,button{x:1}@layer a;i{x:1}'
      + ':where(:root.review-page) :is(a, b){x:1}@keyframes spin{from{x:0}to{x:1}}@keyframes review-spin{50%{x:1}}'
      + '@font-face{font-family:x}.review-b{&:hover{x:1}}'))
      .toEqual(['body', ':root', 'button', '@layer a', 'i', '@keyframes spin', '@font-face']);
  });

  it('the shell is still built, and its entry script is assets/index-*.js', () => {
    const html = read('index.html');
    const entry = scripts(html).map((s) => /\bsrc="\/(assets\/[^"]+\.js)"/.exec(s.attrs)?.[1]).filter((s) => s !== undefined);
    expect(entry.some((s) => /^assets\/index-[^/]+\.js$/.test(s!))).toBe(true);
    // The page's own entry is its own chunk: the shell never loads it.
    expect(html).not.toMatch(/assets\/review-/);
  });
});
