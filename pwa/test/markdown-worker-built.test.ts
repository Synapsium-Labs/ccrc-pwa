// The BUILT parse worker loads and answers with no DOM (native Docs reader, W4 fix round 1; review 408, F1). Every
// other worker test calls `parseMarkdown` in-process under jsdom, where `document` exists, and the source scan in
// `markdown-purity.test.ts` stops at the allowed packages' names, so neither can see which entry the bundler picks
// inside them. This one runs the real `vite build` (the app's own config, into a temporary directory), then loads the
// emitted `markdownWorker-*.js` chunk in a plain `node` child (this file's own jsdom never reaches it), where `self`
// is a stub and there is no `document`, as in a browser's worker scope. It posts a chat job over 4 KiB holding named
// character references and needs a `tree` that decoded them. At the base of this fix the chunk carried
// `decode-named-character-reference`'s `browser` entry, whose `document.createElement` at module load threw before
// `onmessage` was assigned.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
let out = '';

// Runs in the child. argv[1] is the chunk, argv[2] the job's source; prints one JSON line.
const LOADER = `
import { pathToFileURL } from 'node:url';
const [chunk, src] = process.argv.slice(1);
const replies = [];
globalThis.self = { postMessage: (r) => replies.push(r) };
const report = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
try {
  await import(pathToFileURL(chunk).href);
} catch (e) {
  report({ load: 'threw', name: e?.name, message: String(e?.message).slice(0, 200), document: typeof document });
  process.exit(0);
}
if (typeof self.onmessage !== 'function') { report({ load: 'no-onmessage' }); process.exit(0); }
self.onmessage({ data: { id: 7, profile: 'chat', src } });
await new Promise((r) => setTimeout(r, 0));
report({ load: 'ok', document: typeof document, replies });
`;

// Runs in a node child, cwd the PWA package: the app's own config, a production build (vitest's NODE_ENV=test would
// build the `development` export conditions, a different chunk), into argv[1]. Not in this file's jsdom realm, whose
// URL the PWA plugin's file writes reject.
const BUILDER = `
import { build } from 'vite';
await build({ configFile: 'vite.config.ts', logLevel: 'error', build: { outDir: process.argv[1], emptyOutDir: true } });
`;

beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'ccrc-worker-built-'));
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '', NODE_ENV: 'production' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  execFileSync(process.execPath, ['--input-type=module', '-e', BUILDER, out],
    { cwd: PWA, env, encoding: 'utf8', timeout: 170_000, stdio: ['ignore', 'pipe', 'pipe'] });
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('the built markdownWorker chunk', () => {
  it('loads with no document and answers a chat job over 4 KiB with named character references as a tree', () => {
    const assets = path.join(out, 'assets');
    const chunks = readdirSync(assets).filter((n) => /^markdownWorker-[\w-]+\.js$/.test(n));
    expect(chunks).toHaveLength(1);

    const src = 'Fees &copy; 2026 &amp; more,&nbsp;with **bold** and `code`.\n\n'.repeat(80);
    expect(new TextEncoder().encode(src).byteLength).toBeGreaterThan(4096);

    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', LOADER, path.join(assets, chunks[0]!), src],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' }, timeout: 60_000 },
    );
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      load: string; document?: string; name?: string; message?: string;
      replies?: { id: number; outcome: { kind: string; tree?: unknown } }[];
    };
    expect(result).toMatchObject({ load: 'ok', document: 'undefined' });
    expect(result.replies).toHaveLength(1);
    const [reply] = result.replies!;
    expect(reply!.id).toBe(7);
    expect(reply!.outcome.kind).toBe('tree');
    const text = JSON.stringify(reply!.outcome.tree);
    expect(text).toContain('Fees \u00a9 2026 & more,\u00a0with ');
    expect(text).not.toContain('&copy;');
  }, 90_000);
});

// Docs W5 part 1, Task 3 (W5 bound 2-2, refinement (d)): the parse's element count includes the chips inline code
// draws. The count runs inside the worker closure, so only the built chunk proves the shipped worker carries it: a
// docs job of 400 spans of a 31-plus chord (64 elements a span, 25 601 in all) must answer too-wide, not a tree.
describe('the built markdownWorker chunk counts the chips inline code draws (W5 bound 2-2)', () => {
  it('answers a docs job of 400 spans of a 31-plus chord with too-wide and 25 601 elements', () => {
    const assets = path.join(out, 'assets');
    const chunk = readdirSync(assets).find((n) => /^markdownWorker-[\w-]+\.js$/.test(n));
    expect(chunk).toBeDefined();
    const docsLoader = LOADER.replace("profile: 'chat'", "profile: 'docs'");
    expect(docsLoader).not.toBe(LOADER);
    const src = Array.from({ length: 400 }, () => `\`${'a+'.repeat(31)}a\``).join(' ');
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', docsLoader, path.join(assets, chunk!), src],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' }, timeout: 60_000 },
    );
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      load: string; replies?: { id: number; outcome: { kind: string; elements?: number } }[];
    };
    expect(result.load).toBe('ok');
    expect(result.replies).toEqual([{ id: 7, outcome: { kind: 'too-wide', elements: 1 + 400 * 64 } }]);
  }, 90_000);
});

// Docs W5 part 1, Task 4 (M9.1, the 2026-10-12 spec's A16): the docs profile's real `<br>` is made in the parse's raw
// step, inside the worker closure, so only the built chunk proves the shipped worker carries it, for the docs profile
// alone: a docs job of `a<br>b` answers a tree holding one `br` element, and a chat job the tag as literal text.
describe('the built markdownWorker chunk draws a raw <br> as a br element in the docs profile alone (M9.1)', () => {
  it('answers a docs job of a<br>b with one br element, and a chat job with the tag as text', () => {
    const assets = path.join(out, 'assets');
    const chunk = readdirSync(assets).find((n) => /^markdownWorker-[\w-]+\.js$/.test(n));
    expect(chunk).toBeDefined();
    const docsLoader = LOADER.replace("profile: 'chat'", "profile: 'docs'");
    expect(docsLoader).not.toBe(LOADER);
    const answer = (loader: string) => {
      const stdout = execFileSync(
        process.execPath,
        ['--input-type=module', '-e', loader, path.join(assets, chunk!), 'a<br>b'],
        { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' }, timeout: 60_000 },
      );
      return JSON.parse(stdout.trim().split('\n').at(-1)!) as { load: string; replies?: unknown[] };
    };
    const paragraph = (middle: unknown) => ({
      kind: 'tree',
      depth: 2,
      tree: {
        type: 'root',
        children: [{ type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'a' }, middle, { type: 'text', value: 'b' }] }],
      },
    });
    const docs = answer(docsLoader);
    expect(docs.load).toBe('ok');
    expect(docs.replies).toEqual([{ id: 7, outcome: paragraph({ type: 'element', tagName: 'br', properties: {}, children: [] }) }]);
    const chat = answer(LOADER);
    expect(chat.load).toBe('ok');
    expect(chat.replies).toEqual([{ id: 7, outcome: paragraph({ type: 'text', value: '<br>' }) }]);
  }, 120_000);
});
