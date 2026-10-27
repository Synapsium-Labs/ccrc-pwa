// The spawn chain's census queries (`census-w8/spawn.ts`; D-7055, W8 Task C8c; ARCH-73 (#808)), held two ways, as
// `consolidation-census.test.ts` holds its own: against a fixture tree, where every shape the query must see or
// skip is written out, and against the real tree.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import { REPO } from '../consolidationCensus.js';
import { SPAWN_KERNEL_FILE, spawnKernelWireLiterals, updateSpawnBodies, updateSpawnCalls } from './spawn.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
function tree(files: Record<string, string>): string {
  const root = mkTmp('census-w8-spawn-');
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** The kernel's real body, so the fixture's "wrapper with the body" is the base's shape, not a paraphrase of it. */
const KERNEL_TEXT = readFileSync(path.join(REPO, SPAWN_KERNEL_FILE), 'utf8');
const BODY = KERNEL_TEXT.slice(KERNEL_TEXT.indexOf('  return new Promise((resolve) => {'), KERNEL_TEXT.lastIndexOf('\n}'));

describe('updateSpawnBodies — every update-spawn body outside shared/spawn.mjs (D-7055)', () => {
  it('fixture: a wrapper with the body is one site; a thin wrapper, the kernel itself and a near miss are none', () => {
    const root = tree({
      // The base's shape: the body spelled in a wrapper, the drain from the protocol.
      'agent/src/server.ts': `import { spawn } from 'node:child_process';\nexport function makeUpdateSpawn(env) {\n  const { signals } = { signals: {} };\n  const drainMs = 2000;\n  return (file, args, timeoutMs) => {\n${BODY}\n  };\n}\n`,
      // The tip's shape: a thin wrapper.
      'server/src/update/spawn.ts': "import { boundedSpawn } from '../../../shared/spawn.mjs';\nexport function boundedUpdateSpawn(file, args, opts = {}) {\n  return boundedSpawn({ spawn, signals: os.constants.signals }, file, args, { env: opts.env, timeoutMs: 1, drainMs: UPDATE_SPAWN_DRAIN_MS });\n}\n",
      // The kernel is the one place the body may live.
      'shared/spawn.mjs': KERNEL_TEXT,
      // A near miss: the update spawner's options with no group kill (a different runner), and a group kill with stdin piped.
      'server/src/other.ts': "export function a(file) { return spawn(file, [], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); }\n"
        + "export function b(file) { const child = spawn(file, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); process.kill(-child.pid, 'SIGKILL'); }\n",
    });
    const sites = updateSpawnBodies(root);
    expect(sites.map((s) => s.file)).toEqual(['agent/src/server.ts']);
    // The wider net sees the near miss with no kill too, and still not the stdin-piped one nor the kernel.
    expect(updateSpawnCalls(root).map((s) => s.file)).toEqual(['agent/src/server.ts', 'server/src/other.ts']);
    expect(sites[0]!.text).toContain("spawn(file, [...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env })");
  });

  it('fixture: the body in two wrappers is two sites (the base\'s count)', () => {
    const wrapper = (name: string): string => `export function ${name}(file, args, env, timeoutMs, drainMs, signals) {\n${BODY}\n}\n`;
    const root = tree({ 'agent/src/server.ts': wrapper('makeUpdateSpawn'), 'server/src/update/spawn.ts': wrapper('boundedUpdateSpawn') });
    expect(updateSpawnBodies(root).map((s) => s.file)).toEqual(['agent/src/server.ts', 'server/src/update/spawn.ts']);
  });

  it('real tree: none — both wrappers call boundedSpawn (2 at the base, measured in the PR body)', () => {
    expect(updateSpawnBodies()).toEqual([]);
    expect(updateSpawnCalls()).toEqual([]);
  });
});

describe('spawnKernelWireLiterals — a drain or a bound written into shared/spawn.mjs (D-7055)', () => {
  it('fixture: const DRAIN_MS = 2000 is a definition', () => {
    const root = tree({ [SPAWN_KERNEL_FILE]: 'const DRAIN_MS = 2000;\nexport function boundedSpawn() { return DRAIN_MS; }\n' });
    expect(spawnKernelWireLiterals(root).map((s) => s.text)).toEqual(['const DRAIN_MS = 2000;']);
  });

  it('fixture: setTimeout(f, 2000) is a literal delay', () => {
    const root = tree({ [SPAWN_KERNEL_FILE]: 'export function boundedSpawn(f) {\n  setTimeout(f, 2000);\n}\n' });
    expect(spawnKernelWireLiterals(root).map((s) => s.line)).toEqual([2]);
  });

  it('fixture: setTimeout(f, drainMs) is none, and neither is a lower-case drainTimer', () => {
    const root = tree({ [SPAWN_KERNEL_FILE]: 'export function boundedSpawn(f, { drainMs }) {\n  let drainTimer = null;\n  drainTimer = setTimeout(f, drainMs);\n}\n' });
    expect(spawnKernelWireLiterals(root)).toEqual([]);
  });

  it('real tree: none — the kernel defines no drain or bound and passes setTimeout no literal', () => {
    expect(spawnKernelWireLiterals()).toEqual([]);
  });
});
