// The manifest script is the instrument that proves the extraction moved the
// code intact. It runs in two DIFFERENT repo layouts and its whole value is
// that both runs produce the same keys for the same files — so that is what is
// tested here, against a synthetic tree of each shape.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, '../../scripts/extraction-manifest.sh');

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccrc-manifest-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function write(rel: string, body: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function run(): string {
  return execFileSync('bash', [SCRIPT, '--root', tmp], { encoding: 'utf8' });
}

/** Parse `path  sha` lines into a map. */
function parse(out: string): Record<string, string> {
  const m: Record<string, string> = {};
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [p, sha] = line.split(/\s+/);
    m[p!] = sha!;
  }
  return m;
}

describe('monorepo layout', () => {
  it('strips infra/ccrc/ and maps the four ccrc-portability files into ccd/', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/ccrc/pwa/src/b.tsx', 'B');
    write('infra/ccrc/README.md', 'R');
    write('infra/ccrc-portability/ccd', 'CCD');
    write('infra/ccrc-portability/tmux.conf', 'T');
    write('infra/ccrc-portability/statusline-command.sh', 'S');
    write('infra/ccrc-portability/claude-session@.service', 'U');

    const m = parse(run());
    expect(Object.keys(m).sort()).toEqual([
      'README.md',
      'ccd/ccd',
      'ccd/claude-session@.service',
      'ccd/statusline-command.sh',
      'ccd/tmux.conf',
      'pwa/src/b.tsx',
      'server/src/a.ts',
    ]);
  });

  it('excludes the operator tooling that stays behind', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/ccrc-portability/ccclip', 'X');
    write('infra/ccrc-portability/cc', 'X');
    write('infra/ccrc-portability/hammerspoon-init.lua', 'X');
    write('infra/ccrc-portability/docserver-server.py', 'X');
    write('infra/ccrc-portability/hardening.sh', 'X');
    write('infra/mac-account-swap/ccswap', 'X');

    expect(Object.keys(parse(run()))).toEqual(['server/src/a.ts']);
  });

  it('excludes node_modules, dist, dist-pwa and ccd-ccclip.test.ts', () => {
    write('infra/ccrc/server/src/a.ts', 'A');
    write('infra/ccrc/server/node_modules/pkg/i.js', 'X');
    write('infra/ccrc/server/dist/o.js', 'X');
    write('infra/ccrc/server/dist-pwa/i.html', 'X');
    write('infra/ccrc/server/test/ccd-ccclip.test.ts', 'X');

    expect(Object.keys(parse(run()))).toEqual(['server/src/a.ts']);
  });
});

describe('standalone layout', () => {
  it('uses paths as-is', () => {
    write('server/src/a.ts', 'A');
    write('ccd/ccd', 'CCD');
    expect(Object.keys(parse(run())).sort()).toEqual(['ccd/ccd', 'server/src/a.ts']);
  });
});

describe('the two layouts agree', () => {
  it('produces identical output for the same content in either shape', () => {
    write('infra/ccrc/server/src/a.ts', 'hello');
    write('infra/ccrc-portability/ccd', 'bash');
    const mono = run();

    fs.rmSync(path.join(tmp, 'infra'), { recursive: true, force: true });
    write('server/src/a.ts', 'hello');
    write('ccd/ccd', 'bash');
    const standalone = run();

    // Byte-identical, including the checksums. This is the property the whole
    // verification rests on: same content in either layout, same manifest.
    expect(standalone).toBe(mono);
  });
});

describe('refuses an unrecognised tree', () => {
  it('exits non-zero rather than emitting an empty manifest', () => {
    write('some/other/thing.txt', 'X');
    // An empty manifest compares equal to another empty manifest, which would
    // make the extraction "verified" while proving nothing.
    expect(() => run()).toThrow();
  });
});
