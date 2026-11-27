// The delivery recipe's driver as a test box runs it (Desktop polish wave 178; the capture owner's call 1208, condition 4),
// beside the recorder's compiled-file test (`testbox-capture-compiled.test.ts`). The driver is the server package's own
// entry point (`server/src/inject/deliveryDrive.ts`), named by path from the agent's compiled `main.js`
// (`main.ts#compiledDeliveryDriver`), never imported. A tree that does not carry it makes every box refuse the recipe at the
// frame for good with nothing to say so, so this file holds three things:
// - the release build's file list carries the server's whole compiled tree, which `npm run build` (the server's `tsc`,
//   whose `include` takes every source file and every shared `.mjs`) emits the driver and its imports into;
// - the agent's compiled `main.js` names the driver at the place that tree puts it;
// - the driver, emitted by the server's own compiler options into a tree that holds only its emitted files and their
//   package marker (no `node_modules` anywhere above it), loads and answers under the three-variable environment the
//   agent gives it (`PATH`, `TMPDIR`, `LANG`): its every import resolves with what the tree carries.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { compiledDeliveryDriver } from '../src/testbox/main.js';
import { mkTmp } from './tmpHelpers.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Where the release keeps the compiled driver, below `<tree>`: the server's `rootDir` is the repository root. */
const DRIVER_IN_TREE = ['server', 'dist', 'server', 'src', 'inject', 'deliveryDrive.js'];
/** Where the release keeps the agent's compiled testbox modules, below `<tree>`. */
const TESTBOX_DIST = ['agent', 'dist', 'agent', 'src', 'testbox'];

let tree = '';
let driver = '';

beforeAll(() => {
  tree = mkTmp('ccrc-capdrv-dist-');
  const server = path.join(tree, 'server');
  mkdirSync(server, { recursive: true });
  // The release's server package marks its emitted `.js` as ES modules, as `server/package.json` does.
  writeFileSync(path.join(server, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  // The server's own compiler options (its tsconfig, extended), the driver as the one root: tsc emits it and every file it
  // imports, laid out as `npm run build` lays them out under `server/dist`. A shared `.mjs` beside its `.d.mts` is resolved
  // to the declaration, so the real build emits it only through its include of `../shared/**/*.mjs`, which this keeps.
  // The compiler is the agent package's own (the same TypeScript as the server's, pinned below): the agent's CI leg installs
  // only the agent's packages. So it emits without checking (`noCheck`): the driver's type imports reach server files that
  // name the server's packages, which the server's own build checks, and which emit no runtime import (the run below loads
  // the tree with no `node_modules` at all).
  const config = path.join(mkTmp('ccrc-capdrv-cfg-'), 'tsconfig.json');
  writeFileSync(config, JSON.stringify({
    extends: path.join(repo, 'server', 'tsconfig.json'),
    compilerOptions: { outDir: path.join(server, 'dist'), noCheck: true },
    files: [path.join(repo, 'server', 'src', 'inject', 'deliveryDrive.ts')], include: [path.join(repo, 'shared', '**', '*.mjs')],
  }));
  const r = spawnSync(process.execPath, [path.join(repo, 'agent', 'node_modules', 'typescript', 'bin', 'tsc'), '-p', config],
    { cwd: path.join(repo, 'server'), encoding: 'utf8', timeout: 170_000 });
  expect(r.stdout + r.stderr, 'the driver does not compile').toBe('');
  driver = path.join(tree, ...DRIVER_IN_TREE);
}, 180_000);

describe('the compiled delivery driver, as a test box runs it', () => {
  it('the release build carries the server\'s whole compiled tree, and the server\'s build emits every source file', () => {
    const build = readFileSync(path.join(repo, 'deploy', 'build-release.sh'), 'utf8');
    expect(build).toMatch(/^cp -a "\$ROOT\/server\/dist" +"\$TOP\/server\/dist"$/m);
    expect(build).toMatch(/^cp -a "\$ROOT\/agent\/dist" +"\$TOP\/agent\/dist"$/m);
    const tsconfig = JSON.parse(readFileSync(path.join(repo, 'server', 'tsconfig.json'), 'utf8')) as { compilerOptions: { rootDir: string }; include: string[] };
    expect(tsconfig.compilerOptions.rootDir).toBe('..');
    expect(tsconfig.include).toContain('src/**/*.ts');
    expect(tsconfig.include).toContain('../shared/**/*.mjs');
    // The agent's compiler, which emits the driver here, is the server's own version: the version each lockfile resolves
    // (both are in the tree, so the agent's leg reads them with no install), and the range each package declares.
    const resolved = (pkg: string): string => (JSON.parse(readFileSync(path.join(repo, pkg, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string }> }).packages['node_modules/typescript']?.version ?? 'none';
    expect(resolved('agent')).not.toBe('none');
    expect(resolved('agent')).toBe(resolved('server'));
    const version = (pkg: string): string => (JSON.parse(readFileSync(path.join(repo, pkg, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> }).devDependencies?.['typescript'] ?? 'none';
    expect(version('agent')).toBe(version('server'));
    expect(existsSync(driver)).toBe(true);
  });

  it('the agent\'s compiled main.js names the driver where the tree puts it', () => {
    // `compiledDeliveryDriver` resolves against its own module's place; from the compiled `main.js` in the tree that is:
    const fromSource = path.relative(path.join(repo, 'agent', 'src', 'testbox'), compiledDeliveryDriver());
    expect(path.resolve(path.join(tree, ...TESTBOX_DIST), fromSource)).toBe(driver);
  });

  it('loads and answers under the three-variable environment, with no node_modules above it: every import resolves in the tree', () => {
    const tmp = mkTmp('ccrc-capdrv-run-');
    for (let dir = tree; dir !== path.dirname(dir); dir = path.dirname(dir)) expect(existsSync(path.join(dir, 'node_modules')), dir).toBe(false);
    // An input it refuses: the driver must have loaded its whole module graph to read and refuse it, and it touches nothing.
    const r = spawnSync(process.execPath, [driver], {
      input: JSON.stringify({ capture: '/nowhere', tmux: '/nowhere', case: 'c0' }), cwd: tmp,
      env: { PATH: '/usr/bin:/bin', TMPDIR: tmp, LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 20_000,
    });
    expect(r.stderr, 'the driver did not load').not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
    const line = JSON.parse(r.stdout.trim()) as Record<string, unknown>;
    expect(Object.keys(line)).toEqual(['refused', 'detail']);
    expect(typeof line['refused']).toBe('string');
    expect(r.status).not.toBe(0);
  });
});
