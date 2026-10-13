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
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PWA = path.join(import.meta.dirname, '..');
let out = '';

// Runs in the child. argv[1] is the chunk, argv[2] the job's source; prints one JSON line.
const LOADER = `
const [chunk, src] = process.argv.slice(1);
const replies = [];
globalThis.self = { postMessage: (r) => replies.push(r) };
const report = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
try {
  await import(new URL('file://' + chunk).href);
} catch (e) {
  report({ load: 'threw', name: e?.name, message: String(e?.message).slice(0, 200), document: typeof document });
  process.exit(0);
}
if (typeof self.onmessage !== 'function') { report({ load: 'no-onmessage' }); process.exit(0); }
self.onmessage({ data: { id: 7, profile: 'chat', src } });
await new Promise((r) => setTimeout(r, 0));
report({ load: 'ok', document: typeof document, replies });
`;

beforeAll(async () => {
  out = mkdtempSync(path.join(tmpdir(), 'ccrc-worker-built-'));
  const denylist = process.env['CCRC_SW_DENYLIST'];
  delete process.env['CCRC_SW_DENYLIST'];
  try {
    await build({
      root: PWA,
      configFile: path.join(PWA, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true },
    });
  } finally {
    if (denylist !== undefined) process.env['CCRC_SW_DENYLIST'] = denylist;
  }
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
    expect(text).toContain('Fees © 2026 & more, with ');
    expect(text).not.toContain('&copy;');
  }, 90_000);
});
