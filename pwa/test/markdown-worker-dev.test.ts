// The dev server's parse worker reaches the plain decoder, never the DOM one (native Docs reader, W4 fix round 1; its
// own review of review 408's F1). `vite dev` does not bundle the worker: the worker's modules come from the main
// graph, whose pre-bundled dependencies the optimizer builds with the `browser` condition, so without
// `vite.config.ts`'s serve-only alias they carry `decode-named-character-reference`'s `index.dom.js`, whose
// `document.createElement` throws in a worker. This file starts the real dev server in a node child (no VITEST in its
// environment, so the alias applies as it does for `npm run dev`), with a fresh optimizer cache in a temporary
// directory, fetches `markdownParse.ts` as the worker would, follows its pre-bundled imports, and reads every
// dependency chunk they reach.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
const cache = mkdtempSync(path.join(tmpdir(), 'ccrc-worker-dev-'));

// Runs in the child, cwd the PWA package; argv[1] is the cache directory. Prints one JSON line: for every dependency
// chunk the parse module reaches (the server writes each import of one as an absolute URL into the cache's `deps/`),
// its URL, whether it holds `document.createElement`, and whether it holds the plain
// decoder's entity table (`AElig`, its first entry).
const PROBE = `
import { createServer } from 'vite';
const server = await createServer({
  configFile: 'vite.config.ts', cacheDir: process.argv[1], logLevel: 'error',
  optimizeDeps: { force: true }, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
});
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const get = async (u) => (await fetch(new URL(u, base))).text();
  const parse = await get('/src/lib/markdownParse.ts');
  const seen = new Map();
  const deps = (text) => [...text.matchAll(/"([^"]*\\/deps\\/[^"]+)"/g)].map((m) => m[1]);
  const todo = deps(parse);
  while (todo.length) {
    const raw = todo.pop();
    const u = new URL(raw, base).pathname;
    if (seen.has(u)) continue;
    const text = await get(raw);
    seen.set(u, { dom: text.includes('document.createElement'), table: text.includes('AElig') });
    todo.push(...deps(text));
  }
  process.stdout.write(JSON.stringify([...seen].map(([url, v]) => ({ url, ...v }))) + '\\n');
} finally {
  await server.close();
}
`;

afterAll(() => rmSync(cache, { recursive: true, force: true }));

describe('the dev server parse worker', () => {
  it("reaches the plain decoder's entity table and no document.createElement in any pre-bundled dependency", () => {
    const env: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
    if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
    const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE, cache],
      { cwd: PWA, env, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = JSON.parse(stdout.trim().split('\n').at(-1)!) as { url: string; dom: boolean; table: boolean }[];
    expect(chunks.map((c) => c.url)).toContainEqual(expect.stringMatching(/\/remark-gfm\.js$/));
    expect(chunks.filter((c) => c.dom)).toEqual([]);
    expect(chunks.some((c) => c.table)).toBe(true);
  }, 150_000);
});
