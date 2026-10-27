// The spawn chain's census queries (`census-w8/spawn.ts`; D-7055, W8 Task C8c; ARCH-73 (#808)), held two ways, as
// `consolidation-census.test.ts` holds its own: against a fixture tree, where every shape the query must see or
// skip is written out, and against the real tree.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from '../tmpHelpers.js';
import { REPO } from '../consolidationCensus.js';
import {
  SPAWN_KERNEL_FILE, accountSpawnBodies, processSpawnSites, spawnKernelWireLiterals, updateSpawnBodies, updateSpawnCalls,
} from './spawn.js';

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
const BODY_FROM = KERNEL_TEXT.indexOf('  return new Promise((resolve) => {');
const BODY = KERNEL_TEXT.slice(BODY_FROM, KERNEL_TEXT.indexOf('\n}\n', BODY_FROM));
/** `boundedStdinSpawn`'s real body (D-7057), so the account-op fixture's "wrapper with the body" is the base's shape. */
const STDIN_FROM = KERNEL_TEXT.indexOf('export function boundedStdinSpawn(');
const STDIN_BODY = KERNEL_TEXT.slice(KERNEL_TEXT.indexOf('  return new Promise((resolve) => {', STDIN_FROM), KERNEL_TEXT.lastIndexOf('\n}'));

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

describe('accountSpawnBodies — every account-op spawn body outside shared/spawn.mjs (D-7057, OA-C8a (a))', () => {
  it('fixture: the body in both arms is two sites (the base\'s count); thin wrappers, the kernel and the near misses are none', () => {
    const wrapper = (name: string): string =>
      `export function ${name}(file, argv, stdin, opts, signals) {\n  const { spawn } = { spawn: null };\n  const { env, timeoutMs, killGraceMs, maxOutputBytes, drainMs } = opts;\n${STDIN_BODY}\n}\n`;
    const base = tree({ 'server/src/accounts/ops.ts': wrapper('localAccountOps'), 'agent/src/accountop.ts': wrapper('makeAccountOpSpawn') });
    expect(accountSpawnBodies(base).map((s) => s.file)).toEqual(['agent/src/accountop.ts', 'server/src/accounts/ops.ts']);
    expect(accountSpawnBodies(base)[0]!.text).toContain("spawn(file, [...argv], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env })");
    const tip = tree({
      // The tip's shape: thin wrappers.
      'agent/src/accountop.ts': "export function makeAccountOpSpawn(env) {\n  return (file, argv, stdin, b) => boundedStdinSpawn({ spawn, signals: osConstants.signals }, file, argv, stdin, { env, ...b, drainMs: ACCOUNT_OP_DRAIN_MS });\n}\n",
      // The kernel is the one place the body may live.
      [SPAWN_KERNEL_FILE]: KERNEL_TEXT,
      // The token-sync port is its own body by D-4390.
      'agent/src/tokensync.ts': wrapper('makeTokenSyncSpawn'),
      // Near misses: a piped-stdin group spawn with no group signal; the update spawner's shape (stdin ignored).
      'server/src/other.ts': "export function a(file) { return spawn(file, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); }\n"
        + "export function b(file) { const child = spawn(file, [], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); process.kill(-child.pid, 'SIGTERM'); }\n",
    });
    expect(accountSpawnBodies(tip)).toEqual([]);
  });

  it('fixture: a second stdin-piped group spawner in server/src is a site', () => {
    const root = tree({ 'server/src/second.ts': "export function second(file) {\n  const child = spawn(file, [], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: {} });\n  process.kill(-child.pid, 'SIGTERM');\n}\n" });
    expect(accountSpawnBodies(root).map((s) => `${s.file}:${s.line}`)).toEqual(['server/src/second.ts:2']);
  });

  it('real tree: none outside the kernel (2 at the base, measured in the PR body); the kernel holds the one body', () => {
    expect(accountSpawnBodies()).toEqual([]);
    expect(STDIN_BODY).toContain("spawn(file, [...argv], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env })");
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

  it('fixture: const KILL_GRACE_MS = 5_000 and const OUTPUT_MAX_BYTES = 1024 are definitions (D-7057)', () => {
    const root = tree({ [SPAWN_KERNEL_FILE]: 'const KILL_GRACE_MS = 5_000;\nconst OUTPUT_MAX_BYTES = 1024;\nexport function boundedStdinSpawn() { return KILL_GRACE_MS + OUTPUT_MAX_BYTES; }\n' });
    expect(spawnKernelWireLiterals(root).map((s) => s.text)).toEqual(['const KILL_GRACE_MS = 5_000;', 'const OUTPUT_MAX_BYTES = 1024;']);
  });

  it('fixture: setTimeout(f, drainMs) is none, and neither is a lower-case drainTimer', () => {
    const root = tree({ [SPAWN_KERNEL_FILE]: 'export function boundedSpawn(f, { drainMs }) {\n  let drainTimer = null;\n  drainTimer = setTimeout(f, drainMs);\n}\n' });
    expect(spawnKernelWireLiterals(root)).toEqual([]);
  });

  it('real tree: none — the kernel defines no drain or bound and passes setTimeout no literal', () => {
    expect(spawnKernelWireLiterals()).toEqual([]);
  });
});

describe('processSpawnSites — every process spawner in server/src, agent/src and shared/ (D-7056)', () => {
  it('fixture: each call shape is one site, keyed file#symbol; a comment, a string, an import and a type pass over', () => {
    const root = tree({
      'server/src/a.ts': "import { spawn, execFile, spawnSync, execFileSync, execSync, fork } from 'node:child_process';\n"
        + "// spawn('in a comment') and execFile('in a comment')\n"
        + "const words = \"spawn('in a string')\";\n"
        + "export function one() { return spawn('a', []); }\n"
        + "export function two() { return execFile('a', [], () => undefined); }\n"
        + "export function three() { return spawnSync('a'); }\n"
        + "export function four() { return execFileSync('a'); }\n"
        + "export function five() { return execSync('a'); }\n"
        + "export function six() { return fork('a'); }\n"
        + 'export const seven = words;\n',
      // An alias, a namespace import and a default import each reach a starter.
      'server/src/b.ts': "import { spawn as sp } from 'node:child_process';\nexport function alias() { return sp('a', []); }\n",
      'agent/src/c.ts': "import * as cp from 'node:child_process';\nexport function ns() { return cp.execFile('a', []); }\n",
      'agent/src/d.ts': "import cp from 'child_process';\nexport const viaDefault = () => cp.spawn('a', []);\n",
      // node-pty's spawn starts a process too.
      'server/src/pty.ts': "import { spawn } from 'node-pty';\nexport function attach() { return spawn('tmux', ['attach']); }\n",
      // The kernel's spawn is its injected host's.
      [SPAWN_KERNEL_FILE]: 'export function boundedSpawn(host) {\n  const { spawn } = host;\n  return spawn(\'a\', []);\n}\n',
    });
    expect(processSpawnSites(root).map((s) => `${s.key} ${s.callee}`)).toEqual([
      'server/src/a.ts#one spawn', 'server/src/a.ts#two execFile', 'server/src/a.ts#three spawnSync',
      'server/src/a.ts#four execFileSync', 'server/src/a.ts#five execSync', 'server/src/a.ts#six fork',
      'server/src/b.ts#alias sp', 'server/src/pty.ts#attach spawn',
      'agent/src/c.ts#ns cp.execFile', 'agent/src/d.ts#viaDefault cp.spawn',
      'shared/spawn.mjs#boundedSpawn spawn',
    ]);
  });

  it('fixture: a same-named local binding, a type-only import and a module that starts nothing are no site', () => {
    const root = tree({
      // `update/converge.ts`'s shape: the injected update spawner bound to a local `spawn`.
      'server/src/update/converge.ts': "import { boundedUpdateSpawn } from './spawn.js';\n"
        + 'export function localAnswer(deps) {\n  const spawn = deps.runLocal;\n  return spawn(\'update\', \'x\');\n}\n',
      'server/src/t.ts': "import type { ChildProcess } from 'node:child_process';\nexport function spawn(): ChildProcess | null { return null; }\nexport const x = spawn();\n",
      'server/src/u.ts': "import { spawn } from './elsewhere.js';\nexport function y() { return spawn('a'); }\n",
      // A shared module other than the kernel gets no injected-host pass.
      'shared/other.mjs': 'export function z(host) {\n  const { spawn } = host;\n  return spawn(\'a\', []);\n}\n',
    });
    expect(processSpawnSites(root)).toEqual([]);
  });

  it('fixture: a call at module scope is keyed file#<module>', () => {
    const root = tree({ 'agent/src/e.ts': "import { execFileSync } from 'node:child_process';\nexecFileSync('a');\n" });
    expect(processSpawnSites(root).map((s) => s.key)).toEqual(['agent/src/e.ts#<module>']);
  });

  it('real tree: the spawners (10 at ccba6f9b6, 9 once C8c folded the update pair into shared/spawn.mjs; C8e adds boundedStdinSpawn, then folds the account-op pair onto it)', () => {
    expect(processSpawnSites().map((s) => s.key)).toEqual([
      'server/src/exec.ts#realRunner',
      'server/src/localcaps.ts#execCapped',
      'server/src/pty.ts#attachPty',
      'agent/src/pty.ts#spawnFleetPty',
      'agent/src/server.ts#runExec',
      'agent/src/tokensync.ts#makeTokenSyncSpawn',
      'shared/spawn.mjs#boundedSpawn',
      'shared/spawn.mjs#boundedStdinSpawn',
    ]);
  });
});
