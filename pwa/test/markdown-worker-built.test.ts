// The BUILT parse worker loads and answers with no DOM (native Docs reader, W4 fix round 1; review 408, F1). Every
// other worker test calls `parseMarkdown` in-process under jsdom, where `document` exists, and the source scan in
// `markdown-purity.test.ts` stops at the allowed packages' names, so neither can see which entry the bundler picks
// inside them. This one runs the real `vite build` (the app's own config, into a temporary directory), then loads the
// emitted `markdownWorker-*.js` chunk in a plain `node` child (this file's own jsdom never reaches it), where `self`
// is a stub and there is no `document`, as in a browser's worker scope. It posts a chat job over 4 KiB holding named
// character references and needs a `tree` that decoded them. At the base of this fix the chunk carried
// `decode-named-character-reference`'s `browser` entry, whose `document.createElement` at module load threw before
// `onmessage` was assigned.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

// Docs W8a Task 4 (A6, M8.21): the reader's render job is its own lazily loaded chunk. Only the built output shows it:
// the shared Markdown library's renderer (markdown-it, named by the string it puts in an error message) is in exactly
// one emitted file, `readerRenderJob-*.js`, never in the worker entry, which reaches that file through one dynamic
// import; and both load, and answer a render job, in a plain node child with no DOM globals.
const RENDER_LOADER = `
import { pathToFileURL } from 'node:url';
const [chunk, mode, src] = process.argv.slice(1);
const replies = [];
globalThis.self = { postMessage: (r) => replies.push(r) };
const report = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
try {
  const m = await import(pathToFileURL(chunk).href);
  if (mode === 'chunk') {
    m.answerRenderJob({ id: 9, kind: 'render', src }, (r) => replies.push(r));
  } else {
    if (typeof self.onmessage !== 'function') { report({ load: 'no-onmessage' }); process.exit(0); }
    self.onmessage({ data: { id: 9, kind: 'render', src } });
    // The reply comes after the chunk's dynamic import and the render: wait for it, not for a fixed time.
    const deadline = Date.now() + 30000;
    while (replies.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    if (replies.length === 0) { report({ load: 'no-reply', document: typeof document }); process.exit(0); }
  }
} catch (e) {
  report({ load: 'threw', name: e?.name, message: String(e?.message).slice(0, 200), document: typeof document });
  process.exit(0);
}
report({ load: 'ok', document: typeof document, window: typeof window, replies });
`;

describe('the built render job is its own lazily loaded worker chunk (W8a Task 4)', () => {
  const SRC = '# T\n\nsome text\n\n![a](a.png)\n';
  const assets = (): string => path.join(out, 'assets');
  const marker = (): string =>
    (JSON.parse(readFileSync(path.join(PWA, 'node_modules', 'markdown-it', 'package.json'), 'utf8')) as { name: string }).name;
  const answer = (chunkFile: string, mode: 'chunk' | 'worker') => {
    const stdout = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', RENDER_LOADER, path.join(assets(), chunkFile), mode, SRC],
      { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' }, timeout: 60_000 },
    );
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as {
      load: string; document?: string; window?: string; name?: string; message?: string;
      replies?: { id: number; outcome: { kind: string; images?: string[]; result?: { html: string; meta: { title: string | null } } } }[];
    };
  };

  it('exactly one emitted chunk holds the renderer, it is not the worker entry, and the entry imports it lazily', () => {
    const files = readdirSync(assets()).filter((n) => n.endsWith('.js'));
    const holders = files.filter((n) => readFileSync(path.join(assets(), n), 'utf8').includes(marker()));
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatch(/^readerRenderJob-[\w-]+\.js$/);
    const entry = files.find((n) => /^markdownWorker-[\w-]+\.js$/.test(n));
    expect(entry).toBeDefined();
    const entryText = readFileSync(path.join(assets(), entry!), 'utf8');
    expect(entryText).not.toContain(marker());
    expect(entryText).toMatch(/import\(\s*[`'"]\.\/readerRenderJob-[\w-]+\.js[`'"]\s*\)/);
    expect(entryText).not.toMatch(/\bfrom\s*[`'"]\.\/readerRenderJob-/);
  });

  it('the render chunk imports with no DOM and answers a render job rendered', () => {
    const chunk = readdirSync(assets()).find((n) => /^readerRenderJob-[\w-]+\.js$/.test(n));
    expect(chunk).toBeDefined();
    const result = answer(chunk!, 'chunk');
    expect(result).toMatchObject({ load: 'ok', document: 'undefined', window: 'undefined' });
    expect(result.replies).toHaveLength(1);
    expect(result.replies![0]!.id).toBe(9);
    expect(result.replies![0]!.outcome.kind).toBe('rendered');
    expect(result.replies![0]!.outcome.result?.html).toContain('data-line=');
    expect(result.replies![0]!.outcome.result?.meta.title).toBe('T');
    expect(result.replies![0]!.outcome.images).toEqual(['a.png']);
  }, 90_000);

  it('the worker entry answers a render message by loading the chunk, with no DOM', () => {
    const entry = readdirSync(assets()).find((n) => /^markdownWorker-[\w-]+\.js$/.test(n));
    expect(entry).toBeDefined();
    const result = answer(entry!, 'worker');
    expect(result).toMatchObject({ load: 'ok', document: 'undefined', window: 'undefined' });
    expect(result.replies).toHaveLength(1);
    expect(result.replies![0]!.id).toBe(9);
    expect(result.replies![0]!.outcome.kind).toBe('rendered');
  }, 90_000);
});
