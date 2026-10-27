// `shared/redact-cli.mjs`, the docs redactor's process form (D-7077; ARCH-67; W5 Task C5h, design note §3.1). ccd's docs
// helper starts it once per docs verb and talks to it in newline-delimited JSON strings, so every string the helper
// redacts goes through `shared/redact.mjs`'s `docs` profile, the one the server's `redactDocsText` runs.
//
// The rows hold its contract: each request line is answered with `JSON.stringify(redact('docs', s))` and a newline, in
// order, as soon as it is read; end of input exits 0; a bad argv (no argv, `egress`, an unknown profile) or a line that is
// not one JSON string exits 2 with nothing more on stdout. Its SHAPE is held too, because the helper starts it from its
// checked bytes (`node --input-type=module -e`, with its one import specifier rewritten to a `data:` URL): exactly one line
// `import { redact } from './redact.mjs';`, the substring `redact.mjs` nowhere else, one import statement, no dynamic
// `import(`, no `import.meta`, no read of `process.argv[1]`, and no `node:` builtin (rings/mjs-node.test.ts).
import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactDocsText } from '../../shared/docs.js';
import { redact } from '../../shared/redact.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', '..', 'shared', 'redact-cli.mjs');

const PROFILES: { docs: [string, string, string][]; cross: [string, string, string][] } =
  JSON.parse(fs.readFileSync(path.join(here, 'fixtures/redact/profiles.json'), 'utf8'));

/** profiles.json's docs and cross rows, plus the strings the helper sends back: a lone surrogate from a decoded
 *  stderr, a multi-line head, an empty string and a large line. */
const CORPUS: readonly string[] = [
  ...PROFILES.docs.flatMap(([, input, output]) => [input, output]),
  ...PROFILES.cross.map(([input]) => input),
  '',
  'fatal: https://u:tok@h/r \udcff',
  'before\nAuthorization: Bearer y\nafter',
  `x${'y'.repeat(70_000)} https://u:tok@h/z`,
];

/** One CLI run over `input`, by path, as a whole: its code and both streams. */
function cliRun(args: readonly string[], input: string): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const lines = (ss: readonly string[]): string => ss.map((s) => `${JSON.stringify(s)}\n`).join('');

describe('shared/redact-cli.mjs: the docs profile, one JSON string per line (D-7077)', () => {
  it('answers every corpus string, in order, with JSON.stringify(redactDocsText(s)), and exits 0 at end of input', () => {
    const r = cliRun(['--profile', 'docs'], lines(CORPUS));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(r.stdout).toBe(lines(CORPUS.map(redactDocsText)));
    expect(r.stdout).toBe(lines(CORPUS.map((s) => redact('docs', s))));
    // Vacuity: the corpus holds strings the profile changes and strings it leaves alone.
    expect(CORPUS.filter((s) => redactDocsText(s) !== s).length).toBeGreaterThanOrEqual(10);
    expect(CORPUS.filter((s) => redactDocsText(s) === s).length).toBeGreaterThanOrEqual(5);
  });

  it('a lone surrogate survives the trip both ways, as python writes it', () => {
    const r = cliRun(['--profile', 'docs'], '"fatal: https://u:tok@h/r \\udcff"\n');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('"fatal: https://***@h/r \\udcff"\n');
  });

  it('answers line by line: the first answer is read before the second request is written', async () => {
    const p = spawn(process.execPath, [CLI, '--profile', 'docs'], { stdio: ['pipe', 'pipe', 'ignore'] });
    let got = '';
    const nextLine = (n: number): Promise<void> => new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no answer line ${n} within 10 s (stdout so far ${JSON.stringify(got)})`)), 10_000);
      const check = (): void => {
        if (got.split('\n').length - 1 >= n) { clearTimeout(t); p.stdout.off('data', onData); resolve(); }
      };
      const onData = (b: Buffer): void => { got += b.toString('utf8'); check(); };
      p.stdout.on('data', onData);
      check();
    });
    const done = new Promise<number | null>((resolve) => p.on('close', (code) => resolve(code)));
    p.stdin.write('"https://u:tok@h/1"\n');
    await nextLine(1);
    expect(got).toBe('"https://***@h/1"\n');
    p.stdin.write('"https://u:tok@h/2"\n');
    await nextLine(2);
    p.stdin.end();
    expect(await done).toBe(0);
    expect(got).toBe('"https://***@h/1"\n"https://***@h/2"\n');
  });

  it.each([
    ['no argv', []],
    ['--profile egress (it needs caller shapes)', ['--profile', 'egress']],
    ['an unknown profile', ['--profile', 'nope']],
    ['a profile name that is an Object property', ['--profile', 'constructor']],
    ['a third argument', ['--profile', 'docs', 'x']],
    ['the flag alone', ['--profile']],
  ])('%s exits 2 with nothing on stdout', (_why, args) => {
    const r = cliRun(args, lines(['https://u:tok@h/x']));
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });

  it.each([
    ['a line that is not JSON', 'not json\n'],
    ['a JSON value that is not a string', '{"a":1}\n'],
    ['a JSON number', '1\n'],
  ])('%s exits 2 at once, with nothing more on stdout', (_why, bad) => {
    const r = cliRun(['--profile', 'docs'], `"https://u:tok@h/ok"\n${bad}"https://u:tok@h/after"\n`);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('"https://***@h/ok"\n');
  });

  it('a partial last line (no newline) at end of input exits 2', () => {
    const r = cliRun(['--profile', 'docs'], '"https://u:tok@h/ok"\n"partial');
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('"https://***@h/ok"\n');
  });

  it('empty input answers nothing and exits 0', () => {
    expect(cliRun(['--profile', 'docs'], '')).toEqual({ code: 0, stdout: '', stderr: '' });
  });
});

describe('shared/redact-cli.mjs: the shape the helper\'s read-once start relies on (design note §3.1, §3.3)', () => {
  const src = (): string => fs.readFileSync(CLI, 'utf8');

  it('holds exactly one line `import { redact } from \'./redact.mjs\';`', () => {
    expect(src().split('\n').filter((l) => l === "import { redact } from './redact.mjs';")).toHaveLength(1);
  });

  it('spells the substring redact.mjs exactly once in the whole file, in any quoting, a comment included', () => {
    expect(src().split('redact.mjs').length - 1).toBe(1);
  });

  it('has one import statement, no dynamic import(, no import.meta and no read of process.argv[1]', () => {
    expect(src().split('\n').filter((l) => /^\s*import\b/.test(l))).toHaveLength(1);
    expect(src()).not.toContain('import(');
    expect(src()).not.toContain('import.meta');
    expect(src()).not.toContain('process.argv[1]');
  });
});
